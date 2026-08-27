-- Phase 13 - Orders Core
-- Who moved this order, when, and from where.
--
-- SPEC: docs/specs/phase-13-orders-core.md sections 8, 11, 16.
-- CLOVERCODE_MASTER.md section 33 (Phase 13).
--
-- This is the audit trail of an order, and it is written by the database rather
-- than by whoever remembers to. A history that depends on every caller
-- appending a row is a history with holes exactly where somebody was in a
-- hurry - which is exactly where it would have been useful.

create table public.order_status_history (
  id          uuid                not null default gen_random_uuid(),
  order_id    uuid                not null,
  tenant_id   uuid                not null,

  -- NULL on the first row: an order coming into existence has no previous
  -- state. Recording it as `pending -> pending` would be a lie about a
  -- transition that never happened.
  from_status public.order_status,
  to_status   public.order_status not null,

  reason      text,
  changed_by  uuid,
  created_at  timestamptz         not null default now(),

  constraint order_status_history_pkey primary key (id),

  constraint order_status_history_order_id_fkey
    foreign key (order_id) references public.orders (id) on delete cascade,
  constraint order_status_history_tenant_id_fkey
    foreign key (tenant_id) references public.tenants (id) on delete cascade,
  constraint order_status_history_changed_by_fkey
    foreign key (changed_by) references auth.users (id) on delete set null,

  constraint order_status_history_reason_length
    check (coalesce(char_length(reason), 0) <= 300),

  constraint order_status_history_not_self
    check (from_status is null or from_status <> to_status)
);

comment on table public.order_status_history is
  'Append-only audit trail of an order''s lifecycle. Written by trigger.';

create index order_status_history_order_idx
  on public.order_status_history (order_id, created_at);

-- No updated_at, and no trigger for one: nothing here is ever updated.

-- ---------------------------------------------------------------------------
-- The state machine, enforced
-- ---------------------------------------------------------------------------

-- Master section 33: "evitar cambios de estado arbitrarios".
--
-- Enforced against `order_transitions` rather than against a CASE written here,
-- so that the rules the trigger applies are literally the same rows the
-- dashboard reads to decide which buttons to draw. The classic failure this
-- avoids is a button for a transition the backend refuses.
--
-- In the database and not in the Server Action, for the reason that recurs
-- through this project: the dashboard is not the only writer. Phase 15 brings a
-- POS, Phase 16 a kitchen display, Phase 19 a courier app - and an invariant
-- that depends on every writer remembering is not an invariant.
create or replace function public.guard_order_status_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = old.status then
    return new;
  end if;

  if not exists (
    select 1 from public.order_transitions as t
    where t.from_status = old.status and t.to_status = new.status
  ) then
    raise exception 'An order cannot go from % to %.', old.status, new.status
      using errcode = 'P0001';
  end if;

  -- An order with no lines has nothing to confirm. Without this, a business
  -- could ring up, prepare and complete an empty sale, and the totals would all
  -- be zero with nothing to explain why.
  if new.status <> 'cancelled' and not exists (
    select 1 from public.order_items as i where i.order_id = new.id
  ) then
    raise exception 'An order with no lines cannot move forward.'
      using errcode = 'P0001';
  end if;

  -- Cancelling requires saying why. The CHECK on `orders` states the same
  -- invariant structurally; this raises it as a message somebody can act on
  -- rather than as a constraint name.
  if new.status = 'cancelled' then
    if new.cancel_reason is null or btrim(new.cancel_reason) = '' then
      raise exception 'Cancelling an order requires a reason.'
        using errcode = '23514';
    end if;
    new.cancelled_at := coalesce(new.cancelled_at, now());
  end if;

  if new.status = 'completed' then
    new.completed_at := coalesce(new.completed_at, now());
  end if;

  return new;
end;
$$;

comment on function public.guard_order_status_change() is
  'Refuses any transition not declared in public.order_transitions.';

create trigger orders_guard_status_change
  before update of status on public.orders
  for each row execute function public.guard_order_status_change();

-- ---------------------------------------------------------------------------
-- Writing the history
-- ---------------------------------------------------------------------------

create or replace function public.record_order_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.status = old.status then
    return null;
  end if;

  insert into public.order_status_history
    (order_id, tenant_id, from_status, to_status, reason, changed_by)
  values (
    new.id,
    new.tenant_id,
    case when tg_op = 'INSERT' then null else old.status end,
    new.status,
    case when new.status = 'cancelled' then new.cancel_reason else null end,
    -- auth.uid() is NULL for a service-role or SQL-console write, and that is
    -- recorded honestly rather than attributed to nobody in particular.
    (select auth.uid())
  );

  return null;
end;
$$;

comment on function public.record_order_status() is
  'Appends to order_status_history on creation and on every state change.';

create trigger orders_record_status
  after insert or update of status on public.orders
  for each row execute function public.record_order_status();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.order_status_history enable row level security;

create policy order_status_history_select_member
  on public.order_status_history for select to authenticated
  using (public.has_permission(tenant_id, 'orders.view'));

-- INSERT is granted because the trigger runs as the caller for the row it
-- writes. The trigger is the only realistic writer; a hand-written row would
-- have to name an order the caller can already see and would show up in the
-- trail as what it is.
create policy order_status_history_insert_operator
  on public.order_status_history for insert to authenticated
  with check (
    public.has_permission(tenant_id, 'orders.create')
    or public.has_permission(tenant_id, 'orders.update')
    or public.has_permission(tenant_id, 'orders.cancel')
  );

-- No UPDATE policy and no DELETE policy, deliberately and permanently. An audit
-- trail that can be edited is not one. This is the difference between this
-- table and every other in the project: elsewhere `is_active = false` preserves
-- history, here the rows ARE the history.
