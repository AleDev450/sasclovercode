-- Phase 21 - SaaS Modules + Plans
-- The one place the question "is this available?" is answered.
--
-- SPEC: docs/specs/phase-21-saas-modules-plans.md sections 12, 14.
-- CLOVERCODE_MASTER.md sections 33 (Phase 21), 45.
-- ADR-025 decisions 1, 4 and 5.
--
-- Master asks for exactly this, in these words:
--
--   "Features deben evaluarse centralmente."
--   "No llenar la aplicacion de condiciones dispersas."
--
-- A dispersed condition is `if (plan === 'pro')` written in forty places. The
-- antidote is that the question has one answer, and this is where it lives -
-- the same pair, in the same shape, that `has_permission`/`my_permissions`
-- established in Phase 03.

-- ---------------------------------------------------------------------------
-- has_module
-- ---------------------------------------------------------------------------

-- Resolution order, and it is the whole design (ADR-025 decision 2):
--
--   1. an override exists -> return it, true OR false. Stop.
--   2. the subscription grants access AND the plan includes the module.
--   3. false.
--
-- There is no branch that returns true because data is missing. A tenant with
-- no subscription has no modules - fail-closed, on purpose (ADR-025 decision
-- 4). Fail-open would make the paywall decorative: the first provisioning bug
-- would silently switch it off for somebody.
--
-- Not `security definer`, unlike most functions in this schema: it must be
-- callable about ANY tenant, including from the Super Admin screens, and the
-- three catalogue tables are world-readable while `subscriptions` and
-- `tenant_modules` are readable by members and platform admins. A definer
-- function would have hidden that boundary instead of respecting it - and a
-- caller who cannot see the subscription gets `false`, which is the correct
-- answer for them.
create or replace function public.has_module(p_tenant_id uuid, p_module text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(
    -- 1. The override wins, in both directions.
    (
      select tm.is_enabled
      from public.tenant_modules as tm
      where tm.tenant_id = p_tenant_id and tm.module_code = p_module
    ),
    -- 2. Otherwise: does an access-granting subscription include it?
    exists (
      select 1
      from public.subscriptions as s
      join public.plan_modules as pm on pm.plan_code = s.plan_code
      where s.tenant_id = p_tenant_id
        and pm.module_code = p_module
        and s.status in ('trialing', 'active', 'past_due')
    )
  );
$$;

comment on function public.has_module(uuid, text) is
  'True when the tenant has that module: a tenant_modules override wins, otherwise the plan of an access-granting subscription. Never true by default (ADR-025).';

revoke execute on function public.has_module(uuid, text) from public;
grant execute on function public.has_module(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- my_modules
-- ---------------------------------------------------------------------------

-- Returns the whole set at once so a screen can render without asking per
-- element - the N+1 of feature checks, which is the same thing
-- `my_permissions` (Phase 03) exists to avoid for authorization.
--
-- The dashboard layout draws a menu of twenty entries; without this it would
-- run twenty round trips to decide what to show.
create or replace function public.my_modules(p_tenant_id uuid)
returns table (module text)
language sql
stable
set search_path = ''
as $$
  select m.code
  from public.modules as m
  where public.has_module(p_tenant_id, m.code)
  order by m.position, m.code;
$$;

comment on function public.my_modules(uuid) is
  'Every module the tenant has, in display order. For rendering; each page still checks its own.';

revoke execute on function public.my_modules(uuid) from public;
grant execute on function public.my_modules(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Provisioning, extended a sixth time
-- ---------------------------------------------------------------------------

-- Every tenant gets a subscription the moment it exists, for the same reason
-- the backfill in the previous migration exists: `has_module` is fail-closed,
-- so a tenant without one has nothing.
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

  insert into public.tenant_seo (tenant_id)
  values (new.id)
  on conflict (tenant_id) do nothing;

  -- Added in Phase 21, and FIRST among the rows that follow: the
  -- multi_location guard below reads the subscription, so provisioning must
  -- never create a location for a tenant that does not have one yet. Today the
  -- guard short-circuits on the count, but ordering it this way means a future
  -- change to that guard cannot break provisioning.
  insert into public.subscriptions (tenant_id, plan_code)
  select new.id, p.code from public.plans as p where p.is_default
  on conflict (tenant_id) do nothing;

  insert into public.locations (tenant_id, name)
  values (new.id, new.name)
  on conflict (tenant_id, lower(btrim(name))) do nothing;

  insert into public.billing_provider_configs (tenant_id)
  values (new.id)
  on conflict (tenant_id) do nothing;

  insert into public.units (tenant_id, name, abbreviation)
  values
    (new.id, 'Kilogramo', 'kg'),
    (new.id, 'Gramo', 'g'),
    (new.id, 'Litro', 'l'),
    (new.id, 'Mililitro', 'ml'),
    (new.id, 'Unidad', 'unidad')
  on conflict (tenant_id, lower(btrim(abbreviation))) do nothing;

  return new;
end;
$$;

comment on function public.create_tenant_defaults() is
  'Gives every new tenant its settings, theme, SEO row, first location, billing config, starter units and a subscription to the default plan, however it was created.';

-- ---------------------------------------------------------------------------
-- multi_location: the one module that governs data, not a screen
-- ---------------------------------------------------------------------------

-- ADR-025 decision 5. Nine of the ten modules switch a screen on or off.
-- `multi_location` cannot: since ADR-014 EVERY tenant has at least one
-- location, created by provisioning, and the locations screen has to stay
-- reachable or a single-shop business could not edit its own address.
--
-- So the module means "may have more than one", and that is a data invariant -
-- which in this project lives in a trigger, where every writer goes through it
-- rather than the dashboard remembering.
--
-- Counted over ACTIVE locations, not all of them: a business that closes one
-- shop and opens another should not have to call support.
create or replace function public.guard_multi_location()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_active_count integer;
begin
  -- Only a row that will BE active can push the count over the line.
  if not new.is_active then
    return new;
  end if;

  select count(*) into v_active_count
  from public.locations as l
  where l.tenant_id = new.tenant_id
    and l.is_active
    and l.id <> new.id;

  if v_active_count >= 1 and not public.has_module(new.tenant_id, 'multi_location') then
    raise exception 'This plan does not include more than one active location.'
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

comment on function public.guard_multi_location() is
  'Refuses a second ACTIVE location unless the tenant has the multi_location module (ADR-025 decision 5).';

-- Fires on insert and on reactivation, which are the two ways the number of
-- active locations goes up. It deliberately does NOT deactivate anything when
-- the module is removed from a tenant that already has three (KL-2104):
-- destroying configuration over a commercial change is bad, and which of the
-- three survives is not a decision a trigger can take.
create trigger locations_guard_multi_location
  before insert or update of is_active on public.locations
  for each row execute function public.guard_multi_location();
