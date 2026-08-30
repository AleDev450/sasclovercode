-- Phase 20 - Loyalty + Promotions
-- The vocabulary of a discount and of a point.
--
-- SPEC: docs/specs/phase-20-loyalty-promotions.md section 8.
-- CLOVERCODE_MASTER.md section 33 (Phase 20).

-- Three ways to take money off a bill, and they are genuinely different
-- calculations rather than three names for one:
--
--   percentage     depends on the subtotal
--   fixed_amount   does not depend on anything
--   free_delivery  depends on the SHIPPING, which is a different number
--                  entirely (Phase 19) and is zero when there is no delivery
--
-- ADR-024 decision 5 explains why the list stops here and does not grow into a
-- rules engine ("2x1", combos, per-product conditions).
create type public.promotion_type as enum (
  'percentage',
  'fixed_amount',
  'free_delivery'
);

comment on type public.promotion_type is
  'How a promotion computes its discount. Master section 33 (Phase 20).';

-- The five kinds of movement a points ledger records.
--
-- Master names three of them directly in its example - "+100 order",
-- "-50 reward", "+20 campaign" - which are `earn`, `redeem` and `campaign`.
-- The other two are what an append-only ledger needs in order to stay
-- append-only:
--
--   adjustment  a correction. Without it, fixing a mistake would mean editing
--               or deleting an entry, which is exactly what a ledger forbids.
--   expiry      points going stale. The type exists so that when a scheduler
--               exists (KL-2004) it writes a row that says what it is, rather
--               than an `adjustment` that hides why the points left.
create type public.loyalty_transaction_type as enum (
  'earn',
  'redeem',
  'campaign',
  'adjustment',
  'expiry'
);

comment on type public.loyalty_transaction_type is
  'Why points moved. earn/redeem/campaign are master section 33; adjustment and expiry keep the ledger append-only.';
