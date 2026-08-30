import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui";
import { formatCurrency } from "@/lib/money";
import { PERMISSIONS } from "@/lib/permissions";
import { hasPermission } from "@/lib/permissions/check";
import { MODULES } from "@/lib/features";
import { hasFeature } from "@/lib/features/check";
import { requireActiveTenant } from "@/lib/tenant/active";
import { CASH_MOVEMENT_TYPE_LABELS } from "@/modules/payments/constants";
import { CashMovementForm } from "@/modules/payments/components/cash-movement-form";
import { CloseSessionForm } from "@/modules/payments/components/close-session-form";
import { getCashSessionDetail } from "@/modules/payments/server/queries";
import { getBusinessSettings } from "@/modules/settings/server/queries";

export const metadata = { title: "Sesion de caja" };

export default async function CashSessionPage({
  params,
}: {
  params: Promise<{ tenantSlug: string; sessionId: string }>;
}) {
  const { tenantSlug, sessionId } = await params;
  const tenant = await requireActiveTenant(tenantSlug);

  // Phase 21: the plan decides before the person does. 404, not 403 - the
  // same posture every permission guard here takes toward a section that is
  // not yours to know about.
  if (!(await hasFeature(tenant.id, MODULES.ORDERS))) {
    notFound();
  }

  if (!(await hasPermission(tenant.id, PERMISSIONS.CASH_VIEW))) {
    notFound();
  }

  const [session, settings, canClose, canManage] = await Promise.all([
    getCashSessionDetail(tenant.id, sessionId),
    getBusinessSettings(tenant.id),
    hasPermission(tenant.id, PERMISSIONS.CASH_CLOSE),
    hasPermission(tenant.id, PERMISSIONS.CASH_MANAGE),
  ]);

  if (session === null) notFound();

  const money = (cents: number): string => formatCurrency(cents, settings.currency);
  const isOpen = session.closedAt === null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Link
          href={`/dashboard/${tenant.slug}/caja`}
          className="text-muted-foreground text-sm hover:underline"
        >
          ← Caja
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{session.cashRegisterName}</h1>
          <Badge variant={isOpen ? "success" : "neutral"}>{isOpen ? "Abierta" : "Cerrada"}</Badge>
          <span className="text-muted-foreground text-sm">{session.locationName}</span>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle as="h2">Movimientos</CardTitle>
          <CardDescription>
            Apertura {money(session.openingCents)} · abierta el{" "}
            {new Date(session.openedAt).toLocaleString("es-PE")}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {session.movements.length === 0 ? (
            <p className="text-muted-foreground text-sm">Sin movimientos todavia.</p>
          ) : (
            <ul className="flex flex-col">
              {session.movements.map((movement) => (
                <li
                  key={movement.id}
                  className="border-border flex flex-wrap items-baseline justify-between gap-2 border-b py-2 last:border-0"
                >
                  <div>
                    <span>{CASH_MOVEMENT_TYPE_LABELS[movement.type]}</span>
                    {movement.reason !== null ? (
                      <span className="text-muted-foreground text-sm"> · {movement.reason}</span>
                    ) : null}
                  </div>
                  <span className="tabular-nums">{money(movement.amountCents)}</span>
                </li>
              ))}
            </ul>
          )}

          {isOpen && canManage ? (
            <CashMovementForm tenantSlug={tenant.slug} cashSessionId={session.id} />
          ) : null}
        </CardContent>
      </Card>

      {isOpen ? (
        canClose ? (
          <Card>
            <CardHeader>
              <CardTitle as="h2">Cerrar caja</CardTitle>
            </CardHeader>
            <CardContent>
              <CloseSessionForm
                tenantSlug={tenant.slug}
                cashSessionId={session.id}
                runningTotalCents={session.runningTotalCents}
                currency={settings.currency}
              />
            </CardContent>
          </Card>
        ) : null
      ) : (
        <Card>
          <CardHeader>
            <CardTitle as="h2">Cierre</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-1 text-sm">
            <p>Esperado: {money(session.expectedCents ?? 0)}</p>
            <p>Contado: {money(session.closingCents ?? 0)}</p>
            <p className={session.differenceCents !== 0 ? "text-destructive font-medium" : ""}>
              Diferencia: {money(session.differenceCents ?? 0)}
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
