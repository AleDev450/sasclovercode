-- Phase 03 - Authorization + RLS
-- The three functions every policy and every server check goes through.
--
-- SPEC: docs/specs/phase-03-authorization-rls.md sections 8, 11.

-- Why these are SECURITY DEFINER, and why it is not optional:
--
-- A policy on `tenant_members` that needs to know "is this user a member of
-- this tenant" has to read `tenant_members`. Reading it re-evaluates the
-- policy, which reads it again: infinite recursion, and PostgreSQL raises
-- `infinite recursion detected in policy for relation`.
--
-- A SECURITY DEFINER function runs as its owner and therefore does NOT go back
-- through RLS, which breaks the cycle. That is exactly why it must be written
-- defensively: `SET search_path = ''`, every name fully qualified, and no user
-- parameter.
--
-- No user parameter is the important one. `has_permission(user_id, tenant, ...)`
-- would let any caller ask about anybody. Identity comes from `auth.uid()`
-- inside the body, so a caller can only ever ask about themselves.

-- ---------------------------------------------------------------------------
-- is_tenant_member
-- ---------------------------------------------------------------------------

create or replace function public.is_tenant_member(p_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.tenant_members as m
    where m.tenant_id = p_tenant_id
      -- Wrapped in a scalar subquery so PostgreSQL evaluates it once per
      -- statement instead of once per row.
      and m.user_id = (select auth.uid())
      -- `invited` and `suspended` are memberships that exist but grant nothing.
      and m.status = 'active'
  );
$$;

comment on function public.is_tenant_member(uuid) is
  'True when the CURRENT user has an active membership in the given tenant.';

-- ---------------------------------------------------------------------------
-- has_permission
-- ---------------------------------------------------------------------------

create or replace function public.has_permission(p_tenant_id uuid, p_permission text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.tenant_members as m
    join public.role_permissions as rp on rp.role = m.role
    where m.tenant_id = p_tenant_id
      and m.user_id = (select auth.uid())
      and m.status = 'active'
      and rp.permission = p_permission
  );
$$;

comment on function public.has_permission(uuid, text) is
  'True when the CURRENT user holds the permission IN THAT TENANT. A permission '
  'is never global: holding it in tenant A grants nothing in tenant B.';

-- ---------------------------------------------------------------------------
-- my_permissions
-- ---------------------------------------------------------------------------

-- Returns the whole set at once so a screen can render without asking per
-- element, which would be an N+1 of authorization checks.
create or replace function public.my_permissions(p_tenant_id uuid)
returns table (permission text)
language sql
stable
security definer
set search_path = ''
as $$
  select distinct rp.permission
  from public.tenant_members as m
  join public.role_permissions as rp on rp.role = m.role
  where m.tenant_id = p_tenant_id
    and m.user_id = (select auth.uid())
    and m.status = 'active'
  order by rp.permission;
$$;

comment on function public.my_permissions(uuid) is
  'Every permission the CURRENT user holds in that tenant. For rendering only: '
  'master section 45 - hiding a control is not access control.';

-- ---------------------------------------------------------------------------
-- Least privilege
-- ---------------------------------------------------------------------------

-- PostgreSQL grants EXECUTE on a new function to PUBLIC by default, so a
-- SECURITY DEFINER function is callable by every present and future role unless
-- revoked first. This was a finding of the Phase 01 audit; applied here from
-- the start.
revoke execute on function public.is_tenant_member(uuid) from public;
revoke execute on function public.has_permission(uuid, text) from public;
revoke execute on function public.my_permissions(uuid) from public;

-- `anon` is deliberately not granted: with no session `auth.uid()` is null, so
-- these can only return false or zero rows. Exposing them would add surface for
-- no capability.
grant execute on function public.is_tenant_member(uuid) to authenticated;
grant execute on function public.has_permission(uuid, text) to authenticated;
grant execute on function public.my_permissions(uuid) to authenticated;
