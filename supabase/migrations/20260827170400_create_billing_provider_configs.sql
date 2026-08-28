-- Phase 17 - Electronic Billing / SUNAT
-- Which provider a tenant uses, its series, and its credentials in Vault.
--
-- SPEC: docs/specs/phase-17-billing-sunat.md sections 8, 11.
-- ADR-021 section 4: credentials are a Vault secret id, not a jsonb column.
-- There is a function to WRITE one and a function to check one EXISTS.
-- There is deliberately no function to read one back.

create table public.billing_provider_configs (
  -- One row per tenant, the same singleton shape tenant_settings (Phase 06)
  -- uses: a business has exactly one billing configuration.
  tenant_id               uuid        not null,
  provider_name           text        not null default 'manual',
  is_active               boolean     not null default true,

  -- Overrides of default_billing_series() (previous migration). NULL means
  -- "use the default" - a tenant never has to visit this screen to issue a
  -- first document.
  series_boleta           text,
  series_factura          text,
  series_nota_credito     text,
  series_nota_debito      text,

  -- A Supabase Vault secret id. The credential itself never sits in this
  -- table, or in any table.
  credentials_secret_id   uuid,
  credentials_updated_at  timestamptz,

  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),

  constraint billing_provider_configs_pkey primary key (tenant_id),
  constraint billing_provider_configs_tenant_id_fkey
    foreign key (tenant_id) references public.tenants (id) on delete cascade,

  constraint billing_provider_configs_provider_name_length
    check (char_length(btrim(provider_name)) between 1 and 40),
  constraint billing_provider_configs_series_boleta_length
    check (coalesce(char_length(series_boleta), 1) between 1 and 20),
  constraint billing_provider_configs_series_factura_length
    check (coalesce(char_length(series_factura), 1) between 1 and 20),
  constraint billing_provider_configs_series_nota_credito_length
    check (coalesce(char_length(series_nota_credito), 1) between 1 and 20),
  constraint billing_provider_configs_series_nota_debito_length
    check (coalesce(char_length(series_nota_debito), 1) between 1 and 20)
);

comment on table public.billing_provider_configs is
  'One row per tenant: which BillingProvider it uses, its document series, and a Vault reference for its credentials (ADR-021). Never the credential itself.';
comment on column public.billing_provider_configs.credentials_secret_id is
  'A Supabase Vault secret id, set only via set_billing_credentials(). No function reads the value back.';

create trigger billing_provider_configs_set_updated_at
  before update on public.billing_provider_configs
  for each row execute function public.set_updated_at();

-- Every tenant gets one, the way it already gets settings, a theme and a
-- first location (Phase 06/08/10) - `provider_name = 'manual'` needs no
-- setup, so this never blocks a first document on a screen nobody has found
-- yet.
insert into public.billing_provider_configs (tenant_id)
select t.id from public.tenants as t
where not exists (
  select 1 from public.billing_provider_configs as c where c.tenant_id = t.id
);

create or replace function public.create_tenant_defaults()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.tenant_settings (tenant_id, trade_name)
  values (new.id, new.name)
  on conflict (tenant_id) do nothing;

  insert into public.tenant_themes (tenant_id)
  values (new.id)
  on conflict (tenant_id) do nothing;

  insert into public.tenant_seo (tenant_id)
  values (new.id)
  on conflict (tenant_id) do nothing;

  insert into public.locations (tenant_id, name)
  values (new.id, new.name)
  on conflict (tenant_id, lower(btrim(name))) do nothing;

  -- Added in Phase 17.
  insert into public.billing_provider_configs (tenant_id)
  values (new.id)
  on conflict (tenant_id) do nothing;

  return new;
end;
$$;

comment on function public.create_tenant_defaults() is
  'Gives every new tenant its settings, theme, SEO row, first location and billing config, however it was created.';

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.billing_provider_configs enable row level security;

create policy billing_provider_configs_select_manager
  on public.billing_provider_configs for select to authenticated
  using (public.has_permission(tenant_id, 'billing.manage'));

