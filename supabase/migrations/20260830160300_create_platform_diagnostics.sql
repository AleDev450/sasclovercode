-- Phase 24 - Audit + Observability
-- The numbers behind the Super Admin diagnostics screen.
--
-- SPEC: docs/specs/phase-24-audit-observability.md sections 12, 13.
-- ADR-028 decision 6.
-- CLOVERCODE_MASTER.md section 33 (Phase 24): "preparar herramientas de
-- diagnostico para Super Admin"; section 29 lists this among its functions.
--
-- WHAT THIS IS NOT. It is not a metrics exporter. Prometheus or OpenTelemetry
-- would need a collector nobody has stood up, and standing one up is the
-- infrastructure master section 47 says not to decide in advance. Section 26
-- closes it: measure before optimising - and this screen is the first place in
-- the project where there is anything to measure (KL-2405).
--
-- One function, one round trip. Six separate counts would be six queries from
-- a page that renders one card.

create or replace function public.platform_diagnostics()
returns table (
  tenants_total            bigint,
  tenants_active           bigint,
  tenants_suspended        bigint,
  subscriptions_trialing   bigint,
  subscriptions_active     bigint,
  subscriptions_past_due   bigint,
  subscriptions_suspended  bigint,
  orders_last_24h          bigint,
  audit_rows_last_24h      bigint,
  audit_rows_total         bigint,
  overdue_charges          bigint,
  oldest_overdue_due_at    timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  -- The gate, and the ONLY defence: SECURITY DEFINER does not go through RLS,
  -- so this reads across every tenant. The same explicit-gate pattern
  -- `get_tenant_members` established in Phase 03 and every cross-tenant
  -- function since has repeated.
  --
  -- Written as a WHERE rather than an early return so this can stay a plain
  -- SQL function: a caller who is not a platform admin gets no rows, which is
  -- what the screen already handles for a tenant that does not exist.
  select
    (select count(*) from public.tenants),
    (select count(*) from public.tenants where status = 'active'),
    (select count(*) from public.tenants where status = 'suspended'),

    (select count(*) from public.subscriptions where status = 'trialing'),
    (select count(*) from public.subscriptions where status = 'active'),
    (select count(*) from public.subscriptions where status = 'past_due'),
    (select count(*) from public.subscriptions where status = 'suspended'),

    -- Every order, not only completed ones: this is a liveness number - "is
    -- the platform being used right now" - and not a sales report. Sales are
    -- Phase 23's job and count only `completed` (ADR-027 decision 3).
    (select count(*) from public.orders where placed_at >= now() - interval '24 hours'),

    (select count(*) from public.audit_logs where created_at >= now() - interval '24 hours'),
    (select count(*) from public.audit_logs),

    -- A charge that is pending and past its due date. The oldest one is the
    -- number that matters: it says how long collection has been stuck, which
    -- a total does not.
    (select count(*) from public.saas_payments
      where status = 'pending' and due_at < now()),
    (select min(due_at) from public.saas_payments
      where status = 'pending' and due_at < now())
  where public.is_platform_admin();
$$;

comment on function public.platform_diagnostics() is
  'System-wide counters for the Super Admin diagnostics screen. Returns no rows unless the caller is a platform admin.';

revoke execute on function public.platform_diagnostics() from public;
grant execute on function public.platform_diagnostics() to authenticated;
