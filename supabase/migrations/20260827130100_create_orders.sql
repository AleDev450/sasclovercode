-- Phase 13 - Orders Core
-- What was sold.
--
-- SPEC: docs/specs/phase-13-orders-core.md sections 8, 10, 11.
-- CLOVERCODE_MASTER.md sections 11, 33 (Phase 13), 39.
--
-- This is the first table in CloverCode that records an EVENT rather than a
-- setting. Everything before it was correctable: a wrong price is fixed and
-- leaves no trace. An order is what happened, and from here the system has to
-- answer "what did we sell on Tuesday?" with an answer that does not change
-- depending on when it is asked.
--
-- Every money column is an integer in the minor unit (ADR-015).

create table public.orders (
  id              uuid                not null default gen_random_uuid(),
  tenant_id       uuid                not null,

  -- An order happens SOMEWHERE. Not nullable, which is the whole reason Phase
  -- 10 created locations before any operational module: adding this column
  -- later would have meant guessing which branch each past order belonged to.
  location_id     uuid                not null,

  -- The customer is optional. Someone who pays cash and leaves is the normal
  -- case, and forcing a row into `customers` for them would be both a worse
  -- experience and more personal data than needed (ADR-016).
  customer_id     uuid,

  -- Per-tenant sequential number. Assigned by a trigger; see below.
  number          integer             not null,

  status          public.order_status not null default 'pending',
  source          public.order_source not null default 'manual',
  notes           text,

  -- Totals, all computed by the database from the lines. The application does
  -- not get a vote: it is not the only writer (Phase 15 brings a POS, Phase 19
  -- a courier), and two writers computing a total independently is two totals.
  subtotal_cents  bigint              not null default 0,
  discount_cents  bigint              not null default 0,
  tax_cents       bigint              not null default 0,
  -- The one amount that is NOT derived from the lines: delivery is a decision
  -- made about the order as a whole.
  shipping_cents  bigint              not null default 0,
  total_cents     bigint              not null default 0,

  placed_at       timestamptz         not null default now(),
  completed_at    timestamptz,
  cancelled_at    timestamptz,
  cancel_reason   text,

  -- Who took the order. SET NULL rather than CASCADE: an employee leaving the
  -- company must not delete the sales they rang up.
  created_by      uuid,

  created_at      timestamptz         not null default now(),
  updated_at      timestamptz         not null default now(),

  constraint orders_pkey primary key (id),

  constraint orders_tenant_id_fkey
    foreign key (tenant_id) references public.tenants (id) on delete cascade,

  -- RESTRICT, not CASCADE. Deleting a branch must never delete the history of
  -- what was sold there. In practice it never fires - locations are deactivated
  -- rather than deleted (Phase 10) - but the declaration says what would
  -- happen, and "nothing, loudly" is the right answer.
  constraint orders_location_id_fkey
    foreign key (location_id) references public.locations (id) on delete restrict,
  constraint orders_customer_id_fkey
    foreign key (customer_id) references public.customers (id) on delete restrict,

  constraint orders_created_by_fkey
    foreign key (created_by) references auth.users (id) on delete set null,

  -- Master section 11: scoped to the tenant. Two businesses each have their
  -- own order number 1.
  constraint orders_tenant_number_key unique (tenant_id, number),

  constraint orders_number_positive check (number > 0),

  constraint orders_amounts_range check (
    subtotal_cents between 0 and 10000000000
    and discount_cents between 0 and 10000000000
    and tax_cents between 0 and 10000000000
    and shipping_cents between 0 and 10000000000
    and total_cents between 0 and 10000000000
  ),

  constraint orders_notes_length check (coalesce(char_length(notes), 0) <= 1000),

  -- A cancelled order has a reason and a timestamp; a live one has neither.
  -- Both directions matter: without the `only if`, a reason could be left
  -- behind on an order that was cancelled and then... except it cannot be
  -- un-cancelled, which is exactly why the equivalence is safe to state.
  constraint orders_cancel_fields check (
    (status = 'cancelled') = (cancel_reason is not null)
    and (status = 'cancelled') = (cancelled_at is not null)
  ),
  constraint orders_cancel_reason_length check (
    cancel_reason is null or char_length(btrim(cancel_reason)) between 1 and 300
  ),

  constraint orders_completed_at check (
    (status = 'completed') = (completed_at is not null)
  )
);

comment on table public.orders is
  'What was sold. Totals are computed by trigger from order_items (§33).';
comment on column public.orders.number is
  'Sequential per tenant, assigned by trigger. Two tenants both have a #1.';
comment on column public.orders.total_cents is
  'Minor units (ADR-015). Computed by the database; never sent by a client.';

create index orders_tenant_status_idx
  on public.orders (tenant_id, status);

