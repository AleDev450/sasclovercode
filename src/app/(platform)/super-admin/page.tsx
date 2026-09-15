import Link from "next/link";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  PageHeader,
  StatCard,
  StatGrid,
  Table,
  TableBody,
  TableHead,
  TableNumber,
  buttonVariants,
} from "@/components/ui";
import {
  IconAlert,
  IconArrowRight,
  IconBuilding,
  IconCard,
  IconCheckCircle,
  IconClock,
  IconUsers,
} from "@/components/ui/icons";
import { PRODUCT_NAME } from "@/config/app";
import { formatDate, formatRelative } from "@/lib/dates";
import { formatCurrency } from "@/lib/money";
import { getLeadCounts, listLeads } from "@/modules/marketing/server/queries";
import {
  getPlatformDiagnostics,
  getSystemHealth,
} from "@/modules/platform/server/diagnostics-queries";
import { listOutstandingCharges } from "@/modules/platform/server/billing-queries";
import { listPlatformTenants } from "@/modules/platform/server/queries";

export const metadata = { title: "Resumen" };

/**
 * The Super Admin home.
 *
 * Until now this route redirected straight to the tenant list, which made the
 * console a filing cabinet: an operator could see every business and had
 * nowhere that answered "is anything wrong right now". This is that screen.
 *
 * IT IS ORDERED BY URGENCY, not by module. Money owed and unanswered leads come
 * before growth counters, because those are the two things that stop being
 * recoverable if nobody looks at them today. Everything below the fold is
 * context.
 *
 * EVERY QUERY IS ALREADY GATED. `platform_diagnostics()` and
 * `platform_lead_counts()` return zeros to a non-operator, and the listing
 * queries return no rows, so this page carries no authorisation logic of its
 * own beyond the layout guard.
 */
