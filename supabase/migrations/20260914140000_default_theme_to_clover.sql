-- A new business starts on the theme the gallery calls "Clover".
--
-- THE DEFECT THIS CLOSES. `tenant_themes` defaulted to `#16a34a` on `#0ea5e9`
-- with the system font and a medium radius - a palette that exists nowhere in
-- the product. `DEFAULT_PRESET_ID` in `modules/settings/theme-presets.ts` says
-- a business starts from Clover, `create_tenant_defaults` never applied it, and
-- nothing reconciled the two. So provisioning a tenant produced a site in a
-- ninth palette nobody designed, the theme gallery showed no card as selected
-- because the stored values matched no preset, and the owner's first impression
-- of the product was a colour scheme they could not find in the list.
--
-- Changing the DEFAULT rather than backfilling is deliberate. Existing rows are
-- left exactly as they are: a business that chose green two months ago chose
-- it, and a migration that repainted live customer websites to make a constant
-- tidy would be the wrong trade by a wide margin. This only decides what the
-- NEXT business gets.
--
-- Mirrored by `THEME_DEFAULTS` in `src/modules/seo/theme.ts`, which is the
-- fallback the renderer uses when the row cannot be read, and asserted equal by
-- `src/tests/unit/seo-theme.test.ts`. If the two drift, a tenant that never
-- opened the editor renders one way on its site and another in the preview.

alter table public.tenant_themes
  alter column primary_color    set default '#0f766e',
  alter column accent_color     set default '#14b8a6',
  alter column background_color set default '#ffffff',
  alter column font_family      set default 'inter',
  alter column border_radius    set default 'lg';

comment on column public.tenant_themes.primary_color is
  'Brand colour. Defaults to the "Clover" preset, not to an unnamed green.';
