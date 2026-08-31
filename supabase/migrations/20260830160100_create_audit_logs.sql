-- Phase 24 - Audit + Observability
-- The audit log, its redaction policy, and the only thing that writes it.
--
-- SPEC: docs/specs/phase-24-audit-observability.md sections 8, 11.
-- ADR-028: written by trigger, with the request context forwarded.
-- CLOVERCODE_MASTER.md section 17 gives this table column by column, and ends
-- with: "Nunca guardar passwords, tokens o secretos en audit logs."

create table public.audit_logs (
  id          uuid        not null default gen_random_uuid(),
  tenant_id   uuid        not null,

  -- WHO. Nullable on purpose: a change made by a migration, by the billing
  -- cycle, or from a SQL console has no user, and recording that as NULL is
  -- more honest than attributing it to somebody.
  --
  -- And deliberately WITHOUT a foreign key. `auth.users` cascades to
  -- `profiles`, so `references auth.users` would leave only two endings when a
  -- user is deleted: CASCADE, which erases the audit of what that person did,
  -- or SET NULL, which erases the proof of who did it. Both destroy the one
  -- thing this table exists for (ADR-028 decision 5).
  user_id     uuid,

  -- The actor's email, COPIED. Snapshot discipline (ADR-017) applied to the
  -- person for the same reason it is applied to a price: a historical record
  -- resolved by reference changes when the reference changes, and then it is
  -- no longer historical. Without it the screen would show a UUID that no
  -- longer resolves against anything.
  user_email  text,

  -- WHAT. A semantic name - `product.price_changed`, never `update`. A log
  -- that records the SQL verb makes the reader reconstruct the intent from the
  -- payload; a log that records the intent is one somebody can read.
  action      text        not null,

  -- ON WHAT.
  entity_type text        not null,
  entity_id   uuid,

  -- The before and the after, redacted.
  --
  -- Master section 7 asks that JSON columns not be created arbitrarily where a
  -- relational structure would be better, and allows JSONB for justified
  -- dynamic shapes. This is the canonical one: the before and after of a row
  -- have the shape of whichever table changed, and fifteen triggers write
  -- fifteen different shapes. The relational alternative here is a key/value
  -- table, which is JSONB with extra steps.
  old_values  jsonb,
  new_values  jsonb,

  -- FROM WHERE. Section 17 asks for both, and PostgreSQL knows neither: they
  -- are HTTP facts. They arrive because createSupabaseServerClient() forwards
  -- them as headers and the writer below reads them out of `request.headers`
  -- (ADR-028 decision 2).
  ip_address  inet,
  user_agent  text,

  -- The correlation handle. Not in section 17's model, and section 33 lists
  -- "request IDs" in the same breath as "audit logs" - this column is what
  -- makes the two lists mean something together: the same value appears in
  -- every application log line for the request that caused this row.
  request_id  text,

  created_at  timestamptz not null default now(),

  constraint audit_logs_pkey primary key (id),
  constraint audit_logs_tenant_id_fkey
    foreign key (tenant_id) references public.tenants (id) on delete cascade,

  constraint audit_logs_action_format
    check (action ~ '^[a-z_]+\.[a-z_]+$'),
  constraint audit_logs_entity_type_length
    check (char_length(btrim(entity_type)) between 1 and 63),
  constraint audit_logs_user_email_length
    check (user_email is null or char_length(user_email) between 3 and 320),
  constraint audit_logs_user_agent_length
    check (user_agent is null or char_length(user_agent) between 1 and 500),
  constraint audit_logs_request_id_length
    check (request_id is null or char_length(request_id) between 1 and 200),

  -- A row that says nothing changed says nothing.
  constraint audit_logs_has_payload
    check (old_values is not null or new_values is not null)
);

comment on table public.audit_logs is
  'Who changed what, when, and from where. Written ONLY by triggers - there is no INSERT policy for anybody (ADR-028). Never contains a secret: audit_redact() strips them by key name.';
comment on column public.audit_logs.user_id is
  'Deliberately has NO foreign key: deleting a user must not delete or blank the record of what they did.';
comment on column public.audit_logs.user_email is
  'Snapshot of the actor, so the row still names somebody after that account is gone.';
comment on column public.audit_logs.request_id is
  'Ties this row to the application log lines of the same request.';

-- The screen, newest first.
create index audit_logs_tenant_created_idx
  on public.audit_logs (tenant_id, created_at desc);

