import "server-only";

/**
 * Read side of payment methods, cash registers, cash sessions and movements.
 *
 * Same posture as `orders/server/queries.ts`: nothing here sums a ledger by
 * hand. `expected_cents` and `difference_cents` only exist once a session is
 * closed (`close_cash_session()`), so the one place this file computes
 * anything itself is a LIVE PREVIEW for the close form - a convenience,
 * clearly separate from the stored, authoritative value the trigger writes.
 */

import { DatabaseError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { CashMovementType, PaymentMethodType } from "@/types/database";

export interface PaymentMethodSummary {
  readonly id: string;
  readonly type: PaymentMethodType;
  readonly name: string;
  readonly reference: string | null;
  readonly isActive: boolean;
}

export async function listPaymentMethods(
  tenantId: string,
  options: { activeOnly?: boolean } = {},
): Promise<readonly PaymentMethodSummary[]> {
  const client = await createSupabaseServerClient();
  let query = client
    .from("payment_methods")
    .select("id, type, name, reference, is_active")
    .eq("tenant_id", tenantId);

  if (options.activeOnly === true) query = query.eq("is_active", true);

  const { data, error } = await query.order("position").order("name");

  if (error) {
    logger.error("payment_methods.list_failed", { tenantId, error });
    throw new DatabaseError("Payment method listing failed.", { cause: error });
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    type: row.type,
    name: row.name,
    reference: row.reference,
    isActive: row.is_active,
  }));
}

export interface CashRegisterSummary {
  readonly id: string;
  readonly locationId: string;
  readonly locationName: string;
  readonly name: string;
  readonly isActive: boolean;
  readonly openSessionId: string | null;
  readonly openedAt: string | null;
}

/**
 * Every register of the tenant, with its currently open session if it has
 * one. The embed filters on `closed_at is null` - at most one row per
 * register, by `cash_sessions_one_open_per_register`.
 */
export async function listCashRegisters(tenantId: string): Promise<readonly CashRegisterSummary[]> {
  const client = await createSupabaseServerClient();
  // A plain (left) embed, not `cash_sessions!inner(...)`: a register with no
  // open session - closed, or never opened - still belongs on this list.
  const { data: rows, error } = await client
    .from("cash_registers")
    .select("id, location_id, name, is_active, locations(name), cash_sessions(id, opened_at, closed_at)")
    .eq("tenant_id", tenantId)
    .order("name");

  if (error) {
    logger.error("cash_registers.list_failed", { tenantId, error });
    throw new DatabaseError("Cash register listing failed.", { cause: error });
  }

  return (rows ?? []).map((row) => {
    const openSession = (
      row.cash_sessions as unknown as readonly { id: string; opened_at: string; closed_at: string | null }[]
    ).find((session) => session.closed_at === null);

    return {
      id: row.id,
      locationId: row.location_id,
      locationName: (row.locations as unknown as { name: string } | null)?.name ?? "—",
      name: row.name,
      isActive: row.is_active,
      openSessionId: openSession?.id ?? null,
      openedAt: openSession?.opened_at ?? null,
    };
  });
}

export interface OpenCashSession {
  readonly id: string;
  readonly cashRegisterId: string;
  readonly cashRegisterName: string;
  readonly openingCents: number;
}

/** The open sessions at one location - what a cashier picks from when charging cash. */
export async function listOpenSessionsForLocation(
  tenantId: string,
  locationId: string,
): Promise<readonly OpenCashSession[]> {
  const client = await createSupabaseServerClient();
  const { data, error } = await client
    .from("cash_sessions")
    .select("id, opening_cents, cash_registers!inner(id, name, location_id)")
    .eq("tenant_id", tenantId)
    .is("closed_at", null)
    .eq("cash_registers.location_id", locationId);

  if (error) {
    logger.error("cash_sessions.list_open_failed", { tenantId, locationId, error });
    throw new DatabaseError("Open session listing failed.", { cause: error });
  }

  return (data ?? []).map((row) => {
    const register = row.cash_registers as unknown as { id: string; name: string };
    return {
      id: row.id,
      cashRegisterId: register.id,
      cashRegisterName: register.name,
      openingCents: row.opening_cents,
    };
  });
}

