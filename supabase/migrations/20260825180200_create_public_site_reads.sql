-- Phase 08 - SEO + Metadata
-- What an anonymous visitor may read in order to be shown a complete website.
--
-- SPEC: docs/specs/phase-08-seo-metadata.md sections 10, 11.
--
-- Phase 07 made the CONTENT of a site public. Three things a finished page also
-- needs were still readable only by members, which is why this migration
-- exists:
--
--   the theme        - a site rendered with the platform's default colours is
--                      not that business's site
--   the identity     - the trade name, for the title and the structured data
--   the image files  - every asset in the bucket
--
-- The last one was a real defect, not a gap: a public website whose images
-- nobody outside the company can load. It is fixed at the bottom of this file.

-- ---------------------------------------------------------------------------
-- Theme
-- ---------------------------------------------------------------------------

-- The whole row is public, and that is not a concession: a theme IS what the
-- visitor sees. Colours, font and border radius are visible in the rendered
-- page, and the two paths are the logo and the favicon, both of which the
-- browser is about to fetch.
--
-- `anon` AND `authenticated`, for the reason the Phase 07 audit established
-- (A7-1): a signed-in stranger is `authenticated`, and granting only `anon`
-- makes the site render differently - or not at all - for anyone with a
-- session.
create policy tenant_themes_select_public
  on public.tenant_themes for select to anon, authenticated
  using (public.is_tenant_public(tenant_id));

-- ---------------------------------------------------------------------------
-- Public business identity
-- ---------------------------------------------------------------------------

-- `tenant_settings` deliberately gets NO public policy.
--
-- The row holds the RUC, the legal name and the contact email next to the trade
-- name. A row-level policy is all-or-nothing - PostgreSQL RLS cannot hide a
-- column - so making the trade name public that way would publish the tax
-- identity of every business on the platform.
--
-- A function returns only the fields a website displays anyway: how the
-- business calls itself, where it is, and the phone it wants to be called on.
-- The fiscal fields never leave the dashboard.
create or replace function public.get_public_business_identity(p_tenant_id uuid)
returns table (
  trade_name   text,
  address_line text,
  district     text,
  city         text,
  phone        text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce(s.trade_name, t.name),
    s.address_line,
    s.district,
    s.city,
    s.phone
  from public.tenants as t
  left join public.tenant_settings as s on s.tenant_id = t.id
  where t.id = p_tenant_id
    and t.status = 'active';
$$;

comment on function public.get_public_business_identity(uuid) is
  'The public-facing identity of a business. Never returns tax_id, legal_name '
  'or contact_email: those are dashboard-only.';

revoke execute on function public.get_public_business_identity(uuid) from public;
grant execute on function public.get_public_business_identity(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Primary domain
-- ---------------------------------------------------------------------------

-- The canonical URL has to be absolute and it has to be the SAME URL whichever
-- hostname the visitor arrived on - that is the entire point of a canonical. So
-- it is built from the tenant's primary domain read from the database, never
-- from the Host header of the request: two hostnames serving one site would
-- otherwise declare two canonicals and compete with each other in the index.
--
-- Prefers the primary domain, then any other verified one, and returns null
-- when a tenant has none (the caller falls back to the platform domain).
create or replace function public.get_tenant_primary_domain(p_tenant_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select d.domain
  from public.tenant_domains as d
  where d.tenant_id = p_tenant_id
    and d.verification_status = 'active'
  order by d.is_primary desc, d.type asc, d.domain asc
  limit 1;
$$;

comment on function public.get_tenant_primary_domain(uuid) is
  'The domain a tenant canonicalises to. One row in, at most one value out.';

revoke execute on function public.get_tenant_primary_domain(uuid) from public;
grant execute on function public.get_tenant_primary_domain(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Public assets
-- ---------------------------------------------------------------------------

-- The folder an object lives in, or null when the path is not ours.
--
-- `storage.foldername` drops the file name and returns the directory segments,
-- so for `tenants/{id}/branding/logo.png` the third element is the folder.
create or replace function public.storage_path_folder(p_name text)
returns text
language sql
immutable
set search_path = ''
as $$
  select (storage.foldername(p_name))[3];
$$;

comment on function public.storage_path_folder(text) is
  'Folder segment of a tenant asset path (branding, banners, products, documents).';

revoke execute on function public.storage_path_folder(text) from public;
grant execute on function public.storage_path_folder(text) to anon, authenticated;

-- `storage_path_tenant_id` was granted to `authenticated` only, because in
-- Phase 06 no anonymous caller had any business touching the bucket. The policy
-- below is evaluated for `anon`, and a policy calling a function the role may
-- not execute fails the whole query rather than returning no rows.
grant execute on function public.storage_path_tenant_id(text) to anon;

-- Anonymous read of the assets a public website actually shows.
--
-- This closes a real defect. The bucket is private and Phase 06 gave it one
-- read policy, for members. Phase 07 then built public websites that render
-- images from it: `signAssetPaths` runs as the VISITOR, who is `anon`, so every
-- logo, banner and product photo on every public site failed to sign and was
-- silently omitted. It looked correct to anyone testing while signed in, which
-- is how it survived. It also would have taken the Phase 08 og:image and
-- favicon with it, since the crawler that fetches them has no session at all.
--
-- Three folders, not four. `documents` is excluded on purpose: it holds
-- invoices and the like, and nothing on a public page renders from it.
create policy tenant_assets_select_public
  on storage.objects for select to anon, authenticated
  using (
    bucket_id = 'tenant-assets'
    and public.storage_path_tenant_id(name) is not null
    and public.storage_path_folder(name) in ('branding', 'banners', 'products')
    and public.is_tenant_public(public.storage_path_tenant_id(name))
  );
