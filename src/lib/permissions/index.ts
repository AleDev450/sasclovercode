/**
 * Pure exports only.
 *
 * `check.ts` is server-only and is NOT re-exported: a barrel that pulled it in
 * would drag `server-only` into every client bundle that just wanted the
 * permission constants. Import it explicitly:
 *
 *   import { requirePermission } from "@/lib/permissions/check";
 */
export { ALL_PERMISSIONS, ALL_ROLES, PERMISSIONS, ROLES, isPermission } from "./permissions";
export type { Permission, Role } from "./permissions";
