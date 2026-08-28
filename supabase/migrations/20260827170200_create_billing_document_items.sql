-- Phase 17 - Electronic Billing / SUNAT
-- The lines of a document, and the IGV Phase 13 deliberately left at zero.
--
-- SPEC: docs/specs/phase-17-billing-sunat.md sections 8, 11.
-- ADR-017 (Phase 13): "quien decide el IGV... es la Fase 17 con las reglas
-- de SUNAT delante." This is that decision.
--
-- Populated automatically, from the order's own lines - not sent by a
-- client. "One document = one whole order" (this phase's own scope
-- decision): issuing a document copies every order_items row of the order
-- it bills, the same moment `billing_documents` itself is created, so there
-- is no second form asking a cashier to re-enter what was already sold.

create table public.billing_document_items (
  id                    uuid          not null default gen_random_uuid(),
  billing_document_id   uuid          not null,
  -- Derived by trigger from the document.
  tenant_id             uuid          not null,
  -- A pointer, not a dependency - same shape as order_items.product_id
  -- (Phase 13): the line's own copy is what matters; if the order line is
  -- ever gone, this line is still exact.
  order_item_id         uuid,

  description_snapshot  text          not null,
  quantity              numeric(10,3) not null,
  unit_price_cents      bigint        not null,
  discount_cents        bigint        not null default 0,

  -- Gross (IGV-inclusive), copied from order_items.total_cents - not
  -- recomputed from price*quantity here. The order already decided what was
  -- actually charged (Phase 13); this table only decides how much of that
  -- charge was tax.
  total_cents           bigint        not null,
  -- Base imponible and IGV, split OUT of total_cents (never added on top) -
  -- CloverCode's prices are IGV-inclusive throughout (ADR-021 section on
  -- IGV, in the SPEC): tax_cents is the remainder of dividing by 1.18, so
  -- subtotal_cents + tax_cents always equals total_cents exactly, with no
  -- second rounding to drift against it.
  subtotal_cents         bigint        not null,
  tax_cents              bigint        not null,

  position               smallint      not null default 0,
  created_at             timestamptz   not null default now(),

  constraint billing_document_items_pkey primary key (id),

  constraint billing_document_items_document_id_fkey
    foreign key (billing_document_id) references public.billing_documents (id) on delete cascade,
  constraint billing_document_items_tenant_id_fkey
    foreign key (tenant_id) references public.tenants (id) on delete cascade,
  constraint billing_document_items_order_item_id_fkey
    foreign key (order_item_id) references public.order_items (id) on delete set null,

  constraint billing_document_items_description_length
    check (char_length(btrim(description_snapshot)) between 1 and 200),
  constraint billing_document_items_quantity_positive check (quantity > 0 and quantity <= 100000),
  constraint billing_document_items_amounts_range check (
    unit_price_cents between 0 and 10000000000
    and discount_cents >= 0
    and total_cents between 0 and 10000000000
    and subtotal_cents between 0 and 10000000000
    and tax_cents between 0 and 10000000000
  ),
  -- The split must add up. Not trusted to be true by construction - asserted,
  -- the same way order_items_discount_within_gross (Phase 13) asserts its
  -- own arithmetic invariant rather than hoping the trigger got it right.
  constraint billing_document_items_split_adds_up check (subtotal_cents + tax_cents = total_cents),
  constraint billing_document_items_position_range check (position between 0 and 1000)
);

comment on table public.billing_document_items is
  'Lines of a billing document, copied from order_items at document creation. IGV split out of an inclusive price, never added on top (ADR-021).';

create index billing_document_items_document_position_idx
  on public.billing_document_items (billing_document_id, position);

-- No updated_at, no UPDATE policy, no DELETE policy: like order_status_history
-- (Phase 13), this is a record of what was declared, not an editable line.

-- ---------------------------------------------------------------------------
-- The 18% split - a named function, not a magic number repeated
-- ---------------------------------------------------------------------------