-- "Today, in this branch" - the query the dashboard runs all day.
create index orders_tenant_location_placed_idx
  on public.orders (tenant_id, location_id, placed_at desc);

-- A customer's purchase history: the "historial" of master section 33 (Phase
-- 12), which Phase 12 could not provide because orders did not exist.
create index orders_tenant_customer_idx
  on public.orders (tenant_id, customer_id)
  where customer_id is not null;

create trigger orders_set_updated_at
  before update on public.orders
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- The per-tenant order number
-- ---------------------------------------------------------------------------

-- Why not a plain `bigserial`: a sequence is global, so tenant A's orders would
-- be numbered 1, 5, 9 while tenant B took 2, 3, 4. A business printing "pedido
-- #1247" on its fourth ticket of the day looks broken, and the gaps leak how
-- much other businesses on the platform are selling.
--
-- Why this is concurrency-safe: the `max(number) + 1` runs inside the INSERT's
-- own transaction, and the unique index on (tenant_id, number) is what actually
-- decides. If two cashiers race, one of them violates the index and PostgreSQL
-- raises 23505; the application retries. Taking a lock here instead would
-- serialise every order of every tenant behind one another.
--
-- The alternative - a sequence per tenant - means DDL at runtime, which is
-- worse than a retry.
create or replace function public.assign_order_number()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.number is not null and new.number > 0 then
    return new;
  end if;

  select coalesce(max(o.number), 0) + 1 into new.number
  from public.orders as o
  where o.tenant_id = new.tenant_id;

  return new;
end;
$$;

comment on function public.assign_order_number() is
  'Per-tenant sequential number. The unique index arbitrates a race, not a lock.';

create trigger orders_assign_number
  before insert on public.orders
  for each row execute function public.assign_order_number();

-- ---------------------------------------------------------------------------
-- The branch and the customer belong to the same business
-- ---------------------------------------------------------------------------

-- Two foreign keys to two tables that each carry a tenant is a place where they
-- can disagree: nothing in the schema stops an order of tenant A pointing at a
-- branch of tenant B, and RLS would not catch it either - the caller has
-- permission on the row being written.
--
-- Phase 11 closed the same hole between a product and its category. Here the
-- consequence is worse: a sale attributed to a branch that belongs to another
-- company.
create or replace function public.guard_order_tenant_refs()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_location_tenant uuid;
  v_location_active boolean;
  v_customer_tenant uuid;
begin
  select l.tenant_id, l.is_active into v_location_tenant, v_location_active
  from public.locations as l
  where l.id = new.location_id;

  if v_location_tenant is null or v_location_tenant <> new.tenant_id then
    raise exception 'That location belongs to a different business.'
      using errcode = '23514';
  end if;

  -- Only on INSERT. An existing order whose branch was later closed keeps its
  -- branch: the sale happened there, and rewriting history to the nearest open
  -- shop would be a lie.
  if tg_op = 'INSERT' and not v_location_active then
    raise exception 'That location is not active.'
      using errcode = '23514';
  end if;

  if new.customer_id is not null then
    select c.tenant_id into v_customer_tenant
    from public.customers as c
    where c.id = new.customer_id;

    if v_customer_tenant is null or v_customer_tenant <> new.tenant_id then
      raise exception 'That customer belongs to a different business.'
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

comment on function public.guard_order_tenant_refs() is
  'Refuses an order whose location or customer belongs to another tenant.';

create trigger orders_guard_tenant_refs
  before insert or update of location_id, customer_id, tenant_id on public.orders
  for each row execute function public.guard_order_tenant_refs();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.orders enable row level security;

create policy orders_select_member
  on public.orders for select to authenticated
  using (public.has_permission(tenant_id, 'orders.view'));

-- No public policy. An order names a person, an address and an amount; the
-- reasoning of ADR-016 applies here at least as strongly as it does to
-- `customers`.

create policy orders_insert_creator
  on public.orders for insert to authenticated
  with check (public.has_permission(tenant_id, 'orders.create'));

-- One UPDATE policy covering both moving an order along and cancelling it.
--
-- The two are separated by PERMISSION at the action layer and by the state
-- machine underneath: `orders.cancel` is checked by the Server Action, and the
-- trigger refuses a cancellation with no reason. Splitting the policy itself
-- would mean writing "which columns changed" into a USING clause, which
-- PostgreSQL evaluates per row and not per statement - it cannot express it.
create policy orders_update_operator
  on public.orders for update to authenticated
  using (
    public.has_permission(tenant_id, 'orders.update')
    or public.has_permission(tenant_id, 'orders.cancel')
  )
  with check (
    public.has_permission(tenant_id, 'orders.update')
    or public.has_permission(tenant_id, 'orders.cancel')
  );

-- No DELETE policy. An order is a sales record; a business is required to keep
-- it, and `cancelled` is how one stops counting without pretending it never
-- happened.
