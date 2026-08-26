-- Phase 08 - SEO + Metadata
-- What each business tells search engines and social networks about itself.
--
-- SPEC: docs/specs/phase-08-seo-metadata.md sections 8, 10, 11.
-- CLOVERCODE_MASTER.md section 31.

create table public.tenant_seo (
  tenant_id           uuid        not null,
  site_title          text,
  site_description    text,
  og_title            text,
  og_description      text,
  -- Storage PATHS, not URLs. The bucket is private, so the URL is signed when
  -- the page renders (Phase 06 decision, unchanged here).
  og_image_path       text,
  twitter_image_path  text,
  robots_index        boolean     not null default true,
  google_verification text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint tenant_seo_pkey primary key (tenant_id),
  constraint tenant_seo_tenant_id_fkey
    foreign key (tenant_id) references public.tenants (id) on delete cascade,

  constraint tenant_seo_text_lengths check (
    coalesce(char_length(site_title), 0) <= 120
    and coalesce(char_length(site_description), 0) <= 320
    and coalesce(char_length(og_title), 0) <= 120
    and coalesce(char_length(og_description), 0) <= 320
  ),

  -- Emitted inside a <meta> tag, so anything that could close it is rejected.
  -- Google's token is alphanumeric with dashes and underscores.
  constraint tenant_seo_google_verification_format check (
    google_verification is null
    or google_verification ~ '^[A-Za-z0-9_-]{10,100}$'
  ),

  -- The image must live in THIS tenant's own folder.
  --
  -- Checking only the shape is what the Phase 06 audit caught (A6-2): a
  -- well-formed path into somebody else's folder was storable. A CHECK can
  -- reference another column of the same row, so it does not have to settle.
  constraint tenant_seo_image_paths_own_tenant check (
    (og_image_path is null
      or og_image_path ~ ('^tenants/' || tenant_id::text || '/(branding|banners)/'))
    and (twitter_image_path is null
      or twitter_image_path ~ ('^tenants/' || tenant_id::text || '/(branding|banners)/'))
  )
);

comment on table public.tenant_seo is
  'One row per tenant. What the business tells search engines and social networks.';

create trigger tenant_seo_set_updated_at
  before update on public.tenant_seo
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Every tenant has a SEO row
-- ---------------------------------------------------------------------------

-- Backfill, then extend the Phase 06 trigger so a tenant created any way at all
-- gets one. Same reasoning as the settings row: no read anywhere should have to
-- cope with the row being absent.
insert into public.tenant_seo (tenant_id)
select t.id from public.tenants as t
on conflict (tenant_id) do nothing;

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

  -- Added in Phase 08.
  insert into public.tenant_seo (tenant_id)
  values (new.id)
  on conflict (tenant_id) do nothing;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.tenant_seo enable row level security;

-- Read: public, exactly like the content it describes. Granted to `anon` AND
-- `authenticated` from the start - the Phase 07 audit (A7-1) found that
-- granting only `anon` makes a public site invisible to anyone who happens to
-- have a session, because a signed-in stranger matches neither policy.
create policy tenant_seo_select_public
  on public.tenant_seo for select to anon, authenticated
  using (public.is_tenant_public(tenant_id));

-- Members with content.view also read it while the business is suspended, so
-- the owner can still edit their SEO while the site is down.
create policy tenant_seo_select_member
  on public.tenant_seo for select to authenticated
  using (public.has_permission(tenant_id, 'content.view'));

-- UPDATE only: no INSERT, no DELETE.
--
-- The Phase 06 audit (A6-1) found that a `FOR ALL` policy let a business delete
-- the very row a trigger exists to guarantee, breaking its own dashboard with
-- no way back. The row is created by the trigger and edited here.
create policy tenant_seo_update_manager
  on public.tenant_seo for update to authenticated
  using (public.has_permission(tenant_id, 'content.manage'))
  with check (public.has_permission(tenant_id, 'content.manage'));
