-- Phase 13 - Orders Core
-- The vocabulary of an order: what state it is in, and where it came from.
--
-- SPEC: docs/specs/phase-13-orders-core.md sections 8, 9.
-- CLOVERCODE_MASTER.md section 33 (Phase 13).

-- The six states master section 33 lists, in the order it lists them.
create type public.order_status as enum (
  'pending',
  'confirmed',
  'preparing',
  'ready',
  'completed',
  'cancelled'
);

comment on type public.order_status is
  'Lifecycle of an order. Transitions are declared in public.order_transitions.';

-- The five sources master section 33 lists.
--
-- `web` exists here before the public checkout that produces it: the column has
-- to be able to say where an order came from from day one, and adding an enum
-- value later would mean every historical row silently means "manual".
create type public.order_source as enum (
  'web',
  'pos',
  'manual',
  'whatsapp',
  'delivery'
);

comment on type public.order_source is
  'Where an order came from. Master section 33 (Phase 13).';

-- ---------------------------------------------------------------------------
-- The state machine, AS DATA
-- ---------------------------------------------------------------------------

-- Master section 33 asks for "estados definidos mediante state machine clara"
-- and "evitar cambios de estado arbitrarios".
--
-- A table rather than a CASE inside a trigger, for three reasons:
--
--   1. It can be READ. The dashboard asks the database which buttons to draw,
--      so the UI cannot drift from the rules - the classic failure is a button
--      that exists for a transition the backend refuses.
--   2. It can be TESTED as data: TEST-1301 compares this table against the
--      TypeScript mirror, so the two cannot disagree silently.
--   3. Adding a transition is an INSERT in a migration, reviewable on its own,
--      rather than an edit buried inside a procedure.
--
-- No `tenant_id`, deliberately. The lifecycle of an order belongs to the
-- product, not to each business: a tenant does not get to invent a path from
-- `completed` back to `pending`. It is the one global table of this phase, and
-- it holds no business data.
create table public.order_transitions (
  from_status public.order_status not null,
  to_status   public.order_status not null,

  constraint order_transitions_pkey primary key (from_status, to_status),
  -- A self-transition is not a transition. Allowing it would let a caller
  -- "change" a state to itself and write a misleading history row.
  constraint order_transitions_not_self check (from_status <> to_status)
);

comment on table public.order_transitions is
  'The allowed state changes. Read by the trigger AND by the UI, so they agree.';

insert into public.order_transitions (from_status, to_status) values
  -- The happy path, one step at a time. There is no pending -> ready: an order
  -- that was never confirmed cannot be ready, and a kitchen that skips ahead
  -- hides a step somebody needs to see.
  ('pending',   'confirmed'),
  ('confirmed', 'preparing'),
  ('preparing', 'ready'),
  ('ready',     'completed'),

  -- Cancelling is possible from anywhere that is not already terminal. A
  -- customer who walks out while the food is being made is a real event, and
  -- the alternative - forcing the order to `completed` first - would record a
  -- sale that never happened.
  ('pending',   'cancelled'),
  ('confirmed', 'cancelled'),
  ('preparing', 'cancelled'),
  ('ready',     'cancelled');

-- `completed` and `cancelled` appear only as destinations, never as an origin.
-- That is what makes them terminal, and it is stated by their ABSENCE from the
-- left column - so TEST-1313 checks the absence rather than trusting it.

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.order_transitions enable row level security;

-- Readable by any signed-in user: the dashboard needs it to know which buttons
-- to draw, and it contains no business data. `anon` is not included - the
-- public site has no reason to know the internal lifecycle of an order.
create policy order_transitions_select_authenticated
  on public.order_transitions for select to authenticated
  using (true);

-- No INSERT, UPDATE or DELETE policy at all. The machine changes in a
-- migration, reviewed, or it does not change.
