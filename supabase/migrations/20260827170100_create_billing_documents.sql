-- Phase 17 - Electronic Billing / SUNAT
-- What was declared to SUNAT about a sale, and its lifecycle.
--
-- SPEC: docs/specs/phase-17-billing-sunat.md sections 8, 10, 11.
-- CLOVERCODE_MASTER.md section 33 (Phase 17), section 37 (idempotencia).
-- ADR-021: BillingProvider ships with a manual implementation only; this
-- table's lifecycle is what a person's own manual filing (or, later, a real
-- provider) drives forward.
--
-- Same posture as `orders` (Phase 13): this is an EVENT, not a setting. A
-- document's own facts - who was billed, what was charged, what tax applied
-- - are snapshotted at the moment it is created and never re-read from a
-- catalogue, a customer row or a tenant's own settings afterward.

create type public.billing_document_type as enum ('boleta', 'factura', 'nota_credito', 'nota_debito');
create type public.billing_document_status as enum ('pending', 'sent', 'accepted', 'rejected', 'cancelled');

create table public.billing_documents (
  id                          uuid        not null default gen_random_uuid(),
  tenant_id                   uuid        not null,
  order_id                    uuid        not null,
  customer_id                 uuid,

  type                        public.billing_document_type   not null,
  status                      public.billing_document_status not null default 'pending',

  -- Assigned by trigger from `billing_provider_configs`, never accepted from
  -- a client - the same posture Phase 13 takes toward `orders.number`.
  series                      text        not null,
  number                      integer     not null,

  -- Sent unchanged on every retry of the SAME attempt, for a future real
  -- provider's own deduplication (ADR-021 section 3). Generated once here;
  -- the UNIQUE index below is the OTHER half of idempotency - it stops a
  -- second, independent attempt at billing the same order.
  idempotency_key             uuid        not null default gen_random_uuid(),

  -- THE SNAPSHOT. What was true when this document was created, copied once
  -- and never re-read - a later edit to the business's own RUC or a
  -- customer's name must not rewrite a document already declared.
  issuer_ruc_snapshot         text        not null,
  customer_name_snapshot      text,
  customer_doc_type_snapshot  public.customer_doc_type,
  customer_doc_number_snapshot text,

  -- Computed from `billing_document_items` by trigger (next migration),
  -- exactly like `orders`' own totals (Phase 13) - the application never
  -- sends these.
  subtotal_cents              bigint      not null default 0,
  tax_cents                   bigint      not null default 0,
  total_cents                 bigint      not null default 0,

  -- Only for nota_credito / nota_debito: which document this one corrects.
  related_document_id         uuid,

  rejection_reason            text,
  cancel_reason                text,
  sent_at                     timestamptz,
  accepted_at                 timestamptz,
  rejected_at                 timestamptz,
  cancelled_at                timestamptz,

  created_by                  uuid,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),

  constraint billing_documents_pkey primary key (id),

  constraint billing_documents_tenant_id_fkey
    foreign key (tenant_id) references public.tenants (id) on delete cascade,
  -- RESTRICT: a tax document must never silently lose the sale it declares.
  constraint billing_documents_order_id_fkey
    foreign key (order_id) references public.orders (id) on delete restrict,
  constraint billing_documents_customer_id_fkey
    foreign key (customer_id) references public.customers (id) on delete restrict,
  constraint billing_documents_related_document_id_fkey
    foreign key (related_document_id) references public.billing_documents (id) on delete restrict,
  constraint billing_documents_created_by_fkey
    foreign key (created_by) references auth.users (id) on delete set null,

  -- The correlative is per tenant, per type, per series - three businesses,
  -- or one business's boleta and factura series, never collide.
  constraint billing_documents_series_number_key unique (tenant_id, type, series, number),
  constraint billing_documents_number_positive check (number > 0),

  constraint billing_documents_series_length check (char_length(btrim(series)) between 1 and 20),
  constraint billing_documents_issuer_ruc_length check (char_length(issuer_ruc_snapshot) = 11),
  constraint billing_documents_customer_name_length
    check (coalesce(char_length(customer_name_snapshot), 0) <= 200),
  constraint billing_documents_rejection_reason_length
    check (coalesce(char_length(rejection_reason), 0) <= 500),
  constraint billing_documents_cancel_reason_length
    check (coalesce(char_length(cancel_reason), 0) <= 500),

  constraint billing_documents_amounts_range check (
    subtotal_cents between 0 and 10000000000
    and tax_cents between 0 and 10000000000
    and total_cents between 0 and 10000000000
  ),

  -- factura sustains a buyer's fiscal credit - it always names one, and
  -- always with a RUC (research confirmed this, not assumed from memory).
  -- Every other type may or may not have a named buyer.
  --
  -- `coalesce(..., '')`, not a bare comparison: a CHECK only fails on an
  -- explicit FALSE, and `null = 'ruc'` evaluates to NULL - a factura with no
  -- customer at all would otherwise pass silently.
  constraint billing_documents_factura_needs_ruc_customer check (
    type <> 'factura' or coalesce(customer_doc_type_snapshot::text, '') = 'ruc'
  ),

  -- A correction always corrects something. Only a correction has that.
  constraint billing_documents_notes_need_related_document check (
    (type in ('nota_credito', 'nota_debito')) = (related_document_id is not null)
  ),

  -- These fields are cumulative history, not an exclusive current-state flag:
  -- `accepted_at` set on the way to `accepted` stays set after a later move
  -- to `cancelled` (the trigger never clears an earlier timestamp), and
  -- `pending -> cancelled` never sets `sent_at` at all. So only `rejected`
  -- and `cancelled` - both terminal, never left once reached - can assert
  -- "iff". The rest assert only "this field exists once its status was
  -- reached", not "and never afterward".
  constraint billing_documents_sent_fields check (
    status not in ('sent', 'accepted', 'rejected') or sent_at is not null
  ),
  constraint billing_documents_accepted_fields check (
    status <> 'accepted' or accepted_at is not null
  ),
  constraint billing_documents_rejected_fields check (
    (status = 'rejected') = (rejected_at is not null)
    and (status = 'rejected') = (rejection_reason is not null)
  ),
  constraint billing_documents_cancelled_fields check (
    (status = 'cancelled') = (cancelled_at is not null)
    and (status = 'cancelled') = (cancel_reason is not null)
  )
);

