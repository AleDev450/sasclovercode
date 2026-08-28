-- Phase 17 - Electronic Billing / SUNAT
-- One new permission: configuring the provider and its credentials.
--
-- SPEC: docs/specs/phase-17-billing-sunat.md section 6.
-- `billing.view`/`billing.create`/`billing.cancel` were pre-seeded in
-- Phase 03 and already govern documents correctly (this phase reuses them
-- unchanged, in `create_billing_documents.sql`). Configuring which provider
-- a tenant uses and its credentials is a distinct, more sensitive action -
-- the same reasoning that gave `locations`, `domains` and `payment_methods`
-- their own `.manage` permission rather than folding into an existing one.

insert into public.permissions (code, resource, action, description) values
  ('billing.manage', 'billing', 'manage', 'Configurar el proveedor de facturacion y sus credenciales.');

-- owner / admin only, explicit rows (neither inherits a permission added
-- after Phase 03's own migration) - matching payment_methods.manage's
-- precedent: which provider a business uses, and its credentials, is a
-- company decision, not something decided between orders.
insert into public.role_permissions (role, permission) values
  ('owner', 'billing.manage'),
  ('admin', 'billing.manage');
