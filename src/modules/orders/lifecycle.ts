/**
 * The order lifecycle, in TypeScript.
 *
 * A MIRROR of `public.order_transitions`, not a second source of truth. The
 * database is the authority - it is what every writer goes through, and Phase
 * 15 will bring a POS that never touches this file. What this module adds is a
 * dashboard that can decide which buttons to draw without a round trip, and
 * labels in Spanish for a screen.
 *
 * TEST-1301 compares this table against the SQL one row for row, so the two
 * cannot drift apart silently. That test is the only reason it is safe to have
 * the machine written down twice.
 */

import type { OrderSource, OrderStatus } from "@/types/database";

export const ORDER_STATUSES = [
  "pending",
  "confirmed",
  "preparing",
  "ready",
  "completed",
  "cancelled",
] as const satisfies readonly OrderStatus[];

export const ORDER_SOURCES = [
  "web",
  "pos",
  "manual",
  "whatsapp",
  "delivery",
] as const satisfies readonly OrderSource[];

export const ORDER_STATUS_LABELS: Readonly<Record<OrderStatus, string>> = {
  pending: "Pendiente",
  confirmed: "Confirmado",
  preparing: "En preparacion",
  ready: "Listo",
  completed: "Entregado",
  cancelled: "Anulado",
};

export const ORDER_SOURCE_LABELS: Readonly<Record<OrderSource, string>> = {
  web: "Web",
  pos: "Caja",
  manual: "Manual",
  whatsapp: "WhatsApp",
  delivery: "Delivery",
};

/**
 * The same eight rows as `order_transitions`.
 *
 * Written as a map from origin to destinations because that is the question the
 * UI asks - "what can this order do next" - while SQL stores it as pairs
 * because that is the question the trigger asks.
 */
const TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  pending: ["confirmed", "cancelled"],
  confirmed: ["preparing", "cancelled"],
  preparing: ["ready", "cancelled"],
  ready: ["completed", "cancelled"],
  // Terminal. Stated as empty rather than omitted, so `nextStatuses` never has
  // to distinguish "no exits" from "unknown state".
  completed: [],
  cancelled: [],
};

/** Where an order in `status` may go next. */
export function nextStatuses(status: OrderStatus): readonly OrderStatus[] {
  return TRANSITIONS[status];
}

/** Whether a specific move is allowed. */
export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** True when nothing follows: the order is done, one way or the other. */
export function isTerminal(status: OrderStatus): boolean {
  return TRANSITIONS[status].length === 0;
}

/**
 * The forward move, excluding cancellation.
 *
 * The dashboard draws this as the primary button and cancellation as a separate
 * destructive one, because they are different decisions governed by different
 * permissions (`orders.update` vs `orders.cancel`).
 */
export function nextForwardStatus(status: OrderStatus): OrderStatus | null {
  return TRANSITIONS[status].find((next) => next !== "cancelled") ?? null;
}

/** Every declared pair, flattened - the shape the SQL table stores. */
export function allTransitionPairs(): readonly { from: OrderStatus; to: OrderStatus }[] {
  return ORDER_STATUSES.flatMap((from) => TRANSITIONS[from].map((to) => ({ from, to })));
}

/**
 * The total of one line, in cents.
 *
 * Mirrors what `snapshot_order_item()` computes in SQL, including the rounding
 * rule: `round()` half up, so the preview a cashier sees while typing matches
 * the number the database stores. A form that previews a different total than
 * it saves is worse than one that previews nothing.
 */
export function lineTotalCents(input: {
  unitPriceCents: number;
  quantity: number;
  discountCents?: number;
  taxCents?: number;
}): number {
  const gross = Math.round(input.unitPriceCents * input.quantity);
  return gross - (input.discountCents ?? 0) + (input.taxCents ?? 0);
}
