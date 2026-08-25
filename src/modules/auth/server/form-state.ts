/**
 * Auth form contract.
 *
 * Re-exported from the shared definition, which the Phase 04 audit promoted to
 * `@/lib/forms` once a second module needed the same shape. Kept as an alias so
 * the auth module's imports stay meaningful at their call sites.
 */
export { IDLE_FORM_STATE } from "@/lib/forms/state";
export type { FormState as AuthFormState } from "@/lib/forms/state";
