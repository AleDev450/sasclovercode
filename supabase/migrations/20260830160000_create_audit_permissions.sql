-- Phase 24 - Audit + Observability
-- The one permission this phase needs.
--
-- SPEC: docs/specs/phase-24-audit-observability.md section 11.
-- ADR-028 decision 7.
-- CLOVERCODE_MASTER.md section 17 (auditoria), section 33 (Phase 24).
--
-- The first new permission since Phase 20. Phases 21, 22 and 23 created none,
-- and ADR-025 wrote the test for when one is justified: a new code earns its
-- place only if it governs something no existing code governs.
--
-- Here the test comes out the other way. "See who changed what" is a capability
-- an owner may want to give an accountant WITHOUT giving `settings.manage`, and
-- wants to DENY to whoever operates the shop even while giving them
-- `orders.update`. No existing permission draws that line.

insert into public.permissions (code, resource, action, description) values
  ('audit.view', 'audit', 'view', 'Ver el registro de auditoria del negocio: quien cambio que, cuando y desde donde.');

insert into public.role_permissions (role, permission) values
  -- Owner and admin do NOT inherit new permissions automatically. Every phase
  -- since 03 has had to remember this, and this one is no exception.
  ('owner', 'audit.view'),
  ('admin', 'audit.view'),

  -- accountant: the role this permission was worth creating for. Reconciling
  -- the books means asking "who voided that payment" and "who closed that
  -- till", and until now the only way to answer was `settings.manage` - a
  -- permission that also lets you change the tax id.
  ('accountant', 'audit.view');

-- manager: NO, and it is the least obvious call here.
--
-- A manager holds `products.update`, `orders.cancel` and `cash.close`, which
-- makes them one of the main SUBJECTS of this log. Auditing is a control
-- function, and whoever operates does not control their own operation.
--
-- cashier, waiter, kitchen, delivery: no, for the same reason and more
-- plainly. None of them supervises anybody.
