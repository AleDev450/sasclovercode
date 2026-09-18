-- Phase 29 (continuation) - The `carbon` site style
-- One more value in the style enum, and the reason it exists.
--
-- SPEC: `src/modules/seo/theme.ts` (SITE_STYLES.carbon) carries the argument in
-- full. The short version: the three styles this column already allowed
-- differed in TASTE - serif or grotesk, dark or bone, square photograph or
-- tall - and none of them answered why a site this product generates looked
-- cheaper than one a restaurant had built by hand. Measured side by side the
-- difference was never the palette: every style drew headings at one size,
-- buttons with a flat fill, cards with a photograph stacked over a paragraph,
-- and nothing moved. `carbon` is that gap closed.
--
-- WHY THE OTHER THREE STAY. Businesses are running them today. A style is not
-- a gallery entry - the gallery is a starting point (`theme-presets.ts`, which
-- now offers `carbon` alone) - and dropping a value here would have rewritten
-- live sites on deploy, which is not a thing a migration gets to do.

alter table public.tenant_themes
  drop constraint tenant_themes_style_allowed;

alter table public.tenant_themes
  add constraint tenant_themes_style_allowed
    check (style in ('atelier', 'brasa', 'marea', 'carbon'));

comment on column public.tenant_themes.style is
  'Which design language the site is built in. Read by modules/seo/theme.ts; a tenant cannot author one.';

-- The default a NEW business is provisioned on moves with the gallery.
--
-- Existing rows are untouched on purpose: a column default applies to inserts,
-- and repainting every business that never opened the theme editor is a
-- decision for their owner, not for this file.
alter table public.tenant_themes
  alter column style          set default 'carbon',
  alter column primary_color  set default '#e36626',
  alter column accent_color   set default '#f2b23e',
  alter column background_color set default '#120b07',
  alter column font_family    set default 'inter',
  alter column border_radius  set default 'lg';
