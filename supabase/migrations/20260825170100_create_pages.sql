-- Phase 07 - Navigation + CMS
-- Pages and the typed sections they are composed of.
--
-- SPEC: docs/specs/phase-07-navigation-cms.md sections 8, 10, 11.

create type public.page_status as enum ('draft', 'published');

-- The initial section types from master section 33. A closed enum and not free
-- text: a section type the renderer does not know is a section that renders as
-- nothing, and there is no reason to let one be stored.
create type public.section_type as enum (
  'hero', 'text', 'image', 'banner', 'cta', 'gallery', 'products', 'faq'
);

-- ---------------------------------------------------------------------------
-- pages
-- ---------------------------------------------------------------------------

create table public.pages (
  id         uuid               not null default gen_random_uuid(),
  tenant_id  uuid               not null,
  slug       text               not null,
  title      text               not null,
  status     public.page_status not null default 'draft',
  created_at timestamptz        not null default now(),
  updated_at timestamptz        not null default now(),

  constraint pages_pkey primary key (id),
  constraint pages_tenant_id_fkey
    foreign key (tenant_id) references public.tenants (id) on delete cascade,

  -- Tenant-scoped, exactly as master section 11 requires: two businesses may
  -- both have `/nosotros`, because those are two different websites.
  constraint pages_tenant_slug_key unique (tenant_id, slug),

  constraint pages_slug_format check (slug ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?$'),
  constraint pages_slug_length check (char_length(slug) between 1 and 80),
  constraint pages_title_length check (char_length(btrim(title)) between 1 and 200)
);

comment on table public.pages is
  'A page of a tenant public website. Slug is unique per tenant, never globally.';

-- The public renderer asks for one published page of one tenant.
create index pages_tenant_status_idx on public.pages (tenant_id, status);

create trigger pages_set_updated_at
  before update on public.pages
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- page_sections
-- ---------------------------------------------------------------------------

create table public.page_sections (
  id         uuid                not null default gen_random_uuid(),
  page_id    uuid                not null,
  -- Denormalised from the page. Without it every policy on this table would
  -- have to join `pages` to learn whose row it is, and a policy that needs a
  -- join is harder to audit and slower to run. A trigger keeps it in step, so
  -- it cannot drift.
  tenant_id  uuid                not null,
  type       public.section_type not null,
  -- Structured data, never markup. Master section 33: "evitar permitir HTML
  -- arbitrario peligroso". Each type has a fixed shape, validated with Zod
  -- before it is written; JSONB is what master section 7 allows for genuinely
  -- dynamic configuration, and eight tables would be worse.
  content    jsonb               not null default '{}'::jsonb,
  position   smallint            not null default 0,
  is_visible boolean             not null default true,
  created_at timestamptz         not null default now(),
  updated_at timestamptz         not null default now(),

  constraint page_sections_pkey primary key (id),
  constraint page_sections_page_id_fkey
    foreign key (page_id) references public.pages (id) on delete cascade,
  constraint page_sections_tenant_id_fkey
    foreign key (tenant_id) references public.tenants (id) on delete cascade,

  -- An array or a scalar in `content` would break every reader.
  constraint page_sections_content_is_object check (jsonb_typeof(content) = 'object'),
  constraint page_sections_position_range check (position between 0 and 1000)
);

comment on table public.page_sections is
  'Typed, ordered blocks of a page. `content` is structured data, never markup.';

create index page_sections_page_position_idx on public.page_sections (page_id, position);

create trigger page_sections_set_updated_at
  before update on public.page_sections
  for each row execute function public.set_updated_at();

-- Keeps the denormalised tenant honest: it is always the page's tenant, no
-- matter what the caller supplied.
create or replace function public.sync_section_tenant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant_id uuid;
begin
  select p.tenant_id into v_tenant_id from public.pages as p where p.id = new.page_id;

  if v_tenant_id is null then
    raise exception 'Section references a page that does not exist.'
      using errcode = 'P0002';
  end if;

  -- Overwritten rather than validated: a caller has no business choosing it,
  -- and silently correcting is safer than trusting and checking.
  new.tenant_id := v_tenant_id;
  return new;
end;
$$;

create trigger page_sections_sync_tenant
  before insert or update on public.page_sections
  for each row execute function public.sync_section_tenant();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.pages enable row level security;
alter table public.page_sections enable row level security;

-- Members: read with content.view, write with content.manage. Same two
-- functions audited in Phase 03; no new predicate to get wrong.
--
-- The anonymous read policies live in their own migration
-- (20260825170300_create_public_read.sql), because they are the genuinely new
-- thing in this phase and deserve to be read on their own.

create policy pages_select_member
  on public.pages for select to authenticated
  using (public.has_permission(tenant_id, 'content.view'));

create policy pages_write_manager
  on public.pages for all to authenticated
  using (public.has_permission(tenant_id, 'content.manage'))
  with check (public.has_permission(tenant_id, 'content.manage'));

create policy page_sections_select_member
  on public.page_sections for select to authenticated
  using (public.has_permission(tenant_id, 'content.view'));

create policy page_sections_write_manager
  on public.page_sections for all to authenticated
  using (public.has_permission(tenant_id, 'content.manage'))
  with check (public.has_permission(tenant_id, 'content.manage'));
