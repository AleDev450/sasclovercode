-- Phase 07 - Navigation + CMS
-- Anonymous read of published content.
--
-- SPEC: docs/specs/phase-07-navigation-cms.md sections 10, 11.
--
-- This is the first time in CloverCode that a role with no session reads
-- business rows, so it gets its own migration rather than being buried among
-- the member policies.
--
-- The shape is deliberately different from every other policy in the system.
-- Everywhere else the question is "does THIS user belong to THIS tenant". A
-- visitor belongs to none, so the question here is "is this row publishable at
-- all": a published page, of an active business.
--
-- Which tenant the visitor should see is NOT decided here. It is decided by the
-- hostname resolver from Phase 01, in the application, and the renderer filters
-- by the tenant it resolved. Letting the database guess the visitor's tenant
-- would mean trusting something the visitor controls.

-- ---------------------------------------------------------------------------
-- is_tenant_public
-- ---------------------------------------------------------------------------

-- `tenants` is deny-by-default for `anon` (Phase 01), so the policies below
-- cannot read the tenant's status directly. This function can, and returns one
-- boolean rather than the row.
--
-- Only `active`. A suspended business keeps resolving by hostname so the
-- application can show a notice (Phase 01, EC-111), but it serves no content:
-- suspension that still served the site would not be a suspension.
create or replace function public.is_tenant_public(p_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.tenants as t
    where t.id = p_tenant_id
      and t.status = 'active'
  );
$$;

comment on function public.is_tenant_public(uuid) is
  'True when the tenant may serve public content. Active only: suspended and '
  'archived businesses resolve but publish nothing.';

revoke execute on function public.is_tenant_public(uuid) from public;
grant execute on function public.is_tenant_public(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Anonymous policies
-- ---------------------------------------------------------------------------

-- SELECT only. There is deliberately no anonymous INSERT, UPDATE or DELETE
-- policy anywhere in this migration: a visitor reads a website, and nothing
-- else.

create policy pages_select_public
  on public.pages for select to anon
  using (
    status = 'published'
    and public.is_tenant_public(tenant_id)
  );

-- A section is visible when its OWN page is published. Checking only the
-- section's `is_visible` would publish the sections of a draft page to anyone
-- who asked for them directly.
create policy page_sections_select_public
  on public.page_sections for select to anon
  using (
    is_visible
    and public.is_tenant_public(tenant_id)
    and exists (
      select 1
      from public.pages as p
      where p.id = page_id
        and p.status = 'published'
    )
  );

-- An entry is public when it is active, its tenant is active, and - for a page
-- link - the page it points at is published. Without that last clause the
-- navbar would advertise a draft: the link would 404, but its LABEL would leak
-- what the business is about to launch.
create policy navigation_items_select_public
  on public.navigation_items for select to anon
  using (
    is_active
    and public.is_tenant_public(tenant_id)
    and (
      link_type = 'external'
      or exists (
        select 1
        from public.pages as p
        where p.id = page_id
          and p.status = 'published'
      )
    )
  );
