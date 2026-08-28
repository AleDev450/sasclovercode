-- Phase 19 - Delivery
-- The delivery of one order: where it goes, who carries it, where it is.
--
-- SPEC: docs/specs/phase-19-delivery.md sections 8, 10, 11, 14.
-- CLOVERCODE_MASTER.md sections 33 (Phase 19), 39, 41.
-- ADR-023 decisions 3, 4, 5.
--
-- This table finally gives `orders.shipping_cents` a writer. That column has
-- existed since Phase 13 and has been zero in every row ever written, and its
-- own comment said why it was there:
--
--   "The one amount that is NOT derived from the lines: delivery is a decision
--    made about the order as a whole."
--
-- The address is a COPY, not a reference. `customer_addresses` said so first,
-- in Phase 12: "the order will copy the delivery address onto itself rather
-- than referencing this row, precisely so that deleting it never changes where
-- something was delivered last month." The same reasoning ADR-017 applied to
-- `order_items.unit_price_cents`, applied to a place instead of a price.

create table public.order_deliveries (
  id                 uuid                   not null default gen_random_uuid(),
  -- Derived by trigger from the order; never trusted from a client.
  tenant_id          uuid                   not null,

  -- One delivery per order. See the UNIQUE below.
  order_id           uuid                   not null,

  -- SET NULL, not RESTRICT: a zone is configuration and CAN be deleted (Phase
  -- 19 policies on `delivery_zones`). What survives is the snapshot below, so
  -- deleting the zone never erases where this went.
  zone_id            uuid,
  zone_name_snapshot text                   not null,

  status             public.delivery_status not null default 'pending',

  -- Resolved from `delivery_rates` by the application at attach time and COPIED
  -- here (ADR-023 decision 3). Raising the price list tomorrow cannot change
  -- what was charged yesterday.
  fee_cents          bigint                 not null default 0,

  -- The address, snapshotted. Same columns and same limits as
  -- `customer_addresses`, because it is the same thing at a different moment.
  address_line       text                   not null,
  district           text,
  city               text,
  -- "frente al parque Kennedy" - frequently the only way the rider actually
  -- finds the door.
  reference          text,
  latitude           numeric(9, 6),
  longitude          numeric(9, 6),

  -- Who receives it, when that is not the account holder: the office
  -- receptionist, a neighbour, the person whose birthday it is.
  recipient_name     text,
  recipient_phone    text,
  notes              text,

  -- The rider. SET NULL rather than CASCADE: somebody leaving the company must
  -- not delete the record of the deliveries they made - the same posture
  -- `orders.created_by` takes.
  courier_user_id    uuid,

  assigned_at        timestamptz,
  dispatched_at      timestamptz,
  delivered_at       timestamptz,
  failed_at          timestamptz,
  cancelled_at       timestamptz,
  failure_reason     text,

  created_by         uuid,
  created_at         timestamptz            not null default now(),
  updated_at         timestamptz            not null default now(),

  constraint order_deliveries_pkey primary key (id),

  constraint order_deliveries_tenant_id_fkey
    foreign key (tenant_id) references public.tenants (id) on delete cascade,

  -- CASCADE is right here: a delivery is meaningless without its order. In
  -- practice it never fires - there is no DELETE policy on `orders` - but the
  -- declaration says what would happen.
  constraint order_deliveries_order_id_fkey
    foreign key (order_id) references public.orders (id) on delete cascade,

  constraint order_deliveries_zone_id_fkey
    foreign key (zone_id) references public.delivery_zones (id) on delete set null,

  constraint order_deliveries_courier_fkey
    foreign key (courier_user_id) references auth.users (id) on delete set null,
  constraint order_deliveries_created_by_fkey
    foreign key (created_by) references auth.users (id) on delete set null,

  -- One delivery per order.
  --
  -- This is what makes `failed` recoverable rather than terminal (ADR-023
  -- decision 5): a second attempt is the same row moving back to `assigned`,
  -- because a second ROW is not possible. Without this constraint, "which
  -- delivery belongs to this order?" would stop having one answer.
  constraint order_deliveries_order_id_key unique (order_id),

  constraint order_deliveries_fee_range
    check (fee_cents between 0 and 10000000000),

  constraint order_deliveries_zone_snapshot_length
    check (char_length(btrim(zone_name_snapshot)) between 1 and 80),
  constraint order_deliveries_address_length
    check (char_length(btrim(address_line)) between 1 and 300),
  constraint order_deliveries_text_lengths check (
    coalesce(char_length(district), 0) <= 100
    and coalesce(char_length(city), 0) <= 100
    and coalesce(char_length(reference), 0) <= 200
    and coalesce(char_length(recipient_name), 0) <= 120
    and coalesce(char_length(recipient_phone), 0) <= 30
    and coalesce(char_length(notes), 0) <= 500
  ),

  -- Half a coordinate is not a location. Both or neither - the same rule
  -- `locations` (Phase 10) and now `customer_addresses` carry.
  constraint order_deliveries_coordinates_together
    check ((latitude is null) = (longitude is null)),
  constraint order_deliveries_latitude_range
    check (latitude is null or latitude between -90 and 90),
  constraint order_deliveries_longitude_range
    check (longitude is null or longitude between -180 and 180),

  -- Each terminal state and its timestamp are the same fact, so they are stated
  -- as an equivalence in both directions - the shape `orders` already uses for
  -- `completed_at` and `cancelled_at`.
  constraint order_deliveries_delivered_at
    check ((status = 'delivered') = (delivered_at is not null)),
  constraint order_deliveries_failed_at
    check ((status = 'failed') = (failed_at is not null)),
  constraint order_deliveries_cancelled_at
    check ((status = 'cancelled') = (cancelled_at is not null)),

  -- Ending badly requires saying why. An implication rather than an
  -- equivalence: a retry moves out of `failed` and the reason for the first
  -- attempt stays worth keeping, so a reason on a live delivery is allowed.
  constraint order_deliveries_failure_reason_required check (
    status not in ('failed', 'cancelled') or failure_reason is not null
  ),
  constraint order_deliveries_failure_reason_length check (
    failure_reason is null or char_length(btrim(failure_reason)) between 1 and 300
  ),

  -- Somebody is carrying it, or it has not left. A delivery cannot be
  -- `in_transit` with nobody assigned.
  constraint order_deliveries_courier_required check (
    status not in ('assigned', 'in_transit', 'delivered')
    or courier_user_id is not null
  )
);