-- 16% IGV + 2% IPM, the general rate at the time this phase was built
-- (confirmed by current SUNAT-adjacent sources during planning, not
-- training-data memory - see ADR-021). A single function, not a literal
-- copied into every call site, so a future rate change - or an exonerated
-- category, if CloverCode ever needs one - is one definition to update.
create or replace function public.igv_rate()
returns numeric
language sql
immutable
set search_path = ''
as $$
  select 0.18::numeric;
$$;

comment on function public.igv_rate() is
  'The general IGV rate CloverCode prices are inclusive of. See ADR-021 for why this is a single named rate, not a per-tenant setting.';

-- Two scalar functions, not one table-returning one: a set-returning
-- function called twice in the same SELECT list (once per field) is exactly
-- the kind of thing that is easy to get subtly wrong in PostgreSQL. `tax` is
-- defined as the REMAINDER of `total - subtotal`, not computed
-- independently, so the two always sum back to the input exactly - never
-- two separately-rounded halves that could disagree with each other by a
-- cent.
create or replace function public.igv_subtotal_from_total(p_total_cents bigint)
returns bigint
language sql
immutable
set search_path = ''
as $$
  select round(p_total_cents / (1 + public.igv_rate()))::bigint;
$$;

create or replace function public.igv_tax_from_total(p_total_cents bigint)
returns bigint
language sql
immutable
set search_path = ''
as $$
  select p_total_cents - public.igv_subtotal_from_total(p_total_cents);
$$;

comment on function public.igv_tax_from_total(bigint) is
  'The remainder of total minus subtotal - keeps billing_document_items_split_adds_up true by construction, not by hoping two roundings agree.';

-- ---------------------------------------------------------------------------
-- Populating the lines when a document is created
-- ---------------------------------------------------------------------------

create or replace function public.populate_billing_document_items()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.billing_document_items (
    billing_document_id, tenant_id, order_item_id, description_snapshot,
    quantity, unit_price_cents, discount_cents, total_cents, subtotal_cents, tax_cents, position
  )
  select
    new.id,
    new.tenant_id,
    i.id,
    i.name_snapshot || coalesce(' - ' || i.variant_snapshot, ''),
    i.quantity,
    i.unit_price_cents,
    i.discount_cents,
    i.total_cents,
    public.igv_subtotal_from_total(i.total_cents),
    public.igv_tax_from_total(i.total_cents),
    i.position
  from public.order_items as i
  where i.order_id = new.order_id;

  if not found then
    raise exception 'An order with no lines cannot be billed.' using errcode = 'P0001';
  end if;

  update public.billing_documents as d
  set subtotal_cents = totals.subtotal,
      tax_cents      = totals.tax,
      total_cents    = totals.total
  from (
    select
      coalesce(sum(subtotal_cents), 0)::bigint as subtotal,
      coalesce(sum(tax_cents), 0)::bigint as tax,
      coalesce(sum(total_cents), 0)::bigint as total
    from public.billing_document_items
    where billing_document_id = new.id
  ) as totals
  where d.id = new.id;

  return null;
end;
$$;

comment on function public.populate_billing_document_items() is
  'Copies every order_items row of the billed order into billing_document_items, and totals the document from them. Never sent by a client.';

create trigger billing_documents_populate_items
  after insert on public.billing_documents
  for each row execute function public.populate_billing_document_items();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.billing_document_items enable row level security;

-- Governed by the DOCUMENT's permission, not one of its own - a line is
-- part of a document, the same relationship order_items has to orders
-- (Phase 13).
create policy billing_document_items_select_member
  on public.billing_document_items for select to authenticated
  using (public.has_permission(tenant_id, 'billing.view'));

-- No INSERT, UPDATE or DELETE policy for a direct caller: the only writer is
-- the SECURITY DEFINER trigger above, which bypasses RLS the same way
-- Phase 13's order-totals trigger updates `orders` without `orders` needing
-- a policy for it.
