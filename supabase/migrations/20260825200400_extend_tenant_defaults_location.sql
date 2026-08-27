-- Phase 10 - Locations
-- Every tenant gets a branch, the way it already gets settings and a theme.
--
-- SPEC: docs/specs/phase-10-locations.md LO-05, FR-1015, TEST-1011.
--
-- Master section 33, Phase 10: "Incluso clientes de una sola sede utilizaran
-- una location." That is only true if somebody creates it, and it must be true
-- for every tenant however it came into existence - `provision_tenant`, a
-- platform operator's direct insert, or a fixture.
--
-- Which is exactly the argument Phase 06 made for settings and Phase 08 for the
-- SEO row, so this goes in the same trigger rather than becoming a fourth thing
-- two code paths have to remember.

-- Existing tenants first, so the invariant is true of the whole table and not
-- only of rows created from now on.
insert into public.locations (tenant_id, name)
select t.id, t.name
from public.tenants as t
where not exists (
  select 1 from public.locations as l where l.tenant_id = t.id
);

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

  -- Added in Phase 10.
  --
  -- Named after the business rather than "Principal" or "Sede 1": a one-branch
  -- business should never have to think about branches at all, and a list
  -- containing one entry with the company's own name reads as a fact rather
  -- than as a feature somebody has to configure.
  --
  -- The `on conflict` targets the unique index on (tenant_id, lower(name)), so
  -- a second run is a no-op rather than a duplicate.
  insert into public.locations (tenant_id, name)
  values (new.id, new.name)
  on conflict (tenant_id, lower(btrim(name))) do nothing;

  return new;
end;
$$;

comment on function public.create_tenant_defaults() is
  'Gives every new tenant its settings, theme, SEO row and first location, '
  'however it was created.';
