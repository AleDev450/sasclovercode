-- Phase 18 - Inventory
-- What a business consumes to make what it sells - the pantry, not the menu.
--
-- SPEC: docs/specs/phase-18-inventory.md sections 8, 11.
-- CLOVERCODE_MASTER.md section 33 (Phase 18).
--
-- `products` (Phase 11) is what a business SELLS; this is what it BUYS and
-- CONSUMES to make that. Deliberately a separate table rather than a
-- column on `products`: a business tracks limes and rice whether or not
-- either is itself something a customer orders by name.

create table public.inventory_items (
  id         uuid        not null default gen_random_uuid(),
  tenant_id  uuid        not null,
  unit_id    uuid        not null,
  name       text        not null,
  -- An internal reference code, matched against a supplier's own catalogue
  -- or invoice - never shown to a customer, never validated against a
  -- format (unlike a product slug), because every business's own scheme
  -- is different.
  sku        text,
  is_active  boolean     not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint inventory_items_pkey primary key (id),
  constraint inventory_items_tenant_id_fkey
    foreign key (tenant_id) references public.tenants (id) on delete cascade,
  -- RESTRICT: a unit is deactivated, never deleted (previous migration), so
  -- this never actually fires - the declaration states what would happen
  -- if it could.
  constraint inventory_items_unit_id_fkey
    foreign key (unit_id) references public.units (id) on delete restrict,

  constraint inventory_items_name_length check (char_length(btrim(name)) between 1 and 200),
  constraint inventory_items_sku_length check (coalesce(char_length(sku), 0) <= 60)
);

comment on table public.inventory_items is
  'What a business tracks stock of - raw ingredients and supplies, not what it sells (that is products, Phase 11).';

create unique index inventory_items_tenant_name_key
  on public.inventory_items (tenant_id, lower(btrim(name)));

create index inventory_items_tenant_active_idx
  on public.inventory_items (tenant_id, is_active);

create trigger inventory_items_set_updated_at
  before update on public.inventory_items
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- An item's unit belongs to the same tenant
-- ---------------------------------------------------------------------------

create or replace function public.guard_inventory_item_unit_tenant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_unit_tenant uuid;
begin
  select u.tenant_id into v_unit_tenant
  from public.units as u
  where u.id = new.unit_id;

  if v_unit_tenant is null or v_unit_tenant <> new.tenant_id then
    raise exception 'That unit belongs to a different business.'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

comment on function public.guard_inventory_item_unit_tenant() is
  'Refuses an inventory item whose unit belongs to another tenant.';

create trigger inventory_items_guard_unit_tenant
  before insert or update of unit_id, tenant_id on public.inventory_items
  for each row execute function public.guard_inventory_item_unit_tenant();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.inventory_items enable row level security;

create policy inventory_items_select_member
  on public.inventory_items for select to authenticated
  using (public.has_permission(tenant_id, 'inventory.view'));

create policy inventory_items_insert_manager
  on public.inventory_items for insert to authenticated
  with check (public.has_permission(tenant_id, 'inventory.manage'));

create policy inventory_items_update_manager
  on public.inventory_items for update to authenticated
  using (public.has_permission(tenant_id, 'inventory.manage'))
  with check (public.has_permission(tenant_id, 'inventory.manage'));

-- No DELETE policy. `stock_movements` will reference an item (below);
-- `is_active = false` is how one stops being offered without breaking its
-- own history.
