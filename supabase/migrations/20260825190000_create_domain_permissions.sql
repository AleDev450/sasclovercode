-- Phase 09 - Custom Domains
-- Two permissions for connecting a business's own address.
--
-- SPEC: docs/specs/phase-09-custom-domains.md section 6.

-- Master section 12 lists permissions as EXAMPLES, so a phase that introduces a
-- genuinely new capability adds its own - as Phase 03 did for membership and
-- Phase 07 did for content.
--
-- Not folded into `settings.manage`. Pointing a domain is not the same act as
-- editing the trade name: it changes the address the whole internet uses to
-- reach the business, it can be got wrong in ways that take the site down, and
-- it is the one setting where a mistake is visible to every customer at once.
insert into public.permissions (code, resource, action, description) values
  ('domains.view',   'domains', 'view',   'Ver los dominios de la empresa.'),
  ('domains.manage', 'domains', 'manage', 'Conectar, verificar y elegir dominios.');

-- owner and admin only.
--
-- A manager may write the website (Phase 07) without being able to move where
-- that website lives. Widening later is one row; narrowing later takes
-- something away from somebody who already had it.
insert into public.role_permissions (role, permission) values
  ('owner', 'domains.view'),
  ('owner', 'domains.manage'),
  ('admin', 'domains.view'),
  ('admin', 'domains.manage');