comment on table public.order_deliveries is
  'The delivery of one order. Address and fee are snapshots, never references (ADR-023).';
comment on column public.order_deliveries.fee_cents is
  'Minor units (ADR-015). Copied from delivery_rates at attach time; drives orders.shipping_cents.';
comment on column public.order_deliveries.zone_name_snapshot is
  'The zone name as it read when attached, so deleting the zone never rewrites history.';

-- The board's main filter: "what is open right now".
create index order_deliveries_tenant_status_idx
  on public.order_deliveries (tenant_id, status);

-- "My deliveries" - partial, because most rows have no courier yet and an
-- index over them would be mostly NULLs.
create index order_deliveries_tenant_courier_idx
  on public.order_deliveries (tenant_id, courier_user_id)
  where courier_user_id is not null;

-- The default ordering of the board.
create index order_deliveries_tenant_created_idx
  on public.order_deliveries (tenant_id, created_at desc);

create trigger order_deliveries_set_updated_at
  before update on public.order_deliveries
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- delivery_status_history
-- ---------------------------------------------------------------------------

-- The audit trail master section 17 asks for, in the shape
-- `order_status_history` (Phase 13) already established: append-only, written
-- exclusively by a trigger, and readable by whoever may read the delivery.
create table public.delivery_status_history (
  id          uuid                   not null default gen_random_uuid(),
  delivery_id uuid                   not null,
  tenant_id   uuid                   not null,

  -- NULL on creation: there was no previous state. Recording 'pending' as the
  -- origin of 'pending' would be inventing a transition that never happened.
  from_status public.delivery_status,
  to_status   public.delivery_status not null,
  reason      text,
  changed_by  uuid,
  created_at  timestamptz            not null default now(),

  constraint delivery_status_history_pkey primary key (id),

  constraint delivery_status_history_delivery_id_fkey
    foreign key (delivery_id) references public.order_deliveries (id) on delete cascade,
  constraint delivery_status_history_tenant_id_fkey
    foreign key (tenant_id) references public.tenants (id) on delete cascade,
  constraint delivery_status_history_changed_by_fkey
    foreign key (changed_by) references auth.users (id) on delete set null,

  constraint delivery_status_history_reason_length
    check (reason is null or char_length(btrim(reason)) between 1 and 300),
  constraint delivery_status_history_not_self
    check (from_status is null or from_status <> to_status)
);

