-- Phase 10 - Locations
-- The branches a business operates from.
--
-- SPEC: docs/specs/phase-10-locations.md sections 8, 10.
-- CLOVERCODE_MASTER.md section 33 (Phase 10).
--
-- This table exists now, before any operational module, because of one line in
-- master section 33: "Crear soporte multi-sucursal ANTES de modulos
-- operativos". An order happens at a branch, stock sits at a branch, a till is
-- opened at a branch. If this arrived after `orders`, adding `location_id`
-- later would mean migrating real data and guessing which branch each past
-- order belonged to.
--
-- And the other line that decides the shape:
--
--   "Incluso clientes de una sola sede utilizaran una location."
--
-- So there is no "business without branches" case. A one-shop business gets a
-- location anyway, created for it, and never has to see the word. The
-- alternative - a nullable `location_id` "for the simple ones" - would turn
-- every future query into two queries and every index into a worse one.

create table public.locations (
  id           uuid        not null default gen_random_uuid(),
  tenant_id    uuid        not null,
  name         text        not null,
  address_line text,
  district     text,
  city         text,
  -- "frente al parque Kennedy", which in Peru is frequently the only way
  -- anybody actually finds the place.
  reference    text,
  phone        text,
  latitude     numeric(9, 6),
  longitude    numeric(9, 6),
  is_active    boolean     not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint locations_pkey primary key (id),
  constraint locations_tenant_id_fkey
    foreign key (tenant_id) references public.tenants (id) on delete cascade,

  constraint locations_name_length check (char_length(btrim(name)) between 1 and 120),

  constraint locations_text_lengths check (
    coalesce(char_length(address_line), 0) <= 300
    and coalesce(char_length(district), 0) <= 100
    and coalesce(char_length(city), 0) <= 100
    and coalesce(char_length(reference), 0) <= 200
    and coalesce(char_length(phone), 0) <= 30
  ),

  -- Half a coordinate is not a location, it is a bug that will render a pin in
  -- the Atlantic. Both or neither.
  constraint locations_coordinates_together check (
    (latitude is null) = (longitude is null)
  ),

  constraint locations_latitude_range check (
    latitude is null or latitude between -90 and 90
  ),
  constraint locations_longitude_range check (
    longitude is null or longitude between -180 and 180
  )
);

comment on table public.locations is
  'Branches a business operates from. Every tenant has at least one, always.';
comment on column public.locations.reference is
  'How people actually find the place, when the street address is not enough.';

-- Unique per tenant and case-insensitive.
--
-- Two branches called "Miraflores" and "MIRAFLORES" would be two rows that
-- nobody can tell apart in a dropdown - and from Phase 13 that dropdown decides
-- where an order was placed. Master section 11: tenant-scoped, never global;
-- two different businesses may both have a "Centro".
create unique index locations_tenant_name_key
  on public.locations (tenant_id, lower(btrim(name)));

-- The dashboard list and the public block both ask "the active branches of this
-- tenant", which is exactly this index (master section 8).
create index locations_tenant_active_idx
  on public.locations (tenant_id, is_active);

create trigger locations_set_updated_at
  before update on public.locations
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- A business never runs out of branches
-- ---------------------------------------------------------------------------

-- Deactivating the last active location is refused.
--
-- Not a nicety. From Phase 13 an order needs a branch to happen at, so a tenant
-- with zero active locations is a tenant that cannot take an order - and the
-- error would surface three modules away from the setting that caused it, as
-- "cannot create order" rather than "you closed your only branch".
--
-- Deliberately a trigger rather than application logic: the dashboard is not
-- the only writer (a platform operator has policies too), and an invariant that
-- depends on everyone remembering is not an invariant.
create or replace function public.guard_last_active_location()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Only the transition that removes the last one is interesting.
  if new.is_active or not old.is_active then
    return new;
  end if;

  if not exists (
    select 1
    from public.locations as l
    where l.tenant_id = new.tenant_id
      and l.is_active
      and l.id <> new.id
  ) then
    raise exception 'A business must keep at least one active location.'
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

comment on function public.guard_last_active_location() is
  'Refuses to deactivate a tenant''s last active location.';

create trigger locations_guard_last_active
  before update of is_active on public.locations
  for each row execute function public.guard_last_active_location();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.locations enable row level security;

-- Read, by a member of the business. Includes inactive branches: the person
-- editing them has to be able to see them.
create policy locations_select_member
  on public.locations for select to authenticated
  using (public.has_permission(tenant_id, 'locations.view'));

-- Read, by the public. Active branches of active businesses only.
--
-- `anon` AND `authenticated` from the start, which is the lesson of the Phase
-- 07 audit (A7-1): a visitor who happens to be signed in to CloverCode is
-- `authenticated`, not `anon`, and a policy naming only `anon` makes the
-- public site render differently - or not at all - for anyone with a session.
create policy locations_select_public
  on public.locations for select to anon, authenticated
  using (is_active and public.is_tenant_public(tenant_id));

-- Write. `with check` on INSERT is what stops a caller supplying another
-- tenant's id: the permission is evaluated against the tenant of the ROW being
-- written, not against anything the client asserted separately.
create policy locations_insert_manager
  on public.locations for insert to authenticated
  with check (public.has_permission(tenant_id, 'locations.manage'));

create policy locations_update_manager
  on public.locations for update to authenticated
  using (public.has_permission(tenant_id, 'locations.manage'))
  with check (public.has_permission(tenant_id, 'locations.manage'));

-- No DELETE policy, on purpose.
--
-- From Phase 13 onwards orders, tills, stock movements and invoices will
-- reference a location. Deleting one would either cascade that history away or
-- leave it dangling, and neither is acceptable for records a business is
-- legally required to keep. `is_active = false` says "we do not operate here
-- any more" without pretending it never happened.
