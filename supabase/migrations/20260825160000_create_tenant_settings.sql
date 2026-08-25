-- Phase 06 - Business Settings + Theme
-- Everything that makes a business look like itself.
--
-- SPEC: docs/specs/phase-06-business-settings-theme.md sections 8, 10.

-- ---------------------------------------------------------------------------
-- tenant_settings
-- ---------------------------------------------------------------------------

-- `tenant_id` IS the primary key, not a foreign key beside a surrogate one.
-- One business has exactly one record: making that structural means there is no
-- way to end up with two, and no way to have one that belongs to nobody.
create table public.tenant_settings (
  tenant_id      uuid        not null,
  legal_name     text,
  trade_name     text,
  tax_id         text,
  contact_email  text,
  phone          text,
  whatsapp       text,
  address_line   text,
  district       text,
  city           text,
  -- ISO 4217. Only the CODE lives here: master section 39 governs amounts, and
  -- there are none in this table.
  currency       char(3)     not null default 'PEN',
  -- IANA name. Master section 40: timestamps stay in UTC; this is for DISPLAY.
  timezone       text        not null default 'America/Lima',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint tenant_settings_pkey primary key (tenant_id),
  constraint tenant_settings_tenant_id_fkey
    foreign key (tenant_id) references public.tenants (id) on delete cascade,

  -- Peruvian RUC. Optional, because a business may not have one yet, but if it
  -- is present it has to be a RUC: Phase 17 emits documents from this field.
  constraint tenant_settings_tax_id_format
    check (tax_id is null or tax_id ~ '^[0-9]{11}$'),

  constraint tenant_settings_currency_format check (currency ~ '^[A-Z]{3}$'),

  -- Shape only. Whether the zone actually exists is checked in the application
  -- with Intl: a CHECK cannot consult pg_timezone_names.
  constraint tenant_settings_timezone_format
    check (timezone ~ '^[A-Za-z][A-Za-z0-9_+-]*(/[A-Za-z0-9_+-]+)*$'),

  constraint tenant_settings_contact_email_format
    check (contact_email is null or contact_email ~ '^[^@ ]+@[^@ ]+[.][^@ ]+$'),

  constraint tenant_settings_text_lengths check (
    coalesce(char_length(legal_name), 0) <= 200
    and coalesce(char_length(trade_name), 0) <= 200
    and coalesce(char_length(phone), 0) <= 30
    and coalesce(char_length(whatsapp), 0) <= 30
    and coalesce(char_length(address_line), 0) <= 300
    and coalesce(char_length(district), 0) <= 100
    and coalesce(char_length(city), 0) <= 100
  )
);

comment on table public.tenant_settings is
  'One row per tenant. Fiscal identity, contact and locale.';

create trigger tenant_settings_set_updated_at
  before update on public.tenant_settings
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- tenant_themes
-- ---------------------------------------------------------------------------

create table public.tenant_themes (
  tenant_id        uuid        not null,
  primary_color    text        not null default '#16a34a',
  accent_color     text        not null default '#0ea5e9',
  background_color text        not null default '#ffffff',
  font_family      text        not null default 'system',
  border_radius    text        not null default 'md',
  -- The PATH inside the bucket, never a URL. A signed URL expires and a public
  -- one ties the row to a project domain; the URL is derived when reading.
  logo_path        text,
  favicon_path     text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint tenant_themes_pkey primary key (tenant_id),
  constraint tenant_themes_tenant_id_fkey
    foreign key (tenant_id) references public.tenants (id) on delete cascade,

  -- Lowercase 6-digit hex, enforced here so a colour can never reach a
  -- stylesheet as arbitrary text (SPEC AB-606).
  constraint tenant_themes_primary_color_format check (primary_color ~ '^#[0-9a-f]{6}$'),
  constraint tenant_themes_accent_color_format check (accent_color ~ '^#[0-9a-f]{6}$'),
  constraint tenant_themes_background_color_format check (background_color ~ '^#[0-9a-f]{6}$'),

  constraint tenant_themes_font_family_allowed
    check (font_family in ('system', 'inter', 'poppins', 'lora', 'roboto')),
  constraint tenant_themes_border_radius_allowed
    check (border_radius in ('none', 'sm', 'md', 'lg', 'full')),

  -- The path must point at THIS tenant's own folder.
  --
  -- Checking only the shape (`^tenants/{some-uuid}/branding/`) let an owner
  -- store a path into another business's folder. They could not read it - the
  -- storage policy requires membership - so it rendered as a broken image
  -- rather than a leak, but a cross-tenant reference should not be storable at
  -- all. A CHECK can reference another column of the same row, so it does not
  -- have to settle for the shape.
  constraint tenant_themes_paths_own_tenant check (
    (logo_path is null or logo_path ~ ('^tenants/' || tenant_id::text || '/branding/'))
    and (favicon_path is null or favicon_path ~ ('^tenants/' || tenant_id::text || '/branding/'))
  )
);