comment on table public.billing_documents is
  'A document declared to SUNAT about an order. Snapshotted at creation; never re-reads the catalogue, the customer or the tenant''s own settings afterward.';
comment on column public.billing_documents.series is
  'Assigned by trigger from billing_provider_configs. Never accepted from a client.';

-- The idempotency guarantee master section 37 asks for: at most one LIVE
-- document of a given type per order at a time. A rejected document has no
-- tributary validity and does not block the corrected retry SUNAT's own
-- process requires (ADR-021 section 3).
create unique index billing_documents_one_live_per_order_type
  on public.billing_documents (tenant_id, order_id, type)
  where status in ('pending', 'sent', 'accepted');

create index billing_documents_tenant_status_idx
  on public.billing_documents (tenant_id, status);
create index billing_documents_tenant_order_idx
  on public.billing_documents (tenant_id, order_id);

create trigger billing_documents_set_updated_at
  before update on public.billing_documents
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- The state machine, as data - same shape as order_transitions (Phase 13)
-- ---------------------------------------------------------------------------

create table public.billing_document_transitions (
  from_status public.billing_document_status not null,
  to_status   public.billing_document_status not null,

  constraint billing_document_transitions_pkey primary key (from_status, to_status)
);

comment on table public.billing_document_transitions is
  'The document lifecycle, as rows. rejected has no outgoing row: it is terminal by absence, like orders.cancelled (ADR-017/ADR-021).';

insert into public.billing_document_transitions (from_status, to_status) values
  ('pending', 'sent'),
  ('pending', 'cancelled'),
  ('sent', 'accepted'),
  ('sent', 'rejected'),
  ('accepted', 'cancelled');

create or replace function public.guard_billing_document_status_change()
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
    select 1 from public.billing_document_transitions as t
    where t.from_status = old.status and t.to_status = new.status
  ) then
    raise exception 'A billing document cannot go from % to %.', old.status, new.status
      using errcode = 'P0001';
  end if;

  if new.status = 'sent' then
    new.sent_at := coalesce(new.sent_at, now());
  elsif new.status = 'accepted' then
    new.accepted_at := coalesce(new.accepted_at, now());
  elsif new.status = 'rejected' then
    if new.rejection_reason is null or btrim(new.rejection_reason) = '' then
      raise exception 'Rejecting a billing document requires a reason.'
        using errcode = '23514';
    end if;
    new.rejected_at := coalesce(new.rejected_at, now());
  elsif new.status = 'cancelled' then
    if new.cancel_reason is null or btrim(new.cancel_reason) = '' then
      raise exception 'Cancelling a billing document requires a reason.'
        using errcode = '23514';
    end if;
    new.cancelled_at := coalesce(new.cancelled_at, now());
  end if;

  return new;
end;
$$;

comment on function public.guard_billing_document_status_change() is
  'Refuses any transition not declared in billing_document_transitions.';

create trigger billing_documents_guard_status_change
  before update of status on public.billing_documents
  for each row execute function public.guard_billing_document_status_change();

-- ---------------------------------------------------------------------------
-- Assigning tenant, series and number, and taking the snapshot
-- ---------------------------------------------------------------------------

