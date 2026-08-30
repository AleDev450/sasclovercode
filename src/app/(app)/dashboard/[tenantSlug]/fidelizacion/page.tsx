import { notFound } from "next/navigation";
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
} from "@/components/ui";
import { PERMISSIONS } from "@/lib/permissions";
import { hasPermission } from "@/lib/permissions/check";
import { MODULES } from "@/lib/features";
import { hasFeature } from "@/lib/features/check";
import { requireActiveTenant } from "@/lib/tenant/active";
import { listCustomers } from "@/modules/customers/server/queries";
import {
  EnrollCustomerForm,
  RecordAdjustmentForm,
} from "@/modules/loyalty/components/loyalty-forms";
import { LOYALTY_TRANSACTION_LABELS } from "@/modules/loyalty/points";
import {
  getLoyaltyProgramme,
  listLedger,
  listLoyaltyAccounts,
} from "@/modules/loyalty/server/queries";

export const metadata = { title: "Fidelizacion" };

export default async function LoyaltyPage({ params }: { params: Promise<{ tenantSlug: string }> }) {
  const { tenantSlug } = await params;
  const tenant = await requireActiveTenant(tenantSlug);

  // Phase 21: the plan decides before the person does. 404, not 403 - the
  // same posture every permission guard here takes toward a section that is
  // not yours to know about.
  if (!(await hasFeature(tenant.id, MODULES.LOYALTY))) {
    notFound();
  }

  if (!(await hasPermission(tenant.id, PERMISSIONS.LOYALTY_VIEW))) {
    notFound();
  }

  const canManage = await hasPermission(tenant.id, PERMISSIONS.LOYALTY_MANAGE);

  const [accounts, programme, customerPage] = await Promise.all([
    listLoyaltyAccounts(tenant.id),
    getLoyaltyProgramme(tenant.id),
    canManage
      ? listCustomers(tenant.id, { search: null, includeInactive: false, page: 1 })
      : Promise.resolve({ customers: [], total: 0, page: 1, pageCount: 1 }),
  ]);

  // Only the customers who have no account yet; enrolling one twice is a key
  // violation, and offering it would be offering a mistake.
  const enrolled = new Set(accounts.map((account) => account.customerId));
  const enrollable = customerPage.customers
    .filter((customer) => !enrolled.has(customer.id))
    .map((customer) => ({ id: customer.id, name: customer.name }));

  // The ledgers of the accounts on screen, fetched together rather than one
  // per row - the N+1 this page would otherwise be.
  const ledgers = await Promise.all(
    accounts.slice(0, 20).map(async (account) => ({
      accountId: account.id,
      entries: await listLedger(tenant.id, account.id, 20),
    })),
  );
  const ledgerFor = (accountId: string) =>
    ledgers.find((ledger) => ledger.accountId === accountId)?.entries ?? [];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Fidelizacion</h1>
        <p className="text-muted-foreground text-sm">
          Los puntos de los clientes de {tenant.name}, y de donde salio cada uno.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle as="h2">Programa</CardTitle>
          <CardDescription>
            {programme.enabled
              ? `Activo: ${programme.pointsPerSol} punto(s) por sol, cada punto vale ${programme.pointValueCents} centimos.`
              : "Apagado. Los pedidos completados no acumulan puntos hasta que se active en Configuracion."}
          </CardDescription>
        </CardHeader>
      </Card>

      {canManage ? (
        <Card>
          <CardHeader>
            <CardTitle as="h2">Inscribir un cliente</CardTitle>
            <CardDescription>
              Un cliente tambien queda inscrito solo la primera vez que completa un pedido con el
              programa activo.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <EnrollCustomerForm tenantSlug={tenant.slug} customers={enrollable} />
          </CardContent>
        </Card>
      ) : null}

      {accounts.length === 0 ? (
        <EmptyState
          title="Aun no hay clientes inscritos"
          description="Inscribe un cliente, o activa el programa y completa un pedido a su nombre para que acumule solo."
        />
      ) : (
        accounts.map((account) => {
          const entries = ledgerFor(account.id);

          return (
            <Card key={account.id}>
              <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <CardTitle as="h2">{account.customerName}</CardTitle>
                    <CardDescription>
                      Inscrito el {new Date(account.enrolledAt).toLocaleDateString("es-PE")}
                    </CardDescription>
                  </div>
                  <Badge variant={account.pointsBalance > 0 ? "success" : "neutral"}>
                    {account.pointsBalance} puntos
                  </Badge>
                </div>
              </CardHeader>

              <CardContent className="flex flex-col gap-5">
                {canManage ? (
                  <RecordAdjustmentForm tenantSlug={tenant.slug} accountId={account.id} />
                ) : null}

                {entries.length === 0 ? (
                  <p className="text-muted-foreground text-sm">Sin movimientos todavia.</p>
                ) : (
                  <table className="w-full min-w-[28rem] border-collapse text-sm">
                    <caption className="sr-only">Movimientos de {account.customerName}</caption>
                    <thead>
                      <tr className="border-border text-muted-foreground border-b text-left text-xs">
                        <th scope="col" className="px-2 py-2 font-medium">
                          Fecha
                        </th>
                        <th scope="col" className="px-2 py-2 font-medium">
                          Tipo
                        </th>
                        <th scope="col" className="px-2 py-2 font-medium">
                          Puntos
                        </th>
                        <th scope="col" className="px-2 py-2 font-medium">
                          Motivo
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {entries.map((entry) => (
                        <tr key={entry.id} className="border-border/60 border-b last:border-0">
                          <td className="px-2 py-2 tabular-nums">
                            {new Date(entry.createdAt).toLocaleDateString("es-PE")}
                          </td>
                          <td className="px-2 py-2">{LOYALTY_TRANSACTION_LABELS[entry.type]}</td>
                          <td
                            className={
                              entry.points > 0
                                ? "text-success px-2 py-2 tabular-nums"
                                : "text-destructive px-2 py-2 tabular-nums"
                            }
                          >
                            {entry.points > 0 ? `+${entry.points}` : entry.points}
                          </td>
                          <td className="text-muted-foreground px-2 py-2">{entry.reason ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </CardContent>
            </Card>
          );
        })
      )}
    </div>
  );
}
