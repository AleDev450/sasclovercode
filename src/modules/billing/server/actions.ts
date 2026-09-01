"use server";

/**
 * Billing documents and provider configuration - Server Actions.
 *
 * Same posture as `orders/server/actions.ts` and `payments/server/actions.ts`:
 * `requirePermission`, a Zod parse, one write, and the database's own refusal
 * translated into a message a person can act on. Every invariant that
 * matters - the transition graph, the idempotency index, the RUC-needs-a-
 * factura-customer rule - is already enforced by the migrations (ADR-021);
 * nothing here re-derives one.
 */

import { revalidatePath } from "next/cache";
import { DatabaseError } from "@/lib/errors";
import type { FormState } from "@/lib/forms/state";
import { logger } from "@/lib/logger";
import { PERMISSIONS } from "@/lib/permissions";
import { requirePermission } from "@/lib/permissions/check";
import type { Permission } from "@/lib/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireActiveTenant } from "@/lib/tenant/active";
import { toFieldErrors } from "@/lib/validation";
import { getBillingProvider, type BillingDocumentForProvider } from "../provider";
import {
  acceptBillingDocumentSchema,
  billingProviderConfigSchema,
  cancelBillingDocumentSchema,
  issueBillingDocumentSchema,
  markSentBillingDocumentSchema,
  rejectBillingDocumentSchema,
  setBillingActiveSchema,
  setBillingCredentialsSchema,
} from "../schemas";

function readText(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

async function requireAccess(formData: FormData, permission: Permission) {
  const tenant = await requireActiveTenant(readText(formData, "tenantSlug"));
  await requirePermission(tenant.id, permission);
  return tenant;
}

/**
 * Turns a database refusal into a message a person can act on.
 *
 * The trigger messages (assign_billing_document,
 * guard_billing_document_status_change, populate_billing_document_items)
 * are written for exactly this: they name what went wrong, so the string is
 * matched rather than replaced with something generic.
 */
function describeDatabaseError(error: { code?: string; message: string }): FormState | null {
  if (error.code === "P0001") {
    if (error.message.includes("no lines cannot be billed")) {
      return { status: "error", message: "Ese pedido no tiene lineas y no se puede facturar." };
    }
    if (error.message.includes("cannot go from")) {
      return { status: "error", message: "Ese documento ya no admite ese cambio de estado." };
    }
    return { status: "error", message: "Esa operacion no esta permitida." };
  }

  if (error.code === "P0002") {
    return { status: "error", message: "Ese pedido no existe." };
  }

  if (error.code === "23514") {
    if (error.message.includes("cancelled order cannot be billed")) {
      return { status: "error", message: "Ese pedido esta anulado y no puede facturarse." };
    }
    if (error.message.includes("customer belongs to a different business")) {
      return {
        status: "error",
        fieldErrors: { customerId: ["Ese cliente no pertenece a este negocio."] },
      };
    }
    if (error.message.includes("related document belongs to a different business")) {
      return {
        status: "error",
        fieldErrors: { relatedDocumentId: ["Ese documento no pertenece a este negocio."] },
      };
    }
    if (error.message.includes("no RUC configured")) {
      return {
        status: "error",
        message: "Configura el RUC del negocio en Ajustes antes de emitir comprobantes.",
      };
    }
    if (error.message.includes("requires a reason")) {
      return { status: "error", fieldErrors: { reason: ["Escribe el motivo."] } };
    }
    if (error.message.includes("billing_documents_factura_needs_ruc_customer")) {
      return {
        status: "error",
        fieldErrors: { customerId: ["Una factura necesita un cliente con RUC."] },
      };
    }
    if (error.message.includes("billing_documents_notes_need_related_document")) {
      return {
        status: "error",
        fieldErrors: { relatedDocumentId: ["Indica que documento corrige esta nota."] },
      };
    }
    return { status: "error", message: "Esa operacion no esta permitida." };
  }

  if (error.code === "23505") {
    if (error.message.includes("billing_documents_one_live_per_order_type")) {
      return {
        status: "error",
        message: "Ese pedido ya tiene un documento vigente de ese tipo.",
      };
    }
    return { status: "error", message: "Ese documento ya existe." };
  }

  return null;
}

function revalidateBilling(slug: string, orderId?: string): void {
  revalidatePath(`/dashboard/${slug}/facturacion`);
  revalidatePath(`/dashboard/${slug}/configuracion/facturacion`);
  if (orderId !== undefined) revalidatePath(`/dashboard/${slug}/pedidos/${orderId}`);
}

// ---------------------------------------------------------------------------
// Billing documents
// ---------------------------------------------------------------------------

export async function issueBillingDocumentAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const tenant = await requireAccess(formData, PERMISSIONS.BILLING_CREATE);

  const parsed = issueBillingDocumentSchema.safeParse({
    orderId: readText(formData, "orderId"),
    type: readText(formData, "type"),
    customerId: readText(formData, "customerId"),
    relatedDocumentId: readText(formData, "relatedDocumentId"),
  });
  if (!parsed.success) return { status: "error", fieldErrors: toFieldErrors(parsed.error) };

  const client = await createSupabaseServerClient();
  const { error } = await client.from("billing_documents").insert({
    order_id: parsed.data.orderId,
    type: parsed.data.type,
    customer_id: parsed.data.customerId,
    related_document_id: parsed.data.relatedDocumentId,
  });

  if (error) {
    const described = describeDatabaseError(error);
    if (described !== null) return described;
    logger.error("billing.issue_failed", { tenantId: tenant.id, error });
    throw new DatabaseError("Billing document creation failed.", { cause: error });
  }

  logger.info("billing_document.created", { tenantId: tenant.id, orderId: parsed.data.orderId });
  revalidateBilling(tenant.slug, parsed.data.orderId);
  return {
    status: "success",
    message: "Documento creado. Marca como enviado cuando lo hayas presentado.",
  };
}

