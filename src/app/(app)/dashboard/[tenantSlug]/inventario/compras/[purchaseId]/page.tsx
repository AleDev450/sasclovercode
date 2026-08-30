import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui";
import { formatCurrency } from "@/lib/money";
import { PERMISSIONS } from "@/lib/permissions";
import { hasPermission } from "@/lib/permissions/check";
import { MODULES } from "@/lib/features";
import { hasFeature } from "@/lib/features/check";
import { requireActiveTenant } from "@/lib/tenant/active";
import { getPurchaseDetail } from "@/modules/inventory/server/queries";
import { getBusinessSettings } from "@/modules/settings/server/queries";

export const metadata = { title: "Compra" };

export default async function PurchaseDetailPage({
  params,
}: {
  params: Promise<{ tenantSlug: string; purchaseId: string }>;
}) {
  const { tenantSlug, purchaseId } = await params;
  const tenant = await requireActiveTenant(tenantSlug);

  // Phase 21: the plan decides before the person does. 404, not 403 - the
  // same posture every permission guard here takes toward a section that is
  // not yours to know about.
  if (!(await hasFeature(tenant.id, MODULES.INVENTORY))) {
    notFound();
  }

  if (!(await hasPermission(tenant.id, PERMISSIONS.PURCHASES_VIEW))) {
    notFound();
  }

  const [purchase, settings] = await Promise.all([
    getPurchaseDetail(tenant.id, purchaseId),
    getBusinessSettings(tenant.id),
  ]);
  if (purchase === null) notFound();

  const money = (cents: number): string => formatCurrency(cents, settings.currency);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href={`/dashboard/${tenant.slug}/inventario/compras`}
          className="text-muted-foreground text-sm hover:underline"
        >
          ← Compras
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">
          Compra a {purchase.supplierName}
        </h1>
        <p className="text-muted-foreground text-sm">
          {new Date(purchase.purchasedAt).toLocaleString("es-PE")} · {purchase.locationName}
          {purchase.reference !== null ? ` · ${purchase.reference}` : ""}
        </p>
        {purchase.notes !== null ? (
          <p className="text-muted-foreground text-sm">{purchase.notes}</p>
        ) : null}
      </div>

      <Card className="overflow-x-auto">
        <CardHeader>
          <CardTitle as="h2">Insumos</CardTitle>
        </CardHeader>
        <CardContent>
          <table className="w-full min-w-[36rem] border-collapse text-sm">
            <caption className="sr-only">Lineas de la compra</caption>
            <thead>
              <tr className="border-border text-muted-foreground border-b text-left text-xs">
                <th scope="col" className="py-2 font-medium">
                  Insumo
                </th>
                <th scope="col" className="py-2 text-right font-medium">
                  Cantidad
                </th>
                <th scope="col" className="py-2 text-right font-medium">
                  Costo unitario
                </th>
                <th scope="col" className="py-2 text-right font-medium">
                  Subtotal
                </th>
              </tr>
            </thead>
            <tbody>
              {purchase.lines.map((line) => (
                <tr key={line.id} className="border-border border-b last:border-0">
                  <td className="py-2">{line.inventoryItemName}</td>
                  <td className="py-2 text-right tabular-nums">
                    {line.quantity} {line.unitAbbreviation}
                  </td>
                  <td className="py-2 text-right tabular-nums">
                    {line.unitCostCents !== null ? money(line.unitCostCents) : "—"}
                  </td>
                  <td className="py-2 text-right tabular-nums">
                    {line.unitCostCents !== null ? money(line.quantity * line.unitCostCents) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="font-medium">
                <td colSpan={3} className="py-2 text-right">
                  Total
                </td>
                <td className="py-2 text-right tabular-nums">{money(purchase.totalCostCents)}</td>
              </tr>
            </tfoot>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
