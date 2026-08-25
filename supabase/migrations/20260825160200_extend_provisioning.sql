-- Phase 06 - Business Settings + Theme
-- Provisioning now creates the settings and theme rows.
--
-- SPEC: docs/specs/phase-06-business-settings-theme.md section 20.
-- CLOVERCODE_MASTER.md section 33 (Phase 4) asked for "default settings" at
-- provisioning time. Phase 04 could not deliver it because these tables did not
-- exist; this closes that gap.

-- ---------------------------------------------------------------------------
-- Backfill
-- ---------------------------------------------------------------------------

-- Tenants provisioned before this migration have no settings row. Without this
-- they would render with nulls everywhere and every read would need a fallback,
-- which is how "the row might not exist" spreads through a codebase.
insert into public.tenant_settings (tenant_id, trade_name)
select t.id, t.name
from public.tenants as t
on conflict (tenant_id) do nothing;

insert into public.tenant_themes (tenant_id)
select t.id
from public.tenants as t
on conflict (tenant_id) do nothing;

-- ---------------------------------------------------------------------------
-- Every tenant has settings, as an invariant
-- ---------------------------------------------------------------------------

-- `provision_tenant` creates these rows, but it is not the only way a tenant
-- comes into existence: Phase 04 gives a platform operator an INSERT policy on
-- `tenants`, and a direct insert would produce a business with no settings row.
--
-- A trigger makes "every tenant has settings and a theme" a property of the
-- database rather than something two code paths have to remember. Every read in
-- the product can then assume the row is there, instead of carrying a fallback.
create or replace function public.create_tenant_defaults()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.tenant_settings (tenant_id, trade_name)
  values (new.id, new.name)
  on conflict (tenant_id) do nothing;

  insert into public.tenant_themes (tenant_id)
  values (new.id)
  on conflict (tenant_id) do nothing;

  return new;
end;
$$;

comment on function public.create_tenant_defaults() is
  'Gives every new tenant its settings and theme row, however it was created.';

create trigger tenants_create_defaults
  after insert on public.tenants
  for each row
  execute function public.create_tenant_defaults();

-- ---------------------------------------------------------------------------
-- provision_tenant
-- ---------------------------------------------------------------------------

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
    v_tenant_id, v_slug || '.clovercodeapp.com', 'system', true, 'active', now()
  )
  on conflict (domain) do nothing;

  -- 3. First owner.
  insert into public.tenant_members (tenant_id, user_id, role, status)
  values (v_tenant_id, v_owner_id, 'owner', 'active')
  on conflict (tenant_id, user_id) do nothing;

  -- 4. Default settings and theme (Phase 06).
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

  return v_tenant_id;
end;
$$;

comment on function public.provision_tenant(text, text, text) is
  'Creates tenant + system domain + first owner + default settings and theme, '
  'in one transaction. Idempotent about the whole operation, not just the slug.';