export async function markBillingDocumentSentAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const tenant = await requireAccess(formData, PERMISSIONS.BILLING_CREATE);

  const parsed = markSentBillingDocumentSchema.safeParse({
    documentId: readText(formData, "documentId"),
  });
  if (!parsed.success) return { status: "error", message: "Solicitud invalida." };

  const orderId = readText(formData, "orderId") || undefined;
  const client = await createSupabaseServerClient();

  const [{ data: document, error: fetchError }, { data: config }] = await Promise.all([
    client
      .from("billing_documents")
      .select(
        "id, type, series, number, issuer_ruc_snapshot, customer_name_snapshot, customer_doc_type_snapshot, customer_doc_number_snapshot, subtotal_cents, tax_cents, total_cents",
      )
      .eq("tenant_id", tenant.id)
      .eq("id", parsed.data.documentId)
      .maybeSingle(),
    client
      .from("billing_provider_configs")
      .select("provider_name")
      .eq("tenant_id", tenant.id)
      .maybeSingle(),
  ]);

  if (fetchError || document === null) {
    return { status: "error", message: "Ese documento no existe." };
  }

  const providerDocument: BillingDocumentForProvider = {
    id: document.id,
    type: document.type,
    series: document.series,
    number: document.number,
    issuerRuc: document.issuer_ruc_snapshot,
    customerName: document.customer_name_snapshot,
    customerDocType: document.customer_doc_type_snapshot,
    customerDocNumber: document.customer_doc_number_snapshot,
    subtotalCents: document.subtotal_cents,
    taxCents: document.tax_cents,
    totalCents: document.total_cents,
  };

  const provider = getBillingProvider(config?.provider_name ?? "manual");
  const result = await provider.issue(providerDocument);
  if (!result.ok) {
    return { status: "error", message: result.message ?? "El proveedor rechazo el envio." };
  }

  const { error } = await client
    .from("billing_documents")
    .update({ status: "sent" })
    .eq("tenant_id", tenant.id)
    .eq("id", parsed.data.documentId);

  if (error) {
    const described = describeDatabaseError(error);
    if (described !== null) return described;
    logger.error("billing.mark_sent_failed", { tenantId: tenant.id, error });
    throw new DatabaseError("Billing document status change failed.", { cause: error });
  }

  logger.info("billing_document.sent", { tenantId: tenant.id, documentId: parsed.data.documentId });
  revalidateBilling(tenant.slug, orderId);
  return { status: "success", message: result.message ?? "Documento enviado." };
}

