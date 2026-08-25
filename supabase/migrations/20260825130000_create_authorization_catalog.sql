-- Phase 03 - Authorization + RLS
-- The role/permission catalogue that RBAC resolves against.
--
-- SPEC: docs/specs/phase-03-authorization-rls.md sections 8, 20.
-- CLOVERCODE_MASTER.md sections 12, 33 (Phase 3).

-- ---------------------------------------------------------------------------
-- roles
-- ---------------------------------------------------------------------------

-- Keyed by the `tenant_role` enum created in Phase 02, not by free text. A role
-- that is not in the enum is impossible by type rather than by convention, and
-- `tenant_members.role` keeps pointing at the same enum - so this table is
-- added without a destructive migration. This resolves KL-209 of Phase 02.
create table public.roles (
  code        public.tenant_role not null,
  label       text               not null,
  description text,
  -- 0 is the highest authority. Lets the UI order roles, and lets a future
  -- "cannot manage someone above you" rule be expressed without naming roles.
  rank        smallint           not null,
  created_at  timestamptz        not null default now(),

  constraint roles_pkey primary key (code),
  constraint roles_label_not_blank check (char_length(btrim(label)) between 1 and 60),
  constraint roles_rank_range check (rank between 0 and 100)
);

comment on table public.roles is
  'System role catalogue. Global to the product, not per tenant.';

-- ---------------------------------------------------------------------------
-- permissions
-- ---------------------------------------------------------------------------

create table public.permissions (
  code        text        not null,
  resource    text        not null,
  action      text        not null,
  description text,
  created_at  timestamptz not null default now(),

  constraint permissions_pkey primary key (code),
  constraint permissions_code_format check (code ~ '^[a-z_]+\.[a-z_]+$'),
  -- The code is derived from its parts, so the two can never disagree.
  constraint permissions_code_matches_parts check (code = resource || '.' || action)
);

comment on table public.permissions is
  'Capability catalogue. Adding a permission is a migration row, not a code change.';

-- ---------------------------------------------------------------------------
-- role_permissions
-- ---------------------------------------------------------------------------

create table public.role_permissions (
  role       public.tenant_role not null,
  permission text               not null,

  constraint role_permissions_pkey primary key (role, permission),
  constraint role_permissions_role_fkey
    foreign key (role) references public.roles (code) on delete cascade,
  constraint role_permissions_permission_fkey
    foreign key (permission) references public.permissions (code) on delete cascade
);

comment on table public.role_permissions is
  'Which role grants which permission. The PK serves lookups by role.';

-- Answers "which roles grant this permission", used when auditing a permission.
create index role_permissions_permission_idx
  on public.role_permissions (permission);

-- ---------------------------------------------------------------------------
-- Catalogue data
-- ---------------------------------------------------------------------------

-- Loaded by MIGRATION, not by `supabase/seed.sql`, deliberately departing from
-- master section 23.
--
-- `seed.sql` runs on a local `db reset` but NOT on `db push` to a deployed
-- project. A missing catalogue would make `has_permission()` return false for
-- everything, so every deployed environment would be locked out. Reference data
-- that RLS depends on is part of the schema, not sample data.

insert into public.roles (code, label, description, rank) values
  ('owner',      'Propietario',  'Control total del negocio, incluida su configuracion.', 0),
  ('admin',      'Administrador','Gestiona la operacion diaria completa.',                10),
  ('manager',    'Encargado',    'Supervisa operacion, catalogo y reportes.',             20),
  ('cashier',    'Cajero',       'Atiende pedidos, cobra y gestiona caja.',               30),
  ('waiter',     'Mesero',       'Toma y actualiza pedidos.',                             40),
  ('kitchen',    'Cocina',       'Consulta y avanza el estado de los pedidos.',           50),
  ('delivery',   'Repartidor',   'Gestiona las entregas asignadas.',                      60),
  ('accountant', 'Contador',     'Consulta reportes y documentos de facturacion.',        70);

