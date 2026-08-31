import { notFound } from "next/navigation";
import { EmptyState } from "@/components/ui";
import { logger } from "@/lib/logger";
import { PERMISSIONS } from "@/lib/permissions";
import { hasPermission } from "@/lib/permissions/check";
import { requireActiveTenant } from "@/lib/tenant/active";
import { AuditFilterBar, AuditTable } from "@/modules/audit/components/audit-log";
import { auditFiltersSchema } from "@/modules/audit/schemas";
import { listAuditEntries } from "@/modules/audit/server/queries";
import { getBusinessSettings } from "@/modules/settings/server/queries";

export const metadata = { title: "Auditoria" };

/**
 * Who changed what, in this business.
 *
 * One gate, not two. Every other screen in this dashboard checks a module and a
 * permission, and this one checks only `audit.view` - because auditing is not a
 * capability CloverCode sells. Master section 33 names exactly ten modules in
 * Phase 21, and inventing an eleventh to paywall a compliance record would be
 * both outside that list and the wrong thing to charge for.
 *
 * No Server Action anywhere on this page, and that is the point: the audit is
 * written by triggers and is not writable by anybody (ADR-028 decision 1).
 */
export default async function AuditPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { tenantSlug } = await params;
  const tenant = await requireActiveTenant(tenantSlug);

  if (!(await hasPermission(tenant.id, PERMISSIONS.AUDIT_VIEW))) {
    notFound();
  }

  const raw = await searchParams;
  const readParam = (key: string): string | undefined => {
    const value = raw[key];
    return Array.isArray(value) ? value[0] : value;
  };

  const filters = auditFiltersSchema.parse({
    action: readParam("action"),
    entity: readParam("entity"),
    page: readParam("page"),
  });

  // Looking at the audit is itself worth a log line: it is the one screen where
  // the reader is inspecting other people's work.
  logger.info("audit.viewed", {
    tenantId: tenant.id,
    action: filters.action,
    byEntity: filters.entity !== null,
    page: filters.page,
  });

  const [settings, page] = await Promise.all([
    getBusinessSettings(tenant.id),
    listAuditEntries(tenant.id, filters),
  ]);

  const pageHref = (target: number): string => {
    const params = new URLSearchParams();
    if (filters.action !== null) params.set("action", filters.action);
    if (filters.entity !== null) params.set("entity", filters.entity);
    if (target > 1) params.set("page", String(target));
    const query = params.toString();
    return query.length === 0
      ? `/dashboard/${tenant.slug}/auditoria`
      : `/dashboard/${tenant.slug}/auditoria?${query}`;
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Auditoria</h1>
        <p className="text-muted-foreground text-sm">
          Quien cambio que en {tenant.name}, cuando y desde donde. Este registro lo escribe la base
          de datos y no se puede editar ni borrar.
        </p>
      </div>

      <AuditFilterBar
        tenantSlug={tenant.slug}
        selectedAction={filters.action}
        entityId={filters.entity}
      />

      {page.entries.length === 0 ? (
        <EmptyState
          title="No hay actividad registrada"
          description={
            filters.action === null && filters.entity === null
              ? "Se registran las acciones sensibles: cambios de precio, pedidos anulados, cierres de caja, cambios de rol y de configuracion. Los ultimos 30 dias aparecen aqui."
              : "Ninguna accion coincide con este filtro. Prueba quitandolo."
          }
        />
      ) : (
        <AuditTable page={page} timeZone={settings.timezone} pageHref={pageHref} />
      )}
    </div>
  );
}
