-- Phase 18 - Inventory
-- The ledger every stock change is written to, and the view current stock
-- is derived from.
--
-- SPEC: docs/specs/phase-18-inventory.md sections 8, 11.
-- CLOVERCODE_MASTER.md section 33 (Phase 18), textual:
--   "El stock deberá derivarse de movimientos. Evitar simplemente:
--    products.stock = stock - 1  sin trazabilidad."
-- ADR-022 decisions 1, 2, 4: stock is a VIEW over this table (never a
-- stored balance), a `purchase` movement is a purchase's own line item
-- (no separate `purchase_items` table), and quantity is allowed to go
-- negative - nothing here blocks a movement for insufficient stock.

create type public.stock_movement_type as enum
  ('purchase', 'sale', 'adjustment', 'waste', 'return', 'transfer');

create table public.stock_movements (
  id                 uuid        not null default gen_random_uuid(),
  -- Derived by trigger from inventory_item_id, like order_items derives
  -- its tenant_id from its order (Phase 13).
  tenant_id          uuid        not null,
  inventory_item_id  uuid        not null,
  location_id        uuid        not null,
  type               public.stock_movement_type not null,

  -- Signed: stock in is positive, stock out is negative - the same
  -- convention cash_movements.amount_cents uses (Phase 14). numeric, not
  -- bigint: a movement can be fractional (0.5 kg of butter), the same
  -- reasoning order_items.quantity (Phase 13) already applies.
  quantity           numeric(12,3) not null,

  -- Set only for a `purchase` row: what that one line cost, per unit, in
  -- the item's own unit. Never set for any other type.
  unit_cost_cents    bigint,

  -- Set only for `purchase` - which receipt this line belongs to.
  purchase_id        uuid,
  -- Set only for `sale` - which completed order (and which of its lines)
  -- produced this consumption. Written exclusively by the trigger the
  -- last migration of this phase adds; never accepted from a client.
  order_id           uuid,
  order_item_id      uuid,
  -- Set only for `transfer` - the two rows of one transfer (one negative
  -- at the source location, one positive at the destination) share this
  -- id, inserted together in a single statement by the Server Action so
  -- they can never exist one without the other.
  transfer_group_id  uuid,

  reason             text,
  created_by         uuid,
  created_at         timestamptz not null default now(),

  constraint stock_movements_pkey primary key (id),
  constraint stock_movements_tenant_id_fkey
    foreign key (tenant_id) references public.tenants (id) on delete cascade,
  -- RESTRICT throughout: an item, a location, a purchase or an order is
  -- deactivated/kept forever, never deleted, so none of these ever
  -- actually fire - each states what would happen if it could.
  constraint stock_movements_inventory_item_id_fkey
    foreign key (inventory_item_id) references public.inventory_items (id) on delete restrict,
  constraint stock_movements_location_id_fkey
    foreign key (location_id) references public.locations (id) on delete restrict,
  constraint stock_movements_purchase_id_fkey
    foreign key (purchase_id) references public.purchases (id) on delete restrict,
  constraint stock_movements_order_id_fkey
    foreign key (order_id) references public.orders (id) on delete restrict,
  constraint stock_movements_order_item_id_fkey
    foreign key (order_item_id) references public.order_items (id) on delete restrict,
  constraint stock_movements_created_by_fkey
    foreign key (created_by) references auth.users (id) on delete set null,

  constraint stock_movements_quantity_not_zero
    check (quantity <> 0 and abs(quantity) <= 1000000),
  constraint stock_movements_unit_cost_range
    check (unit_cost_cents is null or unit_cost_cents between 0 and 10000000000),
  constraint stock_movements_reason_length check (coalesce(char_length(reason), 0) <= 500),

  -- Sign follows type, the same shape cash_movements_sign_by_type (Phase
  -- 14) uses. `adjustment`/`return`/`transfer` are unconstrained: an
  -- adjustment or a return can correct stock in either direction, and a
  -- transfer's two rows are opposite by construction, not by a single
  -- row's own sign.
  constraint stock_movements_sign_by_type check (
    (type = 'purchase' and quantity > 0)
    or (type = 'sale' and quantity < 0)
    or (type = 'waste' and quantity < 0)
    or (type in ('adjustment', 'return', 'transfer'))
  ),

  -- Each type-specific reference exists iff its type is what needs it -
  -- the same "both directions matter" shape orders_cancel_fields (Phase
  -- 13) uses.
  constraint stock_movements_purchase_fields check (
    (type = 'purchase') = (purchase_id is not null)
    and (type = 'purchase') = (unit_cost_cents is not null)
  ),
  constraint stock_movements_sale_fields check (
    (type = 'sale') = (order_id is not null)
    and (type = 'sale') = (order_item_id is not null)
  ),
  constraint stock_movements_transfer_fields check (
    (type = 'transfer') = (transfer_group_id is not null)
  )
);

comment on table public.stock_movements is
  'Append-only, signed ledger of every stock change. Current stock is always the sum of this table (see inventory_stock_levels below), never a resting column.';
comment on column public.stock_movements.order_id is
  'Set only for type=sale, written exclusively by the order-completion trigger (never a client).';

