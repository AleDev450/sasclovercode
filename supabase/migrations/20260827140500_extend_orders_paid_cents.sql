-- Phase 14 - Payments + Cash
-- How much of an order has actually been collected.
--
-- SPEC: docs/specs/phase-14-payments-cash.md sections 8, 11.
-- CLOVERCODE_MASTER.md section 14 (Phase 14).
--
-- Additive, matching how Phase 06/08/10 each extended an earlier table
-- (tenant_settings, the public identity function, locations) rather than
-- adding a fourth thing two code paths have to remember. Maintained by the
-- trigger on `payments` in the previous migration; nothing here computes it.

alter table public.orders
  add column paid_cents bigint not null default 0;

comment on column public.orders.paid_cents is
  'Sum of non-voided payments (Phase 14). Computed by trigger on public.payments; never sent by a client.';

-- The invariant that matters: an order can never appear to owe less than it
-- already collected. This also protects the OTHER direction Phase 13 left
-- open - FR-1315 allows editing lines while an order is still `pending`,
-- which can shrink total_cents after a payment already raised paid_cents.
-- Without this CHECK that edit would silently succeed and leave the order
-- inconsistent; with it, recompute_order_totals' own UPDATE is what gets
-- refused - which is the correct place to stop, since money already taken
-- is a fact a catalogue-side edit does not get to undo.
alter table public.orders
  add constraint orders_paid_within_total check (paid_cents between 0 and total_cents);
