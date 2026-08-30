-- Phase 21 - SaaS Modules + Plans
-- What CloverCode sells, and what each thing includes.
--
-- SPEC: docs/specs/phase-21-saas-modules-plans.md sections 8, 10, 11.
-- CLOVERCODE_MASTER.md section 33 (Phase 21).
--
-- Three catalogue tables with NO tenant_id, deliberately: this is the shape of
-- the PRODUCT, not of any business. The same nature as roles/permissions/
-- role_permissions (Phase 03) and the transition tables (Phases 13, 17, 19),
-- and they get the same read-only `using (true)` treatment for exactly the
-- reason master section 10 allows: they hold no tenant data at all.

create type public.plan_interval as enum ('monthly', 'yearly');

comment on type public.plan_interval is
  'How often a plan is charged. Read by Phase 22; nothing here charges anybody.';

-- Five states a subscription can be in.
--
-- `past_due` is the one worth explaining: it GRANTS access (ADR-025 decision
-- 3). Cutting a restaurant off the moment a card fails is cutting off its till
-- mid-service for a problem at the bank. `past_due` is a signal to go and
-- collect, not a switch; a person moves it to `suspended` when it is time.
create type public.subscription_status as enum (
  'trialing',
  'active',
  'past_due',
  'suspended',
  'cancelled'
);

comment on type public.subscription_status is
  'trialing/active/past_due grant access; suspended/cancelled do not (ADR-025).';

-- ---------------------------------------------------------------------------
-- modules
-- ---------------------------------------------------------------------------

create table public.modules (
  code        text        not null,
  name        text        not null,
  description text,
  position    smallint    not null default 0,
  created_at  timestamptz not null default now(),

  constraint modules_pkey primary key (code),
  -- Same format as `permissions.code` (Phase 03): a stable identifier that
  -- appears in code, not a label somebody will want to translate.
  constraint modules_code_format check (code ~ '^[a-z_]+$'),
  constraint modules_name_not_blank check (char_length(btrim(name)) between 1 and 60)
);

comment on table public.modules is
  'The capabilities CloverCode can sell. Global to the product, not per tenant.';

-- Loaded by MIGRATION, not by `supabase/seed.sql`, for the reason Phase 03
-- gave: `seed.sql` does not run on `db push` to a deployed project, and
-- reference data that `has_module()` depends on is part of the schema. A
-- missing catalogue would leave every deployed tenant with no modules at all.
--
-- These are the ten codes master section 33 enumerates, in the order it
-- enumerates them.
insert into public.modules (code, name, description, position) values
  ('website',        'Sitio web',           'Paginas, secciones y navegacion del sitio publico.',       10),
  ('catalog',        'Catalogo',            'Categorias, productos, variantes y opciones.',             20),
  ('orders',         'Pedidos',             'Pedidos, cocina, pagos y caja.',                           30),
  ('pos',            'Punto de venta',      'Venta de mostrador en tablet o escritorio.',               40),
  ('inventory',      'Inventario',          'Insumos, compras, recetas y movimientos de stock.',        50),
  ('billing',        'Facturacion',         'Comprobantes electronicos y su proveedor.',                60),
  ('delivery',       'Delivery',            'Zonas, tarifas y entregas de pedidos.',                    70),
  ('loyalty',        'Fidelizacion',        'Promociones, cupones y puntos de clientes.',               80),
  ('multi_location', 'Multi-sede',          'Mas de una sede activa para el mismo negocio.',            90),
  ('reports',        'Reportes',            'Analitica de ventas y operacion.',                        100);

-- ---------------------------------------------------------------------------
-- plans
-- ---------------------------------------------------------------------------

create table public.plans (
  code        text                 not null,
  name        text                 not null,
  description text,
  -- Minor units (ADR-015). Nothing in this phase reads it: it exists so Phase
  -- 22 has somewhere to read the price FROM, rather than inventing the column
  -- later and backfilling it.
  price_cents bigint               not null default 0,
  interval    public.plan_interval not null default 'monthly',
  is_active   boolean              not null default true,
  -- Exactly one, enforced by the partial unique index below.
  is_default  boolean              not null default false,
  position    smallint             not null default 0,
  created_at  timestamptz          not null default now(),

  constraint plans_pkey primary key (code),
  constraint plans_code_format check (code ~ '^[a-z_]+$'),
  constraint plans_name_not_blank check (char_length(btrim(name)) between 1 and 60),
  constraint plans_price_range check (price_cents between 0 and 10000000000)
);

