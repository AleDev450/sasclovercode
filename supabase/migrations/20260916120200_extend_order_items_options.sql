-- Phase 29 - Tienda online
-- Extras on an order line, priced by the database.
--
-- SPEC: docs/specs/phase-29-storefront.md sections 6 (FR2902), 8.
--
-- `product_options` has existed since Phase 11 - "Salsa: acevichada", "Extra
-- palta +S/ 3" - and no order could carry one: the POS ignored them and the
-- line had nowhere to put them. A restaurant website that cannot sell a maki
-- with its sauce is not one, so the line learns to hold them.
--
-- The rule of Phase 13 extends to them unchanged: the caller says WHICH options,
-- the database says what they cost. `option_ids` is the input; the name and the
-- price delta are copied at insert time into `options_snapshot` and
-- `unit_price_cents`, and nothing reads the catalogue again afterwards.

alter table public.order_items
  add column option_ids uuid[] not null default '{}',
  add column options_snapshot text;

alter table public.order_items
  add constraint order_items_option_ids_count check (cardinality(option_ids) <= 20),
  add constraint order_items_options_snapshot_length
    check (coalesce(char_length(options_snapshot), 0) <= 500);

comment on column public.order_items.option_ids is
  'Chosen product_options. Pointers for reporting; the price and names are copied at insert (Phase 29).';
comment on column public.order_items.options_snapshot is
  'Human-readable copy of the chosen options, e.g. "Salsa: Acevichada · Extras: Palta". Never re-read from the catalogue.';

-- The latest definition (Phase 16) with the options added. Everything else is
-- unchanged, line for line.
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
  v_option_count   integer;
  v_options_delta  bigint;
  v_options_text   text;
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

  new.option_ids := coalesce(new.option_ids, '{}');

  if new.product_id is null then
    if new.name_snapshot is null or btrim(new.name_snapshot) = '' then
      raise exception 'A line without a product needs a name.' using errcode = '23514';
    end if;
    if new.unit_price_cents is null then
      raise exception 'A line without a product needs a price.' using errcode = '23514';
    end if;
    -- An option is an option OF a product. A free-text line has none to have.
    if cardinality(new.option_ids) > 0 then
      raise exception 'A line without a product cannot carry options.' using errcode = '23514';
    end if;
    new.options_snapshot := null;
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

    new.options_snapshot := null;

    if cardinality(new.option_ids) > 0 then
      -- The same option twice is one option, not a double charge.
      new.option_ids := array(select distinct unnest(new.option_ids));

      select
        count(*),
        coalesce(sum(op.price_delta_cents), 0),
        string_agg(op.group_label || ': ' || op.name, ' · ' order by op.position, op.group_label, op.name)
        into v_option_count, v_options_delta, v_options_text
      from public.product_options as op
      where op.id = any (new.option_ids)
        and op.product_id = new.product_id
        and op.tenant_id = v_order_tenant
        and op.is_active;

      -- Every id has to be a live option of THIS product. Counting is what
      -- catches an option of another product, of another business, or one that
      -- was switched off - all of which would otherwise just be silently priced
      -- at zero.
      if v_option_count <> cardinality(new.option_ids) then
        raise exception 'That option does not belong to this product.'
          using errcode = '23514';
      end if;

      new.options_snapshot := left(v_options_text, 500);
      v_price := greatest(v_price + v_options_delta, 0);
    end if;

    new.name_snapshot    := v_product_name;
    new.unit_price_cents := v_price;

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
  'Copies name, price, options and kitchen station from the catalogue at insert time (Phases 13, 16, 29). Price is never accepted from a client.';

-- The latest definition (ADR-029) with the two new snapshot columns pinned.
create or replace function public.recompute_order_item_total()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order_status public.order_status;
  v_detaching    boolean;
begin
  select o.status into v_order_status from public.orders as o where o.id = new.order_id;

  v_detaching :=
    old.product_id is not null
    and new.product_id is null
    and to_jsonb(new) - 'product_id' = to_jsonb(old) - 'product_id';

  if v_order_status <> 'pending' and not v_detaching then
    raise exception 'An order that is no longer pending cannot change its lines.'
      using errcode = 'P0001';
  end if;

  new.name_snapshot    := old.name_snapshot;
  new.variant_snapshot := old.variant_snapshot;
  new.unit_price_cents := old.unit_price_cents;
  new.option_ids       := old.option_ids;
  new.options_snapshot := old.options_snapshot;

  new.total_cents :=
    round(new.unit_price_cents * new.quantity) - new.discount_cents + new.tax_cents;

  return new;
end;
$$;

comment on function public.recompute_order_item_total() is
  'Recomputes a line total on update while pinning the snapshot columns, options included. A closed order admits exactly one edit: losing a deleted product''s reference (ADR-029).';
