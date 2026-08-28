-- Phase 18 - Inventory
-- New permissions this phase needs.
--
-- SPEC: docs/specs/phase-18-inventory.md section 6.
-- CLOVERCODE_MASTER.md section 33 (Phase 18).
--
-- Three resources, the same three-way split Phase 14 drew between
-- `payments`/`payment_methods`/`cash`: what happens day to day
-- (`inventory`, items/units/recipes/manual movements), who supplies it
-- (`suppliers`), and buying it (`purchases`, view+create only - there is
-- no separate "manage" because a purchase is never edited or cancelled
-- once recorded, ADR-022 decision 2; a bad delivery is corrected with a
-- new `return`/`waste` movement, not a change to the purchase itself).
--
-- Owner and admin do NOT inherit new permissions automatically (the same
-- fact every phase since 03 has had to remember): owner got a snapshot of
-- the catalogue as it stood in Phase 03, and admin never inherits at all.

insert into public.permissions (code, resource, action, description) values
  ('inventory.view',   'inventory', 'view',   'Ver insumos, unidades, recetas y movimientos de stock.'),
  ('inventory.manage', 'inventory', 'manage', 'Crear insumos y unidades, definir recetas, registrar ajustes/mermas/devoluciones/traslados.'),
  ('suppliers.view',   'suppliers', 'view',   'Ver proveedores.'),
  ('suppliers.manage', 'suppliers', 'manage', 'Crear y editar proveedores.'),
  ('purchases.view',   'purchases', 'view',   'Ver compras registradas.'),
  ('purchases.create', 'purchases', 'create', 'Registrar una compra.');

insert into public.role_permissions (role, permission) values
  ('owner', 'inventory.view'), ('owner', 'inventory.manage'),
  ('owner', 'suppliers.view'), ('owner', 'suppliers.manage'),
  ('owner', 'purchases.view'), ('owner', 'purchases.create'),

  ('admin', 'inventory.view'), ('admin', 'inventory.manage'),
  ('admin', 'suppliers.view'), ('admin', 'suppliers.manage'),
  ('admin', 'purchases.view'), ('admin', 'purchases.create'),

  -- manager: "supervisa operaciones, catalogo, caja y reportes" (already its
  -- role description) - inventory is exactly that, day to day.
  ('manager', 'inventory.view'), ('manager', 'inventory.manage'),
  ('manager', 'suppliers.view'), ('manager', 'suppliers.manage'),
  ('manager', 'purchases.view'), ('manager', 'purchases.create'),

  -- accountant: reads cost data, writes nothing operational - the same
  -- posture it already holds toward payments/cash.
  ('accountant', 'inventory.view'),
  ('accountant', 'purchases.view');

-- cashier, waiter, kitchen, delivery: nothing. None of them touch cash.manage
-- or payment_methods.manage either (Phase 14) - inventory is the same kind
-- of back-of-house configuration, not a floor task.
