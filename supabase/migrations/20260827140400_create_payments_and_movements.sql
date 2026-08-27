-- Phase 14 - Payments + Cash
-- What was collected, and the till's own ledger of it.
--
-- SPEC: docs/specs/phase-14-payments-cash.md sections 8, 11.
-- CLOVERCODE_MASTER.md section 14 (Phase 14), section 39.
--
-- Master section 14, textual: "Separar: Order / Payment / Invoice. No son la
-- misma entidad." An order can carry many payments (a bill split cash and
-- Yape); `orders.paid_cents` (next migration) is kept in step by trigger, the
-- same posture Phase 13 uses for `total_cents` - computed by the database,
-- because the application will not stay the only writer (Phase 15's POS,
-- Phase 19's courier app).
--
-- `cash_movements` is created in this same file because the two are coupled:
-- a cash payment auto-writes a movement, so the trigger that does it needs
-- both tables to already exist. See ADR-018 for why voiding is a nullable
-- pair rather than a status enum, and why the ledger is a separate table
-- rather than derived from `payments` at read time.

-- ---------------------------------------------------------------------------
-- payments
-- ---------------------------------------------------------------------------

create table public.payments (
  id                 uuid        not null default gen_random_uuid(),
  -- Derived by trigger from the order, like order_items and
  -- order_status_history derive theirs from orders in Phase 13.
  tenant_id          uuid        not null,
  order_id           uuid        not null,
  payment_method_id  uuid        not null,
  -- Set only for a `cash`-type payment; every other type requires it NULL
  -- (guarded below). A Yape confirmation never touches a physical drawer.
  cash_session_id    uuid,

  amount_cents       bigint      not null,
  -- The operation number a cashier reads off their phone or a card voucher.
  reference          text,
  notes              text,

  voided_at          timestamptz,
  void_reason        text,

  created_by         uuid,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint payments_pkey primary key (id),
  constraint payments_tenant_id_fkey
    foreign key (tenant_id) references public.tenants (id) on delete cascade,
  -- RESTRICT: a financial record must not silently disappear because the
  -- order it paid for did. Orders are never deleted (Phase 13), so this
  -- never fires - the declaration says what would happen if it could.
  constraint payments_order_id_fkey
    foreign key (order_id) references public.orders (id) on delete restrict,
  constraint payments_payment_method_id_fkey
    foreign key (payment_method_id) references public.payment_methods (id) on delete restrict,
  constraint payments_cash_session_id_fkey
    foreign key (cash_session_id) references public.cash_sessions (id) on delete restrict,
  constraint payments_created_by_fkey
    foreign key (created_by) references auth.users (id) on delete set null,

  constraint payments_amount_range check (amount_cents > 0 and amount_cents <= 10000000000),
  constraint payments_reference_length check (coalesce(char_length(reference), 0) <= 120),
  constraint payments_notes_length check (coalesce(char_length(notes), 0) <= 300),

  -- Voided iff it has a reason. Same "both directions matter" shape as
  -- orders_cancel_fields.
  constraint payments_void_fields check ((voided_at is null) = (void_reason is null)),
  constraint payments_void_reason_length
    check (void_reason is null or char_length(btrim(void_reason)) between 1 and 300)
);

comment on table public.payments is
  'Money applied to an order. Capped at the order''s remaining balance by trigger. Voided, never deleted.';
comment on column public.payments.cash_session_id is
  'NOT NULL only for a cash payment, and must be an OPEN session at the order''s own location.';

create index payments_tenant_order_idx on public.payments (tenant_id, order_id);
create index payments_tenant_session_idx
  on public.payments (tenant_id, cash_session_id)
  where cash_session_id is not null;

create trigger payments_set_updated_at
  before update on public.payments
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- cash_movements
-- ---------------------------------------------------------------------------

create type public.cash_movement_type as enum ('sale', 'payout', 'deposit', 'adjustment');

create table public.cash_movements (
  id               uuid        not null default gen_random_uuid(),
  -- Derived by trigger from the session.
  tenant_id        uuid        not null,
  cash_session_id  uuid        not null,
  type             public.cash_movement_type not null,
  -- Signed: cash in is positive, cash out is negative. A till's expected
  -- count is one sum() over this column - see ADR-018 section 3.
  amount_cents     bigint      not null,
  -- Set for a `sale` row and for the `adjustment` row a void writes to
  -- compensate it; NULL for a hand-entered payout/deposit/adjustment, which
  -- has no payment to point at.
  payment_id       uuid,
  reason           text,
  created_by       uuid,
  created_at       timestamptz not null default now(),

  constraint cash_movements_pkey primary key (id),
  constraint cash_movements_tenant_id_fkey
    foreign key (tenant_id) references public.tenants (id) on delete cascade,
  constraint cash_movements_session_id_fkey
    foreign key (cash_session_id) references public.cash_sessions (id) on delete restrict,
  constraint cash_movements_payment_id_fkey
    foreign key (payment_id) references public.payments (id) on delete restrict,
  constraint cash_movements_created_by_fkey
    foreign key (created_by) references auth.users (id) on delete set null,

  constraint cash_movements_amount_not_zero
    check (amount_cents <> 0 and abs(amount_cents) <= 10000000000),
  constraint cash_movements_reason_length check (coalesce(char_length(reason), 0) <= 300),

  -- Sign follows type. `adjustment` is unconstrained on sign because it
  -- covers both a positive correction ("a sale was missed") and a negative
  -- one (a voided sale, or cash physically removed).
  constraint cash_movements_sign_by_type check (
    (type in ('sale', 'deposit') and amount_cents > 0)
    or (type = 'payout' and amount_cents < 0)
    or (type = 'adjustment')
  ),
  -- A `sale` always names the payment that produced it.
  constraint cash_movements_sale_has_payment check (type <> 'sale' or payment_id is not null),
  -- A hand-entered payout or deposit never does - there is no payment to
  -- point at, which is the entire reason a person is typing an amount in.
  constraint cash_movements_manual_has_no_payment
    check (type not in ('payout', 'deposit') or payment_id is null)
);

comment on table public.cash_movements is
  'Append-only, signed ledger of a session. A sale/void-adjustment is written by trigger; payout/deposit/adjustment are entered by hand.';

create index cash_movements_session_idx on public.cash_movements (cash_session_id, created_at);
create index cash_movements_tenant_payment_idx
  on public.cash_movements (tenant_id, payment_id)
  where payment_id is not null;

-- No updated_at, and no trigger for one, matching order_status_history: this
-- is a ledger, and nothing in it is ever updated once written.

create or replace function public.derive_cash_movement_tenant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session_tenant uuid;
  v_session_closed timestamptz;
begin
  select s.tenant_id, s.closed_at into v_session_tenant, v_session_closed
  from public.cash_sessions as s
  where s.id = new.cash_session_id;

  if v_session_tenant is null then
    raise exception 'Cash session not found.' using errcode = 'P0002';
  end if;
  if v_session_closed is not null then
    raise exception 'That cash session is already closed.' using errcode = '23514';
  end if;

  new.tenant_id  := v_session_tenant;
  new.created_by := coalesce(new.created_by, (select auth.uid()));

  return new;
end;
$$;

comment on function public.derive_cash_movement_tenant() is
  'Derives tenant_id from the session and refuses a movement on a closed one.';

create trigger cash_movements_derive_tenant
  before insert on public.cash_movements
  for each row execute function public.derive_cash_movement_tenant();

-- ---------------------------------------------------------------------------
-- payments: the guard (tenant refs, active method, cash/session rule, cap)
-- ---------------------------------------------------------------------------

-- The single place every payment invariant is enforced, because the
-- application will not stay the only writer (Phase 15's POS above all).
create or replace function public.guard_payment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order_tenant      uuid;
  v_order_status      public.order_status;
  v_order_location    uuid;
  v_order_total       bigint;
  v_order_paid        bigint;
  v_method_tenant     uuid;
  v_method_type       public.payment_method_type;
  v_method_active     boolean;
  v_session_tenant    uuid;
  v_session_closed    timestamptz;
  v_session_location  uuid;
begin
  select o.tenant_id, o.status, o.location_id, o.total_cents, o.paid_cents
    into v_order_tenant, v_order_status, v_order_location, v_order_total, v_order_paid
  from public.orders as o
  where o.id = new.order_id;

  if v_order_tenant is null then
    raise exception 'Order not found.' using errcode = 'P0002';
  end if;

  new.tenant_id := v_order_tenant;

  -- A payment is always born live. Voiding is exclusively the UPDATE path
  -- below (guard_payment_void / record_payment_void_movement) - an INSERT
  -- that arrived with voided_at already set would skip the compensating
  -- cash movement entirely, since that trigger fires on UPDATE OF voided_at.
  new.voided_at   := null;
  new.void_reason := null;

  if v_order_status = 'cancelled' then
    raise exception 'A cancelled order cannot receive a payment.' using errcode = 'P0001';
  end if;

  select pm.tenant_id, pm.type, pm.is_active
    into v_method_tenant, v_method_type, v_method_active
  from public.payment_methods as pm
  where pm.id = new.payment_method_id;

  if v_method_tenant is null or v_method_tenant <> v_order_tenant then
    raise exception 'That payment method belongs to a different business.'
      using errcode = '23514';
  end if;
  if not v_method_active then
    raise exception 'That payment method is not active.' using errcode = '23514';
  end if;

  if v_method_type = 'cash' then
    if new.cash_session_id is null then
      raise exception 'A cash payment needs an open cash session.' using errcode = '23514';
    end if;

    select s.tenant_id, s.closed_at, r.location_id
      into v_session_tenant, v_session_closed, v_session_location
    from public.cash_sessions as s
    join public.cash_registers as r on r.id = s.cash_register_id
    where s.id = new.cash_session_id;

    if v_session_tenant is null or v_session_tenant <> v_order_tenant then
      raise exception 'That cash session belongs to a different business.'
        using errcode = '23514';
    end if;
    if v_session_closed is not null then
      raise exception 'That cash session is already closed.' using errcode = '23514';
    end if;
    if v_session_location <> v_order_location then
      raise exception 'That cash session is at a different location than the order.'
        using errcode = '23514';
    end if;
  elsif new.cash_session_id is not null then
    raise exception 'Only a cash payment may reference a cash session.'
      using errcode = '23514';
  end if;

  -- THE CAP. A payment that would leave the order owing less than nothing
  -- is refused here, in the database, rather than trusted from whoever is
  -- writing (Server Action today, POS in Phase 15, a courier app in 19).
  if v_order_paid + new.amount_cents > v_order_total then
    raise exception 'That payment would leave the order overpaid.' using errcode = 'P0001';
  end if;

  return new;
end;
$$;

comment on function public.guard_payment() is
  'Derives tenant_id, enforces the cash/session rule, and caps a payment at the order''s remaining balance.';

create trigger payments_guard
  before insert on public.payments
  for each row execute function public.guard_payment();

-- ---------------------------------------------------------------------------
-- payments: voiding (guard + compensating movement)
-- ---------------------------------------------------------------------------

-- The only UPDATE this table permits. Amount, order, method and session are
-- the sale as it happened; voiding corrects the record's MEANING, not its
-- facts - the same distinction Phase 13 draws between order_items' snapshot
-- (frozen) and its status (mutable).
create or replace function public.guard_payment_void()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.voided_at is not null then
    raise exception 'This payment is already voided.' using errcode = 'P0001';
  end if;

  if new.order_id <> old.order_id
     or new.payment_method_id <> old.payment_method_id
     or new.amount_cents <> old.amount_cents
     or coalesce(new.cash_session_id, '00000000-0000-0000-0000-000000000000'::uuid)
        <> coalesce(old.cash_session_id, '00000000-0000-0000-0000-000000000000'::uuid)
  then
    raise exception 'Only voiding fields may change on a payment.' using errcode = 'P0001';
  end if;

  if new.void_reason is null or btrim(new.void_reason) = '' then
    raise exception 'Voiding a payment requires a reason.' using errcode = '23514';
  end if;

  new.voided_at := coalesce(new.voided_at, now());

  return new;
end;
$$;

comment on function public.guard_payment_void() is
  'The only permitted UPDATE on a payment: setting voided_at/void_reason, once, with a reason.';

create trigger payments_guard_void
  before update on public.payments
  for each row execute function public.guard_payment_void();

-- Cash only: a Yape/Plin/card/transfer payment never touched the drawer, so
-- voiding it has nothing for the ledger to compensate.
create or replace function public.record_payment_void_movement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_method_type public.payment_method_type;
begin
  if old.voided_at is not null or new.voided_at is null then
    return null;
  end if;

  select pm.type into v_method_type
  from public.payment_methods as pm
  where pm.id = new.payment_method_id;

  if v_method_type = 'cash' then
    insert into public.cash_movements (cash_session_id, type, amount_cents, payment_id, reason, created_by)
    values (
      new.cash_session_id, 'adjustment', -new.amount_cents, new.id,
      'Pago anulado: ' || new.void_reason, (select auth.uid())
    );
  end if;

  return null;
end;
$$;

comment on function public.record_payment_void_movement() is
  'Writes a compensating cash_movements row when a cash payment is voided.';

create trigger payments_record_void_movement
  after update of voided_at on public.payments
  for each row execute function public.record_payment_void_movement();

-- ---------------------------------------------------------------------------
-- payments: the sale movement, and orders.paid_cents
-- ---------------------------------------------------------------------------

create or replace function public.record_payment_cash_movement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_method_type public.payment_method_type;
begin
  select pm.type into v_method_type
  from public.payment_methods as pm
  where pm.id = new.payment_method_id;

  if v_method_type = 'cash' then
    insert into public.cash_movements (cash_session_id, type, amount_cents, payment_id, created_by)
    values (new.cash_session_id, 'sale', new.amount_cents, new.id, new.created_by);
  end if;

  return null;
end;
$$;

comment on function public.record_payment_cash_movement() is
  'Writes the till ledger entry for a new cash payment.';

create trigger payments_record_cash_movement
  after insert on public.payments
  for each row execute function public.record_payment_cash_movement();

-- Kept in step with `payments` rather than computed on read: an order is read
-- far more often than it is paid, and Phase 15 needs `paid_cents` to be a
-- stored value it can show without a join - the same argument Phase 13 makes
-- for `total_cents` (recompute_order_totals, order_items migration).
create or replace function public.recompute_order_paid()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order_id uuid := coalesce(new.order_id, old.order_id);
begin
  update public.orders as o
  set paid_cents = coalesce((
    select sum(p.amount_cents) from public.payments as p
    where p.order_id = v_order_id and p.voided_at is null
  ), 0)
  where o.id = v_order_id;

  return null;
end;
$$;

comment on function public.recompute_order_paid() is
  'Recomputes orders.paid_cents from non-voided payments. The application never sends it.';

create trigger payments_recompute_order_paid
  after insert or update of voided_at on public.payments
  for each row execute function public.recompute_order_paid();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.payments enable row level security;

create policy payments_select_viewer
  on public.payments for select to authenticated
  using (public.has_permission(tenant_id, 'payments.view'));

-- No public policy. A payment names an amount and, through its order, a
-- customer - ADR-016's reasoning applies here at least as strongly as it
-- does to `orders`.

create policy payments_insert_operator
  on public.payments for insert to authenticated
  with check (public.has_permission(tenant_id, 'payments.create'));

-- Voiding is gated by its own permission, not payments.create: the person
-- who rang up a sale is not automatically the person who may erase it - the
-- same split Phase 13 draws between orders.update and orders.cancel.
create policy payments_update_voider
  on public.payments for update to authenticated
  using (public.has_permission(tenant_id, 'payments.void'))
  with check (public.has_permission(tenant_id, 'payments.void'));

-- No DELETE policy. A payment is a financial record; voiding says "this did
-- not stand" without pretending it never happened.

alter table public.cash_movements enable row level security;

create policy cash_movements_select_viewer
  on public.cash_movements for select to authenticated
  using (public.has_permission(tenant_id, 'cash.view'));

-- A `sale` row and a void's compensating `adjustment` are written by the
-- SECURITY DEFINER triggers above, which run as the table owner and are not
-- subject to this policy - the same way Phase 13's order-totals trigger
-- updates `orders` without `orders` needing a policy for it. What this
-- policy actually gates is the one direct write this table gets: a person
-- entering a payout, a deposit, or a manual correction.
create policy cash_movements_insert_manager
  on public.cash_movements for insert to authenticated
  with check (
    public.has_permission(tenant_id, 'cash.manage')
    and type in ('payout', 'deposit', 'adjustment')
    and payment_id is null
  );

-- No UPDATE, no DELETE. The ledger is append-only, like order_status_history.
