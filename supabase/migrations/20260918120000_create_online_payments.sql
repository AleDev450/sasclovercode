-- Phase 31 - Pagos online por plan
-- A restaurant's website charging a card, Yape or a wallet through a payment
-- gateway the PLATFORM configured for it.
--
-- SPEC: docs/specs/phase-31-online-payments.md sections 6, 8, 10, 11.
-- ADR-034: gateway chosen by the platform, credentials in Vault, confirmation
-- only from the provider.
--
-- The commercial rule this encodes, in the owner's words: the basic plan takes
-- Yape and Plin by hand; from the next plan up, CloverCode enables an online
-- gateway - Culqi, Izipay or Mercado Pago - and configures it from the super
-- admin. So:
--
--   * A module, `online_payments`, in Professional and Enterprise, not Starter.
--   * One gateway row per business, written only by a platform admin.
--   * The secret credentials in Vault, readable only by `service_role` - the
--     one function in the schema that returns a secret, because charging a card
--     is impossible without the key (ADR-021 had no such need).
--   * A payment is recorded only by `record_online_payment`, executable only by
--     `service_role`, called by the server after the PROVIDER confirmed it.
--     Nothing a browser sends can mark an order paid.

-- ---------------------------------------------------------------------------
-- The module
-- ---------------------------------------------------------------------------

insert into public.modules (code, name, description, position) values
  ('online_payments', 'Pagos online', 'Cobro con tarjeta, Yape y billeteras por pasarela en la web.', 110);

insert into public.plan_modules (plan_code, module_code) values
  ('professional', 'online_payments'),
  ('enterprise', 'online_payments');

-- ---------------------------------------------------------------------------
-- tenant_payment_gateways
-- ---------------------------------------------------------------------------

create type public.payment_gateway_provider as enum ('culqi', 'izipay', 'mercadopago');
create type public.payment_gateway_mode as enum ('test', 'live');

create table public.tenant_payment_gateways (
  tenant_id              uuid                            not null,
  provider               public.payment_gateway_provider not null,
  mode                   public.payment_gateway_mode     not null default 'test',
  -- Publishable by design: Culqi's `pk_...`, Izipay's public key. The browser
  -- needs it to open the provider's form.
  public_key             text,
  -- A Vault secret id holding the provider's secret credentials as JSON. Never
  -- the credential itself.
  credentials_secret_id  uuid,
  credentials_updated_at timestamptz,
  -- The payment method payments are recorded under ("Pago online - Culqi").
  payment_method_id      uuid                            not null,
  is_enabled             boolean                         not null default false,
  configured_by          uuid,
  created_at             timestamptz                     not null default now(),
  updated_at             timestamptz                     not null default now(),

  constraint tenant_payment_gateways_pkey primary key (tenant_id),
  constraint tenant_payment_gateways_tenant_id_fkey
    foreign key (tenant_id) references public.tenants (id) on delete cascade,
  constraint tenant_payment_gateways_payment_method_id_fkey
    foreign key (payment_method_id) references public.payment_methods (id) on delete restrict,
  constraint tenant_payment_gateways_configured_by_fkey
    foreign key (configured_by) references auth.users (id) on delete set null,
  constraint tenant_payment_gateways_public_key_length
    check (public_key is null or char_length(btrim(public_key)) between 8 and 300),
  -- Enabled means usable: a gateway with no secret cannot charge anything.
  constraint tenant_payment_gateways_enabled_needs_credentials
    check (not is_enabled or credentials_secret_id is not null)
);

comment on table public.tenant_payment_gateways is
  'The online payment gateway the platform configured for a tenant (Phase 31). Written only by platform admins.';
comment on column public.tenant_payment_gateways.credentials_secret_id is
  'Vault secret id. Read only by get_payment_gateway_credentials(), executable by service_role alone.';

create trigger tenant_payment_gateways_set_updated_at
  before update on public.tenant_payment_gateways
  for each row execute function public.set_updated_at();

alter table public.tenant_payment_gateways enable row level security;

-- A member sees WHICH gateway the business has and whether it is on - the
-- dashboard says so - and there is nothing secret in the row to see.
create policy tenant_payment_gateways_select_member
  on public.tenant_payment_gateways for select to authenticated
  using (public.is_tenant_member(tenant_id) or public.is_platform_admin());

-- No write policy for anyone: the functions below, gated on the platform admin,
-- are the only writers.

