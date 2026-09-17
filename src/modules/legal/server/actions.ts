"use server";

/**
 * Policies and Libro de Reclamaciones Server Actions (Phase 30).
 *
 * `submitComplaintAction` is public, like the web checkout: the norm opens the
 * book to anyone, with or without an account. Its tenant comes from the
 * hostname; `submit_complaint` is the only writer of the table.
 *
 * The rest are dashboard actions with the usual three layers.
 */

import { revalidatePath } from "next/cache";
import { DatabaseError } from "@/lib/errors";
import type { FormState } from "@/lib/forms/state";
import { logger } from "@/lib/logger";
import { PERMISSIONS } from "@/lib/permissions";
import { requirePermission } from "@/lib/permissions/check";
import {
  consumeRateLimitForCaller,
  RATE_LIMITED_MESSAGE,
  RATE_LIMITS,
} from "@/lib/security/rate-limit";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireActiveTenant } from "@/lib/tenant/active";
import { toFieldErrors } from "@/lib/validation";
import { getSiteContext } from "@/modules/cms/server/site-context";
import { complaintAnswerSchema, complaintSchema, legalDocumentSchema } from "../schemas";

function readText(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

/* -------------------------------------------------------------------------- */
/*  Public: filing a complaint                                                 */
/* -------------------------------------------------------------------------- */

export type SubmitComplaintResult =
  | {
      readonly ok: true;
      readonly number: number;
      readonly filedAt: string;
      readonly dueOn: string;
    }
  | {
      readonly ok: false;
      readonly message: string;
      readonly fieldErrors?: Readonly<Record<string, readonly string[]>>;
    };

const GENERIC_COMPLAINT_ERROR =
  "No pudimos registrar tu reclamo. Revisa tu conexión e inténtalo de nuevo.";

export async function submitComplaintAction(input: unknown): Promise<SubmitComplaintResult> {
  const site = await getSiteContext();
  if (site === null || !site.isServing) {
    return { ok: false, message: "Este negocio no está disponible en este momento." };
  }

  if (!(await consumeRateLimitForCaller(RATE_LIMITS.COMPLAINT_SUBMIT))) {
    return { ok: false, message: RATE_LIMITED_MESSAGE };
  }

  const parsed = complaintSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors = toFieldErrors(parsed.error);
    return {
      ok: false,
      message: "Revisa los campos marcados.",
      fieldErrors,
    };
  }

  const data = parsed.data;
  const client = await createSupabaseServerClient();
  const { data: rows, error } = await client.rpc("submit_complaint", {
    p_tenant_id: site.tenant.id,
    p_data: {
      consumerName: data.consumerName,
      consumerAddress: data.consumerAddress,
      documentType: data.documentType,
      documentNumber: data.documentNumber,
      consumerEmail: data.consumerEmail,
      consumerPhone: data.consumerPhone,
      isMinor: data.isMinor,
      guardianName: data.isMinor ? data.guardianName : undefined,
      itemType: data.itemType,
      amountCents: data.amountCents,
      itemDescription: data.itemDescription,
      orderReference: data.orderReference,
      incidentDate: data.incidentDate === "" ? undefined : data.incidentDate,
      type: data.type,
      detail: data.detail,
      consumerRequest: data.consumerRequest,
      responseChannel: data.responseChannel,
    },
  });

  const row = rows?.[0];
  if (error || row === undefined) {
    logger.error("legal.complaint_failed", { tenantId: site.tenant.id, error });
    return { ok: false, message: GENERIC_COMPLAINT_ERROR };
  }

  // The number only: the sheet holds a document number and an address, and
  // none of that belongs in a log line.
  logger.info("legal.complaint_filed", {
    tenantId: site.tenant.id,
    number: row.complaint_number,
    type: data.type,
  });

  return { ok: true, number: row.complaint_number, filedAt: row.filed_at, dueOn: row.due_on };
}

/* -------------------------------------------------------------------------- */
/*  Dashboard: policies                                                        */
/* -------------------------------------------------------------------------- */

export async function saveLegalDocumentAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const tenant = await requireActiveTenant(readText(formData, "tenantSlug"));
  await requirePermission(tenant.id, PERMISSIONS.CONTENT_MANAGE);

  const parsed = legalDocumentSchema.safeParse({
    kind: readText(formData, "kind"),
    body: readText(formData, "body"),
  });
  if (!parsed.success) {
    return { status: "error", fieldErrors: toFieldErrors(parsed.error) };
  }

  const client = await createSupabaseServerClient();
  const { error } = await client
    .from("tenant_legal_documents")
    .upsert(
      { tenant_id: tenant.id, kind: parsed.data.kind, body: parsed.data.body },
      { onConflict: "tenant_id,kind" },
    );

  if (error) {
    logger.error("legal.document_save_failed", { tenantId: tenant.id, error });
    throw new DatabaseError("Legal document save failed.", { cause: error });
  }

  logger.info("legal.document_saved", { tenantId: tenant.id, kind: parsed.data.kind });
  revalidatePath(`/dashboard/${tenant.slug}/tienda/legales`);
  revalidatePath("/sitio", "layout");
  return { status: "success", message: "Texto guardado y publicado." };
}

/** Deletes the business's own text, so the template is shown again. */
export async function resetLegalDocumentAction(formData: FormData): Promise<void> {
  const tenant = await requireActiveTenant(readText(formData, "tenantSlug"));
  await requirePermission(tenant.id, PERMISSIONS.CONTENT_MANAGE);

  const kind = legalDocumentSchema.shape.kind.safeParse(readText(formData, "kind"));
  if (!kind.success) return;

  const client = await createSupabaseServerClient();
  const { error } = await client
    .from("tenant_legal_documents")
    .delete()
    .eq("tenant_id", tenant.id)
    .eq("kind", kind.data);

  if (error) {
    logger.error("legal.document_reset_failed", { tenantId: tenant.id, error });
    throw new DatabaseError("Legal document reset failed.", { cause: error });
  }

  logger.info("legal.document_reset", { tenantId: tenant.id, kind: kind.data });
  revalidatePath(`/dashboard/${tenant.slug}/tienda/legales`);
  revalidatePath("/sitio", "layout");
}

/* -------------------------------------------------------------------------- */
/*  Dashboard: answering a complaint                                           */
/* -------------------------------------------------------------------------- */

export async function answerComplaintAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const tenant = await requireActiveTenant(readText(formData, "tenantSlug"));
  await requirePermission(tenant.id, PERMISSIONS.COMPLAINTS_MANAGE);

  const parsed = complaintAnswerSchema.safeParse({
    complaintId: readText(formData, "complaintId"),
    response: readText(formData, "response"),
  });
  if (!parsed.success) {
    return { status: "error", fieldErrors: toFieldErrors(parsed.error) };
  }

  const client = await createSupabaseServerClient();
  const { error } = await client
    .from("complaints")
    // An empty answer puts the sheet back to pending; the trigger decides the
    // status and the stamps, never this call.
    .update({ response: parsed.data.response.length > 0 ? parsed.data.response : null })
    .eq("id", parsed.data.complaintId)
    .eq("tenant_id", tenant.id);

  if (error) {
    logger.error("legal.complaint_answer_failed", { tenantId: tenant.id, error });
    throw new DatabaseError("Complaint answer failed.", { cause: error });
  }

  logger.info("legal.complaint_answered", {
    tenantId: tenant.id,
    complaintId: parsed.data.complaintId,
  });
  revalidatePath(`/dashboard/${tenant.slug}/reclamos`);
  return {
    status: "success",
    message: "Respuesta guardada. Envíasela al consumidor por el medio que eligió.",
  };
}
