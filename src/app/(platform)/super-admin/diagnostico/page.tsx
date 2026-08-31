import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui";
import { logger } from "@/lib/logger";
import {
  getPlatformDiagnostics,
  getSystemHealth,
} from "@/modules/platform/server/diagnostics-queries";
import packageJson from "../../../../../package.json";

export const metadata = { title: "Diagnostico" };

/**
 * The state of the system, for the person who gets the phone call.
 *
 * CLOVERCODE_MASTER.md section 33 (Phase 24) asks for diagnostic tools for the
 * Super Admin, and section 29 lists them among its functions.
 *
 * WHAT THIS IS NOT: a metrics dashboard. There are no time series here, because
 * exporting them needs a collector nobody has stood up, and section 26 says to
 * measure before optimising (ADR-028 decision 6, KL-2405). What there is, is the
 * handful of numbers that answer "is it working" and "is anything stuck".
 *
 * The platform layout already ran `requirePlatformAdmin()`, and
 * `platform_diagnostics()` checks again in SQL.
 */
export default async function DiagnosticsPage() {
  // Sequential rather than parallel, deliberately: if the database is down, the
  // health probe is the call that says so, and firing the counters at the same
  // time only adds a second failure to explain.
  const health = await getSystemHealth();
  const diagnostics = health.status === "ok" ? await getPlatformDiagnostics() : null;

  logger.info("diagnostics.viewed", { status: health.status });

  const formatWhen = (iso: string): string =>
    new Intl.DateTimeFormat("es-PE", { dateStyle: "medium", timeStyle: "short" }).format(
      new Date(iso),
    );

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Diagnostico</h1>
        <p className="text-muted-foreground text-sm">
          Estado del sistema y sus numeros. Version {packageJson.version}.
        </p>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <div>
            <CardTitle as="h2">Dependencias</CardTitle>
            <CardDescription>
              La misma comprobacion que responde <code>/api/health</code>.
            </CardDescription>
          </div>
          <Badge variant={health.status === "ok" ? "success" : "destructive"}>
            {health.status === "ok" ? "Operativo" : "Degradado"}
          </Badge>
        </CardHeader>
        <CardContent>
          <dl className="flex flex-col gap-3">
            {health.checks.map((check) => (
              <div key={check.name} className="flex items-baseline justify-between gap-4">
                <dt className="text-sm font-medium">{check.name}</dt>
                <dd className="text-muted-foreground flex items-baseline gap-3 text-sm">
                  <span>{check.durationMs} ms</span>
                  <Badge variant={check.status === "ok" ? "success" : "destructive"}>
                    {check.status === "ok" ? "ok" : (check.failure ?? "degradado")}
                  </Badge>
                </dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>

      {diagnostics === null ? (
        <Card>
          <CardHeader>
            <CardTitle as="h2">Sin numeros</CardTitle>
            <CardDescription>
              Los contadores salen de la base de datos, y la base de datos es justamente lo que no
              esta respondiendo. La comprobacion de arriba dice por que.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle as="h2">Negocios</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                <Metric label="Total" value={diagnostics.tenantsTotal} />
                <Metric label="Activos" value={diagnostics.tenantsActive} />
                <Metric label="Suspendidos" value={diagnostics.tenantsSuspended} />
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle as="h2">Suscripciones</CardTitle>
              <CardDescription>
                <code>past_due</code> da acceso a proposito: cortar a un restaurante a mitad de
                servicio por un problema del banco es peor que cobrar tarde (ADR-025).
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <Metric label="En prueba" value={diagnostics.subscriptionsTrialing} />
                <Metric label="Activas" value={diagnostics.subscriptionsActive} />
                <Metric label="Pago pendiente" value={diagnostics.subscriptionsPastDue} />
                <Metric label="Suspendidas" value={diagnostics.subscriptionsSuspended} />
              </dl>

              <p className="text-muted-foreground text-sm">
                {diagnostics.overdueCharges === 0
                  ? "No hay cobros vencidos."
                  : `${diagnostics.overdueCharges} cobro(s) vencido(s); el mas antiguo vencio el ${
                      diagnostics.oldestOverdueDueAt === null
                        ? "-"
                        : formatWhen(diagnostics.oldestOverdueDueAt)
                    }.`}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle as="h2">Actividad</CardTitle>
              <CardDescription>
                Pedidos de las ultimas 24 horas: todos, no solo los completados. Es una senal de
                uso, no un reporte de ventas - eso es la Fase 23 y cuenta otra cosa.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                <Metric label="Pedidos (24 h)" value={diagnostics.ordersLast24h} />
                <Metric label="Auditoria (24 h)" value={diagnostics.auditRowsLast24h} />
                <Metric label="Auditoria (total)" value={diagnostics.auditRowsTotal} />
              </dl>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="text-muted-foreground text-xs uppercase">{label}</dt>
      <dd className="text-2xl font-semibold tabular-nums">{value.toLocaleString("es-PE")}</dd>
    </div>
  );
}
