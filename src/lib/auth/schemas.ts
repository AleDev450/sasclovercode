/**
 * Validation schemas for every authentication input.
 *
 * CLOVERCODE_MASTER.md section 9: validate all input, using schemas. These live
 * in `lib` rather than in the auth module because the sign-in form (a client
 * component) and the server action must agree on the exact same rules, and a
 * client component cannot import from a server-only module.
 */

import { z } from "zod";

/**
 * Upper bound on every free-text credential field.
 *
 * bcrypt-family hashes ignore input beyond 72 bytes, and an unbounded field is
 * a cheap way to make the server hash megabytes on every attempt. Supabase
 * enforces its own limit; this one stops the request before it leaves us.
 */
const MAX_CREDENTIAL_LENGTH = 128;

export const emailSchema = z
  .string({ error: "El correo es obligatorio." })
  .trim()
  .toLowerCase()
  .min(1, "El correo es obligatorio.")
  .max(320, "El correo es demasiado largo.")
  .pipe(z.email({ error: "Introduce un correo valido." }));

/**
 * Password rules for a NEW password.
 *
 * Length is the requirement that actually correlates with strength, so it is
 * the one enforced. Composition rules ("must contain a symbol") push people
 * towards `Password1!` and are deliberately not imposed.
 *
 * Supabase's own project-level minimum must be configured to match or exceed
 * this; the check here fails fast with a usable message instead of surfacing a
 * provider error.
 */
export const newPasswordSchema = z
  .string({ error: "La contrasena es obligatoria." })
  .min(8, "La contrasena debe tener al menos 8 caracteres.")
  .max(MAX_CREDENTIAL_LENGTH, "La contrasena es demasiado larga.");

/**
 * Password rules when SIGNING IN.
 *
 * Deliberately weaker than `newPasswordSchema`: only presence and an upper
 * bound. Applying the strength rules here would reject an existing valid
 * password whenever the policy is tightened, and would tell an attacker which
 * candidate passwords are not worth trying.
 */
const existingPasswordSchema = z
  .string({ error: "La contrasena es obligatoria." })
  .min(1, "La contrasena es obligatoria.")
  .max(MAX_CREDENTIAL_LENGTH, "La contrasena es demasiado larga.");

export const signInSchema = z.object({
  email: emailSchema,
  password: existingPasswordSchema,
});

export const requestPasswordResetSchema = z.object({
  email: emailSchema,
});

export const updatePasswordSchema = z
  .object({
    password: newPasswordSchema,
    confirmPassword: z.string({ error: "Confirma la contrasena." }),
  })
  // Reported on `confirmPassword` so the message renders next to the field the
  // user has to fix, not at the top of the form.
  .refine((value) => value.password === value.confirmPassword, {
    message: "Las contrasenas no coinciden.",
    path: ["confirmPassword"],
  });

export type SignInInput = z.output<typeof signInSchema>;
export type RequestPasswordResetInput = z.output<typeof requestPasswordResetSchema>;
export type UpdatePasswordInput = z.output<typeof updatePasswordSchema>;