export async function acceptBillingDocumentAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const tenant = await requireAccess(formData, PERMISSIONS.BILLING_CREATE);

  const parsed = acceptBillingDocumentSchema.safeParse({
    documentId: readText(formData, "documentId"),
  });
  if (!parsed.success) return { status: "error", message: "Solicitud invalida." };

  const orderId = readText(formData, "orderId") || undefined;
  const client = await createSupabaseServerClient();
  const { error } = await client
    .from("billing_documents")
    .update({ status: "accepted" })
    .eq("tenant_id", tenant.id)
    .eq("id", parsed.data.documentId);

  if (error) {
    const described = describeDatabaseError(error);
    if (described !== null) return described;
    logger.error("billing.accept_failed", { tenantId: tenant.id, error });
    throw new DatabaseError("Billing document status change failed.", { cause: error });
  }

  logger.info("billing_document.accepted", {
    tenantId: tenant.id,
    documentId: parsed.data.documentId,
  });
  revalidateBilling(tenant.slug, orderId);
  return { status: "success", message: "Documento aceptado por SUNAT." };
}

export async function rejectBillingDocumentAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const tenant = await requireAccess(formData, PERMISSIONS.BILLING_CREATE);

  const parsed = rejectBillingDocumentSchema.safeParse({
    documentId: readText(formData, "documentId"),
    reason: readText(formData, "reason"),
  });
  if (!parsed.success) return { status: "error", fieldErrors: toFieldErrors(parsed.error) };

  const orderId = readText(formData, "orderId") || undefined;
  const client = await createSupabaseServerClient();
  const { error } = await client
    .from("billing_documents")
    .update({ status: "rejected", rejection_reason: parsed.data.reason })
    .eq("tenant_id", tenant.id)
    .eq("id", parsed.data.documentId);

  if (error) {
    const described = describeDatabaseError(error);
    if (described !== null) return described;
    logger.error("billing.reject_failed", { tenantId: tenant.id, error });
    throw new DatabaseError("Billing document status change failed.", { cause: error });
  }

  logger.info("billing_document.rejected", {
    tenantId: tenant.id,
    documentId: parsed.data.documentId,
  });
  revalidateBilling(tenant.slug, orderId);
  return {
    status: "success",
    message: "Documento marcado como rechazado. Corrigelo con un documento nuevo.",
  };
}

export async function cancelBillingDocumentAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const tenant = await requireAccess(formData, PERMISSIONS.BILLING_CANCEL);

  const parsed = cancelBillingDocumentSchema.safeParse({
    documentId: readText(formData, "documentId"),
    reason: readText(formData, "reason"),
  });
  if (!parsed.success) return { status: "error", fieldErrors: toFieldErrors(parsed.error) };

  const orderId = readText(formData, "orderId") || undefined;
  const client = await createSupabaseServerClient();
  const { error } = await client
    .from("billing_documents")
    .update({ status: "cancelled", cancel_reason: parsed.data.reason })
    .eq("tenant_id", tenant.id)
    .eq("id", parsed.data.documentId);

  if (error) {
    const described = describeDatabaseError(error);
    if (described !== null) return described;
    logger.error("billing.cancel_failed", { tenantId: tenant.id, error });
    throw new DatabaseError("Billing document cancellation failed.", { cause: error });
  }

  logger.info("billing_document.cancelled", {
    tenantId: tenant.id,
    documentId: parsed.data.documentId,
  });
  revalidateBilling(tenant.slug, orderId);
  return { status: "success", message: "Documento anulado." };
}

// ---------------------------------------------------------------------------
// Provider configuration
// ---------------------------------------------------------------------------

