/**
 * Stock movement types, and their Spanish labels.
 *
 * Master section 33 (Phase 18): "Tipos: purchase, sale, adjustment, waste,
 * return, transfer."
 */

import type { StockMovementType } from "@/types/database";

export const STOCK_MOVEMENT_TYPES = [
  "purchase",
  "sale",
  "adjustment",
  "waste",
  "return",
  "transfer",
] as const satisfies readonly StockMovementType[];

export const STOCK_MOVEMENT_TYPE_LABELS: Readonly<Record<StockMovementType, string>> = {
  purchase: "Compra",
  sale: "Venta",
  adjustment: "Ajuste",
  waste: "Merma",
  return: "Devolucion",
  transfer: "Traslado",
};

/**
 * The movement types a person may enter by hand, gated by `inventory.manage`.
 * `purchase` (`purchases.create`) and `sale` (written only by the
 * order-completion trigger) are excluded here - `stock_movements_insert_
 * operator` (the RLS policy) refuses `sale` from every direct caller, and
 * gates `purchase` on a different permission entirely.
 */
export const MANUAL_STOCK_MOVEMENT_TYPES = [
  "adjustment",
  "waste",
  "return",
] as const satisfies readonly StockMovementType[];
