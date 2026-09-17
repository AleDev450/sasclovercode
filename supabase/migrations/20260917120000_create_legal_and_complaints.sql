-- Phase 30 - Legales y Libro de Reclamaciones
-- The policies a restaurant's website must publish, and the complaints book it
-- must keep.
--
-- SPEC: docs/specs/phase-30-legal-complaints.md sections 6, 8, 10, 11.
--
-- Two different kinds of legal text, with opposite write rules:
--
--   tenant_legal_documents  Terms, privacy and cookies. The business's own
--                           prose, edited freely; a missing row means "use the
--                           platform's template", filled with the business data.
--
--   complaints              The Libro de Reclamaciones virtual (Codigo de
--                           Proteccion y Defensa del Consumidor, D.S.
--                           011-2011-PCM as amended by D.S. 101-2022-PCM). Filed
--                           by anyone, with or without an account; never deleted
--                           and never edited, except for the business's answer.

-- ---------------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------------

-- The book holds a consumer's document number, address and grievance. Reading
-- it is not something a waiter or a courier needs; answering it is a decision
-- for whoever represents the business.
insert into public.permissions (code, resource, action, description) values
  ('complaints.view',   'complaints', 'view',   'Ver el libro de reclamaciones.'),
  ('complaints.manage', 'complaints', 'manage', 'Responder reclamos y quejas.');

insert into public.role_permissions (role, permission) values
  ('owner', 'complaints.view'),   ('owner', 'complaints.manage'),
  ('admin', 'complaints.view'),   ('admin', 'complaints.manage'),
  ('manager', 'complaints.view'), ('manager', 'complaints.manage'),
  ('accountant', 'complaints.view');

-- ---------------------------------------------------------------------------
-- tenant_legal_documents
-- ---------------------------------------------------------------------------

create type public.legal_document_kind as enum ('terms', 'privacy', 'cookies');

comment on type public.legal_document_kind is
  'The three policy pages every tenant website publishes (Phase 30).';

create table public.tenant_legal_documents (
  tenant_id  uuid                       not null,
  kind       public.legal_document_kind not null,
  -- Plain text with a tiny, closed markup: `### heading`, `- item`, `**bold**`.
  -- Rendered to elements by `modules/legal/markup.ts`; never interpreted as HTML
  -- (master section 33, the same rule as every CMS field).
  body       text                       not null,
  updated_by uuid,
  created_at timestamptz                not null default now(),
  updated_at timestamptz                not null default now(),

  constraint tenant_legal_documents_pkey primary key (tenant_id, kind),
  constraint tenant_legal_documents_tenant_id_fkey
    foreign key (tenant_id) references public.tenants (id) on delete cascade,
  constraint tenant_legal_documents_updated_by_fkey
    foreign key (updated_by) references auth.users (id) on delete set null,
  constraint tenant_legal_documents_body_length
    check (char_length(btrim(body)) between 1 and 30000)
);

comment on table public.tenant_legal_documents is
  'A tenant''s own terms, privacy and cookies text. No row = the platform template (Phase 30).';

create trigger tenant_legal_documents_set_updated_at
  before update on public.tenant_legal_documents
  for each row execute function public.set_updated_at();

alter table public.tenant_legal_documents enable row level security;

create policy tenant_legal_documents_select_member
  on public.tenant_legal_documents for select to authenticated
  using (public.is_tenant_member(tenant_id));

-- Full write: a document is created the first time the owner edits the
-- template, and deleted to go back to it.
create policy tenant_legal_documents_write_manager
  on public.tenant_legal_documents for all to authenticated
  using (public.has_permission(tenant_id, 'content.manage'))
  with check (public.has_permission(tenant_id, 'content.manage'));

