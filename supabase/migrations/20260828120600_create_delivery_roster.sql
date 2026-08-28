-- Phase 19 - Delivery
-- Who can be assigned a delivery.
--
-- SPEC: docs/specs/phase-19-delivery.md sections 11, 12.
--
-- The courier picker needs names, and `get_tenant_members()` (Phase 03) cannot
-- supply them here: it is gated on `members.view`, which a `cashier` does not
-- hold - yet a cashier is exactly who takes the phone order and assigns the
-- rider. Reusing it would have meant granting `members.view` to cashier, which
-- widens access to the whole roster to solve a delivery problem.
--
-- So: a second guarded function, gated on the permission that actually governs
-- the action, following the same pattern and for the same reason
-- `get_tenant_members()` itself was introduced rather than opening `profiles`.
-- It exposes the four columns a picker needs and nothing else.
--
-- Every ACTIVE member is returned, not only the `delivery` role: in a small
-- business the owner delivers, and `order_deliveries` only requires that the
-- courier be an active member. A function stricter than the constraint it
-- serves would make legitimate assignments impossible for no gain.
create or replace function public.get_tenant_couriers(p_tenant_id uuid)
returns table (
  user_id   uuid,
  email     text,
  full_name text,
  role      public.tenant_role
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    m.user_id,
    p.email,
    p.full_name,
    m.role
  from public.tenant_members as m
  join public.profiles as p on p.id = m.user_id
  where
    m.tenant_id = p_tenant_id
    and m.status = 'active'
    -- The gate. Without `deliveries.manage` in THIS tenant, no rows - whatever
    -- the caller holds anywhere else.
    and public.has_permission(p_tenant_id, 'deliveries.manage')
  order by p.full_name nulls last, p.email;
$$;

comment on function public.get_tenant_couriers(uuid) is
  'Active members of one tenant, for the courier picker. Gated on deliveries.manage '
  'in that same tenant. Returns zero rows rather than raising when the caller lacks it.';

revoke execute on function public.get_tenant_couriers(uuid) from public;
grant execute on function public.get_tenant_couriers(uuid) to authenticated;
