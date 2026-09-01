import { Badge } from "@/components/ui";
import { formatCurrency } from "@/lib/money";
import { BILLING_DOCUMENT_STATUS_LABELS, BILLING_DOCUMENT_TYPE_LABELS } from "../lifecycle";
import type { BillingDocumentSummary } from "../server/queries";
import {
  AcceptForm,
  CancelDocumentForm,
  MarkSentForm,
  RejectForm,
} from "./billing-document-actions";

const STATUS_BADGE: Record<
  BillingDocumentSummary["status"],
  "neutral" | "warning" | "success" | "destructive"
> = {
  pending: "neutral",
  sent: "warning",
  accepted: "success",
  rejected: "destructive",
  cancelled: "neutral",
};

/**
 * One document per row, each with its own action forms.
 *
 * Which form(s) render is entirely a function of `status` - the same "ask
 * the state machine, don't hardcode a list" posture `AdvanceOrderForm` takes
 * (Phase 13): a button for a transition `billing_document_transitions`
 * refuses is the failure this avoids.
 */
export function BillingDocumentsList({
  tenantSlug,
  orderId,
  documents,
  currency,
  canCreate,
  canCancel,
}: {
  tenantSlug: string;
  orderId: string;
  documents: readonly BillingDocumentSummary[];
  currency: string;
  canCreate: boolean;
  canCancel: boolean;
}) {
  if (documents.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">Todavia no se emitio ningun comprobante.</p>
    );
  }

  return (
    <ul className="flex flex-col">
      {documents.map((doc) => (
        <li key={doc.id} className="border-border flex flex-col gap-2 border-b py-3 last:border-0">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <span className="font-medium">{BILLING_DOCUMENT_TYPE_LABELS[doc.type]}</span>{" "}
              <span className="text-muted-foreground tabular-nums">
                {doc.series}-{String(doc.number).padStart(6, "0")}
              </span>
              {doc.customerName !== null ? (
                <span className="text-muted-foreground"> · {doc.customerName}</span>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              <span className="tabular-nums">{formatCurrency(doc.totalCents, currency)}</span>
              <Badge variant={STATUS_BADGE[doc.status]}>
                {BILLING_DOCUMENT_STATUS_LABELS[doc.status]}
              </Badge>
            </div>
          </div>

          {doc.status === "pending" ? (
            <div className="flex flex-wrap gap-2">
              {canCreate ? (
                <MarkSentForm tenantSlug={tenantSlug} orderId={orderId} documentId={doc.id} />
              ) : null}
              {canCancel ? (
                <CancelDocumentForm tenantSlug={tenantSlug} orderId={orderId} documentId={doc.id} />
              ) : null}
            </div>
          ) : null}

          {doc.status === "sent" && canCreate ? (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <AcceptForm tenantSlug={tenantSlug} orderId={orderId} documentId={doc.id} />
              <RejectForm tenantSlug={tenantSlug} orderId={orderId} documentId={doc.id} />
            </div>
          ) : null}

          {doc.status === "accepted" && canCancel ? (
            <CancelDocumentForm tenantSlug={tenantSlug} orderId={orderId} documentId={doc.id} />
          ) : null}
        </li>
      ))}
    </ul>
  );
}
