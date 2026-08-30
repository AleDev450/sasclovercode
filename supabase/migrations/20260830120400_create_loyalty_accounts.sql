-- Phase 20 - Loyalty + Promotions
-- The points a customer has, and every movement that produced them.
--
-- SPEC: docs/specs/phase-20-loyalty-promotions.md sections 8, 10, 11.
-- CLOVERCODE_MASTER.md section 33 (Phase 20).
-- ADR-024 decision 2.
--
-- Master gives one rule, twice:
--
--   "Los puntos deben utilizar ledger."
--   "No almacenar UNICAMENTE: points = 500 sin historial."
--
-- `loyalty_transactions` is that ledger and it is the source of truth:
-- append-only, no UPDATE policy, no DELETE policy, ever. A mistake is fixed
-- with an `adjustment` of the opposite sign, which leaves both rows visible.
--
-- `loyalty_accounts.points_balance` is a trigger-maintained column over it.
-- That is deliberately the OPPOSITE of what ADR-022 chose for stock, and
-- ADR-024 decision 2 carries the full argument. The short version: master
-- forbids the balance *without* history, not the balance *with* it; a points
-- balance is a fact about ONE row (the account) where a stock balance is a
-- fact about a (item, location) pair with no row to live in; and this number
-- is read at the till with somebody waiting, where a `sum()` over three years
-- of history is the wrong cost to pay.

