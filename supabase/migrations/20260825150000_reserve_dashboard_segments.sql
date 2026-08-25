-- Phase 05 - Tenant Dashboard (audit follow-up)
-- Reserves the slugs that the dashboard's own routes would shadow.
--
-- SPEC: docs/specs/phase-05-tenant-dashboard.md section 26.

-- The dashboard resolves a tenant from a URL segment: `/dashboard/{slug}`.
-- Next.js resolves a STATIC segment before a dynamic one, so any static route
-- placed next to `[tenantSlug]` silently takes that name out of the tenant
-- namespace. `/dashboard/perfil` is such a route, and a tenant whose slug was
-- `perfil` would be permanently unreachable - and would look like a bug in
-- routing rather than a name clash.
--
-- The Phase 01 migration is already committed, so this is a new one rather than
-- an edit (master section 22). Replacing a CHECK means dropping and re-adding.
alter table public.tenants
  drop constraint tenants_slug_not_reserved;

alter table public.tenants
  add constraint tenants_slug_not_reserved
  check (
    slug <> all (
      array[
        -- Platform hosts (Phase 01)
        'www', 'api', 'app', 'admin', 'dashboard', 'auth', 'login', 'logout',
        'static', 'assets', 'cdn', 'mail', 'smtp', 'ftp', 'ns1', 'ns2',
        'status', 'support', 'help', 'docs', 'blog', 'clovercode',
        'superadmin', 'system', 'internal', 'test', 'staging', 'preview',
        -- Static dashboard segments (Phase 05). Anything added as a sibling of
        -- `[tenantSlug]` MUST be added here too; a test enforces it.
        'perfil'
      ]::text[]
    )
  );

comment on constraint tenants_slug_not_reserved on public.tenants is
  'Slugs that would collide with a platform host or a static dashboard route.';
