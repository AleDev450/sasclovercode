-- Phase 14 - Payments + Cash
-- The rails a business accepts money through.
--
-- SPEC: docs/specs/phase-14-payments-cash.md sections 8, 11.
-- CLOVERCODE_MASTER.md section 14 (Phase 14).
--
-- Master section 14: "Preparar: efectivo, Yape, Plin, tarjeta, transferencia,
-- gateways futuros." `type` is the closed set those six give us; `name` is
-- what the business calls it - "Yape - Alejandro" - because a business with
-- two Yape accounts needs two rows of the same type.
--
-- Not auto-provisioned for every tenant. Checked before writing this: Phase 10
-- seeds a default LOCATION for every tenant (a structural necessity - an order
-- has to happen somewhere) but Phase 11 does not seed a default category or
-- product. Which payment rails a business actually accepts is that same kind
-- of business-specific choice, so it gets no default row either; the owner
-- configures it, same as their catalogue.

create type public.payment_method_type as enum ('cash', 'yape', 'plin', 'card', 'transfer', 'other');

create table public.payment_methods (
  id          uuid                           not null default gen_random_uuid(),
  tenant_id   uuid                           not null,
  type        public.payment_method_type     not null,
  name        text                           not null,
  -- Free text: a phone number for Yape/Plin, a bank + account for a transfer,
  -- a terminal id for a card reader. Nothing here is validated against an
  -- external format because nothing here is more than a label a human reads.
  reference   text,
  is_active   boolean                        not null default true,
  position    smallint                       not null default 0,
  created_at  timestamptz                    not null default now(),
  updated_at  timestamptz                    not null default now(),

  constraint payment_methods_pkey primary key (id),
  constraint payment_methods_tenant_id_fkey
    foreign key (tenant_id) references public.tenants (id) on delete cascade,

  constraint payment_methods_name_length check (char_length(btrim(name)) between 1 and 80),
  constraint payment_methods_reference_length check (coalesce(char_length(reference), 0) <= 120),
  constraint payment_methods_position_range check (position between 0 and 1000)
);

comment on table public.payment_methods is
  'Payment rails a tenant accepts. Deactivated, never deleted - payments RESTRICT against it.';

create unique index payment_methods_tenant_name_key
  on public.payment_methods (tenant_id, lower(btrim(name)));

create index payment_methods_tenant_active_idx
  on public.payment_methods (tenant_id)
  where is_active;

create trigger payment_methods_set_updated_at
  before update on public.payment_methods
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.payment_methods enable row level security;

create policy payment_methods_select_viewer
  on public.payment_methods for select to authenticated
  using (public.has_permission(tenant_id, 'payment_methods.view'));

-- No public policy. This is the business's own configuration, not a public fact.

create policy payment_methods_insert_manager
  on public.payment_methods for insert to authenticated
  with check (public.has_permission(tenant_id, 'payment_methods.manage'));

create policy payment_methods_update_manager
  on public.payment_methods for update to authenticated
  using (public.has_permission(tenant_id, 'payment_methods.manage'))
  with check (public.has_permission(tenant_id, 'payment_methods.manage'));

-- No DELETE policy. `payments.payment_method_id` is ON DELETE RESTRICT and
-- would refuse it anyway once a method has history; `is_active = false` is
-- how a business retires a rail without breaking what it already recorded.
