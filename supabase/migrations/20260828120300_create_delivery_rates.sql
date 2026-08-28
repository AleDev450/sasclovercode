-- Phase 19 - Delivery
-- What it costs to reach a zone.
--
-- SPEC: docs/specs/phase-19-delivery.md sections 8, 10, 11.
-- CLOVERCODE_MASTER.md sections 33 (Phase 19), 39.
-- ADR-023 decision 1.
--
-- Why this is a table and not a `fee_cents` column on `delivery_zones`: a zone
-- with a single price would not need one, and master names two tables. What it
-- does not say is along which axis a zone has several rates, and the answer
-- chosen here is THE BRANCH.
--
-- Reaching Miraflores from the Miraflores shop does not cost what it costs from
-- San Isidro. That is a fact about the (zone, location) pair, not about the
-- zone - and `orders.location_id` has been NOT NULL since Phase 13, so the
-- applicable rate resolves without asking anybody anything.
--
-- `location_id` is NULLABLE, which turns this into "a default plus exceptions":
-- a one-branch business writes one row per zone and never sees the word
-- "sede"; a five-branch business overrides only where the cost actually
-- differs. With `location_id NOT NULL` the same ten zones would need fifty
-- rows.
--
-- Every money column is an integer in the minor unit (ADR-015).

create table public.delivery_rates (
  id                   uuid        not null default gen_random_uuid(),
  -- Denormalised and maintained by a trigger, like `customer_addresses` (Phase
  -- 12) and the children of `products` (Phase 11): without it every policy here
  -- would have to join `delivery_zones` to learn whose row this is, and a
  -- policy that needs a join is both slower and harder to audit.
  tenant_id            uuid        not null,

  zone_id              uuid        not null,
  -- NULL means "the default rate for this zone, from any branch".
  location_id          uuid,

  fee_cents            bigint      not null,
  -- Above this order subtotal the delivery is free. NULL means never free.
  --
  -- A column of the RATE rather than a second row, because "free from S/ 50"
  -- is a condition of this price, not a different price. Modelling it as a
  -- second row would need a (min, max) range and a tie-break rule for
  -- overlapping ranges - infrastructure for a case nobody asked for.
  min_order_free_cents bigint,
  -- Declared by the business, not computed. It is what the shop tells the
  -- customer, not an ETA (KL-1905).
  estimated_minutes    smallint,

  is_active            boolean     not null default true,

  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  constraint delivery_rates_pkey primary key (id),

  constraint delivery_rates_tenant_id_fkey
    foreign key (tenant_id) references public.tenants (id) on delete cascade,

  -- CASCADE: a rate is meaningless without its zone.
  constraint delivery_rates_zone_id_fkey
    foreign key (zone_id) references public.delivery_zones (id) on delete cascade,

  -- CASCADE as well, and for the same reason: a per-branch override for a
  -- branch that no longer exists is not a price, it is a leftover. The zone's
  -- default rate is untouched, so the zone keeps working.
  constraint delivery_rates_location_id_fkey
    foreign key (location_id) references public.locations (id) on delete cascade,

  constraint delivery_rates_fee_range
    check (fee_cents between 0 and 10000000000),
  -- Zero is allowed (a zone that is always free); negative is not.
  constraint delivery_rates_min_order_range check (
    min_order_free_cents is null
    or min_order_free_cents between 0 and 10000000000
  ),
  constraint delivery_rates_estimated_minutes_range check (
    estimated_minutes is null or estimated_minutes between 1 and 600
  )
);

comment on table public.delivery_rates is
  'What a zone costs, optionally per branch. NULL location_id is the zone default (ADR-023).';
comment on column public.delivery_rates.location_id is
  'NULL = the default rate for the zone. A row with a branch overrides it for that branch.';
comment on column public.delivery_rates.fee_cents is
  'Minor units (ADR-015). Copied onto order_deliveries at attach time, never referenced live.';
comment on column public.delivery_rates.min_order_free_cents is
  'Order subtotal from which delivery is free. NULL = never free.';

