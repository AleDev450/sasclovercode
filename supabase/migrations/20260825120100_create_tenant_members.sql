-- Phase 02 - Authentication
-- Which users belong to which tenants.
--
-- SPEC: docs/specs/phase-02-authentication.md section 8
-- CLOVERCODE_MASTER.md sections 11, 12.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

-- The role catalogue of master section 12. Stored as an enum in this phase
-- because a membership without a role is not the entity section 11 describes.
--
-- Phase 03 adds `roles`, `permissions` and `role_permissions` for granular
-- authorization. This column stays as the coarse role of the member; what a
-- role is ALLOWED to do is resolved through those tables, never by comparing
-- this value in application code (section 12 forbids `if (role === "admin")`).
create type public.tenant_role as enum (
  'owner',
  'admin',
  'manager',
  'cashier',
  'waiter',
  'kitchen',
  'delivery',
  'accountant'
);

-- `invited` exists so an invitation is a real row rather than a pending state
-- kept somewhere else. Only `active` memberships grant access.
create type public.membership_status as enum ('active', 'invited', 'suspended');

-- ---------------------------------------------------------------------------
-- tenant_members
-- ---------------------------------------------------------------------------

-- The join that makes master section 11 true: one user, several businesses.
--
--   Usuario A -> Sugu Rolls -> OWNER
--             -> Empresa B  -> ADMIN
--
-- Nothing in this table assumes one user equals one tenant.
create table public.tenant_members (
  id          uuid                      not null default gen_random_uuid(),
  tenant_id   uuid                      not null,
  user_id     uuid                      not null,
  role        public.tenant_role        not null,
  status      public.membership_status  not null default 'active',
  created_at  timestamptz               not null default now(),
  updated_at  timestamptz               not null default now(),

  constraint tenant_members_pkey primary key (id),

  constraint tenant_members_tenant_id_fkey
    foreign key (tenant_id) references public.tenants (id) on delete cascade,

  -- References `profiles`, not `auth.users`. The profile is this schema's
  -- representation of a person, and the profile itself cascades from the auth
  -- user, so deleting an account still removes the memberships.
  constraint tenant_members_user_id_fkey
    foreign key (user_id) references public.profiles (id) on delete cascade,

  -- A person holds at most ONE membership per tenant. Two rows would mean two
  -- roles for the same person in the same business, and every authorization
  -- check would then depend on which row it happened to read first.
  --
  -- Scoped by tenant, per master section 11: this is the normal shape for a
  -- business table, unlike the deliberately global UNIQUE on tenant_domains.
  constraint tenant_members_tenant_user_key unique (tenant_id, user_id)
);

comment on table public.tenant_members is
  'Membership of a user in a tenant, with the role held there.';
comment on column public.tenant_members.role is
  'Coarse role. Phase 03 resolves permissions through roles/role_permissions.';
comment on column public.tenant_members.status is
  'Only `active` grants access. `invited` and `suspended` never do.';

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

-- `tenant_members_tenant_user_key` (from the UNIQUE constraint) already serves
-- every lookup that leads with `tenant_id`, including "who belongs to this
-- tenant". No separate tenant_id index: it would be redundant (section 8
-- forbids over-indexing).

-- "Which tenants does the signed-in user belong to" is the single hottest query
-- of this phase - it runs on every authenticated request - and `user_id` is not
-- the leading column of the unique index above.
create index tenant_members_user_id_idx
  on public.tenant_members (user_id);

create trigger tenant_members_set_updated_at
  before update on public.tenant_members
  for each row
  execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.tenant_members enable row level security;

-- A user may see their OWN memberships and nothing else.
--
-- Note what this policy does not do: it does not let a member list the other
-- members of their tenant. That reads other people's rows, so it belongs to an
-- explicit permission in Phase 03, not to membership.
--
-- No INSERT / UPDATE / DELETE policies: granting or revoking membership is a
-- privileged operation owned by Phase 04 (provisioning and super admin). Until
-- then the default deny applies to every client role.
create policy tenant_members_select_own
  on public.tenant_members
  for select
  to authenticated
  using ((select auth.uid()) = user_id);
