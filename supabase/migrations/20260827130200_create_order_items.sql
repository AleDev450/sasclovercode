-- Phase 13 - Orders Core
-- The lines of an order, and the snapshot that makes them permanent.
--
-- SPEC: docs/specs/phase-13-orders-core.md sections 8, 11.
-- CLOVERCODE_MASTER.md section 33 (Phase 13), section 39.
--
-- This file is the phase. Master section 33, textual:
--
--   "Los precios del pedido deben guardarse como snapshot.
--    Nunca depender del precio actual de products para calcular pedidos
--    historicos."
--
-- The failure it prevents is silent. A line that JOINs `products` to show its
-- price works perfectly until somebody raises a price - and then every order
-- ever placed reports a different total than what was charged. Nothing errors.
-- The reports are simply wrong, retroactively, and there is no way to tell from
-- the data that they ever were right.

create table public.order_items (
  id               uuid          not null default gen_random_uuid(),
  order_id         uuid          not null,
  -- Denormalised, maintained by a trigger, like every child table since Phase
  -- 10: without it each policy would have to join `orders` to learn whose row
  -- this is.
  tenant_id        uuid          not null,

  -- POINTERS, not dependencies.
  --
  -- Nullable and ON DELETE SET NULL on purpose: the line does not need them for
  -- anything. Its name and price are its own. These exist so a report can ask
  -- "how many times did we sell this", and if the product is deleted the line
  -- is still exact - it just stops being attributable to a catalogue entry.
  --
  -- This is the difference between a reference and a copy, and section 33 asks
  -- for the copy.
  product_id       uuid,
  variant_id       uuid,

  -- ---------------------------------------------------------------------
  -- THE SNAPSHOT
  -- ---------------------------------------------------------------------
  -- Written once, by a trigger, from the catalogue as it stood at that moment.
  -- Nothing updates these afterwards.
  name_snapshot    text          not null,
  variant_snapshot text,
  unit_price_cents bigint        not null,

  -- Fractional on purpose: 0.75 kg of something sold by the kilo is a real
  -- line. This is the only `numeric` in the phase and it is NOT money -
  -- ADR-015 governs amounts, and every amount here is still an integer.
  quantity         numeric(10,3) not null,

  discount_cents   bigint        not null default 0,
  -- Stored, not computed. Master section 33 lists `tax` among the fields to
  -- keep, so the column exists and travels into the total. WHO decides the IGV
  -- - and whether the price already includes it - is Phase 17, with SUNAT's
  -- rules in hand. Inventing an 18% here would be a rule that phase has to
  -- dismantle (section 51).
  tax_cents        bigint        not null default 0,

  -- round(unit_price * quantity) - discount + tax. Computed by trigger.
  total_cents      bigint        not null default 0,

  notes            text,
  position         smallint      not null default 0,
  created_at       timestamptz   not null default now(),
  updated_at       timestamptz   not null default now(),

  constraint order_items_pkey primary key (id),

  constraint order_items_order_id_fkey
    foreign key (order_id) references public.orders (id) on delete cascade,
  constraint order_items_tenant_id_fkey
    foreign key (tenant_id) references public.tenants (id) on delete cascade,
  constraint order_items_product_id_fkey
    foreign key (product_id) references public.products (id) on delete set null,
  constraint order_items_variant_id_fkey
    foreign key (variant_id) references public.product_variants (id) on delete set null,

  constraint order_items_name_length
    check (char_length(btrim(name_snapshot)) between 1 and 200),
  constraint order_items_variant_length
    check (coalesce(char_length(variant_snapshot), 0) <= 120),
  constraint order_items_notes_length
    check (coalesce(char_length(notes), 0) <= 300),

  -- Zero quantity is not a line, it is a line somebody meant to delete.
  constraint order_items_quantity_positive check (quantity > 0 and quantity <= 100000),

  constraint order_items_amounts_range check (
    unit_price_cents between 0 and 10000000000
    and discount_cents >= 0
    and tax_cents >= 0
    and total_cents >= 0
  ),

  -- A discount may take a line to zero - "on the house" is a real thing - but
  -- not below. A negative line total would make an order total go backwards,
  -- and from Phase 14 that becomes a refund the payment layer never issued.
  constraint order_items_discount_within_gross check (
    discount_cents <= round(unit_price_cents * quantity)
  ),

  constraint order_items_position_range check (position between 0 and 1000)
);

