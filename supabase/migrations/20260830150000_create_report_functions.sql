-- Phase 23 - Reports + Analytics
-- The eight questions of master section 33, answered in seven functions.
--
-- SPEC: docs/specs/phase-23-reports-analytics.md sections 8, 11, 19.
-- CLOVERCODE_MASTER.md sections 8, 18, 26, 33 (Phase 23), 40.
-- ADR-027.
--
-- This is the first migration in the project that creates NO TABLE. That is the
-- correct outcome: a report reads what twenty-two phases already wrote, and
-- adding a table to store the result would be exactly the materialised view
-- that master says not to add yet.
--
-- Three properties hold for all seven:
--
--   1. Only `completed` orders count. Since ADR-022 stock is consumed at
--      `completed` and since ADR-024 points are credited there; a report that
--      counted `ready` would talk about a different set of orders than the
--      inventory does, and the two could never be reconciled.
--
--   2. SECURITY DEFINER with an explicit `reports.view` gate. A report crosses
--      orders, order_items, payments, customers and locations; under INVOKER
--      the caller would need four other permissions and `reports.view` would
--      govern nothing. The gate is the only defence here, which is why it is
--      tested from both sides (TEST-2320, TEST-2321).
--
--   3. Time is grouped in the TENANT'S timezone (master section 40). Grouping
--      by UTC would be correct for the database and false for the business: in
--      Lima the 19:00-23:59 sales fall on the next day, and a restaurant's peak
--      hour would show up at dawn.

-- ---------------------------------------------------------------------------
-- The index these seven queries actually use
-- ---------------------------------------------------------------------------

-- The literal predicate of every function below: one tenant, completed orders,
-- a date range.
create index orders_tenant_status_placed_idx
  on public.orders (tenant_id, status, placed_at desc);

-- And the one it replaces goes.
--
-- Master section 8 asks to analyse indexes for every important query AND to
-- avoid over-indexing, in the same breath. The new index is a strict prefix
-- superset of the old one, so everything that used `(tenant_id, status)` is
-- served by `(tenant_id, status, placed_at)` just as well - and keeping both
-- would be weight on every order INSERT for nothing.
drop index public.orders_tenant_status_idx;

-- ---------------------------------------------------------------------------
-- The tenant's clock
-- ---------------------------------------------------------------------------

-- Every temporal grouping goes through this, so the conversion lives in one
-- place instead of being "dispersed through the application" (section 40).
--
-- `America/Lima` is the fallback because it is the default Phase 06 chose for
-- `tenant_settings.timezone`; a tenant whose settings row was deleted by hand
-- gets the same answer it would have got with one.
create or replace function public.tenant_timezone(p_tenant_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select s.timezone from public.tenant_settings as s where s.tenant_id = p_tenant_id),
    'America/Lima'
  );
$$;

comment on function public.tenant_timezone(uuid) is
  'The business''s timezone, for grouping reports by day and hour (master section 40).';

