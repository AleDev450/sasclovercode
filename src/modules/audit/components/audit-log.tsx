import Link from "next/link";
import { Badge, Card, CardContent, CardHeader, CardTitle } from "@/components/ui";
import {
  AUDIT_ACTIONS,
  AUDIT_ACTION_LABELS,
  auditEntityLabel,
  describeChanges,
  isAuditAction,
} from "../actions";
import type { AuditEntry, AuditPage } from "../server/queries";

/**
 * The audit screen.
 *
 * A `GET` form and a table, with no client component and no Server Action -
 * because there is nothing to mutate here and never will be (ADR-028
 * decision 1). The filter lives in the URL, so a view somebody found useful is
 * a link they can send.
 */

export function AuditFilterBar({
  tenantSlug,
  selectedAction,
  entityId,
}: {
  tenantSlug: string;
  selectedAction: string | null;
  entityId: string | null;
}) {
  const base = `/dashboard/${tenantSlug}/auditoria`;

  return (
    <Card>
      <CardContent className="flex flex-wrap items-end gap-3 pt-6">
        <form method="get" action={base} className="flex flex-wrap items-end gap-3">
          <div className="flex min-w-[14rem] flex-col gap-2">
            <label htmlFor="action" className="text-sm font-medium">
              Accion
            </label>
            <select
              id="action"
              name="action"
              defaultValue={selectedAction ?? ""}
              className="border-input bg-background h-9 rounded-md border px-2 text-sm"
            >
              <option value="">Todas las acciones</option>
              {AUDIT_ACTIONS.map((action) => (
                <option key={action} value={action}>
                  {AUDIT_ACTION_LABELS[action]}
                </option>
              ))}
            </select>
          </div>

          {/*
           * Carried through the form so filtering by action while looking at
           * one record does not silently widen the question to the whole shop.
           */}
          {entityId === null ? null : <input type="hidden" name="entity" value={entityId} />}

          <button
            type="submit"
            className="bg-secondary text-secondary-foreground hover:bg-secondary/80 h-9 rounded-md px-4 text-sm font-medium"
          >
            Filtrar
          </button>
        </form>

        {selectedAction === null && entityId === null ? null : (
          <Link href={base} className="text-muted-foreground hover:text-foreground text-sm">
            Quitar filtros
          </Link>
        )}
      </CardContent>
    </Card>
  );
}

function formatWhen(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("es-PE", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone,
  }).format(new Date(iso));
}

function AuditRow({ entry, timeZone }: { entry: AuditEntry; timeZone: string }) {
  const changes = describeChanges(entry.action, entry.oldValues, entry.newValues);
  const label = isAuditAction(entry.action) ? AUDIT_ACTION_LABELS[entry.action] : entry.action;

  return (
    <tr className="border-border border-b align-top last:border-0">
      <td className="py-3 pr-4 text-sm whitespace-nowrap">
        {formatWhen(entry.createdAt, timeZone)}
      </td>

      <td className="py-3 pr-4">
        <Badge variant="neutral">{label}</Badge>
        <div className="text-muted-foreground mt-1 text-xs">
          {auditEntityLabel(entry.entityType)}
        </div>
      </td>

      <td className="py-3 pr-4 text-sm">
        {/*
         * The email is a SNAPSHOT taken when the row was written, so it still
         * names somebody after that account is gone (ADR-028 decision 5). A row
         * with no user is a change made by a migration or by the billing cycle,
         * and saying so is more honest than attributing it to somebody.
         */}
        {entry.userEmail ?? <span className="text-muted-foreground">Sistema</span>}
      </td>

      <td className="py-3 pr-4">
        {changes.length === 0 ? (
          <span className="text-muted-foreground text-sm">Sin cambios visibles</span>
        ) : (
          <dl className="flex flex-col gap-1 text-sm">
            {changes.map((change) => (
              <div key={change.field} className="flex flex-wrap items-baseline gap-2">
                <dt className="text-muted-foreground font-mono text-xs">{change.field}</dt>
                <dd className="flex flex-wrap items-baseline gap-2">
                  {change.before === null ? null : (
                    <span className="text-muted-foreground line-through">{change.before}</span>
                  )}
                  {change.after === null ? (
                    <span className="text-muted-foreground italic">(vacio)</span>
                  ) : (
                    <span className="font-medium">{change.after}</span>
                  )}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </td>

      <td className="text-muted-foreground py-3 font-mono text-xs whitespace-nowrap">
        {entry.ipAddress ?? "-"}
      </td>
    </tr>
  );
}

export function AuditTable({
  page,
  timeZone,
  pageHref,
}: {
  page: AuditPage;
  timeZone: string;
  pageHref: (page: number) => string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Actividad</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[52rem] border-collapse text-left">
            <thead>
              <tr className="text-muted-foreground border-border border-b text-xs uppercase">
                <th scope="col" className="py-2 pr-4 font-medium">
                  Fecha
                </th>
                <th scope="col" className="py-2 pr-4 font-medium">
                  Accion
                </th>
                <th scope="col" className="py-2 pr-4 font-medium">
                  Quien
                </th>
                <th scope="col" className="py-2 pr-4 font-medium">
                  Cambio
                </th>
                <th scope="col" className="py-2 font-medium">
                  IP
                </th>
              </tr>
            </thead>
            <tbody>
              {page.entries.map((entry) => (
                <AuditRow key={entry.id} entry={entry} timeZone={timeZone} />
              ))}
            </tbody>
          </table>
        </div>

        {page.page === 1 && !page.hasMore ? null : (
          <nav aria-label="Paginacion" className="flex items-center justify-between text-sm">
            {page.page > 1 ? (
              <Link href={pageHref(page.page - 1)} className="hover:text-foreground">
                Anteriores
              </Link>
            ) : (
              <span />
            )}
            {page.hasMore ? (
              <Link href={pageHref(page.page + 1)} className="hover:text-foreground">
                Siguientes
              </Link>
            ) : (
              <span />
            )}
          </nav>
        )}
      </CardContent>
    </Card>
  );
}