export default async function SuperAdminDashboardPage() {
  const [diagnostics, leads, outstanding, tenants, health, recentLeads] = await Promise.all([
    getPlatformDiagnostics(),
    getLeadCounts(),
    listOutstandingCharges(50),
    listPlatformTenants(),
    getSystemHealth(),
    listLeads("new", 5),
  ]);

  const overdue = outstanding.filter((charge) => new Date(charge.dueAt) < new Date());
  const overdueCents = overdue.reduce((sum, charge) => sum + charge.amountCents, 0);
  const outstandingCents = outstanding.reduce((sum, charge) => sum + charge.amountCents, 0);

  // The currency of the charges themselves, not a constant: every charge in the
  // list carries its own, and mixing them into one total would be wrong.
  const currency = outstanding[0]?.currency ?? "PEN";

  const newestTenants = [...tenants]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 5);

  const needsAttention =
    diagnostics.subscriptionsPastDue > 0 ||
    diagnostics.tenantsSuspended > 0 ||
    health.status !== "ok";

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Resumen de la plataforma"
        description="El estado de CloverCode en una pantalla: cobranza, empresas, prospectos y salud del sistema."
        actions={
          <Link href="/super-admin/tenants/new" className={buttonVariants({ size: "md" })}>
            Crear empresa
          </Link>
        }
      />

      {/* ------------------------------------------------------- urgent first */}
      {needsAttention ? (
        <Alert variant="warning">
          <AlertTitle>Hay cosas que requieren tu atencion</AlertTitle>
          <AlertDescription>
            <ul className="mt-1 flex flex-col gap-1">
              {health.status !== "ok" ? (
                <li>
                  El sistema reporta estado <strong>{health.status}</strong>.{" "}
                  <Link href="/super-admin/diagnostico" className="text-primary hover:underline">
                    Ver diagnostico
                  </Link>
                </li>
              ) : null}
              {diagnostics.subscriptionsPastDue > 0 ? (
                <li>
                  {diagnostics.subscriptionsPastDue} suscripcion(es) en mora.{" "}
                  <Link href="/super-admin/facturacion" className="text-primary hover:underline">
                    Ver cobranza
                  </Link>
                </li>
              ) : null}
              {diagnostics.tenantsSuspended > 0 ? (
                <li>
                  {diagnostics.tenantsSuspended} empresa(s) suspendida(s).{" "}
                  <Link href="/super-admin/tenants" className="text-primary hover:underline">
                    Ver empresas
                  </Link>
                </li>
              ) : null}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}

      <StatGrid>
        <StatCard
          label="Empresas activas"
          value={diagnostics.tenantsActive}
          hint={`${diagnostics.tenantsTotal} en total, ${diagnostics.tenantsSuspended} suspendidas`}
          icon={<IconBuilding />}
          tone="brand"
          href="/super-admin/tenants"
        />
        <StatCard
          label="Por cobrar"
          value={formatCurrency(outstandingCents, currency)}
          hint={
            overdue.length > 0
              ? `${overdue.length} cargo(s) vencido(s) por ${formatCurrency(overdueCents, currency)}`
              : "Ningun cargo vencido"
          }
          icon={<IconCard />}
          tone={overdue.length > 0 ? "destructive" : "default"}
          href="/super-admin/facturacion"
        />
        <StatCard
          label="Prospectos sin atender"
          value={leads.new}
          hint={`${leads.last7Days} recibidos en los ultimos 7 dias`}
          icon={<IconUsers />}
          tone={leads.new > 0 ? "warning" : "success"}
          href="/super-admin/prospectos"
        />
        <StatCard
          label="Pedidos (24 h)"
          value={diagnostics.ordersLast24h}
          hint="En todas las empresas de la plataforma"
          icon={<IconClock />}
          href="/super-admin/diagnostico"
        />
      </StatGrid>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* ------------------------------------------------------- collections */}
        <Card>
          <CardHeader className="flex-row items-center justify-between gap-3">
            <div className="flex flex-col gap-1">
              <CardTitle as="h2">Cobranza pendiente</CardTitle>
              <p className="text-muted-foreground text-sm">
                Los cargos mas antiguos primero: el mas viejo es el que decide una suspension.
              </p>
            </div>
            <Link
              href="/super-admin/facturacion"
              className={buttonVariants({ variant: "ghost", size: "sm" })}
            >
              Ver todo
              <IconArrowRight />
            </Link>
          </CardHeader>
          <CardContent className="px-0 pb-0">
            {outstanding.length === 0 ? (
              <div className="px-6 pb-6">
                <EmptyState
                  title="Nada por cobrar"
                  description="Todas las empresas estan al dia."
                  icon={<IconCheckCircle className="size-8" />}
                />
              </div>
            ) : (
              <Table
                caption="Cargos pendientes de cobro por empresa"
                minWidthClassName="min-w-[30rem]"
              >
                <TableHead>
                  <tr>
                    <th scope="col">Empresa</th>
                    <th scope="col">Vence</th>
                    <th scope="col" className="text-right">
                      Monto
                    </th>
                  </tr>
                </TableHead>
                <TableBody>
                  {outstanding.slice(0, 6).map((charge) => {
                    const isOverdue = new Date(charge.dueAt) < new Date();
                    return (
                      <tr key={charge.id}>
                        <th scope="row" className="text-left font-medium">
                          {charge.tenantName}
                          <span className="text-muted-foreground block text-xs font-normal">
                            {charge.planCode}
                          </span>
                        </th>
                        <td>
                          {isOverdue ? (
                            <Badge variant="destructive" dot>
                              {formatDate(charge.dueAt)}
                            </Badge>
                          ) : (
                            <span className="text-muted-foreground text-sm">
                              {formatDate(charge.dueAt)}
                            </span>
                          )}
                        </td>
                        <TableNumber className="font-medium">
                          {formatCurrency(charge.amountCents, charge.currency)}
                        </TableNumber>
                      </tr>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* ------------------------------------------------------------ leads */}
        <Card>
          <CardHeader className="flex-row items-center justify-between gap-3">
            <div className="flex flex-col gap-1">
              <CardTitle as="h2">Prospectos recientes</CardTitle>
              <p className="text-muted-foreground text-sm">
                Solicitudes de demo llegadas desde la web de {""}
                <span className="font-medium">{PRODUCT_NAME}</span>.
              </p>
            </div>
            <Link
              href="/super-admin/prospectos"
              className={buttonVariants({ variant: "ghost", size: "sm" })}
            >
              Ver todo
              <IconArrowRight />
            </Link>
          </CardHeader>
          <CardContent>
            {recentLeads.length === 0 ? (
              <EmptyState
                title="Ningun prospecto sin atender"
                description="Cuando alguien complete el formulario de la landing, aparecera aqui."
                icon={<IconUsers className="size-8" />}
              />
            ) : (
              <ul className="flex flex-col gap-3">
                {recentLeads.map((lead) => (
                  <li
                    key={lead.id}
                    className="border-border flex items-start justify-between gap-3 rounded-lg border p-3"
                  >
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <p className="truncate text-sm font-medium">{lead.name}</p>
                      <p className="text-muted-foreground truncate text-xs">
                        {lead.businessName ?? lead.email}
                        {lead.businessType !== null ? ` · ${lead.businessType}` : ""}
                      </p>
                    </div>
                    <time
                      dateTime={lead.createdAt}
                      className="text-muted-foreground shrink-0 text-xs"
                    >
                      {formatRelative(lead.createdAt)}
                    </time>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* ---------------------------------------------------- subscriptions */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle as="h2">Suscripciones</CardTitle>
            <p className="text-muted-foreground text-sm">
              En que punto del ciclo comercial esta cada empresa.
            </p>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-4 sm:grid-cols-4">
              {[
                { label: "En prueba", value: diagnostics.subscriptionsTrialing, tone: "" },
                {
                  label: "Activas",
                  value: diagnostics.subscriptionsActive,
                  tone: "text-success",
                },
                {
                  label: "En mora",
                  value: diagnostics.subscriptionsPastDue,
                  tone: diagnostics.subscriptionsPastDue > 0 ? "text-destructive" : "",
                },
                {
                  label: "Suspendidas",
                  value: diagnostics.subscriptionsSuspended,
                  tone: diagnostics.subscriptionsSuspended > 0 ? "text-warning" : "",
                },
              ].map((item) => (
                <div key={item.label} className="flex flex-col gap-1">
                  <dt className="text-muted-foreground text-sm">{item.label}</dt>
                  <dd className={`text-2xl font-semibold tabular-nums ${item.tone}`}>
                    {item.value}
                  </dd>
                </div>
              ))}
            </dl>

            <div className="border-border mt-6 border-t pt-6">
              <h3 className="mb-3 text-sm font-semibold">Ultimas empresas creadas</h3>
              {newestTenants.length === 0 ? (
                <p className="text-muted-foreground text-sm">Aun no hay empresas.</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {newestTenants.map((tenant) => (
                    <li key={tenant.id} className="flex items-center justify-between gap-3">
                      <Link
                        href={`/super-admin/tenants/${tenant.id}`}
                        className="truncate text-sm font-medium hover:underline"
                      >
                        {tenant.name}
                      </Link>
                      <span className="text-muted-foreground shrink-0 text-xs">
                        {formatDate(tenant.createdAt)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </CardContent>
        </Card>

        {/* ----------------------------------------------------------- health */}
        <Card>
          <CardHeader>
            <CardTitle as="h2">Salud del sistema</CardTitle>
            <p className="text-muted-foreground text-sm">
              La misma comprobacion que ejecuta <code className="font-mono">/api/health</code>.
            </p>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <Badge
              variant={health.status === "ok" ? "success" : "warning"}
              dot
              className="self-start"
            >
              {health.status}
            </Badge>

            <ul className="flex flex-col gap-2">
              {health.checks.map((check) => (
                <li key={check.name} className="flex items-center justify-between gap-2 text-sm">
                  <span className="text-muted-foreground">{check.name}</span>
                  <span className="flex items-center gap-1.5 font-medium">
                    {check.status === "ok" ? (
                      <IconCheckCircle className="text-success size-4" />
                    ) : (
                      <IconAlert className="text-destructive size-4" />
                    )}
                    {check.status}
                  </span>
                </li>
              ))}
            </ul>

            <dl className="border-border flex flex-col gap-2 border-t pt-4 text-sm">
              <div className="flex items-center justify-between gap-2">
                <dt className="text-muted-foreground">Auditoria (24 h)</dt>
                <dd className="font-medium tabular-nums">{diagnostics.auditRowsLast24h}</dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt className="text-muted-foreground">Auditoria (total)</dt>
                <dd className="font-medium tabular-nums">{diagnostics.auditRowsTotal}</dd>
              </div>
            </dl>

            <Link
              href="/super-admin/diagnostico"
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              Ver diagnostico completo
            </Link>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
