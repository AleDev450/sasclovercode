-- Phase 04 - Super Admin
-- The platform operator identity. Deliberately NOT a tenant role.
--
-- SPEC: docs/specs/phase-04-super-admin.md sections 8, 11.
-- CLOVERCODE_MASTER.md section 29.

-- `revoked` rather than DELETE: who held platform access, and when they stopped
-- holding it, is auditable information.
create type public.platform_admin_status as enum ('active', 'revoked');

-- A table of its own, not a column on `profiles` and not a role in
-- `tenant_members`.
--
-- Master section 29 is explicit that SUPER_ADMIN and OWNER must never be
-- confused. Keeping them in separate tables makes confusing them impossible by
-- structure rather than by discipline: there is no query that accidentally
-- turns an owner into an operator, because the two live nowhere near each other.
create table public.platform_admins (
  user_id     uuid                          not null,
  status      public.platform_admin_status  not null default 'active',
  note        text,
  created_at  timestamptz                   not null default now(),
  updated_at  timestamptz                   not null default now(),

  constraint platform_admins_pkey primary key (user_id),
  constraint platform_admins_user_id_fkey
    foreign key (user_id) references public.profiles (id) on delete cascade,
  constraint platform_admins_note_length check (note is null or char_length(note) <= 500)
);

comment on table public.platform_admins is
  'CloverCode staff. Unrelated to tenant membership: an OWNER is not an operator.';

create trigger platform_admins_set_updated_at
  before update on public.platform_admins
  for each row
  execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- is_platform_admin
-- ---------------------------------------------------------------------------

-- Note what this function does NOT read: `tenant_members`. Platform authority
-- has nothing to do with membership, and the implementation says so.
create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.platform_admins as a
    where a.user_id = (select auth.uid())
      and a.status = 'active'
  );
$$;

comment on function public.is_platform_admin() is
  'True when the CURRENT user is an active CloverCode operator. Takes no '
  'parameter: a caller can only ever ask about themselves.';

revoke execute on function public.is_platform_admin() from public;
grant execute on function public.is_platform_admin() to authenticated;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.platform_admins enable row level security;

-- Read-only, own row only.
--
-- There is deliberately NO insert, update or delete policy. Granting platform
-- authority is not reachable through the API at all: it happens by migration or
-- by direct database access. That closes the escalation path where somebody who
-- already has an account writes themselves a row (SPEC AB-401).
create policy platform_admins_select_own
  on public.platform_admins
  for select
  to authenticated
  using ((select auth.uid()) = user_id);
