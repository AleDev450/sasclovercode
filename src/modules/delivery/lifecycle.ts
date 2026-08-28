/**
 * The delivery lifecycle, in TypeScript.
 *
 * A MIRROR of `public.delivery_transitions`, not a second source of truth. The
 * database is the authority - it is what every writer goes through, including
 * the order-cancellation trigger, which never touches this file. What this
 * module adds is a board that can decide which buttons to draw without a round
 * trip, and labels in Spanish for a screen.
 *
 * TEST-1901 compares this table against the SQL one row for row, so the two
 * cannot drift apart silently. That test is the only reason it is safe to have
 * the machine written down twice.
 */

import type { DeliveryStatus } from "@/types/database";

export const DELIVERY_STATUSES = [
  "pending",
  "assigned",
  "in_transit",
  "delivered",
  "failed",
  "cancelled",
] as const satisfies readonly DeliveryStatus[];

export const DELIVERY_STATUS_LABELS: Readonly<Record<DeliveryStatus, string>> = {
  pending: "Sin asignar",
  assigned: "Asignado",
  in_transit: "En camino",
  delivered: "Entregado",
  failed: "No entregado",
  cancelled: "Anulado",
};

/**
 * The same ten rows as `delivery_transitions`.
 *
 * Written as a map from origin to destinations because that is the question the
 * UI asks - "what can this delivery do next" - while SQL stores it as pairs
 * because that is the question the trigger asks.
 */
const TRANSITIONS: Readonly<Record<DeliveryStatus, readonly DeliveryStatus[]>> = {
  pending: ["assigned", "cancelled"],
  // `pending` is here because a rider can fall through with no replacement yet.
  assigned: ["in_transit", "pending", "cancelled"],
  in_transit: ["delivered", "failed", "cancelled"],
  // Terminal. Stated as empty rather than omitted, so `nextStatuses` never has
  // to distinguish "no exits" from "unknown state".
  delivered: [],
  // NOT terminal: a second attempt is the same delivery, of the same order, to
  // the same address (ADR-023 decision 5).
  failed: ["assigned", "cancelled"],
  cancelled: [],
};

/** Where a delivery in `status` may go next. */
export function nextStatuses(status: DeliveryStatus): readonly DeliveryStatus[] {
  return TRANSITIONS[status];
}

/** Whether a specific move is allowed. */
export function canTransition(from: DeliveryStatus, to: DeliveryStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** True when nothing follows: the delivery is done, one way or the other. */
export function isTerminal(status: DeliveryStatus): boolean {
  return TRANSITIONS[status].length === 0;
}

/**
 * The forward move, excluding the ones that are not progress.
 *
 * The board draws this as the primary button and the rest as separate,
 * differently-styled actions, because they are different decisions: going back
 * to `pending` is undoing an assignment, and `failed`/`cancelled` are endings.
 */
export function nextForwardStatus(status: DeliveryStatus): DeliveryStatus | null {
  return (
    TRANSITIONS[status].find(
      (next) => next !== "cancelled" && next !== "failed" && next !== "pending",
    ) ?? null
  );
}

/** The statuses that mean somebody is still expected to do something. */
export function isOpen(status: DeliveryStatus): boolean {
  return !isTerminal(status);
}

/** Every declared pair, flattened - the shape the SQL table stores. */
export function allTransitionPairs(): readonly { from: DeliveryStatus; to: DeliveryStatus }[] {
  return DELIVERY_STATUSES.flatMap((from) => TRANSITIONS[from].map((to) => ({ from, to })));
}

/** Whether ending in this state requires somebody to say why. */
export function requiresReason(status: DeliveryStatus): boolean {
  return status === "failed" || status === "cancelled";
}