-- Defaults used only when a tenant has not configured
-- `billing_provider_configs` yet (Phase 17's own config table, next
-- migrations) - so issuing a first document never has to wait on a setup
-- screen nobody has found yet.
create or replace function public.default_billing_series(p_type public.billing_document_type)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_type
    when 'boleta' then 'B001'
    when 'factura' then 'F001'
    when 'nota_credito' then 'BC01'
    when 'nota_debito' then 'BD01'
  end;
$$;

create or replace function public.assign_billing_document(
) returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order_tenant    uuid;
  v_order_status    public.order_status;
  v_customer_tenant uuid;
  v_issuer_ruc      text;
  v_series          text;
begin
  select o.tenant_id, o.status into v_order_tenant, v_order_status
  from public.orders as o
  where o.id = new.order_id;

  if v_order_tenant is null then
    raise exception 'Order not found.' using errcode = 'P0002';
  end if;
  if v_order_status = 'cancelled' then
    raise exception 'A cancelled order cannot be billed.' using errcode = '23514';
  end if;

  new.tenant_id := v_order_tenant;

  if new.customer_id is not null then
    select c.tenant_id into v_customer_tenant
    from public.customers as c
    where c.id = new.customer_id;

    if v_customer_tenant is null or v_customer_tenant <> v_order_tenant then
      raise exception 'That customer belongs to a different business.'
        using errcode = '23514';
    end if;

    select c.name, c.doc_type, c.doc_number
      into new.customer_name_snapshot, new.customer_doc_type_snapshot, new.customer_doc_number_snapshot
    from public.customers as c
    where c.id = new.customer_id;
  end if;

  if new.related_document_id is not null then
    if not exists (
      select 1 from public.billing_documents as d
      where d.id = new.related_document_id and d.tenant_id = v_order_tenant
    ) then
      raise exception 'That related document belongs to a different business.'
        using errcode = '23514';
    end if;
  end if;

  select ts.tax_id into v_issuer_ruc
  from public.tenant_settings as ts
  where ts.tenant_id = v_order_tenant;

  if v_issuer_ruc is null then
    raise exception 'This business has no RUC configured; cannot issue a billing document.'
      using errcode = '23514';
  end if;
  new.issuer_ruc_snapshot := v_issuer_ruc;

  select case new.type
    when 'boleta' then coalesce(pc.series_boleta, public.default_billing_series('boleta'))
    when 'factura' then coalesce(pc.series_factura, public.default_billing_series('factura'))
    when 'nota_credito' then coalesce(pc.series_nota_credito, public.default_billing_series('nota_credito'))
    when 'nota_debito' then coalesce(pc.series_nota_debito, public.default_billing_series('nota_debito'))
  end into v_series
  from (select 1) as _dummy
  left join public.billing_provider_configs as pc
    on pc.tenant_id = v_order_tenant and pc.is_active;

  new.series := v_series;

  select coalesce(max(d.number), 0) + 1 into new.number
  from public.billing_documents as d
  where d.tenant_id = v_order_tenant and d.type = new.type and d.series = v_series;

  return new;
end;
$$;

comment on function public.assign_billing_document() is
  'Derives tenant, snapshots issuer/customer, and assigns series+correlative. Never trusts any of it from a client.';

create trigger billing_documents_assign
  before insert on public.billing_documents
  for each row execute function public.assign_billing_document();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.billing_documents enable row level security;
alter table public.billing_document_transitions enable row level security;

create policy billing_documents_select_member
  on public.billing_documents for select to authenticated
  using (public.has_permission(tenant_id, 'billing.view'));

create policy billing_documents_insert_creator
  on public.billing_documents for insert to authenticated
  with check (public.has_permission(tenant_id, 'billing.create'));

-- One UPDATE policy covers advancing (sent/accepted/rejected) and cancelling
-- - the same reasoning orders_update_operator (Phase 13) gives: PostgreSQL
-- cannot express "which columns changed" in USING, so the split lives in the
-- permission each Server Action checks, not in two separate policies.
create policy billing_documents_update_operator
  on public.billing_documents for update to authenticated
  using (
    public.has_permission(tenant_id, 'billing.create')
    or public.has_permission(tenant_id, 'billing.cancel')
  )
  with check (
    public.has_permission(tenant_id, 'billing.create')
    or public.has_permission(tenant_id, 'billing.cancel')
  );

-- No DELETE policy. A billing document is a tax record; cancelling is how
-- one stops counting without pretending it never existed.

-- The state machine, readable by anyone who can see documents at all, and
-- writable by nobody - the same shape as order_transitions (Phase 13,
-- ADR-017 section 4): product data, not any tenant's.
create policy billing_document_transitions_select_authenticated
  on public.billing_document_transitions for select to authenticated using (true);
