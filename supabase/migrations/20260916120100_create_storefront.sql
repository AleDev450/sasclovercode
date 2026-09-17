-- Phase 29 - Tienda online
-- How a business sells from its own website, and what that website may say
-- about it in public.
--
-- SPEC: docs/specs/phase-29-storefront.md sections 6, 8, 10, 11.
--
-- Nothing in this file gives `anon` a policy. Every public read below is a
-- `security definer` function that takes the tenant as an argument, requires
-- `is_tenant_public`, and returns exactly the columns a visitor may see - the
-- posture `get_public_business_identity` (Phase 08) already takes, and the one
-- the Phase 25 isolation sweep enforces by listing every public policy by hand.

-- ---------------------------------------------------------------------------
-- tenant_storefronts
-- ---------------------------------------------------------------------------

create type public.storefront_mode as enum ('auto', 'open', 'closed');

comment on type public.storefront_mode is
  'auto = by the opening hours of the ordering branch; open/closed = forced by hand, wins over the hours.';

-- One row per business, created by provisioning, like tenant_settings.
create table public.tenant_storefronts (
  tenant_id          uuid                   not null,
  ordering_enabled   boolean                not null default true,
  mode               public.storefront_mode not null default 'auto',
  closed_message     text,
  accepts_delivery   boolean                not null default true,
  accepts_pickup     boolean                not null default true,
  min_order_cents    bigint                 not null default 0,
  -- The branch web orders are placed against. NULL = the oldest active one,
  -- which for a single-branch business is simply "the" branch.
  order_location_id  uuid,
  whatsapp_button    boolean                not null default true,
  whatsapp_message   text,
  tagline            text,
  -- The address a visitor may write to. `tenant_settings.contact_email` is the
  -- one CloverCode writes to, and Phase 08 deliberately never publishes it.
  public_email       text,
  bestsellers_days   smallint               not null default 30,
  created_at         timestamptz            not null default now(),
  updated_at         timestamptz            not null default now(),

  constraint tenant_storefronts_pkey primary key (tenant_id),
  constraint tenant_storefronts_tenant_id_fkey
    foreign key (tenant_id) references public.tenants (id) on delete cascade,
  constraint tenant_storefronts_order_location_id_fkey
    foreign key (order_location_id) references public.locations (id) on delete set null,

  -- A shop that neither delivers nor lets anybody pick up takes no orders. That
  -- is what `ordering_enabled = false` is for; this pair must not be a second,
  -- accidental way of saying it.
  constraint tenant_storefronts_fulfillment_any check (accepts_delivery or accepts_pickup),
  constraint tenant_storefronts_min_order_range check (min_order_cents between 0 and 10000000000),
  constraint tenant_storefronts_bestsellers_days_range check (bestsellers_days between 7 and 365),
  constraint tenant_storefronts_public_email_format check (
    public_email is null
    or (char_length(public_email) <= 200 and public_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')
  ),
  constraint tenant_storefronts_text_lengths check (
    coalesce(char_length(closed_message), 0) <= 300
    and coalesce(char_length(whatsapp_message), 0) <= 300
    and coalesce(char_length(tagline), 0) <= 200
  )
);

comment on table public.tenant_storefronts is
  'One row per tenant: whether and how its website takes orders (Phase 29).';
comment on column public.tenant_storefronts.order_location_id is
  'Branch that receives web orders. NULL = the oldest active branch.';

create trigger tenant_storefronts_set_updated_at
  before update on public.tenant_storefronts
  for each row execute function public.set_updated_at();

-- The ordering branch has to be one of this business's own. The FK proves the
-- branch exists; only this proves whose it is.
create or replace function public.guard_storefront_location()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.order_location_id is not null and not exists (
    select 1 from public.locations as l
    where l.id = new.order_location_id and l.tenant_id = new.tenant_id
  ) then
    raise exception 'That location belongs to a different business.' using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger tenant_storefronts_guard_location
  before insert or update of order_location_id, tenant_id on public.tenant_storefronts
  for each row execute function public.guard_storefront_location();

-- Every existing business gets its row now, every new one at provisioning.
insert into public.tenant_storefronts (tenant_id)
select t.id from public.tenants as t
where not exists (select 1 from public.tenant_storefronts as s where s.tenant_id = t.id);

-- The latest definition is Phase 21's (`20260830130200_create_module_resolution`),
-- which added the subscription. Copied whole, with the storefront appended.
create or replace function public.create_tenant_defaults()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.tenant_settings (tenant_id, trade_name)
  values (new.id, new.name)
  on conflict (tenant_id) do nothing;

  insert into public.tenant_themes (tenant_id)
  values (new.id)
  on conflict (tenant_id) do nothing;

  insert into public.tenant_seo (tenant_id)
  values (new.id)
  on conflict (tenant_id) do nothing;

  insert into public.subscriptions (tenant_id, plan_code)
  select new.id, p.code from public.plans as p where p.is_default
  on conflict (tenant_id) do nothing;

  insert into public.locations (tenant_id, name)
  values (new.id, new.name)
  on conflict (tenant_id, lower(btrim(name))) do nothing;

  insert into public.billing_provider_configs (tenant_id)
  values (new.id)
  on conflict (tenant_id) do nothing;

  insert into public.units (tenant_id, name, abbreviation)
  values
    (new.id, 'Kilogramo', 'kg'),
    (new.id, 'Gramo', 'g'),
    (new.id, 'Litro', 'l'),
    (new.id, 'Mililitro', 'ml'),
    (new.id, 'Unidad', 'unidad')
  on conflict (tenant_id, lower(btrim(abbreviation))) do nothing;

  -- Added in Phase 29.
  insert into public.tenant_storefronts (tenant_id)
  values (new.id)
  on conflict (tenant_id) do nothing;

  return new;
end;
$$;

comment on function public.create_tenant_defaults() is
  'Gives every new tenant its settings, theme, SEO row, a subscription to the default plan, first location, billing config, starter units and storefront, however it was created.';

alter table public.tenant_storefronts enable row level security;

create policy tenant_storefronts_select_member
  on public.tenant_storefronts for select to authenticated
  using (public.is_tenant_member(tenant_id));

-- UPDATE only, for the reason `tenant_settings` gives: the row is an invariant
-- created by provisioning, and deleting it would break the public site with no
-- way back from the application.
create policy tenant_storefronts_update_manager
  on public.tenant_storefronts for update to authenticated
  using (public.has_permission(tenant_id, 'settings.manage'))
  with check (public.has_permission(tenant_id, 'settings.manage'));

-- ---------------------------------------------------------------------------
-- Which payment methods the website offers
-- ---------------------------------------------------------------------------

-- Off by default. A method created for the till ("Efectivo caja 2", "POS
-- Niubiz") is not automatically something a stranger on the internet should be
-- offered, and switching it on is one click.
alter table public.payment_methods
  add column show_on_website boolean not null default false;

comment on column public.payment_methods.show_on_website is
  'Offered to customers on the public website checkout (Phase 29).';

-- ---------------------------------------------------------------------------
-- Opening state
-- ---------------------------------------------------------------------------

-- The branch that receives web orders: the configured one while it is active,
-- otherwise the oldest active branch.
create or replace function public.storefront_location(p_tenant_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select l.id
      from public.tenant_storefronts as s
      join public.locations as l on l.id = s.order_location_id
      where s.tenant_id = p_tenant_id and l.is_active
    ),
    (
      select l.id
      from public.locations as l
      where l.tenant_id = p_tenant_id and l.is_active
      order by l.created_at, l.id
      limit 1
    )
  );
$$;

comment on function public.storefront_location(uuid) is
  'The branch web orders are placed against: the configured one if active, else the oldest active branch.';

revoke execute on function public.storefront_location(uuid) from public;

-- Is the shop taking orders right now?
--
-- Computed HERE and not in the browser, for the reason Sugu Rolls learned: a
-- visitor's clock can be moved, and a shop that trusted it would take orders at
-- four in the morning.
--
-- Local time is the business's own timezone (Phase 06). Shifts never cross
-- midnight (Phase 10), so a plain `between` per weekday is the whole rule, and
-- `24:00` needs no special case: every wall-clock time compares below it.
--
-- A branch with NO shifts at all is open in `auto`. A business that has not
-- filled its hours in yet would otherwise be born closed, forever, with nothing
-- on the page explaining why - the worst possible first impression, and not
-- what "auto" means to somebody who never set anything.
create or replace function public.storefront_is_open(p_tenant_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_mode     public.storefront_mode;
  v_location uuid;
  v_timezone text;
  v_local    timestamp;
begin
  select s.mode into v_mode
  from public.tenant_storefronts as s
  where s.tenant_id = p_tenant_id;

  if v_mode is null then
    return false;
  elsif v_mode = 'open' then
    return true;
  elsif v_mode = 'closed' then
    return false;
  end if;

  v_location := public.storefront_location(p_tenant_id);
  if v_location is null then
    return false;
  end if;

  if not exists (select 1 from public.location_hours as h where h.location_id = v_location) then
    return true;
  end if;

  select ts.timezone into v_timezone
  from public.tenant_settings as ts
  where ts.tenant_id = p_tenant_id;

  -- The CHECK on `timezone` validates its shape, not its existence (Phase 06).
  -- An unknown zone must not take the public site down with it.
  begin
    v_local := now() at time zone coalesce(v_timezone, 'America/Lima');
  exception when others then
    v_local := now() at time zone 'America/Lima';
  end;

  return exists (
    select 1
    from public.location_hours as h
    where h.location_id = v_location
      and h.day_of_week = extract(dow from v_local)::smallint
      and v_local::time >= h.opens_at
      and v_local::time < h.closes_at
  );
end;
$$;

comment on function public.storefront_is_open(uuid) is
  'True when the website takes orders now: forced mode, or the ordering branch''s shifts in the business timezone.';

revoke execute on function public.storefront_is_open(uuid) from public;
grant execute on function public.storefront_is_open(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Public reads
-- ---------------------------------------------------------------------------

-- Everything the header, the footer and the checkout need to know about how
-- this business sells, in one round trip.
create or replace function public.get_public_storefront(p_tenant_id uuid)
returns table (
  ordering_enabled  boolean,
  can_order         boolean,
  is_open           boolean,
  mode              public.storefront_mode,
  closed_message    text,
  accepts_delivery  boolean,
  accepts_pickup    boolean,
  min_order_cents   bigint,
  whatsapp          text,
  whatsapp_button   boolean,
  whatsapp_message  text,
  tagline           text,
  public_email      text,
  location_id       uuid
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    s.ordering_enabled,
    s.ordering_enabled
      and public.has_module(s.tenant_id, 'orders')
      and public.storefront_is_open(s.tenant_id),
    public.storefront_is_open(s.tenant_id),
    s.mode,
    s.closed_message,
    -- Delivery is a module (Phase 21). A business without it picks up only,
    -- whatever the checkbox says - the checkbox cannot sell a module.
    s.accepts_delivery and public.has_module(s.tenant_id, 'delivery'),
    s.accepts_pickup,
    s.min_order_cents,
    ts.whatsapp,
    s.whatsapp_button,
    s.whatsapp_message,
    s.tagline,
    s.public_email,
    public.storefront_location(s.tenant_id)
  from public.tenant_storefronts as s
  left join public.tenant_settings as ts on ts.tenant_id = s.tenant_id
  where s.tenant_id = p_tenant_id
    and public.is_tenant_public(s.tenant_id);
$$;

comment on function public.get_public_storefront(uuid) is
  'How a business sells from its website, for the public site. Never returns contact_email or tax data.';

revoke execute on function public.get_public_storefront(uuid) from public;
grant execute on function public.get_public_storefront(uuid) to anon, authenticated;

-- Social links. The table's own policy is member-only (Phase 06) and stays so;
-- the footer reads them through here.
create or replace function public.list_public_social_links(p_tenant_id uuid)
returns table (platform public.social_platform, url text)
language sql
stable
security definer
set search_path = ''
as $$
  select l.platform, l.url
  from public.tenant_social_links as l
  where l.tenant_id = p_tenant_id
    and public.is_tenant_public(p_tenant_id)
  order by l.position, l.platform;
$$;

revoke execute on function public.list_public_social_links(uuid) from public;
grant execute on function public.list_public_social_links(uuid) to anon, authenticated;

-- Delivery zones with the rate that applies to web orders: the ordering
-- branch's own rate when it has one, otherwise the zone default (ADR-023).
-- A zone with no active rate is not offered - there is nothing to charge.
create or replace function public.list_public_delivery_zones(p_tenant_id uuid)
returns table (
  zone_id              uuid,
  name                 text,
  district             text,
  notes                text,
  fee_cents            bigint,
  min_order_free_cents bigint,
  estimated_minutes    smallint
)
language sql
stable
security definer
set search_path = ''
as $$
  select z.id, z.name, z.district, z.notes, r.fee_cents, r.min_order_free_cents, r.estimated_minutes
  from public.delivery_zones as z
  join lateral (
    select dr.fee_cents, dr.min_order_free_cents, dr.estimated_minutes
    from public.delivery_rates as dr
    where dr.zone_id = z.id
      and dr.is_active
      and (dr.location_id is null or dr.location_id = public.storefront_location(p_tenant_id))
    -- `false` sorts first: the branch-specific rate wins over the default.
    order by (dr.location_id is null)
    limit 1
  ) as r on true
  where z.tenant_id = p_tenant_id
    and z.is_active
    and public.is_tenant_public(p_tenant_id)
    and public.has_module(p_tenant_id, 'delivery')
  order by z.name;
$$;

revoke execute on function public.list_public_delivery_zones(uuid) from public;
grant execute on function public.list_public_delivery_zones(uuid) to anon, authenticated;

-- "Los mas pedidos": units sold per product in the storefront's window.
--
-- Returns ids and counts only. `order_items` is member-only and holds nothing a
-- visitor may read line by line; an aggregate over a whole business names no
-- customer and no order.
create or replace function public.list_public_bestsellers(p_tenant_id uuid, p_limit integer default 8)
returns table (product_id uuid, units numeric)
language sql
stable
security definer
set search_path = ''
as $$
  select i.product_id, sum(i.quantity) as units
  from public.order_items as i
  join public.orders as o on o.id = i.order_id
  join public.products as p on p.id = i.product_id
  where i.tenant_id = p_tenant_id
    and o.tenant_id = p_tenant_id
    and o.status <> 'cancelled'
    and o.placed_at >= now() - make_interval(days => coalesce(
      (select s.bestsellers_days from public.tenant_storefronts as s where s.tenant_id = p_tenant_id),
      30
    ))
    and p.status = 'active'
    and public.is_tenant_public(p_tenant_id)
  group by i.product_id
  order by units desc, i.product_id
  limit least(greatest(coalesce(p_limit, 8), 1), 24);
$$;

revoke execute on function public.list_public_bestsellers(uuid, integer) from public;
grant execute on function public.list_public_bestsellers(uuid, integer) to anon, authenticated;

-- The payment methods offered at checkout. `reference` is the Yape number or
-- the account a customer transfers to - published on purpose.
create or replace function public.list_public_payment_methods(p_tenant_id uuid)
returns table (
  id        uuid,
  type      public.payment_method_type,
  name      text,
  reference text
)
language sql
stable
security definer
set search_path = ''
as $$
  select pm.id, pm.type, pm.name, pm.reference
  from public.payment_methods as pm
  where pm.tenant_id = p_tenant_id
    and pm.is_active
    and pm.show_on_website
    and public.is_tenant_public(p_tenant_id)
  order by pm.position, pm.name;
$$;

revoke execute on function public.list_public_payment_methods(uuid) from public;
grant execute on function public.list_public_payment_methods(uuid) to anon, authenticated;
