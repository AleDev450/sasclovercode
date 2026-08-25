/**
 * Validation boundary.
 *
 * CLOVERCODE_MASTER.md section 9: validate every input, using validation
 * schemas. Zod is that schema layer; this module is the only place allowed to
 * turn a Zod failure into a domain error, so the resulting shape is uniform
 * across server actions, route handlers and forms.
 */

import type { z } from "zod";
import { ValidationError } from "@/lib/errors";

/**
 * Flattens Zod issues into `{ "path.to.field": ["message", ...] }`.
 *
 * Issues without a path (whole-object refinements) are grouped under `_form`,
 * which mirrors how forms render non-field errors.
 */
export function toFieldErrors(error: z.ZodError): Record<string, string[]> {
  const fieldErrors: Record<string, string[]> = {};

  for (const issue of error.issues) {
    const key = issue.path.length > 0 ? issue.path.map(String).join(".") : "_form";
    const bucket = fieldErrors[key];
    if (bucket === undefined) {
      fieldErrors[key] = [issue.message];
    } else {
      bucket.push(issue.message);
    }
  }

  return fieldErrors;
}

/**
 * Parses `input`, or throws a `ValidationError` carrying per-field detail.
 *
 * Prefer this over `schema.parse()` so that a failure is already a domain error
 * with a safe public message by the time it reaches the HTTP boundary.
 */
export function parseOrThrow<Schema extends z.ZodType>(
  schema: Schema,
  input: unknown,
  message = "The submitted data is invalid.",
): z.output<Schema> {
  const result = schema.safeParse(input);

  if (!result.success) {
    throw new ValidationError(message, toFieldErrors(result.error), {
      // The raw input is NOT attached: it may contain credentials. The logger
      // would redact known keys, but not an unknown field carrying a secret.
      context: { issueCount: result.error.issues.length },
    });
  }

  return result.data;
}