create table public.loyalty_accounts (
  id             uuid        not null default gen_random_uuid(),
  -- Derived by trigger from the customer; never trusted from a client.
  tenant_id      uuid        not null,
  customer_id    uuid        not null,

  -- Maintained by trigger from the ledger. TEST-2030 recomputes it from zero
  -- and compares, so it cannot drift silently.
  points_balance integer     not null default 0,

  enrolled_at    timestamptz not null default now(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint loyalty_accounts_pkey primary key (id),

  constraint loyalty_accounts_tenant_id_fkey
    foreign key (tenant_id) references public.tenants (id) on delete cascade,

  -- CASCADE: an account without its customer is a balance belonging to nobody.
  -- In practice it never fires - there is no DELETE policy on `customers`.
  constraint loyalty_accounts_customer_id_fkey
    foreign key (customer_id) references public.customers (id) on delete cascade,

  -- One account per customer. Two would mean the answer to "how many points do
  -- I have?" depends on which row you read.
  constraint loyalty_accounts_customer_id_key unique (customer_id),

  -- A negative balance would mean somebody spent points they did not have.
  -- The redemption RPC checks it too, but this is the invariant that holds
  -- whatever the caller is.
  constraint loyalty_accounts_balance_not_negative
    check (points_balance >= 0)
);

comment on table public.loyalty_accounts is
  'One points account per customer. points_balance is derived from the ledger by trigger (ADR-024).';
comment on column public.loyalty_accounts.points_balance is
  'Maintained by trigger from loyalty_transactions. Never sent by a client; TEST-2030 proves it matches.';

create index loyalty_accounts_tenant_idx
  on public.loyalty_accounts (tenant_id);

create trigger loyalty_accounts_set_updated_at
  before update on public.loyalty_accounts
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- loyalty_transactions - the ledger
-- ---------------------------------------------------------------------------

create table public.loyalty_transactions (
  id         uuid                             not null default gen_random_uuid(),
  -- Derived by trigger from the account.
  tenant_id  uuid                             not null,
  account_id uuid                             not null,

  type       public.loyalty_transaction_type  not null,

  -- SIGNED, which is what makes this a ledger rather than a log: the balance
  -- is the sum, so a movement has to carry its own direction. Master's own
  -- example is written that way - "+100 order", "-50 reward", "+20 campaign".
  points     integer                          not null,

  -- Set for `earn` (the order that produced the points) and for `redeem` (the
  -- order the points paid for). SET NULL rather than CASCADE: deleting an
  -- order must not silently rewrite somebody's balance.
  order_id   uuid,

  reason     text,
  created_by uuid,
  created_at timestamptz                      not null default now(),

  constraint loyalty_transactions_pkey primary key (id),

  constraint loyalty_transactions_tenant_id_fkey
    foreign key (tenant_id) references public.tenants (id) on delete cascade,
  constraint loyalty_transactions_account_id_fkey
    foreign key (account_id) references public.loyalty_accounts (id) on delete cascade,
  constraint loyalty_transactions_order_id_fkey
    foreign key (order_id) references public.orders (id) on delete set null,
  constraint loyalty_transactions_created_by_fkey
    foreign key (created_by) references auth.users (id) on delete set null,

  -- A movement of nothing is not a movement. Without this, a zero-point entry
  -- would sit in the history saying something happened when nothing did.
  constraint loyalty_transactions_points_not_zero check (points <> 0),

  -- The sign follows the type, so `earn` can never take points away and
  -- `redeem` can never give them. The other three go either way on purpose: an
  -- adjustment corrects in both directions, a campaign could claw back, and an
  -- expiry is negative but is left unconstrained so a future scheduler can
  -- also reverse one it got wrong.
  constraint loyalty_transactions_earn_positive
    check (type <> 'earn' or points > 0),
  constraint loyalty_transactions_redeem_negative
    check (type <> 'redeem' or points < 0),

  -- The three manual types have to say why. `earn` and `redeem` do not: their
  -- reason is the order they point at.
  constraint loyalty_transactions_reason_required
    check (type not in ('campaign', 'adjustment', 'expiry') or reason is not null),
  constraint loyalty_transactions_reason_length
    check (reason is null or char_length(btrim(reason)) between 1 and 300)
);

comment on table public.loyalty_transactions is
  'Append-only points ledger. The source of truth for a balance (master section 33).';
comment on column public.loyalty_transactions.points is
  'Signed: positive adds, negative spends. The balance is the sum.';

create index loyalty_transactions_account_idx
  on public.loyalty_transactions (tenant_id, account_id, created_at desc);

-- Idempotence of the automatic accrual (master section 37), stated
-- structurally rather than checked defensively: a retry of the completion
-- trigger violates this index instead of crediting the same order twice.
--
-- Partial on `earn` because a `redeem` legitimately shares its order with the
-- `earn` that order produced.
create unique index loyalty_transactions_earn_per_order_key
  on public.loyalty_transactions (order_id)
  where type = 'earn' and order_id is not null;

-- ---------------------------------------------------------------------------
-- tenant_id from the parent, on both tables
-- ---------------------------------------------------------------------------

create or replace function public.derive_loyalty_account_tenant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select c.tenant_id into new.tenant_id
  from public.customers as c
  where c.id = new.customer_id;

  if new.tenant_id is null then
    raise exception 'Customer not found.' using errcode = 'P0002';
  end if;

  return new;
end;
$$;

comment on function public.derive_loyalty_account_tenant() is
  'Derives tenant_id from the customer so the two can never disagree.';

create trigger loyalty_accounts_derive_tenant
  before insert or update of customer_id on public.loyalty_accounts
  for each row execute function public.derive_loyalty_account_tenant();

-- Derives the tenant AND refuses an order from another business, in one
-- function - PostgreSQL fires BEFORE triggers alphabetically, so splitting
-- this would let the guard run against a tenant_id not yet derived. Same
-- shape, same reason, as `derive_stock_movement_tenant()` (Phase 18).
create or replace function public.derive_loyalty_transaction_tenant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order_tenant uuid;
begin
  select a.tenant_id into new.tenant_id
  from public.loyalty_accounts as a
  where a.id = new.account_id;

  if new.tenant_id is null then
    raise exception 'Loyalty account not found.' using errcode = 'P0002';
  end if;

  if new.order_id is not null then
    select o.tenant_id into v_order_tenant
    from public.orders as o
    where o.id = new.order_id;

    if v_order_tenant is null or v_order_tenant <> new.tenant_id then
      raise exception 'That order belongs to a different business.'
        using errcode = '23514';
    end if;
  end if;

  new.created_by := coalesce(new.created_by, (select auth.uid()));

  return new;
end;
$$;

comment on function public.derive_loyalty_transaction_tenant() is
  'Derives tenant_id from the account and refuses an order that belongs to another tenant.';

create trigger loyalty_transactions_derive_tenant
  before insert on public.loyalty_transactions
  for each row execute function public.derive_loyalty_transaction_tenant();

-- ---------------------------------------------------------------------------
-- The balance, from the ledger
-- ---------------------------------------------------------------------------

-- INSERT only, because there is no UPDATE and no DELETE on this table - not by
-- policy and not by anything else. That is what makes a single `+=` correct
-- here where a full recount would be needed on a mutable table: an entry, once
-- written, never changes.
--
-- The CHECK on `points_balance >= 0` is what actually refuses an overdraft.
-- The redemption RPC checks first so the caller gets a sentence instead of a
-- constraint name, but this is the line that holds whoever the writer is.
create or replace function public.apply_loyalty_transaction()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.loyalty_accounts as a
  set points_balance = a.points_balance + new.points
  where a.id = new.account_id;

  return null;
end;
$$;

comment on function public.apply_loyalty_transaction() is
  'Adds a ledger entry to its account balance. The CHECK refuses an overdraft.';

create trigger loyalty_transactions_apply
  after insert on public.loyalty_transactions
  for each row execute function public.apply_loyalty_transaction();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.loyalty_accounts enable row level security;
alter table public.loyalty_transactions enable row level security;

create policy loyalty_accounts_select_member
  on public.loyalty_accounts for select to authenticated
  using (public.has_permission(tenant_id, 'loyalty.view'));

-- No `anon` policy on either table. A points ledger says who a person is and
-- how often they buy; ADR-016 applies at least as strongly here as to
-- `customers` itself.

create policy loyalty_accounts_insert_manager
  on public.loyalty_accounts for insert to authenticated
  with check (public.has_permission(tenant_id, 'loyalty.manage'));

-- UPDATE exists for `enrolled_at` corrections and nothing else in practice:
-- `points_balance` is written by the trigger, which runs as the function owner
-- and is unaffected by this policy.
create policy loyalty_accounts_update_manager
  on public.loyalty_accounts for update to authenticated
  using (public.has_permission(tenant_id, 'loyalty.manage'))
  with check (public.has_permission(tenant_id, 'loyalty.manage'));

-- No DELETE policy. Removing an account would remove its ledger with it, and
-- that history is the record of a liability the business took on.

create policy loyalty_transactions_select_member
  on public.loyalty_transactions for select to authenticated
  using (public.has_permission(tenant_id, 'loyalty.view'));

create policy loyalty_transactions_insert_manager
  on public.loyalty_transactions for insert to authenticated
  with check (public.has_permission(tenant_id, 'loyalty.manage'));

-- No UPDATE policy and no DELETE policy, ever.
--
-- This is the line that makes master's "los puntos deben utilizar ledger" real
-- rather than decorative. If an entry could be edited, the balance would stop
-- being demonstrable and the history would stop being evidence. A mistake is
-- corrected with an `adjustment` entry of the opposite sign, which leaves both
-- rows where anybody can see them.
