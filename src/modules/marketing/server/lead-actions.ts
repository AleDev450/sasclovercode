"use server";

/**
 * Lead triage, from the Super Admin console.
 *
 * Re-checks platform authority even though the layout already did, and even
 * though the update policy on `platform_leads` checks a third time in
 * PostgreSQL. A Server Action is reachable by any client that knows its id, so
 * the layout guard is not a guard at all for this entry point (master section
 * 45).
 */

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { FormState } from "@/lib/forms/state";
import { logger } from "@/lib/logger";
import { requirePlatformAdmin } from "@/lib/platform/access";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { toFieldErrors } from "@/lib/validation";

const updateLeadSchema = z.object({
  leadId: z.uuid("Prospecto invalido."),
  status: z.enum(["new", "contacted", "qualified", "won", "lost"]),
  internalNote: z
    .string()
    .trim()
    .max(2000, "La nota no puede superar 2000 caracteres.")
    .optional()
    .transform((value) => (value === undefined || value === "" ? null : value)),
});

export async function updateLeadAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  await requirePlatformAdmin();

  const parsed = updateLeadSchema.safeParse({
    leadId: formData.get("leadId"),
    status: formData.get("status"),
    internalNote: formData.get("internalNote") ?? undefined,
  });

  if (!parsed.success) {
    return {
      status: "error",
      message: "Revisa los datos.",
      fieldErrors: toFieldErrors(parsed.error),
    };
  }

  const { leadId, status, internalNote } = parsed.data;

  const client = await createSupabaseServerClient();

  const { error } = await client
    .from("platform_leads")
    .update({ status, internal_note: internalNote })
    .eq("id", leadId);

  if (error) {
    logger.error("marketing.leads.update_failed", { leadId, error });
    return { status: "error", message: "No pudimos actualizar el prospecto." };
  }

  /*
   * `contacted_at` is stamped the FIRST time the lead leaves `new`, and never
   * again - which is what the `.is("contacted_at", null)` filter enforces.
   *
   * It answers "how long did we take to reply", the one number that says
   * whether the landing page is actually being served. Re-stamping it on every
   * later edit would quietly turn it into "when did somebody last touch this",
   * and the original question would stop being answerable.
   *
   * A second statement rather than a branch in the first, because "set it only
   * if it is null" is a condition on the ROW, and PostgREST expresses that as a
   * filter. A failure here is logged and not surfaced: the triage the operator
   * asked for has already been saved, and losing a response-time metric is not
   * worth showing them an error about work that succeeded.
   */
  if (status !== "new") {
    const { error: stampError } = await client
      .from("platform_leads")
      .update({ contacted_at: new Date().toISOString() })
      .eq("id", leadId)
      .is("contacted_at", null);

    if (stampError) {
      logger.warn("marketing.leads.contacted_stamp_failed", { leadId, error: stampError });
    }
  }

  logger.info("marketing.leads.updated", { leadId, status });
  revalidatePath("/super-admin/prospectos");
  revalidatePath("/super-admin");

  return { status: "success", message: "Prospecto actualizado." };
}
