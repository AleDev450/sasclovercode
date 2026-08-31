import Link from "next/link";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui";
import { formatCurrency } from "@/lib/money";
import { formatHour } from "../ranges";
import type {
  CustomerSales,
  DailySales,
  HourlySales,
  LocationSales,
  PaymentMethodSales,
  ProductSales,
  SalesSummary,
} from "../server/queries";

/**
 * The eight dimensions of master section 33, as tables of numbers.
 *
 * No charts: a charting library is a new dependency for an aesthetic problem,
 * and section 47 asks for a measured problem before adding weight (KL-2304).
 * Every number is `tabular-nums` so columns line up, which is most of what a
 * chart was going to buy.
 */

function Figure({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="text-2xl font-semibold tabular-nums">{value}</dd>
      {hint === undefined ? null : <span className="text-muted-foreground text-xs">{hint}</span>}
    </div>
  );
}

/** Sales, orders and average ticket - two of master's dimensions in one card. */
export function SummaryCard({
  summary,
  currency,
  rangeDays,
}: {
  summary: SalesSummary;
  currency: string;
  rangeDays: number;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">Resumen</CardTitle>
        <CardDescription>
          {rangeDays} dia(s). Solo cuenta pedidos <strong>completados</strong>: un pedido en curso
          todavia puede anularse, y el inventario y los puntos se mueven en ese mismo momento.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          <Figure label="Venta neta" value={formatCurrency(summary.netCents, currency)} />
          <Figure label="Pedidos" value={String(summary.orderCount)} />
          <Figure
            label="Ticket promedio"
            value={formatCurrency(summary.averageTicketCents, currency)}
          />
          <Figure
            label="Articulos vendidos"
            value={summary.itemCount.toLocaleString("es-PE")}
            hint={`Bruto ${formatCurrency(summary.grossCents, currency)} · descuentos ${formatCurrency(
              summary.discountCents,
              currency,
            )} · envio ${formatCurrency(summary.shippingCents, currency)}`}
          />
        </dl>
      </CardContent>
    </Card>
  );
}

