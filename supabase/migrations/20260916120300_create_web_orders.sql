-- Phase 29 - Tienda online
-- An order placed by a stranger from the business's own website.
--
-- SPEC: docs/specs/phase-29-storefront.md sections 6, 8, 10, 11.
-- ADR-033: anonymous web order by function, and a tracking token.
--
-- The first write in CloverCode that an ANONYMOUS visitor can cause. Everything
-- about how it is shaped follows from that:
--
--   * There is still no INSERT policy for `anon` on any table. The only door is
--     `place_web_order`, a function that validates the whole order and writes
--     it atomically, the same way `redeem_loyalty_points` (Phase 20) is the only
--     door to a redemption.
--   * The visitor sends ids and quantities. Prices, extras, delivery fees and
--     totals are computed by the triggers of Phases 13, 19 and 29 - the price
--     of a web order is exactly as tamper-proof as the price of a POS order.
--   * The tenant is an ARGUMENT supplied by the server from the hostname, never
--     a field of the form, and every id in the payload is checked against it.
--   * The visitor gets back a secret token to follow the order. Only its hash is
--     stored.

-- ---------------------------------------------------------------------------
-- web_orders
-- ---------------------------------------------------------------------------

create table public.web_orders (
  order_id           uuid        not null,
  tenant_id          uuid        not null,
  access_token_hash  text        not null,
  -- Copies taken at the moment of ordering. The customer row is matched by
  -- phone and may carry an older spelling of the name; what the kitchen and the
  -- courier need is what this person typed today.
  contact_name       text        not null,
  contact_phone      text        not null,
  fulfillment        text        not null,
  payment_method_id  uuid,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint web_orders_pkey primary key (order_id),
  constraint web_orders_order_id_fkey
    foreign key (order_id) references public.orders (id) on delete cascade,
  constraint web_orders_tenant_id_fkey
    foreign key (tenant_id) references public.tenants (id) on delete cascade,
  constraint web_orders_payment_method_id_fkey
    foreign key (payment_method_id) references public.payment_methods (id) on delete restrict,
  constraint web_orders_access_token_hash_key unique (access_token_hash),

  constraint web_orders_access_token_hash_format check (access_token_hash ~ '^[0-9a-f]{64}$'),
  constraint web_orders_contact_name_length check (char_length(btrim(contact_name)) between 1 and 120),
  constraint web_orders_contact_phone_format check (contact_phone ~ '^\+?[0-9]{6,20}$'),
  constraint web_orders_fulfillment_allowed check (fulfillment in ('delivery', 'pickup'))
);

comment on table public.web_orders is
  'The website half of an order placed online: contact copy, fulfillment and tracking token hash (Phase 29).';
comment on column public.web_orders.access_token_hash is
  'sha256 hex of the tracking token. The token itself is returned once and never stored.';

create index web_orders_tenant_created_idx on public.web_orders (tenant_id, created_at desc);

create trigger web_orders_set_updated_at
  before update on public.web_orders
  for each row execute function public.set_updated_at();

-- The tenant is the order's, and the payment method has to be the same
-- business's. The pattern of every child table since Phase 10.
create or replace function public.derive_web_order_tenant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order_tenant uuid;
begin
  select o.tenant_id into v_order_tenant from public.orders as o where o.id = new.order_id;

  if v_order_tenant is null then
    raise exception 'Order not found.' using errcode = 'P0002';
  end if;

  new.tenant_id := v_order_tenant;

  if new.payment_method_id is not null and not exists (
    select 1 from public.payment_methods as pm
    where pm.id = new.payment_method_id and pm.tenant_id = v_order_tenant
  ) then
    raise exception 'That payment method belongs to a different business.' using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger web_orders_derive_tenant
  before insert or update on public.web_orders
  for each row execute function public.derive_web_order_tenant();

alter table public.web_orders enable row level security;

-- Whoever can see the order can see how it was placed. No write policy at all:
-- the row is written by `place_web_order` and is a record of the moment.
create policy web_orders_select_member
  on public.web_orders for select to authenticated
  using (public.has_permission(tenant_id, 'orders.view'));

-- ---------------------------------------------------------------------------
-- place_web_order
-- ---------------------------------------------------------------------------

