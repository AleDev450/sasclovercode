-- Phase 17 - Electronic Billing / SUNAT
-- Who moved a document, when, and from where.
--
-- SPEC: docs/specs/phase-17-billing-sunat.md sections 8, 11, 16.
-- Same shape and same reasoning as order_status_history (Phase 13): this is
-- the audit trail of a tax document, written by the database on every
-- transition rather than depending on every caller remembering to log one.

create table public.billing_events (
  id                    uuid        not null default gen_random_uuid(),
  billing_document_id   uuid        not null,
  tenant_id             uuid        not null,

  -- NULL on the first row: a document coming into existence has no previous
  -- state, the same reasoning order_status_history.from_status uses.
  from_status           public.billing_document_status,
  to_status              public.billing_document_status not null,

  message               text,
  created_by            uuid,
  created_at            timestamptz not null default now(),

  constraint billing_events_pkey primary key (id),

  constraint billing_events_document_id_fkey
    foreign key (billing_document_id) references public.billing_documents (id) on delete cascade,
  constraint billing_events_tenant_id_fkey
    foreign key (tenant_id) references public.tenants (id) on delete cascade,
  constraint billing_events_created_by_fkey
    foreign key (created_by) references auth.users (id) on delete set null,

  constraint billing_events_message_length check (coalesce(char_length(message), 0) <= 500),
  constraint billing_events_not_self check (from_status is null or from_status <> to_status)
);

comment on table public.billing_events is
  'Append-only audit trail of a billing document''s lifecycle. Written by trigger, same shape as order_status_history (Phase 13).';

create index billing_events_document_idx on public.billing_events (billing_document_id, created_at);

-- No updated_at, and no trigger for one: nothing here is ever updated.

create or replace function public.record_billing_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.status = old.status then
    return null;
  end if;

  insert into public.billing_events (billing_document_id, tenant_id, from_status, to_status, message, created_by)
  values (
    new.id,
    new.tenant_id,
    case when tg_op = 'INSERT' then null else old.status end,
    new.status,
    case
      when new.status = 'rejected' then new.rejection_reason
      when new.status = 'cancelled' then new.cancel_reason
      else null
    end,
    (select auth.uid())
  );

  return null;
end;
$$;

comment on function public.record_billing_event() is
  'Appends to billing_events on creation and on every status change.';

create trigger billing_documents_record_event
  after insert or update of status on public.billing_documents
  for each row execute function public.record_billing_event();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.billing_events enable row level security;

create policy billing_events_select_member
  on public.billing_events for select to authenticated
  using (public.has_permission(tenant_id, 'billing.view'));

-- INSERT is granted because the trigger runs as the caller for the row it
-- writes (same note as order_status_history_insert_operator, Phase 13): the
-- trigger is the only realistic writer, and a hand-written row would have to
-- name a document the caller can already see.
create policy billing_events_insert_operator
  on public.billing_events for insert to authenticated
  with check (
    public.has_permission(tenant_id, 'billing.create')
    or public.has_permission(tenant_id, 'billing.cancel')
  );

-- No UPDATE policy and no DELETE policy, deliberately and permanently. An
-- audit trail that can be edited is not one.
