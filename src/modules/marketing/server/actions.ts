"use server";

/**
 * The public contact form.
 *
 * THE ONE ANONYMOUS WRITE IN THE PRODUCT. Everything else that changes data
 * requires a session and a membership; this is reachable by anybody on the
 * internet, which is what a contact form is for and also what makes it the
 * surface worth being careful about. Three things guard it:
 *
 *   1. A rate limit per caller address (`marketing.contact`).
 *   2. A honeypot field a person never sees and a naive bot always fills.
 *   3. `submit_lead()` in PostgreSQL, which is the ONLY writer of
 *      `platform_leads` - the table has no insert policy at all, so there is
 *      no second path that could be given different rules by accident.
 *
 * It deliberately does NOT send an email. Delivering mail is a dependency this
 * project does not have (master section 47), and a form that silently fails
 * because an SMTP credential expired is worse than one that writes a row an
 * operator reads in the console.
 */

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { FormState } from "@/lib/forms/state";
import { logger } from "@/lib/logger";
import {
  RATE_LIMITED_MESSAGE,
  RATE_LIMITS,
  consumeRateLimitForCaller,
} from "@/lib/security/rate-limit";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { toFieldErrors } from "@/lib/validation";
import { CONTACT_SOURCES, HONEYPOT_FIELD } from "../contact";

/**
 * Mirrors the CHECK constraints on `platform_leads`.
 *
 * Validating here as well as in the database is not duplication for its own
 * sake: this is what turns a constraint violation into a message under the
 * right field, and the database is what makes the rule true regardless of which
 * client is asking.
 */
const contactSchema = z.object({
  name: z.string().trim().min(2, "Escribe tu nombre.").max(120, "El nombre es demasiado largo."),
  email: z.email("Revisa el correo.").trim().toLowerCase().max(160),
  phone: z
    .string()
    .trim()
    .max(40, "El telefono es demasiado largo.")
    .optional()
    .transform((value) => (value === undefined || value === "" ? undefined : value)),
  businessName: z.string().trim().max(160).optional(),
  businessType: z.string().trim().max(80).optional(),
  message: z.string().trim().max(2000, "El mensaje no puede superar 2000 caracteres.").optional(),
});

const SUCCESS_MESSAGE =
  "Gracias, recibimos tus datos. Te contactamos dentro de las proximas 24 horas habiles.";

export async function submitContactAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  if (typeof formData.get(HONEYPOT_FIELD) === "string" && formData.get(HONEYPOT_FIELD) !== "") {
    logger.warn("marketing.contact.honeypot_tripped", {});
    return { status: "success", message: SUCCESS_MESSAGE };
  }

  const parsed = contactSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    phone: formData.get("phone") ?? undefined,
    businessName: formData.get("businessName") ?? undefined,
    businessType: formData.get("businessType") ?? undefined,
    message: formData.get("message") ?? undefined,
  });

  if (!parsed.success) {
    return {
      status: "error",
      message: "Revisa los datos marcados.",
      fieldErrors: toFieldErrors(parsed.error),
    };
  }

  // AFTER validation, so a malformed submission does not consume somebody's
  // budget, and BEFORE the write, which is the thing being protected.
  const allowed = await consumeRateLimitForCaller(RATE_LIMITS.MARKETING_CONTACT);
  if (!allowed) {
    return { status: "error", message: RATE_LIMITED_MESSAGE };
  }

  const source = formData.get("source");

  const client = await createSupabaseServerClient();
  const { error } = await client.rpc("submit_lead", {
    p_name: parsed.data.name,
    p_email: parsed.data.email,
    p_phone: parsed.data.phone ?? null,
    p_business_name: parsed.data.businessName ?? null,
    p_business_type: parsed.data.businessType ?? null,
    p_message: parsed.data.message ?? null,
    p_source: typeof source === "string" && source !== "" ? source : CONTACT_SOURCES.CONTACT,
  });

  if (error) {
    // The error object, never the submission: it carries an email address and a
    // phone number, and a log is not where those belong.
    logger.error("marketing.contact.submit_failed", { error });
    return {
      status: "error",
      message: "No pudimos registrar tu mensaje. Intenta de nuevo o escribenos por WhatsApp.",
    };
  }

  logger.info("marketing.contact.submitted", { source });

  // The operator inbox counts unread leads in its heading, so it has to be
  // rebuilt when one arrives.
  revalidatePath("/super-admin/prospectos");
  revalidatePath("/super-admin");

  return { status: "success", message: SUCCESS_MESSAGE };
}
