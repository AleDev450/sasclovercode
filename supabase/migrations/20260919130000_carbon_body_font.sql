-- Phase 29 (continuation) - Carbon's body face
-- The default body font of a new business moves from Inter to DM Sans.
--
-- WHY A MIGRATION OF ITS OWN, and not an edit to 20260919120000 where the
-- default was set: that file has already run against the production project.
-- An applied migration is history - editing it changes nothing in any database
-- that ran it and makes every fresh one disagree with production.
--
-- WHY THE FONT MOVED. Carbon was shown to the owner set in Inter for body and
-- headings alike, and the verdict was "web de universitario". The headings went
-- to Archivo condensed (a style token, `modules/seo/theme.ts`, no schema
-- involved); the body is a stored column, so its default moves here. DM Sans
-- is already in `tenant_themes_font_family_allowed` - it is Marea's body face -
-- so the CHECK needs no change.
--
-- Existing rows are untouched, as with every default change in this table: a
-- business that already has a theme keeps it until its owner says otherwise.

alter table public.tenant_themes
  alter column font_family set default 'dm-sans';
