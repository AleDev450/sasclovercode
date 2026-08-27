-- Phase 12 - Customers
-- Where a customer is.
--
-- SPEC: docs/specs/phase-12-customers.md sections 8, 10, 11.
--
-- Master section 33 lists "direcciones" in the plural, and that is the whole
-- reason this is a table instead of columns on `customers`: a person has a home
-- and an office, and a delivery goes to one of them.

create table public.customer_addresses (
  id           uuid        not null default gen_random_uuid(),
  customer_id  uuid        not null,
  -- Denormalised and maintained by a trigger, like `location_hours` (Phase 10)
  -- and the children of `products` (Phase 11): without it every policy here
  -- would have to join `customers` to learn whose row this is, and a policy
  -- that needs a join is both slower and harder to audit.
  tenant_id    uuid        not null,

  -- "Casa", "Oficina". What the person on the phone says when asked where to
  -- send it.
  label        text        not null,
  address_line text        not null,
  district     text,
  city         text,
  -- "frente al parque Kennedy" - in Peru this is frequently the only way the
  -- rider actually finds the door. Same column, same reason, as `locations`.
  reference    text,

  is_default   boolean     not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint customer_addresses_pkey primary key (id),

  -- CASCADE is right here and only here: an address is meaningless without its
  -- customer. In practice it never fires, because a customer is deactivated
  -- rather than deleted - there is no DELETE policy on `customers`.
  constraint customer_addresses_customer_id_fkey
    foreign key (customer_id) references public.customers (id) on delete cascade,
  constraint customer_addresses_tenant_id_fkey
    foreign key (tenant_id) references public.tenants (id) on delete cascade,

  constraint customer_addresses_label_length
    check (char_length(btrim(label)) between 1 and 60),
  constraint customer_addresses_line_length
    check (char_length(btrim(address_line)) between 1 and 300),
  constraint customer_addresses_text_lengths check (
    coalesce(char_length(district), 0) <= 100
    and coalesce(char_length(city), 0) <= 100
    and coalesce(char_length(reference), 0) <= 200
  )
);

comment on table public.customer_addresses is
  'Delivery addresses of a customer. tenant_id is derived by trigger.';

-- At most one default per customer, said declaratively.
--
-- Without it "the usual address" would be whichever row sorted first, and the
-- answer could change between two page loads - the same reasoning as the
-- primary image of a product in Phase 11.
create unique index customer_addresses_one_default_per_customer
  on public.customer_addresses (customer_id)
  where is_default;

create index customer_addresses_customer_idx
  on public.customer_addresses (customer_id);

create trigger customer_addresses_set_updated_at
  before update on public.customer_addresses
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- tenant_id comes from the parent, never from the client
-- ---------------------------------------------------------------------------

-- Both a convenience and a security control.
--
-- The convenience: the two columns can never disagree, so a policy can trust
-- `tenant_id` without joining.
--
-- The control: `tenant_id` is exactly the value an attacker would supply. A
-- caller who may write addresses for their own business could otherwise insert
-- a row carrying another tenant's id and hide it inside that business's data.
-- Deriving it server-side means the field is not an input at all.
create or replace function public.sync_customer_address_tenant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select c.tenant_id into new.tenant_id
  from public.customers as c
  where c.id = new.customer_id;

  if new.tenant_id is null then
    raise exception 'Customer not found.' using errcode = 'P0002';
  end if;

  return new;
end;
$$;

comment on function public.sync_customer_address_tenant() is
  'Derives tenant_id from the parent customer so the two can never disagree.';

create trigger customer_addresses_sync_tenant
  before insert or update of customer_id on public.customer_addresses
  for each row execute function public.sync_customer_address_tenant();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.customer_addresses enable row level security;

-- Governed by the customer permissions, not by permissions of its own: an
-- address is part of a customer record, and someone who may read the customer
-- may read where to deliver to them.
create policy customer_addresses_select_member
  on public.customer_addresses for select to authenticated
  using (public.has_permission(tenant_id, 'customers.view'));

-- No public policy here either, for the reason spelled out in
-- `20260827120100_create_customers.sql`. A home address is the most sensitive
-- column in this phase.

create policy customer_addresses_insert_manager
  on public.customer_addresses for insert to authenticated
  with check (public.has_permission(tenant_id, 'customers.manage'));

create policy customer_addresses_update_manager
  on public.customer_addresses for update to authenticated
  using (public.has_permission(tenant_id, 'customers.manage'))
  with check (public.has_permission(tenant_id, 'customers.manage'));

-- An address CAN be deleted, unlike a customer.
--
-- It is not history: it is current contact information, and someone who moved
-- house does not want their old address left in the list. The Phase 13 order
-- will copy the delivery address onto itself rather than referencing this row,
-- precisely so that deleting it never changes where something was delivered
-- last month.
create policy customer_addresses_delete_manager
  on public.customer_addresses for delete to authenticated
  using (public.has_permission(tenant_id, 'customers.manage'));
