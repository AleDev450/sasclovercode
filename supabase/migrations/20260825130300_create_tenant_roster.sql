-- Phase 03 - Authorization + RLS (audit follow-up)
-- Makes the `members.view` permission actually usable.
--
-- SPEC: docs/specs/phase-03-authorization-rls.md UC-303, section 23.6.

-- The Phase 03 audit found that `members.view` granted a roster of opaque
-- UUIDs: `tenant_members` opened up, but `profiles` did not, and Phase 02
-- restricts profiles to the viewer's own row. A roster without names satisfies
-- the letter of UC-303 and none of its intent, and it would force Phase 05 to
-- invent its own way in - which is exactly what this phase exists to prevent.
--
-- Two ways to fix it:
--
--   a) a policy on `profiles` exposing co-members;
--   b) a guarded function returning the roster with the identity fields.
--
-- (b) is chosen, following the pattern of `resolve_tenant_by_domain` (Phase 01)
-- and `get_my_memberships` (Phase 02). It exposes exactly the columns a roster
-- needs, instead of opening the whole `profiles` row - which carries personal
-- data and whose broader exposure should stay a deliberate decision.
create or replace function public.get_tenant_members(p_tenant_id uuid)
returns table (
  membership_id uuid,
  user_id       uuid,
  email         text,
  full_name     text,
  avatar_url    text,
  role          public.tenant_role,
  status        public.membership_status,
  created_at    timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    m.id,
    m.user_id,
    p.email,
    p.full_name,
    p.avatar_url,
    m.role,
    m.status,
    m.created_at
  from public.tenant_members as m
  join public.profiles as p on p.id = m.user_id
  where
    m.tenant_id = p_tenant_id
    -- The gate. Without `members.view` in THIS tenant, no rows - whatever the
    -- caller holds anywhere else.
    and public.has_permission(p_tenant_id, 'members.view')
  order by m.created_at, m.id;
$$;

comment on function public.get_tenant_members(uuid) is
  'Roster of one tenant, with member identity. Gated on members.view in that '
  'same tenant. Returns zero rows rather than raising when the caller lacks it.';

revoke execute on function public.get_tenant_members(uuid) from public;
grant execute on function public.get_tenant_members(uuid) to authenticated;