-- The screen, filtered by action - the first thing anybody does with it.
create index audit_logs_tenant_action_created_idx
  on public.audit_logs (tenant_id, action, created_at desc);

-- "What happened to this row", from a product or an order page.
create index audit_logs_entity_idx
  on public.audit_logs (entity_type, entity_id);

-- Crossing the audit with the application log. Partial: most rows in a system
-- with background writes carry no request id, and indexing those is dead weight
-- (master section 8: avoid over-indexing).
create index audit_logs_request_idx
  on public.audit_logs (request_id)
  where request_id is not null;

-- ---------------------------------------------------------------------------
-- Redaction (master section 17)
-- ---------------------------------------------------------------------------

-- The SQL mirror of `isSensitiveKey` in src/lib/logger/redact.ts (Phase 00).
--
-- BY PATTERN, not by a list of forbidden columns. A list satisfies section 17
-- today and fails the day somebody adds `stripe_api_key` to an audited table
-- without remembering to update it - which is precisely the failure mode this
-- project has spent twenty-three phases designing away.
--
-- The key is normalised exactly as TypeScript normalises it (lowercase, strip
-- everything that is not a letter or a digit), so `api_key`, `apiKey` and
-- `API-KEY` are one case. A database test feeds the same list of names to this
-- function and to `isSensitiveKey` and fails if the two ever disagree: two
-- copies of a policy nobody compares are two policies.
create or replace function public.audit_is_sensitive_key(p_key text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select regexp_replace(lower(coalesce(p_key, '')), '[^a-z0-9]', '', 'g') ~
    ('pass(word|wd|phrase)?$|^pwd$|secret|token|apikey|authorization|^auth$'
     || '|^cookie|setcookie|servicerole|credential|privatekey|signature'
     || '|^otp$|^pin$|^cvv$|^cvc$|^jwt$|bearer');
$$;

comment on function public.audit_is_sensitive_key(text) is
  'True when a column name looks like a credential. Mirrors isSensitiveKey() in src/lib/logger/redact.ts - a test proves the two agree.';

-- Replaces the VALUE of every sensitive key with [REDACTED], keeping the key.
--
-- Keeping the key is the point: removing it would make "this field did not
-- change" indistinguishable from "this field changed and I am not showing you",
-- and the second is information an auditor wants. `[REDACTED]` is the same
-- sentinel the logger has used since Phase 00.
--
-- IMMUTABLE and recursive. The depth cap mirrors the TypeScript MAX_DEPTH: the
-- input here is always `to_jsonb(row)` and so is two levels at most, but a
-- redaction function that can recurse without bound is a redaction function
-- that can take the database down.
create or replace function public.audit_redact(p_value jsonb, p_depth int default 0)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_result jsonb;
  v_key    text;
  v_item   jsonb;
begin
  if p_value is null then
    return null;
  end if;

  if p_depth >= 8 then
    return to_jsonb('[MaxDepth]'::text);
  end if;

  case jsonb_typeof(p_value)
    when 'object' then
      v_result := '{}'::jsonb;
      for v_key in select jsonb_object_keys(p_value) loop
        v_result := v_result || jsonb_build_object(
          v_key,
          case
            when public.audit_is_sensitive_key(v_key) then to_jsonb('[REDACTED]'::text)
            else public.audit_redact(p_value -> v_key, p_depth + 1)
          end
        );
      end loop;
      return v_result;

    when 'array' then
      v_result := '[]'::jsonb;
      for v_item in select jsonb_array_elements(p_value) loop
        v_result := v_result || jsonb_build_array(public.audit_redact(v_item, p_depth + 1));
      end loop;
      return v_result;

    else
      return p_value;
  end case;
end;
$$;

comment on function public.audit_redact(jsonb, int) is
  'Replaces every sensitive value with [REDACTED], by key name, recursively. Master section 17: never store a secret in an audit log.';

-- ---------------------------------------------------------------------------
-- The request context, forwarded from the application (ADR-028 decision 2)
-- ---------------------------------------------------------------------------

-- Reads one header out of the `request.headers` GUC that PostgREST populates.
--
-- Returns NULL whenever there is no HTTP request behind the statement - a
-- migration, a test, the SQL console, the billing cycle - and NULL rather than
-- raising if the GUC holds something that is not JSON. The worst case of this
-- whole path is an audit row without an IP; never a business write that fails
-- because the audit could not resolve a header.
create or replace function public.audit_request_header(p_name text)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  v_headers text;
begin
  v_headers := current_setting('request.headers', true);

  if v_headers is null or btrim(v_headers) = '' then
    return null;
  end if;

  return nullif(btrim((v_headers::json) ->> p_name), '');
exception
  when others then
    return null;
end;
$$;

comment on function public.audit_request_header(text) is
  'One header from PostgREST''s request.headers GUC, or NULL when there is no HTTP request. Never raises.';

-- The visitor's IP, as `inet`, or NULL.
--
-- The forwarded value can be an `x-forwarded-for` style list, in which case the
-- FIRST entry is the client and the rest are proxies. And it can be anything at
-- all, including "unknown", so the cast is guarded: an invalid address is NULL,
-- not an exception inside somebody's price update.
create or replace function public.audit_client_ip()
returns inet
language plpgsql
stable
set search_path = ''
as $$
declare
  v_raw text;
begin
  v_raw := public.audit_request_header('x-clovercode-ip');

  if v_raw is null then
    return null;
  end if;

  return btrim(split_part(v_raw, ',', 1))::inet;
exception
  when others then
    return null;
end;
$$;

comment on function public.audit_client_ip() is
  'The visitor''s IP from the forwarded header, or NULL when absent or malformed. Never raises.';

-- ---------------------------------------------------------------------------
-- The writer
-- ---------------------------------------------------------------------------

-- The only thing that writes `audit_logs`.
--
-- Generic on purpose: the semantic action name comes from TG_ARGV[0], so
-- auditing a new action is a three-line trigger rather than another copy of
-- this function. SECURITY DEFINER because the table has no INSERT policy for
-- anybody - which is what makes a row in it worth something (ADR-028
-- decision 1).
create or replace function public.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old    jsonb;
  v_new    jsonb;
  v_tenant uuid;
  v_user   uuid;
  v_email  text;
begin
  if tg_op <> 'INSERT' then
    v_old := to_jsonb(old);
  end if;

  if tg_op <> 'DELETE' then
    v_new := to_jsonb(new);
  end if;

  v_tenant := coalesce(v_new ->> 'tenant_id', v_old ->> 'tenant_id')::uuid;

  if v_tenant is null then
    return null;
  end if;

  -- Deleting a tenant cascades to its rows, and PostgreSQL removes the parent
  -- BEFORE running the cascade, so by the time a child's DELETE trigger fires
  -- the tenant is already gone and this insert would violate the foreign key -
  -- making the audit the reason a legitimate delete fails. Auditing the
  -- teardown of a tenant is noise anyway: the tenant is what was deleted.
  if not exists (select 1 from public.tenants as t where t.id = v_tenant) then
    return null;
  end if;

  v_user := auth.uid();

  if v_user is not null then
    select p.email into v_email from public.profiles as p where p.id = v_user;
  end if;

  insert into public.audit_logs (
    tenant_id, user_id, user_email, action, entity_type, entity_id,
    old_values, new_values, ip_address, user_agent, request_id
  )
  values (
    v_tenant,
    v_user,
    v_email,
    tg_argv[0],
    tg_table_name,
    -- Most audited tables key on `id`; `tenant_settings` and
    -- `billing_provider_configs` are singletons keyed on `tenant_id`.
    coalesce(v_new ->> 'id', v_old ->> 'id', v_tenant::text)::uuid,
    public.audit_redact(v_old),
    public.audit_redact(v_new),
    public.audit_client_ip(),
    left(public.audit_request_header('x-clovercode-user-agent'), 500),
    left(public.audit_request_header('x-clovercode-request-id'), 200)
  );

  -- AFTER triggers ignore the return value.
  return null;
end;
$$;

comment on function public.audit_row_change() is
  'Writes one audit row. The semantic action is TG_ARGV[0]. The only writer of audit_logs (ADR-028).';

revoke execute on function public.audit_row_change() from public;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.audit_logs enable row level security;

create policy audit_logs_select_auditor
  on public.audit_logs for select to authenticated
  using (public.has_permission(tenant_id, 'audit.view') or public.is_platform_admin());

-- No INSERT, no UPDATE, no DELETE - for ANYBODY, platform admin included.
--
-- A record somebody can write is a record somebody can fabricate, and then it
-- stops proving the one thing it exists to prove. A record somebody can delete
-- is one where the incriminating row is the first to go. The fifteen triggers
-- in the next migration are SECURITY DEFINER, which is the only thing that can
-- write here.
--
-- The accepted cost is that the audit is uncorrectable: a badly written row
-- stays. That is the trade, and it is the same one subscription_events made in
-- ADR-026.
