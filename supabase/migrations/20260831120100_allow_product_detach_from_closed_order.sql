-- Phase 25 - Security Hardening
-- KL-2308: deleting a product that has been sold no longer fails.
--
-- SPEC: docs/specs/phase-25-security-hardening.md sections 23, 26.
-- ADR-029 decision 6.
--
-- THE BUG. `order_items.product_id` has been declared `on delete set null`
-- since Phase 13, so deleting a sold product was MEANT to work: the line keeps
-- its `name_snapshot` and `unit_price_cents`, and the historical ticket still
-- says what it said.
--
-- It did not work. That `SET NULL` is an UPDATE on `order_items`, and it ran
-- into the guard that stops anybody editing the lines of a closed order - which
-- refused it with "An order that is no longer pending cannot change its lines."
-- Somebody who only wanted to tidy their menu got an error about orders.
--
-- Phase 23 found this while writing TEST-2324 and deliberately did not touch it
-- (master section 51: do not change another phase's module for convenience),
-- recording it as KL-2308 with this phase as owner.
--
-- THE FIX is deliberately narrow. Exactly ONE edit is allowed on a closed
-- order's line: `product_id` going from non-null to null, with nothing else
-- changing. Every other edit stays refused, and a test proves it.

create or replace function public.recompute_order_item_total()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order_status public.order_status;
  v_detaching    boolean;
begin
  select o.status into v_order_status from public.orders as o where o.id = new.order_id;

  -- The `ON DELETE SET NULL` path, and only it: the product reference is being
  -- dropped and NOTHING else about the line is moving.
  --
  -- Written as "everything else is identical" rather than as a list of the
  -- columns that may change, so a column added by a future phase is covered on
  -- the day it is created rather than on the day somebody remembers it.
  v_detaching :=
    old.product_id is not null
    and new.product_id is null
    and to_jsonb(new) - 'product_id' = to_jsonb(old) - 'product_id';

  if v_order_status <> 'pending' and not v_detaching then
    raise exception 'An order that is no longer pending cannot change its lines.'
      using errcode = 'P0001';
  end if;

  -- The snapshot columns are pinned to their old values. An UPDATE that tries
  -- to rewrite the price of a line silently does nothing, rather than being
  -- accepted: there is no legitimate caller for it.
  --
  -- This is also what makes the detach above lossless: the line keeps the name
  -- and the price it was sold at, so a report of last March still reads the way
  -- last March's tickets did.
  new.name_snapshot    := old.name_snapshot;
  new.variant_snapshot := old.variant_snapshot;
  new.unit_price_cents := old.unit_price_cents;

  new.total_cents :=
    round(new.unit_price_cents * new.quantity) - new.discount_cents + new.tax_cents;

  return new;
end;
$$;

comment on function public.recompute_order_item_total() is
  'Recomputes a line total on update while pinning the snapshot columns. A closed order admits exactly one edit: losing a deleted product''s reference (ADR-029).';
