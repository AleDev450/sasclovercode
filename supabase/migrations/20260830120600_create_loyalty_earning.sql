-- Phase 20 - Loyalty + Promotions
-- How points are earned, and how they are spent.
--
-- SPEC: docs/specs/phase-20-loyalty-promotions.md sections 8, 12, 14.
-- CLOVERCODE_MASTER.md section 33 (Phase 20), 37.
-- ADR-024 decisions 3 and 4.

-- ---------------------------------------------------------------------------
-- The programme's settings
-- ---------------------------------------------------------------------------

-- On `tenant_settings` rather than in a table of their own. A points programme
-- has exactly one configuration per business - like the currency and the
-- timezone that already live there - so a table would hold one row per tenant
-- forever and buy nothing. Master names four tables for this phase and none of
-- them is a programme; adding a fifth for three scalars is the unrequested
-- structure section 47 warns about.
alter table public.tenant_settings
  add column loyalty_enabled           boolean  not null default false,
  add column loyalty_points_per_sol    smallint not null default 1,
  add column loyalty_point_value_cents smallint not null default 10;

comment on column public.tenant_settings.loyalty_enabled is
  'Off by default: a business opts into the programme rather than discovering it running.';
comment on column public.tenant_settings.loyalty_points_per_sol is
  'Points credited per whole unit of currency spent. Zero is legal and means the programme accrues nothing.';
comment on column public.tenant_settings.loyalty_point_value_cents is
  'What one point is worth in minor units when redeemed. Default 10 = S/ 0.10.';

alter table public.tenant_settings
  add constraint tenant_settings_loyalty_rate_range
    check (loyalty_points_per_sol between 0 and 1000),
  -- Never zero: a point worth nothing would let a redemption spend points for
  -- no discount, which reads as the system stealing them.
  add constraint tenant_settings_loyalty_value_range
    check (loyalty_point_value_cents between 1 and 10000);

-- ---------------------------------------------------------------------------
-- Earning: at `completed`, once
-- ---------------------------------------------------------------------------

-- The same hook, the same status and the same reason ADR-022 decision 3 chose
-- for stock consumption: `completed` is the one status `order_transitions`
-- (Phase 13) gives no outgoing edge at all, so a cancellation from anywhere
-- earlier never credited anything - by construction, not by a check. There are
-- no points to claw back because none were ever granted.
--
-- Idempotence (section 37) is structural: the partial unique index on
-- `loyalty_transactions (order_id) where type = 'earn'` makes a second run a
-- key violation rather than a second credit. This function inserts the account
-- first if it is missing, so a customer earns from their first completed order
-- without anybody having enrolled them.
create or replace function public.earn_loyalty_points_on_completion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_enabled     boolean;
  v_rate        smallint;
  v_account_id  uuid;
  v_goods_cents bigint;
  v_points      integer;
begin
  -- A counter sale has no customer, so there is nobody to credit. That is the
  -- deliberate consequence of ADR-016 not asking for personal data a sale does
  -- not need (KL-2006).
  if new.customer_id is null then
    return null;
  end if;

  select s.loyalty_enabled, s.loyalty_points_per_sol
  into v_enabled, v_rate
  from public.tenant_settings as s
  where s.tenant_id = new.tenant_id;

  if v_enabled is not true or coalesce(v_rate, 0) = 0 then
    return null;
  end if;

  -- Points are earned on GOODS, not on the total: nobody should earn loyalty
  -- for the delivery fee, and earning on a discounted bill should reflect what
  -- was actually paid for products.
  select coalesce(sum(i.total_cents), 0) into v_goods_cents
  from public.order_items as i
  where i.order_id = new.id;

  -- Truncating division, deliberately: S/ 24.90 at 1 point per sol is 24
  -- points, not 25. Rounding up would let a business advertise a rate it does
  -- not actually pay.
  v_points := (v_goods_cents / 100) * v_rate;

  if v_points <= 0 then
    return null;
  end if;

  select a.id into v_account_id
  from public.loyalty_accounts as a
  where a.customer_id = new.customer_id;

  if v_account_id is null then
    insert into public.loyalty_accounts (customer_id)
    values (new.customer_id)
    returning id into v_account_id;
  end if;

  insert into public.loyalty_transactions (account_id, type, points, order_id)
  values (v_account_id, 'earn', v_points, new.id);

  return null;
