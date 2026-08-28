import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card, EmptyState } from "@/components/ui";
import { formatCurrency } from "@/lib/money";
import { PERMISSIONS } from "@/lib/permissions";
import { hasPermission } from "@/lib/permissions/check";
import { requireActiveTenant } from "@/lib/tenant/active";
import {
  BILLING_DOCUMENT_STATUS_LABELS,
  BILLING_DOCUMENT_STATUSES,
  BILLING_DOCUMENT_TYPE_LABELS,
  BILLING_DOCUMENT_TYPES,
} from "@/modules/billing/lifecycle";
import { listBillingDocuments } from "@/modules/billing/server/queries";
import { getBusinessSettings } from "@/modules/settings/server/queries";
import type { BillingDocumentStatus } from "@/types/database";

export const metadata = { title: "Facturacion" };

const STATUS_VARIANT: Record<BillingDocumentStatus, "neutral" | "warning" | "success" | "destructive"> = {
  pending: "neutral",
  sent: "warning",
  accepted: "success",
  rejected: "destructive",
  cancelled: "neutral",
};

export default async function BillingDocumentsPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { tenantSlug } = await params;
  const tenant = await requireActiveTenant(tenantSlug);

  if (!(await hasPermission(tenant.id, PERMISSIONS.BILLING_VIEW))) {
    notFound();
  }

  const raw = await searchParams;
  const readParam = (key: string): string | undefined => {
    const value = raw[key];
    return Array.isArray(value) ? value[0] : value;
  };

  const statusParam = readParam("estado");
  const typeParam = readParam("tipo");
  const status = BILLING_DOCUMENT_STATUSES.find((s) => s === statusParam);
  const type = BILLING_DOCUMENT_TYPES.find((t) => t === typeParam);
  const page = Math.max(1, Number.parseInt(readParam("page") ?? "1", 10) || 1);

  const [{ documents, total, pageCount }, settings] = await Promise.all([
    listBillingDocuments(tenant.id, { status, type, page }),
    getBusinessSettings(tenant.id),
  ]);

  const hrefWith = (overrides: Record<string, string | null>): string => {
    const query = new URLSearchParams();
    if (status !== undefined) query.set("estado", status);
    if (type !== undefined) query.set("tipo", type);
    if (page > 1) query.set("page", String(page));
    for (const [key, value] of Object.entries(overrides)) {
      if (value === null) query.delete(key);
      else query.set(key, value);
    }
    const suffix = query.toString();
    return `/dashboard/${tenant.slug}/facturacion${suffix.length > 0 ? `?${suffix}` : ""}`;
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Facturacion</h1>
        <p className="text-muted-foreground text-sm">
          Boletas, facturas y notas de {tenant.name}. Emitelas desde el detalle de cada pedido.
        </p>
      </div>

      <Card>
        <form method="get" className="flex flex-wrap items-end gap-4 p-6">
          <div className="flex flex-col gap-2">
            <label htmlFor="estado" className="text-sm font-medium">
              Estado
            </label>
            <select
              id="estado"
              name="estado"
              defaultValue={status ?? ""}
              className="border-input bg-background h-10 rounded-md border px-3 text-sm"
            >
              <option value="">Todos</option>
              {BILLING_DOCUMENT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {BILLING_DOCUMENT_STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-2">
            <label htmlFor="tipo" className="text-sm font-medium">
              Tipo
            </label>
            <select
              id="tipo"
              name="tipo"
              defaultValue={type ?? ""}
              className="border-input bg-background h-10 rounded-md border px-3 text-sm"
            >
              <option value="">Todos</option>
              {BILLING_DOCUMENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {BILLING_DOCUMENT_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </div>

          <button
            type="submit"
            className="bg-secondary text-secondary-foreground h-10 rounded-md px-4 text-sm"
          >
            Filtrar
          </button>
        </form>
      </Card>

      {documents.length === 0 ? (
        <EmptyState
          title={status !== undefined || type !== undefined ? "Sin comprobantes con ese filtro" : "Aun no hay comprobantes"}
          description={
            status !== undefined || type !== undefined
              ? "Prueba con otro filtro o quitalo."
              : "Emite una boleta o factura desde el detalle de un pedido."
          }
          action={
            status !== undefined || type !== undefined ? (
              <Link href={hrefWith({ estado: null, tipo: null, page: null })} className="text-sm hover:underline">
                Quitar los filtros
              </Link>
            ) : undefined
          }
        />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[44rem] border-collapse text-sm">
            <caption className="sr-only">Comprobantes de {tenant.name}</caption>
            <thead>
              <tr className="border-border text-muted-foreground border-b text-left text-xs">
                <th scope="col" className="px-4 py-3 font-medium">
                  Comprobante
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Pedido
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Cliente
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Estado
                </th>
                <th scope="col" className="px-4 py-3 text-right font-medium">
                  Total
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Accion
                </th>
              </tr>
            </thead>
            <tbody>
              {documents.map((doc) => (
                <tr key={doc.id} className="border-border border-b last:border-0">
                  <td className="px-4 py-3 font-medium">
                    {BILLING_DOCUMENT_TYPE_LABELS[doc.type]}{" "}
                    <span className="text-muted-foreground tabular-nums">
                      {doc.series}-{String(doc.number).padStart(6, "0")}
                    </span>
                  </td>
                  <td className="text-muted-foreground px-4 py-3">#{doc.orderNumber}</td>
                  <td className="text-muted-foreground px-4 py-3">{doc.customerName ?? "Sin cliente"}</td>
                  <td className="px-4 py-3">
                    <Badge variant={STATUS_VARIANT[doc.status]}>
                      {BILLING_DOCUMENT_STATUS_LABELS[doc.status]}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {formatCurrency(doc.totalCents, settings.currency)}
                  </td>
                  <td className="px-4 py-3">
                    <Link href={`/dashboard/${tenant.slug}/pedidos/${doc.orderId}`} className="text-sm hover:underline">
                      Ver pedido
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {pageCount > 1 ? (
        <nav className="flex items-center justify-between text-sm" aria-label="Paginacion">
          <span className="text-muted-foreground">
            Pagina {page} de {pageCount} — {total} comprobantes
          </span>
          <span className="flex gap-4">
            {page > 1 ? (
              <Link href={hrefWith({ page: String(page - 1) })} className="hover:underline">
                Anterior
              </Link>
            ) : null}
            {page < pageCount ? (
              <Link href={hrefWith({ page: String(page + 1) })} className="hover:underline">
                Siguiente
              </Link>
            ) : null}
          </span>
        </nav>
      ) : null}
    </div>
  );
}
