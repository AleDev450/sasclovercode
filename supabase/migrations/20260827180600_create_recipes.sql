-- Phase 18 - Inventory
-- The bridge between what a business sells (products, Phase 11) and what
-- it consumes to make it (inventory_items).
--
-- SPEC: docs/specs/phase-18-inventory.md sections 8, 11.
-- CLOVERCODE_MASTER.md section 33 (Phase 18).
-- ADR-022 decision 5: a recipe_item's quantity is always in its
-- inventory_item's own unit - no conversion exists anywhere in this
-- schema.

create table public.recipes (
  id         uuid        not null default gen_random_uuid(),
  -- Derived by trigger from product_id, like order_items derives its
  -- tenant_id from its order (Phase 13).
  tenant_id  uuid        not null,
  -- One recipe per product. A product with none simply is not tracked -
  -- most menus will not have every item recipe'd on day one, and that is
  -- never an error (the completion trigger, next migration, treats "no
  -- active recipe" as "nothing to consume", not a failure).
  product_id uuid        not null,
  notes      text,
  -- Paused without losing its ingredient list - distinct from deleting it
  -- outright, which this table also permits (RLS, below).
  is_active  boolean     not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint recipes_pkey primary key (id),
  constraint recipes_tenant_id_fkey
    foreign key (tenant_id) references public.tenants (id) on delete cascade,
  constraint recipes_product_id_fkey
    foreign key (product_id) references public.products (id) on delete cascade,
  constraint recipes_product_id_key unique (product_id),

  constraint recipes_notes_length check (coalesce(char_length(notes), 0) <= 1000)
);

comment on table public.recipes is
  'What one unit of a product consumes, by inventory item. Inventory data (RLS gated on inventory.*), even though it points at a product.';

create trigger recipes_set_updated_at
  before update on public.recipes
  for each row execute function public.set_updated_at();

create or replace function public.derive_recipe_tenant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product_tenant uuid;
begin
  select p.tenant_id into v_product_tenant
  from public.products as p
  where p.id = new.product_id;

  if v_product_tenant is null then
    raise exception 'Product not found.' using errcode = 'P0002';
  end if;

  new.tenant_id := v_product_tenant;

  return new;
end;
$$;

comment on function public.derive_recipe_tenant() is
  'Derives tenant_id from the product a recipe belongs to.';

create trigger recipes_derive_tenant
  before insert or update of product_id on public.recipes
  for each row execute function public.derive_recipe_tenant();

-- ---------------------------------------------------------------------------
-- recipe_items
-- ---------------------------------------------------------------------------

create table public.recipe_items (
  id                 uuid          not null default gen_random_uuid(),
  recipe_id          uuid          not null,
  -- Derived by trigger from recipe_id.
  tenant_id          uuid          not null,
  inventory_item_id  uuid          not null,
  -- How much of inventory_item_id, in ITS OWN unit, one unit of the
  -- recipe's product consumes (ADR-022 decision 5 - no conversion).
  quantity           numeric(12,3) not null,
  position           smallint      not null default 0,
  created_at         timestamptz   not null default now(),

  constraint recipe_items_pkey primary key (id),
  constraint recipe_items_recipe_id_fkey
    foreign key (recipe_id) references public.recipes (id) on delete cascade,
  constraint recipe_items_tenant_id_fkey
    foreign key (tenant_id) references public.tenants (id) on delete cascade,
  -- RESTRICT: an inventory item is deactivated, never deleted, so this
  -- never actually fires.
  constraint recipe_items_inventory_item_id_fkey
    foreign key (inventory_item_id) references public.inventory_items (id) on delete restrict,

  -- One line per ingredient per recipe - the same "no duplicate cause"
  -- shape a unique index would give a form no reason to allow.
  constraint recipe_items_recipe_item_key unique (recipe_id, inventory_item_id),

  constraint recipe_items_quantity_positive check (quantity > 0 and quantity <= 100000),
  constraint recipe_items_position_range check (position between 0 and 1000)
);

comment on table public.recipe_items is
  'One ingredient line of a recipe. Quantity is always in the inventory_item''s own unit.';

create index recipe_items_recipe_position_idx
  on public.recipe_items (recipe_id, position);

create or replace function public.derive_recipe_item_tenant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_recipe_tenant uuid;
  v_item_tenant   uuid;
begin
  select r.tenant_id into v_recipe_tenant
  from public.recipes as r
  where r.id = new.recipe_id;

  if v_recipe_tenant is null then
    raise exception 'Recipe not found.' using errcode = 'P0002';
  end if;

  new.tenant_id := v_recipe_tenant;

  select ii.tenant_id into v_item_tenant
  from public.inventory_items as ii
  where ii.id = new.inventory_item_id;

  if v_item_tenant is null or v_item_tenant <> v_recipe_tenant then
    raise exception 'That inventory item belongs to a different business.'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

comment on function public.derive_recipe_item_tenant() is
  'Derives tenant_id from the recipe, and refuses an inventory item from a different business.';

create trigger recipe_items_derive_tenant
  before insert or update of recipe_id, inventory_item_id on public.recipe_items
  for each row execute function public.derive_recipe_item_tenant();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.recipes enable row level security;

create policy recipes_select_member
  on public.recipes for select to authenticated
  using (public.has_permission(tenant_id, 'inventory.view'));

create policy recipes_insert_manager
  on public.recipes for insert to authenticated
  with check (public.has_permission(tenant_id, 'inventory.manage'));

create policy recipes_update_manager
  on public.recipes for update to authenticated
  using (public.has_permission(tenant_id, 'inventory.manage'))
  with check (public.has_permission(tenant_id, 'inventory.manage'));

create policy recipes_delete_manager
  on public.recipes for delete to authenticated
  using (public.has_permission(tenant_id, 'inventory.manage'));

alter table public.recipe_items enable row level security;

create policy recipe_items_select_member
  on public.recipe_items for select to authenticated
  using (public.has_permission(tenant_id, 'inventory.view'));

create policy recipe_items_insert_manager
  on public.recipe_items for insert to authenticated
  with check (public.has_permission(tenant_id, 'inventory.manage'));

create policy recipe_items_update_manager
  on public.recipe_items for update to authenticated
  using (public.has_permission(tenant_id, 'inventory.manage'))
  with check (public.has_permission(tenant_id, 'inventory.manage'));

create policy recipe_items_delete_manager
  on public.recipe_items for delete to authenticated
  using (public.has_permission(tenant_id, 'inventory.manage'));