-- One rate per branch, and one single default.
--
-- Two partial indexes rather than `unique nulls not distinct`, because NULLs do
-- not compare equal in a plain unique index: without the second one, a zone
-- could accumulate any number of "default" rates and "which one applies?" would
-- have no answer. Written as two indexes rather than one modern clause because
-- each states its own rule and reads as what it enforces.
create unique index delivery_rates_zone_location_key
  on public.delivery_rates (zone_id, location_id)
  where location_id is not null;

create unique index delivery_rates_zone_default_key
  on public.delivery_rates (zone_id)
  where location_id is null;

-- "Every rate of this business", the configuration screen's query.
create index delivery_rates_tenant_zone_idx
  on public.delivery_rates (tenant_id, zone_id);

create trigger delivery_rates_set_updated_at
  before update on public.delivery_rates
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- tenant_id comes from the parent, never from the client
-- ---------------------------------------------------------------------------

-- Both a convenience and a security control, exactly as
-- `sync_customer_address_tenant()` (Phase 12) explained.
--
-- The convenience: the two columns can never disagree, so a policy can trust
-- `tenant_id` without joining.
--
-- The control: `tenant_id` is precisely the value an attacker would supply. A
-- caller who may write rates for their own business could otherwise insert a
-- row carrying another tenant's id and hide it inside that business's data.
-- Deriving it server-side means the field is not an input at all.
--
-- Deriving the tenant AND checking the branch in ONE function, following
-- `derive_stock_movement_tenant()` (Phase 18) rather than splitting them.
-- The reason is not style: PostgreSQL fires BEFORE triggers on a table in
-- alphabetical order by trigger name, so two triggers here would run
-- `..._guard_location` before `..._sync_tenant` and the guard would compare
-- against a `tenant_id` that had not been derived yet. One function has one
-- order, and it is the order it is written in.
create or replace function public.derive_delivery_rate_tenant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_location_tenant uuid;
begin
  select z.tenant_id into new.tenant_id
  from public.delivery_zones as z
  where z.id = new.zone_id;

  if new.tenant_id is null then
    raise exception 'Delivery zone not found.' using errcode = 'P0002';
  end if;

  -- Two foreign keys to two tables that each carry a tenant is a place where
  -- they can disagree, and RLS would not catch it: the caller has permission on
  -- the row being written. `guard_order_tenant_refs()` (Phase 13) closed the
  -- same hole between an order and its location.
  --
  -- Here the consequence is a price list that quietly references another
  -- company's branch - which would then decide what this business charges.
  if new.location_id is not null then
    select l.tenant_id into v_location_tenant
    from public.locations as l
    where l.id = new.location_id;

    if v_location_tenant is null or v_location_tenant <> new.tenant_id then
      raise exception 'That location belongs to a different business.'
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

comment on function public.derive_delivery_rate_tenant() is
  'Derives tenant_id from the parent zone, and refuses a branch that belongs to another tenant.';

create trigger delivery_rates_derive_tenant
  before insert or update of zone_id, location_id on public.delivery_rates
  for each row execute function public.derive_delivery_rate_tenant();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.delivery_rates enable row level security;

-- Governed by the ZONE's permissions, not by permissions of its own: a rate is
-- part of a zone, and whoever may see the zone may see what it costs. The same
-- reasoning `order_items` applied toward `orders` in Phase 13.
create policy delivery_rates_select_member
  on public.delivery_rates for select to authenticated
  using (public.has_permission(tenant_id, 'delivery_zones.view'));

create policy delivery_rates_insert_manager
  on public.delivery_rates for insert to authenticated
  with check (public.has_permission(tenant_id, 'delivery_zones.manage'));

create policy delivery_rates_update_manager
  on public.delivery_rates for update to authenticated
  using (public.has_permission(tenant_id, 'delivery_zones.manage'))
  with check (public.has_permission(tenant_id, 'delivery_zones.manage'));

create policy delivery_rates_delete_manager
  on public.delivery_rates for delete to authenticated
  using (public.has_permission(tenant_id, 'delivery_zones.manage'));
