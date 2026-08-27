-- Phase 14 - Payments + Cash
-- A till. What a cash session opens and closes against.
--
-- SPEC: docs/specs/phase-14-payments-cash.md sections 8, 11.
-- CLOVERCODE_MASTER.md section 14 (Phase 14).
--
-- Belongs to a LOCATION, not to the tenant directly: cash lives in a physical
-- drawer at a physical branch, and Phase 10 is what makes "which branch"
-- always answerable, including for a one-branch business.
--
-- Not auto-provisioned, for the same reason payment_methods is not: how many
-- tills a business runs at a branch is an operational choice for that
-- business, not a structural necessity like the branch itself.

create table public.cash_registers (
  id          uuid        not null default gen_random_uuid(),
  tenant_id   uuid        not null,
  location_id uuid        not null,
  name        text        not null,
  is_active   boolean     not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint cash_registers_pkey primary key (id),
  constraint cash_registers_tenant_id_fkey
    foreign key (tenant_id) references public.tenants (id) on delete cascade,
  -- RESTRICT, matching orders_location_id_fkey (Phase 13): a branch's cash
  -- history must not disappear because the branch record did. In practice
  -- locations are deactivated rather than deleted, so this never fires.
  constraint cash_registers_location_id_fkey
    foreign key (location_id) references public.locations (id) on delete restrict,

  constraint cash_registers_name_length check (char_length(btrim(name)) between 1 and 80)
);

comment on table public.cash_registers is
  'A till at a location. Deactivated, never deleted - sessions RESTRICT against it.';

create unique index cash_registers_tenant_location_name_key
  on public.cash_registers (tenant_id, location_id, lower(btrim(name)));

create index cash_registers_tenant_location_idx
  on public.cash_registers (tenant_id, location_id);

create trigger cash_registers_set_updated_at
  before update on public.cash_registers
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- The register and the tenant agree on which location
-- ---------------------------------------------------------------------------

-- Same hole Phase 13 closed between an order and its location/customer: two
-- foreign keys, each pointing at a table that carries its own tenant_id,
-- is a place where they can silently disagree. Nothing else in the schema
-- stops a register of tenant A pointing at a branch of tenant B.
create or replace function public.guard_cash_register_location()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_location_tenant uuid;
begin
  select l.tenant_id into v_location_tenant
  from public.locations as l
  where l.id = new.location_id;

  if v_location_tenant is null or v_location_tenant <> new.tenant_id then
    raise exception 'That location belongs to a different business.'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

comment on function public.guard_cash_register_location() is
  'Refuses a cash register whose location belongs to another tenant.';

create trigger cash_registers_guard_location
  before insert or update of location_id, tenant_id on public.cash_registers
  for each row execute function public.guard_cash_register_location();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.cash_registers enable row level security;

create policy cash_registers_select_viewer
  on public.cash_registers for select to authenticated
  using (public.has_permission(tenant_id, 'cash.view'));

create policy cash_registers_insert_manager
  on public.cash_registers for insert to authenticated
  with check (public.has_permission(tenant_id, 'cash.manage'));

create policy cash_registers_update_manager
  on public.cash_registers for update to authenticated
  using (public.has_permission(tenant_id, 'cash.manage'))
  with check (public.has_permission(tenant_id, 'cash.manage'));

-- No DELETE policy. Deactivate; a register with session history must keep it.