comment on table public.plans is
  'What CloverCode sells. price_cents is read by Phase 22; nothing here charges.';
comment on column public.plans.is_default is
  'The plan a new tenant is provisioned onto. Exactly one row may be true.';

-- Exactly one default. Without this, provisioning would have to pick between
-- two rows and "which plan does a new tenant get" would have no answer.
create unique index plans_single_default_key
  on public.plans (is_default)
  where is_default;

insert into public.plans (code, name, description, price_cents, is_active, is_default, position) values
  ('starter',
   'Starter',
   'Sitio web, catalogo y pedidos. Para empezar a vender.',
   9900, true, false, 10),
  ('professional',
   'Professional',
   'Todo lo de Starter, mas punto de venta, delivery, fidelizacion y reportes.',
   19900, true, false, 20),
  ('enterprise',
   'Enterprise',
   'Todo CloverCode: inventario, facturacion electronica y multi-sede.',
   39900, true, true, 30);

-- Why `enterprise` is the DEFAULT, which is commercially backwards.
--
-- ADR-025 decision 4: CloverCode does not charge anybody yet - that is Phase
-- 22 - and twenty phases shipped with every capability switched on. Making a
-- migration hand out `starter` would take the POS and electronic invoicing
-- away from businesses that are using them today, without anybody having sold
-- or charged them a smaller plan. That is a commercial decision, and a
-- migration is not the place to take it.
--
-- When Phase 22 starts charging, moving `is_default` is one row.

-- ---------------------------------------------------------------------------
-- plan_modules
-- ---------------------------------------------------------------------------

create table public.plan_modules (
  plan_code   text not null,
  module_code text not null,

  constraint plan_modules_pkey primary key (plan_code, module_code),
  constraint plan_modules_plan_fkey
    foreign key (plan_code) references public.plans (code) on delete cascade,
  constraint plan_modules_module_fkey
    foreign key (module_code) references public.modules (code) on delete cascade
);

comment on table public.plan_modules is
  'Which modules a plan includes. The PK serves lookups by plan.';

-- Answers "which plans include this module", used when retiring one.
create index plan_modules_module_idx
  on public.plan_modules (module_code);

insert into public.plan_modules (plan_code, module_code) values
  ('starter', 'website'),
  ('starter', 'catalog'),
  ('starter', 'orders'),

  ('professional', 'website'),
  ('professional', 'catalog'),
  ('professional', 'orders'),
  ('professional', 'pos'),
  ('professional', 'delivery'),
  ('professional', 'loyalty'),
  ('professional', 'reports');

-- enterprise: everything, by construction rather than by a list somebody has
-- to remember to extend. A module added in a later phase joins this plan
-- automatically only if that phase inserts the row; stated as a select so at
-- least today's ten are complete without being retyped.
insert into public.plan_modules (plan_code, module_code)
select 'enterprise', code from public.modules;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.modules enable row level security;
alter table public.plans enable row level security;
alter table public.plan_modules enable row level security;

-- `using (true)` here does NOT contradict master section 10, which forbids it
-- on tables holding private data. These three hold no tenant data at all: they
-- are the product's price list, as public as its marketing page. A signed-in
-- user needs to read them to render "what your plan includes".
--
-- Read-only: no INSERT/UPDATE/DELETE policy exists, so the catalogue can only
-- change in a migration. Exactly the posture Phase 03 took toward
-- roles/permissions/role_permissions, and Phases 13/17/19 toward their
-- transition tables.
create policy modules_select_authenticated
  on public.modules for select to authenticated using (true);

create policy plans_select_authenticated
  on public.plans for select to authenticated using (true);

create policy plan_modules_select_authenticated
  on public.plan_modules for select to authenticated using (true);
