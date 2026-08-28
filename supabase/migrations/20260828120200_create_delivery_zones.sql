-- Phase 19 - Delivery
-- Where a business delivers to.
--
-- SPEC: docs/specs/phase-19-delivery.md sections 8, 10, 11.
-- CLOVERCODE_MASTER.md section 33 (Phase 19).
-- ADR-023 decision 2.
--
-- A zone is an area with a NAME, not a polygon. There is no geometry here and
-- nothing checks that the address written on a delivery actually falls inside
-- the zone somebody picked for it.
--
-- That is deliberate, and ADR-023 decision 2 carries the full argument. The
-- short version: a real polygon needs PostGIS, a map editor and a geocoder,
-- which is exactly the unrequested infrastructure master section 47 warns
-- against - and it is not how a Peruvian delivery business actually operates.
-- The menu says "repartimos a Miraflores, Barranco y Surco" with a price per
-- district. Modelling the zone as the district models the real domain.

create table public.delivery_zones (
  id         uuid        not null default gen_random_uuid(),
  tenant_id  uuid        not null,

  -- "Miraflores", "Barranco - Sur". What the shop says on the phone.
  name       text        not null,
  -- The administrative district, when the zone maps onto one. Separate from
  -- `name` because a zone can span two districts or split one in half, and the
  -- name is what a person recognises while the district is what an address
  -- carries.
  district   text,
  notes      text,

  -- Deactivated rather than deleted, when a business stops covering an area:
  -- deliveries already made keep pointing at it. Deleting IS allowed as well
  -- (see the policies below) because a zone created by mistake is a correction,
  -- and `order_deliveries.zone_name_snapshot` means past deliveries survive it.
  is_active  boolean     not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint delivery_zones_pkey primary key (id),
  constraint delivery_zones_tenant_id_fkey
    foreign key (tenant_id) references public.tenants (id) on delete cascade,

  constraint delivery_zones_name_length
    check (char_length(btrim(name)) between 1 and 80),
  constraint delivery_zones_text_lengths check (
    coalesce(char_length(district), 0) <= 100
    and coalesce(char_length(notes), 0) <= 300
  )
);

comment on table public.delivery_zones is
  'Named areas a business delivers to. An area, not a polygon (ADR-023).';
comment on column public.delivery_zones.district is
  'The administrative district, when the zone maps onto one. A zone may span two.';

-- Unique per tenant and case-insensitive, the same shape Phase 10 gave
-- `locations`: two zones called "Miraflores" and "MIRAFLORES" would be two rows
-- that every person reading the list would call the same zone.
create unique index delivery_zones_tenant_name_key
  on public.delivery_zones (tenant_id, lower(btrim(name)));

-- "Which zones can I offer right now" - the query the attach form runs.
create index delivery_zones_tenant_active_idx
  on public.delivery_zones (tenant_id, is_active);

create trigger delivery_zones_set_updated_at
  before update on public.delivery_zones
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.delivery_zones enable row level security;

create policy delivery_zones_select_member
  on public.delivery_zones for select to authenticated
  using (public.has_permission(tenant_id, 'delivery_zones.view'));

-- No `anon` policy. The public site does not exist for delivery yet, and when
-- it does, what a visitor may see is a decision for that phase to make
-- deliberately rather than something inherited by accident.

create policy delivery_zones_insert_manager
  on public.delivery_zones for insert to authenticated
  with check (public.has_permission(tenant_id, 'delivery_zones.manage'));

create policy delivery_zones_update_manager
  on public.delivery_zones for update to authenticated
  using (public.has_permission(tenant_id, 'delivery_zones.manage'))
  with check (public.has_permission(tenant_id, 'delivery_zones.manage'));

-- A zone CAN be deleted, unlike an order or a delivery.
--
-- It is configuration, not history: a zone created by mistake should be
-- removable, and nothing is lost when it goes - `order_deliveries` keeps
-- `zone_name_snapshot`, so past deliveries still say where they went. The same
-- distinction Phase 12 drew between `customer_addresses` (deletable) and
-- `customers` (not).
create policy delivery_zones_delete_manager
  on public.delivery_zones for delete to authenticated
  using (public.has_permission(tenant_id, 'delivery_zones.manage'));
