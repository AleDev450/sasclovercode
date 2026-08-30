-- Phase 20 - Loyalty + Promotions
-- A discount, as a posting against an order.
--
-- SPEC: docs/specs/phase-20-loyalty-promotions.md sections 8, 10, 11, 14.
-- CLOVERCODE_MASTER.md sections 33 (Phase 20), 37, 39.
-- ADR-024 decision 1.
--
-- This is the most delicate migration of the phase, and not because of the
-- table. `orders.total_cents` has been computed in TWO places since Phase 19 -
-- `recompute_order_totals()` (Phase 13, on line changes) and
-- `sync_order_shipping()` (Phase 19, on delivery changes) - and this phase adds
-- a third writer. All three are rewritten HERE, in one migration, so the total
-- can never depend on which trigger ran last.
--
-- The shared expression, from now on:
--
--   total_cents = greatest(SUM(order_items.total_cents)
--                        + orders.shipping_cents
--                        - orders.promotion_discount_cents, 0)

-- ---------------------------------------------------------------------------
-- The column the discount lands in
-- ---------------------------------------------------------------------------

-- Not `orders.discount_cents`: that one is the sum of the LINE discounts and is
-- recomputed from `order_items` on every change, so a promotion written there
-- would vanish the next time somebody edited the order. ADR-024 decision 1.
alter table public.orders
  add column promotion_discount_cents bigint not null default 0;

comment on column public.orders.promotion_discount_cents is
  'Order-level discount. Maintained by trigger from order_promotions; never sent by a client (ADR-024).';

alter table public.orders
  add constraint orders_promotion_discount_range
    check (promotion_discount_cents between 0 and 10000000000);

-- ---------------------------------------------------------------------------
-- order_promotions
-- ---------------------------------------------------------------------------

create table public.order_promotions (
  id                     uuid        not null default gen_random_uuid(),
  -- Derived by trigger from the order; never trusted from a client.
  tenant_id              uuid        not null,
  order_id               uuid        not null,

  -- Exactly which of the three is set is decided by `source` below. All three
  -- are SET NULL rather than CASCADE: deleting a promotion is allowed
  -- (configuration), and it must not erase the record that a bill was
  -- discounted - `label_snapshot` and `discount_cents` are what survive.
  promotion_id           uuid,
  coupon_id              uuid,
  loyalty_transaction_id uuid,

  source                 text        not null,

  -- What the ticket said. Same reasoning as ADR-017's price snapshot and
  -- ADR-023's zone name: renaming or deleting the promotion tomorrow cannot
  -- change what was printed yesterday.
  label_snapshot         text        not null,

  discount_cents         bigint      not null,

  created_by             uuid,
  created_at             timestamptz not null default now(),

  constraint order_promotions_pkey primary key (id),

  constraint order_promotions_tenant_id_fkey
    foreign key (tenant_id) references public.tenants (id) on delete cascade,
  constraint order_promotions_order_id_fkey
    foreign key (order_id) references public.orders (id) on delete cascade,
  constraint order_promotions_promotion_id_fkey
    foreign key (promotion_id) references public.promotions (id) on delete set null,
  constraint order_promotions_coupon_id_fkey
    foreign key (coupon_id) references public.coupons (id) on delete set null,
  constraint order_promotions_loyalty_txn_fkey
    foreign key (loyalty_transaction_id) references public.loyalty_transactions (id) on delete set null,
  constraint order_promotions_created_by_fkey
    foreign key (created_by) references auth.users (id) on delete set null,

  constraint order_promotions_source_known
    check (source in ('promotion', 'coupon', 'loyalty')),

  -- Each source names the thing it came from, when that thing still exists.
  -- Written as "was it set at insert time" rather than "is it set now",
  -- because SET NULL will legitimately empty these later - so the check has to
  -- tolerate a NULL that arrived by deletion. The insert-time guarantee is
  -- enforced by the trigger below instead, where it can tell the difference.
  constraint order_promotions_label_length
    check (char_length(btrim(label_snapshot)) between 1 and 120),
  constraint order_promotions_discount_range
    check (discount_cents between 0 and 10000000000)
);

comment on table public.order_promotions is
  'One posting per discount applied to an order. What makes a discount auditable (ADR-024).';
comment on column public.order_promotions.discount_cents is
  'Minor units (ADR-015). A copy, resolved when applied; never recomputed later.';

