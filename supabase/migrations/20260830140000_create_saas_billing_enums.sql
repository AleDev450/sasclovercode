-- Phase 22 - CloverCode Billing
-- The vocabulary of what CloverCode charges, and the commercial terms of a plan.
--
-- SPEC: docs/specs/phase-22-clovercode-billing.md section 8.
-- CLOVERCODE_MASTER.md sections 22, 33 (Phase 22), 39.
-- ADR-026 decisions 3 and 5.
--
-- The line that governs this whole phase is master section 22:
--
--   "Separar completamente: facturacion del restaurante / suscripcion que
--    CloverCode cobra al restaurante."
--
-- So nothing here touches `payments` (Phase 14, the customer paying the
-- restaurant) or `billing_documents` (Phase 17, the restaurant invoicing its
-- customer). TEST-2230 asserts that structurally over pg_constraint rather than
-- trusting the naming.

-- What can happen to one period's charge.
--
-- `failed` and `refunded` have no producer yet and are declared anyway
-- (KL-2207): adding a value to an enum later forces a review of every
-- historical row to decide what its absence meant. `failed` is what a payment
-- gateway writes; `refunded` is a decision nobody has taken.
create type public.saas_payment_status as enum (
  'pending',
  'paid',
  'failed',
  'refunded',
  'void'
);

comment on type public.saas_payment_status is
  'What happened to one period''s charge. `void` is a charge issued in error; it is never deleted.';

-- Why a subscription changed.
--
-- Seven types, and every one of them is written by a TRIGGER - never by a
-- caller (ADR-026 decision 4). Each row here is the consequence of a change in
-- `subscriptions` or `saas_payments`, so there is no legitimate manual entry
-- and therefore no INSERT policy at all.
create type public.subscription_event_type as enum (
  'created',
  'plan_changed',
  'status_changed',
  'period_advanced',
  'charge_issued',
  'payment_recorded',
  'payment_voided'
);

comment on type public.subscription_event_type is
  'Why a subscription changed. Written only by trigger (ADR-026 decision 4).';

-- ---------------------------------------------------------------------------
-- The commercial terms of a plan
-- ---------------------------------------------------------------------------

-- How long the trial lasts, how long the grace period is, and what currency
-- the price is in. All three are properties of the PRODUCT being sold, not of
-- each contract - and they sit next to `price_cents`, which is what makes a
-- commercial change one row instead of a migration.
alter table public.plans
  add column trial_days smallint not null default 0,
  add column grace_days smallint not null default 7,
  add column currency   text     not null default 'PEN';

comment on column public.plans.trial_days is
  'Days of trial a new subscription gets. Zero means charge from the first period.';
comment on column public.plans.grace_days is
  'Days after a charge falls due before the subscription is suspended.';
comment on column public.plans.currency is
  'The currency of price_cents. NOT tenant_settings.currency, which is what the restaurant charges ITS customers in (master section 22).';

alter table public.plans
  add constraint plans_trial_days_range check (trial_days between 0 and 365),
  -- Zero is legal and means "due today, suspended today". Harsh, and a real
  -- commercial choice somebody might make.
  add constraint plans_grace_days_range check (grace_days between 0 and 365),
  add constraint plans_currency_format check (currency ~ '^[A-Z]{3}$');

-- The shipped plans get a fortnight of trial and a week of grace. Neither
-- number is load-bearing: they are defaults a commercial decision will change,
-- which is the point of having them as data.
update public.plans set trial_days = 14 where code in ('starter', 'professional', 'enterprise');

-- ---------------------------------------------------------------------------
-- Cancelling at the end of a paid period
-- ---------------------------------------------------------------------------

-- The one thing a subscription needs that cannot be derived: a customer who
-- cancels today has paid until the end of the month, and cutting them off now
-- would be taking money for nothing.
--
-- The billing cycle is what actually cancels them, when the period runs out.
alter table public.subscriptions
  add column cancel_at_period_end boolean not null default false;

comment on column public.subscriptions.cancel_at_period_end is
  'Cancel when the paid period runs out, not now. The billing cycle applies it.';

-- Already cancelled and "cancel later" are contradictory states.
alter table public.subscriptions
  add constraint subscriptions_cancel_flag_consistent
    check (not (cancel_at_period_end and status = 'cancelled'));

-- ---------------------------------------------------------------------------
-- Every subscription gets a period end
-- ---------------------------------------------------------------------------

-- Phase 21 left `current_period_end` nullable and nothing wrote it (KL-2102).
-- The cycle needs it to know when a period is over, so every existing row gets
-- one now: a period that started when the Phase 21 migration ran, ending one
-- interval later.
--
-- Non-destructive by construction - it only fills a NULL, and the end is in the
-- future, so nothing becomes due the moment this deploys.
update public.subscriptions as s
set current_period_end = s.current_period_start
  + case p.interval when 'yearly' then interval '1 year' else interval '1 month' end
from public.plans as p
where p.code = s.plan_code
  and s.current_period_end is null;