export async function saveBillingProviderConfigAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const tenant = await requireAccess(formData, PERMISSIONS.BILLING_MANAGE);

  const parsed = billingProviderConfigSchema.safeParse({
    providerName: readText(formData, "providerName"),
    seriesBoleta: readText(formData, "seriesBoleta"),
    seriesFactura: readText(formData, "seriesFactura"),
    seriesNotaCredito: readText(formData, "seriesNotaCredito"),
    seriesNotaDebito: readText(formData, "seriesNotaDebito"),
  });
  if (!parsed.success) return { status: "error", fieldErrors: toFieldErrors(parsed.error) };

  const client = await createSupabaseServerClient();
  const { error } = await client
    .from("billing_provider_configs")
    .update({
      provider_name: parsed.data.providerName,
      series_boleta: parsed.data.seriesBoleta,
      series_factura: parsed.data.seriesFactura,
      series_nota_credito: parsed.data.seriesNotaCredito,
      series_nota_debito: parsed.data.seriesNotaDebito,
    })
    .eq("tenant_id", tenant.id);

  if (error) {
    logger.error("billing.save_config_failed", { tenantId: tenant.id, error });
    throw new DatabaseError("Billing provider config update failed.", { cause: error });
  }

  logger.info("billing_provider_config.saved", { tenantId: tenant.id });
  revalidateBilling(tenant.slug);
  return { status: "success", message: "Configuracion guardada." };
}

export async function setBillingActiveAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const tenant = await requireAccess(formData, PERMISSIONS.BILLING_MANAGE);

  const parsed = setBillingActiveSchema.safeParse({
    isActive: readText(formData, "isActive"),
  });
  if (!parsed.success) return { status: "error", message: "Solicitud invalida." };

  const client = await createSupabaseServerClient();
  const { error } = await client
    .from("billing_provider_configs")
    .update({ is_active: parsed.data.isActive })
    .eq("tenant_id", tenant.id);

  if (error) {
    logger.error("billing.set_active_failed", { tenantId: tenant.id, error });
    throw new DatabaseError("Billing provider config update failed.", { cause: error });
  }

  logger.info(
    parsed.data.isActive
      ? "billing_provider_config.activated"
      : "billing_provider_config.deactivated",
    { tenantId: tenant.id },
  );
  revalidateBilling(tenant.slug);
  return {
    status: "success",
    message: parsed.data.isActive ? "Facturacion activada." : "Facturacion desactivada.",
  };
}

export async function setBillingCredentialsAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const tenant = await requireAccess(formData, PERMISSIONS.BILLING_MANAGE);

  const parsed = setBillingCredentialsSchema.safeParse({
    credentials: readText(formData, "credentials"),
  });
  if (!parsed.success) return { status: "error", fieldErrors: toFieldErrors(parsed.error) };

  const client = await createSupabaseServerClient();
  const { error } = await client.rpc("set_billing_credentials", {
    p_tenant_id: tenant.id,
    p_credentials: parsed.data.credentials,
  });

  if (error) {
    logger.error("billing.set_credentials_failed", { tenantId: tenant.id, error });
    throw new DatabaseError("Billing credentials update failed.", { cause: error });
  }

  logger.info("billing_provider_config.credentials_set", { tenantId: tenant.id });
  revalidateBilling(tenant.slug);
  return { status: "success", message: "Credenciales guardadas." };
}

export async function clearBillingCredentialsAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const tenant = await requireAccess(formData, PERMISSIONS.BILLING_MANAGE);

  const client = await createSupabaseServerClient();
  const { error } = await client.rpc("clear_billing_credentials", { p_tenant_id: tenant.id });

  if (error) {
    logger.error("billing.clear_credentials_failed", { tenantId: tenant.id, error });
    throw new DatabaseError("Billing credentials removal failed.", { cause: error });
  }

  logger.info("billing_provider_config.credentials_cleared", { tenantId: tenant.id });
  revalidateBilling(tenant.slug);
  return { status: "success", message: "Credenciales eliminadas." };
}
