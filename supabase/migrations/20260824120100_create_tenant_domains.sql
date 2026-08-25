-- Phase 01 - Multi-Tenancy Core
-- Maps a hostname to the tenant that owns it.
--
-- SPEC: docs/specs/phase-01-multitenancy.md section 8
-- CLOVERCODE_MASTER.md section 27.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

-- `system` -> {slug}.clovercodeapp.com, issued automatically.
-- `custom` -> a domain the tenant owns, e.g. sugurolls.com.
create type public.tenant_domain_type as enum ('system', 'custom');

-- Lifecycle from master section 33 (Phase 9). Only `active` serves traffic.
create type public.domain_verification_status as enum (
  'pending', 'verifying', 'active', 'failed'
);

-- ---------------------------------------------------------------------------
-- tenant_domains
-- ---------------------------------------------------------------------------

create table public.tenant_domains (
  id                   uuid                              not null default gen_random_uuid(),
  tenant_id            uuid                              not null,
  domain               text                              not null,
  type                 public.tenant_domain_type         not null,
  is_primary           boolean                           not null default false,
  verification_status  public.domain_verification_status not null default 'pending',
  verified_at          timestamptz,
  created_at           timestamptz                       not null default now(),
  updated_at           timestamptz                       not null default now(),

  constraint tenant_domains_pkey primary key (id),

  constraint tenant_domains_tenant_id_fkey
    foreign key (tenant_id) references public.tenants (id) on delete cascade,

  -- Global uniqueness, NOT per tenant. This is the deliberate exception to the
  -- `UNIQUE(tenant_id, ...)` rule in master section 11: a domain is a global
  -- identity on the internet, and section 27 requires it to belong to exactly
  -- one tenant. This constraint is what makes host takeover impossible.
  constraint tenant_domains_domain_key unique (domain),

  -- Stored normalised: lowercase, no scheme, no port, no trailing dot, at
  -- least two labels. The regex enforces all of that at once, so a malformed
  -- value can never reach the resolver.
  constraint tenant_domains_domain_format
    check (domain ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'),

  -- 253 is the hard DNS name limit.
  constraint tenant_domains_domain_length
    check (char_length(domain) between 4 and 253),

  -- `verified_at` is present exactly when the domain is active. Without this,
  -- "verified" state could disagree with its own timestamp.
  constraint tenant_domains_verified_at_consistency
    check ((verification_status = 'active') = (verified_at is not null))
);

comment on table public.tenant_domains is
  'Hostname -> tenant mapping. A domain belongs to exactly one tenant.';
comment on column public.tenant_domains.domain is
  'Normalised hostname: lowercase, no scheme, no port, no trailing dot.';
comment on column public.tenant_domains.verification_status is
  'Only `active` domains resolve. Registering a domain is not owning it.';

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

-- `tenant_domains_domain_key` (created by the UNIQUE constraint above) is THE
-- index of this phase: the one resolution query per request uses it.

-- Lists a tenant's domains (Phase 09) and backs the foreign key check and the
-- ON DELETE CASCADE, both of which scan this column.
create index tenant_domains_tenant_id_idx
  on public.tenant_domains (tenant_id);

-- At most one system domain per tenant: {slug}.clovercodeapp.com is singular.
create unique index tenant_domains_one_system_per_tenant
  on public.tenant_domains (tenant_id)
  where type = 'system';

-- At most one primary domain per tenant. "At least one" cannot be expressed
-- declaratively and is an application invariant owned by provisioning (Phase 04).
create unique index tenant_domains_one_primary_per_tenant
  on public.tenant_domains (tenant_id)
  where is_primary;

create trigger tenant_domains_set_updated_at
  before update on public.tenant_domains
  for each row
  execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

-- Same posture as `tenants`: enabled, no policies, so no client role can read
-- or enumerate the domain table. See the note in 20260824120000_create_tenants.sql.
alter table public.tenant_domains enable row level security;