insert into public.permissions (code, resource, action, description) values
  ('products.view',     'products',  'view',    'Ver el catalogo de productos.'),
  ('products.create',   'products',  'create',  'Crear productos.'),
  ('products.update',   'products',  'update',  'Editar productos.'),
  ('products.delete',   'products',  'delete',  'Eliminar productos.'),
  ('orders.view',       'orders',    'view',    'Ver pedidos.'),
  ('orders.create',     'orders',    'create',  'Crear pedidos.'),
  ('orders.update',     'orders',    'update',  'Actualizar pedidos.'),
  ('orders.cancel',     'orders',    'cancel',  'Anular pedidos.'),
  ('customers.view',    'customers', 'view',    'Ver clientes.'),
  ('customers.manage',  'customers', 'manage',  'Crear y editar clientes.'),
  ('cash.open',         'cash',      'open',    'Abrir caja.'),
  ('cash.close',        'cash',      'close',   'Cerrar caja.'),
  ('billing.view',      'billing',   'view',    'Ver documentos de facturacion.'),
  ('billing.create',    'billing',   'create',  'Emitir documentos.'),
  ('billing.cancel',    'billing',   'cancel',  'Anular documentos.'),
  ('reports.view',      'reports',   'view',    'Ver reportes.'),
  ('employees.manage',  'employees', 'manage',  'Gestionar empleados.'),
  ('settings.manage',   'settings',  'manage',  'Cambiar la configuracion del negocio.'),
  -- Not named in master section 12, whose list is explicitly examples. These
  -- two are what Phase 03 needs in order to govern `tenant_members` itself.
  ('members.view',      'members',   'view',    'Ver el padron de miembros.'),
  ('members.manage',    'members',   'manage',  'Invitar, cambiar rol y retirar miembros.');

-- owner: everything, including settings and membership.
insert into public.role_permissions (role, permission)
select 'owner'::public.tenant_role, code from public.permissions;

-- admin: everything except changing the business configuration, which stays
-- with the owner.
insert into public.role_permissions (role, permission)
select 'admin'::public.tenant_role, code
from public.permissions
where code <> 'settings.manage';

insert into public.role_permissions (role, permission) values
  ('manager', 'products.view'), ('manager', 'products.create'),
  ('manager', 'products.update'), ('manager', 'products.delete'),
  ('manager', 'orders.view'), ('manager', 'orders.create'),
  ('manager', 'orders.update'), ('manager', 'orders.cancel'),
  ('manager', 'customers.view'), ('manager', 'customers.manage'),
  ('manager', 'cash.open'), ('manager', 'cash.close'),
  ('manager', 'billing.view'), ('manager', 'reports.view'),
  ('manager', 'members.view'),

  ('cashier', 'products.view'),
  ('cashier', 'orders.view'), ('cashier', 'orders.create'), ('cashier', 'orders.update'),
  ('cashier', 'customers.view'), ('cashier', 'customers.manage'),
  ('cashier', 'cash.open'), ('cashier', 'cash.close'),
  ('cashier', 'billing.view'), ('cashier', 'billing.create'),

  ('waiter', 'products.view'),
  ('waiter', 'orders.view'), ('waiter', 'orders.create'), ('waiter', 'orders.update'),
  ('waiter', 'customers.view'),

  ('kitchen', 'products.view'),
  ('kitchen', 'orders.view'), ('kitchen', 'orders.update'),

  ('delivery', 'orders.view'), ('delivery', 'orders.update'),
  ('delivery', 'customers.view'),

  ('accountant', 'orders.view'),
  ('accountant', 'billing.view'), ('accountant', 'billing.create'),
  ('accountant', 'billing.cancel'),
  ('accountant', 'reports.view');

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.roles enable row level security;
alter table public.permissions enable row level security;
alter table public.role_permissions enable row level security;

-- `using (true)` here does NOT contradict master section 10, which forbids it on
-- tables holding private data. These three hold no tenant data at all: they are
-- the product's capability list, as public as its documentation. A signed-in
-- user needs to read them to render a role picker.
--
-- Read-only: no INSERT/UPDATE/DELETE policy exists, so the catalogue can only
-- be changed by a migration.
create policy roles_select_authenticated
  on public.roles for select to authenticated using (true);

create policy permissions_select_authenticated
  on public.permissions for select to authenticated using (true);

create policy role_permissions_select_authenticated
  on public.role_permissions for select to authenticated using (true);
