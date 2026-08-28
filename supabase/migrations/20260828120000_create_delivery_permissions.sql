-- Phase 19 - Delivery
-- New permissions this phase needs.
--
-- SPEC: docs/specs/phase-19-delivery.md section 11.
-- CLOVERCODE_MASTER.md section 33 (Phase 19).
--
-- Two resources, the same split every phase since 14 has drawn between
-- configuration and operation: `delivery_zones` is what a business sets up
-- once (where it delivers and what it charges), `deliveries` is what happens
-- all day (attach one to an order, assign a rider, move it along).
--
-- The split matters more here than usual because of who holds each side. A
-- rider needs to advance a delivery and must not be able to rewrite the price
-- list; a cashier needs to read the zones in order to attach a delivery and
-- has no business editing them either.
--
-- Owner and admin do NOT inherit new permissions automatically - the same fact
-- every phase since 03 has had to remember: owner got a snapshot of the
-- catalogue as it stood in Phase 03, and admin never inherits at all.

insert into public.permissions (code, resource, action, description) values
  ('delivery_zones.view',   'delivery_zones', 'view',   'Ver zonas de reparto y sus tarifas.'),
  ('delivery_zones.manage', 'delivery_zones', 'manage', 'Crear y editar zonas de reparto y tarifas.'),
  ('deliveries.view',       'deliveries',     'view',   'Ver el tablero de entregas.'),
  ('deliveries.manage',     'deliveries',     'manage', 'Adjuntar entregas, asignar repartidor y avanzar su estado.');

insert into public.role_permissions (role, permission) values
  ('owner', 'delivery_zones.view'), ('owner', 'delivery_zones.manage'),
  ('owner', 'deliveries.view'),     ('owner', 'deliveries.manage'),

  ('admin', 'delivery_zones.view'), ('admin', 'delivery_zones.manage'),
  ('admin', 'deliveries.view'),     ('admin', 'deliveries.manage'),

  -- manager: "supervisa operacion, catalogo y reportes" - the price list and
  -- the board are both that.
  ('manager', 'delivery_zones.view'), ('manager', 'delivery_zones.manage'),
  ('manager', 'deliveries.view'),     ('manager', 'deliveries.manage'),

  -- cashier: takes the order over the phone and attaches the delivery to it,
  -- so it reads the zones and writes deliveries - but does not set prices.
  ('cashier', 'delivery_zones.view'),
  ('cashier', 'deliveries.view'), ('cashier', 'deliveries.manage'),

  -- delivery: the rider. Its role description has said "Gestiona las entregas
  -- asignadas" since Phase 03, and until now there was nothing to gestionar.
  -- Reads zones so a screen can name the zone it is going to.
  ('delivery', 'delivery_zones.view'),
  ('delivery', 'deliveries.view'), ('delivery', 'deliveries.manage'),

  -- accountant: reads what delivery cost, writes nothing - the same posture it
  -- already holds toward payments, cash and inventory.
  ('accountant', 'delivery_zones.view'),
  ('accountant', 'deliveries.view');

-- waiter and kitchen: nothing. A waiter works the floor and a kitchen cooks;
-- neither takes a delivery decision. This is the same reasoning that left them
-- out of `cash.manage` (Phase 14) and inventory (Phase 18).
