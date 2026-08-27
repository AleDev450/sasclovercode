-- Phase 11 - Catalog
-- The public identity function gains the currency.
--
-- SPEC: docs/specs/phase-11-catalog.md CA-14.
--
-- The public website now shows prices, and a price without a currency is not a
-- price. The currency lives once per business in `tenant_settings.currency`
-- (Phase 06) - deliberately not on every product row, so two rows can never
-- disagree - and `tenant_settings` has no public policy, because the RUC and
-- the contact email sit in the same row (ADR-012).
--
-- So it comes out through the same narrow function as the rest of the public
-- identity, which is exactly what that function exists for: adding a field here
-- is a decision somebody makes on purpose, where a policy change would not be.
--
-- The return type changes, so this is a DROP and CREATE rather than a REPLACE.
-- Nothing depends on it in the database - it is called from the application -
-- so the drop is safe within the transaction that recreates it.

drop function if exists public.get_public_business_identity(uuid);

create function public.get_public_business_identity(p_tenant_id uuid)
returns table (
  trade_name   text,
  address_line text,
  district     text,
  city         text,
  phone        text,
  currency     text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce(s.trade_name, t.name),
    s.address_line,
    s.district,
    s.city,
    s.phone,
    -- Defaulted rather than nullable: a site that momentarily could not read
    -- the settings row would otherwise render prices with no currency at all,
    -- which is worse than rendering them with the platform's default market.
    coalesce(s.currency, 'PEN')::text
  from public.tenants as t
  left join public.tenant_settings as s on s.tenant_id = t.id
  where t.id = p_tenant_id
    and t.status = 'active';
$$;

comment on function public.get_public_business_identity(uuid) is
  'The public-facing identity of a business, including the currency its prices '
  'are in. Never returns tax_id, legal_name or contact_email: dashboard only.';

revoke execute on function public.get_public_business_identity(uuid) from public;
grant execute on function public.get_public_business_identity(uuid) to anon, authenticated;
