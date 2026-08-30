import Link from "next/link";
import { notFound } from "next/navigation";
import { PERMISSIONS } from "@/lib/permissions";
import { hasPermission } from "@/lib/permissions/check";
import { MODULES } from "@/lib/features";
import { hasFeature } from "@/lib/features/check";
import { requireActiveTenant } from "@/lib/tenant/active";
import { listCategories, listProductsWithVariants } from "@/modules/catalog/server/queries";
import { listLocations } from "@/modules/locations/server/queries";
import { listOpenSessionsForLocation, listPaymentMethods } from "@/modules/payments/server/queries";
import { PosScreen } from "@/modules/pos/components/pos-screen";
import { getBusinessSettings } from "@/modules/settings/server/queries";

export const metadata = { title: "Punto de venta" };

/**
 * Master section 33 (Phase 15): tablet, desktop, touch, quick search,
 * categories, cart, customer, payment, printing, cash - built entirely on
 * what Phases 10-14 already provide. No new table, no new permission: this
 * page requires `orders.create` (build the sale) the same way `/pedidos`'s
 * own form does, and shows checkout only to whoever also holds
 * `payments.create` (ADR-019).
 */
export default async function PosPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string }>;
  searchParams: Promise<{ sede?: string }>;
}) {
  const { tenantSlug } = await params;
  const { sede } = await searchParams;
  const tenant = await requireActiveTenant(tenantSlug);

  // Phase 21: the plan decides before the person does. 404, not 403 - the
  // same posture every permission guard here takes toward a section that is
  // not yours to know about.
  if (!(await hasFeature(tenant.id, MODULES.POS))) {
    notFound();
  }

  if (!(await hasPermission(tenant.id, PERMISSIONS.ORDERS_CREATE))) {
    notFound();
  }

  const [categories, products, locations, settings, canCheckout] = await Promise.all([
    listCategories(tenant.id),
    listProductsWithVariants(tenant.id),
    listLocations(tenant.id),
    getBusinessSettings(tenant.id),
    hasPermission(tenant.id, PERMISSIONS.PAYMENTS_CREATE),
  ]);

  const activeLocations = locations.filter((location) => location.isActive);

  // One location: never ask. Several: the URL decides, so a terminal can be
  // bookmarked to its own branch - same posture as `?estado=`/`?sede=` on
  // the orders listing (Phase 13).
  const resolvedLocation =
    activeLocations.length === 1
      ? activeLocations[0]!
      : (activeLocations.find((location) => location.id === sede) ?? null);

  if (activeLocations.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">Punto de venta</h1>
        <p className="text-muted-foreground text-sm">
          No hay ninguna sede activa todavia.{" "}
          <Link href={`/dashboard/${tenant.slug}/sedes`} className="underline">
            Crea una sede
          </Link>{" "}
          para empezar a vender.
        </p>
      </div>
    );
  }

  if (resolvedLocation === null) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">Punto de venta</h1>
        <p className="text-muted-foreground text-sm">Elige una sede para abrir la caja rapida.</p>
        <div className="flex flex-wrap gap-2">
          {activeLocations.map((location) => (
            <Link
              key={location.id}
              href={`/dashboard/${tenant.slug}/pos?sede=${location.id}`}
              className="border-border hover:bg-accent rounded-md border px-4 py-3 text-sm font-medium"
            >
              {location.name}
            </Link>
          ))}
        </div>
      </div>
    );
  }

  const openSessions = canCheckout
    ? await listOpenSessionsForLocation(tenant.id, resolvedLocation.id)
    : [];
  const paymentMethods = canCheckout
    ? await listPaymentMethods(tenant.id, { activeOnly: true })
    : [];

  return (
    <PosScreen
      tenantSlug={tenant.slug}
      locationId={resolvedLocation.id}
      locationName={resolvedLocation.name}
      showLocationSwitcher={activeLocations.length > 1}
      locations={activeLocations.map((location) => ({ id: location.id, name: location.name }))}
      categories={categories.map((category) => ({ id: category.id, name: category.name }))}
      products={products.map((product) => ({
        id: product.id,
        categoryId: product.categoryId,
        name: product.name,
        basePriceCents: product.basePriceCents,
        isAvailable: product.isAvailable,
        variants: product.variants.map((variant) => ({
          id: variant.id,
          name: variant.name,
          priceCents: variant.priceCents,
        })),
      }))}
      currency={settings.currency}
      canCheckout={canCheckout}
      paymentMethods={paymentMethods.map((method) => ({
        id: method.id,
        name: method.name,
        type: method.type,
      }))}
      openSessions={openSessions.map((session) => ({
        id: session.id,
        cashRegisterName: session.cashRegisterName,
      }))}
    />
  );
}
