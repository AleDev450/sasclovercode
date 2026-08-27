import Link from "next/link";
import { Badge, Card, CardContent, CardHeader, CardTitle } from "@/components/ui";
import { formatCurrency } from "@/lib/money";
import type { CashRegisterSummary, CashSessionSummary } from "../server/queries";
import { OpenSessionForm } from "./open-session-form";

export function CashRegisterCard({
  tenantSlug,
  register,
  canOpen,
  recentSessions,
  currency,
}: {
  tenantSlug: string;
  register: CashRegisterSummary;
  canOpen: boolean;
  /** Past closes of this register, most recent first - "did we come up short". */
  recentSessions: readonly CashSessionSummary[];
  currency: string;
}) {
  const closedSessions = recentSessions.filter((session) => session.closedAt !== null);
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
        <div>
          <CardTitle as="h2">{register.name}</CardTitle>
          <p className="text-muted-foreground text-sm">{register.locationName}</p>
        </div>
        {!register.isActive ? <Badge variant="neutral">Desactivada</Badge> : null}
      </CardHeader>
      <CardContent>
        {register.openSessionId !== null ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Badge variant="success">Abierta</Badge>
              <span className="text-muted-foreground text-sm">
                desde {new Date(register.openedAt!).toLocaleString("es-PE")}
              </span>
            </div>
            <Link
              href={`/dashboard/${tenantSlug}/caja/${register.openSessionId}`}
              className="text-sm hover:underline"
            >
              Ver movimientos y cerrar
            </Link>
          </div>
        ) : register.isActive && canOpen ? (
          <OpenSessionForm tenantSlug={tenantSlug} cashRegisterId={register.id} />
        ) : (
          <Badge variant="neutral">Cerrada</Badge>
        )}

        {closedSessions.length > 0 ? (
          <div className="mt-4 flex flex-col gap-1 border-t pt-3">
            <p className="text-muted-foreground text-xs font-medium">Ultimos cierres</p>
            <ul className="flex flex-col gap-1">
              {closedSessions.slice(0, 5).map((session) => (
                <li key={session.id} className="flex justify-between text-xs">
                  <span className="text-muted-foreground">
                    {new Date(session.closedAt!).toLocaleDateString("es-PE")}
                  </span>
                  <span
                    className={
                      session.differenceCents !== 0 && session.differenceCents !== null
                        ? "text-destructive tabular-nums"
                        : "text-muted-foreground tabular-nums"
                    }
                  >
                    {formatCurrency(session.differenceCents ?? 0, currency)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