comment on table public.order_items is
  'Order lines. Price and name are COPIES taken at insert time (§33).';
comment on column public.order_items.product_id is
  'A pointer for reporting only. The line does not depend on it and survives it.';
comment on column public.order_items.unit_price_cents is
  'Copied from the catalogue at insert. Never re-read. Never updated.';

create index order_items_order_position_idx
  on public.order_items (order_id, position);

-- "How many times did we sell this" - the reporting query these pointers exist
-- for (Phase 23).
create index order_items_tenant_product_idx
  on public.order_items (tenant_id, product_id)
  where product_id is not null;

create trigger order_items_set_updated_at
  before update on public.order_items
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Taking the snapshot
-- ---------------------------------------------------------------------------

-- The price is NOT accepted from the caller, and that is a security decision as
-- much as an integrity one.
--
-- Accepting a price from a form is the classic shopping-cart vulnerability:
-- whoever controls the browser controls what they pay. Validating the submitted
-- price against the catalogue in the Server Action does not help either - if
-- the server already knows the correct price, the form field contributes
-- nothing except an attack surface (AB-1301).
--
-- So the line arrives with a product and a quantity, and the database fills in
-- the rest. The discount DOES come from the caller, because it is a decision
-- the business makes rather than a fact about the catalogue - and the CHECK
-- above bounds it.
--
-- Everything here happens on INSERT only. On UPDATE the snapshot is left
-- untouched: that is what makes it a snapshot.
create or replace function public.snapshot_order_item()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order_tenant   uuid;
  v_order_status   public.order_status;
  v_product_tenant uuid;
  v_product_name   text;
  v_product_status public.product_status;
  v_price          bigint;
  v_variant_name   text;
begin
  select o.tenant_id, o.status into v_order_tenant, v_order_status
  from public.orders as o
  where o.id = new.order_id;

  if v_order_tenant is null then
    raise exception 'Order not found.' using errcode = 'P0002';
  end if;

  new.tenant_id := v_order_tenant;

  -- Lines are only editable while the order is still being written up. Once it
  -- is confirmed, what it contains is part of what happened (FR-1315).
  if v_order_status <> 'pending' then
    raise exception 'An order that is no longer pending cannot change its lines.'
      using errcode = 'P0001';
  end if;

  if new.product_id is null then
    -- A free-text line: "servicio", "propina", something not in the catalogue.
    -- The caller supplies the name and the price, which is safe precisely
    -- because there is no catalogue entry to disagree with.
    if new.name_snapshot is null or btrim(new.name_snapshot) = '' then
      raise exception 'A line without a product needs a name.' using errcode = '23514';
    end if;
    if new.unit_price_cents is null then
      raise exception 'A line without a product needs a price.' using errcode = '23514';
    end if;
  else
    select p.tenant_id, p.name, p.status, p.base_price_cents
      into v_product_tenant, v_product_name, v_product_status, v_price
    from public.products as p
    where p.id = new.product_id;

    if v_product_tenant is null or v_product_tenant <> v_order_tenant then
      raise exception 'That product belongs to a different business.'
        using errcode = '23514';
    end if;

    -- Archived means "we do not sell this any more". Existing orders that
    -- contain it are untouched - that is the entire point of archiving rather
    -- than deleting (Phase 11) - but it cannot go into a new one.
    if v_product_status = 'archived' then
      raise exception 'That product is archived and cannot be added to an order.'
        using errcode = '23514';
    end if;

    if new.variant_id is not null then
      select v.name, v.price_cents into v_variant_name, v_price
      from public.product_variants as v
      where v.id = new.variant_id
        and v.product_id = new.product_id
        and v.tenant_id = v_order_tenant;

      if v_variant_name is null then
        raise exception 'That variant does not belong to this product.'
          using errcode = '23514';
      end if;

      new.variant_snapshot := v_variant_name;
    end if;

    -- THE COPY. After this line the order stops caring about the catalogue.
    new.name_snapshot    := v_product_name;
    new.unit_price_cents := v_price;
  end if;

  -- round() and not trunc(): a fractional quantity can land between cents, and
  -- rounding half up is what a Peruvian till does and what a customer expects
  -- when they check the arithmetic. `src/lib/money.multiplyMoney` rounds the
  -- same way, so the preview in the form matches the stored total.
  new.total_cents :=
    round(new.unit_price_cents * new.quantity) - new.discount_cents + new.tax_cents;

  return new;
