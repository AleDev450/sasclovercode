import { Badge } from "@/components/ui";
import type { DomainProviderStatus, DomainVerificationStatus } from "@/types/database";
import type { TenantDomain } from "../server/queries";

/**
 * The three facts of a domain, shown as three lines.
 *
 * Deliberately not one traffic light. Master section 33 warns against assuming
 * that a row in our database configured the hosting provider, and a single
 * badge is exactly that assumption rendered: it would have to pick one of the
 * three states to show, and a business whose DNS is perfect but whose provider
 * entry is missing would read "pendiente" with no idea what to do next.
 *
 * Three lines answer "what is missing" without anybody having to ask support.
 */

const VERIFICATION_LABEL: Record<DomainVerificationStatus, string> = {
  pending: "Falta crear el registro TXT",
  verifying: "Dominio verificado",
  active: "Publicado y sirviendo",
  failed: "La ultima comprobacion fallo",
};

const VERIFICATION_VARIANT: Record<DomainVerificationStatus, "success" | "warning" | "neutral"> = {
  pending: "neutral",
  verifying: "warning",
  active: "success",
  failed: "warning",
};

const PROVIDER_LABEL: Record<DomainProviderStatus, string> = {
  unknown: "Sin registrar en el proveedor",
  requested: "Registro solicitado",
  ready: "Listo en el proveedor",
  error: "El proveedor reporto un problema",
};

export function DomainStatusBadge({ status }: { status: DomainVerificationStatus }) {
  return <Badge variant={VERIFICATION_VARIANT[status]}>{VERIFICATION_LABEL[status]}</Badge>;
}

function Fact({ done, children }: { done: boolean; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2 text-sm">
      <span aria-hidden="true" className={done ? "text-green-600" : "text-muted-foreground"}>
        {done ? "✓" : "○"}
      </span>
      <span className={done ? undefined : "text-muted-foreground"}>{children}</span>
      <span className="sr-only">{done ? "(hecho)" : "(pendiente)"}</span>
    </li>
  );
}

export function DomainFacts({ domain }: { domain: TenantDomain }) {
  const ownershipProven = domain.status === "verifying" || domain.status === "active";
  const serving = domain.status === "active";

  return (
    <ul className="flex flex-col gap-1">
      <Fact done={ownershipProven}>Nos consta que el dominio es tuyo (registro TXT)</Fact>
      <Fact done={domain.providerStatus === "ready"}>{PROVIDER_LABEL[domain.providerStatus]}</Fact>
      <Fact done={serving}>El dominio sirve tu sitio</Fact>
    </ul>
  );
}
