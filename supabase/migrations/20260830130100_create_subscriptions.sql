-- Phase 21 - SaaS Modules + Plans
-- What each business has contracted, and its exceptions.
--
-- SPEC: docs/specs/phase-21-saas-modules-plans.md sections 8, 10, 11.
-- CLOVERCODE_MASTER.md sections 29, 33 (Phase 21).
-- ADR-025 decisions 2 and 4.
--
-- These are the two tenant-scoped tables of the phase, and they share an
-- asymmetry that is the whole point of a paywall: a tenant may READ what it
-- has contracted and may not WRITE it. Everything here is written by a
-- platform admin (master section 29), never by an owner.

create table public.subscriptions (
  id                   uuid                        not null default gen_random_uuid(),
  tenant_id            uuid                        not null,

  -- RESTRICT, not CASCADE: deleting a plan somebody has contracted must fail
  -- loudly rather than leave subscriptions pointing at nothing. In practice a
  -- plan is deactivated (`is_active = false`), which stops it being offered
  -- without touching who already has it.
  plan_code            text                        not null,

  status               public.subscription_status  not null default 'active',

  -- Written by hand and read by nobody automatically. Nothing expires a trial
  -- (KL-2103) because expiring one needs a scheduler no phase has built.
  trial_ends_at        timestamptz,
  current_period_start timestamptz                 not null default now(),
  current_period_end   timestamptz,
  cancelled_at         timestamptz,

  created_at           timestamptz                 not null default now(),
  updated_at           timestamptz                 not null default now(),

  constraint subscriptions_pkey primary key (id),

  constraint subscriptions_tenant_id_fkey
    foreign key (tenant_id) references public.tenants (id) on delete cascade,
  constraint subscriptions_plan_fkey
    foreign key (plan_code) references public.plans (code) on delete restrict,

  -- One per tenant. Two would mean "which plan does this business have?" has
  -- no single answer, and `has_module` would have to pick.
  constraint subscriptions_tenant_id_key unique (tenant_id),

  -- Cancelled and its timestamp are the same fact, in both directions - the
  -- shape `orders` has used since Phase 13.
  constraint subscriptions_cancelled_at
    check ((status = 'cancelled') = (cancelled_at is not null)),

  constraint subscriptions_period_ordered
    check (current_period_end is null or current_period_end > current_period_start)
);

comment on table public.subscriptions is
  'What a tenant has contracted. Readable by its members, writable only by a platform admin.';
comment on column public.subscriptions.status is
  'trialing/active/past_due grant access; suspended/cancelled do not (ADR-025 decision 3).';

-- "Who is on this plan" - the query that matters when a plan changes or is
-- retired.
create index subscriptions_plan_idx
  on public.subscriptions (plan_code);

create trigger subscriptions_set_updated_at
  before update on public.subscriptions
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- tenant_modules - the exceptions
-- ---------------------------------------------------------------------------

create table public.tenant_modules (
  tenant_id   uuid        not null,
  module_code text        not null,

  -- NOT NULL and with NO default, deliberately (ADR-025 decision 2): a row
  -- here is an explicit decision in one direction or the other. A nullable
  -- flag would introduce a third state - "there is an override but it does not
  -- say anything" - that `has_module` would have to interpret.
  is_enabled  boolean     not null,

  -- Why the exception was made. Not required, but the place to write "cortesia
  -- hasta marzo" so the next person does not have to guess.
  note        text,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint tenant_modules_pkey primary key (tenant_id, module_code),
  constraint tenant_modules_tenant_id_fkey
    foreign key (tenant_id) references public.tenants (id) on delete cascade,
  constraint tenant_modules_module_fkey
    foreign key (module_code) references public.modules (code) on delete cascade,

  constraint tenant_modules_note_length
    check (note is null or char_length(btrim(note)) <= 300)
);

comment on table public.tenant_modules is
  'Per-tenant module overrides. Beats the plan in BOTH directions (ADR-025 decision 2).';

create trigger tenant_modules_set_updated_at
  before update on public.tenant_modules
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Backfill, in the same migration that creates the table
-- ---------------------------------------------------------------------------

-- ADR-025 decision 4, and the reason nothing breaks the day this deploys.
--
-- `has_module()` (next migration) is fail-closed: no subscription means no
-- modules. So there must never exist an instant - not even one deployment -
-- in which a tenant that already had access is left without a row. Doing this
-- here rather than in a later migration is what guarantees that.
--
-- `on conflict do nothing` so re-running is a no-op rather than an error.
insert into public.subscriptions (tenant_id, plan_code)
select t.id, (select p.code from public.plans as p where p.is_default)
from public.tenants as t
on conflict (tenant_id) do nothing;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.subscriptions enable row level security;
alter table public.tenant_modules enable row level security;

-- A tenant reads what it has contracted. It needs this for UC-2104 ("¿que
-- estoy pagando?"), and reading it grants nothing.
--
-- Predicated on membership rather than on a permission, because there is no
-- permission for it and deliberately so (ADR-025 decision 6): every member can
-- see which modules their business has, the same way they can see the
-- navigation those modules produce.
create policy subscriptions_select_member
  on public.subscriptions for select to authenticated
  using (public.is_tenant_member(tenant_id) or public.is_platform_admin());

-- Writing is platform-admin only, in every direction. This is the asymmetry
-- that makes the paywall a paywall: an owner who could set their own status to
-- `active`, or their own plan to `enterprise`, would not be behind one.
create policy subscriptions_platform_insert
  on public.subscriptions for insert to authenticated
  with check (public.is_platform_admin());

create policy subscriptions_platform_update
  on public.subscriptions for update to authenticated
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

-- No DELETE policy. A subscription is cancelled, not erased: `cancelled` is
-- how a business stops being served without pretending it was never a client.

create policy tenant_modules_select_member
  on public.tenant_modules for select to authenticated
  using (public.is_tenant_member(tenant_id) or public.is_platform_admin());

create policy tenant_modules_platform_insert
  on public.tenant_modules for insert to authenticated
  with check (public.is_platform_admin());

create policy tenant_modules_platform_update
  on public.tenant_modules for update to authenticated
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

-- DELETE exists here, unlike on subscriptions: removing an override means
-- "go back to whatever the plan says", which is a real and reversible
-- operation rather than the loss of a record.
create policy tenant_modules_platform_delete
  on public.tenant_modules for delete to authenticated
  using (public.is_platform_admin());