-- Whether a website may offer online payment right now: the plan includes the
-- module, the platform enabled a gateway, and it has credentials.
create or replace function public.online_payments_available(p_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.tenant_payment_gateways as g
    join public.payment_methods as pm on pm.id = g.payment_method_id
    where g.tenant_id = p_tenant_id
      and g.is_enabled
      and g.credentials_secret_id is not null
      and pm.is_active
  )
  and public.has_module(p_tenant_id, 'online_payments')
  and public.is_tenant_public(p_tenant_id);
$$;

revoke execute on function public.online_payments_available(uuid) from public;
grant execute on function public.online_payments_available(uuid) to anon, authenticated;

-- What the checkout needs to open the provider's form. No secret.
create or replace function public.get_public_payment_gateway(p_tenant_id uuid)
returns table (
  provider   public.payment_gateway_provider,
  mode       public.payment_gateway_mode,
  public_key text
)
language sql
stable
security definer
set search_path = ''
as $$
  select g.provider, g.mode, g.public_key
  from public.tenant_payment_gateways as g
  where g.tenant_id = p_tenant_id
    and public.online_payments_available(p_tenant_id);
$$;

revoke execute on function public.get_public_payment_gateway(uuid) from public;
grant execute on function public.get_public_payment_gateway(uuid) to anon, authenticated;

