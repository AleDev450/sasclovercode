-- Phase 19 - Delivery
-- The vocabulary of a delivery: what state it is in, and where it may go next.
--
-- SPEC: docs/specs/phase-19-delivery.md sections 8, 9.
-- CLOVERCODE_MASTER.md section 33 (Phase 19).

-- Master section 33 asks for "estados" without listing them, unlike Phase 13
-- where it names all six. These six are the operational events a rider and a
-- shop actually distinguish, and each one exists because something different
-- is true after it:
--
--   pending     the delivery exists, nobody is carrying it yet
--   assigned    a specific person is responsible
--   in_transit  it left the shop - the point of no return for the kitchen
--   delivered   it arrived
--   failed      the attempt happened and did not work (nobody home)
--   cancelled   it will not happen at all
--
-- `failed` and `cancelled` are NOT the same thing and collapsing them would
-- lose the difference between "we tried" and "we never went", which is exactly
-- what a business needs to tell apart when it looks at why deliveries miss.
create type public.delivery_status as enum (
  'pending',
  'assigned',
  'in_transit',
  'delivered',
  'failed',
  'cancelled'
);

comment on type public.delivery_status is
  'Lifecycle of a delivery. Transitions are declared in public.delivery_transitions.';

-- ---------------------------------------------------------------------------
-- The state machine, AS DATA
-- ---------------------------------------------------------------------------

-- The third time this project writes a state machine as a table, and for the
-- same three reasons ADR-017 section 4 gave for `order_transitions` and Phase
-- 17 reused for `billing_document_transitions`:
--
--   1. It can be READ. The board asks the database which buttons to draw, so
--      the UI cannot drift from the rules - no button for a move the backend
--      refuses.
--   2. It can be TESTED as data: TEST-1901 compares this table against the
--      TypeScript mirror, so the two cannot disagree silently.
--   3. Adding a transition is an INSERT in a migration, reviewable on its own,
--      rather than an edit buried inside a procedure.
--
-- No `tenant_id`, deliberately. The lifecycle of a delivery belongs to the
-- product, not to each business: a tenant does not get to invent a path from
-- `delivered` back to `pending`. It is the one global table of this phase, and
-- it holds no business data.
create table public.delivery_transitions (
  from_status public.delivery_status not null,
  to_status   public.delivery_status not null,

  constraint delivery_transitions_pkey primary key (from_status, to_status),
  -- A self-transition is not a transition. Allowing it would let a caller
  -- "change" a state to itself and write a misleading history row.
  constraint delivery_transitions_not_self check (from_status <> to_status)
);

comment on table public.delivery_transitions is
  'The allowed delivery state changes. Read by the trigger AND by the UI, so they agree.';

insert into public.delivery_transitions (from_status, to_status) values
  -- The happy path.
  ('pending',    'assigned'),
  ('assigned',   'in_transit'),
  ('in_transit', 'delivered'),

  -- The rider fell through and there is no replacement yet. Without this, an
  -- unassignable delivery would have to be cancelled and re-created, and
  -- UNIQUE(order_id) makes re-creating it impossible.
  ('assigned',   'pending'),

  -- Nobody home, wrong address. A real event, distinct from cancelling.
  ('in_transit', 'failed'),

  -- The second attempt is the SAME delivery, of the same order, to the same
  -- address - so `failed` is recoverable rather than terminal. Treating a
  -- retry as a new row would mean lifting UNIQUE(order_id), and then "which
  -- delivery belongs to this order?" would stop having one answer.
  ('failed',     'assigned'),

  -- Cancelling is possible from anywhere that is not already terminal. This is
  -- also the path the order-cancellation trigger uses, and `failed` has to be
  -- among them: a delivery that failed and whose order is then cancelled must
  -- be able to close, or cancelling the order would fail with it.
  ('pending',    'cancelled'),
  ('assigned',   'cancelled'),
  ('in_transit', 'cancelled'),
  ('failed',     'cancelled');

-- `delivered` and `cancelled` appear only as destinations, never as an origin.
-- That is what makes them terminal, and it is stated by their ABSENCE from the
-- left column - so TEST-1928 checks the absence rather than trusting it.

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.delivery_transitions enable row level security;

-- Readable by any signed-in user, on the same grounds as `order_transitions`
-- (Phase 13) and `billing_document_transitions` (Phase 17): the board needs it
-- to know which buttons to draw, and it contains no business data. `anon` is
-- not included - the public site has no reason to know how a delivery moves.
create policy delivery_transitions_select_authenticated
  on public.delivery_transitions for select to authenticated
  using (true);

-- No INSERT, UPDATE or DELETE policy at all. The machine changes in a
-- migration, reviewed, or it does not change.
