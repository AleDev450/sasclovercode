/**
 * The billing document lifecycle, in TypeScript.
 *
 * A MIRROR of `public.billing_document_transitions` (Phase 17), not a
 * second source of truth - same posture as `orders/lifecycle.ts` (Phase 13)
 * toward `order_transitions`. The database is the authority; this is what
 * lets a screen decide which buttons to draw without a round trip.
 *
 * A test pins this against the SQL table row for row, the same way
 * TEST-1301 pins `orders/lifecycle.ts` - see ADR-021 for why this phase
 * gets a transitions table at all rather than the nullable-pair shape
 * `payments` (ADR-018) uses: five edges, not one.
 */

import type { BillingDocumentStatus, BillingDocumentType } from "@/types/database";

export const BILLING_DOCUMENT_STATUSES = [
  "pending",
  "sent",
  "accepted",
  "rejected",
  "cancelled",
] as const satisfies readonly BillingDocumentStatus[];

export const BILLING_DOCUMENT_TYPES = [
  "boleta",
  "factura",
  "nota_credito",
  "nota_debito",
] as const satisfies readonly BillingDocumentType[];

export const BILLING_DOCUMENT_STATUS_LABELS: Readonly<Record<BillingDocumentStatus, string>> = {
  pending: "Pendiente",
  sent: "Enviado",
  accepted: "Aceptado",
  rejected: "Rechazado",
  cancelled: "Anulado",
};

export const BILLING_DOCUMENT_TYPE_LABELS: Readonly<Record<BillingDocumentType, string>> = {
  boleta: "Boleta",
  factura: "Factura",
  nota_credito: "Nota de credito",
  nota_debito: "Nota de debito",
};

/** The same five rows as billing_document_transitions. */
const TRANSITIONS: Readonly<Record<BillingDocumentStatus, readonly BillingDocumentStatus[]>> = {
  pending: ["sent", "cancelled"],
  sent: ["accepted", "rejected"],
  accepted: ["cancelled"],
  // Terminal. `rejected` has no way back - SUNAT gives it no tributary
  // validity, and the fix is a new, corrected document (ADR-021).
  rejected: [],
  cancelled: [],
};

export function nextStatuses(status: BillingDocumentStatus): readonly BillingDocumentStatus[] {
  return TRANSITIONS[status];
}

export function canTransition(from: BillingDocumentStatus, to: BillingDocumentStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function isTerminal(status: BillingDocumentStatus): boolean {
  return TRANSITIONS[status].length === 0;
}

/** Every declared pair, flattened - the shape the SQL table stores. */
export function allTransitionPairs(): readonly {
  from: BillingDocumentStatus;
  to: BillingDocumentStatus;
}[] {
  return BILLING_DOCUMENT_STATUSES.flatMap((from) => TRANSITIONS[from].map((to) => ({ from, to })));
}
