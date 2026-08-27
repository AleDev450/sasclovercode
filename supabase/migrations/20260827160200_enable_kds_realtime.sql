-- Phase 16 - Kitchen / KDS
-- Makes two tables eligible for Supabase Realtime's postgres_changes.
--
-- SPEC: docs/specs/phase-16-kitchen-kds.md sections 8, 11, 14.
-- ADR-020: Realtime here is a "please refetch" signal, not a data source.
--
-- This migration only widens WHICH tables may be watched. Row Level Security
-- (Phase 13's orders/order_items policies, unchanged) is what still decides
-- which connected client actually receives a given row's change - a
-- publication is not a bypass of RLS, it is a prerequisite for Realtime to
-- consider a table at all.
--
-- No RLS change needed here: `orders_select_member` and
-- `order_items_select_member` already gate on `orders.view`, and that is
-- exactly the read this phase needs Realtime to honour too.
--
-- A real Supabase project already has `supabase_realtime` (Supabase creates
-- it as part of the platform's own bootstrap). The test harness
-- (`src/tests/helpers/database.ts`, ADR-007) does not, since it only applies
-- this project's own migrations - so the publication is created here if
-- missing, making this migration portable across both rather than teaching
-- a shared test bootstrap file about one phase's own feature.
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end
$$;

alter publication supabase_realtime add table public.order_items;
alter publication supabase_realtime add table public.orders;
