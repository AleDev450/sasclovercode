import { notFound } from "next/navigation";
import { EmptyState } from "@/components/ui";
import { MODULES } from "@/lib/features";
import { hasFeature } from "@/lib/features/check";
import { logger } from "@/lib/logger";
import { PERMISSIONS } from "@/lib/permissions";
import { hasPermission } from "@/lib/permissions/check";
import { requireActiveTenant } from "@/lib/tenant/active";
import { listLocations } from "@/modules/locations/server/queries";
import { ReportFilters } from "@/modules/reports/components/report-filters";
import {
  CustomerTable,
  DailyTable,
  HourlyTable,
  LocationTable,
  PaymentMethodTable,
  ProductTable,
  SummaryCard,
} from "@/modules/reports/components/report-tables";
import { normaliseRange, rangeDays, rangeForPreset } from "@/modules/reports/ranges";
import { reportFiltersSchema, TOP_LIMIT } from "@/modules/reports/schemas";
import {
  getSalesByDay,
  getSalesByHour,
  getSalesByLocation,
  getSalesByPaymentMethod,
  getSalesSummary,
  getTopCustomers,
  getTopProducts,
} from "@/modules/reports/server/queries";
import { getBusinessSettings } from "@/modules/settings/server/queries";

export const metadata = { title: "Reportes" };

/**
 * The eight dimensions of master section 33.
 *
 * No Server Action anywhere on this page, and that is the point: a report reads
 * and mutates nothing, so the filter is a `GET` and the range lives in the URL.
 *
 * Two gates, both of which answer 404 rather than 403 - the same posture every
 * page in this dashboard takes toward a section that is not yours to know
 * about: the `reports` module (Phase 21) and the `reports.view` permission,
 * which has existed since Phase 03 and governs something for the first time
 * here.
 */
export default async function ReportsPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { tenantSlug } = await params;
  const tenant = await requireActiveTenant(tenantSlug);

  if (!(await hasFeature(tenant.id, MODULES.REPORTS))) {
    notFound();
  }

  if (!(await hasPermission(tenant.id, PERMISSIONS.REPORTS_VIEW))) {
    notFound();
  }

  const raw = await searchParams;
  const readParam = (key: string): string | undefined => {
    const value = raw[key];
    return Array.isArray(value) ? value[0] : value;
  };

  const filters = reportFiltersSchema.parse({
    from: readParam("from"),
    to: readParam("to"),
    preset: readParam("preset"),
    location: readParam("location"),
  });

  // A shortcut wins over an explicit range: it is what the person just clicked.
  const range =
    filters.preset === null
      ? normaliseRange({ from: filters.from, to: filters.to })
      : rangeForPreset(filters.preset);

  logger.info("reports.viewed", {
    tenantId: tenant.id,
    from: range.from,
    to: range.to,
    byLocation: filters.location !== null,
  });

  // Seven aggregates and two lookups, in parallel. Nothing is summed here: the
  // database does every total (ADR-027 decision 1).
  const [settings, locations, summary, byDay, byHour, byLocation, products, customers, byMethod] =
    await Promise.all([
      getBusinessSettings(tenant.id),
      listLocations(tenant.id),
      getSalesSummary(tenant.id, range, filters.location),
      getSalesByDay(tenant.id, range, filters.location),
      getSalesByHour(tenant.id, range, filters.location),
      getSalesByLocation(tenant.id, range),
      getTopProducts(tenant.id, range, filters.location, TOP_LIMIT),
      getTopCustomers(tenant.id, range, TOP_LIMIT),
      getSalesByPaymentMethod(tenant.id, range),
    ]);

  const currency = settings.currency;
  const hasSales = summary.orderCount > 0;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Reportes</h1>
        <p className="text-muted-foreground text-sm">
          Como va {tenant.name}: ventas, productos, horarios, sedes, clientes y medios de pago.
        </p>
      </div>

      <ReportFilters
        tenantSlug={tenant.slug}
        range={range}
        locations={locations.map((location) => ({ id: location.id, name: location.name }))}
        selectedLocation={filters.location}
        activePreset={filters.preset}
      />

      <SummaryCard summary={summary} currency={currency} rangeDays={rangeDays(range)} />

      {!hasSales ? (
        <EmptyState
          title="No hubo ventas completadas en este rango"
          description="Prueba con otro rango, o revisa que los pedidos esten llegando a completados: un pedido en curso todavia no cuenta como venta."
        />
      ) : (
        <>
          <div className="grid gap-6 lg:grid-cols-2">
            <DailyTable rows={byDay} currency={currency} />
            <HourlyTable rows={byHour} currency={currency} />
          </div>

          {/*
           * The branch report only earns its space when there is more than one
           * branch: a single-shop business would be reading its own summary
           * twice. Every tenant has at least one location since ADR-014.
           */}
          {locations.length > 1 ? <LocationTable rows={byLocation} currency={currency} /> : null}

          <div className="grid gap-6 lg:grid-cols-2">
            <ProductTable tenantSlug={tenant.slug} rows={products} currency={currency} />
            <CustomerTable tenantSlug={tenant.slug} rows={customers} currency={currency} />
          </div>

          <PaymentMethodTable rows={byMethod} currency={currency} />
        </>
      )}
    </div>
  );
}
