import Link from "next/link";
import { notFound } from "next/navigation";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui";
import { PERMISSIONS } from "@/lib/permissions";
import { hasPermission } from "@/lib/permissions/check";
import { requireActiveTenant } from "@/lib/tenant/active";
import {
  AddDomainForm,
  CheckDnsForm,
  DeleteDomainForm,
  SetPrimaryForm,
} from "@/modules/domains/components/domain-manager";
import { DomainFacts, DomainStatusBadge } from "@/modules/domains/components/domain-status";
import { dnsInstructions } from "@/modules/domains/dns";
import { listTenantDomains, type TenantDomain } from "@/modules/domains/server/queries";

export const metadata = { title: "Dominios" };

/** The records a business still has to create, with what to type where. */
function DnsRecords({ domain }: { domain: TenantDomain }) {
  if (domain.verificationToken === null) return null;
  const records = dnsInstructions(domain.domain, domain.verificationToken);

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[34rem] border-collapse text-sm">
        <caption className="sr-only">Registros DNS para {domain.domain}</caption>
        <thead>
          <tr className="border-border text-muted-foreground border-b text-left text-xs">
            <th scope="col" className="px-3 py-2 font-medium">
              Tipo
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Nombre
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Valor
            </th>
          </tr>
        </thead>
        <tbody>
          {records.map((record) => (
            <tr key={`${record.type}-${record.name}`} className="border-border border-b">
              <td className="px-3 py-2 font-mono">{record.type}</td>
              <td className="px-3 py-2 font-mono break-all">{record.name}</td>
              <td className="px-3 py-2">
                <span className="font-mono break-all">{record.value}</span>
                <span className="text-muted-foreground block text-xs">{record.purpose}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function DomainsPage({ params }: { params: Promise<{ tenantSlug: string }> }) {
  const { tenantSlug } = await params;
  const tenant = await requireActiveTenant(tenantSlug);

  // The nav hides this entry without the permission, but hiding is cosmetic
  // (master section 45): a typed URL lands here, so the page checks too.
  if (!(await hasPermission(tenant.id, PERMISSIONS.DOMAINS_VIEW))) {
    notFound();
  }

  const canManage = await hasPermission(tenant.id, PERMISSIONS.DOMAINS_MANAGE);
  const domains = await listTenantDomains(tenant.id);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dominios</h1>
          <p className="text-muted-foreground text-sm">
            Las direcciones por las que se llega al sitio de {tenant.name}.
          </p>
        </div>
        <Link
          href={`/dashboard/${tenant.slug}/configuracion`}
          className="text-muted-foreground hover:text-foreground text-sm"
        >
          Volver a configuracion
        </Link>
      </div>

      <ul className="flex flex-col gap-4">
        {domains.map((domain) => (
          <li key={domain.id}>
            <Card>
              <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <CardTitle as="h2" className="font-mono text-base break-all">
                    {domain.domain}
                  </CardTitle>
                  <div className="flex flex-wrap items-center gap-2">
                    {domain.isPrimary ? <Badge variant="success">Principal</Badge> : null}
                    {domain.type === "system" ? <Badge variant="neutral">Del sistema</Badge> : null}
                    <DomainStatusBadge status={domain.status} />
                  </div>
                </div>
                {domain.type === "system" ? (
                  <CardDescription>
                    Esta direccion siempre funciona. No se puede quitar: es la que queda si un
                    dominio propio deja de responder.
                  </CardDescription>
                ) : null}
              </CardHeader>

              <CardContent className="flex flex-col gap-5">
                {domain.type === "custom" ? <DomainFacts domain={domain} /> : null}

                {domain.lastError !== null ? (
                  <Alert variant="warning">
                    <AlertTitle>Ultima comprobacion</AlertTitle>
                    <AlertDescription>{domain.lastError}</AlertDescription>
                  </Alert>
                ) : null}

                {domain.type === "custom" && domain.status !== "active" ? (
                  <div className="flex flex-col gap-3">
                    <p className="text-sm font-medium">Registros DNS</p>
                    <DnsRecords domain={domain} />
                    <p className="text-muted-foreground text-xs">
                      Crea estos registros donde compraste el dominio. Los cambios de DNS pueden
                      tardar horas en propagarse.
                    </p>
                  </div>
                ) : null}

                {canManage && domain.type === "custom" ? (
                  <div className="flex flex-wrap items-start gap-4">
                    {domain.status !== "active" ? (
                      <CheckDnsForm tenantSlug={tenant.slug} domainId={domain.id} />
                    ) : null}
                    {domain.status === "active" && !domain.isPrimary ? (
                      <SetPrimaryForm tenantSlug={tenant.slug} domainId={domain.id} />
                    ) : null}
                    {!domain.isPrimary ? (
                      <DeleteDomainForm tenantSlug={tenant.slug} domainId={domain.id} />
                    ) : null}
                  </div>
                ) : null}
              </CardContent>
            </Card>
          </li>
        ))}
      </ul>

      {canManage ? (
        <Card>
          <CardHeader>
            <CardTitle as="h2">Conectar un dominio propio</CardTitle>
            <CardDescription>
              Anadirlo aqui es el primer paso de tres: verificar que es tuyo, apuntar el DNS a la
              plataforma, y que publiquemos el dominio. Te decimos en cada momento cual falta.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <AddDomainForm tenantSlug={tenant.slug} />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
