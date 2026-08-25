-- Phase 04 - Super Admin
-- Platform-wide access, added ALONGSIDE the Phase 03 tenant policies.
--
-- SPEC: docs/specs/phase-04-super-admin.md sections 8, 10.

-- PostgreSQL combines permissive policies with OR, so these are additive: a
-- normal user's visibility is byte-for-byte what it was before this migration,
-- because `is_platform_admin()` is false for them. Nothing here widens what a
-- tenant member can see.

-- --- tenants ---------------------------------------------------------------

create policy tenants_platform_select
  on public.tenants for select to authenticated
  using (public.is_platform_admin());

create policy tenants_platform_insert
  on public.tenants for insert to authenticated
  with check (public.is_platform_admin());

create policy tenants_platform_update
  on public.tenants for update to authenticated
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

-- No DELETE policy, for anybody, ever. Tenants are archived via `status`
-- (master section 41): a business's history is auditable data.

-- --- tenant_domains --------------------------------------------------------

create policy tenant_domains_platform_select
  on public.tenant_domains for select to authenticated
  using (public.is_platform_admin());

create policy tenant_domains_platform_insert
  on public.tenant_domains for insert to authenticated
  with check (public.is_platform_admin());

create policy tenant_domains_platform_update
  on public.tenant_domains for update to authenticated
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

-- --- tenant_members --------------------------------------------------------

-- READ ONLY for the platform, on purpose.
--
-- An operator can see who belongs to a business, because support needs it. An
-- operator cannot change it: who works at Sugu Rolls is Sugu Rolls' decision.
-- The one exception is the very first owner, created inside
-- `provision_tenant()` - without it a new business would be born unreachable.
create policy tenant_members_platform_select
  on public.tenant_members for select to authenticated
  using (public.is_platform_admin());