export function DailyTable({ rows, currency }: { rows: readonly DailySales[]; currency: string }) {
  const peak = rows.reduce((max, row) => Math.max(max, row.netCents), 0);

  return (
    <Card className="overflow-x-auto">
      <CardHeader>
        <CardTitle as="h2">Venta por dia</CardTitle>
        <CardDescription>En la zona horaria del negocio.</CardDescription>
      </CardHeader>
      <CardContent>
        <table className="w-full min-w-[26rem] border-collapse text-sm">
          <caption className="sr-only">Venta por dia</caption>
          <thead>
            <tr className="border-border text-muted-foreground border-b text-left text-xs">
              <th scope="col" className="px-2 py-2 font-medium">
                Dia
              </th>
              <th scope="col" className="px-2 py-2 font-medium">
                Pedidos
              </th>
              <th scope="col" className="px-2 py-2 font-medium">
                Venta
              </th>
              <th scope="col" className="px-2 py-2 font-medium">
                <span className="sr-only">Proporcion</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.day} className="border-border/60 border-b last:border-0">
                <td className="px-2 py-2 tabular-nums">
                  {new Date(`${row.day}T00:00:00Z`).toLocaleDateString("es-PE", {
                    timeZone: "UTC",
                    weekday: "short",
                    day: "2-digit",
                    month: "2-digit",
                  })}
                </td>
                <td className="px-2 py-2 tabular-nums">{row.orderCount}</td>
                <td className="px-2 py-2 tabular-nums">{formatCurrency(row.netCents, currency)}</td>
                <td className="w-1/3 px-2 py-2">
                  {/*
                   * A bar, not a chart: one div wide in proportion to the peak.
                   * It carries no information the number does not, so it is
                   * aria-hidden rather than described.
                   */}
                  <div
                    aria-hidden="true"
                    className="bg-primary/20 h-2 rounded"
                    style={{ width: peak === 0 ? "0%" : `${(row.netCents / peak) * 100}%` }}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

export function HourlyTable({
  rows,
  currency,
}: {
  rows: readonly HourlySales[];
  currency: string;
}) {
  const peak = rows.reduce((max, row) => Math.max(max, row.netCents), 0);
  const sold = rows.filter((row) => row.orderCount > 0);
  const best = sold.reduce<HourlySales | null>(
    (top, row) => (top === null || row.netCents > top.netCents ? row : top),
    null,
  );

  return (
    <Card className="overflow-x-auto">
      <CardHeader>
        <CardTitle as="h2">Venta por hora</CardTitle>
        <CardDescription>
          Las 24 horas, en la zona horaria del negocio.
          {best === null
            ? " Todavia no hay ventas en este rango."
            : ` La hora fuerte es la de ${formatHour(best.hour)}.`}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <table className="w-full min-w-[26rem] border-collapse text-sm">
          <caption className="sr-only">Venta por hora del dia</caption>
          <thead>
            <tr className="border-border text-muted-foreground border-b text-left text-xs">
              <th scope="col" className="px-2 py-2 font-medium">
                Hora
              </th>
              <th scope="col" className="px-2 py-2 font-medium">
                Pedidos
              </th>
              <th scope="col" className="px-2 py-2 font-medium">
                Venta
              </th>
              <th scope="col" className="px-2 py-2 font-medium">
                <span className="sr-only">Proporcion</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.hour} className="border-border/60 border-b last:border-0">
                <td className="px-2 py-1.5 tabular-nums">{formatHour(row.hour)}</td>
                <td className="px-2 py-1.5 tabular-nums">{row.orderCount}</td>
                <td className="px-2 py-1.5 tabular-nums">
                  {formatCurrency(row.netCents, currency)}
                </td>
                <td className="w-1/2 px-2 py-1.5">
                  <div
                    aria-hidden="true"
                    className="bg-primary/20 h-2 rounded"
                    style={{ width: peak === 0 ? "0%" : `${(row.netCents / peak) * 100}%` }}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

export function LocationTable({
  rows,
  currency,
}: {
  rows: readonly LocationSales[];
  currency: string;
}) {
  return (
    <Card className="overflow-x-auto">
      <CardHeader>
        <CardTitle as="h2">Venta por sede</CardTitle>
        <CardDescription>Todas las sedes, incluidas las que no vendieron nada.</CardDescription>
      </CardHeader>
      <CardContent>
        <table className="w-full min-w-[24rem] border-collapse text-sm">
          <caption className="sr-only">Venta por sede</caption>
          <thead>
            <tr className="border-border text-muted-foreground border-b text-left text-xs">
              <th scope="col" className="px-2 py-2 font-medium">
                Sede
              </th>
              <th scope="col" className="px-2 py-2 font-medium">
                Pedidos
              </th>
              <th scope="col" className="px-2 py-2 font-medium">
                Venta
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.locationId} className="border-border/60 border-b last:border-0">
                <td className="px-2 py-2">{row.locationName}</td>
                <td className="px-2 py-2 tabular-nums">{row.orderCount}</td>
                <td className="px-2 py-2 tabular-nums">{formatCurrency(row.netCents, currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

export function ProductTable({
  tenantSlug,
  rows,
  currency,
}: {
  tenantSlug: string;
  rows: readonly ProductSales[];
  currency: string;
}) {
  return (
    <Card className="overflow-x-auto">
      <CardHeader>
        <CardTitle as="h2">Productos</CardTitle>
        <CardDescription>
          Ordenados por venta, no por unidades: veinte botellas de agua no son mejor negocio que
          tres menus.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <table className="w-full min-w-[30rem] border-collapse text-sm">
          <caption className="sr-only">Productos mas vendidos</caption>
          <thead>
            <tr className="border-border text-muted-foreground border-b text-left text-xs">
              <th scope="col" className="px-2 py-2 font-medium">
                Producto
              </th>
              <th scope="col" className="px-2 py-2 font-medium">
                Unidades
              </th>
              <th scope="col" className="px-2 py-2 font-medium">
                Pedidos
              </th>
              <th scope="col" className="px-2 py-2 font-medium">
                Venta
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.name} className="border-border/60 border-b last:border-0">
                <td className="px-2 py-2">
                  {row.productId === null ? (
                    <>
                      {row.name}{" "}
                      <span className="text-muted-foreground text-xs">· ya no en el catalogo</span>
                    </>
                  ) : (
                    <Link
                      href={`/dashboard/${tenantSlug}/catalogo/${row.productId}`}
                      className="hover:underline"
                    >
                      {row.name}
                    </Link>
                  )}
                </td>
                <td className="px-2 py-2 tabular-nums">{row.quantity.toLocaleString("es-PE")}</td>
                <td className="px-2 py-2 tabular-nums">{row.orderCount}</td>
                <td className="px-2 py-2 tabular-nums">{formatCurrency(row.netCents, currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

export function CustomerTable({
  tenantSlug,
  rows,
  currency,
}: {
  tenantSlug: string;
  rows: readonly CustomerSales[];
  currency: string;
}) {
  return (
    <Card className="overflow-x-auto">
      <CardHeader>
        <CardTitle as="h2">Clientes</CardTitle>
        <CardDescription>
          Solo las ventas con cliente asociado. Una venta de mostrador cuenta en el resumen y no
          aqui.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <table className="w-full min-w-[24rem] border-collapse text-sm">
          <caption className="sr-only">Mejores clientes</caption>
          <thead>
            <tr className="border-border text-muted-foreground border-b text-left text-xs">
              <th scope="col" className="px-2 py-2 font-medium">
                Cliente
              </th>
              <th scope="col" className="px-2 py-2 font-medium">
                Pedidos
              </th>
              <th scope="col" className="px-2 py-2 font-medium">
                Venta
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.customerId} className="border-border/60 border-b last:border-0">
                <td className="px-2 py-2">
                  <Link
                    href={`/dashboard/${tenantSlug}/clientes/${row.customerId}`}
                    className="hover:underline"
                  >
                    {row.name}
                  </Link>
                </td>
                <td className="px-2 py-2 tabular-nums">{row.orderCount}</td>
                <td className="px-2 py-2 tabular-nums">{formatCurrency(row.netCents, currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

export function PaymentMethodTable({
  rows,
  currency,
}: {
  rows: readonly PaymentMethodSales[];
  currency: string;
}) {
  const total = rows.reduce((sum, row) => sum + row.netCents, 0);

  return (
    <Card className="overflow-x-auto">
      <CardHeader>
        <CardTitle as="h2">Medios de pago</CardTitle>
        <CardDescription>
          Como se cobraron las ventas de este rango. No cuenta los pagos anulados.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <table className="w-full min-w-[26rem] border-collapse text-sm">
          <caption className="sr-only">Venta por medio de pago</caption>
          <thead>
            <tr className="border-border text-muted-foreground border-b text-left text-xs">
              <th scope="col" className="px-2 py-2 font-medium">
                Metodo
              </th>
              <th scope="col" className="px-2 py-2 font-medium">
                Pagos
              </th>
              <th scope="col" className="px-2 py-2 font-medium">
                Cobrado
              </th>
              <th scope="col" className="px-2 py-2 font-medium">
                Peso
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.paymentMethodId} className="border-border/60 border-b last:border-0">
                <td className="px-2 py-2">
                  {row.name} <Badge variant="neutral">{row.type}</Badge>
                </td>
                <td className="px-2 py-2 tabular-nums">{row.paymentCount}</td>
                <td className="px-2 py-2 tabular-nums">{formatCurrency(row.netCents, currency)}</td>
                <td className="px-2 py-2 tabular-nums">
                  {total === 0 ? "—" : `${Math.round((row.netCents / total) * 100)}%`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}
