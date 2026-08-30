/**
 * Pure exports only.
 *
 * `check.ts` is server-only and is NOT re-exported: a barrel that pulled it in
 * would drag `server-only` into every client bundle that just wanted the
 * module constants. Import it explicitly:
 *
 *   import { requireFeature } from "@/lib/features/check";
 */
export {
  ACCESS_GRANTING_STATUSES,
  ALL_MODULES,
  MODULES,
  MODULE_LABELS,
  PLAN_CODES,
  SUBSCRIPTION_STATUS_LABELS,
  isModule,
} from "./modules";
export type { Module } from "./modules";
