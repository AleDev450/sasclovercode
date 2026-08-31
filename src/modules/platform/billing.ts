/**
 * The arithmetic and vocabulary of CloverCode's own billing.
 *
 * Pure and free of I/O, so the rules can be asserted directly. The database is
 * the authority - `run_subscription_billing()` is what actually charges anybody
 * - and what lives here is what a screen needs to say when a charge falls due,
 * when a subscription gets suspended, and what the next period will be.
 *
 * MASTER SECTION 22, and it is the whole point of this file existing under
 * `platform` rather than under a tenant module: this is CloverCode charging the
 * restaurant. What the restaurant charges its own customers is `modules/billing`
 * (Phase 17) and `modules/payments` (Phase 14). The two never meet.
 */

import type { PlanInterval, SaasPaymentStatus, SubscriptionEventType } from "@/types/database";

export const SAAS_PAYMENT_STATUS_LABELS: Readonly<Record<SaasPaymentStatus, string>> = {
  pending: "Pendiente",
  paid: "Pagado",
  failed: "Fallido",
  refunded: "Devuelto",
  void: "Anulado",
};

export const SUBSCRIPTION_EVENT_LABELS: Readonly<Record<SubscriptionEventType, string>> = {
  created: "Suscripcion creada",
  plan_changed: "Cambio de plan",
  status_changed: "Cambio de estado",
  period_advanced: "Periodo avanzado",
  charge_issued: "Cargo emitido",
  payment_recorded: "Pago registrado",
  payment_voided: "Cargo anulado",
};

/** The statuses that still represent money owed. */
export const OWED_STATUSES: readonly SaasPaymentStatus[] = ["pending"];

/**
 * Whether this charge is money the business owes right now.
 *
 * `void` and `refunded` are not debt, which is why the cycle's arrears steps
 * look only at `pending` - and why this mirrors that exactly.
 */
export function isOwed(charge: { status: SaasPaymentStatus }): boolean {
  return charge.status === "pending";
}

/** Whether an unpaid charge has passed its due date. */
export function isOverdue(
  charge: { status: SaasPaymentStatus; dueAt: string },
  now: Date = new Date(),
): boolean {
  if (!isOwed(charge)) return false;
  return new Date(charge.dueAt) <= now;
}

/**
 * When an unpaid charge stops being tolerated.
 *
 * A mirror of the cycle's step 6: due date plus the plan's grace days. Derived
 * rather than stored (ADR-026 decision 3) - there is no hot read that would
 * justify a column that could drift.
 */
export function graceEndsAt(dueAt: string, graceDays: number): Date {
  const end = new Date(dueAt);
  end.setUTCDate(end.getUTCDate() + graceDays);
  return end;
}

/** Whether the grace period on this charge has run out. */
export function isPastGrace(
  charge: { status: SaasPaymentStatus; dueAt: string },
  graceDays: number,
  now: Date = new Date(),
): boolean {
  if (!isOwed(charge)) return false;
  return graceEndsAt(charge.dueAt, graceDays) <= now;
}

/**
 * Where the next period ends.
 *
 * Calendar arithmetic, not "add 30 days": a monthly subscription that starts on
 * the 15th renews on the 15th. The interesting case is the 31st, where adding a
 * month has no exact answer - JavaScript rolls 31 January into 3 March, which
 * would bill somebody for a month they did not have. This clamps to the last
 * day of the target month instead, which is what PostgreSQL's `+ interval '1
 * month'` does and therefore what the cycle does.
 */
export function nextPeriodEnd(start: string | Date, interval: PlanInterval): Date {
  const from = typeof start === "string" ? new Date(start) : new Date(start.getTime());
  const day = from.getUTCDate();

  const target = new Date(from.getTime());
  target.setUTCDate(1);

  if (interval === "yearly") {
    target.setUTCFullYear(target.getUTCFullYear() + 1);
  } else {
    target.setUTCMonth(target.getUTCMonth() + 1);
  }

  // Last day of the month we landed on.
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();

  target.setUTCDate(Math.min(day, lastDay));
  return target;
}

/** What one run of the cycle did. Mirrors the function's return shape. */
export interface CycleSummary {
  readonly subscriptionsAdvanced: number;
  readonly chargesIssued: number;
  readonly markedPastDue: number;
  readonly suspended: number;
  readonly cancelled: number;
}

export const EMPTY_CYCLE: CycleSummary = {
  subscriptionsAdvanced: 0,
  chargesIssued: 0,
  markedPastDue: 0,
  suspended: 0,
  cancelled: 0,
};

/**
 * One sentence saying what a cycle run did.
 *
 * A run that did nothing is the normal case - the cycle is meant to be run
 * often - so it gets a sentence of its own rather than a list of five zeroes.
 */
export function summariseCycle(summary: CycleSummary): string {
  const parts: string[] = [];

  if (summary.chargesIssued > 0) parts.push(`${summary.chargesIssued} cargo(s) emitido(s)`);
  if (summary.subscriptionsAdvanced > 0) {
    parts.push(`${summary.subscriptionsAdvanced} periodo(s) avanzado(s)`);
  }
  if (summary.markedPastDue > 0) parts.push(`${summary.markedPastDue} en mora`);
  if (summary.suspended > 0) parts.push(`${summary.suspended} suspendida(s)`);
  if (summary.cancelled > 0) parts.push(`${summary.cancelled} cancelada(s)`);

  if (parts.length === 0) return "Nada que hacer: todo estaba al dia.";
  return `${parts.join(", ")}.`;
}
