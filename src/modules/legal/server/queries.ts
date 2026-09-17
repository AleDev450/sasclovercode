import "server-only";

/**
 * Read side of the policies and the Libro de Reclamaciones (Phase 30).
 *
 * The public reads degrade: a policy that fails to load falls back to the
 * template rather than taking the page down. The book itself is member-only and
 * throws on failure, like every dashboard read - a complaints list that silently
 * came back empty would read as "nobody complained".
 */

import { cache } from "react";
import { LIST_CAP } from "@/config/app";
import { DatabaseError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ComplaintStatus, ComplaintType, LegalDocumentKind } from "@/types/database";
import { legalTemplate, type LegalIdentity } from "../templates";

export const getPublicLegalIdentity = cache(
  async (tenantId: string, fallbackName: string): Promise<LegalIdentity> => {
    const client = await createSupabaseServerClient();
    const { data, error } = await client.rpc("get_public_legal_identity", {
      p_tenant_id: tenantId,
    });

    const row = data?.[0];
    if (error || row === undefined) {
      if (error) logger.error("legal.identity_failed", { tenantId, error });
      return {
        name: fallbackName,
        legalName: null,
        taxId: null,
        address: null,
        email: null,
        phone: null,
      };
    }

    const address = [row.address_line, row.district, row.city]
      .filter((part): part is string => part !== null && part.trim().length > 0)
      .join(", ");

    return {
      name: row.trade_name,
      legalName: row.legal_name,
      taxId: row.tax_id,
      address: address.length > 0 ? address : null,
      email: row.public_email,
      phone: row.phone,
    };
  },
);

export interface ResolvedLegalDocument {
  readonly body: string;
  /** Null for the template: it has no "last updated" of its own. */
  readonly updatedAt: string | null;
  readonly isTemplate: boolean;
}

/** The business's own text, or the template filled with its data. */
export async function getPublicLegalDocument(
  tenantId: string,
  kind: LegalDocumentKind,
  identity: LegalIdentity,
): Promise<ResolvedLegalDocument> {
  const client = await createSupabaseServerClient();
  const { data, error } = await client.rpc("get_public_legal_document", {
    p_tenant_id: tenantId,
    p_kind: kind,
  });

  if (error) logger.error("legal.document_failed", { tenantId, kind, error });

  const row = data?.[0];
  return row === undefined
    ? { body: legalTemplate(kind, identity), updatedAt: null, isTemplate: true }
    : { body: row.body, updatedAt: row.updated_at, isTemplate: false };
}

/** The three documents as stored, for the editor. Missing kinds are absent. */
export async function listLegalDocuments(
  tenantId: string,
): Promise<Partial<Record<LegalDocumentKind, { body: string; updatedAt: string }>>> {
  const client = await createSupabaseServerClient();
  const { data, error } = await client
    .from("tenant_legal_documents")
    .select("kind, body, updated_at")
    .eq("tenant_id", tenantId)
    .limit(3);

  if (error) {
    logger.error("legal.documents_list_failed", { tenantId, error });
    throw new DatabaseError("Legal documents lookup failed.", { cause: error });
  }

  const result: Partial<Record<LegalDocumentKind, { body: string; updatedAt: string }>> = {};
  for (const row of data ?? []) {
    result[row.kind] = { body: row.body, updatedAt: row.updated_at };
  }
  return result;
}

export interface ComplaintRow {
  readonly id: string;
  readonly number: number;
  readonly type: ComplaintType;
  readonly status: ComplaintStatus;
  readonly createdAt: string;
  readonly dueOn: string;
  readonly providerName: string;
  readonly providerTaxId: string | null;
  readonly consumerName: string;
  readonly consumerAddress: string;
  readonly documentType: string;
  readonly documentNumber: string;
  readonly consumerEmail: string;
  readonly consumerPhone: string;
  readonly isMinor: boolean;
  readonly guardianName: string | null;
  readonly itemType: string;
  readonly amountCents: number | null;
  readonly itemDescription: string;
  readonly orderReference: string | null;
  readonly incidentDate: string | null;
  readonly detail: string;
  readonly consumerRequest: string;
  readonly responseChannel: string;
  readonly response: string | null;
  readonly respondedAt: string | null;
}

export async function listComplaints(
  tenantId: string,
  status: ComplaintStatus | "all",
): Promise<readonly ComplaintRow[]> {
  const client = await createSupabaseServerClient();
  let query = client
    .from("complaints")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(LIST_CAP);

  if (status !== "all") query = query.eq("status", status);

  const { data, error } = await query;
  if (error) {
    logger.error("legal.complaints_list_failed", { tenantId, error });
    throw new DatabaseError("Complaints lookup failed.", { cause: error });
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    number: row.number,
    type: row.type,
    status: row.status,
    createdAt: row.created_at,
    dueOn: row.due_on,
    providerName: row.provider_name,
    providerTaxId: row.provider_tax_id,
    consumerName: row.consumer_name,
    consumerAddress: row.consumer_address,
    documentType: row.document_type,
    documentNumber: row.document_number,
    consumerEmail: row.consumer_email,
    consumerPhone: row.consumer_phone,
    isMinor: row.is_minor,
    guardianName: row.guardian_name,
    itemType: row.item_type,
    amountCents: row.amount_cents === null ? null : Number(row.amount_cents),
    itemDescription: row.item_description,
    orderReference: row.order_reference,
    incidentDate: row.incident_date,
    detail: row.detail,
    consumerRequest: row.consumer_request,
    responseChannel: row.response_channel,
    response: row.response,
    respondedAt: row.responded_at,
  }));
}
