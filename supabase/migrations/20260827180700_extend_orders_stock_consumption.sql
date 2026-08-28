-- Phase 18 - Inventory
-- What completing an order actually consumes.
--
-- SPEC: docs/specs/phase-18-inventory.md sections 8, 11, 14.
-- CLOVERCODE_MASTER.md section 33 (Phase 18).
-- ADR-022 decision 3: fires exactly once, at `completed` - the one
-- terminal status `order_transitions` (Phase 13) gives no outgoing edge
-- at all, so a cancellation from any earlier status never needs this
-- reversed. A line with no product, or a product with no ACTIVE recipe,
-- contributes nothing - never an error, since most menu items will not
-- have a recipe defined on day one.
--
-- Relies entirely on stock_movements' own BEFORE INSERT trigger
-- (derive_stock_movement_tenant, previous migration) to derive tenant_id
-- and validate every reference - nothing here re-derives that logic.

create or replace function public.consume_recipe_stock_on_completion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.stock_movements
    (inventory_item_id, location_id, type, quantity, order_id, order_item_id, created_by)
  select
    ri.inventory_item_id,
    new.location_id,
    'sale'::public.stock_movement_type,
    -(ri.quantity * oi.quantity),
    new.id,
    oi.id,
    (select auth.uid())
  from public.order_items as oi
  join public.recipes as r
    on r.product_id = oi.product_id and r.is_active
  join public.recipe_items as ri
    on ri.recipe_id = r.id
  where oi.order_id = new.id;

  return null;
end;
$$;

comment on function public.consume_recipe_stock_on_completion() is
  'Writes one sale stock_movements row per recipe_item of every order line whose product has an active recipe, when an order reaches completed. A line with no product or no active recipe contributes nothing (ADR-022).';

create trigger orders_consume_recipe_stock
  after update of status on public.orders
  for each row
  when (new.status = 'completed' and old.status is distinct from 'completed')
  execute function public.consume_recipe_stock_on_completion();
