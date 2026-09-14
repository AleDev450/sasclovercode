import Link from "next/link";
import {
  Badge,
  Card,
  EmptyState,
  PageHeader,
  Table,
  TableBody,
  TableHead,
  TableNumber,
  buttonVariants,
} from "@/components/ui";
import { IconBuilding } from "@/components/ui/icons";
import { formatDate } from "@/lib/dates";
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
    <tr>
      <th scope="row" className="text-left font-medium">
        <Link href={`/super-admin/tenants/${tenant.id}`} className="hover:text-primary">
          {tenant.name}
        </Link>
        <span className="text-muted-foreground block text-xs font-normal">{tenant.slug}</span>
      </th>
      <td>
        <Badge variant={STATUS_VARIANT[tenant.status]} dot>
          {STATUS_LABEL[tenant.status]}
        </Badge>
      </td>
      <td className="text-muted-foreground text-sm">{tenant.primaryDomain ?? "—"}</td>
      <td className="text-muted-foreground text-sm">{formatDate(tenant.createdAt)}</td>
      <TableNumber>{tenant.memberCount}</TableNumber>
    </tr>
  );
}

export default async function PlatformTenantsPage() {
  const tenants = await listPlatformTenants();

  const active = tenants.filter((tenant) => tenant.status === "active").length;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Empresas"
        description={
          tenants.length === 0
            ? "Todas las empresas administradas desde CloverCode."
            : `${tenants.length} empresa(s) en la plataforma, ${active} activa(s).`
        }
        actions={
          <Link href="/super-admin/tenants/new" className={buttonVariants({ size: "md" })}>
            Crear empresa
          </Link>
        }
      />

      {tenants.length === 0 ? (
        <EmptyState
          title="Aun no hay empresas"
          description="Crea la primera para incorporarla a CloverCode."
          icon={<IconBuilding className="size-8" />}
          titleAs="h2"
          action={
            <Link href="/super-admin/tenants/new" className={buttonVariants()}>
              Crear empresa
            </Link>
          }
        />
      ) : (
        <Card className="overflow-hidden">
          <Table caption="Listado de empresas" minWidthClassName="min-w-[44rem]">
            <TableHead>
              <tr>
                <th scope="col">Empresa</th>
                <th scope="col">Estado</th>
                <th scope="col">Dominio principal</th>
                <th scope="col">Creada</th>
                <th scope="col" className="text-right">
                  Miembros
                </th>
              </tr>
            </TableHead>
            <TableBody>
              {tenants.map((tenant) => (
                <TenantRow key={tenant.id} tenant={tenant} />
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
