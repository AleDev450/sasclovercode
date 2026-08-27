-- Phase 09 - Custom Domains
-- What we know about a domain, kept as separate facts.
--
-- SPEC: docs/specs/phase-09-custom-domains.md sections 8, 10.
-- CLOVERCODE_MASTER.md section 27 and section 33 (Phase 9).
--
-- The governing sentence of this phase, from master section 33:
--
--   "Nunca asumir que agregar un registro a nuestra BD configura Vercel
--    automaticamente."
--
-- So the row records three independent facts, and none of them implies the
-- next:
--
--   verification_status  do we believe this business owns the name
--   (the DNS itself)     does the name point at the platform
--   provider_status      does the host serve TLS for it
--
-- Collapsing these into one "is it working" flag is the mistake the master
-- document is warning about: the UI would say `active` while a visitor gets a
-- certificate error, and nobody would know which of the three steps was
-- missing.

-- ---------------------------------------------------------------------------
-- Provider status
-- ---------------------------------------------------------------------------

-- `unknown` is the default and it is the honest one: before anybody looks, we
-- do not know what the hosting provider has. A default of `pending` would be a
-- claim that somebody had already asked for something.
create type public.domain_provider_status as enum (
  'unknown', 'requested', 'ready', 'error'
);

comment on type public.domain_provider_status is
  'What the hosting provider has for this domain. Never inferred from our own '
  'row: master section 33 forbids assuming an insert configured anything.';

-- ---------------------------------------------------------------------------
-- Token generation
-- ---------------------------------------------------------------------------

-- The value a business publishes as a TXT record.
--
-- Built from `gen_random_uuid()` and not from `gen_random_bytes()`: the latter
-- is pgcrypto, which lives in the `extensions` schema on Supabase and would
-- therefore be unreachable from a function running with `search_path = ''` -
-- and unavailable altogether in the test harness. `gen_random_uuid()` is core
-- PostgreSQL, resolves through pg_catalog whatever the search path, and
-- carries the same 128 bits.
--
-- The prefix is for the human who has to find this record again in a DNS zone
-- that already holds SPF, DKIM and three things nobody remembers adding.
create or replace function public.new_domain_verification_token()
returns text
language sql
volatile
set search_path = ''
as $$
  select 'clovercode-site-verification=' || replace(gen_random_uuid()::text, '-', '');
$$;

comment on function public.new_domain_verification_token() is
  'A TXT record value proving domain ownership. 128 bits, no extension needed.';

revoke execute on function public.new_domain_verification_token() from public;

-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------

alter table public.tenant_domains
  add column verification_token      text,
  add column verification_checked_at timestamptz,
  add column last_error              text,
  add column provider_status         public.domain_provider_status
                                     not null default 'unknown',
  add column provider_synced_at      timestamptz;

comment on column public.tenant_domains.verification_token is
  'Value the business publishes as a TXT record to prove it owns the domain.';
comment on column public.tenant_domains.last_error is
  'Why the last ownership check failed, in words an operator can read.';
comment on column public.tenant_domains.provider_status is
  'What the hosting provider has. Set by an operator, never inferred.';

-- Globally unique, like the domain itself.
--
-- Two domains sharing a token would let a business that proved ownership of one
-- name have that proof accepted for another. Cheap to prevent, painful to find.
create unique index tenant_domains_verification_token_key
  on public.tenant_domains (verification_token)
  where verification_token is not null;

-- A custom domain always has a token; a system domain never does.
--
-- The system subdomain is issued by us and needs no proof - we own
-- clovercodeapp.com. Giving it a token would suggest there is something to
-- verify, and the verification UI would then offer a meaningless action.
alter table public.tenant_domains
  add constraint tenant_domains_token_matches_type check (
    (type = 'custom' and verification_token is not null)
    or (type = 'system' and verification_token is null)
  ) not valid;

-- Existing system domains have no token and satisfy the constraint; existing
-- custom domains (none in any environment yet, but be exact) would not, so the
-- constraint is added NOT VALID and validated after the backfill below.
update public.tenant_domains
set verification_token = public.new_domain_verification_token()
where type = 'custom' and verification_token is null;

alter table public.tenant_domains
  validate constraint tenant_domains_token_matches_type;

-- A stored error is a message, not a stack trace. Master section 15: a
-- technical detail that reaches a screen is a leak, so the column is sized for
-- the sentence it is meant to hold.
alter table public.tenant_domains
  add constraint tenant_domains_last_error_length
  check (last_error is null or char_length(last_error) <= 300);

-- Operators list "domains waiting on the provider" across every tenant. Without
-- this that screen is a sequential scan of the whole table.
create index tenant_domains_provider_status_idx
  on public.tenant_domains (provider_status)
  where type = 'custom';