comment on table public.delivery_status_history is
  'Append-only trail of every delivery state change. Written only by trigger.';

create index delivery_status_history_delivery_idx
  on public.delivery_status_history (delivery_id, created_at);

-- ---------------------------------------------------------------------------
-- tenant_id from the order, and the cross-tenant guards
-- ---------------------------------------------------------------------------

-- One function derives and guards, following `derive_stock_movement_tenant()`
-- (Phase 18): PostgreSQL fires BEFORE triggers alphabetically, so splitting
-- this would make the guard run against a tenant_id not yet derived.
--
-- Three things can disagree here and RLS catches none of them, because the
-- caller has permission on the row being written:
--
--   the ZONE could belong to another business
--   the COURIER could be a member of another business
--   the ORDER could have moved past `pending`
--
-- The last one is not a tenant question but a money question, and it is the
-- same rule `order_items` enforces on its own lines: once an order stops being
-- `pending` its total is settled, and from Phase 14 `paid_cents` is compared
-- against it. Attaching a delivery to a paid order would leave a balance
-- nobody asked for.
create or replace function public.derive_order_delivery_tenant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order_tenant uuid;
  v_order_status public.order_status;
  v_zone_tenant  uuid;
  v_is_member    boolean;
begin
  select o.tenant_id, o.status into v_order_tenant, v_order_status
  from public.orders as o
  where o.id = new.order_id;

  if v_order_tenant is null then
    raise exception 'Order not found.' using errcode = 'P0002';
  end if;

  new.tenant_id := v_order_tenant;

  -- Attaching, or changing what is charged, is only possible while the order is
  -- still a draft. Everything else about a delivery - its state, its courier, a
  -- corrected address - stays editable afterwards, because none of it is money.
  if tg_op = 'INSERT' and v_order_status <> 'pending' then
    raise exception 'An order that is no longer pending cannot take a delivery.'
      using errcode = 'P0001';
  end if;

  if tg_op = 'UPDATE'
     and new.fee_cents is distinct from old.fee_cents
     and v_order_status <> 'pending' then
    raise exception 'An order that is no longer pending cannot change its delivery cost.'
      using errcode = 'P0001';
  end if;

  if new.zone_id is not null then
    select z.tenant_id into v_zone_tenant
    from public.delivery_zones as z
    where z.id = new.zone_id;

    if v_zone_tenant is null or v_zone_tenant <> new.tenant_id then
      raise exception 'That delivery zone belongs to a different business.'
        using errcode = '23514';
    end if;
  end if;

  -- The rider must be one of this business's people. Without this, a delivery
  -- could name any user id in the system - which would then read as "assigned"
  -- to somebody who cannot see it and has no relationship with the business.
  if new.courier_user_id is not null then
    select exists (
      select 1 from public.tenant_members as m
      where m.tenant_id = new.tenant_id
        and m.user_id = new.courier_user_id
        and m.status = 'active'
    ) into v_is_member;

    if not v_is_member then
      raise exception 'That courier is not an active member of this business.'
        using errcode = '23514';
    end if;
  end if;

  if tg_op = 'INSERT' then
    new.created_by := coalesce(new.created_by, (select auth.uid()));
  end if;

  return new;
end;
$$;

comment on function public.derive_order_delivery_tenant() is
  'Derives tenant_id from the order and refuses a foreign zone, a foreign courier, or a settled order.';

create trigger order_deliveries_derive_tenant
  before insert or update on public.order_deliveries
  for each row execute function public.derive_order_delivery_tenant();

-- ---------------------------------------------------------------------------
-- The state machine
-- ---------------------------------------------------------------------------

