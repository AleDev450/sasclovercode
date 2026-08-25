-- Phase 07 - Navigation + CMS
-- The administrable navbar, with a two-level hierarchy.
--
-- SPEC: docs/specs/phase-07-navigation-cms.md sections 8, 11.

create type public.nav_link_type as enum ('page', 'external');

create table public.navigation_items (
  id           uuid                  not null default gen_random_uuid(),
  tenant_id    uuid                  not null,
  parent_id    uuid,
  label        text                  not null,
  link_type    public.nav_link_type  not null,
  page_id      uuid,
  external_url text,
  position     smallint              not null default 0,
  is_active    boolean               not null default true,
  created_at   timestamptz           not null default now(),
  updated_at   timestamptz           not null default now(),

  constraint navigation_items_pkey primary key (id),
  constraint navigation_items_tenant_id_fkey
    foreign key (tenant_id) references public.tenants (id) on delete cascade,
  -- A child disappears with its parent. The alternative - orphans promoted to
  -- the top level - would silently publish an entry nobody chose to show.
  constraint navigation_items_parent_id_fkey
    foreign key (parent_id) references public.navigation_items (id) on delete cascade,
  constraint navigation_items_page_id_fkey
    foreign key (page_id) references public.pages (id) on delete cascade,

  constraint navigation_items_label_length
    check (char_length(btrim(label)) between 1 and 60),

  -- Exactly one target, matching the declared type. Without this a row could
  -- claim to be a page link and carry a URL, and the renderer would have to
  -- guess which one to believe.
  constraint navigation_items_target_matches_type check (
    (link_type = 'page' and page_id is not null and external_url is null)
    or (link_type = 'external' and external_url is not null and page_id is null)
  ),

  -- https only. `javascript:` in a navbar is stored XSS with extra steps, and
  -- plain http on a business site is a downgrade waiting to happen.
  constraint navigation_items_external_url_https
    check (external_url is null or external_url ~ '^https://'),
  constraint navigation_items_external_url_length
    check (external_url is null or char_length(external_url) between 12 and 500),

  -- The cheap half of the cycle guard. The rest needs other rows, so it lives
  -- in the trigger below.
  constraint navigation_items_not_own_parent check (parent_id is null or parent_id <> id),

  constraint navigation_items_position_range check (position between 0 and 1000)
);

comment on table public.navigation_items is
  'Navbar entries. Two levels at most: master section 33 says padre/hijo.';

create index navigation_items_tenant_parent_position_idx
  on public.navigation_items (tenant_id, parent_id, position);

create trigger navigation_items_set_updated_at
  before update on public.navigation_items
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Hierarchy guard
-- ---------------------------------------------------------------------------

-- A CHECK constraint may only look at its own row, so depth and cycles need a
-- trigger. Both matter for the same reason: the renderer walks this tree, and a
-- cycle would hang the request that renders a public page.
create or replace function public.check_navigation_hierarchy()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_parent record;
begin
  if new.parent_id is null then
    return new;
  end if;

  select id, tenant_id, parent_id into v_parent
  from public.navigation_items
  where id = new.parent_id;

  if v_parent.id is null then
    raise exception 'Parent navigation item does not exist.' using errcode = 'P0002';
  end if;

  -- A parent from another business would put one tenant's label inside
  -- another's navbar.
  if v_parent.tenant_id <> new.tenant_id then
    raise exception 'A navigation item cannot be nested under another tenant.'
      using errcode = '42501';
  end if;

  -- Two levels, exactly as master section 33 words it: padre/hijo. A parent
  -- that already has a parent would make three.
  if v_parent.parent_id is not null then
    raise exception 'Navigation supports two levels only.' using errcode = '23514';
  end if;

  -- With depth capped at two, the only cycle possible is a direct one, and the
  -- CHECK already rejects self-parenting. This closes the remaining case: A is
  -- the parent of B, and B is being made the parent of A.
  if exists (
    select 1 from public.navigation_items
    where id = new.parent_id and parent_id = new.id
  ) then
    raise exception 'Navigation hierarchy would form a cycle.' using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger navigation_items_check_hierarchy
  before insert or update on public.navigation_items
  for each row execute function public.check_navigation_hierarchy();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.navigation_items enable row level security;

create policy navigation_items_select_member
  on public.navigation_items for select to authenticated
  using (public.has_permission(tenant_id, 'content.view'));

create policy navigation_items_write_manager
  on public.navigation_items for all to authenticated
  using (public.has_permission(tenant_id, 'content.manage'))
  with check (public.has_permission(tenant_id, 'content.manage'));