comment on table public.tenant_themes is
  'One row per tenant. Colours, typography and branding asset paths.';

create trigger tenant_themes_set_updated_at
  before update on public.tenant_themes
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- tenant_social_links
-- ---------------------------------------------------------------------------

create type public.social_platform as enum (
  'facebook', 'instagram', 'tiktok', 'x', 'youtube', 'linkedin'
);

-- A table and not a JSONB column: this is a repeating group with an order,
-- which master section 7 says should be relational.
create table public.tenant_social_links (
  id         uuid                   not null default gen_random_uuid(),
  tenant_id  uuid                   not null,
  platform   public.social_platform not null,
  url        text                   not null,
  position   smallint               not null default 0,
  created_at timestamptz            not null default now(),
  updated_at timestamptz            not null default now(),

  constraint tenant_social_links_pkey primary key (id),
  constraint tenant_social_links_tenant_id_fkey
    foreign key (tenant_id) references public.tenants (id) on delete cascade,

  -- One link per platform per business.
  constraint tenant_social_links_tenant_platform_key unique (tenant_id, platform),

  -- https only. An http link on a business site is a downgrade waiting to be
  -- exploited, and a `javascript:` one would be worse.
  constraint tenant_social_links_url_https check (url ~ '^https://'),
  constraint tenant_social_links_url_length check (char_length(url) between 12 and 300),
  constraint tenant_social_links_position_range check (position between 0 and 100)
);

create index tenant_social_links_tenant_position_idx
  on public.tenant_social_links (tenant_id, position);

create trigger tenant_social_links_set_updated_at
  before update on public.tenant_social_links
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.tenant_settings enable row level security;
alter table public.tenant_themes enable row level security;
alter table public.tenant_social_links enable row level security;

-- Read: any active member. A cashier needs the currency and the timezone to do
-- their job, so restricting reads to settings.manage would break the product.
--
-- Write: settings.manage, which the Phase 03 catalogue grants to `owner` alone.
--
-- No new predicates are introduced: these reuse the two functions audited in
-- Phase 03, so there is nothing new to get wrong.

create policy tenant_settings_select_member
  on public.tenant_settings for select to authenticated
  using (public.is_tenant_member(tenant_id));

-- UPDATE only, deliberately: no INSERT and no DELETE.
--
-- `FOR ALL` also grants DELETE, and an owner deleting their own settings row
-- broke the invariant the trigger exists to hold - every read then failed and
-- nothing in the product could recreate the row, because the trigger only fires
-- when a TENANT is inserted. A business could permanently break its own
-- dashboard with one request.
--
-- The row is created by the trigger and edited here. There is no legitimate
-- reason for the application to create or destroy it.
create policy tenant_settings_update_manager
  on public.tenant_settings for update to authenticated
  using (public.has_permission(tenant_id, 'settings.manage'))
  with check (public.has_permission(tenant_id, 'settings.manage'));

create policy tenant_themes_select_member
  on public.tenant_themes for select to authenticated
  using (public.is_tenant_member(tenant_id));

-- UPDATE only, for the same reason as tenant_settings above.
create policy tenant_themes_update_manager
  on public.tenant_themes for update to authenticated
  using (public.has_permission(tenant_id, 'settings.manage'))
  with check (public.has_permission(tenant_id, 'settings.manage'));

create policy tenant_social_links_select_member
  on public.tenant_social_links for select to authenticated
  using (public.is_tenant_member(tenant_id));

-- Social links DO get full write access: unlike settings and theme, they are a
-- collection a business genuinely creates and removes entries from.
create policy tenant_social_links_write_manager
  on public.tenant_social_links for all to authenticated
  using (public.has_permission(tenant_id, 'settings.manage'))
  with check (public.has_permission(tenant_id, 'settings.manage'));