-- Configure, rotate or switch a tenant's gateway. Platform admins only.
--
-- `p_credentials` NULL keeps the stored secret (changing the mode or the public
-- key must not force re-typing the secret key); a value replaces it. Switching
-- PROVIDER requires new credentials: a Culqi secret is useless to Mercado Pago.
create or replace function public.set_payment_gateway(
  p_tenant_id   uuid,
  p_provider    public.payment_gateway_provider,
  p_mode        public.payment_gateway_mode,
  p_public_key  text,
  p_credentials text,
  p_enabled     boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing     public.tenant_payment_gateways%rowtype;
  v_found        boolean;
  v_secret_id    uuid;
  v_method_id    uuid;
  v_method_name  text;
  v_new_secret   text := nullif(btrim(coalesce(p_credentials, '')), '');
begin
  if not public.is_platform_admin() then
    raise exception 'Only a platform admin can configure a payment gateway.' using errcode = '42501';
  end if;

  select * into v_existing from public.tenant_payment_gateways where tenant_id = p_tenant_id;
  v_found := found;

  if v_found and v_existing.provider <> p_provider and v_new_secret is null then
    raise exception 'Switching provider needs that provider''s credentials.' using errcode = '23514';
  end if;

  v_method_name := 'Pago online - ' || case p_provider
    when 'culqi' then 'Culqi'
    when 'izipay' then 'Izipay'
    else 'Mercado Pago'
  end;

  -- The method payments are recorded under. Reused by name, reactivated if a
  -- person switched it off, never duplicated.
  select pm.id into v_method_id
  from public.payment_methods as pm
  where pm.tenant_id = p_tenant_id and lower(btrim(pm.name)) = lower(v_method_name);

  if v_method_id is null then
    insert into public.payment_methods (tenant_id, type, name, show_on_website)
    values (p_tenant_id, 'card', v_method_name, false)
    returning id into v_method_id;
  else
    update public.payment_methods set is_active = true where id = v_method_id;
  end if;

  v_secret_id := case when v_found then v_existing.credentials_secret_id end;

  if v_new_secret is not null then
    if v_secret_id is not null then
      perform vault.update_secret(v_secret_id, v_new_secret);
    else
      v_secret_id := vault.create_secret(
        v_new_secret,
        'payment_gateway:' || p_tenant_id::text,
        'CloverCode online payment gateway credentials'
      );
    end if;
  end if;

  insert into public.tenant_payment_gateways (
    tenant_id, provider, mode, public_key, credentials_secret_id, credentials_updated_at,
    payment_method_id, is_enabled, configured_by
  )
  values (
    p_tenant_id, p_provider, p_mode, nullif(btrim(coalesce(p_public_key, '')), ''), v_secret_id,
    case when v_new_secret is not null then now() end,
    v_method_id, p_enabled, auth.uid()
  )
  on conflict (tenant_id) do update set
    provider = excluded.provider,
    mode = excluded.mode,
    public_key = excluded.public_key,
    credentials_secret_id = excluded.credentials_secret_id,
    credentials_updated_at = coalesce(
      excluded.credentials_updated_at,
      public.tenant_payment_gateways.credentials_updated_at
    ),
    payment_method_id = excluded.payment_method_id,
    is_enabled = excluded.is_enabled,
    configured_by = excluded.configured_by;
end;
$$;

revoke execute on function public.set_payment_gateway(
  uuid, public.payment_gateway_provider, public.payment_gateway_mode, text, text, boolean
) from public;
grant execute on function public.set_payment_gateway(
  uuid, public.payment_gateway_provider, public.payment_gateway_mode, text, text, boolean
) to authenticated;

-- Remove a tenant's gateway and its secret. The payment method stays (payments
-- already point at it) but is switched off.
create or replace function public.clear_payment_gateway(p_tenant_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_method uuid;
  v_secret uuid;
begin
  if not public.is_platform_admin() then
    raise exception 'Only a platform admin can remove a payment gateway.' using errcode = '42501';
  end if;

  delete from public.tenant_payment_gateways as g
  where g.tenant_id = p_tenant_id
  returning g.payment_method_id, g.credentials_secret_id into v_method, v_secret;

  if v_method is not null then
    update public.payment_methods set is_active = false where id = v_method;
  end if;
  if v_secret is not null then
    delete from vault.secrets where id = v_secret;
  end if;
end;
$$;

revoke execute on function public.clear_payment_gateway(uuid) from public;
grant execute on function public.clear_payment_gateway(uuid) to authenticated;

-- THE ONE FUNCTION THAT RETURNS A SECRET.
--
-- Executable by `service_role` only: not `anon`, not `authenticated`, not a
-- platform admin's session. The server calls it with the secret key, at the
-- moment it has to talk to the provider, and the value never leaves the server.
create or replace function public.get_payment_gateway_credentials(p_tenant_id uuid)
returns table (
  provider          public.payment_gateway_provider,
  mode              public.payment_gateway_mode,
  public_key        text,
  credentials       text,
  payment_method_id uuid,
  is_enabled        boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return query
    select g.provider, g.mode, g.public_key, s.decrypted_secret, g.payment_method_id, g.is_enabled
    from public.tenant_payment_gateways as g
    left join vault.decrypted_secrets as s on s.id = g.credentials_secret_id
    where g.tenant_id = p_tenant_id;
end;
$$;

revoke execute on function public.get_payment_gateway_credentials(uuid) from public;
revoke execute on function public.get_payment_gateway_credentials(uuid) from anon, authenticated;
grant execute on function public.get_payment_gateway_credentials(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- The web order learns how it is being paid
-- ---------------------------------------------------------------------------

alter table public.web_orders
  add column pay_online boolean not null default false,
  add column online_payment_status text not null default 'none',
  add column provider_reference text;

alter table public.web_orders
  add constraint web_orders_online_payment_status_allowed
    check (online_payment_status in ('none', 'pending', 'approved', 'rejected')),
  add constraint web_orders_online_status_matches
    check (pay_online = (online_payment_status <> 'none')),
  add constraint web_orders_provider_reference_length
    check (provider_reference is null or char_length(provider_reference) between 1 and 200);

comment on column public.web_orders.online_payment_status is
  'none for manual payment; pending -> approved/rejected, moved only by record_online_payment() (Phase 31).';

-- place_web_order, as Phase 29 wrote it, plus `payOnline`.
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
  v_pay_online     boolean;
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
  -- Phase 31: paying online through the gateway the platform configured. It
  -- replaces choosing a manual method, and needs the module AND a configured,
  -- enabled gateway - a checkbox in a form cannot sell either.
  begin
    v_pay_online := coalesce((p_order ->> 'payOnline')::boolean, false);
  exception when others then
    raise exception 'INVALID_ORDER' using errcode = 'P0001';
  end;

  if v_pay_online then
    if not public.online_payments_available(p_tenant_id) then
      raise exception 'ONLINE_PAYMENT_UNAVAILABLE' using errcode = 'P0001';
    end if;
    v_payment_method := null;
  elsif nullif(btrim(coalesce(p_order ->> 'paymentMethodId', '')), '') is not null then
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
  ) or public.online_payments_available(p_tenant_id) then
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
    order_id, tenant_id, access_token_hash, contact_name, contact_phone, fulfillment,
    payment_method_id, pay_online, online_payment_status
  )
  values (
    v_order_id, p_tenant_id, encode(sha256(convert_to(v_token, 'UTF8')), 'hex'),
    v_name, v_phone, v_fulfillment, v_payment_method,
    v_pay_online, case when v_pay_online then 'pending' else 'none' end
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

-- get_public_web_order gains the online payment state. Its return type changes,
-- which `create or replace` cannot do, so it is dropped first; the grants are
-- restated with the new definition.
drop function public.get_public_web_order(uuid, text);

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
  items              jsonb,
  pay_online         boolean,
  online_payment_status text
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
    ),
    w.pay_online,
    w.online_payment_status
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

-- ---------------------------------------------------------------------------
-- record_online_payment
-- ---------------------------------------------------------------------------

-- Records what the PROVIDER confirmed. Called by the server - from a webhook it
-- verified against the provider, or right after a synchronous charge - with the
-- service key.
--
-- Idempotent: providers retry notifications, and the same approved payment
-- arriving three times is one payment. The order's own balance cap (Phase 14)
-- is the second guarantee: an approval can never pay more than is owed.
create or replace function public.record_online_payment(
  p_tenant_id          uuid,
  p_order_id           uuid,
  p_provider_reference text,
  p_amount_cents       bigint,
  p_approved           boolean
)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_web      public.web_orders%rowtype;
  v_method   uuid;
  v_balance  bigint;
  v_status   public.order_status;
begin
  select * into v_web
  from public.web_orders as w
  where w.order_id = p_order_id and w.tenant_id = p_tenant_id
  for update;

  if not found or not v_web.pay_online then
    return 'unknown_order';
  end if;

  if v_web.online_payment_status = 'approved' then
    return 'already_recorded';
  end if;

  if not p_approved then
    update public.web_orders as w
    set online_payment_status = 'rejected', provider_reference = left(p_provider_reference, 200)
    where w.order_id = p_order_id;
    return 'rejected';
  end if;

  select g.payment_method_id into v_method
  from public.tenant_payment_gateways as g
  where g.tenant_id = p_tenant_id;

  select o.total_cents - o.paid_cents, o.status into v_balance, v_status
  from public.orders as o
  where o.id = p_order_id;

  if v_method is null or v_status = 'cancelled' then
    -- The money moved but there is nowhere valid to put it: an order cancelled
    -- in the meantime, or a gateway removed. Marked approved so the dashboard
    -- shows it, and reported so a person refunds it.
    update public.web_orders as w
    set online_payment_status = 'approved', provider_reference = left(p_provider_reference, 200)
    where w.order_id = p_order_id;
    return 'needs_attention';
  end if;

  if least(p_amount_cents, v_balance) > 0 then
    insert into public.payments (order_id, tenant_id, payment_method_id, amount_cents, reference, notes)
    values (
      p_order_id, p_tenant_id, v_method, least(p_amount_cents, v_balance),
      left(p_provider_reference, 120),
      case when p_amount_cents <> v_balance
        then 'Pasarela: ' || p_amount_cents || ' centimos, saldo ' || v_balance
      end
    );
  end if;

  update public.web_orders as w
  set online_payment_status = 'approved', provider_reference = left(p_provider_reference, 200)
  where w.order_id = p_order_id;

  return 'recorded';
end;
$$;

comment on function public.record_online_payment(uuid, uuid, text, bigint, boolean) is
  'Records a provider-confirmed online payment against a web order. service_role only; idempotent (ADR-034).';

revoke execute on function public.record_online_payment(uuid, uuid, text, bigint, boolean) from public;
revoke execute on function public.record_online_payment(uuid, uuid, text, bigint, boolean)
  from anon, authenticated;
grant execute on function public.record_online_payment(uuid, uuid, text, bigint, boolean)
  to service_role;

-- What the server needs to START a payment for a tracking token: the order id
-- the provider will carry back, and how much is owed. No personal data beyond
-- the name the tracking page already shows.
create or replace function public.get_web_order_for_payment(p_tenant_id uuid, p_token text)
returns table (
  order_id              uuid,
  order_number          integer,
  balance_cents         bigint,
  contact_name          text,
  online_payment_status text,
  status                public.order_status
)
language sql
stable
security definer
set search_path = ''
as $$
  select o.id, o.number, o.total_cents - o.paid_cents, w.contact_name, w.online_payment_status, o.status
  from public.web_orders as w
  join public.orders as o on o.id = w.order_id
  where p_token ~ '^[0-9a-f]{64}$'
    and w.tenant_id = p_tenant_id
    and w.pay_online
    and w.access_token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex')
    and public.is_tenant_public(p_tenant_id);
$$;

revoke execute on function public.get_web_order_for_payment(uuid, text) from public;
grant execute on function public.get_web_order_for_payment(uuid, text) to anon, authenticated;