end;
$$;

comment on function public.earn_loyalty_points_on_completion() is
  'Credits points when an order reaches completed, once, if the programme is on and the order names a customer.';

create trigger orders_earn_loyalty_points
  after update of status on public.orders
  for each row
  when (new.status = 'completed' and old.status is distinct from 'completed')
  execute function public.earn_loyalty_points_on_completion();

-- ---------------------------------------------------------------------------
-- Redeeming: two writes that cannot be separated
-- ---------------------------------------------------------------------------

-- ADR-024 decision 4. Redeeming writes a negative ledger entry AND a discount
-- posting. If one happens without the other, either the business gives away
-- money or the customer loses points - and PostgREST sends two statements as
-- two requests, so it cannot be done from the application atomically.
--
-- One function, one transaction, both rows or neither.
--
-- SECURITY DEFINER with an explicit permission check inside: the function
-- bypasses RLS on the two tables it writes, so it has to do for itself what
-- the policies would have done. `has_permission` resolves against the CALLER's
-- membership, exactly as it does in a policy.
create or replace function public.redeem_loyalty_points(
  p_order_id   uuid,
  p_account_id uuid,
  p_points     integer
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order       public.orders%rowtype;
  v_account     public.loyalty_accounts%rowtype;
  v_point_value smallint;
  v_discount    bigint;
  v_txn_id      uuid;
begin
  if p_points is null or p_points <= 0 then
    raise exception 'Redeem a positive number of points.' using errcode = '23514';
  end if;

  select * into v_order from public.orders as o where o.id = p_order_id;
  if v_order.id is null then
    raise exception 'Order not found.' using errcode = 'P0002';
  end if;

  if not public.has_permission(v_order.tenant_id, 'loyalty.manage') then
    raise exception 'Not allowed to redeem points for this business.'
      using errcode = '42501';
  end if;

  select * into v_account from public.loyalty_accounts as a where a.id = p_account_id;
  if v_account.id is null then
    raise exception 'Loyalty account not found.' using errcode = 'P0002';
  end if;

  if v_account.tenant_id <> v_order.tenant_id then
    raise exception 'That account belongs to a different business.' using errcode = '23514';
  end if;

  -- Checked here so the caller gets a sentence. The CHECK on
  -- `points_balance >= 0` is what actually holds if anything slips past.
  if v_account.points_balance < p_points then
    raise exception 'That account does not have enough points.' using errcode = 'P0001';
  end if;

  select s.loyalty_point_value_cents into v_point_value
  from public.tenant_settings as s
  where s.tenant_id = v_order.tenant_id;

  v_discount := p_points::bigint * coalesce(v_point_value, 10)::bigint;

  if v_discount <= 0 then
    raise exception 'Those points are not worth anything yet.' using errcode = 'P0001';
  end if;

  insert into public.loyalty_transactions (account_id, type, points, order_id, reason)
  values (p_account_id, 'redeem', -p_points, p_order_id, null)
  returning id into v_txn_id;

  -- `guard_order_promotion()` runs on this insert and does the rest: the draft
  -- check, the "larger than the order" check, and the tenant derivation. If it
  -- raises, the ledger entry above rolls back with it - which is the entire
  -- point of doing this in one function.
  insert into public.order_promotions
    (order_id, loyalty_transaction_id, source, label_snapshot, discount_cents)
  values (
    p_order_id,
    v_txn_id,
    'loyalty',
    p_points || ' puntos canjeados',
    v_discount
  );

  return v_txn_id;
end;
$$;

comment on function public.redeem_loyalty_points(uuid, uuid, integer) is
  'Spends points as a discount on an order: one ledger entry and one posting, atomically (ADR-024 decision 4).';

revoke execute on function public.redeem_loyalty_points(uuid, uuid, integer) from public;
grant execute on function public.redeem_loyalty_points(uuid, uuid, integer) to authenticated;
