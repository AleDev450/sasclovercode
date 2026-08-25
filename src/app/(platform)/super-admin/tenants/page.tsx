import Link from "next/link";
import { Badge, Card, EmptyState, buttonVariants } from "@/components/ui";
import { listPlatformTenants, type PlatformTenant } from "@/modules/platform/server/queries";

export const metadata = { title: "Empresas" };

const STATUS_VARIANT = {
  active: "success",
  suspended: "warning",
  archived: "neutral",
} as const;

const STATUS_LABEL = {
  active: "Activa",
  suspended: "Suspendida",
  archived: "Archivada",
} as const;

function TenantRow({ tenant }: { tenant: PlatformTenant }) {
  return (
    <tr className="border-border border-b last:border-0">
      <th scope="row" className="px-4 py-3 text-left font-medium">
        <Link href={`/super-admin/tenants/${tenant.id}`} className="hover:underline">
          {tenant.name}
        </Link>
        <span className="text-muted-foreground block text-xs font-normal">{tenant.slug}</span>
      </th>
      <td className="px-4 py-3">
        <Badge variant={STATUS_VARIANT[tenant.status]}>{STATUS_LABEL[tenant.status]}</Badge>
      </td>
      <td className="text-muted-foreground px-4 py-3 text-sm">{tenant.primaryDomain ?? "—"}</td>
      <td className="px-4 py-3 text-sm tabular-nums">{tenant.memberCount}</td>
    </tr>
  );
}

export default async function PlatformTenantsPage() {
  const tenants = await listPlatformTenants();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Empresas</h1>
          <p className="text-muted-foreground text-sm">
            Todas las empresas administradas desde CloverCode.
          </p>
        </div>
        <Link href="/super-admin/tenants/new" className={buttonVariants({ size: "md" })}>
          Crear empresa
        </Link>
      </div>

      {tenants.length === 0 ? (
        <EmptyState
          title="Aun no hay empresas"
          description="Crea la primera para incorporarla a CloverCode."
          action={
            <Link href="/super-admin/tenants/new" className={buttonVariants()}>
              Crear empresa
            </Link>
          }
        />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[36rem] border-collapse text-sm">
            <caption className="sr-only">Listado de empresas</caption>
            <thead>
              <tr className="border-border text-muted-foreground border-b text-left text-xs">
                <th scope="col" className="px-4 py-3 font-medium">
                  Empresa
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Estado
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Dominio principal
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Miembros
                </th>
              </tr>
            </thead>
            <tbody>
              {tenants.map((tenant) => (
                <TenantRow key={tenant.id} tenant={tenant} />
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