export interface CashMovementEntry {
  readonly id: string;
  readonly type: CashMovementType;
  readonly amountCents: number;
  readonly reason: string | null;
  readonly createdAt: string;
}

export interface CashSessionDetail {
  readonly id: string;
  readonly cashRegisterId: string;
  readonly cashRegisterName: string;
  readonly locationName: string;
  readonly openingCents: number;
  readonly closingCents: number | null;
  readonly expectedCents: number | null;
  readonly differenceCents: number | null;
  readonly openedAt: string;
  readonly closedAt: string | null;
  readonly notes: string | null;
  readonly movements: readonly CashMovementEntry[];
  /**
   * opening + Σ movements, computed HERE for an open session as a live
   * preview of what closing would compute. Once the session is closed this
   * always equals `expectedCents`, the stored value - this field exists so a
   * still-open session has something to show before that number exists.
   */
  readonly runningTotalCents: number;
}

export async function getCashSessionDetail(
  tenantId: string,
  sessionId: string,
): Promise<CashSessionDetail | null> {
  const client = await createSupabaseServerClient();
  const { data, error } = await client
    .from("cash_sessions")
    .select(
      `id, opening_cents, closing_cents, expected_cents, difference_cents, opened_at, closed_at, notes,
       cash_registers(id, name, locations(name)),
       cash_movements(id, type, amount_cents, reason, created_at)`,
    )
    .eq("tenant_id", tenantId)
    .eq("id", sessionId)
    .maybeSingle();

  if (error) {
    logger.error("cash_sessions.detail_failed", { tenantId, sessionId, error });
    throw new DatabaseError("Cash session lookup failed.", { cause: error });
  }
  if (data === null) return null;

  const register = data.cash_registers as unknown as {
    id: string;
    name: string;
    locations: { name: string } | null;
  } | null;
  const movements = [
    ...(data.cash_movements as unknown as readonly {
      id: string;
      type: CashMovementType;
      amount_cents: number;
      reason: string | null;
      created_at: string;
    }[]),
  ].sort((a, b) => a.created_at.localeCompare(b.created_at));

  return {
    id: data.id,
    cashRegisterId: register?.id ?? "",
    cashRegisterName: register?.name ?? "—",
    locationName: register?.locations?.name ?? "—",
    openingCents: data.opening_cents,
    closingCents: data.closing_cents,
    expectedCents: data.expected_cents,
    differenceCents: data.difference_cents,
    openedAt: data.opened_at,
    closedAt: data.closed_at,
    notes: data.notes,
    movements: movements.map((movement) => ({
      id: movement.id,
      type: movement.type,
      amountCents: movement.amount_cents,
      reason: movement.reason,
      createdAt: movement.created_at,
    })),
    runningTotalCents: data.opening_cents + movements.reduce((sum, m) => sum + m.amount_cents, 0),
  };
}

export interface CashSessionSummary {
  readonly id: string;
  readonly cashRegisterName: string;
  readonly openingCents: number;
  readonly closingCents: number | null;
  readonly differenceCents: number | null;
  readonly openedAt: string;
  readonly closedAt: string | null;
}

/** Recent sessions of one register, most recent first - a till's own history. */
export async function listCashSessions(
  tenantId: string,
  cashRegisterId: string,
  limit = 20,
): Promise<readonly CashSessionSummary[]> {
  const client = await createSupabaseServerClient();
  const { data, error } = await client
    .from("cash_sessions")
    .select("id, opening_cents, closing_cents, difference_cents, opened_at, closed_at, cash_registers(name)")
    .eq("tenant_id", tenantId)
    .eq("cash_register_id", cashRegisterId)
    .order("opened_at", { ascending: false })
    .limit(limit);

  if (error) {
    logger.error("cash_sessions.list_failed", { tenantId, cashRegisterId, error });
    throw new DatabaseError("Cash session listing failed.", { cause: error });
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    cashRegisterName: (row.cash_registers as unknown as { name: string } | null)?.name ?? "—",
    openingCents: row.opening_cents,
    closingCents: row.closing_cents,
    differenceCents: row.difference_cents,
    openedAt: row.opened_at,
    closedAt: row.closed_at,
  }));
}
