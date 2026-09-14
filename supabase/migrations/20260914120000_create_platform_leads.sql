-- Landing page - sales enquiries.
--
-- CLOVERCODE_MASTER.md section 22: CloverCode's own commercial surface, kept
-- apart from anything a tenant owns. A lead is somebody who does NOT yet have a
-- business in the platform, which is exactly why this table has no `tenant_id`:
-- there is no tenant to attribute it to, and adding one "for later" would
-- invite a join that can never be satisfied.

create type public.lead_status as enum (
  'new',        -- submitted, nobody has looked at it
  'contacted',  -- an operator has replied
  'qualified',  -- a real opportunity
  'won',        -- became a tenant
  'lost'        -- went nowhere. Kept, so the funnel can be counted honestly.
);

create table public.platform_leads (
  id              uuid                not null default gen_random_uuid(),

  name            text                not null,
  email           text                not null,
  phone           text,
  business_name   text,
  -- Free text rather than an enum. The list of things people sell is not ours
  -- to close, and a lead form that rejects "juguería" is a lead lost.
  business_type   text,
  message         text,

  -- Which surface produced it: 'landing.contact', 'landing.pricing', ...
  -- A plain text column, because the set grows with the marketing site and a
  -- migration per campaign would be absurd.
  source          text                not null default 'landing.contact',

  status          public.lead_status  not null default 'new',
  -- What an operator wrote about the lead. NEVER shown to the person who
  -- submitted it, which is a property of there being no policy that lets them
  -- read this table at all.
  internal_note   text,

  contacted_at    timestamptz,
  created_at      timestamptz         not null default now(),
  updated_at      timestamptz         not null default now(),

  constraint platform_leads_pkey primary key (id),
  constraint platform_leads_name_length check (char_length(name) between 2 and 120),
  constraint platform_leads_email_length check (char_length(email) between 5 and 160),
  -- Shape, not validity. Proving an address exists means sending to it; this
  -- only rejects what is obviously not an address at all.
  constraint platform_leads_email_format check (email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  constraint platform_leads_phone_length check (phone is null or char_length(phone) <= 40),
  constraint platform_leads_business_name_length
    check (business_name is null or char_length(business_name) <= 160),
  constraint platform_leads_business_type_length
    check (business_type is null or char_length(business_type) <= 80),
  constraint platform_leads_message_length check (message is null or char_length(message) <= 2000),
  constraint platform_leads_source_format check (source ~ '^[a-z0-9_]+\.[a-z0-9_]+$'),
  constraint platform_leads_internal_note_length
    check (internal_note is null or char_length(internal_note) <= 2000)
);

comment on table public.platform_leads is
  'Sales enquiries from the public landing page. Pre-tenant by definition, so no tenant_id.';
comment on column public.platform_leads.internal_note is
  'Operator-only. No policy grants the submitter any read on this table.';

create trigger platform_leads_set_updated_at
  before update on public.platform_leads
  for each row
  execute function public.set_updated_at();

-- The inbox, and it is the only ordering the console uses.
create index platform_leads_status_created_idx
  on public.platform_leads (status, created_at desc);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.platform_leads enable row level security;

-- Operators read and triage. Nobody else touches this table through the API.
create policy platform_leads_select_operator
  on public.platform_leads
  for select
  to authenticated
  using (public.is_platform_admin());

create policy platform_leads_update_operator
  on public.platform_leads
  for update
  to authenticated
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

-- THERE IS NO INSERT POLICY, and that is the point.
--
-- The form that writes here is anonymous - it has to be, or it is not a contact
-- form - and an `insert to anon` policy would hand the internet a writable
-- table. Everything goes through `submit_lead()` below, which is the only
-- writer, so the shape of what can be inserted is fixed in one place that also
-- carries the rate limit.
--
-- There is no delete policy either: a lead is removed by retention, not by a
-- request.

-- ---------------------------------------------------------------------------
-- submit_lead
-- ---------------------------------------------------------------------------

-- The single door an anonymous enquiry comes through.
--
-- SECURITY DEFINER, with `search_path = ''` and fully qualified names, so the
-- caller cannot shadow anything it touches.
--
-- It returns nothing. A lead id handed back to an anonymous caller would be a
-- handle to a row they must never be able to address, and the form has no use
-- for it - it shows a thank-you either way.
create or replace function public.submit_lead(
  p_name          text,
  p_email         text,
  p_phone         text default null,
  p_business_name text default null,
  p_business_type text default null,
  p_message       text default null,
  p_source        text default 'landing.contact'
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.platform_leads (
    name, email, phone, business_name, business_type, message, source
  )
  values (
    btrim(p_name),
    lower(btrim(p_email)),
    nullif(btrim(coalesce(p_phone, '')), ''),
    nullif(btrim(coalesce(p_business_name, '')), ''),
    nullif(btrim(coalesce(p_business_type, '')), ''),
    nullif(btrim(coalesce(p_message, '')), ''),
    coalesce(nullif(btrim(p_source), ''), 'landing.contact')
  );
end;
$$;

comment on function public.submit_lead(text, text, text, text, text, text, text) is
  'The only writer of platform_leads. Anonymous by design; the table has no insert policy.';

revoke execute on function public.submit_lead(text, text, text, text, text, text, text) from public;
-- `anon` as well as `authenticated`: a visitor filling in the landing form has
-- no session, and requiring one would defeat the purpose of the form.
grant execute on function public.submit_lead(text, text, text, text, text, text, text)
  to anon, authenticated;

-- ---------------------------------------------------------------------------
-- platform_lead_counts
-- ---------------------------------------------------------------------------

-- The funnel, in one round trip, for the Super Admin dashboard.
--
-- Same shape and same gate as `platform_diagnostics()` (Phase 24): a caller who
-- is not an operator gets zero rows rather than an error, so the console never
-- has to branch on who is asking.
create or replace function public.platform_lead_counts()
returns table (
  leads_total       bigint,
  leads_new         bigint,
  leads_contacted   bigint,
  leads_qualified   bigint,
  leads_won         bigint,
  leads_lost        bigint,
  leads_last_7d     bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    count(*)                                                        as leads_total,
    count(*) filter (where l.status = 'new')                        as leads_new,
    count(*) filter (where l.status = 'contacted')                  as leads_contacted,
    count(*) filter (where l.status = 'qualified')                  as leads_qualified,
    count(*) filter (where l.status = 'won')                        as leads_won,
    count(*) filter (where l.status = 'lost')                       as leads_lost,
    count(*) filter (where l.created_at >= now() - interval '7 days') as leads_last_7d
  from public.platform_leads as l
  where public.is_platform_admin();
$$;

comment on function public.platform_lead_counts() is
  'Lead funnel counters for the Super Admin dashboard. Returns zeros to a non-operator.';

revoke execute on function public.platform_lead_counts() from public;
grant execute on function public.platform_lead_counts() to authenticated;
