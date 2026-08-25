-- Phase 02 - Authentication
-- Business-facing user record, one per Supabase Auth user.
--
-- SPEC: docs/specs/phase-02-authentication.md section 8
-- CLOVERCODE_MASTER.md sections 9, 10, 11.

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------

-- Master section 11: Supabase Auth owns authentication, this application owns
-- the business profile. The split matters for one reason above all others:
-- credentials live in `auth.users` and are never copied here. There is no
-- password column in this table and there never will be one.
--
-- The primary key IS `auth.users.id` rather than a separate surrogate key. A
-- profile has no identity of its own - it is the business face of exactly one
-- auth user - and a second id would allow the two to drift apart.
create table public.profiles (
  id          uuid        not null,
  email       text        not null,
  full_name   text,
  avatar_url  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint profiles_pkey primary key (id),

  -- ON DELETE CASCADE: deleting the auth user removes the profile. This is the
  -- one place in CloverCode where a physical delete is correct, because it is
  -- what "delete my account" has to mean (master section 41 keeps business
  -- records; an identity is not a business record).
  constraint profiles_id_fkey
    foreign key (id) references auth.users (id) on delete cascade,

  -- Deliberately permissive: `auth.users` already validated the address on
  -- sign-up. This constraint exists to catch a broken sync, not to re-implement
  -- RFC 5322, which no regex does correctly.
  constraint profiles_email_format
    check (email like '_%@_%._%' and email not like '% %'),

  constraint profiles_email_length
    check (char_length(email) between 6 and 320),

  constraint profiles_full_name_length
    check (full_name is null or char_length(btrim(full_name)) between 1 and 120)
);

comment on table public.profiles is
  'Business profile of an authenticated user. Never stores credentials.';
comment on column public.profiles.id is
  'Same value as auth.users.id. A profile has no identity of its own.';
comment on column public.profiles.email is
  'Mirror of auth.users.email, kept in sync by trigger. Authoritative copy lives in auth.';

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row
  execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Synchronisation with auth.users
-- ---------------------------------------------------------------------------

-- Why a database trigger and not application code: sign-up is not the only way
-- a row appears in `auth.users`. An invitation, an admin creating a user, or a
-- future OAuth provider all insert directly, and none of them run our code. A
-- trigger is the only place that sees every one of those paths.
--
-- SECURITY DEFINER because the inserting role is `supabase_auth_admin`, which
-- has no rights on `public.profiles`. `search_path = ''` for the same reason it
-- is set on every other definer function in this schema.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    nullif(btrim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), '')
  )
  -- Idempotent: a retried insert must not abort user creation. Losing the
  -- profile would leave an account that can authenticate but has no record.
  on conflict (id) do nothing;

  return new;
end;
$$;

comment on function public.handle_new_auth_user() is
  'Creates the profile row for a newly created auth user.';

create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_auth_user();

-- Email changes happen in `auth.users` (confirmed by Supabase Auth). Without
-- this the mirror silently rots and the application shows a stale address.
create or replace function public.handle_auth_user_email_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles
     set email = new.email
   where id = new.id
     and email is distinct from new.email;

  return new;
end;
$$;

comment on function public.handle_auth_user_email_change() is
  'Keeps profiles.email in sync when auth.users.email changes.';

create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row
  when (old.email is distinct from new.email)
  execute function public.handle_auth_user_email_change();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;

-- A user reads and edits their own profile. Nothing else is permitted:
--
--   no INSERT policy   rows come from the trigger, never from a client
--   no DELETE policy   removal cascades from auth.users
--   no cross-user read a directory of every account on the platform is
--                      exactly the enumeration Phase 01 refused to build
--
-- Reading other members of the same tenant becomes possible in Phase 03, gated
-- by an explicit permission, not by membership alone.
--
-- `(select auth.uid())` rather than a bare `auth.uid()`: wrapping it makes
-- PostgreSQL evaluate it once per statement instead of once per row.
create policy profiles_select_own
  on public.profiles
  for select
  to authenticated
  using ((select auth.uid()) = id);

create policy profiles_update_own
  on public.profiles
  for update
  to authenticated
  using ((select auth.uid()) = id)
  -- WITH CHECK is what stops a user rewriting `id` to point at somebody else's
  -- row. USING alone only decides which rows are visible to the UPDATE.
  with check ((select auth.uid()) = id);
