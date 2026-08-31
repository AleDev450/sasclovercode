-- Phase 22 - CloverCode Billing
-- Everything that ever happened to a subscription.
--
-- SPEC: docs/specs/phase-22-clovercode-billing.md sections 8, 11, 16.
-- CLOVERCODE_MASTER.md sections 17, 33 (Phase 22).
-- ADR-026 decision 4.
--
-- This is the table that answers "why is this business suspended?" without
-- anybody opening a log file.
--
-- It is the first table in this project with NO write policy at all - not even
-- for a platform admin. Five SECURITY DEFINER triggers write it, and they run
-- as the owner so they do not pass through RLS.
--
-- The difference with `loyalty_transactions` (Phase 20), which does accept
-- INSERT, is that that ledger takes legitimate manual entries - a campaign, an
-- adjustment - and this one does not: every row here is the consequence of a
-- change in another table. A row nobody can write is a row nobody can forge.

create table public.subscription_events (
  id              uuid                            not null default gen_random_uuid(),
  tenant_id       uuid                            not null,
  subscription_id uuid                            not null,

  type            public.subscription_event_type  not null,

  -- Filled according to `type`. A status change carries statuses, a plan change
  -- carries plans, a charge event carries the charge. Nullable columns rather
  -- than a jsonb blob, because master section 7 asks for a relational structure
  -- when one fits - and here one fits exactly.
  from_status     public.subscription_status,
  to_status       public.subscription_status,
  from_plan       text,
  to_plan         text,
  saas_payment_id uuid,

  detail          text,

  -- auth.uid() is NULL for a cycle run from a SQL console, and that is recorded
  -- honestly rather than attributed to nobody in particular.
  actor_id        uuid,
  created_at      timestamptz                     not null default now(),

  constraint subscription_events_pkey primary key (id),

  constraint subscription_events_tenant_id_fkey
    foreign key (tenant_id) references public.tenants (id) on delete cascade,
  constraint subscription_events_subscription_id_fkey
    foreign key (subscription_id) references public.subscriptions (id) on delete cascade,
  -- SET NULL rather than CASCADE: `saas_payments` has no DELETE policy, so this
  -- never fires in practice, and if a charge ever did go the history of it
  -- happening must not go with it.
  constraint subscription_events_payment_fkey
    foreign key (saas_payment_id) references public.saas_payments (id) on delete set null,
  constraint subscription_events_actor_fkey
    foreign key (actor_id) references auth.users (id) on delete set null,

  constraint subscription_events_plan_lengths check (
    coalesce(char_length(from_plan), 0) <= 40
    and coalesce(char_length(to_plan), 0) <= 40
  ),
  constraint subscription_events_detail_length
    check (detail is null or char_length(btrim(detail)) between 1 and 300),

  -- A status change that changes nothing is not an event.
  constraint subscription_events_status_moved
    check (type <> 'status_changed' or from_status is distinct from to_status),
  constraint subscription_events_plan_moved
    check (type <> 'plan_changed' or from_plan is distinct from to_plan)
);

comment on table public.subscription_events is
  'Append-only trail of a subscription. Written ONLY by trigger - there is no INSERT policy (ADR-026).';

create index subscription_events_subscription_idx
  on public.subscription_events (subscription_id, created_at desc);

create index subscription_events_tenant_idx
  on public.subscription_events (tenant_id, created_at desc);

-- ---------------------------------------------------------------------------
-- The five triggers that write it
-- ---------------------------------------------------------------------------

-- 1/5. A subscription comes into existence.
create or replace function public.record_subscription_created()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.subscription_events
    (tenant_id, subscription_id, type, to_status, to_plan, actor_id)
  values (
    new.tenant_id, new.id, 'created', new.status, new.plan_code, (select auth.uid())
  );
  return null;
end;
$$;

comment on function public.record_subscription_created() is
  'Writes the `created` event when a tenant is provisioned a subscription.';

create trigger subscriptions_record_created
  after insert on public.subscriptions
  for each row execute function public.record_subscription_created();

