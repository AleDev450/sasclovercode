-- Phase 01 - Multi-Tenancy Core
-- The single sanctioned read path into `tenants` / `tenant_domains`.
--
-- SPEC: docs/specs/phase-01-multitenancy.md sections 8, 10, 11.

-- ---------------------------------------------------------------------------
-- resolve_tenant_by_domain
-- ---------------------------------------------------------------------------

-- Why a SECURITY DEFINER function instead of RLS policies granting SELECT:
--
-- A public website has to resolve before any session exists, so the reader is
-- anonymous. A policy permissive enough to let an anonymous client resolve its
-- own host would also let it SELECT every other row - handing anyone the full
-- customer list of CloverCode (SPEC AB-101).
--
-- This function takes ONE hostname and returns AT MOST ONE row, so there is no
-- query shape that yields more than a single tenant. The tables themselves stay
-- unreadable.
--
-- `SET search_path = ''` is mandatory on a SECURITY DEFINER function: without
-- it a caller could prepend a schema and have the function resolve `tenants` to
-- an object they control. Every name below is therefore fully qualified.
create or replace function public.resolve_tenant_by_domain(p_hostname text)
returns table (
  tenant_id    uuid,
  slug         text,
  name         text,
  status       public.tenant_status,
  domain       text,
  domain_type  public.tenant_domain_type,
  is_primary   boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    t.id,
    t.slug,
    t.name,
    t.status,
    d.domain,
    d.type,
    d.is_primary
  from public.tenant_domains as d
  join public.tenants as t on t.id = d.tenant_id
  where
    d.domain = lower(btrim(p_hostname))
    -- Registering a domain is not owning it. Only verified domains serve.
    and d.verification_status = 'active'
    -- Archived tenants stop resolving. Suspended ones DO resolve, carrying
    -- their status, so the application can show a notice instead of a 404.
    and t.status <> 'archived'
  limit 1;
$$;

comment on function public.resolve_tenant_by_domain(text) is
  'Resolves a hostname to its owning tenant. Returns at most one row. The only '
  'read path into tenants/tenant_domains for non-privileged roles.';

-- PostgreSQL grants EXECUTE on a new function to PUBLIC by default. On a
-- SECURITY DEFINER function that means every present AND future role inherits
-- the privilege without anyone deciding so, which contradicts the least
-- privilege rule of master section 9. Revoke first, then name the roles.
revoke execute on function public.resolve_tenant_by_domain(text) from public;

-- The resolver runs before authentication, so `anon` must be able to call it.
grant execute on function public.resolve_tenant_by_domain(text) to anon, authenticated;
