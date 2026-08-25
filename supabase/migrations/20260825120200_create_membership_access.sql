-- Phase 02 - Authentication
-- The sanctioned read path for "which tenants am I a member of".
--
-- SPEC: docs/specs/phase-02-authentication.md sections 8, 11.

-- ---------------------------------------------------------------------------
-- get_my_memberships
-- ---------------------------------------------------------------------------

-- The application needs the tenant NAME and SLUG next to each membership, and
-- `public.tenants` is deny-by-default since Phase 01. Two ways out:
--
--   a) add a SELECT policy on `tenants` for members;
--   b) a guarded function that joins on the server side.
--
-- (b) is chosen. Opening `tenants` to authenticated users is an authorization
-- decision, and master section 33 places authorization and RLS policy design in
-- Phase 03. This function delivers exactly what authentication needs without
-- pre-empting that design, and it follows the pattern Phase 01 already
-- established with `resolve_tenant_by_domain`.
--
-- The critical property: there is NO user parameter. The caller cannot ask
-- about anybody but themselves, because the identity comes from `auth.uid()`
-- inside the function body. A parameter would turn this into an oracle for
-- mapping any user id to their businesses.
create or replace function public.get_my_memberships()
returns table (
  membership_id  uuid,
  tenant_id      uuid,
  tenant_slug    text,
  tenant_name    text,
  tenant_status  public.tenant_status,
  role           public.tenant_role,
  status         public.membership_status
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    m.id,
    t.id,
    t.slug,
    t.name,
    t.status,
    m.role,
    m.status
  from public.tenant_members as m
  join public.tenants as t on t.id = m.tenant_id
  where
    m.user_id = (select auth.uid())
    -- An archived tenant is gone as far as its members are concerned. It stays
    -- reachable to the platform operator (Phase 04), not through this path.
    and t.status <> 'archived'
  order by t.name, t.id;
$$;

comment on function public.get_my_memberships() is
  'Memberships of the CURRENT user, with tenant identity. Takes no user '
  'parameter by design: the caller cannot query anybody else.';

-- Least privilege, applying the finding of the Phase 01 final audit:
-- PostgreSQL grants EXECUTE to PUBLIC by default, so a SECURITY DEFINER
-- function is callable by every present and future role unless revoked first.
revoke execute on function public.get_my_memberships() from public;

-- `anon` is deliberately NOT granted: with no session `auth.uid()` is null and
-- the function can only ever return zero rows, so exposing it would add
-- surface for no capability.
grant execute on function public.get_my_memberships() to authenticated;
