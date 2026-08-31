-- Phase 22 - CloverCode Billing
-- What CloverCode charged a business for one period, and what happened to it.
--
-- SPEC: docs/specs/phase-22-clovercode-billing.md sections 8, 10, 11.
-- CLOVERCODE_MASTER.md sections 22, 33 (Phase 22), 37, 39.
-- ADR-026 decision 1.
--
-- ONE row per period, carrying both what was owed and what was received.
--
-- Phase 14 was explicit that an Order, a Payment and an Invoice are not the
-- same entity - and that is right THERE, where an order takes several payments
-- and an invoice covers several orders. Here the cardinalities are different: a
-- period produces one charge and that charge takes one payment. Splitting them
-- would be a mandatory 1:1 relationship, which is the definition of one table
-- too many (ADR-026 decision 1).
--
-- Every money column is an integer in the minor unit (ADR-015).

create table public.saas_payments (
  id                 uuid                       not null default gen_random_uuid(),
  tenant_id          uuid                       not null,
  subscription_id    uuid                       not null,

  -- A SNAPSHOT, not a foreign key. The charge says which plan was billed, and
  -- renaming that plan - or raising its price - cannot rewrite what was
  -- invoiced in March. Same reasoning as ADR-017 (line price), ADR-023 (zone
  -- name) and ADR-024 (discount label).
  plan_code_snapshot text                       not null,

  period_start       timestamptz                not null,
  period_end         timestamptz                not null,

  amount_cents       bigint                     not null,
  -- Copied from the plan for the same reason as the price. This is CloverCode's
  -- currency, never `tenant_settings.currency` (master section 22).
  currency           text                       not null,

  status             public.saas_payment_status not null default 'pending',
  due_at             timestamptz                not null,
  paid_at            timestamptz,

  -- What a payment gateway would fill in the day one is contracted (KL-2204).
  -- Today a person types "transferencia" and the operation number.
  method             text,
  reference          text,
  notes              text,

  created_by         uuid,
  created_at         timestamptz                not null default now(),
  updated_at         timestamptz                not null default now(),

  constraint saas_payments_pkey primary key (id),

  constraint saas_payments_tenant_id_fkey
    foreign key (tenant_id) references public.tenants (id) on delete cascade,
  constraint saas_payments_subscription_id_fkey
    foreign key (subscription_id) references public.subscriptions (id) on delete cascade,
  constraint saas_payments_created_by_fkey
    foreign key (created_by) references auth.users (id) on delete set null,

  -- Idempotence of the billing cycle (master section 37), stated structurally
  -- rather than checked defensively: running the cycle twice makes the second
  -- charge a key violation, not a duplicated debt.
  constraint saas_payments_period_key unique (subscription_id, period_start),

  constraint saas_payments_plan_snapshot_length
    check (char_length(btrim(plan_code_snapshot)) between 1 and 40),
  constraint saas_payments_currency_format
    check (currency ~ '^[A-Z]{3}$'),
  -- Zero is legal: a courtesy plan issues a charge of nothing, which is born
  -- paid because there is nothing to collect.
  constraint saas_payments_amount_range
    check (amount_cents between 0 and 10000000000),

  constraint saas_payments_period_ordered
    check (period_end > period_start),

  -- Paid and its timestamp are the same fact, in both directions - the shape
  -- `orders` has used since Phase 13.
  constraint saas_payments_paid_at
    check ((status = 'paid') = (paid_at is not null)),

  constraint saas_payments_text_lengths check (
    coalesce(char_length(method), 0) <= 40
    and coalesce(char_length(reference), 0) <= 120
    and coalesce(char_length(notes), 0) <= 300
  )
);

comment on table public.saas_payments is
  'What CloverCode charged a business for one period, and what happened to that charge. NOT the restaurant''s own billing (master section 22).';
comment on column public.saas_payments.amount_cents is
  'Minor units (ADR-015). Copied from the plan when the charge is issued.';
comment on column public.saas_payments.plan_code_snapshot is
  'The plan as it read when billed. A snapshot, so a later price change never rewrites an old charge.';

-- The board a business sees, and the one Super Admin opens.
create index saas_payments_tenant_created_idx
  on public.saas_payments (tenant_id, created_at desc);

-- "What is overdue" - the predicate the cycle's last two steps run, and the
-- only one that matters at scale. Partial, because settled charges are the
-- overwhelming majority and none of them can ever be overdue.
create index saas_payments_pending_due_idx
  on public.saas_payments (due_at)
  where status = 'pending';

create trigger saas_payments_set_updated_at
  before update on public.saas_payments
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- tenant_id comes from the subscription, never from the client
-- ---------------------------------------------------------------------------

-- The same control every child table since Phase 11 applies: `tenant_id` is
-- precisely the value an attacker would supply, so it is not an input at all.
--
-- Here it matters less than usual - only a platform admin can write this table
-- - and it is done anyway, because "only an admin can reach it" is a policy
-- that could change and a derived column is a fact that cannot.
create or replace function public.derive_saas_payment_tenant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select s.tenant_id into new.tenant_id
  from public.subscriptions as s
  where s.id = new.subscription_id;

  if new.tenant_id is null then
    raise exception 'Subscription not found.' using errcode = 'P0002';
  end if;

  new.created_by := coalesce(new.created_by, (select auth.uid()));

  -- A charge of nothing is settled the moment it exists: there is nothing to
  -- collect, and leaving it `pending` would eventually suspend a business over
  -- a debt of zero.
  if new.amount_cents = 0 and new.status = 'pending' then
    new.status := 'paid';
    new.paid_at := coalesce(new.paid_at, now());
    new.method := coalesce(new.method, 'cortesia');
  end if;

  return new;
end;
$$;

comment on function public.derive_saas_payment_tenant() is
  'Derives tenant_id from the subscription, and settles a zero charge on sight.';

create trigger saas_payments_derive_tenant
  before insert on public.saas_payments
  for each row execute function public.derive_saas_payment_tenant();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.saas_payments enable row level security;

-- A business reads what it owes and what it paid. It needs this for UC-2204,
-- and reading it collects nothing.
--
-- Predicated on membership rather than a permission, exactly as `subscriptions`
-- was in Phase 21 and for the same reason (ADR-025 decision 6): there is no
-- permission for it, deliberately, because charging is CloverCode's business
-- and not a tenant role.
create policy saas_payments_select_member
  on public.saas_payments for select to authenticated
  using (public.is_tenant_member(tenant_id) or public.is_platform_admin());

-- Writing is platform-admin only, in both directions. An owner who could mark
-- their own charges paid would not be behind a paywall at all.
create policy saas_payments_platform_insert
  on public.saas_payments for insert to authenticated
  with check (public.is_platform_admin());

create policy saas_payments_platform_update
  on public.saas_payments for update to authenticated
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

-- No DELETE policy. This is the record of what was charged; a charge issued in
-- error is voided, which leaves the row and its reason where anybody can see
-- them - the same posture `orders` and `billing_documents` already take.
