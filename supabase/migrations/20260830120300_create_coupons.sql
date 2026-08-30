-- Phase 20 - Loyalty + Promotions
-- The code that unlocks a promotion.
--
-- SPEC: docs/specs/phase-20-loyalty-promotions.md sections 8, 10, 11.
-- CLOVERCODE_MASTER.md section 33 (Phase 20).
--
-- A coupon is not a second kind of discount: it is a KEY to one. The discount
-- itself lives on the promotion, so "VERANO10" and "INSTAGRAM10" can be two
-- codes handed to two audiences that both open the same 10% - and the business
-- can then see which one actually got used, because each carries its own
-- counter.
--
-- Its limits are its own, deliberately. A coupon printed on a flyer expires
-- with the flyer; the promotion behind it may outlive it. The narrower of the
-- two wins at apply time, which is checked in `order_promotions`.

create table public.coupons (
  id              uuid        not null default gen_random_uuid(),
  -- Denormalised and maintained by a trigger, like every child table since
  -- Phase 11: without it every policy here would have to join `promotions` to
  -- learn whose row this is, and a policy that needs a join is both slower and
  -- harder to audit.
  tenant_id       uuid        not null,

  promotion_id    uuid        not null,

  code            text        not null,

  -- NULL means unlimited, for both. Independent of the promotion's own limits.
  max_redemptions integer,
  times_redeemed  integer     not null default 0,
  expires_at      timestamptz,

  is_active       boolean     not null default true,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint coupons_pkey primary key (id),

  constraint coupons_tenant_id_fkey
    foreign key (tenant_id) references public.tenants (id) on delete cascade,

  -- CASCADE: a code that opens nothing is not a coupon.
  constraint coupons_promotion_id_fkey
    foreign key (promotion_id) references public.promotions (id) on delete cascade,

  -- Three characters is the shortest thing anybody would print; forty is well
  -- past what a person will type at a till.
  constraint coupons_code_length
    check (char_length(btrim(code)) between 3 and 40),
  -- No spaces, and nothing a phone keyboard makes hard. A code is read aloud
  -- and typed under time pressure.
  constraint coupons_code_format
    check (btrim(code) ~ '^[A-Za-z0-9_-]+$'),

  constraint coupons_max_redemptions_positive
    check (max_redemptions is null or max_redemptions > 0),
  constraint coupons_times_redeemed_not_negative
    check (times_redeemed >= 0)
);

comment on table public.coupons is
  'A code that unlocks a promotion. Its own limits, narrower or wider than the promotion''s.';
comment on column public.coupons.times_redeemed is
  'Maintained by trigger from order_promotions. Never sent by a client.';

-- Unique per tenant, case-insensitively.
--
-- Upper rather than lower because a coupon is written in capitals on the
-- flyer, and this is the form the apply form normalises to before looking it
-- up - so the index is the one the lookup actually uses.
create unique index coupons_tenant_code_key
  on public.coupons (tenant_id, upper(btrim(code)));

create index coupons_promotion_idx
  on public.coupons (promotion_id);

create trigger coupons_set_updated_at
  before update on public.coupons
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- tenant_id comes from the parent, never from the client
-- ---------------------------------------------------------------------------

-- Both a convenience and a security control, exactly as
-- `sync_customer_address_tenant()` (Phase 12) explained and every child table
-- since has repeated: `tenant_id` is precisely the value an attacker would
-- supply, so it is not an input at all.
create or replace function public.derive_coupon_tenant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select p.tenant_id into new.tenant_id
  from public.promotions as p
  where p.id = new.promotion_id;

  if new.tenant_id is null then
    raise exception 'Promotion not found.' using errcode = 'P0002';
  end if;

  return new;
end;
$$;

comment on function public.derive_coupon_tenant() is
  'Derives tenant_id from the parent promotion so the two can never disagree.';

create trigger coupons_derive_tenant
  before insert or update of promotion_id on public.coupons
  for each row execute function public.derive_coupon_tenant();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.coupons enable row level security;

-- Governed by the PROMOTION's permissions, not by permissions of its own: a
-- coupon is part of a promotion, and whoever may see the promotion may see the
-- codes that open it. The same reasoning `delivery_rates` applied toward
-- `delivery_zones` in Phase 19.
create policy coupons_select_member
  on public.coupons for select to authenticated
  using (public.has_permission(tenant_id, 'promotions.view'));

create policy coupons_insert_manager
  on public.coupons for insert to authenticated
  with check (public.has_permission(tenant_id, 'promotions.manage'));

create policy coupons_update_manager
  on public.coupons for update to authenticated
  using (public.has_permission(tenant_id, 'promotions.manage'))
  with check (public.has_permission(tenant_id, 'promotions.manage'));

create policy coupons_delete_manager
  on public.coupons for delete to authenticated
  using (public.has_permission(tenant_id, 'promotions.manage'));
