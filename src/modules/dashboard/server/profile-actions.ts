"use server";

/**
 * Profile Server Action.
 *
 * Takes no user id. The identity comes from the session, and the
 * `profiles_update_own` policy from Phase 02 refuses anything else in the
 * database - so even a caller invoking this endpoint directly can only ever
 * edit themselves.
 */

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { DatabaseError } from "@/lib/errors";
import type { FormState } from "@/lib/forms/state";
import { logger } from "@/lib/logger";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { toFieldErrors } from "@/lib/validation";

const profileSchema = z.object({
  fullName: z
    .string()
    .trim()
    .min(1, "El nombre es obligatorio.")
    .max(120, "El nombre no puede superar 120 caracteres."),
});

export async function updateProfileAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireUser();

  const parsed = profileSchema.safeParse({ fullName: formData.get("fullName") });
  if (!parsed.success) {
    return { status: "error", fieldErrors: toFieldErrors(parsed.error) };
  }

  const client = await createSupabaseServerClient();
  const { error } = await client
    .from("profiles")
    .update({ full_name: parsed.data.fullName })
    .eq("id", user.id);

  if (error) {
    logger.error("dashboard.profile.update_failed", { userId: user.id, error });
    throw new DatabaseError("Profile update failed.", { cause: error });
  }

  logger.info("dashboard.profile.updated", { userId: user.id });
  revalidatePath("/dashboard", "layout");

  return { status: "success", message: "Perfil actualizado." };
}