-- Idempotence (master section 37): the same promotion cannot be applied twice
-- to one order. A retry is a key violation, not a second discount.
--
-- Partial, because `loyalty` postings carry no promotion_id and a customer may
-- legitimately redeem points twice against the same order.
create unique index order_promotions_order_promotion_key
  on public.order_promotions (order_id, promotion_id)
  where promotion_id is not null;

create index order_promotions_tenant_order_idx
  on public.order_promotions (tenant_id, order_id);

-- "How many times was this redeemed" - the count the trigger below maintains,
-- and the report Phase 23 will want.
create index order_promotions_promotion_idx
  on public.order_promotions (promotion_id)
  where promotion_id is not null;
create index order_promotions_coupon_idx
  on public.order_promotions (coupon_id)
  where coupon_id is not null;

-- ---------------------------------------------------------------------------
-- Everything the application cannot be trusted to have checked
-- ---------------------------------------------------------------------------

-- The discount AMOUNT is resolved in TypeScript (ADR-024 decision 5, same
-- posture as ADR-023 took toward delivery rates): it depends on the type, the
-- subtotal and the shipping, and it is a business rule somebody will want to
-- read. What lives here is everything the application cannot guarantee,
-- because the dashboard is not the only possible writer:
--
--   the order is still a draft
--   the promotion belongs to this business
--   the coupon belongs to the promotion it claims
--   both are active, in date, and have not run out
--   the order clears the minimum
--   the discount does not exceed what is owed
create or replace function public.guard_order_promotion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order        public.orders%rowtype;
  v_promotion    public.promotions%rowtype;
  v_coupon       public.coupons%rowtype;
  v_goods_cents  bigint;
  v_applied      bigint;
begin
  select * into v_order from public.orders as o where o.id = new.order_id;

  if v_order.id is null then
    raise exception 'Order not found.' using errcode = 'P0002';
  end if;

  new.tenant_id := v_order.tenant_id;

  -- The same rule `order_items` (Phase 13) and `order_deliveries` (Phase 19)
  -- enforce, and for the reason Phase 14 made sharper: `paid_cents` is compared
  -- against `total_cents`, so moving the total of an order that has already
  -- been charged leaves a balance nobody asked for.
  if v_order.status <> 'pending' then
    raise exception 'An order that is no longer pending cannot change its discounts.'
      using errcode = 'P0001';
  end if;

  -- Source and reference agree, at insert time. Not a CHECK constraint: the FK
  -- is ON DELETE SET NULL, so a constraint would start failing later when the
  -- promotion is deleted, which is exactly the case that has to keep working.
  if new.source = 'promotion' and new.promotion_id is null then
    raise exception 'A promotion discount must name its promotion.' using errcode = '23514';
  end if;
  if new.source = 'coupon' and new.coupon_id is null then
    raise exception 'A coupon discount must name its coupon.' using errcode = '23514';
  end if;
  if new.source = 'loyalty' and new.loyalty_transaction_id is null then
    raise exception 'A loyalty discount must name its ledger entry.' using errcode = '23514';
  end if;

  if new.coupon_id is not null then
    select * into v_coupon from public.coupons as c where c.id = new.coupon_id;

    if v_coupon.id is null then
      raise exception 'Coupon not found.' using errcode = 'P0002';
    end if;
    if v_coupon.tenant_id <> new.tenant_id then
      raise exception 'That coupon belongs to a different business.' using errcode = '23514';
    end if;
    -- The coupon has to open the promotion it is being applied with, or the
    -- counters would credit a redemption to a promotion nobody unlocked.
    if new.promotion_id is not null and v_coupon.promotion_id <> new.promotion_id then
      raise exception 'That coupon does not belong to that promotion.' using errcode = '23514';
    end if;
    if not v_coupon.is_active then
      raise exception 'That coupon is not active.' using errcode = 'P0001';
    end if;
    if v_coupon.expires_at is not null and v_coupon.expires_at <= now() then
      raise exception 'That coupon has expired.' using errcode = 'P0001';
    end if;
    if v_coupon.max_redemptions is not null
       and v_coupon.times_redeemed >= v_coupon.max_redemptions then
      raise exception 'That coupon has no redemptions left.' using errcode = 'P0001';
    end if;
  end if;

  if new.promotion_id is not null then
    select * into v_promotion from public.promotions as p where p.id = new.promotion_id;

    if v_promotion.id is null then
      raise exception 'Promotion not found.' using errcode = 'P0002';
    end if;
    if v_promotion.tenant_id <> new.tenant_id then
      raise exception 'That promotion belongs to a different business.' using errcode = '23514';
    end if;
    if not v_promotion.is_active then
      raise exception 'That promotion is not active.' using errcode = 'P0001';
    end if;
    if v_promotion.starts_at is not null and v_promotion.starts_at > now() then
      raise exception 'That promotion has not started yet.' using errcode = 'P0001';
    end if;
    if v_promotion.ends_at is not null and v_promotion.ends_at <= now() then
      raise exception 'That promotion has ended.' using errcode = 'P0001';
    end if;
    if v_promotion.max_redemptions is not null
       and v_promotion.times_redeemed >= v_promotion.max_redemptions then
      raise exception 'That promotion has no redemptions left.' using errcode = 'P0001';
    end if;

    -- The minimum is compared against what the customer pays for GOODS -
    -- lines minus their own discounts - not against the total. Comparing
    -- against the total would let the delivery fee push an order over "desde
    -- S/ 50", which is not what the sign in the window means.
    select coalesce(sum(i.total_cents), 0) into v_goods_cents
    from public.order_items as i where i.order_id = new.order_id;

    if v_goods_cents < v_promotion.min_order_cents then
      raise exception 'This order does not reach the minimum for that promotion.'
        using errcode = 'P0001';
    end if;
  end if;

  -- A discount cannot exceed what is owed. Checked against everything already
  -- applied, so three small discounts cannot do together what one large one is
  -- refused for.
  select coalesce(sum(i.total_cents), 0) into v_goods_cents
  from public.order_items as i where i.order_id = new.order_id;

  select coalesce(sum(op.discount_cents), 0) into v_applied
  from public.order_promotions as op where op.order_id = new.order_id;

  if v_applied + new.discount_cents > v_goods_cents + v_order.shipping_cents then
    raise exception 'That discount is larger than the order.' using errcode = 'P0001';
  end if;

  new.created_by := coalesce(new.created_by, (select auth.uid()));

  return new;
