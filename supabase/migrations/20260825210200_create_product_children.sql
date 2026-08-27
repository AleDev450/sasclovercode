-- Phase 11 - Catalog
-- Images, variants and options.
--
-- SPEC: docs/specs/phase-11-catalog.md sections 8, 10, 11.
--
-- All three hang off a product and all three carry `tenant_id` denormalised,
-- maintained by a trigger. Same reasoning as `location_hours` in Phase 10:
-- without it every policy here would have to join `products` to learn whose row
-- it is, and a policy that needs a join is harder to audit and slower to run.
--
-- The trigger is also a security control, not just a convenience. See the
-- header of `sync_product_child_tenant` below.

-- ---------------------------------------------------------------------------
-- product_images
-- ---------------------------------------------------------------------------

create table public.product_images (
  id         uuid        not null default gen_random_uuid(),
  product_id uuid        not null,
  tenant_id  uuid        not null,
  -- The PATH inside the bucket, never a URL. The bucket is private (Phase 06),
  -- so the URL is signed at render time; a stored URL would expire in the row.
  path       text        not null,
  alt_text   text,
  position   smallint    not null default 0,
  is_primary boolean     not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint product_images_pkey primary key (id),
  constraint product_images_product_id_fkey
    foreign key (product_id) references public.products (id) on delete cascade,
  constraint product_images_tenant_id_fkey
    foreign key (tenant_id) references public.tenants (id) on delete cascade,

  -- The path must point at THIS tenant's own folder.
  --
  -- Checking only the shape let an owner store a path into another business's
  -- folder (Phase 06 audit, A6-2). They could not read it, so it rendered as a
  -- broken image rather than a leak - but a cross-tenant reference should not
  -- be storable at all, and a CHECK can compare against another column of the
  -- same row.
  constraint product_images_path_own_tenant check (
    path ~ ('^tenants/' || tenant_id::text || '/products/')
  ),
  constraint product_images_alt_length check (coalesce(char_length(alt_text), 0) <= 200),
  constraint product_images_position_range check (position between 0 and 100)
);

comment on table public.product_images is
  'Photos of a product. Storage paths, never URLs: the bucket is private.';

-- At most one primary image per product. A partial unique index says it
-- declaratively; without it "the main photo" would be whichever row happened to
-- sort first, and the answer could change between two page loads.
create unique index product_images_one_primary_per_product
  on public.product_images (product_id)
  where is_primary;

create index product_images_product_position_idx
  on public.product_images (product_id, position);

create trigger product_images_set_updated_at
  before update on public.product_images
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- product_variants
-- ---------------------------------------------------------------------------

create table public.product_variants (
  id          uuid        not null default gen_random_uuid(),
  product_id  uuid        not null,
  tenant_id   uuid        not null,
  name        text        not null,
  sku         text,
  -- An ABSOLUTE price, not a delta on the product.
  --
  -- A delta means reading two rows to know what something costs, and Phase 13
  -- has to store a price snapshot on every order line: storing the number that
  -- gets charged is simpler than storing a subtraction that has to be redone.
  price_cents bigint      not null default 0,
  is_active   boolean     not null default true,
  position    smallint    not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint product_variants_pkey primary key (id),
  constraint product_variants_product_id_fkey
    foreign key (product_id) references public.products (id) on delete cascade,
  constraint product_variants_tenant_id_fkey
    foreign key (tenant_id) references public.tenants (id) on delete cascade,

  constraint product_variants_name_length check (char_length(btrim(name)) between 1 and 120),
  constraint product_variants_sku_length check (
    sku is null or char_length(btrim(sku)) between 1 and 60
  ),
  constraint product_variants_price_range check (price_cents between 0 and 10000000000),
  constraint product_variants_position_range check (position between 0 and 1000)
);

comment on table public.product_variants is
  'Sizes, presentations. Absolute prices in minor units, not deltas.';

-- A SKU identifies a thing within ONE business's stock. Tenant-scoped, as
-- master section 33 requires, and case-insensitive because a SKU typed in two
-- cases is one SKU to the person holding the box.
create unique index product_variants_tenant_sku_key
  on public.product_variants (tenant_id, lower(btrim(sku)))
  where sku is not null;

create unique index product_variants_product_name_key
  on public.product_variants (product_id, lower(btrim(name)));

create index product_variants_product_idx on public.product_variants (product_id);

create trigger product_variants_set_updated_at
  before update on public.product_variants
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- product_options
-- ---------------------------------------------------------------------------

