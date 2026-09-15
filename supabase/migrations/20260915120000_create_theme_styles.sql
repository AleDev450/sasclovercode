-- A theme stops being three colours and becomes a design.
--
-- WHAT WAS WRONG. `tenant_themes` held three colours, a font key and a radius,
-- and the gallery on top of it offered nine palettes. Nine palettes of ONE
-- design: every tenant site had the same system font, the same spacing, the
-- same square photographs and the same shape, because those are the things the
-- table could not express. The visible result was that "elige tu tema" changed
-- the colour of the buttons and nothing a visitor judges a restaurant by.
--
-- WHAT THIS ADDS. One column. `style` names a complete design language -
-- display face, vertical rhythm, photographic ratio, elevation, the tracking of
-- an overline - held as literals in `src/modules/seo/theme.ts` under
-- `SITE_STYLES`. Three values, all three restaurants, deliberately far apart:
--
--   atelier  alta cocina - near-black page, Cormorant, square corners, portrait
--            photography, enormous vertical rhythm.
--   brasa    parrilla and criollo - bone page, Fraunces, cards with weight,
--            wide landscape photography.
--   marea    cevicheria and cocina marina - linen page, Playfair over a
--            grotesk, soft corners, square photography.
--
-- WHY AN ENUM-SHAPED TEXT COLUMN AND NOT A `jsonb` OF TOKENS. A style carries
-- font stacks, gradients and lengths, and a stored token set is a stylesheet
-- assembled from stored text - exactly the injection surface the header of
-- `theme.ts` spends two paragraphs refusing. A key from a closed list lets the
-- application look the tokens up among its own literals, so widening what a
-- site can LOOK like widens nothing about what a site can INJECT.
--
-- SPEC: this closes the gap Phase 06 left open and Phase 08 inherited.

-- ---------------------------------------------------------------------------
-- The style column
-- ---------------------------------------------------------------------------

-- Added with a default of 'brasa' and then re-defaulted to 'atelier', which is
-- two statements doing two different jobs:
--
--   * EXISTING rows get 'brasa'. Not because those businesses chose a grill,
--     but because of the three it is closest to what their site rendered as
--     yesterday - cards with a shadow, near-landscape photographs, a moderate
--     rhythm. A column cannot be added without giving every existing row a
--     value, and when the choice is forced the right one is the smallest visible
--     change to a site somebody is already running. Their colours are not
--     touched at all.
--
--   * NEW rows get 'atelier', the flagship and what `DEFAULT_PRESET_ID` says a
--     business starts from.
alter table public.tenant_themes
  add column style text not null default 'brasa';

alter table public.tenant_themes
  alter column style set default 'atelier';

alter table public.tenant_themes
  add constraint tenant_themes_style_allowed
    check (style in ('atelier', 'brasa', 'marea'));

comment on column public.tenant_themes.style is
  'Design language key. Resolved against SITE_STYLES in src/modules/seo/theme.ts; '
  'never interpolated into CSS.';

-- ---------------------------------------------------------------------------
-- Real typefaces
-- ---------------------------------------------------------------------------

-- The five allowed font keys were `system`, `inter`, `poppins`, `lora` and
-- `roboto`, none of which was ever DOWNLOADED - the renderer emitted a bare
-- family name and let the visitor's machine decide. Practically nobody has Lora
-- installed, so every one of the five resolved to the same operating-system
-- sans and the field did nothing. The five families are now self-hosted at
-- build time (`src/modules/seo/fonts.ts`), and these are the keys that name
-- them.
--
-- The three legacy keys stay allowed. Rows written before today still hold
-- them, and dropping a value a live row contains would make that row
-- unwritable - a business whose theme could never be saved again.
alter table public.tenant_themes
  drop constraint tenant_themes_font_family_allowed;

alter table public.tenant_themes
  add constraint tenant_themes_font_family_allowed
    check (
      font_family in (
        -- Body faces a theme can be set in.
        'system', 'inter', 'jost', 'dm-sans',
        -- Display faces, for a business that wants its body copy in a serif too.
        'cormorant', 'playfair', 'fraunces',
        -- Legacy, kept so existing rows remain writable.
        'poppins', 'lora', 'roboto'
      )
    );

-- ---------------------------------------------------------------------------
-- What a new business is born looking like
-- ---------------------------------------------------------------------------

-- Migration 20260914140000 set these to the "Clover" preset, which the gallery
-- no longer offers. `THEME_DEFAULTS` in `src/modules/seo/theme.ts` is the
-- fallback the renderer uses when the row cannot be read, and
-- `src/tests/unit/seo-theme.test.ts` asserts the two are equal - if they drift,
-- a tenant that never opened the editor renders one way on its site and another
-- in the preview.
--
-- EXISTING ROWS ARE NOT BACKFILLED, for the reason that migration gave and this
-- one keeps: a business that chose teal two months ago chose it, and repainting
-- live customer websites to make a constant tidy would be the wrong trade by a
-- wide margin. This decides only what the NEXT business gets.
alter table public.tenant_themes
  alter column primary_color    set default '#e8d3a9',
  alter column accent_color     set default '#d9a441',
  alter column background_color set default '#121214',
  alter column font_family      set default 'jost',
  alter column border_radius    set default 'none';

comment on column public.tenant_themes.primary_color is
  'Brand colour. Defaults to the "Atelier" theme, the one a new business starts on.';

-- ---------------------------------------------------------------------------
-- The platform can set a theme
-- ---------------------------------------------------------------------------

-- Additive, like every other policy in `20260825140100_create_platform_policies`:
-- PostgreSQL combines permissive policies with OR and `is_platform_admin()` is
-- false for a normal user, so nothing a tenant member can see or write changes.
--
-- WHY AN OPERATOR NEEDS THIS. A business is sold and set up before its owner
-- ever signs in, and the theme is part of what is being set up - it is the first
-- thing the owner sees and the thing they are least equipped to choose from a
-- blank dashboard. Onboarding happens in the super-admin, so the theme has to be
-- settable there.
--
-- UPDATE, not ALL. There is no INSERT and no DELETE here for the same reason
-- the tenant-side policy has none: the row is an invariant created by
-- `create_tenant_defaults()`, and nothing in the product may destroy it.
create policy tenant_themes_platform_select
  on public.tenant_themes for select to authenticated
  using (public.is_platform_admin());

create policy tenant_themes_platform_update
  on public.tenant_themes for update to authenticated
  using (public.is_platform_admin())
  with check (public.is_platform_admin());