end;
$$;

comment on function public.guard_order_promotion() is
  'Derives tenant_id and refuses a discount that is foreign, expired, exhausted, below the minimum, larger than the order, or applied to a settled order.';

create trigger order_promotions_guard
  before insert on public.order_promotions
  for each row execute function public.guard_order_promotion();

-- A DELETE has no NEW row, so the draft check lives in its own trigger - the
-- same shape as `guard_order_item_delete()` (Phase 13) and
-- `guard_order_delivery_delete()` (Phase 19).
create or replace function public.guard_order_promotion_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order_status public.order_status;
begin
  select o.status into v_order_status from public.orders as o where o.id = old.order_id;

  -- The order itself being deleted cascades here; nothing left to protect.
  if v_order_status is null then
    return old;
  end if;

  if v_order_status <> 'pending' then
    raise exception 'An order that is no longer pending cannot change its discounts.'
      using errcode = 'P0001';
  end if;

  return old;
end;
$$;

comment on function public.guard_order_promotion_delete() is
  'Refuses to remove a discount from an order that has left `pending`.';

create trigger order_promotions_guard_delete
  before delete on public.order_promotions
  for each row execute function public.guard_order_promotion_delete();

-- ---------------------------------------------------------------------------
-- The redemption counters
-- ---------------------------------------------------------------------------

-- Derived from postings rather than incremented by the application, for the
-- reason ADR-024 decision 1 gives: a counter somebody remembers to bump is a
-- counter that will eventually be wrong, and this one gates whether a coupon
-- still works.
create or replace function public.sync_promotion_redemptions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_promotion uuid := coalesce(new.promotion_id, old.promotion_id);
  v_coupon    uuid := coalesce(new.coupon_id, old.coupon_id);
begin
  if v_promotion is not null then
    update public.promotions as p
    set times_redeemed = (
      select count(*) from public.order_promotions as op where op.promotion_id = p.id
    )
    where p.id = v_promotion;
  end if;

  if v_coupon is not null then
    update public.coupons as c
    set times_redeemed = (
      select count(*) from public.order_promotions as op where op.coupon_id = c.id
    )
    where c.id = v_coupon;
  end if;

  return null;
end;
$$;

comment on function public.sync_promotion_redemptions() is
  'Recounts times_redeemed from order_promotions. A recount, not a delta, so removing a discount lowers it correctly.';

create trigger order_promotions_sync_redemptions
  after insert or delete on public.order_promotions
  for each row execute function public.sync_promotion_redemptions();

-- ---------------------------------------------------------------------------
-- The order's total - all three writers, rewritten together
-- ---------------------------------------------------------------------------

