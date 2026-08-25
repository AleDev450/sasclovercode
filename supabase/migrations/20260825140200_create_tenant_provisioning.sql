-- Phase 04 - Super Admin
-- Provisioning: the operation master section 49 makes the project's first goal.
--
-- SPEC: docs/specs/phase-04-super-admin.md sections 12, 14.

-- ---------------------------------------------------------------------------
-- provision_tenant
-- ---------------------------------------------------------------------------

-- Why this is ONE SQL function and not three calls from the application:
--
-- A business needs a tenant row, a system domain and an owner. If the second
-- or third step fails after the first succeeded, the result is a business
-- nobody can reach and nobody can fix through the product. Inside a function
-- the whole thing is one transaction: it either all happens or none of it does.
--
-- Idempotent by design (master section 37): every step is `on conflict do
-- nothing`, so a retry after a partial failure COMPLETES the provisioning
-- rather than duplicating it or erroring. A double-submitted form is safe.
create or replace function public.provision_tenant(
  p_name        text,
  p_slug        text,
  p_owner_email text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant_id uuid;
  v_owner_id  uuid;
  v_slug      text := lower(btrim(p_slug));
  v_email     text := lower(btrim(p_owner_email));
begin
  -- The privilege check lives INSIDE the function, not only in the caller.
  -- A SECURITY DEFINER function runs with elevated rights, so it has to decide
  -- for itself who may run it.
  if not public.is_platform_admin() then
    raise exception 'Only a platform operator may provision a tenant.'
      using errcode = '42501';
  end if;

  -- Resolve the owner first: failing here must not leave a half-built tenant.
  -- (It would roll back anyway; failing early keeps the intent obvious.)
  select p.id into v_owner_id
  from public.profiles as p
  where lower(p.email) = v_email;

  if v_owner_id is null then
    raise exception 'No account exists for the owner email.'
      using errcode = 'P0002';
  end if;

  -- 1. The tenant. `on conflict` makes a retry return the existing row instead
  --    of failing, which is what makes the whole function idempotent.
  insert into public.tenants (name, slug)
  values (btrim(p_name), v_slug)
  on conflict (slug) do nothing;

  select t.id into v_tenant_id from public.tenants as t where t.slug = v_slug;

  if v_tenant_id is null then
    raise exception 'Tenant could not be created.' using errcode = 'P0001';
  end if;

  -- 2. The system domain: {slug}.clovercodeapp.com, primary and already
  --    verified. A system domain needs no DNS proof - the platform owns it.
  insert into public.tenant_domains (
    tenant_id, domain, type, is_primary, verification_status, verified_at
  )
  values (
    v_tenant_id, v_slug || '.clovercodeapp.com', 'system', true, 'active', now()
  )
  on conflict (domain) do nothing;

  -- 3. The first owner. Without this the business exists and nobody can enter.
  insert into public.tenant_members (tenant_id, user_id, role, status)
  values (v_tenant_id, v_owner_id, 'owner', 'active')
  on conflict (tenant_id, user_id) do nothing;

  return v_tenant_id;
end;
$$;

comment on function public.provision_tenant(text, text, text) is
  'Creates tenant + system domain + first owner in one transaction. Idempotent '
  'by slug: a retry completes the work rather than duplicating it.';

revoke execute on function public.provision_tenant(text, text, text) from public;
grant execute on function public.provision_tenant(text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- list_platform_tenants
-- ---------------------------------------------------------------------------

-- The listing needs each tenant's primary domain and member count. Doing that
-- from the application would be a query per tenant - an N+1 on the one screen
-- that shows every tenant at once.
create or replace function public.list_platform_tenants()
returns table (
  id            uuid,
  name          text,
  slug          text,
  status        public.tenant_status,
  primary_domain text,
  member_count  bigint,
  created_at    timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    t.id,
    t.name,
    t.slug,
    t.status,
    (
      select d.domain
      from public.tenant_domains as d
      where d.tenant_id = t.id and d.is_primary
      limit 1
    ),
    (select count(*) from public.tenant_members as m where m.tenant_id = t.id),
    t.created_at
  from public.tenants as t
  -- The gate. A non-operator gets zero rows rather than an error: the area
  -- should not confirm its own existence (SPEC AB-403).
  where public.is_platform_admin()
  order by t.created_at desc, t.id;
$$;

comment on function public.list_platform_tenants() is
  'Every tenant, with primary domain and member count. Operators only.';

revoke execute on function public.list_platform_tenants() from public;
grant execute on function public.list_platform_tenants() to authenticated;
