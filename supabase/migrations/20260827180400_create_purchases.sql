-- Phase 18 - Inventory
-- A receipt: stock that physically arrived, from one supplier, at one
-- location.
--
-- SPEC: docs/specs/phase-18-inventory.md sections 8, 11.
-- CLOVERCODE_MASTER.md section 33 (Phase 18).
-- ADR-022 decision 2: a purchase is written once, at the moment stock
-- arrives, and never changes state afterward - no draft/ordered/received
-- workflow, no cancellation. A bad delivery is corrected with a NEW
-- `waste`/`return` stock movement (next-next migration), not by editing
-- this row. There is deliberately no `purchase_items` table: each line
-- bought is one `stock_movements` row of type `purchase`, carrying its
-- own quantity and unit_cost_cents - this table only holds what is true
-- of the RECEIPT as a whole.

create table public.purchases (
  id               uuid        not null default gen_random_uuid(),
  tenant_id        uuid        not null,
  supplier_id      uuid        not null,
  location_id      uuid        not null,

  -- An invoice or receipt number, whatever the supplier issued - free text,
  -- never validated against a format, because every supplier's own scheme
  -- is different (the same reasoning as inventory_items.sku).
  reference        text,
  purchased_at     timestamptz not null default now(),
  notes            text,

  -- Summed by trigger from this purchase's own `stock_movements` rows
  -- (next-next migration) - never sent by a client, the same posture
  -- Phase 13 takes toward `orders.total_cents`.
  total_cost_cents bigint      not null default 0,

  created_by       uuid,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint purchases_pkey primary key (id),
  constraint purchases_tenant_id_fkey
    foreign key (tenant_id) references public.tenants (id) on delete cascade,
  -- RESTRICT: a purchase is a financial/inventory record. A supplier or a
  -- location is deactivated, never deleted, so this never actually fires.
  constraint purchases_supplier_id_fkey
    foreign key (supplier_id) references public.suppliers (id) on delete restrict,
  constraint purchases_location_id_fkey
    foreign key (location_id) references public.locations (id) on delete restrict,
  constraint purchases_created_by_fkey
    foreign key (created_by) references auth.users (id) on delete set null,

  constraint purchases_reference_length check (coalesce(char_length(reference), 0) <= 120),
  constraint purchases_notes_length check (coalesce(char_length(notes), 0) <= 1000),
  constraint purchases_total_cost_range
    check (total_cost_cents between 0 and 10000000000)
);

comment on table public.purchases is
  'A receipt: stock that arrived, from one supplier, at one location, on one occasion. Immutable once written (ADR-022).';
comment on column public.purchases.total_cost_cents is
  'Summed by trigger from this purchase''s own stock_movements. Never sent by a client.';

create index purchases_tenant_supplier_idx on public.purchases (tenant_id, supplier_id);
create index purchases_tenant_location_idx on public.purchases (tenant_id, location_id);
create index purchases_tenant_purchased_idx on public.purchases (tenant_id, purchased_at);

create trigger purchases_set_updated_at
  before update on public.purchases
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- A purchase's supplier and location belong to the same tenant
-- ---------------------------------------------------------------------------

create or replace function public.guard_purchase_tenant_refs()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_supplier_tenant uuid;
  v_location_tenant uuid;
begin
  select s.tenant_id into v_supplier_tenant
  from public.suppliers as s
  where s.id = new.supplier_id;

  if v_supplier_tenant is null or v_supplier_tenant <> new.tenant_id then
    raise exception 'That supplier belongs to a different business.'
      using errcode = '23514';
  end if;

  select l.tenant_id into v_location_tenant
  from public.locations as l
  where l.id = new.location_id;

  if v_location_tenant is null or v_location_tenant <> new.tenant_id then
    raise exception 'That location belongs to a different business.'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

comment on function public.guard_purchase_tenant_refs() is
  'Refuses a purchase whose supplier or location belongs to another tenant.';

create trigger purchases_guard_tenant_refs
  before insert or update of supplier_id, location_id, tenant_id on public.purchases
  for each row execute function public.guard_purchase_tenant_refs();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.purchases enable row level security;

create policy purchases_select_viewer
  on public.purchases for select to authenticated
  using (public.has_permission(tenant_id, 'purchases.view'));

create policy purchases_insert_creator
  on public.purchases for insert to authenticated
  with check (public.has_permission(tenant_id, 'purchases.create'));

-- No UPDATE policy for a direct caller: `total_cost_cents` is written only
-- by the SECURITY DEFINER trigger the next migration adds, which bypasses
-- RLS entirely - the same shape `order_items`' totals trigger uses against
-- `orders` (Phase 13). Nothing else on a purchase is ever meant to change.
-- No DELETE policy, ever - a receipt is a record of what arrived.
