/**
 * Shared shape of every auth form result.
 *
 * Deliberately NOT in `actions.ts`. A `"use server"` module may only export
 * async functions - Next.js turns every export into a callable server endpoint -
 * so a plain constant living there is a build error. Keeping the type and its
 * initial value here lets both the actions and the client forms import them.
 */

export interface AuthFormState {
  readonly status: "idle" | "error" | "success";
  /** Rendered in an alert at the top of the form. Always safe to display. */
  readonly message?: string;
  /** Per-field messages, keyed by input name. */
  readonly fieldErrors?: Readonly<Record<string, readonly string[]>>;
}

export const IDLE_FORM_STATE: AuthFormState = { status: "idle" };