-- Enforced against `delivery_transitions` rather than a CASE written here, so
-- the rules the trigger applies are literally the rows the board reads to
-- decide which buttons to draw. Same reasoning, same shape, as
-- `guard_order_status_change()` (Phase 13).
--
-- In the database and not in the Server Action, for the reason that recurs
-- through this project: the dashboard is not the only writer. The order
-- cancellation trigger below writes here too, and an invariant that depends on
-- every writer remembering is not an invariant.
create or replace function public.guard_delivery_status_change()
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
    select 1 from public.delivery_transitions as t
    where t.from_status = old.status and t.to_status = new.status
  ) then
    raise exception 'A delivery cannot go from % to %.', old.status, new.status
      using errcode = 'P0001';
  end if;

  -- Ending badly requires saying why. The CHECK states the same invariant
  -- structurally; this raises it as a message somebody can act on rather than
  -- as a constraint name.
  if new.status in ('failed', 'cancelled')
     and (new.failure_reason is null or btrim(new.failure_reason) = '') then
    raise exception 'A failed or cancelled delivery requires a reason.'
      using errcode = '23514';
  end if;

  -- The timestamps are set here, not sent by a caller: they record when the
  -- database saw the change, which is the only time anybody can verify.
  if new.status = 'assigned'   then new.assigned_at   := coalesce(new.assigned_at, now()); end if;
  if new.status = 'in_transit' then new.dispatched_at := coalesce(new.dispatched_at, now()); end if;
  if new.status = 'delivered'  then new.delivered_at  := coalesce(new.delivered_at, now()); end if;
  if new.status = 'failed'     then new.failed_at     := coalesce(new.failed_at, now()); end if;
  if new.status = 'cancelled'  then new.cancelled_at  := coalesce(new.cancelled_at, now()); end if;

  -- Leaving `failed` for a retry clears the mark of the failure but keeps the
  -- reason: the history row already recorded that it happened, and the column
  -- is what the CHECK ties to the state.
  if old.status = 'failed' and new.status <> 'failed' then
    new.failed_at := null;
  end if;

  return new;
end;
$$;

comment on function public.guard_delivery_status_change() is
  'Refuses any transition not declared in public.delivery_transitions.';

create trigger order_deliveries_guard_status
  before update of status on public.order_deliveries
  for each row execute function public.guard_delivery_status_change();

-- ---------------------------------------------------------------------------
-- Writing the history
-- ---------------------------------------------------------------------------

create or replace function public.record_delivery_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.status = old.status then
    return null;
  end if;

  insert into public.delivery_status_history
    (delivery_id, tenant_id, from_status, to_status, reason, changed_by)
  values (
    new.id,
    new.tenant_id,
    case when tg_op = 'INSERT' then null else old.status end,
    new.status,
    case when new.status in ('failed', 'cancelled') then new.failure_reason else null end,
    -- auth.uid() is NULL for a service-role or SQL-console write, and that is
    -- recorded honestly rather than attributed to nobody in particular.
    (select auth.uid())
  );

  return null;
end;
$$;

comment on function public.record_delivery_status() is
  'Appends to delivery_status_history on creation and on every state change.';

create trigger order_deliveries_record_status
  after insert or update of status on public.order_deliveries
  for each row execute function public.record_delivery_status();

-- ---------------------------------------------------------------------------
-- The order's shipping, and its total
-- ---------------------------------------------------------------------------

