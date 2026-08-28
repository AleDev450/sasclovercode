-- Phase 18 - Inventory
-- The units a business measures its stock in.
--
-- SPEC: docs/specs/phase-18-inventory.md sections 8, 11.
-- CLOVERCODE_MASTER.md section 33 (Phase 18).
-- ADR-022 decision 6: tenant-scoped, like `payment_methods` (Phase 14) -
-- a business can rename, add or deactivate its own units, but a default
-- set is seeded automatically so nobody has to visit a setup screen
-- before recording their first inventory item.

create table public.units (
  id           uuid        not null default gen_random_uuid(),
  tenant_id    uuid        not null,
  name         text        not null,
  abbreviation text        not null,
  is_active    boolean     not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint units_pkey primary key (id),
  constraint units_tenant_id_fkey
    foreign key (tenant_id) references public.tenants (id) on delete cascade,

  constraint units_name_length check (char_length(btrim(name)) between 1 and 60),
  constraint units_abbreviation_length check (char_length(btrim(abbreviation)) between 1 and 10)
);

comment on table public.units is
  'Units of measure a business tracks stock in (kg, l, unidad, ...). Tenant-scoped, seeded with a default set.';

-- Case-insensitive per tenant, the same shape locations_tenant_name_key
-- (Phase 10) uses: two units abbreviated "kg" and "KG" would be two rows
-- nobody could tell apart in a dropdown.
create unique index units_tenant_abbreviation_key
  on public.units (tenant_id, lower(btrim(abbreviation)));

create index units_tenant_active_idx on public.units (tenant_id, is_active);

create trigger units_set_updated_at
  before update on public.units
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Every tenant gets a starter set, new or existing
-- ---------------------------------------------------------------------------

insert into public.units (tenant_id, name, abbreviation)
select t.id, defaults.name, defaults.abbreviation
from public.tenants as t
cross join (
  values
    ('Kilogramo', 'kg'),
    ('Gramo', 'g'),
    ('Litro', 'l'),
    ('Mililitro', 'ml'),
    ('Unidad', 'unidad')
) as defaults (name, abbreviation)
where not exists (
  select 1 from public.units as u
  where u.tenant_id = t.id and lower(btrim(u.abbreviation)) = lower(defaults.abbreviation)
);

create or replace function public.create_tenant_defaults()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.tenant_settings (tenant_id, trade_name)
  values (new.id, new.name)
  on conflict (tenant_id) do nothing;

  insert into public.tenant_themes (tenant_id)
  values (new.id)
  on conflict (tenant_id) do nothing;

  insert into public.tenant_seo (tenant_id)
  values (new.id)
  on conflict (tenant_id) do nothing;

  insert into public.locations (tenant_id, name)
  values (new.id, new.name)
  on conflict (tenant_id, lower(btrim(name))) do nothing;

  insert into public.billing_provider_configs (tenant_id)
  values (new.id)
  on conflict (tenant_id) do nothing;

  -- Added in Phase 18.
  insert into public.units (tenant_id, name, abbreviation)
  values
    (new.id, 'Kilogramo', 'kg'),
    (new.id, 'Gramo', 'g'),
    (new.id, 'Litro', 'l'),
    (new.id, 'Mililitro', 'ml'),
    (new.id, 'Unidad', 'unidad')
  on conflict (tenant_id, lower(btrim(abbreviation))) do nothing;

  return new;
end;
$$;

comment on function public.create_tenant_defaults() is
  'Gives every new tenant its settings, theme, SEO row, first location, billing config and starter units, however it was created.';

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.units enable row level security;

create policy units_select_member
  on public.units for select to authenticated
  using (public.has_permission(tenant_id, 'inventory.view'));

create policy units_insert_manager
  on public.units for insert to authenticated
  with check (public.has_permission(tenant_id, 'inventory.manage'));

create policy units_update_manager
  on public.units for update to authenticated
  using (public.has_permission(tenant_id, 'inventory.manage'))
  with check (public.has_permission(tenant_id, 'inventory.manage'));

-- No DELETE policy. `inventory_items` will reference a unit (next
-- migration); deactivating is how a unit stops being offered without
-- breaking an item that already uses it.
