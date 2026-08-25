-- Phase 01 - Multi-Tenancy Core
-- Creates the root entity of the whole platform: `tenants`.
--
-- SPEC: docs/specs/phase-01-multitenancy.md section 8
-- CLOVERCODE_MASTER.md sections 5, 6, 7, 8, 10.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

-- `archived` exists because a tenant is never deleted physically: it is
-- auditable business information (master section 41). Lifecycle lives in
-- `status`, not in a DELETE.
create type public.tenant_status as enum ('active', 'suspended', 'archived');

-- ---------------------------------------------------------------------------
-- Shared trigger function
-- ---------------------------------------------------------------------------

-- `updated_at` is maintained by the database, never by the application: an
-- application that forgets to set it produces a silently wrong audit trail.
--
-- `search_path = ''` hardens the function against search_path hijacking.
-- `pg_catalog` is always implicitly searched, so `now()` still resolves.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

comment on function public.set_updated_at() is
  'Trigger function: stamps updated_at on every UPDATE.';

-- ---------------------------------------------------------------------------
-- tenants
-- ---------------------------------------------------------------------------

create table public.tenants (
  id          uuid                 not null default gen_random_uuid(),
  name        text                 not null,
  slug        text                 not null,
  status      public.tenant_status not null default 'active',
  created_at  timestamptz          not null default now(),
  updated_at  timestamptz          not null default now(),

  constraint tenants_pkey primary key (id),
  constraint tenants_slug_key unique (slug),

  -- The slug IS a DNS label: it becomes `{slug}.clovercodeapp.com`. Anything
  -- that is not a valid DNS label produces an unreachable host.
  constraint tenants_slug_format
    check (slug ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?$'),

  -- 63 is the hard DNS label limit. 3 keeps the namespace usable.
  constraint tenants_slug_length
    check (char_length(slug) between 3 and 63),

  -- A tenant claiming `www` or `api` would hijack a platform host.
  constraint tenants_slug_not_reserved
    check (
      slug <> all (
        array[
          'www', 'api', 'app', 'admin', 'dashboard', 'auth', 'login', 'logout',
          'static', 'assets', 'cdn', 'mail', 'smtp', 'ftp', 'ns1', 'ns2',
          'status', 'support', 'help', 'docs', 'blog', 'clovercode',
          'superadmin', 'system', 'internal', 'test', 'staging', 'preview'
        ]::text[]
      )
    ),

  constraint tenants_name_not_blank
    check (char_length(btrim(name)) between 1 and 120)
);

comment on table public.tenants is
  'Root entity. Every business row in CloverCode ultimately belongs to one of these.';
comment on column public.tenants.slug is
  'DNS label. Globally unique. Becomes {slug}.clovercodeapp.com.';
comment on column public.tenants.status is
  'Lifecycle. Tenants are archived, never deleted.';

create trigger tenants_set_updated_at
  before update on public.tenants
  for each row
  execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

-- RLS on, with NO policies, means: denied for every non-superuser role,
-- including `anon` and `authenticated`. That is deliberate for Phase 01.
--
-- Legitimate reads go through public.resolve_tenant_by_domain(), a
-- SECURITY DEFINER function that returns at most one row for one hostname, so
-- the tenant list can never be enumerated.
--
-- Per-user policies arrive in Phase 03 with `tenant_members`.
--
-- Grants are intentionally left at the Supabase defaults: in this platform RLS
-- is the access control layer, and revoking grants here would silently break
-- the Phase 03 policies.
alter table public.tenants enable row level security;
