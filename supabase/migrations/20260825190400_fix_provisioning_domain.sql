-- Phase 09 - Custom Domains
-- Provisioning stops swallowing a domain conflict.
--
-- SPEC: docs/specs/phase-09-custom-domains.md CD-13, AB-903, TEST-929.
--
-- THE DEFECT
--
-- `provision_tenant` inserted the system domain with `on conflict (domain) do
-- nothing`. The clause was there for idempotence - re-provisioning the same
-- tenant should not fail - and for that case it is correct.
--
-- But `tenant_domains.domain` is globally unique, so the conflict it swallows
-- is not always our own retry. If `sugurolls.clovercodeapp.com` already
-- belonged to ANOTHER tenant, the insert did nothing, the function returned
-- happily, and the new tenant was created with no domain at all: it resolved
-- nowhere, its dashboard worked, and the failure looked like a routing bug
-- weeks later rather than a provisioning error at the moment it happened.
--
-- Phase 09 makes that reachable rather than theoretical. `claim_domain` refuses
-- the platform namespace, which closes the session-side half; this closes the
-- half where the row got there some other way - a fixture, a migration, an
-- earlier tenant with the same slug that was hard-deleted.
--
-- The fix is not to drop `on conflict`: idempotence still matters. It is to
-- check afterwards that the row we need is OURS, which is the question the
-- insert never asked.

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
  v_tenant_id     uuid;
  v_owner_id      uuid;
  v_slug          text := lower(btrim(p_slug));
  v_email         text := lower(btrim(p_owner_email));
  v_system_domain text := lower(btrim(p_slug)) || '.clovercodeapp.com';
  v_domain_owner  uuid;
begin
  if not public.is_platform_admin() then
    raise exception 'Only a platform operator may provision a tenant.'
      using errcode = '42501';
  end if;

  select p.id into v_owner_id
  from public.profiles as p
  where lower(p.email) = v_email;

  if v_owner_id is null then
    raise exception 'No account exists for the owner email.'
      using errcode = 'P0002';
  end if;

  -- 1. The tenant. `returning` tells us whether WE created it.
  insert into public.tenants (name, slug)
  values (btrim(p_name), v_slug)
  on conflict (slug) do nothing
  returning id into v_tenant_id;

  if v_tenant_id is null then
    select t.id into v_tenant_id from public.tenants as t where t.slug = v_slug;

    if v_tenant_id is null then
      raise exception 'Tenant could not be created.' using errcode = 'P0001';
    end if;

    -- Only a retry if the requested owner already owns it. A different request
    -- that merely collides on slug is a conflict (Phase 04 audit, A4-1).
    if not exists (
      select 1
      from public.tenant_members as m
      where m.tenant_id = v_tenant_id
        and m.user_id = v_owner_id
        and m.role = 'owner'
    ) then
      raise exception 'A tenant with that slug already exists.'
        using errcode = '23505';
    end if;
  end if;

  -- 2. System domain.
  insert into public.tenant_domains (
    tenant_id, domain, type, is_primary, verification_status, verified_at
  )
  values (
    v_tenant_id, v_system_domain, 'system', true, 'active', now()
  )
  on conflict (domain) do nothing;

  -- ...and then verify that the domain is ours.
  --
  -- This is the whole point of the migration. `do nothing` cannot distinguish
  -- "our own row, second run" from "somebody else's row", and the difference
  -- between those two is a working tenant and a tenant that resolves nowhere.
  select d.tenant_id into v_domain_owner
  from public.tenant_domains as d
  where d.domain = v_system_domain;

  if v_domain_owner is null or v_domain_owner <> v_tenant_id then
    raise exception 'The system domain for that slug belongs to another tenant.'
      using errcode = '23505';
  end if;

  -- 3. First owner.
  insert into public.tenant_members (tenant_id, user_id, role, status)
  values (v_tenant_id, v_owner_id, 'owner', 'active')
  on conflict (tenant_id, user_id) do nothing;

  -- 4. Default settings and theme (Phase 06), SEO (Phase 08).
  --
  --    Created here rather than left to the first save, so no read anywhere in
  --    the product has to cope with a missing row. The trade name starts as the
  --    tenant name, which is the best guess available and is editable.
  insert into public.tenant_settings (tenant_id, trade_name)
  values (v_tenant_id, btrim(p_name))
  on conflict (tenant_id) do nothing;

  insert into public.tenant_themes (tenant_id)
  values (v_tenant_id)
  on conflict (tenant_id) do nothing;

  insert into public.tenant_seo (tenant_id)
  values (v_tenant_id)
  on conflict (tenant_id) do nothing;

  return v_tenant_id;
end;
$$;

comment on function public.provision_tenant(text, text, text) is
  'Creates tenant + system domain + first owner + defaults, in one '
  'transaction. Idempotent about the whole operation, and it verifies that the '
  'system domain it needs actually belongs to the tenant it just handled.';
