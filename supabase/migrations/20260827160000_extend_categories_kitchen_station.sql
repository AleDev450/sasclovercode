-- Phase 16 - Kitchen / KDS
-- Which screen a category's items show up on.
--
-- SPEC: docs/specs/phase-16-kitchen-kds.md sections 8, 11.
-- CLOVERCODE_MASTER.md section 33 (Phase 16): "Preparar estaciones: kitchen,
-- bar, sushi, desserts."
--
-- On categories, not products: a menu is already organised by category
-- (Phase 11), and tagging four categories is a one-time setup far cheaper
-- than tagging every product. Defaults to 'kitchen' so every category from
-- every earlier phase keeps working with no data migration - an untagged
-- category's items land on the main board, not nowhere.

create type public.kitchen_station as enum ('kitchen', 'bar', 'sushi', 'desserts');

alter table public.categories
  add column kitchen_station public.kitchen_station not null default 'kitchen';

comment on column public.categories.kitchen_station is
  'Which kitchen screen shows this category''s items. Copied onto order_items at insert (Phase 16, ADR-020) - not looked up live, so a Realtime filter has a literal column to compare against.';