revoke execute on function public.tenant_timezone(uuid) from public;
grant execute on function public.tenant_timezone(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 1. Sales, orders and average ticket
-- ---------------------------------------------------------------------------

-- Two of master's eight dimensions come out of here together, because "ventas"
-- and "ticket promedio" are the same aggregate divided differently.
create or replace function public.report_sales_summary(
  p_tenant_id   uuid,
  p_from        timestamptz,
  p_to          timestamptz,
  p_location_id uuid default null
)
returns table (
  order_count          bigint,
  gross_cents          bigint,
  discount_cents       bigint,
  shipping_cents       bigint,
  net_cents            bigint,
  average_ticket_cents bigint,
  item_count           numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.has_permission(p_tenant_id, 'reports.view') then
    return;
  end if;

  return query
  select
    count(*)::bigint,
    coalesce(sum(o.subtotal_cents), 0)::bigint,
    -- Both kinds of discount: the per-line ones (Phase 13) and the order-level
    -- ones (Phase 20). A report that showed only one would not reconcile.
    coalesce(sum(o.discount_cents + o.promotion_discount_cents), 0)::bigint,
    coalesce(sum(o.shipping_cents), 0)::bigint,
    coalesce(sum(o.total_cents), 0)::bigint,
    -- Integer division, and zero rather than a division by zero when nothing
    -- sold. ADR-015: money stays an integer even when it is an average.
    case
      when count(*) = 0 then 0
      -- The sum is cast to bigint BEFORE the division, deliberately.
      -- `sum(bigint)` returns numeric, so dividing first would be exact
      -- division and the cast at the end would ROUND: an average of 1333.67
      -- would be reported as 1334, and a business would find a cent it never
      -- took. bigint / bigint truncates, which is what ADR-015 means by money
      -- staying an integer even when it is an average.
      else (coalesce(sum(o.total_cents), 0)::bigint / count(*)::bigint)
    end,
    coalesce(
      (select sum(i.quantity) from public.order_items as i
       where i.order_id in (
         select o2.id from public.orders as o2
         where o2.tenant_id = p_tenant_id
           and o2.status = 'completed'
           and o2.placed_at >= p_from and o2.placed_at < p_to
           and (p_location_id is null or o2.location_id = p_location_id)
       )),
      0
    )
  from public.orders as o
  where o.tenant_id = p_tenant_id
    and o.status = 'completed'
    and o.placed_at >= p_from and o.placed_at < p_to
    and (p_location_id is null or o.location_id = p_location_id);
end;
$$;

comment on function public.report_sales_summary(uuid, timestamptz, timestamptz, uuid) is
  'Sales, orders and average ticket over a range. Completed orders only (ADR-027).';

revoke execute on function public.report_sales_summary(uuid, timestamptz, timestamptz, uuid) from public;
grant execute on function public.report_sales_summary(uuid, timestamptz, timestamptz, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Day by day
-- ---------------------------------------------------------------------------

create or replace function public.report_sales_by_day(
  p_tenant_id   uuid,
  p_from        timestamptz,
  p_to          timestamptz,
  p_location_id uuid default null
)
returns table (day date, order_count bigint, net_cents bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tz text;
begin
  if not public.has_permission(p_tenant_id, 'reports.view') then
    return;
  end if;

  v_tz := public.tenant_timezone(p_tenant_id);

  return query
  select
    (o.placed_at at time zone v_tz)::date as day,
    count(*)::bigint,
    coalesce(sum(o.total_cents), 0)::bigint
  from public.orders as o
  where o.tenant_id = p_tenant_id
    and o.status = 'completed'
    and o.placed_at >= p_from and o.placed_at < p_to
    and (p_location_id is null or o.location_id = p_location_id)
  group by 1
  order by 1;
end;
$$;

comment on function public.report_sales_by_day(uuid, timestamptz, timestamptz, uuid) is
  'Sales per day, in the tenant''s timezone (master section 40).';

revoke execute on function public.report_sales_by_day(uuid, timestamptz, timestamptz, uuid) from public;
grant execute on function public.report_sales_by_day(uuid, timestamptz, timestamptz, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Hour by hour - master's "horarios"
-- ---------------------------------------------------------------------------

-- Returns all 24 hours, always, with zeroes where nothing sold.
--
-- A plain `group by` gives back only the hours that sold, and a table of seven
-- scattered rows does not read as a profile of a day. "When do I NOT sell?" is
-- as useful a question as its opposite, and it needs the empty rows to be
-- visible.
create or replace function public.report_sales_by_hour(
  p_tenant_id   uuid,
  p_from        timestamptz,
  p_to          timestamptz,
  p_location_id uuid default null
)
returns table (hour smallint, order_count bigint, net_cents bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tz text;
begin
  if not public.has_permission(p_tenant_id, 'reports.view') then
    return;
  end if;

  v_tz := public.tenant_timezone(p_tenant_id);

  return query
  select
    h.hour::smallint,
    coalesce(sold.order_count, 0)::bigint,
    coalesce(sold.net_cents, 0)::bigint
  from generate_series(0, 23) as h(hour)
  left join (
    select
      extract(hour from o.placed_at at time zone v_tz)::int as hour,
      count(*) as order_count,
      sum(o.total_cents) as net_cents
    from public.orders as o
    where o.tenant_id = p_tenant_id
      and o.status = 'completed'
      and o.placed_at >= p_from and o.placed_at < p_to
      and (p_location_id is null or o.location_id = p_location_id)
    group by 1
  ) as sold on sold.hour = h.hour
  order by h.hour;
end;
$$;

comment on function public.report_sales_by_hour(uuid, timestamptz, timestamptz, uuid) is
  'Sales per hour of the day, all 24 rows, in the tenant''s timezone.';

revoke execute on function public.report_sales_by_hour(uuid, timestamptz, timestamptz, uuid) from public;
grant execute on function public.report_sales_by_hour(uuid, timestamptz, timestamptz, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Branch by branch - master's "sucursales"
-- ---------------------------------------------------------------------------

-- Every location appears, including the ones that sold nothing: a branch with
-- no sales this week is the row somebody most needs to see.
create or replace function public.report_sales_by_location(
  p_tenant_id uuid,
  p_from      timestamptz,
  p_to        timestamptz
)
returns table (
  location_id   uuid,
  location_name text,
  order_count   bigint,
  net_cents     bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.has_permission(p_tenant_id, 'reports.view') then
    return;
  end if;

  return query
  select
    l.id,
    l.name,
    coalesce(sold.order_count, 0)::bigint,
    coalesce(sold.net_cents, 0)::bigint
  from public.locations as l
  left join (
    select o.location_id, count(*) as order_count, sum(o.total_cents) as net_cents
    from public.orders as o
    where o.tenant_id = p_tenant_id
      and o.status = 'completed'
      and o.placed_at >= p_from and o.placed_at < p_to
    group by o.location_id
  ) as sold on sold.location_id = l.id
  where l.tenant_id = p_tenant_id
  order by coalesce(sold.net_cents, 0) desc, l.name;
end;
$$;

comment on function public.report_sales_by_location(uuid, timestamptz, timestamptz) is
  'Sales per branch, including branches that sold nothing.';

revoke execute on function public.report_sales_by_location(uuid, timestamptz, timestamptz) from public;
grant execute on function public.report_sales_by_location(uuid, timestamptz, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Products
-- ---------------------------------------------------------------------------

-- Grouped by the SNAPSHOT name, not by the product row.
--
-- `order_items.name_snapshot` is what the ticket said (ADR-017), so a product
-- deleted from the catalogue still shows up in the report of the month it was
-- sold - which is the whole reason that snapshot exists. `product_id` comes
-- along when it still resolves, so the screen can link to what survives.
--
-- Ordered by net sales rather than by units: twenty bottles of water are not a
-- better seller than three whole menus, and a business deciding what to stock
-- cares about the money.
create or replace function public.report_top_products(
  p_tenant_id   uuid,
  p_from        timestamptz,
  p_to          timestamptz,
  p_location_id uuid default null,
  p_limit       integer default 20
)
returns table (
  product_id  uuid,
  name        text,
  quantity    numeric,
  net_cents   bigint,
  order_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.has_permission(p_tenant_id, 'reports.view') then
    return;
  end if;

  return query
  select
    min(i.product_id::text)::uuid,
    i.name_snapshot,
    sum(i.quantity),
    sum(i.total_cents)::bigint,
    count(distinct i.order_id)::bigint
  from public.order_items as i
  join public.orders as o on o.id = i.order_id
  where o.tenant_id = p_tenant_id
    and o.status = 'completed'
    and o.placed_at >= p_from and o.placed_at < p_to
    and (p_location_id is null or o.location_id = p_location_id)
  group by i.name_snapshot
  order by sum(i.total_cents) desc, i.name_snapshot
  limit greatest(p_limit, 1);
end;
$$;

comment on function public.report_top_products(uuid, timestamptz, timestamptz, uuid, integer) is
  'Best sellers by NET SALES, grouped by the line snapshot so a deleted product still appears.';

revoke execute on function public.report_top_products(uuid, timestamptz, timestamptz, uuid, integer) from public;
grant execute on function public.report_top_products(uuid, timestamptz, timestamptz, uuid, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Customers
-- ---------------------------------------------------------------------------

-- Counter sales have no customer (ADR-016 does not ask for personal data a sale
-- does not need), so they count in the sales report and not in this one. That
-- is why the totals here are legitimately smaller than the summary's.
create or replace function public.report_top_customers(
  p_tenant_id uuid,
  p_from      timestamptz,
  p_to        timestamptz,
  p_limit     integer default 20
)
returns table (
  customer_id uuid,
  name        text,
  order_count bigint,
  net_cents   bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.has_permission(p_tenant_id, 'reports.view') then
    return;
  end if;

  return query
  select
    c.id,
    c.name,
    count(*)::bigint,
    coalesce(sum(o.total_cents), 0)::bigint
  from public.orders as o
  join public.customers as c on c.id = o.customer_id
  where o.tenant_id = p_tenant_id
    and o.status = 'completed'
    and o.placed_at >= p_from and o.placed_at < p_to
  group by c.id, c.name
  order by sum(o.total_cents) desc, c.name
  limit greatest(p_limit, 1);
end;
$$;

comment on function public.report_top_customers(uuid, timestamptz, timestamptz, integer) is
  'Best customers by net sales. Counter sales have no customer and are excluded.';

revoke execute on function public.report_top_customers(uuid, timestamptz, timestamptz, integer) from public;
grant execute on function public.report_top_customers(uuid, timestamptz, timestamptz, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Payment methods
-- ---------------------------------------------------------------------------

-- Grouped by the ORDER's date, not the payment's.
--
-- That is what makes this reconcile with the summary: both answer "of the sales
-- in this range, ...". An order placed yesterday and paid today counts
-- yesterday. Reconciling the till - which is a different question, about money
-- that moved - is what Phase 14's own screens are for (KL-2307).
--
-- Voided payments are excluded: a void is money that never arrived.
create or replace function public.report_sales_by_payment_method(
  p_tenant_id uuid,
  p_from      timestamptz,
  p_to        timestamptz
)
returns table (
  payment_method_id uuid,
  name              text,
  type              public.payment_method_type,
  payment_count     bigint,
  net_cents         bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.has_permission(p_tenant_id, 'reports.view') then
    return;
  end if;

  return query
  select
    m.id,
    m.name,
    m.type,
    count(*)::bigint,
    coalesce(sum(p.amount_cents), 0)::bigint
  from public.payments as p
  join public.orders as o on o.id = p.order_id
  join public.payment_methods as m on m.id = p.payment_method_id
  where p.tenant_id = p_tenant_id
    and p.voided_at is null
    and o.status = 'completed'
    and o.placed_at >= p_from and o.placed_at < p_to
  group by m.id, m.name, m.type
  order by sum(p.amount_cents) desc, m.name;
end;
$$;

comment on function public.report_sales_by_payment_method(uuid, timestamptz, timestamptz) is
  'How the sales of a range were paid. Grouped by the ORDER''s date so it reconciles with the summary.';

revoke execute on function public.report_sales_by_payment_method(uuid, timestamptz, timestamptz) from public;
grant execute on function public.report_sales_by_payment_method(uuid, timestamptz, timestamptz) to authenticated;
