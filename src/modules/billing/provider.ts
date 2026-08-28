/**
 * The BillingProvider abstraction (master §33, Phase 17: "No acoplar
 * dominio directamente a un proveedor").
 *
 * `ManualBillingProvider` is the only implementation this phase ships, and
 * it is not a placeholder: it calls no API. `issue()` records that the
 * document was handed off; a person then files it themselves through
 * SUNAT's own free SEE-SOL portal or a PSE's own console, and reports the
 * result back through `markBillingDocumentAction`. See ADR-021 for why -
 * no credentials or sandbox exist in this environment to build or verify a
 * real integration against, and master section 51 forbids guessing SUNAT
 * specifics from memory.
 *
 * A real adapter (Nubefact, Efact, SUNAT's own API, ...) implements this
 * same interface later, once there is something real to test it against.
 */

import type { BillingDocumentType, CustomerDocType } from "@/types/database";

export interface BillingDocumentForProvider {
  readonly id: string;
  readonly type: BillingDocumentType;
  readonly series: string;
  readonly number: number;
  readonly issuerRuc: string;
  readonly customerName: string | null;
  readonly customerDocType: CustomerDocType | null;
  readonly customerDocNumber: string | null;
  readonly subtotalCents: number;
  readonly taxCents: number;
  readonly totalCents: number;
}

export interface BillingProviderResult {
  readonly ok: boolean;
  readonly message?: string;
  /** An external id a real provider would hand back, to reconcile later. */
  readonly providerReference?: string;
}

export interface BillingProvider {
  readonly name: string;
  /** Hands the document off. Never called twice for the same document with a different outcome expected - that is what the idempotency_key (ADR-021 §3) exists for a real adapter to honour. */
  issue(document: BillingDocumentForProvider): Promise<BillingProviderResult>;
  /** SUNAT's "comunicación de baja" or equivalent, for a real provider. */
  void(providerReference: string, reason: string): Promise<BillingProviderResult>;
}

export class ManualBillingProvider implements BillingProvider {
  readonly name = "manual";

  async issue(document: BillingDocumentForProvider): Promise<BillingProviderResult> {
    return {
      ok: true,
      message: `Emite ${document.series}-${document.number} manualmente (SEE-SOL de SUNAT o tu PSE) y registra aqui si fue aceptado o rechazado.`,
    };
  }

  async void(): Promise<BillingProviderResult> {
    return {
      ok: true,
      message: "Registra la anulacion tambien en SEE-SOL o tu PSE, si corresponde.",
    };
  }
}

/**
 * Resolves the provider a tenant has configured. Only `manual` exists today
 * - any other configured name still resolves here rather than throwing, so
 * a stale or not-yet-built provider name never blocks issuing a document.
 */
export function getBillingProvider(_providerName: string): BillingProvider {
  return new ManualBillingProvider();
}
