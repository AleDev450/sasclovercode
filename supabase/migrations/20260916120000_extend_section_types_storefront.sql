-- Phase 29 - Tienda online
-- Three section types for the restaurant home page.
--
-- SPEC: docs/specs/phase-29-storefront.md section 8.
--
--   slider       The home carousel: a desktop and a phone photograph per slide,
--                uploaded by the owner. Zero slides is valid and renders the
--                brand cover instead (FR2910).
--   shortcuts    The "doors" under the cover: cards pointing at the menu, the
--                delivery zones, or any page of the site.
--   bestsellers  "Los mas pedidos": products ranked by what actually sold.
--
-- In a migration of their own because `alter type ... add value` cannot be
-- USED in the transaction that adds it. Nothing in this phase uses the values in
-- SQL, but keeping the enum change alone means a later migration that does will
-- never trip over it.

alter type public.section_type add value if not exists 'slider';
alter type public.section_type add value if not exists 'shortcuts';
alter type public.section_type add value if not exists 'bestsellers';
