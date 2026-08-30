/**
 * The module catalogue, mirrored from the database.
 *
 * CLOVERCODE_MASTER.md section 33 (Phase 21) names ten modules. These
 * constants must stay in step with
 * `supabase/migrations/20260830130000_create_module_catalog.sql`;
 * `src/tests/database/modules.test.ts` fails if they drift.
 *
 * Mirrored for exactly the reason `PERMISSIONS` is (Phase 03): a union of
 * literals makes a typo a compile error instead of a silent `false` at
 * runtime, which would read as "your plan does not include this" and be very
 * hard to spot.
 */

import type { ModuleCode } from "@/types/database";

export const MODULES = {
  WEBSITE: "website",
  CATALOG: "catalog",
  ORDERS: "orders",
  POS: "pos",
  INVENTORY: "inventory",
  BILLING: "billing",
  DELIVERY: "delivery",
  LOYALTY: "loyalty",
  MULTI_LOCATION: "multi_location",
  REPORTS: "reports",
} as const satisfies Record<string, ModuleCode>;

export type Module = (typeof MODULES)[keyof typeof MODULES];

/** In the order the catalogue's `position` sorts them. */
export const ALL_MODULES: readonly Module[] = Object.values(MODULES);

/** Narrowing helper for values arriving from outside TypeScript. */
export function isModule(value: string): value is Module {
  return (ALL_MODULES as readonly string[]).includes(value);
}

export const MODULE_LABELS: Readonly<Record<Module, string>> = {
  website: "Sitio web",
  catalog: "Catalogo",
  orders: "Pedidos",
  pos: "Punto de venta",
  inventory: "Inventario",
  billing: "Facturacion",
  delivery: "Delivery",
  loyalty: "Fidelizacion",
  multi_location: "Multi-sede",
  reports: "Reportes",
};

/** The plan codes shipped in the catalogue migration. */
export const PLAN_CODES = ["starter", "professional", "enterprise"] as const;

export const SUBSCRIPTION_STATUS_LABELS = {
  trialing: "En prueba",
  active: "Activa",
  past_due: "Pago pendiente",
  suspended: "Suspendida",
  cancelled: "Cancelada",
} as const;

/**
 * The statuses that grant access.
 *
 * A mirror of the `in` list inside `has_module()`. `past_due` is here on
 * purpose (ADR-025 decision 3): cutting a restaurant off the moment a card
 * fails is cutting off its till mid-service over a problem at the bank.
 */
export const ACCESS_GRANTING_STATUSES = ["trialing", "active", "past_due"] as const;
