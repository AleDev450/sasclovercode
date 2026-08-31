-- Phase 25 - Security Hardening
-- A rate limiter with its state in the database.
--
-- SPEC: docs/specs/phase-25-security-hardening.md sections 8, 26.13.
-- ADR-029 decision 3.
-- CLOVERCODE_MASTER.md section 33 (Phase 25) lists "rate limits" among the
-- areas to review; Phase 02 left KL-203 - "no application rate limiting exists;
-- one needs shared state" - with this phase as its owner.
--
-- WHY THE DATABASE. The deployment target is serverless: every instance has its
-- own memory and would keep its own counter, so an in-memory limiter allows
-- N x limit attempts with N instances - and does not know it. A control that
-- believes itself effective and is not is worse than no control, because nobody
-- looks at it again. There is no Redis to stand up here (master section 47), and
-- PostgreSQL is shared state this project already has.

create table public.rate_limit_counters (
  -- WHAT is being limited: 'auth.sign_in', 'auth.sign_up', ...
  bucket        text        not null,

  -- WHO, as sha256 hex. Never the identifier itself.
  --
  -- The limiter only needs an opaque key. Storing the IP would turn this into a
  -- second register of addresses - less guarded than `audit_logs` and without
  -- the reason that one has for keeping it (investigating a specific change).
  -- Data minimisation (ADR-016) applied to a new table.
  --
  -- No secret salt, and that is worth saying plainly: anyone who can read this
  -- table can walk the IPv4 space and reverse it. That is not the threat it
  -- exists for. It exists so an accidental dump is not a list of addresses.
  subject_hash  text        not null,

  -- Fixed window, not sliding. A sliding window needs every attempt stored
  -- rather than a counter, and for stopping brute force the difference does not
  -- change the outcome (KL-2506).
  window_start  timestamptz not null,

  hits          integer     not null default 1,

  constraint rate_limit_counters_pkey primary key (bucket, subject_hash, window_start),
  constraint rate_limit_counters_bucket_format check (bucket ~ '^[a-z_]+\.[a-z_]+$'),
  constraint rate_limit_counters_subject_hash_format check (subject_hash ~ '^[0-9a-f]{64}$'),
  constraint rate_limit_counters_hits_positive check (hits > 0)
);

comment on table public.rate_limit_counters is
  'Fixed-window rate limit counters. No policies at all: only consume_rate_limit() touches it (ADR-029).';
comment on column public.rate_limit_counters.subject_hash is
  'sha256 of the identifier. The raw IP is never stored here - audit_logs is the only place that keeps one.';

-- For the purge. The primary key cannot answer "everything older than X"
-- because `window_start` is its last column.
create index rate_limit_counters_window_idx
  on public.rate_limit_counters (window_start);

-- NO tenant_id, and that is correct rather than an omission.
--
-- A rate limit governs the surface WITHOUT a session: whoever is consuming it
-- has not yet shown they belong to any business, so there is no tenant to
-- attribute it to.

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.rate_limit_counters enable row level security;

-- No policies. None. Not select, not insert, not update, not delete, for
-- anybody - platform admin included.
--
-- A readable counter would be an oracle ("how many attempts does this address
-- have left?"), and a writable one would be a way to lock somebody else out.
-- Only `consume_rate_limit()` below, which is SECURITY DEFINER, ever touches
-- this table.
--
-- Third table in the project with this shape, after `subscription_events`
-- (Phase 22) and `audit_logs` (Phase 24).

-- ---------------------------------------------------------------------------
-- Purge
-- ---------------------------------------------------------------------------

-- Removes windows that can no longer matter.
--
-- Called opportunistically by `consume_rate_limit` rather than on a schedule,
-- because the scheduler this project keeps declining to build (ADR-024,
-- ADR-026, master section 47) still does not exist - and a table that only
-- grows would eventually be the reason the login is slow.
create or replace function public.purge_rate_limits(p_older_than interval default interval '1 day')
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted integer;
begin
  delete from public.rate_limit_counters
  where window_start < now() - p_older_than;

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

comment on function public.purge_rate_limits(interval) is
  'Deletes expired rate limit windows. Called opportunistically by consume_rate_limit(); no scheduler needed.';

revoke execute on function public.purge_rate_limits(interval) from public;

-- ---------------------------------------------------------------------------
-- consume_rate_limit
-- ---------------------------------------------------------------------------

-- Records one attempt and says whether it was allowed.
--
--   true  = go ahead (and this attempt is now counted)
--   false = over the limit
--
-- The subject is hashed HERE. The caller never decides how it is stored, so
-- there is no call site that can accidentally pass a raw address through.
--
-- `sha256()` is PostgreSQL core since 11 - no pgcrypto extension to install,
-- which matters because the test harness (PGlite) ships no extensions.
--
-- Executable by `anon` as well as `authenticated`: this limits the surface
-- WITHOUT a session, so requiring a session to call it would be a contradiction.
create or replace function public.consume_rate_limit(
  p_bucket         text,
  p_subject        text,
  p_limit          integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hash    text;
  v_window  timestamptz;
  v_hits    integer;
begin
  if p_limit <= 0 then
    -- A limit of zero denies everything. Useful for turning a bucket off
    -- without deploying, and the only sensible reading of "allow zero".
    return false;
  end if;

  if p_window_seconds <= 0 then
    raise exception 'A rate limit window must be positive.' using errcode = '22023';
  end if;

  v_hash := encode(sha256(convert_to(coalesce(p_subject, ''), 'UTF8')), 'hex');

  -- The floor of now() to the window size. Deterministic, so two instances
  -- computing it at the same moment land on the same row.
  v_window := to_timestamp(
    floor(extract(epoch from clock_timestamp()) / p_window_seconds) * p_window_seconds
  );

  -- One statement, so two concurrent attempts cannot both read "0" and both
  -- write "1". The primary key is what makes the conflict resolvable.
  insert into public.rate_limit_counters (bucket, subject_hash, window_start, hits)
  values (p_bucket, v_hash, v_window, 1)
  on conflict (bucket, subject_hash, window_start)
  do update set hits = public.rate_limit_counters.hits + 1
  returning hits into v_hits;

  -- Roughly one call in a hundred pays for the cleanup. Cheap enough not to
  -- notice, frequent enough that the table cannot run away.
  if v_hits % 100 = 0 then
    perform public.purge_rate_limits();
  end if;

  return v_hits <= p_limit;
end;
$$;

comment on function public.consume_rate_limit(text, text, integer, integer) is
  'Counts one attempt in a fixed window and returns whether it is within the limit. Hashes the subject itself (ADR-029).';

revoke execute on function public.consume_rate_limit(text, text, integer, integer) from public;
grant execute on function public.consume_rate_limit(text, text, integer, integer)
  to anon, authenticated;
