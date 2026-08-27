-- Phase 16 - Kitchen / KDS
-- The station a line was made for, snapshotted at insert.
--
-- SPEC: docs/specs/phase-16-kitchen-kds.md sections 8, 11.
-- ADR-020: this is NOT an extension of ADR-017's "snapshot for financial
-- immutability" reasoning. It exists so `postgres_changes` - which can only
-- filter on a literal column of the table it watches, never a joined one -
-- has something to filter `order_items` on. Both land in the same trigger
-- because both happen once, at insert, from the same product row - not
-- because they are the same kind of decision.

alter table public.order_items
  add column station public.kitchen_station not null default 'kitchen';

comment on column public.order_items.station is
  'Copied from the product''s category at insert (ADR-020). Correcting a category''s station later does not touch lines already snapshotted - correct for "what''s cooking now".';

-- The query every kitchen board runs: this tenant's lines for one station.
create index order_items_tenant_station_idx
  on public.order_items (tenant_id, station);

-- ---------------------------------------------------------------------------
-- Extending the Phase 13 snapshot trigger
-- ---------------------------------------------------------------------------

create or replace function public.snapshot_order_item()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order_tenant   uuid;
  v_order_status   public.order_status;
  v_product_tenant uuid;
  v_product_name   text;
  v_product_status public.product_status;
  v_price          bigint;
  v_variant_name   text;
  v_station        public.kitchen_station;
begin
  select o.tenant_id, o.status into v_order_tenant, v_order_status
  from public.orders as o
  where o.id = new.order_id;

  if v_order_tenant is null then
    raise exception 'Order not found.' using errcode = 'P0002';
  end if;

  new.tenant_id := v_order_tenant;

  if v_order_status <> 'pending' then
    raise exception 'An order that is no longer pending cannot change its lines.'
      using errcode = 'P0001';
  end if;

  if new.product_id is null then
    -- A free-text line: no product, no category, stays on the default
    -- station. Sensible on its own (an ad-hoc "servicio" line has to go
    -- somewhere) and consistent with every other category left untagged.
    if new.name_snapshot is null or btrim(new.name_snapshot) = '' then
      raise exception 'A line without a product needs a name.' using errcode = '23514';
    end if;
    if new.unit_price_cents is null then
      raise exception 'A line without a product needs a price.' using errcode = '23514';
    end if;
  else
    select p.tenant_id, p.name, p.status, p.base_price_cents
      into v_product_tenant, v_product_name, v_product_status, v_price
    from public.products as p
    where p.id = new.product_id;

    if v_product_tenant is null or v_product_tenant <> v_order_tenant then
      raise exception 'That product belongs to a different business.'
        using errcode = '23514';
    end if;

    if v_product_status = 'archived' then
      raise exception 'That product is archived and cannot be added to an order.'
        using errcode = '23514';
    end if;

    if new.variant_id is not null then
      select v.name, v.price_cents into v_variant_name, v_price
      from public.product_variants as v
      where v.id = new.variant_id
        and v.product_id = new.product_id
        and v.tenant_id = v_order_tenant;

      if v_variant_name is null then
        raise exception 'That variant does not belong to this product.'
          using errcode = '23514';
      end if;

      new.variant_snapshot := v_variant_name;
    end if;

    new.name_snapshot    := v_product_name;
    new.unit_price_cents := v_price;

    -- Phase 16: the station this line shows up on, from its category. A
    -- product with no category (category_id is nullable, Phase 11) stays on
    -- the column's own default.
    select c.kitchen_station into v_station
    from public.products as p
    join public.categories as c on c.id = p.category_id
    where p.id = new.product_id;

    if v_station is not null then
      new.station := v_station;
    end if;
  end if;

  new.total_cents :=
    round(new.unit_price_cents * new.quantity) - new.discount_cents + new.tax_cents;

  return new;
end;
$$;

comment on function public.snapshot_order_item() is
  'Copies name, price and kitchen station from the catalogue at insert time (Phase 13, extended Phase 16 - ADR-020). Price is never accepted from a client.';
