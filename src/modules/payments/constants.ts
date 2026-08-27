/**
 * Payment method and cash movement types, and their Spanish labels.
 *
 * Master section 14: "Preparar: efectivo, Yape, Plin, tarjeta, transferencia,
 * gateways futuros." `other` is that last slot - a placeholder value, the
 * same move Phase 13 made for the `web` order source before a public
 * checkout existed to produce it.
 */

import type { CashMovementType, PaymentMethodType } from "@/types/database";

export const PAYMENT_METHOD_TYPES = [
  "cash",
  "yape",
  "plin",
  "card",
  "transfer",
  "other",
] as const satisfies readonly PaymentMethodType[];

export const PAYMENT_METHOD_TYPE_LABELS: Readonly<Record<PaymentMethodType, string>> = {
  cash: "Efectivo",
  yape: "Yape",
  plin: "Plin",
  card: "Tarjeta",
  transfer: "Transferencia",
  other: "Otro",
};

export const CASH_MOVEMENT_TYPES = [
  "sale",
  "payout",
  "deposit",
  "adjustment",
] as const satisfies readonly CashMovementType[];

export const CASH_MOVEMENT_TYPE_LABELS: Readonly<Record<CashMovementType, string>> = {
  sale: "Venta",
  payout: "Salida",
  deposit: "Ingreso",
  adjustment: "Ajuste",
};

/**
 * The movement types a person may enter by hand, gated by `cash.manage`.
 * `sale` is excluded: it is written only by the trigger on `payments`, never
 * by a direct insert (the RLS policy on `cash_movements` refuses it).
 */
export const MANUAL_CASH_MOVEMENT_TYPES = [
  "payout",
  "deposit",
  "adjustment",
] as const satisfies readonly CashMovementType[];