-- 1/3. The new one: postings changed.
create or replace function public.sync_order_promotions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order_id uuid := coalesce(new.order_id, old.order_id);
  v_discount bigint;
begin
  select coalesce(sum(op.discount_cents), 0) into v_discount
  from public.order_promotions as op
  where op.order_id = v_order_id;

  update public.orders as o
  set promotion_discount_cents = v_discount,
      total_cents = greatest(
        coalesce(
          (select sum(i.total_cents) from public.order_items as i where i.order_id = v_order_id),
          0
        ) + o.shipping_cents - v_discount,
        0
      )
  where o.id = v_order_id;

  return null;
end;
$$;

comment on function public.sync_order_promotions() is
  'Writes orders.promotion_discount_cents from its postings and recomputes total_cents.';

create trigger order_promotions_sync_order
  after insert or delete on public.order_promotions
  for each row execute function public.sync_order_promotions();

-- 2/3. Phase 13's, now subtracting the discount.
--
-- Rewritten here rather than in a later migration on purpose: leaving the three
-- formulas out of step even briefly would mean the total depended on which
-- trigger fired last. TEST-2028 combines lines, shipping and a discount on one
-- order precisely to pin this down.
create or replace function public.recompute_order_totals()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order_id uuid := coalesce(new.order_id, old.order_id);
begin
  update public.orders as o
  set subtotal_cents = totals.gross,
      discount_cents = totals.discount,
      tax_cents      = totals.tax,
      total_cents    = greatest(
        totals.net + o.shipping_cents - o.promotion_discount_cents,
        0
      )
  from (
    select
      coalesce(sum(round(i.unit_price_cents * i.quantity)), 0)::bigint as gross,
      coalesce(sum(i.discount_cents), 0)::bigint                       as discount,
      coalesce(sum(i.tax_cents), 0)::bigint                            as tax,
      coalesce(sum(i.total_cents), 0)::bigint                          as net
    from public.order_items as i
    where i.order_id = v_order_id
  ) as totals
  where o.id = v_order_id;

  return null;
end;
$$;

comment on function public.recompute_order_totals() is
  'Recomputes an order''s totals from its lines, minus the order-level discount. The application never sends them.';

-- 3/3. Phase 19's, now subtracting the discount too.
create or replace function public.sync_order_shipping()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order_id uuid   := coalesce(new.order_id, old.order_id);
  v_shipping bigint := case when tg_op = 'DELETE' then 0 else new.fee_cents end;
begin
  update public.orders as o
  set shipping_cents = v_shipping,
      total_cents    = greatest(
        coalesce(
          (select sum(i.total_cents) from public.order_items as i where i.order_id = v_order_id),
          0
        ) + v_shipping - o.promotion_discount_cents,
        0
      )
  where o.id = v_order_id;

  return null;
end;
$$;

comment on function public.sync_order_shipping() is
  'Writes orders.shipping_cents from the delivery and recomputes total_cents, minus the order-level discount.';

-- Why `greatest(..., 0)` in all three rather than letting the CHECK fire:
--
-- The guard above refuses a discount larger than the order, so the normal path
-- never reaches zero by accident. What `greatest` covers is the edge: a
-- discount is applied, and THEN lines are removed while the order is still a
-- draft. Without the clamp that would raise `orders_amounts_range` and the
-- line deletion would fail with a constraint name, which is a confusing way to
-- say "you cannot remove that". Clamping answers the customer-facing question
-- correctly instead - nobody owes a negative amount - and the postings still
-- record what was granted.

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.order_promotions enable row level security;

-- Readable by whoever may read either side of what produced it: a cashier with
-- `promotions.view` sees the coupon they applied, and one with `loyalty.view`
-- sees the points that paid for part of the bill.
create policy order_promotions_select_member
  on public.order_promotions for select to authenticated
  using (
    public.has_permission(tenant_id, 'promotions.view')
    or public.has_permission(tenant_id, 'loyalty.view')
  );

create policy order_promotions_insert_operator
  on public.order_promotions for insert to authenticated
  with check (
    public.has_permission(tenant_id, 'promotions.manage')
    or public.has_permission(tenant_id, 'loyalty.manage')
  );

-- No UPDATE policy. A discount is not edited: it is removed and applied again,
-- which leaves the counters and the total consistent by construction rather
-- than by remembering to adjust them.
create policy order_promotions_delete_operator
  on public.order_promotions for delete to authenticated
  using (
    public.has_permission(tenant_id, 'promotions.manage')
    or public.has_permission(tenant_id, 'loyalty.manage')
  );
