-- Phase 20 - Loyalty + Promotions
-- The rule that takes money off a bill.
--
-- SPEC: docs/specs/phase-20-loyalty-promotions.md sections 8, 10, 11.
-- CLOVERCODE_MASTER.md sections 33 (Phase 20), 39.
-- ADR-024 decision 5.
--
-- A promotion is a discount WITH CONDITIONS, not a rules engine. It knows how
-- much to take off, from what minimum, between which dates and how many times
-- in total. It does not know about products, combos or mutual exclusions -
-- ADR-024 decision 5 carries the argument for stopping here.
--
-- Every money column is an integer in the minor unit (ADR-015).

create table public.promotions (
  id               uuid                  not null default gen_random_uuid(),
  tenant_id        uuid                  not null,

  name             text                  not null,
  description      text,

  type             public.promotion_type not null,

  -- Exactly one of these carries the value, decided by `type`. Two nullable
  -- columns rather than one polymorphic `value numeric`, because a percentage
  -- and an amount of money are not the same kind of number: one is 1..100 and
  -- the other is minor units up to ten billion, and a single column could not
  -- state either range.
  percent_off      smallint,
  amount_off_cents bigint,

  -- "Desde S/ 50". Zero means no minimum, which is why it is NOT NULL - a
  -- minimum of nothing and an absent minimum are the same rule, and having two
  -- ways to write it is two ways to get the comparison wrong.
  min_order_cents  bigint                not null default 0,

  -- Both nullable: a promotion with no dates is always live. That is the
  -- common case for "10% para clientes frecuentes" and forcing a date on it
  -- would mean inventing one.
  starts_at        timestamptz,
  ends_at          timestamptz,

  -- NULL means unlimited.
  max_redemptions  integer,
  -- Maintained by trigger from `order_promotions`, never written by the
  -- application (ADR-024 decision 1). Counting redemptions with a `count()` on
  -- every coupon validation would be a scan per checkout.
  times_redeemed   integer               not null default 0,

  is_active        boolean               not null default true,

  created_at       timestamptz           not null default now(),
  updated_at       timestamptz           not null default now(),

  constraint promotions_pkey primary key (id),
  constraint promotions_tenant_id_fkey
    foreign key (tenant_id) references public.tenants (id) on delete cascade,

  constraint promotions_name_length
    check (char_length(btrim(name)) between 1 and 120),
  constraint promotions_description_length
    check (coalesce(char_length(description), 0) <= 300),

  -- The value column and the type agree, in both directions. Stated as an
  -- equivalence so a `percentage` cannot carry an amount, and an amount cannot
  -- be left on a promotion that was switched to `free_delivery`.
  constraint promotions_percent_matches_type
    check ((type = 'percentage') = (percent_off is not null)),
  constraint promotions_amount_matches_type
    check ((type = 'fixed_amount') = (amount_off_cents is not null)),

  constraint promotions_percent_range
    check (percent_off is null or percent_off between 1 and 100),
  constraint promotions_amount_range
    check (amount_off_cents is null or amount_off_cents between 1 and 10000000000),
  constraint promotions_min_order_range
    check (min_order_cents between 0 and 10000000000),

  constraint promotions_max_redemptions_positive
    check (max_redemptions is null or max_redemptions > 0),
  constraint promotions_times_redeemed_not_negative
    check (times_redeemed >= 0),

  -- A window that ends before it starts is not a window. Only checked when
  -- both ends exist: "hasta el 30" with no start is a real thing to write.
  constraint promotions_window_ordered
    check (ends_at is null or starts_at is null or ends_at > starts_at)
);

comment on table public.promotions is
  'A discount with conditions. Not a rules engine (ADR-024 decision 5).';
comment on column public.promotions.times_redeemed is
  'Maintained by trigger from order_promotions. Never sent by a client.';
comment on column public.promotions.min_order_cents is
  'Minor units (ADR-015). Zero means no minimum.';

-- Unique per tenant and case-insensitive, the same shape `locations` (Phase
-- 10) and `delivery_zones` (Phase 19) use: two promotions called "Verano" and
-- "VERANO" are one promotion to every person reading the list.
create unique index promotions_tenant_name_key
  on public.promotions (tenant_id, lower(btrim(name)));

-- "What can I offer right now" - the query the apply form runs.
create index promotions_tenant_active_idx
  on public.promotions (tenant_id, is_active);

create trigger promotions_set_updated_at
  before update on public.promotions
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.promotions enable row level security;

create policy promotions_select_member
  on public.promotions for select to authenticated
  using (public.has_permission(tenant_id, 'promotions.view'));

-- No `anon` policy. The public site has no checkout yet; when it does, what a
-- visitor may see of the price rules is a decision for that phase to make
-- deliberately rather than something inherited by accident.

create policy promotions_insert_manager
  on public.promotions for insert to authenticated
  with check (public.has_permission(tenant_id, 'promotions.manage'));

create policy promotions_update_manager
  on public.promotions for update to authenticated
  using (public.has_permission(tenant_id, 'promotions.manage'))
  with check (public.has_permission(tenant_id, 'promotions.manage'));

-- A promotion CAN be deleted, like a delivery zone and unlike an order: it is
-- configuration. Nothing is lost when it goes, because `order_promotions`
-- keeps `label_snapshot` and its own `discount_cents` - past bills still say
-- what they said.
create policy promotions_delete_manager
  on public.promotions for delete to authenticated
  using (public.has_permission(tenant_id, 'promotions.manage'));
