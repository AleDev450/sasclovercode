import "server-only";

/**
 * Read side of billing documents.
 *
 * One audience: members of the business holding `billing.view`
 * (`billing_documents_select_member`, Phase 17 migrations) or, for the
 * provider config, `billing.manage`. Every amount crossing this boundary is
 * an integer number of cents, same rule every money-bearing query in this
 * project follows since ADR-015.
 */

import { DatabaseError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { BillingDocumentStatus, BillingDocumentType, CustomerDocType } from "@/types/database";
import { LIST_CAP } from "@/config/app";

export interface BillingDocumentSummary {
  readonly id: string;
  readonly type: BillingDocumentType;
  readonly status: BillingDocumentStatus;
  readonly series: string;
  readonly number: number;
  readonly totalCents: number;
  readonly customerName: string | null;
  readonly orderId: string;
  readonly orderNumber: number;
  readonly createdAt: string;
}

export interface BillingDocumentItem {
  readonly id: string;
  readonly description: string;
  readonly quantity: number;
  readonly unitPriceCents: number;
  readonly discountCents: number;
  readonly subtotalCents: number;
  readonly taxCents: number;
  readonly totalCents: number;
}

export interface BillingEvent {
  readonly id: string;
  readonly fromStatus: BillingDocumentStatus | null;
  readonly toStatus: BillingDocumentStatus;
  readonly message: string | null;
  readonly createdAt: string;
}

export interface BillingDocumentDetail extends BillingDocumentSummary {
  readonly orderId: string;
  readonly issuerRuc: string;
  readonly customerDocType: CustomerDocType | null;
  readonly customerDocNumber: string | null;
  readonly subtotalCents: number;
  readonly taxCents: number;
  readonly relatedDocumentId: string | null;
  readonly rejectionReason: string | null;
  readonly cancelReason: string | null;
  readonly items: readonly BillingDocumentItem[];
  readonly events: readonly BillingEvent[];
}

const DOCUMENT_COLUMNS =
  "id, type, status, series, number, total_cents, customer_name_snapshot, order_id, orders(number)";

interface DocumentRowShape {
  id: string;
  type: BillingDocumentType;
  status: BillingDocumentStatus;
  series: string;
  number: number;
  total_cents: number;
  customer_name_snapshot: string | null;
  order_id: string;
  created_at: string;
  orders: { number: number } | null;
}

function toSummary(row: DocumentRowShape): BillingDocumentSummary {
  return {
    id: row.id,
    type: row.type,
    status: row.status,
    series: row.series,
    number: row.number,
    totalCents: row.total_cents,
    customerName: row.customer_name_snapshot,
    orderId: row.order_id,
    orderNumber: row.orders?.number ?? 0,
    createdAt: row.created_at,
  };
}

export const BILLING_DOCUMENTS_PAGE_SIZE = 20;

export interface BillingDocumentFilters {
  readonly status?: BillingDocumentStatus;
  readonly type?: BillingDocumentType;
  readonly page: number;
}

export interface BillingDocumentPage {
  readonly documents: readonly BillingDocumentSummary[];
  readonly total: number;
  readonly page: number;
  readonly pageCount: number;
}

export async function listBillingDocuments(
  tenantId: string,
  filters: BillingDocumentFilters,
): Promise<BillingDocumentPage> {
  const client = await createSupabaseServerClient();

  let query = client
    .from("billing_documents")
    .select(`${DOCUMENT_COLUMNS}, created_at`, { count: "exact" })
    .eq("tenant_id", tenantId);

  if (filters.status !== undefined) query = query.eq("status", filters.status);
  if (filters.type !== undefined) query = query.eq("type", filters.type);

  const from = (filters.page - 1) * BILLING_DOCUMENTS_PAGE_SIZE;

  const { data, error, count } = await query
    .order("created_at", { ascending: false })
    .range(from, from + BILLING_DOCUMENTS_PAGE_SIZE - 1);

  if (error) {
    logger.error("billing.list_failed", { tenantId, error });
    throw new DatabaseError("Billing document listing failed.", { cause: error });
  }

  const total = count ?? 0;

  return {
    documents: (data ?? []).map((row) => toSummary(row as unknown as DocumentRowShape)),
    total,
    page: filters.page,
    pageCount: Math.max(1, Math.ceil(total / BILLING_DOCUMENTS_PAGE_SIZE)),
  };
}

/** Every document issued against one order - what the order detail's "Comprobante" card shows. */
export async function listBillingDocumentsForOrder(
  tenantId: string,
  orderId: string,
): Promise<readonly BillingDocumentSummary[]> {
  const client = await createSupabaseServerClient();

  const { data, error } = await client
    .from("billing_documents")
    .select(`${DOCUMENT_COLUMNS}, created_at`)
    .eq("tenant_id", tenantId)
    .eq("order_id", orderId)
    .order("created_at", { ascending: false })
    .limit(LIST_CAP);

  if (error) {
    logger.error("billing.list_for_order_failed", { tenantId, orderId, error });
    throw new DatabaseError("Billing document listing failed.", { cause: error });
  }

  return (data ?? []).map((row) => toSummary(row as unknown as DocumentRowShape));
}

export async function getBillingDocumentDetail(
  tenantId: string,
  documentId: string,
): Promise<BillingDocumentDetail | null> {
  const client = await createSupabaseServerClient();

  const { data, error } = await client
    .from("billing_documents")
    .select(
      `${DOCUMENT_COLUMNS}, created_at, issuer_ruc_snapshot, customer_doc_type_snapshot,
       customer_doc_number_snapshot, subtotal_cents, tax_cents, related_document_id,
       rejection_reason, cancel_reason,
       billing_document_items(id, description_snapshot, quantity, unit_price_cents, discount_cents, subtotal_cents, tax_cents, total_cents, position),
       billing_events(id, from_status, to_status, message, created_at)`,
    )
    .eq("tenant_id", tenantId)
    .eq("id", documentId)
    .maybeSingle();

  if (error) {
    logger.error("billing.detail_failed", { tenantId, documentId, error });
    throw new DatabaseError("Billing document lookup failed.", { cause: error });
  }
  if (data === null) return null;

  const row = data as unknown as DocumentRowShape & {
    issuer_ruc_snapshot: string;
    customer_doc_type_snapshot: CustomerDocType | null;
    customer_doc_number_snapshot: string | null;
    subtotal_cents: number;
    tax_cents: number;
    related_document_id: string | null;
    rejection_reason: string | null;
    cancel_reason: string | null;
    billing_document_items: readonly {
      id: string;
      description_snapshot: string;
      quantity: number;
      unit_price_cents: number;
      discount_cents: number;
      subtotal_cents: number;
      tax_cents: number;
      total_cents: number;
      position: number;
    }[];
    billing_events: readonly {
      id: string;
      from_status: BillingDocumentStatus | null;
      to_status: BillingDocumentStatus;
      message: string | null;
      created_at: string;
    }[];
  };

  return {
    ...toSummary(row),
    orderId: row.order_id,
    issuerRuc: row.issuer_ruc_snapshot,
    customerDocType: row.customer_doc_type_snapshot,
    customerDocNumber: row.customer_doc_number_snapshot,
    subtotalCents: row.subtotal_cents,
    taxCents: row.tax_cents,
    relatedDocumentId: row.related_document_id,
    rejectionReason: row.rejection_reason,
    cancelReason: row.cancel_reason,
    items: (row.billing_document_items ?? [])
      .map((item) => ({
        id: item.id,
        description: item.description_snapshot,
        quantity: Number(item.quantity),
        unitPriceCents: item.unit_price_cents,
        discountCents: item.discount_cents,
        subtotalCents: item.subtotal_cents,
        taxCents: item.tax_cents,
        totalCents: item.total_cents,
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    events: (row.billing_events ?? [])
      .map((event) => ({
        id: event.id,
        fromStatus: event.from_status,
        toStatus: event.to_status,
        message: event.message,
        createdAt: event.created_at,
      }))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
  };
}

// ---------------------------------------------------------------------------
// Provider configuration
// ---------------------------------------------------------------------------

export interface BillingProviderConfig {
  readonly providerName: string;
  readonly isActive: boolean;
  readonly seriesBoleta: string | null;
  readonly seriesFactura: string | null;
  readonly seriesNotaCredito: string | null;
  readonly seriesNotaDebito: string | null;
  readonly hasCredentials: boolean;
  readonly credentialsUpdatedAt: string | null;
}

/**
 * Config metadata only - never the credential itself. `hasCredentials`
 * comes from `has_billing_credentials()` (Phase 17 migrations), which
 * reveals presence and nothing else (ADR-021).
 */
export async function getBillingProviderConfig(
  tenantId: string,
): Promise<BillingProviderConfig | null> {
  const client = await createSupabaseServerClient();

  const [{ data, error }, { data: hasCredentials, error: credError }] = await Promise.all([
    client
      .from("billing_provider_configs")
      .select(
        "provider_name, is_active, series_boleta, series_factura, series_nota_credito, series_nota_debito, credentials_updated_at",
      )
      .eq("tenant_id", tenantId)
      .maybeSingle(),
    client.rpc("has_billing_credentials", { p_tenant_id: tenantId }),
  ]);

  if (error) {
    logger.error("billing.config_failed", { tenantId, error });
    throw new DatabaseError("Billing provider config lookup failed.", { cause: error });
  }
  if (credError) {
    logger.error("billing.has_credentials_failed", { tenantId, error: credError });
    throw new DatabaseError("Billing credentials check failed.", { cause: credError });
  }
  if (data === null) return null;

  return {
    providerName: data.provider_name,
    isActive: data.is_active,
    seriesBoleta: data.series_boleta,
    seriesFactura: data.series_factura,
    seriesNotaCredito: data.series_nota_credito,
    seriesNotaDebito: data.series_nota_debito,
    hasCredentials: hasCredentials === true,
    credentialsUpdatedAt: data.credentials_updated_at,
  };
}
