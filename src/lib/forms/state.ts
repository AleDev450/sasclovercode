/**
 * Shared shape of every form result in CloverCode.
 *
 * Promoted out of `modules/auth` during the Phase 04 audit, when the platform
 * module needed the same contract. One shape means every form renders errors
 * the same way, and a reader who has seen one form has seen them all.
 *
 * Deliberately NOT inside a `"use server"` module: such a module may only
 * export async functions - Next.js turns every export into a callable server
 * endpoint - so a plain constant there is a build error.
 */

export interface FormState {
  readonly status: "idle" | "error" | "success";
  /** Rendered in an alert at the top of the form. Always safe to display. */
  readonly message?: string;
  /** Per-field messages, keyed by input name. */
  readonly fieldErrors?: Readonly<Record<string, readonly string[]>>;
}

export const IDLE_FORM_STATE: FormState = { status: "idle" };
