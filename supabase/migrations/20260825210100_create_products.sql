-- Phase 11 - Catalog
-- What the business sells.
--
-- SPEC: docs/specs/phase-11-catalog.md sections 8, 10, 11.
-- CLOVERCODE_MASTER.md sections 11, 33 (Phase 11), 39.

-- Editorial state, which is not the same thing as being available today.
--
-- `draft`    being written; the public does not see it
-- `active`   published
-- `archived` no longer sold; kept because past orders point at it
--
-- Archived and not deleted, for the reason locations are deactivated rather
-- than deleted (Phase 10): from Phase 13 an order line references a product,
-- and a business is required to keep its sales records.
create type public.product_status as enum ('draft', 'active', 'archived');

create table public.products (
  id               uuid                  not null default gen_random_uuid(),
  tenant_id        uuid                  not null,
  -- Optional. A small shop with twelve products does not need categories, and
  -- forcing one would mean inventing a "General" nobody asked for.
  category_id      uuid,
  name             text                  not null,
  slug             text                  not null,
  description      text,

  -- MONEY: an integer in the currency's minor unit. S/ 24.90 is 2490.
  --
  -- Master section 39 forbids floating point and asks for a documented
  -- strategy; this is it, and ADR-015 has the reasoning. The short version is
  -- that `numeric` is exact in PostgreSQL and stops being exact the moment
  -- PostgREST serialises it as a JSON number and JavaScript parses it into a
  -- double. An integer cannot become a float on the way out.
  --
  -- The CURRENCY is not here. It lives once per business in
  -- `tenant_settings.currency` (Phase 06): a tenant transacts in one currency,
  -- and repeating it per row is a chance for two rows to disagree.
  base_price_cents bigint                not null default 0,

  status           public.product_status not null default 'draft',

  -- Available TODAY, which is a different question from published.
  --
  -- The classic mistake in a restaurant catalogue is one boolean for both. A
  -- kitchen that runs out of fish at three o'clock would have to unpublish the
  -- dish and republish it tomorrow, and the system would lose the difference
  -- between "we stopped selling this" and "today it ran out" - which is exactly
  -- the difference a customer and a report both care about.
  is_available     boolean               not null default true,

  is_featured      boolean               not null default false,
  position         smallint              not null default 0,
  created_at       timestamptz           not null default now(),
  updated_at       timestamptz           not null default now(),

  constraint products_pkey primary key (id),
  constraint products_tenant_id_fkey
    foreign key (tenant_id) references public.tenants (id) on delete cascade,

  -- ON DELETE SET NULL, not CASCADE. Deleting a category is a decision about
  -- how things are grouped; it must never delete the things themselves.
  constraint products_category_id_fkey
    foreign key (category_id) references public.categories (id) on delete set null,

  -- The constraint master section 33 spells out by name.
  constraint products_tenant_slug_key unique (tenant_id, slug),

  constraint products_slug_format check (slug ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?$'),
  constraint products_slug_length check (char_length(slug) between 1 and 100),
  constraint products_name_length check (char_length(btrim(name)) between 1 and 200),
  constraint products_description_length check (
    coalesce(char_length(description), 0) <= 2000
  ),

  -- Zero is valid: a sauce, a glass of water, a sample. Negative is not - it
  -- would make a Phase 13 total go backwards.
  constraint products_price_range check (base_price_cents between 0 and 10000000000),
  constraint products_position_range check (position between 0 and 1000)
);

comment on table public.products is
  'What a business sells. Prices are integers in the minor unit (ADR-015).';
comment on column public.products.base_price_cents is
  'Minor units: 2490 is S/ 24.90. Never a float, at any layer.';
comment on column public.products.is_available is
  'Available today. Independent of `status`, which is editorial.';

-- The index master section 8 names explicitly: `tenant_id + category_id`.
create index products_tenant_category_idx
  on public.products (tenant_id, category_id);

-- The public menu and the dashboard list both ask for products of one tenant in
-- one state.
create index products_tenant_status_idx
  on public.products (tenant_id, status, position);

create trigger products_set_updated_at
  before update on public.products
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- A product's category belongs to the same tenant
-- ---------------------------------------------------------------------------

-- Two foreign keys to two tables that each carry a tenant is a place where the
-- two can disagree: nothing in the schema stops a product of tenant A pointing
-- at a category of tenant B, and RLS would not catch it either - the caller has
-- permission on the row they are writing.
--
-- The consequence would be a menu that renders another company's grouping.
create or replace function public.guard_product_category_tenant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_category_tenant uuid;
begin
  if new.category_id is null then
    return new;
  end if;

  select c.tenant_id into v_category_tenant
  from public.categories as c
  where c.id = new.category_id;

  if v_category_tenant is null or v_category_tenant <> new.tenant_id then
    raise exception 'That category belongs to a different business.'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

comment on function public.guard_product_category_tenant() is
  'Refuses a product whose category belongs to another tenant.';

create trigger products_guard_category_tenant
  before insert or update of category_id, tenant_id on public.products
  for each row execute function public.guard_product_category_tenant();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.products enable row level security;

-- Members see everything, drafts included: the person writing the catalogue has
-- to be able to see what they are writing.
create policy products_select_member
  on public.products for select to authenticated
  using (public.has_permission(tenant_id, 'products.view'));

-- Public: published products of active businesses.
--
-- `is_available` is deliberately NOT part of this. A dish that ran out today
-- still belongs on the menu, marked as unavailable - hiding it would tell a
-- customer the restaurant does not serve ceviche at all.
create policy products_select_public
  on public.products for select to anon, authenticated
  using (status = 'active' and public.is_tenant_public(tenant_id));

create policy products_insert_manager
  on public.products for insert to authenticated
  with check (public.has_permission(tenant_id, 'products.create'));

create policy products_update_manager
  on public.products for update to authenticated
  using (public.has_permission(tenant_id, 'products.update'))
  with check (public.has_permission(tenant_id, 'products.update'));

create policy products_delete_manager
  on public.products for delete to authenticated
  using (public.has_permission(tenant_id, 'products.delete'));