create table public.product_options (
  id                uuid        not null default gen_random_uuid(),
  product_id        uuid        not null,
  tenant_id         uuid        not null,
  -- The group this option belongs to: "Extras", "Termino de coccion".
  --
  -- Repeated on every row rather than normalised into a groups table, because
  -- master section 33 asks for `product_options` and not for
  -- `product_option_groups`. What is NOT here as a consequence: whether a group
  -- is required, and how many choices it allows. Those are properties of the
  -- GROUP, not of an option, and putting them on option rows would let two rows
  -- of one group disagree about their own group. They arrive in Phase 13, which
  -- is the first phase that has to validate a selection.
  group_label       text        not null,
  name              text        not null,
  -- Signed: an option may subtract (a smaller portion) as well as add.
  price_delta_cents bigint      not null default 0,
  is_active         boolean     not null default true,
  position          smallint    not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint product_options_pkey primary key (id),
  constraint product_options_product_id_fkey
    foreign key (product_id) references public.products (id) on delete cascade,
  constraint product_options_tenant_id_fkey
    foreign key (tenant_id) references public.tenants (id) on delete cascade,

  constraint product_options_group_length check (
    char_length(btrim(group_label)) between 1 and 80
  ),
  constraint product_options_name_length check (char_length(btrim(name)) between 1 and 120),
  -- Bounded on both sides. A delta of minus ten thousand soles is not a
  -- discount, it is a way to drive a Phase 13 total negative.
  constraint product_options_delta_range check (
    price_delta_cents between -1000000 and 1000000
  ),
  constraint product_options_position_range check (position between 0 and 1000)
);

comment on table public.product_options is
  'Modifiers and add-ons. One table, with the group label repeated per row.';

create unique index product_options_product_group_name_key
  on public.product_options (product_id, lower(btrim(group_label)), lower(btrim(name)));

create index product_options_product_group_idx
  on public.product_options (product_id, group_label, position);

create trigger product_options_set_updated_at
  before update on public.product_options
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- tenant_id is derived, never trusted
-- ---------------------------------------------------------------------------

-- Overwrites whatever the caller sent with the product's real tenant.
--
-- The attack this closes (SPEC AB-1101, and the same shape as Phase 10's
-- AB-1002): a caller supplies a `product_id` belonging to another business
-- together with their OWN tenant_id. The insert policy checks the permission
-- against the tenant_id in the row - which they do hold - and the row lands
-- attached to somebody else's product. Deriving the value makes the two
-- impossible to disagree, so the policy then checks the tenant that actually
-- owns the parent.
--
-- One function for the three child tables: the rule is identical, and three
-- copies would be three places for it to drift.
create or replace function public.sync_product_child_tenant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select p.tenant_id into new.tenant_id
  from public.products as p
  where p.id = new.product_id;

  if new.tenant_id is null then
    raise exception 'Product not found.' using errcode = 'P0002';
  end if;

  return new;
end;
$$;

comment on function public.sync_product_child_tenant() is
  'Derives tenant_id from the parent product so the two can never disagree.';

create trigger product_images_sync_tenant
  before insert or update of product_id on public.product_images
  for each row execute function public.sync_product_child_tenant();

create trigger product_variants_sync_tenant
  before insert or update of product_id on public.product_variants
  for each row execute function public.sync_product_child_tenant();

create trigger product_options_sync_tenant
  before insert or update of product_id on public.product_options
  for each row execute function public.sync_product_child_tenant();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.product_images enable row level security;
alter table public.product_variants enable row level security;
alter table public.product_options enable row level security;

-- Member reads, one per table, all on `products.view`.
create policy product_images_select_member
  on public.product_images for select to authenticated
  using (public.has_permission(tenant_id, 'products.view'));

create policy product_variants_select_member
  on public.product_variants for select to authenticated
  using (public.has_permission(tenant_id, 'products.view'));

create policy product_options_select_member
  on public.product_options for select to authenticated
  using (public.has_permission(tenant_id, 'products.view'));

-- Public reads follow the PARENT's visibility, not their own.
--
-- Checking only `is_active` on the child would publish the variants of a draft
-- product to anyone who asked for them directly - which is how a competitor
-- reads next month's prices. This is the same shape as `page_sections` in
-- Phase 07.
create policy product_images_select_public
  on public.product_images for select to anon, authenticated
  using (
    public.is_tenant_public(tenant_id)
    and exists (
      select 1 from public.products as p
      where p.id = product_id and p.status = 'active'
    )
  );

create policy product_variants_select_public
  on public.product_variants for select to anon, authenticated
  using (
    is_active
    and public.is_tenant_public(tenant_id)
    and exists (
      select 1 from public.products as p
      where p.id = product_id and p.status = 'active'
    )
  );

create policy product_options_select_public
  on public.product_options for select to anon, authenticated
  using (
    is_active
    and public.is_tenant_public(tenant_id)
    and exists (
      select 1 from public.products as p
      where p.id = product_id and p.status = 'active'
    )
  );

-- Writes. `for all` covers insert, update and delete, which for these three is
-- right: unlike the rows a trigger guarantees elsewhere in this system (Phase
-- 06 A6-1), an image or a variant is ordinary user data with nothing to protect
-- it from its own owner.
create policy product_images_write_manager
  on public.product_images for all to authenticated
  using (public.has_permission(tenant_id, 'products.update'))
  with check (public.has_permission(tenant_id, 'products.update'));

create policy product_variants_write_manager
  on public.product_variants for all to authenticated
  using (public.has_permission(tenant_id, 'products.update'))
  with check (public.has_permission(tenant_id, 'products.update'));

create policy product_options_write_manager
  on public.product_options for all to authenticated
  using (public.has_permission(tenant_id, 'products.update'))
  with check (public.has_permission(tenant_id, 'products.update'));
