import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui";
import { setDomainStatusAction, setProviderStatusAction } from "../server/actions";
import type { TenantDomain } from "@/modules/domains/server/queries";

/**
 * The operator's view of a tenant's domains.
 *
 * This screen exists because of one line in master section 33: never assume
 * that adding a row to our database configured the hosting provider. Somebody
 * has to register the hostname there, and somebody has to say so afterwards -
 * so the two facts get two controls, and neither is derived from the other.
 *
 * Publishing is here and nowhere else. A tenant can prove it owns a domain, and
 * that is where its authority ends: `active` is what makes a name serve
 * traffic, and handing that switch to a tenant would let one business point
 * another's domain at its own site.
 */

const STATUS_VARIANT = {
  pending: "neutral",
  verifying: "warning",
  active: "success",
  failed: "warning",
} as const;

const PROVIDER_VARIANT = {
  unknown: "neutral",
  requested: "warning",
  ready: "success",
  error: "warning",
} as const;

function StatusButton({
  tenantId,
  domainId,
  status,
  label,
  variant = "secondary",
}: {
  tenantId: string;
  domainId: string;
  status: "verifying" | "active" | "failed";
  label: string;
  variant?: "secondary" | "destructive";
}) {
  return (
    <form action={setDomainStatusAction}>
      <input type="hidden" name="tenantId" value={tenantId} />
      <input type="hidden" name="domainId" value={domainId} />
      <input type="hidden" name="status" value={status} />
      <Button type="submit" variant={variant}>
        {label}
      </Button>
    </form>
  );
}

function ProviderButton({
  tenantId,
  domainId,
  providerStatus,
  label,
}: {
  tenantId: string;
  domainId: string;
  providerStatus: "unknown" | "requested" | "ready" | "error";
  label: string;
}) {
  return (
    <form action={setProviderStatusAction}>
      <input type="hidden" name="tenantId" value={tenantId} />
      <input type="hidden" name="domainId" value={domainId} />
      <input type="hidden" name="providerStatus" value={providerStatus} />
      <Button type="submit" variant="secondary">
        {label}
      </Button>
    </form>
  );
}

export function PlatformTenantDomains({
  tenantId,
  domains,
}: {
  tenantId: string;
  domains: readonly TenantDomain[];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">Dominios</CardTitle>
        <CardDescription>
          Publicar un dominio es una decision de plataforma. Antes de marcarlo activo, registralo en
          el proveedor de hosting: esta pantalla no lo hace por ti.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {domains.map((domain) => (
          <div
            key={domain.id}
            className="border-border flex flex-col gap-3 border-b pb-5 last:border-0 last:pb-0"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-mono text-sm break-all">{domain.domain}</span>
              <div className="flex flex-wrap items-center gap-2">
                {domain.isPrimary ? <Badge variant="success">Principal</Badge> : null}
                <Badge variant="neutral">{domain.type === "system" ? "Sistema" : "Propio"}</Badge>
                <Badge variant={STATUS_VARIANT[domain.status]}>{domain.status}</Badge>
                <Badge variant={PROVIDER_VARIANT[domain.providerStatus]}>
                  proveedor: {domain.providerStatus}
                </Badge>
              </div>
            </div>

            {domain.lastError !== null ? (
              <p className="text-muted-foreground text-xs">Ultimo error: {domain.lastError}</p>
            ) : null}

            {domain.type === "custom" ? (
              <div className="flex flex-wrap items-center gap-2">
                {domain.providerStatus !== "requested" ? (
                  <ProviderButton
                    tenantId={tenantId}
                    domainId={domain.id}
                    providerStatus="requested"
                    label="Marcar solicitado"
                  />
                ) : null}
                {domain.providerStatus !== "ready" ? (
                  <ProviderButton
                    tenantId={tenantId}
                    domainId={domain.id}
                    providerStatus="ready"
                    label="Marcar listo en proveedor"
                  />
                ) : null}
                {domain.status !== "active" ? (
                  <StatusButton
                    tenantId={tenantId}
                    domainId={domain.id}
                    status="active"
                    label="Publicar"
                  />
                ) : (
                  <StatusButton
                    tenantId={tenantId}
                    domainId={domain.id}
                    status="failed"
                    label="Retirar"
                    variant="destructive"
                  />
                )}
              </div>
            ) : null}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
