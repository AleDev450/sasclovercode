-- Phase 11 - Catalog
-- How a business groups what it sells.
--
-- SPEC: docs/specs/phase-11-catalog.md sections 8, 10.
-- CLOVERCODE_MASTER.md sections 11, 33 (Phase 11).
--
-- Master section 33 says it for this phase in particular, because a catalogue
-- is where it is easiest to forget:
--
--   "Todas las restricciones deben ser tenant-aware.
--    UNIQUE(tenant_id, slug) - no UNIQUE(slug)."
--
-- A global unique on `slug` does not leak anything. It does something harder to
-- explain to a customer: it stops a restaurant creating a category called
-- `entradas` because another business, one they have never heard of, got there
-- first.

create table public.categories (
  id          uuid        not null default gen_random_uuid(),
  tenant_id   uuid        not null,
  name        text        not null,
  slug        text        not null,
  description text,
  position    smallint    not null default 0,
  is_active   boolean     not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint categories_pkey primary key (id),
  constraint categories_tenant_id_fkey
    foreign key (tenant_id) references public.tenants (id) on delete cascade,

  -- Tenant-scoped, as master section 33 demands. Two businesses may both have
  -- `entradas`, because those are two different menus.
  constraint categories_tenant_slug_key unique (tenant_id, slug),

  constraint categories_slug_format check (slug ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?$'),
  constraint categories_slug_length check (char_length(slug) between 1 and 80),
  constraint categories_name_length check (char_length(btrim(name)) between 1 and 120),
  constraint categories_description_length check (
    coalesce(char_length(description), 0) <= 500
  ),
  constraint categories_position_range check (position between 0 and 1000)
);

comment on table public.categories is
  'Groups of products. Slug is unique per tenant, never globally.';

-- Also unique by name, case-insensitively: two categories a person cannot tell
-- apart in a dropdown are two categories that will be filled inconsistently.
create unique index categories_tenant_name_key
  on public.categories (tenant_id, lower(btrim(name)));

-- Both the dashboard list and the public menu ask for "the active categories of
-- this tenant, in order".
create index categories_tenant_active_idx
  on public.categories (tenant_id, is_active, position);

create trigger categories_set_updated_at
  before update on public.categories
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.categories enable row level security;

-- Members read through `products.view`, which Phase 03 already grants to every
-- role that has to take an order. A category is not a separate capability from
-- the products in it.
create policy categories_select_member
  on public.categories for select to authenticated
  using (public.has_permission(tenant_id, 'products.view'));

-- Public: active categories of active businesses, to `anon` AND
-- `authenticated`. The second role is the lesson of the Phase 07 audit (A7-1):
-- a visitor who happens to be signed in to CloverCode is `authenticated`, and a
-- policy naming only `anon` makes the menu vanish for them.
create policy categories_select_public
  on public.categories for select to anon, authenticated
  using (is_active and public.is_tenant_public(tenant_id));

create policy categories_insert_manager
  on public.categories for insert to authenticated
  with check (public.has_permission(tenant_id, 'products.create'));

create policy categories_update_manager
  on public.categories for update to authenticated
  using (public.has_permission(tenant_id, 'products.update'))
  with check (public.has_permission(tenant_id, 'products.update'));

create policy categories_delete_manager
  on public.categories for delete to authenticated
  using (public.has_permission(tenant_id, 'products.delete'));
