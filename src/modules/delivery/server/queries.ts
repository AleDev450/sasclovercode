import "server-only";

/**
 * Read side of delivery: zones, rates, the board, and one order's delivery.
 *
 * One audience: members of the business holding `delivery_zones.view` /
 * `deliveries.view`. Every query filters by `tenant_id` on top of RLS -
 * defence in depth, the same posture every module since Phase 11 takes.
 *
 * The board reads deliveries and their orders in ONE query with a declared
 * join, not a delivery list followed by a lookup per row: a board is opened
 * dozens of times a day and N+1 there is the kind of cost that only shows up
 * when a business gets busy.
 */

import { DatabaseError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { DeliveryStatus, TenantRole } from "@/types/database";
import type { RateCandidate } from "../rates";

export interface DeliveryZone {
  readonly id: string;
  readonly name: string;
  readonly district: string | null;
  readonly notes: string | null;
  readonly isActive: boolean;
}

export async function listDeliveryZones(
  tenantId: string,
  options: { activeOnly?: boolean } = {},
): Promise<readonly DeliveryZone[]> {
  const client = await createSupabaseServerClient();
  let query = client
    .from("delivery_zones")
    .select("id, name, district, notes, is_active")
    .eq("tenant_id", tenantId);
  if (options.activeOnly === true) query = query.eq("is_active", true);

  const { data, error } = await query.order("name");
  if (error) {
    logger.error("delivery.list_zones_failed", { tenantId, error });
    throw new DatabaseError("Delivery zone listing failed.", { cause: error });
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    district: row.district,
    notes: row.notes,
    isActive: row.is_active,
  }));
}

export interface DeliveryRate extends RateCandidate {
  /** Null for the zone default, which every branch falls back to. */
  readonly locationName: string | null;
}

export async function listDeliveryRates(tenantId: string): Promise<readonly DeliveryRate[]> {
  const client = await createSupabaseServerClient();
  const { data, error } = await client
    .from("delivery_rates")
    .select(
      "id, zone_id, location_id, fee_cents, min_order_free_cents, estimated_minutes, is_active, locations(name)",
    )
    .eq("tenant_id", tenantId)
    .order("zone_id");

  if (error) {
    logger.error("delivery.list_rates_failed", { tenantId, error });
    throw new DatabaseError("Delivery rate listing failed.", { cause: error });
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    zoneId: row.zone_id,
    locationId: row.location_id,
    feeCents: row.fee_cents,
    minOrderFreeCents: row.min_order_free_cents,
    estimatedMinutes: row.estimated_minutes,
    isActive: row.is_active,
    locationName: (row.locations as unknown as { name: string } | null)?.name ?? null,
  }));
}

export interface Courier {
  readonly userId: string;
  readonly email: string;
  readonly fullName: string | null;
  readonly role: TenantRole;
}

/**
 * Who can be assigned a delivery.
 *
 * Through `get_tenant_couriers`, gated on `deliveries.manage`, rather than
 * `get_tenant_members`, which needs `members.view` a cashier does not hold.
 */
export async function listCouriers(tenantId: string): Promise<readonly Courier[]> {
  const client = await createSupabaseServerClient();
  const { data, error } = await client.rpc("get_tenant_couriers", { p_tenant_id: tenantId });

  if (error) {
    logger.error("delivery.list_couriers_failed", { tenantId, error });
    throw new DatabaseError("Courier listing failed.", { cause: error });
  }

  return (data ?? []).map((row) => ({
    userId: row.user_id,
    email: row.email,
    fullName: row.full_name,
    role: row.role,
  }));
}

export interface DeliverySummary {
  readonly id: string;
  readonly orderId: string;
  readonly orderNumber: number;
  readonly orderStatus: string;
  readonly status: DeliveryStatus;
  readonly zoneName: string;
  readonly feeCents: number;
  readonly addressLine: string;
  readonly district: string | null;
  readonly reference: string | null;
  readonly recipientName: string | null;
  readonly recipientPhone: string | null;
  readonly courierUserId: string | null;
  readonly failureReason: string | null;
  readonly createdAt: string;
}

const SUMMARY_COLUMNS =
  "id, order_id, status, zone_name_snapshot, fee_cents, address_line, district, reference, " +
  "recipient_name, recipient_phone, courier_user_id, failure_reason, created_at, " +
  "orders(number, status)";

interface SummaryRow {
  id: string;
  order_id: string;
  status: DeliveryStatus;
  zone_name_snapshot: string;
  fee_cents: number;
  address_line: string;
  district: string | null;
  reference: string | null;
  recipient_name: string | null;
  recipient_phone: string | null;
  courier_user_id: string | null;
  failure_reason: string | null;
  created_at: string;
  orders: unknown;
}

