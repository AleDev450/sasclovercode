-- Phase 14 - Payments + Cash
-- New permissions this phase needs.
--
-- SPEC: docs/specs/phase-14-payments-cash.md section 6.
-- CLOVERCODE_MASTER.md section 12 (examples), section 14 (Phase 14).
--
-- Phase 03 pre-seeded `cash.open` / `cash.close` - they are in master section
-- 12's own example list - but nothing about payments or payment methods.
-- Those are new here, the same way Phase 10 added `locations.*`.
--
-- Owner and admin do NOT inherit new permissions automatically: Phase 03's
-- migration granted them a SNAPSHOT of the catalogue as it stood then, not a
-- standing "everything" rule. Every permission added since (locations.*,
-- domains.*, and now these) needs its own explicit row for both roles.

insert into public.permissions (code, resource, action, description) values
  ('payments.view',          'payments',         'view',   'Ver los pagos de un pedido.'),
  ('payments.create',        'payments',         'create', 'Registrar un pago.'),
  ('payments.void',          'payments',         'void',   'Anular un pago.'),
  ('payment_methods.view',   'payment_methods',  'view',   'Ver los metodos de pago del negocio.'),
  ('payment_methods.manage', 'payment_methods',  'manage', 'Crear y editar metodos de pago.'),
  ('cash.view',              'cash',             'view',   'Ver cajas, sesiones y movimientos.'),
  ('cash.manage',            'cash',             'manage', 'Crear cajas y registrar movimientos manuales.');

-- owner / admin: everything this phase adds. Neither role inherits `cash.open`
-- / `cash.close` here either - those already exist from Phase 03 and are
-- untouched.
insert into public.role_permissions (role, permission) values
  ('owner', 'payments.view'), ('owner', 'payments.create'), ('owner', 'payments.void'),
  ('owner', 'payment_methods.view'), ('owner', 'payment_methods.manage'),
  ('owner', 'cash.view'), ('owner', 'cash.manage'),

  ('admin', 'payments.view'), ('admin', 'payments.create'), ('admin', 'payments.void'),
  ('admin', 'payment_methods.view'), ('admin', 'payment_methods.manage'),
  ('admin', 'cash.view'), ('admin', 'cash.manage'),

  -- manager: runs the floor day to day, including reversing a mistake and
  -- opening a second till when it is busy. Not `payment_methods.manage`:
  -- which payment rails the business accepts is a company decision, like
  -- opening a branch (Phase 10) - not something decided between orders.
  ('manager', 'payments.view'), ('manager', 'payments.create'), ('manager', 'payments.void'),
  ('manager', 'payment_methods.view'),
  ('manager', 'cash.view'), ('manager', 'cash.manage'),

  -- cashier: takes money in, cannot erase it and cannot configure the till -
  -- the same split Phase 03 already drew between `orders.update` and
  -- `orders.cancel` for this role.
  ('cashier', 'payments.view'), ('cashier', 'payments.create'),
  ('cashier', 'payment_methods.view'),
  ('cashier', 'cash.view'),

  -- accountant: reconciles what happened, never a party to any of it.
  ('accountant', 'payments.view'),
  ('accountant', 'payment_methods.view'),
  ('accountant', 'cash.view');

-- waiter, kitchen, delivery: nothing. They hold no `cash.*` today either.
