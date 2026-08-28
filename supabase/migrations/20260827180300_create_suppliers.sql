-- Phase 18 - Inventory
-- Who a business buys its stock from.
--
-- SPEC: docs/specs/phase-18-inventory.md sections 8, 11.
-- CLOVERCODE_MASTER.md section 33 (Phase 18).

create table public.suppliers (
  id           uuid        not null default gen_random_uuid(),
  tenant_id    uuid        not null,
  name         text        not null,
  -- A supplier's own RUC, when it is a formal business - same format rule
  -- as tenant_settings.tax_id (Phase 06): 11 digits, no checksum, because
  -- an informal supplier (a produce market stall) legitimately has none.
  tax_id       text,
  contact_name text,
  phone        text,
  email        text,
  address      text,
  notes        text,
  is_active    boolean     not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint suppliers_pkey primary key (id),
  constraint suppliers_tenant_id_fkey
    foreign key (tenant_id) references public.tenants (id) on delete cascade,

  constraint suppliers_name_length check (char_length(btrim(name)) between 1 and 200),
  constraint suppliers_tax_id_format check (tax_id is null or tax_id ~ '^[0-9]{11}$'),
  constraint suppliers_contact_name_length
    check (coalesce(char_length(contact_name), 0) <= 200),
  constraint suppliers_email_format check (
    email is null
    or (char_length(email) <= 200 and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')
  ),
  constraint suppliers_phone_format check (phone is null or phone ~ '^\+?[0-9]{6,20}$'),
  constraint suppliers_address_length check (coalesce(char_length(address), 0) <= 300),
  constraint suppliers_notes_length check (coalesce(char_length(notes), 0) <= 1000)
);

comment on table public.suppliers is
  'Who a business buys stock from. Tenant-scoped; a produce vendor with no RUC is as valid a row as a formal distributor.';

create unique index suppliers_tenant_name_key
  on public.suppliers (tenant_id, lower(btrim(name)));

create index suppliers_tenant_active_idx
  on public.suppliers (tenant_id, is_active);

create trigger suppliers_set_updated_at
  before update on public.suppliers
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.suppliers enable row level security;

create policy suppliers_select_member
  on public.suppliers for select to authenticated
  using (public.has_permission(tenant_id, 'suppliers.view'));

create policy suppliers_insert_manager
  on public.suppliers for insert to authenticated
  with check (public.has_permission(tenant_id, 'suppliers.manage'));

create policy suppliers_update_manager
  on public.suppliers for update to authenticated
  using (public.has_permission(tenant_id, 'suppliers.manage'))
  with check (public.has_permission(tenant_id, 'suppliers.manage'));

-- No DELETE policy. `purchases` will reference a supplier (next migration);
-- `is_active = false` is how a business stops buying from one without
-- breaking its purchase history.