create index stock_movements_item_location_idx
  on public.stock_movements (inventory_item_id, location_id);
create index stock_movements_tenant_created_idx
  on public.stock_movements (tenant_id, created_at);
create index stock_movements_purchase_idx
  on public.stock_movements (purchase_id)
  where purchase_id is not null;
create index stock_movements_order_idx
  on public.stock_movements (order_id)
  where order_id is not null;

-- No updated_at, and no trigger for one, matching cash_movements/
-- order_status_history: this is a ledger, and nothing in it is ever
-- updated once written.

-- ---------------------------------------------------------------------------
-- Deriving the tenant, and refusing a cross-tenant reference
-- ---------------------------------------------------------------------------

create or replace function public.derive_stock_movement_tenant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item_tenant     uuid;
  v_location_tenant uuid;
  v_purchase_tenant uuid;
  v_order_tenant    uuid;
begin
  select ii.tenant_id into v_item_tenant
  from public.inventory_items as ii
  where ii.id = new.inventory_item_id;

  if v_item_tenant is null then
    raise exception 'Inventory item not found.' using errcode = 'P0002';
  end if;

  select l.tenant_id into v_location_tenant
  from public.locations as l
  where l.id = new.location_id;

  if v_location_tenant is null or v_location_tenant <> v_item_tenant then
    raise exception 'That location belongs to a different business.'
      using errcode = '23514';
  end if;

  new.tenant_id := v_item_tenant;

  if new.purchase_id is not null then
    select p.tenant_id into v_purchase_tenant
    from public.purchases as p
    where p.id = new.purchase_id;

    if v_purchase_tenant is null or v_purchase_tenant <> v_item_tenant then
      raise exception 'That purchase belongs to a different business.'
        using errcode = '23514';
    end if;
  end if;

  if new.order_id is not null then
    select o.tenant_id into v_order_tenant
    from public.orders as o
    where o.id = new.order_id;

    if v_order_tenant is null or v_order_tenant <> v_item_tenant then
      raise exception 'That order belongs to a different business.'
        using errcode = '23514';
    end if;
  end if;

  new.created_by := coalesce(new.created_by, (select auth.uid()));

  return new;
end;
$$;

comment on function public.derive_stock_movement_tenant() is
  'Derives tenant_id from the inventory item, and refuses a location/purchase/order that belongs to a different business.';

create trigger stock_movements_derive_tenant
  before insert on public.stock_movements
  for each row execute function public.derive_stock_movement_tenant();

-- ---------------------------------------------------------------------------
-- Keeping a purchase's own total in step (ADR-022 decision 2)
-- ---------------------------------------------------------------------------

create or replace function public.recompute_purchase_total()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.purchase_id is null then
    return null;
  end if;

  update public.purchases as p
  set total_cost_cents = coalesce((
    select round(sum(m.quantity * m.unit_cost_cents))::bigint
    from public.stock_movements as m
    where m.purchase_id = new.purchase_id
  ), 0)
  where p.id = new.purchase_id;

  return null;
end;
$$;

comment on function public.recompute_purchase_total() is
  'Recomputes purchases.total_cost_cents from its own stock_movements rows. Never sent by a client.';

create trigger stock_movements_recompute_purchase_total
  after insert on public.stock_movements
  for each row execute function public.recompute_purchase_total();

-- ---------------------------------------------------------------------------
-- Current stock, derived - never stored (ADR-022 decision 1)
-- ---------------------------------------------------------------------------

-- `security_invoker = true`: without it, a view runs as its OWNER (the
-- migration role), not the querying user, and would bypass the RLS this
-- phase relies on entirely - a view is the one place in this schema RLS
-- is not automatic by default, so it is stated here explicitly rather
-- than assumed.
create view public.inventory_stock_levels
  with (security_invoker = true) as
select
  m.tenant_id,
  m.inventory_item_id,
  m.location_id,
  sum(m.quantity) as quantity_on_hand
from public.stock_movements as m
group by m.tenant_id, m.inventory_item_id, m.location_id;

comment on view public.inventory_stock_levels is
  'Current stock per item per location, summed live from stock_movements. Never a stored value (ADR-022).';

grant select on public.inventory_stock_levels to authenticated;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.stock_movements enable row level security;

create policy stock_movements_select_member
  on public.stock_movements for select to authenticated
  using (public.has_permission(tenant_id, 'inventory.view'));

-- `purchase` needs purchases.create; the four hand-entered types need
-- inventory.manage; `sale` matches NEITHER branch and is therefore
-- refused for every direct caller - only the SECURITY DEFINER trigger the
-- next migration adds (which bypasses RLS entirely, the same way
-- record_payment_cash_movement writes a `sale` cash_movements row,
-- Phase 14) may ever produce one.
create policy stock_movements_insert_operator
  on public.stock_movements for insert to authenticated
  with check (
    (type = 'purchase' and public.has_permission(tenant_id, 'purchases.create'))
    or (
      type in ('adjustment', 'waste', 'return', 'transfer')
      and public.has_permission(tenant_id, 'inventory.manage')
    )
  );

-- No UPDATE, no DELETE. The ledger is append-only, like cash_movements
-- and order_status_history.
