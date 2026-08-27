-- Phase 10 - Locations
-- Two permissions for the branches a business operates from.
--
-- SPEC: docs/specs/phase-10-locations.md section 6.

insert into public.permissions (code, resource, action, description) values
  ('locations.view',   'locations', 'view',   'Ver las sedes de la empresa.'),
  ('locations.manage', 'locations', 'manage', 'Crear, editar y desactivar sedes.');

-- Viewing is granted widely, and that is deliberate.
--
-- From Phase 13 onwards a location is not reference data, it is the place where
-- the work happens: an order belongs to a branch, a till is opened at a branch,
-- stock sits in a branch. A cashier who cannot read the list of branches cannot
-- be told which one they are working in - so every operational role gets the
-- read.
--
-- `accountant` is included for the same reason in reverse: they never touch a
-- till, but every document they reconcile names a branch.
insert into public.role_permissions (role, permission)
select r.code, 'locations.view'
from public.roles as r;

-- Managing them is a company decision, like the domains of Phase 09: opening or
-- closing a branch is not something a shift manager does between orders.
insert into public.role_permissions (role, permission) values
  ('owner', 'locations.manage'),
  ('admin', 'locations.manage');
