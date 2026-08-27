-- Phase 12 - Customers
-- Who a business sells to.
--
-- SPEC: docs/specs/phase-12-customers.md sections 8, 10, 11.
-- CLOVERCODE_MASTER.md sections 11, 33 (Phase 12).
--
-- Master section 33 governs this phase with a restriction rather than a
-- capability:
--
--   "No almacenar mas informacion personal de la necesaria."
--
-- So every column here had to justify itself against an operation that needs
-- it. What was considered and left out - free-text notes, date of birth,
-- gender - is recorded in section 11 of the SPEC, along with why.
--
-- A customer is NOT an `auth.users` row. They are data belonging to the
-- business, not an account on CloverCode; tying the two would mean creating a
-- login for every person who buys a set menu.

create table public.customers (
  id         uuid                     not null default gen_random_uuid(),
  tenant_id  uuid                     not null,

  -- One field, not first/last name. For a RUC this is a company name, for a DNI
  -- a person; splitting it would force the form to guess which it is looking at
  -- and would store an empty "last name" for half the rows.
  name       text                     not null,

  -- Optional, and both halves travel together.
  --
  -- A business can serve someone without asking for their DNI, and that is the
  -- normal case for cash at a counter. The document appears when the customer
  -- asks for an invoice.
  doc_type   public.customer_doc_type,
  doc_number text,

  email      text,
  phone      text,

  is_active  boolean                  not null default true,
  created_at timestamptz              not null default now(),
  updated_at timestamptz              not null default now(),

  constraint customers_pkey primary key (id),
  constraint customers_tenant_id_fkey
    foreign key (tenant_id) references public.tenants (id) on delete cascade,

  constraint customers_name_length check (char_length(btrim(name)) between 1 and 200),

  -- A type without a number is a form half-filled; a number without a type is a
  -- string nobody can validate. Neither is storable.
  constraint customers_document_complete check (
    (doc_type is null) = (doc_number is null)
  ),

  -- The format depends on the type, so one CHECK covers all three.
  --
  -- DNI  8 digits.
  -- CE   8 to 12 alphanumeric, uppercase. Migraciones does not publish a check
  --      digit for it, so shape is all that can be verified.
  -- RUC  delegated to is_valid_ruc, check digit included.
  constraint customers_document_format check (
    doc_number is null
    or (doc_type = 'dni' and doc_number ~ '^[0-9]{8}$')
    or (doc_type = 'ce'  and doc_number ~ '^[A-Z0-9]{8,12}$')
    or (doc_type = 'ruc' and public.is_valid_ruc(doc_number))
  ),

  -- Deliberately loose. Anything stricter rejects addresses that exist: the
  -- purpose here is to catch a typo, not to re-derive RFC 5322.
  constraint customers_email_format check (
    email is null
    or (char_length(email) <= 200 and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')
  ),

  -- Digits with an optional country prefix. Normalised by the application
  -- before it gets here, so "987 654 321" is already "987654321".
  constraint customers_phone_format check (
    phone is null or phone ~ '^\+?[0-9]{6,20}$'
  )
);

comment on table public.customers is
  'Who a business sells to. Minimal personal data: master section 33 (Phase 12).';
comment on column public.customers.doc_number is
  'Normalised: uppercase, no separators. RUC check digit enforced by CHECK.';
comment on column public.customers.is_active is
  'Customers are deactivated, never deleted: Phase 13 orders point here.';

-- ---------------------------------------------------------------------------
-- Uniqueness, PER TENANT
-- ---------------------------------------------------------------------------

-- The rule master section 11 states and Phase 11 had to repeat for slugs, in
-- the place where getting it wrong would be worst.
--
-- A global UNIQUE(doc_number) would mean the same person could be a customer of
-- exactly one business on the whole platform - and, worse, that one business
-- could discover by collision that another one already has them. That is a
-- shared national customer registry between competitors, built by accident out
-- of a missing column in an index.
--
-- PARTIAL, so the many customers with no document at all do not collide with
-- each other: in PostgreSQL NULLs do not conflict in a unique index anyway, but
-- the partial index also keeps those rows out of it entirely.
create unique index customers_tenant_document_key
  on public.customers (tenant_id, doc_type, doc_number)
  where doc_number is not null;

-- Case-insensitive, same tenant scope. Two rows for "ana@x.pe" and "Ana@X.pe"
-- are one person twice, and from Phase 13 that is two split order histories.
create unique index customers_tenant_email_key
  on public.customers (tenant_id, lower(email))
  where email is not null;

-- ---------------------------------------------------------------------------
-- Indexes for the two ways a customer is actually found
-- ---------------------------------------------------------------------------

-- The default listing: active customers of one business.
create index customers_tenant_active_idx
  on public.customers (tenant_id, is_active);

-- The POS lookup. At a till nobody types a name - they ask for the phone
-- number, which is why this one is separate from the name index.
create index customers_tenant_phone_idx
  on public.customers (tenant_id, phone)
  where phone is not null;

-- Alphabetical ordering and the name search, case-insensitively.
create index customers_tenant_name_idx
  on public.customers (tenant_id, lower(name));

create trigger customers_set_updated_at
  before update on public.customers
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.customers enable row level security;

-- Read, by a member holding `customers.view`. Inactive customers included: the
-- person looking at the list has to be able to find someone they deactivated.
create policy customers_select_member
  on public.customers for select to authenticated
  using (public.has_permission(tenant_id, 'customers.view'));

-- THERE IS NO PUBLIC POLICY, AND THAT IS THE POINT OF THIS FILE.
--
-- Phases 10 and 11 both end with a `..._select_public` granting `anon` a view
-- of active rows, and both are right to: a branch address and a menu exist to
-- be seen. Copying that shape here out of habit would publish every business's
-- customer list to the internet.
--
-- It is a defect that would not fail loudly. The public site would render
-- exactly the same, and nobody would notice until someone queried the table
-- directly. So the absence is asserted by a test that reads `pg_policies` and
-- fails if any policy on this table names `anon` (TEST-1210) - an absence has
-- to be pinned down, or it comes back.

create policy customers_insert_manager
  on public.customers for insert to authenticated
  with check (public.has_permission(tenant_id, 'customers.manage'));

create policy customers_update_manager
  on public.customers for update to authenticated
  using (public.has_permission(tenant_id, 'customers.manage'))
  with check (public.has_permission(tenant_id, 'customers.manage'));

-- No DELETE policy, for the reason locations and products have none: from Phase
-- 13 an order points at a customer, and a business is required to keep its
-- sales records. `is_active = false` says "we no longer deal with this person"
-- without pretending they were never a customer.