-- 2/5. The plan changed.
create or replace function public.record_subscription_plan_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.plan_code = old.plan_code then
    return null;
  end if;

  insert into public.subscription_events
    (tenant_id, subscription_id, type, from_plan, to_plan, actor_id)
  values (
    new.tenant_id, new.id, 'plan_changed', old.plan_code, new.plan_code, (select auth.uid())
  );
  return null;
end;
$$;

comment on function public.record_subscription_plan_change() is
  'Writes `plan_changed` with the plan it came from and the one it went to.';

create trigger subscriptions_record_plan_change
  after update of plan_code on public.subscriptions
  for each row execute function public.record_subscription_plan_change();

-- 3/5. The status changed.
--
-- Covers everything: a trial ending, an unpaid charge, a suspension, a
-- reactivation, a cancellation. They are all one kind of fact - "it moved from
-- here to there" - and giving each its own event type would have meant a
-- vocabulary that the reader has to learn instead of read.
create or replace function public.record_subscription_status_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = old.status then
    return null;
  end if;

  insert into public.subscription_events
    (tenant_id, subscription_id, type, from_status, to_status, actor_id)
  values (
    new.tenant_id, new.id, 'status_changed', old.status, new.status, (select auth.uid())
  );
  return null;
end;
$$;

comment on function public.record_subscription_status_change() is
  'Writes `status_changed`. Covers trials ending, suspensions, reactivations and cancellations alike.';

create trigger subscriptions_record_status_change
  after update of status on public.subscriptions
  for each row execute function public.record_subscription_status_change();

-- 4/5. The period rolled over.
create or replace function public.record_subscription_period_advance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.current_period_start = old.current_period_start then
    return null;
  end if;

  insert into public.subscription_events
    (tenant_id, subscription_id, type, detail, actor_id)
  values (
    new.tenant_id,
    new.id,
    'period_advanced',
    'Periodo hasta ' || coalesce(to_char(new.current_period_end, 'YYYY-MM-DD'), 'sin fin'),
    (select auth.uid())
  );
  return null;
end;
$$;

comment on function public.record_subscription_period_advance() is
  'Writes `period_advanced` when the billing period rolls over.';

create trigger subscriptions_record_period_advance
  after update of current_period_start on public.subscriptions
  for each row execute function public.record_subscription_period_advance();

-- 5/5. A charge was issued, paid or voided.
--
-- One function for the three, because they are the same fact about the same
-- row at three moments, and splitting them would mean three triggers reading
-- the same columns.
create or replace function public.record_saas_payment_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_type public.subscription_event_type;
begin
  if tg_op = 'INSERT' then
    v_type := 'charge_issued';
  elsif new.status = old.status then
    return null;
  elsif new.status = 'paid' then
    v_type := 'payment_recorded';
  elsif new.status in ('void', 'refunded', 'failed') then
    v_type := 'payment_voided';
  else
    -- Back to `pending` from anywhere is not a fact this vocabulary has a word
    -- for, and no function produces it. Recorded as nothing rather than as a
    -- lie.
    return null;
  end if;

  insert into public.subscription_events
    (tenant_id, subscription_id, type, saas_payment_id, detail, actor_id)
  values (
    new.tenant_id,
    new.subscription_id,
    v_type,
    new.id,
    new.plan_code_snapshot || ' · ' || (new.amount_cents::numeric / 100)::text
      || ' ' || new.currency,
    (select auth.uid())
  );
  return null;
end;
$$;

comment on function public.record_saas_payment_event() is
  'Writes charge_issued / payment_recorded / payment_voided from one place.';

create trigger saas_payments_record_event
  after insert or update of status on public.saas_payments
  for each row execute function public.record_saas_payment_event();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.subscription_events enable row level security;

-- A business may read its own history: it is the answer to "why was I
-- suspended", and that answer belongs to whoever it happened to.
create policy subscription_events_select_member
  on public.subscription_events for select to authenticated
  using (public.is_tenant_member(tenant_id) or public.is_platform_admin());

-- No INSERT, no UPDATE, no DELETE - for ANYBODY, platform admin included.
--
-- This is the line that makes the trail evidence rather than decoration. The
-- five triggers above are SECURITY DEFINER and run as the owner, so they write
-- without a policy; nothing else can write at all.
