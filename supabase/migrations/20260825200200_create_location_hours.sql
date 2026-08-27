-- Phase 10 - Locations
-- When each branch is open.
--
-- SPEC: docs/specs/phase-10-locations.md section 8.
-- CLOVERCODE_MASTER.md sections 7, 30, 40.
--
-- A TABLE, not a JSONB column on `locations`.
--
-- Master section 7 reserves JSONB for genuinely dynamic configuration and sends
-- repeating groups to relational storage. Opening hours are the textbook case:
-- seven days, and in Peru almost always two shifts a day. In JSONB, "shifts
-- must not overlap" and "closing is after opening" would be application
-- validation - which is to say, validation that holds only while everybody
-- goes through the same code path. Here they are a CHECK and a trigger.
--
-- `time` and not `timestamptz`, which looks like it contradicts master section
-- 40 and does not. Section 40 governs INSTANTS: when an order was placed, when
-- a payment cleared. "We open at nine" is not an instant - it stays true when
-- the clock changes, and storing it as a moment in UTC would make it drift
-- against the business's own day.

create table public.location_hours (
  id          uuid        not null default gen_random_uuid(),
  location_id uuid        not null,
  -- Denormalised from the location, kept by the trigger below.
  --
  -- Same reasoning as `page_sections` in Phase 07: without it every policy on
  -- this table would have to join `locations` to learn whose row it is, and a
  -- policy that needs a join is harder to audit and slower to run.
  tenant_id   uuid        not null,
  day_of_week smallint    not null,
  opens_at    time        not null,
  closes_at   time        not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint location_hours_pkey primary key (id),
  constraint location_hours_location_id_fkey
    foreign key (location_id) references public.locations (id) on delete cascade,
  constraint location_hours_tenant_id_fkey
    foreign key (tenant_id) references public.tenants (id) on delete cascade,

  -- 0 = Sunday, matching both JavaScript's `getDay()` and PostgreSQL's `dow`.
  -- Picking either convention is fine; picking neither and inventing a third is
  -- how off-by-one bugs get written into a schema.
  constraint location_hours_day_range check (day_of_week between 0 and 6),

  -- Strictly after, which is what makes overlap detection decidable.
  --
  -- A bar open 18:00-02:00 is stored as 18:00-24:00 on Friday plus 00:00-02:00
  -- on Saturday. Allowing `closes_at < opens_at` to mean "crosses midnight"
  -- would make every future "is it open now" query a special case, and would
  -- make the overlap trigger below either wrong or twice as long. `time`
  -- accepts '24:00:00', so "until midnight" needs no fudge.
  constraint location_hours_order check (closes_at > opens_at)
);

comment on table public.location_hours is
  'Opening shifts per branch and weekday. Local business time, never UTC. '
  'An overnight shift is two rows.';
comment on column public.location_hours.day_of_week is
  '0 = Sunday, matching JavaScript getDay() and PostgreSQL dow.';

-- Reading one branch's week, which is what both the editor and the public
-- block do.
create index location_hours_location_day_idx
  on public.location_hours (location_id, day_of_week);

-- The public block reads every hour of a whole tenant in one query, and the
-- policy filters on this column.
create index location_hours_tenant_idx on public.location_hours (tenant_id);

create trigger location_hours_set_updated_at
  before update on public.location_hours
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- tenant_id is derived, never trusted
-- ---------------------------------------------------------------------------

-- Overwrites whatever the caller sent with the location's real tenant.
--
-- The attack this closes (SPEC AB-1002) is subtle: a caller supplies a
-- `location_id` belonging to another business together with their OWN
-- tenant_id. The insert policy checks the permission against the tenant_id in
-- the row - which they do hold - and the row lands attached to somebody else's
-- branch. Deriving the value makes the two impossible to disagree, so the
-- policy is then checking the tenant that actually owns the parent.
create or replace function public.sync_location_hours_tenant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select l.tenant_id into new.tenant_id
  from public.locations as l
  where l.id = new.location_id;

  if new.tenant_id is null then
    raise exception 'Location not found.' using errcode = 'P0002';
  end if;

  return new;
end;
$$;

comment on function public.sync_location_hours_tenant() is
  'Derives tenant_id from the parent location so the two can never disagree.';

create trigger location_hours_sync_tenant
  before insert or update of location_id on public.location_hours
  for each row execute function public.sync_location_hours_tenant();

-- ---------------------------------------------------------------------------
-- Shifts do not overlap
-- ---------------------------------------------------------------------------

-- The declarative way to say this is an exclusion constraint:
--
--   exclude using gist (location_id with =, day_of_week with =,
--                       timerange(opens_at, closes_at) with &&)
--
-- which needs `btree_gist` for the equality parts. That extension is not
-- enabled on this project and does not exist in the test harness, so the rule
-- would be untestable where every other constraint in this schema is executed.
-- A trigger is less elegant and is actually verified.
--
-- The comparison is strict on both ends, so 10:00-12:00 and 12:00-14:00 are
-- accepted: touching is not overlapping, and a split shift that resumes exactly
-- when the previous one ended is a normal thing for a business to write.
create or replace function public.guard_location_hours_overlap()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.location_hours as h
    where h.location_id = new.location_id
      and h.day_of_week = new.day_of_week
      -- An UPDATE must not collide with the row being updated.
      and h.id <> new.id
      and h.opens_at < new.closes_at
      and new.opens_at < h.closes_at
  ) then
    raise exception 'That shift overlaps another one on the same day.'
      using errcode = '23P01';
  end if;

  return new;
end;
$$;

comment on function public.guard_location_hours_overlap() is
  'Refuses two shifts that overlap on one day. Touching ends are allowed.';

create trigger location_hours_guard_overlap
  before insert or update on public.location_hours
  for each row execute function public.guard_location_hours_overlap();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.location_hours enable row level security;

create policy location_hours_select_member
  on public.location_hours for select to authenticated
  using (public.has_permission(tenant_id, 'locations.view'));

-- Public, under the same rule as the branch itself: an inactive branch's hours
-- are not published, and neither are those of a suspended business.
create policy location_hours_select_public
  on public.location_hours for select to anon, authenticated
  using (
    public.is_tenant_public(tenant_id)
    and exists (
      select 1
      from public.locations as l
      where l.id = location_id
        and l.is_active
    )
  );

create policy location_hours_write_manager
  on public.location_hours for all to authenticated
  using (public.has_permission(tenant_id, 'locations.manage'))
  with check (public.has_permission(tenant_id, 'locations.manage'));
