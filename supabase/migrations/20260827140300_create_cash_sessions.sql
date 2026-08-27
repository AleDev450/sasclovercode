-- Phase 14 - Payments + Cash
-- One open-to-close cycle of a till.
--
-- SPEC: docs/specs/phase-14-payments-cash.md sections 8, 11.
-- CLOVERCODE_MASTER.md section 14 (Phase 14).
--
-- No `cash_session_status` enum. An open-to-closed session has exactly one
-- edge, unlike Phase 13's eight-edge order lifecycle (ADR-017 section 4),
-- so it gets the same treatment `orders.cancelled_at` already uses: a
-- nullable pair of columns says everything a status column would, with one
-- CHECK holding them consistent instead of a state machine to maintain.
-- See ADR-018.

create table public.cash_sessions (
  id                uuid        not null default gen_random_uuid(),
  -- Derived by trigger from the register, like every child table since
  -- Phase 10: without it, every policy here would have to join
  -- cash_registers to learn whose row this is.
  tenant_id         uuid        not null,
  cash_register_id  uuid        not null,

  opened_by         uuid,
  closed_by         uuid,

  -- The cashier's declared starting float. Not validated against anything -
  -- it IS the baseline everything else in the session measures against.
  opening_cents     bigint      not null default 0,

  -- The three closing columns exist only once the session closes. NULL until
  -- then, together, by the CHECK below.
  closing_cents     bigint,
  expected_cents    bigint,
  difference_cents  bigint,

  notes             text,
  opened_at         timestamptz not null default now(),
  closed_at         timestamptz,
  updated_at        timestamptz not null default now(),

  constraint cash_sessions_pkey primary key (id),
  constraint cash_sessions_tenant_id_fkey
    foreign key (tenant_id) references public.tenants (id) on delete cascade,
  constraint cash_sessions_register_id_fkey
    foreign key (cash_register_id) references public.cash_registers (id) on delete restrict,
  constraint cash_sessions_opened_by_fkey
    foreign key (opened_by) references auth.users (id) on delete set null,
  constraint cash_sessions_closed_by_fkey
    foreign key (closed_by) references auth.users (id) on delete set null,

  constraint cash_sessions_opening_range check (opening_cents between 0 and 10000000000),
  constraint cash_sessions_closing_range
    check (closing_cents is null or closing_cents between 0 and 10000000000),
  constraint cash_sessions_notes_length check (coalesce(char_length(notes), 0) <= 500),

  -- Closed iff it has a declared count, a computed expectation and a
  -- computed difference. All three or none - the same "both directions
  -- matter" reasoning orders_cancel_fields uses for cancellation.
  constraint cash_sessions_closed_fields check (
    (closed_at is null) = (closing_cents is null)
    and (closed_at is null) = (expected_cents is null)
    and (closed_at is null) = (difference_cents is null)
  )
);

comment on table public.cash_sessions is
  'One open-to-close cycle of a register. expected/difference are computed by trigger at close.';

-- One open session per register, ever, at a time. This is what actually
-- arbitrates two cashiers racing to open the same till - like Phase 13's
-- order numbering, the index resolves the race; nothing here takes a lock.
create unique index cash_sessions_one_open_per_register
  on public.cash_sessions (cash_register_id)
  where closed_at is null;

create index cash_sessions_tenant_register_idx
  on public.cash_sessions (tenant_id, cash_register_id, opened_at desc);

create trigger cash_sessions_set_updated_at
  before update on public.cash_sessions
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Opening: derive the tenant, stamp who
-- ---------------------------------------------------------------------------

create or replace function public.derive_cash_session_tenant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_register_tenant uuid;
  v_register_active boolean;
begin
  select r.tenant_id, r.is_active into v_register_tenant, v_register_active
  from public.cash_registers as r
  where r.id = new.cash_register_id;

  if v_register_tenant is null then
    raise exception 'Cash register not found.' using errcode = 'P0002';
  end if;
  if not v_register_active then
    raise exception 'That cash register is not active.' using errcode = '23514';
  end if;

  new.tenant_id := v_register_tenant;
  -- `auth.uid()` is NULL for a service-role or SQL-console write, recorded
  -- honestly rather than attributed to nobody in particular (Phase 13 does
  -- the same for order_status_history.changed_by).
  new.opened_by := coalesce(new.opened_by, (select auth.uid()));

  return new;
end;
$$;

comment on function public.derive_cash_session_tenant() is
  'Derives tenant_id from the register and stamps who opened the session.';

create trigger cash_sessions_derive_tenant
  before insert on public.cash_sessions
  for each row execute function public.derive_cash_session_tenant();

-- ---------------------------------------------------------------------------
-- Closing: the database computes the expectation, not the browser
-- ---------------------------------------------------------------------------

-- Fires only when `closing_cents` is part of the UPDATE - which is exactly
-- the one legitimate write this table ever gets after opening. Computing
-- `expected_cents` here rather than in the Server Action means the number a
-- cashier is held to is the same number a second reader of the row sees,
-- not a value that passed through a browser on the way.
create or replace function public.close_cash_session()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_movement_total bigint;
begin
  if old.closed_at is not null then
    raise exception 'This cash session is already closed.' using errcode = 'P0001';
  end if;

  if new.closing_cents is null then
    return new;
  end if;

  select coalesce(sum(m.amount_cents), 0) into v_movement_total
  from public.cash_movements as m
  where m.cash_session_id = new.id;

  new.expected_cents   := new.opening_cents + v_movement_total;
  new.difference_cents := new.closing_cents - new.expected_cents;
  new.closed_at         := coalesce(new.closed_at, now());
  new.closed_by          := coalesce(new.closed_by, (select auth.uid()));

  return new;
end;
$$;

comment on function public.close_cash_session() is
  'Computes expected_cents and difference_cents from the ledger. The app sends only closing_cents.';

create trigger cash_sessions_close
  before update of closing_cents on public.cash_sessions
  for each row execute function public.close_cash_session();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.cash_sessions enable row level security;

create policy cash_sessions_select_viewer
  on public.cash_sessions for select to authenticated
  using (public.has_permission(tenant_id, 'cash.view'));

create policy cash_sessions_insert_opener
  on public.cash_sessions for insert to authenticated
  with check (public.has_permission(tenant_id, 'cash.open'));

-- Closing is the only UPDATE this table gets, and it is governed by its own
-- permission - not `cash.open` - the same split Phase 03 already drew for
-- the master's own example list.
create policy cash_sessions_update_closer
  on public.cash_sessions for update to authenticated
  using (public.has_permission(tenant_id, 'cash.close'))
  with check (public.has_permission(tenant_id, 'cash.close'));

-- No DELETE policy. A session, open or closed, is part of the till's history.
