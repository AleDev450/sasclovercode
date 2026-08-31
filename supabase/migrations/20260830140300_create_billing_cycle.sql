-- Phase 22 - CloverCode Billing
-- The cycle: trials, charges, grace and suspension.
--
-- SPEC: docs/specs/phase-22-clovercode-billing.md sections 12, 14.
-- CLOVERCODE_MASTER.md sections 33 (Phase 22), 37.
-- ADR-026 decisions 2 and 5.

-- ---------------------------------------------------------------------------
-- Every subscription starts with a period, and usually with a trial
-- ---------------------------------------------------------------------------

-- Phase 21 left `current_period_end` nullable and nothing wrote it (KL-2102),
-- so provisioning produced subscriptions with no period at all. The cycle needs
-- one to know when a period is over.
--
-- A BEFORE INSERT trigger rather than extending `create_tenant_defaults()`:
-- provisioning is not the only writer - a platform admin can create a
-- subscription too - and a derived column belongs where every writer passes.
--
-- BEHAVIOUR CHANGE from Phase 21, and a deliberate one: a new tenant now lands
-- in `trialing` rather than `active`, because every shipped plan carries 14
-- trial days. Nothing about access changes - `trialing` already granted every
-- module (ADR-025 decision 3) - but the row now says the truth about what the
-- business is paying, which is nothing yet.
create or replace function public.derive_subscription_period()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan public.plans%rowtype;
begin
  select * into v_plan from public.plans as p where p.code = new.plan_code;

  if v_plan.code is null then
    raise exception 'Plan not found.' using errcode = 'P0002';
  end if;

  -- Only when the caller said nothing about a trial AND left the status at its
  -- default. A platform admin who wants a subscription that bills immediately
  -- says so by passing a status, and gets exactly that.
  if new.trial_ends_at is null and new.status = 'active' and v_plan.trial_days > 0 then
    new.status := 'trialing';
    new.trial_ends_at := new.current_period_start + (v_plan.trial_days || ' days')::interval;
    -- During a trial the trial IS the period: when it ends, the cycle closes it
    -- and opens the first paid one.
    new.current_period_end := new.trial_ends_at;
  elsif new.current_period_end is null then
    new.current_period_end := new.current_period_start
      + case v_plan.interval when 'yearly' then interval '1 year' else interval '1 month' end;
  end if;

  return new;
end;
$$;

comment on function public.derive_subscription_period() is
  'Gives a new subscription its period, and its trial when the plan has one.';

create trigger subscriptions_derive_period
  before insert on public.subscriptions
  for each row execute function public.derive_subscription_period();

-- ---------------------------------------------------------------------------
-- The cycle
-- ---------------------------------------------------------------------------