create or replace function public.get_public_legal_document(
  p_tenant_id uuid,
  p_kind public.legal_document_kind
)
returns table (body text, updated_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select d.body, d.updated_at
  from public.tenant_legal_documents as d
  where d.tenant_id = p_tenant_id
    and d.kind = p_kind
    and public.is_tenant_public(p_tenant_id);
$$;

revoke execute on function public.get_public_legal_document(uuid, public.legal_document_kind) from public;
grant execute on function public.get_public_legal_document(uuid, public.legal_document_kind)
  to anon, authenticated;

-- Who the business IS, legally, for the policies and the complaints book.
--
-- WHY THIS PUBLISHES WHAT PHASE 08 KEPT PRIVATE. `get_public_business_identity`
-- deliberately never returns `legal_name` or `tax_id`, and for a menu that is
-- right. The Libro de Reclamaciones is different: the norm requires the sheet to
-- identify the provider by razon social and RUC, and a RUC is a public registry
-- entry at SUNAT in any case. This function returns those two and nothing else
-- new - still no `contact_email`.
create or replace function public.get_public_legal_identity(p_tenant_id uuid)
returns table (
  legal_name   text,
  trade_name   text,
  tax_id       text,
  address_line text,
  district     text,
  city         text,
  phone        text,
  public_email text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    s.legal_name,
    coalesce(s.trade_name, t.name),
    s.tax_id,
    s.address_line,
    s.district,
    s.city,
    s.phone,
    sf.public_email
  from public.tenants as t
  left join public.tenant_settings as s on s.tenant_id = t.id
  left join public.tenant_storefronts as sf on sf.tenant_id = t.id
  where t.id = p_tenant_id
    and public.is_tenant_public(p_tenant_id);
$$;

revoke execute on function public.get_public_legal_identity(uuid) from public;
grant execute on function public.get_public_legal_identity(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- complaints: the Libro de Reclamaciones
-- ---------------------------------------------------------------------------

-- Spanish values, like `billing_document_type`: these are the legal categories
-- of Peruvian consumer law, not words to translate. A RECLAMO is a disagreement
-- with the product or service; a QUEJA is one with the attention received.
create type public.complaint_type as enum ('reclamo', 'queja');
create type public.complaint_status as enum ('pending', 'answered');

create table public.complaints (
  id                 uuid                    not null default gen_random_uuid(),
  tenant_id          uuid                    not null,
  -- The correlative printed on the sheet: the consumer's proof of filing.
  number             integer                 not null,

  -- The provider, COPIED at filing. The sheet states who it was filed against
  -- that day; a later change of razon social must not rewrite it.
  provider_name      text                    not null,
  provider_tax_id    text,
  provider_address   text,
  location_id        uuid,

  -- The consumer.
  consumer_name      text                    not null,
  consumer_address   text                    not null,
  document_type      text                    not null,
  document_number    text                    not null,
  consumer_email     text                    not null,
  consumer_phone     text                    not null,
  is_minor           boolean                 not null default false,
  guardian_name      text,

  -- What was contracted.
  item_type          text                    not null,
  amount_cents       bigint,
  item_description   text                    not null,
  order_reference    text,
  incident_date      date,

  -- The complaint itself.
  type               public.complaint_type   not null,
  detail             text                    not null,
  consumer_request   text                    not null,
  -- Where the consumer wants the answer (D.S. 101-2022-PCM: by the channel they
  -- indicate).
  response_channel   text                    not null default 'email',

  -- The business's answer. The only part of a row that ever changes.
  status             public.complaint_status not null default 'pending',
  response           text,
  responded_at       timestamptz,
  responded_by       uuid,

  -- Fifteen business days, non-extendable, from the day after filing.
  due_on             date                    not null,
  created_at         timestamptz             not null default now(),
  updated_at         timestamptz             not null default now(),

  constraint complaints_pkey primary key (id),
  constraint complaints_tenant_id_fkey
    foreign key (tenant_id) references public.tenants (id) on delete cascade,
  constraint complaints_location_id_fkey
    foreign key (location_id) references public.locations (id) on delete set null,
  constraint complaints_responded_by_fkey
    foreign key (responded_by) references auth.users (id) on delete set null,
  constraint complaints_tenant_number_key unique (tenant_id, number),

  constraint complaints_number_positive check (number > 0),
  constraint complaints_document_type_allowed
    check (document_type in ('DNI', 'CE', 'PASAPORTE', 'RUC')),
  constraint complaints_item_type_allowed check (item_type in ('producto', 'servicio')),
  constraint complaints_response_channel_allowed check (response_channel in ('email', 'address')),
  constraint complaints_amount_range
    check (amount_cents is null or amount_cents between 0 and 10000000000),
  constraint complaints_email_format
    check (char_length(consumer_email) <= 200 and consumer_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  constraint complaints_phone_format check (consumer_phone ~ '^\+?[0-9]{6,20}$'),
  -- A minor files through a parent or guardian, who has to be named.
  constraint complaints_minor_has_guardian
    check (not is_minor or char_length(btrim(coalesce(guardian_name, ''))) between 1 and 200),
  constraint complaints_text_lengths check (
    char_length(btrim(consumer_name)) between 1 and 200
    and char_length(btrim(consumer_address)) between 1 and 300
    and char_length(btrim(document_number)) between 4 and 20
    and char_length(btrim(item_description)) between 1 and 1000
    and char_length(btrim(detail)) between 1 and 3000
    and char_length(btrim(consumer_request)) between 1 and 2000
    and char_length(btrim(provider_name)) between 1 and 200
    and coalesce(char_length(order_reference), 0) <= 60
    and coalesce(char_length(provider_address), 0) <= 400
    and coalesce(char_length(response), 0) <= 5000
  ),
  -- Answered means there is an answer, a moment and nothing else.
  constraint complaints_answer_fields check (
    (status = 'answered') = (response is not null and responded_at is not null)
  )
);

comment on table public.complaints is
  'Libro de Reclamaciones. Filed only through submit_complaint(); never deleted; only the answer is editable (Phase 30).';
comment on column public.complaints.due_on is
  '15 business days (Mon-Fri) from the day after filing, Lima time. National holidays are not modelled.';

create index complaints_tenant_status_idx on public.complaints (tenant_id, status, created_at desc);

create trigger complaints_set_updated_at
  before update on public.complaints
  for each row execute function public.set_updated_at();

-- The response deadline: 15 business days, counted from the next business day
-- after filing, in Lima. Weekends are skipped; holidays are not known to the
-- database, so the date can be up to a few days EARLY around a feriado - which
-- is the safe direction for a deadline.
create or replace function public.complaint_due_date(p_filed_at timestamptz)
returns date
language plpgsql
-- Stable, not immutable: a conversion through a named time zone depends on the
-- zone rules the server has installed.
stable
set search_path = ''
as $$
declare
  v_day   date := (p_filed_at at time zone 'America/Lima')::date;
  v_count integer := 0;
begin
  while v_count < 15 loop
    v_day := v_day + 1;
    if extract(isodow from v_day) < 6 then
      v_count := v_count + 1;
    end if;
  end loop;
  return v_day;
end;
$$;

comment on function public.complaint_due_date(timestamptz) is
  'Filing date + 15 business days (Mon-Fri), Lima time. D.S. 101-2022-PCM.';

-- Per-tenant correlative, the same `max + 1` arbitrated by a unique index that
-- orders use (Phase 13), and the due date from the filing moment.
create or replace function public.prepare_complaint()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select coalesce(max(c.number), 0) + 1 into new.number
  from public.complaints as c
  where c.tenant_id = new.tenant_id;

  new.due_on := public.complaint_due_date(new.created_at);
  new.status := 'pending';
  new.response := null;
  new.responded_at := null;
  new.responded_by := null;
  return new;
end;
$$;

create trigger complaints_prepare
  before insert on public.complaints
  for each row execute function public.prepare_complaint();

-- The book cannot be rewritten. Everything a consumer filed is pinned to its
-- old value on UPDATE; only the answer moves, and it stamps who and when.
create or replace function public.guard_complaint_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_answer text := nullif(btrim(coalesce(new.response, '')), '');
begin
  if (to_jsonb(new) - array['response', 'status', 'responded_at', 'responded_by', 'updated_at'])
     is distinct from
     (to_jsonb(old) - array['response', 'status', 'responded_at', 'responded_by', 'updated_at']) then
    raise exception 'A filed complaint cannot be altered; only its answer can.'
      using errcode = '42501';
  end if;

  if v_answer is null then
    new.response := null;
    new.status := 'pending';
    new.responded_at := null;
    new.responded_by := null;
  else
    new.response := v_answer;
    new.status := 'answered';
    if old.response is distinct from v_answer then
      new.responded_at := now();
      new.responded_by := auth.uid();
    else
      new.responded_at := old.responded_at;
      new.responded_by := old.responded_by;
    end if;
  end if;

  return new;
end;
$$;

create trigger complaints_guard_update
  before update on public.complaints
  for each row execute function public.guard_complaint_update();

alter table public.complaints enable row level security;

create policy complaints_select_viewer
  on public.complaints for select to authenticated
  using (public.has_permission(tenant_id, 'complaints.view'));

-- UPDATE for the answer, and the trigger above is what keeps it to the answer.
-- No INSERT policy (filing goes through the function) and no DELETE policy at
-- all: the norm requires the book to be kept.
create policy complaints_update_manager
  on public.complaints for update to authenticated
  using (public.has_permission(tenant_id, 'complaints.manage'))
  with check (public.has_permission(tenant_id, 'complaints.manage'));

-- Filing. Open to anyone, with or without an account, as the norm requires.
--
-- The tenant is an argument supplied by the server from the hostname. Returns
-- the sheet's number, the filing moment and the due date: the constancia the
-- consumer has to be given.
create or replace function public.submit_complaint(p_tenant_id uuid, p_data jsonb)
returns table (complaint_number integer, filed_at timestamptz, due_on date)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_settings   public.tenant_settings%rowtype;
  v_tenant     text;
  v_address    text;
  v_phone      text;
  v_amount     bigint;
  v_incident   date;
  v_row        public.complaints%rowtype;
  v_field      text;
  v_attempt    integer;
begin
  if p_tenant_id is null or not public.is_tenant_public(p_tenant_id) then
    raise exception 'STORE_UNAVAILABLE' using errcode = 'P0001';
  end if;

  if p_data is null or jsonb_typeof(p_data) <> 'object' then
    raise exception 'INVALID_COMPLAINT' using errcode = 'P0001';
  end if;

  foreach v_field in array array[
    'consumerName', 'consumerAddress', 'documentType', 'documentNumber', 'consumerEmail',
    'consumerPhone', 'itemType', 'itemDescription', 'type', 'detail', 'consumerRequest'
  ] loop
    if btrim(coalesce(p_data ->> v_field, '')) = '' then
      raise exception 'MISSING_FIELD' using errcode = 'P0001', hint = v_field;
    end if;
  end loop;

  select * into v_settings from public.tenant_settings as s where s.tenant_id = p_tenant_id;
  select t.name into v_tenant from public.tenants as t where t.id = p_tenant_id;

  v_address := nullif(concat_ws(', ',
    nullif(btrim(coalesce(v_settings.address_line, '')), ''),
    nullif(btrim(coalesce(v_settings.district, '')), ''),
    nullif(btrim(coalesce(v_settings.city, '')), '')
  ), '');

  v_phone := regexp_replace(p_data ->> 'consumerPhone', '[^0-9+]', '', 'g');

  begin
    v_amount := nullif(p_data ->> 'amountCents', '')::bigint;
    v_incident := nullif(p_data ->> 'incidentDate', '')::date;
  exception when others then
    raise exception 'INVALID_COMPLAINT' using errcode = 'P0001';
  end;

  for v_attempt in 1..3 loop
    begin
      insert into public.complaints (
        tenant_id, number, provider_name, provider_tax_id, provider_address, location_id,
        consumer_name, consumer_address, document_type, document_number, consumer_email,
        consumer_phone, is_minor, guardian_name,
        item_type, amount_cents, item_description, order_reference, incident_date,
        type, detail, consumer_request, response_channel, due_on
      )
      values (
        p_tenant_id, 1,
        coalesce(nullif(btrim(coalesce(v_settings.legal_name, '')), ''),
                 nullif(btrim(coalesce(v_settings.trade_name, '')), ''),
                 v_tenant),
        v_settings.tax_id,
        v_address,
        public.storefront_location(p_tenant_id),
        btrim(p_data ->> 'consumerName'),
        btrim(p_data ->> 'consumerAddress'),
        upper(btrim(p_data ->> 'documentType')),
        upper(regexp_replace(p_data ->> 'documentNumber', '\s', '', 'g')),
        lower(btrim(p_data ->> 'consumerEmail')),
        v_phone,
        coalesce((p_data ->> 'isMinor')::boolean, false),
        nullif(btrim(coalesce(p_data ->> 'guardianName', '')), ''),
        lower(btrim(p_data ->> 'itemType')),
        v_amount,
        btrim(p_data ->> 'itemDescription'),
        nullif(btrim(coalesce(p_data ->> 'orderReference', '')), ''),
        v_incident,
        (p_data ->> 'type')::public.complaint_type,
        btrim(p_data ->> 'detail'),
        btrim(p_data ->> 'consumerRequest'),
        coalesce(nullif(p_data ->> 'responseChannel', ''), 'email'),
        -- Placeholders; `prepare_complaint` computes both.
        current_date
      )
      returning * into v_row;
      exit;
    exception
      when unique_violation then
        if v_attempt = 3 then
          raise;
        end if;
      when check_violation or invalid_text_representation then
        raise exception 'INVALID_COMPLAINT' using errcode = 'P0001';
    end;
  end loop;

  complaint_number := v_row.number;
  filed_at := v_row.created_at;
  due_on := v_row.due_on;
  return next;
end;
$$;

comment on function public.submit_complaint(uuid, jsonb) is
  'Files a Libro de Reclamaciones sheet for a public tenant. Open to anon; the only writer of complaints.';

revoke execute on function public.submit_complaint(uuid, jsonb) from public;
grant execute on function public.submit_complaint(uuid, jsonb) to anon, authenticated;
