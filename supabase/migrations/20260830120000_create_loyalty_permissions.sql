-- Phase 20 - Loyalty + Promotions
-- New permissions this phase needs.
--
-- SPEC: docs/specs/phase-20-loyalty-promotions.md section 11.
-- CLOVERCODE_MASTER.md section 33 (Phase 20).
--
-- Two resources, the same configuration/operation split every phase since 14
-- has drawn - except that here both sides land on the SAME person. A cashier
-- configures nothing and does both operational halves: types in the coupon the
-- customer brought, and redeems the points that pay for part of the bill. Both
-- happen at the till, with somebody waiting.
--
-- So `promotions.manage` covers both editing the price rules and applying one
-- to an order, rather than splitting into a third code nobody would hold
-- separately. `loyalty.manage` covers crediting, adjusting and redeeming.
--
-- Owner and admin do NOT inherit new permissions automatically - the same fact
-- every phase since 03 has had to remember.

insert into public.permissions (code, resource, action, description) values
  ('promotions.view',   'promotions', 'view',   'Ver promociones y cupones.'),
  ('promotions.manage', 'promotions', 'manage', 'Crear promociones y cupones, y aplicarlos a un pedido.'),
  ('loyalty.view',      'loyalty',    'view',   'Ver cuentas de puntos y su historial.'),
  ('loyalty.manage',    'loyalty',    'manage', 'Inscribir clientes, acreditar, ajustar y canjear puntos.');

insert into public.role_permissions (role, permission) values
  ('owner', 'promotions.view'), ('owner', 'promotions.manage'),
  ('owner', 'loyalty.view'),    ('owner', 'loyalty.manage'),

  ('admin', 'promotions.view'), ('admin', 'promotions.manage'),
  ('admin', 'loyalty.view'),    ('admin', 'loyalty.manage'),

  ('manager', 'promotions.view'), ('manager', 'promotions.manage'),
  ('manager', 'loyalty.view'),    ('manager', 'loyalty.manage'),

  -- cashier: the whole point of this phase. Applying the coupon and redeeming
  -- the points IS the checkout, so a cashier that could not do it would make
  -- the feature unusable in the one place it is used.
  ('cashier', 'promotions.view'), ('cashier', 'promotions.manage'),
  ('cashier', 'loyalty.view'),    ('cashier', 'loyalty.manage'),

  -- waiter: reads both, writes neither. A waiter is asked "do I have points?"
  -- and "is the promo still on?" all day, and answering needs no write.
  ('waiter', 'promotions.view'),
  ('waiter', 'loyalty.view'),

  -- accountant: reads what the discounts cost, writes nothing - the same
  -- posture it already holds toward payments, cash, inventory and delivery.
  ('accountant', 'promotions.view'),
  ('accountant', 'loyalty.view');

-- kitchen and delivery: nothing. Neither takes a pricing decision, and a rider
-- holding `loyalty.manage` could redeem somebody's points from the street.
