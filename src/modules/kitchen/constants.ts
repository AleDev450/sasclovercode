/**
 * Stations and board labels for the KDS.
 *
 * Master section 33 (Phase 16): "new / preparing / ready" are not a new
 * state machine - they are three of Phase 13's own six `order_status`
 * values, relabelled for a kitchen screen. This file owns that relabelling;
 * `orders/lifecycle.ts` still owns the state machine itself.
 */

import type { KitchenStation, OrderStatus } from "@/types/database";

export const KITCHEN_STATIONS = [
  "kitchen",
  "bar",
  "sushi",
  "desserts",
] as const satisfies readonly KitchenStation[];

export const KITCHEN_STATION_LABELS: Readonly<Record<KitchenStation, string>> = {
  kitchen: "Cocina",
  bar: "Barra",
  sushi: "Sushi",
  desserts: "Postres",
};

/** The slice of `order_status` a kitchen board shows, in board order. */
export const BOARD_STATUSES = ["confirmed", "preparing", "ready"] as const satisfies readonly OrderStatus[];

export const BOARD_STATUS_LABELS: Readonly<Record<(typeof BOARD_STATUSES)[number], string>> = {
  confirmed: "Nuevo",
  preparing: "Preparando",
  ready: "Listo",
};
