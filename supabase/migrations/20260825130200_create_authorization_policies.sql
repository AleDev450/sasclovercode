-- Phase 03 - Authorization + RLS
-- Opens the deny-by-default posture of Phases 01 and 02, once and in one place.
--
-- SPEC: docs/specs/phase-03-authorization-rls.md sections 8, 10, 11.

-- ---------------------------------------------------------------------------
-- tenants
-- ---------------------------------------------------------------------------

-- Phase 01 left `tenants` with RLS on and no policies, so a member could not
-- read the name of their own business. This is the narrowest opening that
-- fixes it: a member sees the tenants they belong to, and nothing else.
--
-- Still no INSERT / UPDATE / DELETE policy: creating and suspending tenants is
-- the platform operator's job (Phase 04), not a tenant member's.
create policy tenants_select_member
  on public.tenants
  for select
  to authenticated
  using (public.is_tenant_member(id));

-- ---------------------------------------------------------------------------
-- tenant_members
-- ---------------------------------------------------------------------------

-- `tenant_members_select_own` already exists from Phase 02: a user always sees
-- their own membership rows. This adds the roster, gated by a permission.
--
-- Two separate policies rather than one with an OR: PostgreSQL combines
-- permissive policies with OR anyway, and keeping them apart means each can be
-- read, tested and revoked on its own.
create policy tenant_members_select_roster
  on public.tenant_members
  for select
  to authenticated
  using (public.has_permission(tenant_id, 'members.view'));

-- --- Writes ---------------------------------------------------------------
--
-- The owner guard below is the anti-escalation rule. Without it, any admin
-- holding `members.manage` could hand themselves `role = 'owner'` and take over
-- the business. It is enforced in the database rather than in the application
-- because a Server Action is not the only way a row can be written.

create policy tenant_members_insert_manager
  on public.tenant_members
  for insert
  to authenticated
  with check (
    public.has_permission(tenant_id, 'members.manage')
    -- Only an owner may mint another owner.
    and (
      role <> 'owner'
      or public.has_permission(tenant_id, 'settings.manage')
    )
  );

create policy tenant_members_update_manager
  on public.tenant_members
  for update
  to authenticated
  -- USING decides which rows may be targeted; WITH CHECK decides what they may
  -- become. Both are needed: USING alone would let a manageable row be turned
  -- into an owner row.
  using (
    public.has_permission(tenant_id, 'members.manage')
    and (
      role <> 'owner'
      or public.has_permission(tenant_id, 'settings.manage')
    )
  )
  with check (
    public.has_permission(tenant_id, 'members.manage')
    and (
      role <> 'owner'
      or public.has_permission(tenant_id, 'settings.manage')
    )
  );

create policy tenant_members_delete_manager
  on public.tenant_members
  for delete
  to authenticated
  using (
    public.has_permission(tenant_id, 'members.manage')
    -- Removing an owner is an owner-level act.
    and (
      role <> 'owner'
      or public.has_permission(tenant_id, 'settings.manage')
    )
  );

-- Note on the owner guard: it keys off `settings.manage`, which the catalogue
-- grants to `owner` and to nobody else. Using the permission rather than
-- comparing `role = 'owner'` keeps the rule expressed in the same vocabulary as
-- everything else (master section 12: no scattered role comparisons), and means
-- a future re-grant of that permission moves the rule with it.
--
-- Known gap, documented in the SPEC as EC-306: nothing here prevents the LAST
-- owner from being removed, leaving a tenant nobody can administer. Expressing
-- that declaratively needs a statement-level trigger; it belongs with
-- provisioning in Phase 04, which is what creates the first owner.
