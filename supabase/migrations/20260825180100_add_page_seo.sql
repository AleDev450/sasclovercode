-- Phase 08 - SEO + Metadata
-- Per-page overrides of the site-wide SEO.
--
-- SPEC: docs/specs/phase-08-seo-metadata.md sections 8, 10.

-- Nullable on purpose, and null is meaningful: it means "inherit from the
-- site". An empty string would mean "leave it blank", which is a different
-- instruction and one a business should be able to give. Defaulting these to ''
-- would have collapsed the two and made inheritance impossible to express.
alter table public.pages
  add column seo_title       text,
  add column seo_description text,
  add column og_image_path   text;

comment on column public.pages.seo_title is
  'Overrides the site title for this page. Null means inherit.';
comment on column public.pages.seo_description is
  'Overrides the site description for this page. Null means inherit.';
comment on column public.pages.og_image_path is
  'Storage path of the social image for this page. Null means inherit.';

alter table public.pages
  add constraint pages_seo_text_lengths check (
    coalesce(char_length(seo_title), 0) <= 120
    and coalesce(char_length(seo_description), 0) <= 320
  );

-- Tied to the page's OWN tenant, like every other asset reference in the
-- system (Phase 06 A6-2). `banners` and `products` are allowed here as well as
-- `branding`: a social image for a page is usually the banner it already shows.
alter table public.pages
  add constraint pages_og_image_path_own_tenant check (
    og_image_path is null
    or og_image_path ~ ('^tenants/' || tenant_id::text || '/(branding|banners|products)/')
  );

-- No new policies. These are columns of `pages`, so they are covered by the
-- policies that already govern it: public SELECT of published rows, and
-- content.manage for writes. Adding a column does not add a decision.