function toSummary(row: SummaryRow): DeliverySummary {
  const order = row.orders as { number: number; status: string } | null;
  return {
    id: row.id,
    orderId: row.order_id,
    orderNumber: order?.number ?? 0,
    orderStatus: order?.status ?? "",
    status: row.status,
    zoneName: row.zone_name_snapshot,
    feeCents: row.fee_cents,
    addressLine: row.address_line,
    district: row.district,
    reference: row.reference,
    recipientName: row.recipient_name,
    recipientPhone: row.recipient_phone,
    courierUserId: row.courier_user_id,
    failureReason: row.failure_reason,
    createdAt: row.created_at,
  };
}

/** Everything still moving. The board's top half. */
export async function listOpenDeliveries(tenantId: string): Promise<readonly DeliverySummary[]> {
  const client = await createSupabaseServerClient();
  const { data, error } = await client
    .from("order_deliveries")
    .select(SUMMARY_COLUMNS)
    .eq("tenant_id", tenantId)
    .in("status", ["pending", "assigned", "in_transit", "failed"])
    .order("created_at", { ascending: true });

  if (error) {
    logger.error("delivery.list_open_failed", { tenantId, error });
    throw new DatabaseError("Delivery listing failed.", { cause: error });
  }

  return (data ?? []).map((row) => toSummary(row as unknown as SummaryRow));
}

/**
 * What already closed, most recent first.
 *
 * Capped rather than paginated (KL-1906): a board is a picture of now, and a
 * business with two years of history would otherwise load all of it.
 */
export async function listClosedDeliveries(
  tenantId: string,
  limit = 50,
): Promise<readonly DeliverySummary[]> {
  const client = await createSupabaseServerClient();
  const { data, error } = await client
    .from("order_deliveries")
    .select(SUMMARY_COLUMNS)
    .eq("tenant_id", tenantId)
    .in("status", ["delivered", "cancelled"])
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    logger.error("delivery.list_closed_failed", { tenantId, error });
    throw new DatabaseError("Delivery listing failed.", { cause: error });
  }

  return (data ?? []).map((row) => toSummary(row as unknown as SummaryRow));
}

export interface DeliveryHistoryEntry {
  readonly id: string;
  readonly fromStatus: DeliveryStatus | null;
  readonly toStatus: DeliveryStatus;
  readonly reason: string | null;
  readonly createdAt: string;
}

export interface DeliveryDetail extends DeliverySummary {
  readonly zoneId: string | null;
  readonly city: string | null;
  readonly latitude: number | null;
  readonly longitude: number | null;
  readonly notes: string | null;
  readonly history: readonly DeliveryHistoryEntry[];
}

/** The delivery of one order, or `null` when it has none. */
export async function getOrderDelivery(
  tenantId: string,
  orderId: string,
): Promise<DeliveryDetail | null> {
  const client = await createSupabaseServerClient();
  const { data, error } = await client
    .from("order_deliveries")
    // One literal, deliberately not a concatenation: PostgREST infers the row
    // type from the string, and a computed one degrades to `GenericStringError`.
    .select(
      "id, order_id, zone_id, status, zone_name_snapshot, fee_cents, address_line, district, city, reference, latitude, longitude, recipient_name, recipient_phone, notes, courier_user_id, failure_reason, created_at, orders(number, status)",
    )
    .eq("tenant_id", tenantId)
    .eq("order_id", orderId)
    .maybeSingle();

  if (error) {
    logger.error("delivery.get_failed", { tenantId, orderId, error });
    throw new DatabaseError("Delivery lookup failed.", { cause: error });
  }

  if (data === null) return null;

  const { data: history, error: historyError } = await client
    .from("delivery_status_history")
    .select("id, from_status, to_status, reason, created_at")
    .eq("tenant_id", tenantId)
    .eq("delivery_id", data.id)
    .order("created_at", { ascending: true });

  if (historyError) {
    logger.error("delivery.get_history_failed", { tenantId, orderId, error: historyError });
    throw new DatabaseError("Delivery history lookup failed.", { cause: historyError });
  }

  return {
    ...toSummary(data as unknown as SummaryRow),
    zoneId: data.zone_id,
    city: data.city,
    latitude: data.latitude,
    longitude: data.longitude,
    notes: data.notes,
    history: (history ?? []).map((row) => ({
      id: row.id,
      fromStatus: row.from_status,
      toStatus: row.to_status,
      reason: row.reason,
      createdAt: row.created_at,
    })),
  };
}