-- ADR-026 decision 2. There is no scheduler in this project and building one
-- for this phase is the infrastructure section 47 says not to decide in
-- advance. So the LOGIC lives here, complete and tested, and the TRIGGER is a
-- button in Super Admin today and a `cron` calling the same function tomorrow -
-- without changing a line.
--
-- What makes that safe is idempotence, and it is structural: the unique index
-- on (subscription_id, period_start) turns a second issue of the same charge
-- into a key violation rather than a duplicated debt. This function catches
-- that violation and moves on, because "it was already issued" is the correct
-- outcome of a second run, not an error.
--
-- THE ORDER OF THE SIX STEPS IS NOT ARBITRARY:
--
--   1. close trials      before charging, or a business still on trial is billed
--   2. cancel the marked before advancing, or a period nobody will pay is opened
--   3. advance periods   before issuing, or the old period is billed twice
--   4. issue charges     before applying arrears, or a subscription with no
--                        charge yet is marked past_due
--   5. mark past_due     before suspending, because suspension starts there
--   6. suspend
--
-- TEST-2219 to TEST-2225 walk the whole sequence over one subscription so a
-- future reordering breaks a test instead of an invoice.
create or replace function public.run_subscription_billing()
returns table (
  subscriptions_advanced integer,
  charges_issued         integer,
  marked_past_due        integer,
  suspended              integer,
  cancelled              integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sub       record;
  v_plan      public.plans%rowtype;
  v_advanced  integer := 0;
  v_issued    integer := 0;
  v_past_due  integer := 0;
  v_suspended integer := 0;
  v_cancelled integer := 0;
  v_guard     integer;
  v_oldest    timestamptz;
begin
  if not public.is_platform_admin() then
    raise exception 'Only a platform admin may run the billing cycle.'
      using errcode = '42501';
  end if;

  for v_sub in
    select * from public.subscriptions
    where status <> 'cancelled'
    order by created_at
  loop
    select * into v_plan from public.plans as p where p.code = v_sub.plan_code;
    if v_plan.code is null then
      continue;
    end if;

    -- 1. A trial that ran out becomes a paying subscription, and its first
    --    period starts exactly where the trial ended - not "now", so a cycle
    --    run three days late does not give away three days.
    if v_sub.status = 'trialing'
       and v_sub.trial_ends_at is not null
       and v_sub.trial_ends_at <= now() then
      update public.subscriptions
      set status = 'active',
          current_period_start = v_sub.trial_ends_at,
          current_period_end = v_sub.trial_ends_at
            + case v_plan.interval when 'yearly' then interval '1 year' else interval '1 month' end
      where id = v_sub.id
      returning * into v_sub;

      v_advanced := v_advanced + 1;

    elsif v_sub.status = 'trialing' then
      -- Still on trial: nothing to charge, nothing to enforce.
      continue;
    end if;

    -- 2. Cancelling at the end of a paid period, applied when that period runs
    --    out. Before advancing, so a period nobody is going to pay is never
    --    opened.
    if v_sub.cancel_at_period_end
       and v_sub.current_period_end is not null
       and v_sub.current_period_end <= now() then
      update public.subscriptions
      set status = 'cancelled',
          cancelled_at = now(),
          cancel_at_period_end = false
      where id = v_sub.id;

      v_cancelled := v_cancelled + 1;
      continue;
    end if;

    if v_sub.status not in ('active', 'past_due') then
      -- `suspended` keeps its debt and stops accruing new periods. Charging a
      -- business whose service is off would be billing for nothing.
      continue;
    end if;

    -- 3 + 4. Issue the current period's charge, then roll forward through any
    --        period that already ended, charging for each. A business whose
    --        cycle was not run for three months owes three months.
    --
    --        The guard is a safety net, not a limit anybody should hit: sixty
    --        iterations is five years of monthly periods.
    v_guard := 0;
    loop
      v_guard := v_guard + 1;
      exit when v_guard > 60;

      begin
        insert into public.saas_payments
          (subscription_id, plan_code_snapshot, period_start, period_end,
           amount_cents, currency, due_at)
        values (
          v_sub.id, v_plan.code, v_sub.current_period_start, v_sub.current_period_end,
          v_plan.price_cents, v_plan.currency, v_sub.current_period_start
        );
        v_issued := v_issued + 1;
      exception
        when unique_violation then
          -- Already issued for this period. The correct outcome of a second
          -- run, not an error (section 37).
          null;
      end;

      exit when v_sub.current_period_end is null or v_sub.current_period_end > now();

      update public.subscriptions
      set current_period_start = v_sub.current_period_end,
          current_period_end = v_sub.current_period_end
            + case v_plan.interval when 'yearly' then interval '1 year' else interval '1 month' end
      where id = v_sub.id
      returning * into v_sub;

      v_advanced := v_advanced + 1;
    end loop;

    -- 5 + 6. Arrears. The oldest unpaid charge decides both steps: past its due
    --        date the subscription is `past_due`, and past due + the plan's
    --        grace it is `suspended`.
    --
    --        Voided and refunded charges are not debt, which is why this looks
    --        only at `pending`.
    select min(due_at) into v_oldest
    from public.saas_payments
    where subscription_id = v_sub.id and status = 'pending';

    if v_oldest is not null
       and v_oldest + (v_plan.grace_days || ' days')::interval <= now() then
      if v_sub.status <> 'suspended' then
        update public.subscriptions set status = 'suspended' where id = v_sub.id;
        v_suspended := v_suspended + 1;
      end if;

    elsif v_oldest is not null and v_oldest <= now() then
      if v_sub.status = 'active' then
        update public.subscriptions set status = 'past_due' where id = v_sub.id;
        v_past_due := v_past_due + 1;
      end if;
    end if;
  end loop;

  return query select v_advanced, v_issued, v_past_due, v_suspended, v_cancelled;
end;
$$;

comment on function public.run_subscription_billing() is
  'Closes trials, cancels the marked, advances periods, issues charges and applies arrears. Idempotent (ADR-026 decision 2).';

revoke execute on function public.run_subscription_billing() from public;
grant execute on function public.run_subscription_billing() to authenticated;

-- ---------------------------------------------------------------------------
-- Recording a payment
-- ---------------------------------------------------------------------------

-- Two writes that must not be able to happen separately (ADR-026 decision 5,
-- and the same reasoning as the points redemption of ADR-024 decision 4): the
-- charge is marked paid, and the subscription comes back to life if that was
-- the last thing owed.
--
-- If only the first happened, a business that paid would stay suspended.
create or replace function public.record_saas_payment(
  p_payment_id uuid,
  p_method     text,
  p_reference  text,
  p_paid_at    timestamptz default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment public.saas_payments%rowtype;
  v_sub     public.subscriptions%rowtype;
  v_owing   integer;
begin
  if not public.is_platform_admin() then
    raise exception 'Only a platform admin may record a payment.' using errcode = '42501';
  end if;

  select * into v_payment from public.saas_payments where id = p_payment_id;
  if v_payment.id is null then
    raise exception 'Charge not found.' using errcode = 'P0002';
  end if;

  if v_payment.status <> 'pending' then
    raise exception 'That charge is not pending.' using errcode = 'P0001';
  end if;

  if p_method is null or btrim(p_method) = '' then
    raise exception 'Recording a payment requires a method.' using errcode = '23514';
  end if;

  update public.saas_payments
  set status = 'paid',
      paid_at = coalesce(p_paid_at, now()),
      method = btrim(p_method),
      reference = nullif(btrim(coalesce(p_reference, '')), '')
  where id = p_payment_id;

  -- Anything else still owed?
  select count(*) into v_owing
  from public.saas_payments
  where subscription_id = v_payment.subscription_id
    and status = 'pending'
    and due_at <= now();

  if v_owing > 0 then
    return;
  end if;

  select * into v_sub from public.subscriptions where id = v_payment.subscription_id;

  -- Back to life. Not from `cancelled`: that is terminal, and a payment against
  -- a cancelled subscription is a settlement, not a resurrection.
  if v_sub.status in ('past_due', 'suspended') then
    update public.subscriptions set status = 'active' where id = v_sub.id;
  end if;
end;
$$;

comment on function public.record_saas_payment(uuid, text, text, timestamptz) is
  'Marks a charge paid and reactivates the subscription when nothing else is owed. Atomic.';

revoke execute on function public.record_saas_payment(uuid, text, text, timestamptz) from public;
grant execute on function public.record_saas_payment(uuid, text, text, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- Voiding a charge
-- ---------------------------------------------------------------------------

-- A charge issued in error stops being debt without disappearing. `saas_payments`
-- has no DELETE policy for exactly this reason: the row and its reason stay
-- where anybody can see them.
create or replace function public.void_saas_payment(p_payment_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment public.saas_payments%rowtype;
begin
  if not public.is_platform_admin() then
    raise exception 'Only a platform admin may void a charge.' using errcode = '42501';
  end if;

  select * into v_payment from public.saas_payments where id = p_payment_id;
  if v_payment.id is null then
    raise exception 'Charge not found.' using errcode = 'P0002';
  end if;

  if v_payment.status = 'paid' then
    raise exception 'A charge that was paid cannot be voided.' using errcode = 'P0001';
  end if;

  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'Voiding a charge requires a reason.' using errcode = '23514';
  end if;

  update public.saas_payments
  set status = 'void',
      notes = btrim(p_reason)
  where id = p_payment_id;
end;
$$;

comment on function public.void_saas_payment(uuid, text) is
  'Marks a charge void with a reason. Refuses a charge that was already paid.';

revoke execute on function public.void_saas_payment(uuid, text) from public;
grant execute on function public.void_saas_payment(uuid, text) to authenticated;