end;
$$;

comment on function public.snapshot_order_item() is
  'Copies name and price from the catalogue at insert time. The price is never accepted from a client.';

create trigger order_items_snapshot
  before insert on public.order_items
  for each row execute function public.snapshot_order_item();

-- On UPDATE, only the mutable parts are recomputed - never the snapshot.
create or replace function public.recompute_order_item_total()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order_status public.order_status;
begin
  select o.status into v_order_status from public.orders as o where o.id = new.order_id;

  if v_order_status <> 'pending' then
    raise exception 'An order that is no longer pending cannot change its lines.'
      using errcode = 'P0001';
  end if;

  -- The snapshot columns are pinned to their old values. An UPDATE that tries
  -- to rewrite the price of a line silently does nothing, rather than being
  -- accepted: there is no legitimate caller for it.
  new.name_snapshot    := old.name_snapshot;
  new.variant_snapshot := old.variant_snapshot;
  new.unit_price_cents := old.unit_price_cents;

  new.total_cents :=
    round(new.unit_price_cents * new.quantity) - new.discount_cents + new.tax_cents;

  return new;
end;
$$;

comment on function public.recompute_order_item_total() is
  'Recomputes a line total on update while pinning the snapshot columns.';

create trigger order_items_recompute
  before update on public.order_items
  for each row execute function public.recompute_order_item_total();

-- ---------------------------------------------------------------------------
-- The order's totals
-- ---------------------------------------------------------------------------

-- Computed here, from the lines, on every change. Not by the application.
--
-- The application is not the only writer - Phase 15 brings a POS and Phase 19 a
-- courier app - and two writers each computing a total independently is two
-- totals that will eventually differ by a cent nobody can explain.
--
-- Also not computed on READ, as a view or an aggregate: an order is read far
-- more often than it is written, and Phase 14 needs `total_cents` to be a
-- stored value it can compare payments against.
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
      total_cents    = totals.net + o.shipping_cents
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
  'Recomputes an order''s totals from its lines. The application never sends them.';

create trigger order_items_recompute_order_totals
  after insert or update or delete on public.order_items
  for each row execute function public.recompute_order_totals();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.order_items enable row level security;

-- Governed by the ORDER's permissions, not by permissions of its own: a line is
-- part of an order, and whoever may see the order may see what is in it.
create policy order_items_select_member
  on public.order_items for select to authenticated
  using (public.has_permission(tenant_id, 'orders.view'));

create policy order_items_insert_operator
  on public.order_items for insert to authenticated
  with check (
    public.has_permission(tenant_id, 'orders.create')
    or public.has_permission(tenant_id, 'orders.update')
  );

create policy order_items_update_operator
  on public.order_items for update to authenticated
  using (public.has_permission(tenant_id, 'orders.update'))
  with check (public.has_permission(tenant_id, 'orders.update'));

-- Lines CAN be deleted, unlike the order itself - but only while it is pending,
-- which the trigger enforces. Removing a line somebody added by mistake before
-- the order was confirmed is correcting a draft, not erasing history.
create policy order_items_delete_operator
  on public.order_items for delete to authenticated
  using (public.has_permission(tenant_id, 'orders.update'));

-- A DELETE has no NEW row, so the pending check lives in its own trigger.
create or replace function public.guard_order_item_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order_status public.order_status;
begin
  select o.status into v_order_status from public.orders as o where o.id = old.order_id;

  -- The order itself being deleted cascades here; there is nothing left to
  -- protect and no status to read.
  if v_order_status is null then
    return old;
  end if;

  if v_order_status <> 'pending' then
    raise exception 'An order that is no longer pending cannot change its lines.'
      using errcode = 'P0001';
  end if;

  return old;
end;
$$;

comment on function public.guard_order_item_delete() is
  'Refuses to remove a line from an order that has left `pending`.';

create trigger order_items_guard_delete
  before delete on public.order_items
  for each row execute function public.guard_order_item_delete();
