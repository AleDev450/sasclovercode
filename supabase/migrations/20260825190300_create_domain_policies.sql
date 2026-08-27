-- Phase 09 - Custom Domains
-- What a business may see and remove among its own domains.
--
-- SPEC: docs/specs/phase-09-custom-domains.md sections 8, 10.
--
-- Since Phase 01 this table has had RLS enabled and, for tenant roles, no
-- policies at all: it was readable only through `resolve_tenant_by_domain`.
-- That was right while nobody could manage domains. Now a business has a screen
-- for them, so it needs to read its own rows.
--
-- Note what is NOT here: an UPDATE policy. Every legitimate change goes through
-- the three functions in 20260825190200, which decide what they are willing to
-- write. RLS is row-level, so a policy permissive enough to let a business set
-- `is_primary` would also let it set `verification_status = 'active'` - and
-- that is the state that serves traffic.

-- Read: any member with `domains.view`, and only their own tenant's rows.
create policy tenant_domains_select_member
  on public.tenant_domains for select to authenticated
  using (public.has_permission(tenant_id, 'domains.view'));

-- Delete: a custom domain of one's own tenant that is not the primary one.
--
-- Three conditions, each closing something different:
--
--   the permission     an ordinary member does not disconnect the company's
--                      address
--   type = 'custom'    the system subdomain is the address that always works;
--                      a business that deleted it would be left reachable only
--                      through a custom domain that may itself be broken -
--                      which is exactly when they need the fallback
--   not is_primary     deleting the primary would leave the site with no
--                      canonical URL (Phase 08). Switch first, then delete:
--                      one extra click for a decision worth making explicitly
create policy tenant_domains_delete_manager
  on public.tenant_domains for delete to authenticated
  using (
    type = 'custom'
    and not is_primary
    and public.has_permission(tenant_id, 'domains.manage')
  );

-- No INSERT policy either: `claim_domain` is the only way in, because a plain
-- insert could not enforce the platform-namespace rule, the stale-claim release
-- or the generic conflict message that keeps this table from becoming a way to
-- ask which competitors use CloverCode.