-- Errors are raised with a stable MESSAGE the application maps to Spanish
-- (`modules/storefront/errors.ts`), and SQLSTATE P0001. A message and not a
-- custom SQLSTATE because PostgREST forwards the message verbatim and that is
-- the one field every client library exposes the same way.
create or replace function public.place_web_order(p_tenant_id uuid, p_order jsonb)
returns table (
  order_id     uuid,
  order_number integer,
  access_token text,
  total_cents  bigint
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_store          public.tenant_storefronts%rowtype;
  v_location       uuid;
  v_name           text;
  v_phone          text;
  v_fulfillment    text;
  v_note           text;
  v_items          jsonb;
  v_item           jsonb;
  v_position       integer := 0;
  v_attempt        integer;
  v_order_id       uuid;
  v_number         integer;
  v_customer_id    uuid;
  v_payment_method uuid;
  v_product_id     uuid;
  v_variant_id     uuid;
  v_option_ids     uuid[];
  v_quantity       integer;
  v_line_note      text;
  v_subtotal       bigint;
  v_zone_id        uuid;
  v_zone_name      text;
  v_fee            bigint;
  v_free_from      bigint;
  v_address        text;
  v_district       text;
  v_reference      text;
  v_token          text;
  v_total          bigint;
begin
  -- --- The shop -----------------------------------------------------------
  if p_tenant_id is null
     or not public.is_tenant_public(p_tenant_id)
     or not public.has_module(p_tenant_id, 'orders') then
    raise exception 'STORE_UNAVAILABLE' using errcode = 'P0001';
  end if;

  select * into v_store from public.tenant_storefronts as s where s.tenant_id = p_tenant_id;

  if not found or not v_store.ordering_enabled then
    raise exception 'ORDERING_DISABLED' using errcode = 'P0001';
  end if;

  if not public.storefront_is_open(p_tenant_id) then
    raise exception 'STORE_CLOSED' using errcode = 'P0001';
  end if;

  v_location := public.storefront_location(p_tenant_id);
  if v_location is null then
    raise exception 'STORE_UNAVAILABLE' using errcode = 'P0001';
  end if;

  if p_order is null or jsonb_typeof(p_order) <> 'object' then
    raise exception 'INVALID_ORDER' using errcode = 'P0001';
  end if;

  -- --- Contact ------------------------------------------------------------
  v_name := btrim(coalesce(p_order #>> '{contact,name}', ''));
  if char_length(v_name) not between 1 and 120 then
    raise exception 'INVALID_CONTACT' using errcode = 'P0001';
  end if;

  -- Spaces, dashes and brackets are how people type a phone; only digits and a
  -- leading + are the number.
  v_phone := regexp_replace(coalesce(p_order #>> '{contact,phone}', ''), '[^0-9+]', '', 'g');
  v_phone := case
    when left(v_phone, 1) = '+' then '+' || replace(substr(v_phone, 2), '+', '')
    else replace(v_phone, '+', '')
  end;
  if v_phone !~ '^\+?[0-9]{6,20}$' then
    raise exception 'INVALID_CONTACT' using errcode = 'P0001';
  end if;

  -- --- Fulfillment --------------------------------------------------------
  v_fulfillment := p_order ->> 'fulfillment';

  if v_fulfillment = 'delivery' then
    if not v_store.accepts_delivery or not public.has_module(p_tenant_id, 'delivery') then
      raise exception 'FULFILLMENT_UNAVAILABLE' using errcode = 'P0001';
    end if;
  elsif v_fulfillment = 'pickup' then
    if not v_store.accepts_pickup then
      raise exception 'FULFILLMENT_UNAVAILABLE' using errcode = 'P0001';
    end if;
  else
    raise exception 'INVALID_ORDER' using errcode = 'P0001';
  end if;

  v_note := nullif(btrim(coalesce(p_order ->> 'note', '')), '');
  if v_note is not null and char_length(v_note) > 300 then
    raise exception 'INVALID_ORDER' using errcode = 'P0001';
  end if;

  -- --- Payment method -----------------------------------------------------
  if nullif(btrim(coalesce(p_order ->> 'paymentMethodId', '')), '') is not null then
    begin
      v_payment_method := (p_order ->> 'paymentMethodId')::uuid;
    exception when others then
      raise exception 'INVALID_PAYMENT_METHOD' using errcode = 'P0001';
    end;

    if not exists (
      select 1 from public.payment_methods as pm
      where pm.id = v_payment_method
        and pm.tenant_id = p_tenant_id
        and pm.is_active
        and pm.show_on_website
    ) then
      raise exception 'INVALID_PAYMENT_METHOD' using errcode = 'P0001';
    end if;
  elsif exists (
    select 1 from public.payment_methods as pm
    where pm.tenant_id = p_tenant_id and pm.is_active and pm.show_on_website
  ) then
    -- The business offers methods: the customer has to pick one, or the kitchen
    -- starts cooking an order nobody knows how it will be paid.
    raise exception 'INVALID_PAYMENT_METHOD' using errcode = 'P0001';
  end if;

  -- --- Items, shape only (existence is checked per line below) -----------
  v_items := p_order -> 'items';
  if v_items is null
     or jsonb_typeof(v_items) <> 'array'
     or jsonb_array_length(v_items) not between 1 and 50 then
    raise exception 'EMPTY_CART' using errcode = 'P0001';
  end if;

  -- --- Customer -----------------------------------------------------------
  -- Matched by phone inside THIS business. Phase 12 keeps personal data
  -- minimal: a name and a phone, nothing the order does not need.
  select c.id into v_customer_id
  from public.customers as c
  where c.tenant_id = p_tenant_id and c.phone = v_phone
  order by c.is_active desc, c.created_at
  limit 1;

  if v_customer_id is null then
    insert into public.customers (tenant_id, name, phone)
    values (p_tenant_id, v_name, v_phone)
    returning id into v_customer_id;
  end if;

  -- --- The order ----------------------------------------------------------
  -- The per-tenant number is `max + 1` arbitrated by a unique index (Phase 13):
  -- two web orders in the same instant can collide, and the loser retries.
  for v_attempt in 1..3 loop
    begin
      insert into public.orders (tenant_id, location_id, customer_id, source, notes)
      values (p_tenant_id, v_location, v_customer_id, 'web', v_note)
      returning id, number into v_order_id, v_number;
      exit;
    exception when unique_violation then
      if v_attempt = 3 then
        raise;
      end if;
    end;
  end loop;

  -- --- Lines --------------------------------------------------------------
  for v_item in select value from jsonb_array_elements(v_items) loop
    v_position := v_position + 1;

    begin
      v_product_id := (v_item ->> 'productId')::uuid;
      v_variant_id := nullif(v_item ->> 'variantId', '')::uuid;
      v_option_ids := coalesce(
        (select array_agg(e::uuid) from jsonb_array_elements_text(coalesce(v_item -> 'optionIds', '[]'::jsonb)) as e),
        '{}'
      );
      v_quantity := (v_item ->> 'quantity')::integer;
    exception when others then
      raise exception 'INVALID_ORDER' using errcode = 'P0001';
    end;

    if v_product_id is null or v_quantity is null or v_quantity not between 1 and 99 then
      raise exception 'INVALID_ORDER' using errcode = 'P0001';
    end if;

    v_line_note := nullif(btrim(coalesce(v_item ->> 'notes', '')), '');
    if v_line_note is not null and char_length(v_line_note) > 200 then
      raise exception 'INVALID_ORDER' using errcode = 'P0001';
    end if;

    -- Draft, archived, sold out today, or somebody else's: none can be ordered.
    if not exists (
      select 1 from public.products as p
      where p.id = v_product_id
        and p.tenant_id = p_tenant_id
        and p.status = 'active'
        and p.is_available
    ) then
      raise exception 'PRODUCT_UNAVAILABLE' using errcode = 'P0001';
    end if;

    if v_variant_id is not null then
      if not exists (
        select 1 from public.product_variants as v
        where v.id = v_variant_id and v.product_id = v_product_id and v.is_active
      ) then
        raise exception 'PRODUCT_UNAVAILABLE' using errcode = 'P0001';
      end if;
    elsif exists (
      select 1 from public.product_variants as v
      where v.product_id = v_product_id and v.is_active
    ) then
      -- A product sold "por 5 / por 10" has no price of its own to charge.
      raise exception 'VARIANT_REQUIRED' using errcode = 'P0001';
    end if;

    begin
      insert into public.order_items (
        order_id, product_id, variant_id, option_ids, quantity, notes, position,
        name_snapshot, unit_price_cents
      )
      values (
        v_order_id, v_product_id, v_variant_id, v_option_ids, v_quantity, v_line_note,
        least(v_position, 1000),
        -- Placeholders the BEFORE trigger overwrites, exactly as the Phase 13
        -- action sends them.
        '-', 0
      );
    exception when check_violation then
      raise exception 'PRODUCT_UNAVAILABLE' using errcode = 'P0001';
    end;
  end loop;

  select o.subtotal_cents into v_subtotal from public.orders as o where o.id = v_order_id;

  if v_subtotal < v_store.min_order_cents then
    raise exception 'BELOW_MINIMUM' using errcode = 'P0001';
  end if;

  -- --- Delivery -----------------------------------------------------------
  if v_fulfillment = 'delivery' then
    begin
      v_zone_id := (p_order #>> '{delivery,zoneId}')::uuid;
    exception when others then
      raise exception 'INVALID_ZONE' using errcode = 'P0001';
    end;

    select z.name, z.fee_cents, z.min_order_free_cents
      into v_zone_name, v_fee, v_free_from
    from public.list_public_delivery_zones(p_tenant_id) as z
    where z.zone_id = v_zone_id;

    if v_zone_name is null then
      raise exception 'INVALID_ZONE' using errcode = 'P0001';
    end if;

    v_address := btrim(coalesce(p_order #>> '{delivery,address}', ''));
    v_district := nullif(btrim(coalesce(p_order #>> '{delivery,district}', '')), '');
    v_reference := nullif(btrim(coalesce(p_order #>> '{delivery,reference}', '')), '');

    if char_length(v_address) not between 1 and 300
       or coalesce(char_length(v_district), 0) > 100
       or coalesce(char_length(v_reference), 0) > 200 then
      raise exception 'INVALID_ADDRESS' using errcode = 'P0001';
    end if;

    if v_free_from is not null and v_subtotal >= v_free_from then
      v_fee := 0;
    end if;

    insert into public.order_deliveries (
      order_id, zone_id, zone_name_snapshot, fee_cents, address_line, district, reference,
      recipient_name, recipient_phone
    )
    values (
      v_order_id, v_zone_id, v_zone_name, v_fee, v_address, v_district, v_reference,
      v_name, v_phone
    );
  end if;

  -- --- Tracking token -----------------------------------------------------
  -- Two v4 UUIDs: 244 random bits, from the same generator every primary key
  -- in the schema already trusts, with no extension to depend on.
  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');

  insert into public.web_orders (
    order_id, tenant_id, access_token_hash, contact_name, contact_phone, fulfillment, payment_method_id
  )
  values (
    v_order_id, p_tenant_id, encode(sha256(convert_to(v_token, 'UTF8')), 'hex'),
    v_name, v_phone, v_fulfillment, v_payment_method
  );

  select o.total_cents into v_total from public.orders as o where o.id = v_order_id;

  order_id := v_order_id;
  order_number := v_number;
  access_token := v_token;
  total_cents := v_total;
  return next;
end;
$$;

comment on function public.place_web_order(uuid, jsonb) is
  'The only way an anonymous visitor creates an order. Validates everything against the tenant, prices nothing from the payload, writes atomically (ADR-033).';

revoke execute on function public.place_web_order(uuid, jsonb) from public;
grant execute on function public.place_web_order(uuid, jsonb) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- get_public_web_order
-- ---------------------------------------------------------------------------

-- What the tracking page shows. Tenant AND token: a valid token presented on
-- another business's hostname returns nothing (SPEC section 10).
--
-- No address, no phone, no customer id. The page proves "your order exists and
-- this is where it is", and a leaked link should reveal as little as possible.
create or replace function public.get_public_web_order(p_tenant_id uuid, p_token text)
returns table (
  order_number       integer,
  status             public.order_status,
  placed_at          timestamptz,
  fulfillment        text,
  contact_name       text,
  subtotal_cents     bigint,
  discount_cents     bigint,
  shipping_cents     bigint,
  total_cents        bigint,
  paid_cents         bigint,
  payment_method     text,
  payment_type       public.payment_method_type,
  payment_reference  text,
  delivery_status    public.delivery_status,
  zone_name          text,
  items              jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    o.number,
    o.status,
    o.placed_at,
    w.fulfillment,
    w.contact_name,
    o.subtotal_cents,
    o.discount_cents + o.promotion_discount_cents,
    o.shipping_cents,
    o.total_cents,
    o.paid_cents,
    pm.name,
    pm.type,
    pm.reference,
    d.status,
    d.zone_name_snapshot,
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'name', i.name_snapshot,
            'variant', i.variant_snapshot,
            'options', i.options_snapshot,
            'quantity', i.quantity,
            'total_cents', i.total_cents
          )
          order by i.position, i.created_at
        )
        from public.order_items as i
        where i.order_id = o.id
      ),
      '[]'::jsonb
    )
  from public.web_orders as w
  join public.orders as o on o.id = w.order_id
  left join public.payment_methods as pm on pm.id = w.payment_method_id
  left join public.order_deliveries as d on d.order_id = o.id
  where p_token ~ '^[0-9a-f]{64}$'
    and w.tenant_id = p_tenant_id
    and w.access_token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex')
    and public.is_tenant_public(p_tenant_id);
$$;

comment on function public.get_public_web_order(uuid, text) is
  'The tracking view of one web order, by tenant and secret token. Never returns address, phone or customer id.';

revoke execute on function public.get_public_web_order(uuid, text) from public;
grant execute on function public.get_public_web_order(uuid, text) to anon, authenticated;