-- The trigger that has been missing since Phase 13.
--
-- `recompute_order_totals()` computes `total = SUM(items) + o.shipping_cents`,
-- reading a `shipping_cents` that nothing wrote. This is the symmetric half:
-- when the delivery changes, `shipping_cents` is written and the total is
-- recomputed with the identical formula.
--
-- Deliberately the same expression as the Phase 13 function, so the two can
-- never produce different answers for the same order. The application computes
-- neither of them (master section 39, and the Phase 13 comment: "two writers
-- each computing a total independently is two totals").
create or replace function public.sync_order_shipping()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order_id uuid   := coalesce(new.order_id, old.order_id);
  v_shipping bigint := case when tg_op = 'DELETE' then 0 else new.fee_cents end;
begin
  update public.orders as o
  set shipping_cents = v_shipping,
      total_cents    = coalesce(
        (select sum(i.total_cents) from public.order_items as i where i.order_id = v_order_id),
        0
      ) + v_shipping
  where o.id = v_order_id;

  return null;
end;
$$;

comment on function public.sync_order_shipping() is
  'Writes orders.shipping_cents from the delivery and recomputes total_cents.';

-- DELETE is included even though `order_deliveries` has no DELETE policy: a
-- cascade from `orders` reaches it, and a future migration that removes a
-- delivery must not leave a phantom shipping charge behind. A trigger that
-- covers the case costs nothing and removes a way to be wrong later.
create trigger order_deliveries_sync_shipping
  after insert or delete or update of fee_cents on public.order_deliveries
  for each row execute function public.sync_order_shipping();

-- ---------------------------------------------------------------------------
-- Cancelling the order cancels the delivery
-- ---------------------------------------------------------------------------

-- The ONE coupling between the two lifecycles, and it runs in the safe
-- direction: from the order to the delivery, never the reverse.
--
-- ADR-023 decision 4 carries the argument. The short version: cancelling a
-- delivery moves neither money nor stock, while the reverse coupling - a
-- delivery completing its order - would fire the Phase 18 stock consumption
-- from a rider's phone, through two chained triggers, invisibly.
--
-- A delivery that already reached a terminal state is not touched: it was
-- delivered, and that happened.
create or replace function public.cancel_delivery_with_order()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status <> 'cancelled' or old.status = 'cancelled' then
    return null;
  end if;

  update public.order_deliveries as d
  set status         = 'cancelled',
      failure_reason = coalesce(d.failure_reason, new.cancel_reason, 'Pedido anulado.')
  where d.order_id = new.id
    and d.status not in ('delivered', 'cancelled');

  return null;
end;
$$;

comment on function public.cancel_delivery_with_order() is
  'Cancels a live delivery when its order is cancelled. Never touches a delivered one.';

create trigger orders_cancel_delivery
  after update of status on public.orders
  for each row execute function public.cancel_delivery_with_order();

-- ---------------------------------------------------------------------------
-- Removing a delivery, while that is still a correction
-- ---------------------------------------------------------------------------

-- A DELETE has no NEW row, so the pending check lives in its own trigger - the
-- same shape, and the same reasoning, as `guard_order_item_delete()`.
create or replace function public.guard_order_delivery_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order_status public.order_status;
begin
  select o.status into v_order_status
  from public.orders as o
  where o.id = old.order_id;

  -- The order itself being deleted cascades here; there is nothing left to
  -- protect and no status to read.
  if v_order_status is null then
    return old;
  end if;

  if v_order_status <> 'pending' then
    raise exception 'An order that is no longer pending cannot drop its delivery.'
      using errcode = 'P0001';
  end if;

  return old;
end;
$$;

comment on function public.guard_order_delivery_delete() is
  'Refuses to remove the delivery of an order that has left `pending`.';

create trigger order_deliveries_guard_delete
  before delete on public.order_deliveries
  for each row execute function public.guard_order_delivery_delete();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.order_deliveries enable row level security;
alter table public.delivery_status_history enable row level security;

create policy order_deliveries_select_member
  on public.order_deliveries for select to authenticated
  using (public.has_permission(tenant_id, 'deliveries.view'));

-- No `anon` policy. A delivery names a home address, a phone number and a
-- coordinate: it is the most sensitive row this phase creates, and the
-- reasoning of ADR-016 applies to it at least as strongly as it does to
-- `customers`.

create policy order_deliveries_insert_operator
  on public.order_deliveries for insert to authenticated
  with check (public.has_permission(tenant_id, 'deliveries.manage'));

create policy order_deliveries_update_operator
  on public.order_deliveries for update to authenticated
  using (public.has_permission(tenant_id, 'deliveries.manage'))
  with check (public.has_permission(tenant_id, 'deliveries.manage'));

-- A delivery CAN be deleted, but only while its order is still `pending` -
-- which the trigger below enforces, exactly as `guard_order_item_delete()`
-- (Phase 13) does for order lines.
--
-- It is needed rather than merely convenient: `UNIQUE(order_id)` means a
-- delivery attached to the wrong zone cannot be replaced by attaching another
-- one. Cancelling it would not free the order either, and would leave the
-- shipping charge on a draft nobody agreed to. Removing a delivery from an
-- order that has not been confirmed is correcting a draft, not erasing history
-- - the same distinction, and the same guard, as a line.
create policy order_deliveries_delete_operator
  on public.order_deliveries for delete to authenticated
  using (public.has_permission(tenant_id, 'deliveries.manage'));

create policy delivery_status_history_select_member
  on public.delivery_status_history for select to authenticated
  using (public.has_permission(tenant_id, 'deliveries.view'));

-- No INSERT, UPDATE or DELETE policy at all. Only `record_delivery_status()`
-- writes here, and it is SECURITY DEFINER - so the trail cannot be forged or
-- tidied up by anybody, which is the entire point of keeping one.
