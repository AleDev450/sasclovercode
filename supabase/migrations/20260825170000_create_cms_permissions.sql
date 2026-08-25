-- Phase 07 - Navigation + CMS
-- Two permissions for the content the business writes about itself.
--
-- SPEC: docs/specs/phase-07-navigation-cms.md section 6.

-- Master section 12 lists permissions as EXAMPLES and does not name a content
-- pair, in the same way it did not name the membership pair that Phase 03 had
-- to add. Editing the public website is plainly its own capability: a manager
-- may need to write it without touching the business's fiscal settings, and a
-- cashier should touch neither.
insert into public.permissions (code, resource, action, description) values
  ('content.view',   'content', 'view',   'Ver las paginas y la navegacion del sitio.'),
  ('content.manage', 'content', 'manage', 'Crear y editar paginas, secciones y navegacion.');

-- owner: everything, as always.
insert into public.role_permissions (role, permission) values
  ('owner', 'content.view'),
  ('owner', 'content.manage'),
  -- admin runs the day to day, which includes the website.
  ('admin', 'content.view'),
  ('admin', 'content.manage'),
  -- manager may write content but not the fiscal settings.
  ('manager', 'content.view'),
  ('manager', 'content.manage');

-- Roles that only read the site: none get `content.view` by default.
--
-- A cashier does not need to see the CMS to take an order, and the catalogue
-- test in Phase 03 asserts that no permission is granted to nobody - so these
-- two are covered by the three roles above rather than sprinkled wider "just in
-- case". Widening later is a row; narrowing later takes something away.