create policy billing_provider_configs_update_manager
  on public.billing_provider_configs for update to authenticated
  using (public.has_permission(tenant_id, 'billing.manage'))
  with check (public.has_permission(tenant_id, 'billing.manage'));

-- No INSERT policy for a direct caller: every tenant already gets its row
-- from provisioning (above), and creating a second one for the same tenant
-- is refused by the primary key regardless.
-- No DELETE policy: a tenant reconfigures by updating, never by removing
-- the row a document's series lookup depends on.

-- ---------------------------------------------------------------------------
-- Credentials, through Vault, never through a plain column
-- ---------------------------------------------------------------------------

-- Writes (or rotates) the credential. The only function that ever touches
-- the plaintext value; it is never returned, logged, or stored outside
-- Vault's own encrypted table.
create or replace function public.set_billing_credentials(p_tenant_id uuid, p_credentials text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing_secret_id uuid;
  v_secret_id           uuid;
begin
  if not public.has_permission(p_tenant_id, 'billing.manage') then
    raise exception 'Not allowed to manage billing for this tenant.' using errcode = '42501';
  end if;

  if p_credentials is null or btrim(p_credentials) = '' then
    raise exception 'Credentials cannot be empty.' using errcode = '23514';
  end if;

  select credentials_secret_id into v_existing_secret_id
  from public.billing_provider_configs
  where tenant_id = p_tenant_id;

  if v_existing_secret_id is not null then
    perform vault.update_secret(v_existing_secret_id, p_credentials);
    v_secret_id := v_existing_secret_id;
  else
    v_secret_id := vault.create_secret(
      p_credentials,
      'billing_provider:' || p_tenant_id::text,
      'CloverCode billing provider credentials'
    );
  end if;

  update public.billing_provider_configs
  set credentials_secret_id = v_secret_id, credentials_updated_at = now()
  where tenant_id = p_tenant_id;
end;
$$;

comment on function public.set_billing_credentials(uuid, text) is
  'Writes or rotates a tenant''s billing provider credential in Vault. The only function that ever sees the plaintext (ADR-021).';

revoke execute on function public.set_billing_credentials(uuid, text) from public;
grant execute on function public.set_billing_credentials(uuid, text) to authenticated;

-- Presence, never the value. What every screen this phase builds actually
-- needs to know: "is something configured", not "what is it".
create or replace function public.has_billing_credentials(p_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.billing_provider_configs
    where tenant_id = p_tenant_id and credentials_secret_id is not null
  ) and public.has_permission(p_tenant_id, 'billing.manage');
$$;

comment on function public.has_billing_credentials(uuid) is
  'True when a credential is configured. Never reveals it - there is deliberately no matching read function.';

revoke execute on function public.has_billing_credentials(uuid) from public;
grant execute on function public.has_billing_credentials(uuid) to authenticated;

-- Clears a credential (a business switching providers, or removing one).
-- Deletes the Vault secret outright rather than leaving an orphan.
--
-- No `vault.delete_secret()` wrapper exists in this Supabase Vault version -
-- confirmed against a live local stack (`\df vault.*` lists only
-- `create_secret`/`update_secret`), not assumed from memory. `vault.secrets`
-- is a plain table with a primary key, and this function's owner has DELETE
-- on it, so deleting the row directly is the supported path.
create or replace function public.clear_billing_credentials(p_tenant_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret_id uuid;
begin
  if not public.has_permission(p_tenant_id, 'billing.manage') then
    raise exception 'Not allowed to manage billing for this tenant.' using errcode = '42501';
  end if;

  select credentials_secret_id into v_secret_id
  from public.billing_provider_configs
  where tenant_id = p_tenant_id;

  update public.billing_provider_configs
  set credentials_secret_id = null, credentials_updated_at = null
  where tenant_id = p_tenant_id;

  if v_secret_id is not null then
    delete from vault.secrets where id = v_secret_id;
  end if;
end;
$$;

comment on function public.clear_billing_credentials(uuid) is
  'Removes a tenant''s billing provider credential from Vault entirely.';

revoke execute on function public.clear_billing_credentials(uuid) from public;
grant execute on function public.clear_billing_credentials(uuid) to authenticated;
