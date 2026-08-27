import "server-only";

/**
 * Read side of orders.
 *
 * One audience: members of the business holding `orders.view`. No public read
 * exists here or in the schema — an order names a person, an address and an
 * amount.
 *
 * Every amount crossing this boundary is an integer number of cents. Nothing
 * here divides by 100 and nothing here sums a total: the totals are columns,
 * computed by the database, and recomputing them in the application would be
 * the second opinion that eventually disagrees.
 */

import { DatabaseError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { OrderSource, OrderStatus } from "@/types/database";
import { ORDERS_PAGE_SIZE, type OrderFilters } from "../schemas";

export interface OrderSummary {
  readonly id: string;
  readonly number: number;
  readonly status: OrderStatus;
  readonly source: OrderSource;
  readonly totalCents: number;
  readonly placedAt: string;
  readonly locationName: string | null;
  readonly customerName: string | null;
}

export interface OrderLine {
  readonly id: string;
  readonly name: string;
  readonly variantName: string | null;
  readonly unitPriceCents: number;
  readonly quantity: number;
  readonly discountCents: number;
  readonly taxCents: number;
  readonly totalCents: number;
  readonly notes: string | null;
  readonly position: number;
}

export interface OrderHistoryEntry {
  readonly id: string;
  readonly fromStatus: OrderStatus | null;
  readonly toStatus: OrderStatus;
  readonly reason: string | null;
  readonly createdAt: string;
}

/**
 * A payment applied to the order (Phase 14). Read-only here: recording and
 * voiding go through `@/modules/payments`, which owns every write to this
 * table. This is only the shape the order detail screen shows alongside its
 * lines and its history.
 */
export interface OrderPayment {
  readonly id: string;
  readonly methodName: string;
  readonly amountCents: number;
  readonly reference: string | null;
  readonly voidedAt: string | null;
  readonly voidReason: string | null;
  readonly createdAt: string;
}

export interface OrderDetail extends OrderSummary {
  readonly locationId: string;
  readonly customerId: string | null;
  readonly notes: string | null;
  readonly subtotalCents: number;
  readonly discountCents: number;
  readonly taxCents: number;
  readonly shippingCents: number;
  readonly cancelReason: string | null;
  readonly completedAt: string | null;
  readonly lines: readonly OrderLine[];
  readonly history: readonly OrderHistoryEntry[];
  /** Sum of non-voided payments (`orders.paid_cents`, Phase 14). */
  readonly paidCents: number;
  /** `totalCents - paidCents`. Never negative: the database enforces the cap. */
  readonly balanceCents: number;
  readonly payments: readonly OrderPayment[];
}

export interface OrderPage {
  readonly orders: readonly OrderSummary[];
  readonly total: number;
  readonly page: number;
  readonly pageCount: number;
}

const ORDER_COLUMNS =
  "id, number, status, source, total_cents, placed_at, location_id, customer_id";

interface OrderRowShape {
  id: string;
  number: number;
  status: OrderStatus;
  source: OrderSource;
  total_cents: number;
  placed_at: string;
  locations: { name: string } | null;
  customers: { name: string } | null;
}

function toSummary(row: OrderRowShape): OrderSummary {
  return {
    id: row.id,
    number: row.number,
    status: row.status,
    source: row.source,
    totalCents: row.total_cents,
    placedAt: row.placed_at,
    locationName: row.locations?.name ?? null,
    customerName: row.customers?.name ?? null,
  };
}

/**
 * One page of a business's orders.
 *
 * Ordered by `placed_at` descending: what happened most recently is what
 * somebody standing at a counter needs to see. The listing deliberately does
 * NOT bring lines — that would be the N+1 that turns twenty orders into
 * twenty-one queries.
 */
export async function listOrders(tenantId: string, filters: OrderFilters): Promise<OrderPage> {
  const client = await createSupabaseServerClient();

  let query = client
    .from("orders")
    .select(`${ORDER_COLUMNS}, locations(name), customers(name)`, { count: "exact" })
    .eq("tenant_id", tenantId);

  if (filters.status !== null) query = query.eq("status", filters.status);
  if (filters.locationId !== null) query = query.eq("location_id", filters.locationId);

  const from = (filters.page - 1) * ORDERS_PAGE_SIZE;

  const { data, error, count } = await query
    .order("placed_at", { ascending: false })
    .range(from, from + ORDERS_PAGE_SIZE - 1);

  if (error) {
    logger.error("orders.list_failed", { tenantId, error });
    throw new DatabaseError("Order listing failed.", { cause: error });
  }

  const total = count ?? 0;

  return {
    orders: (data ?? []).map((row) => toSummary(row as unknown as OrderRowShape)),
    total,
    page: filters.page,
    pageCount: Math.max(1, Math.ceil(total / ORDERS_PAGE_SIZE)),
  };
}

/**
 * One order of THIS tenant, with its lines and its history.
 *
 * A single query with two embeds. The history is part of the order's meaning,
 * not a detail: it is what turns "this is cancelled" into "this was cancelled
 * at 14:32 because the customer left".
 */
export async function getOrderDetail(
  tenantId: string,
  orderId: string,
): Promise<OrderDetail | null> {
  const client = await createSupabaseServerClient();

  const { data, error } = await client
    .from("orders")
    .select(
      `${ORDER_COLUMNS}, notes, subtotal_cents, discount_cents, tax_cents, shipping_cents,
       cancel_reason, completed_at, paid_cents,
       locations(name), customers(name),
       order_items(id, name_snapshot, variant_snapshot, unit_price_cents, quantity,
                   discount_cents, tax_cents, total_cents, notes, position),
       order_status_history(id, from_status, to_status, reason, created_at),
       payments(id, amount_cents, reference, voided_at, void_reason, created_at,
                payment_methods(name))`,
    )
    .eq("tenant_id", tenantId)
    .eq("id", orderId)
    .maybeSingle();

  if (error) {
    logger.error("orders.detail_failed", { tenantId, orderId, error });
    throw new DatabaseError("Order lookup failed.", { cause: error });
  }
  if (data === null) return null;

  const row = data as unknown as OrderRowShape & {
    location_id: string;
    customer_id: string | null;
    notes: string | null;
    subtotal_cents: number;
    discount_cents: number;
    tax_cents: number;
    shipping_cents: number;
    cancel_reason: string | null;
    completed_at: string | null;
    paid_cents: number;
    payments: readonly {
      id: string;
      amount_cents: number;
      reference: string | null;
      voided_at: string | null;
      void_reason: string | null;
      created_at: string;
      payment_methods: { name: string } | null;
    }[];
    order_items: readonly {
      id: string;
      name_snapshot: string;
      variant_snapshot: string | null;
      unit_price_cents: number;
      quantity: number;
      discount_cents: number;
      tax_cents: number;
      total_cents: number;
      notes: string | null;
      position: number;
    }[];
    order_status_history: readonly {
      id: string;
      from_status: OrderStatus | null;
      to_status: OrderStatus;
      reason: string | null;
      created_at: string;
    }[];
  };

  return {
    ...toSummary(row),
    locationId: row.location_id,
    customerId: row.customer_id,
    notes: row.notes,
    subtotalCents: row.subtotal_cents,
    discountCents: row.discount_cents,
    taxCents: row.tax_cents,
    shippingCents: row.shipping_cents,
    cancelReason: row.cancel_reason,
    completedAt: row.completed_at,
    paidCents: row.paid_cents,
    // Never negative: the database's own CHECK (orders_paid_within_total)
    // guarantees paid_cents <= total_cents.
    balanceCents: row.total_cents - row.paid_cents,
    payments: (row.payments ?? [])
      .map((payment) => ({
        id: payment.id,
        methodName: payment.payment_methods?.name ?? "—",
        amountCents: payment.amount_cents,
        reference: payment.reference,
        voidedAt: payment.voided_at,
        voidReason: payment.void_reason,
        createdAt: payment.created_at,
      }))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    lines: (row.order_items ?? [])
      .map((line) => ({
        id: line.id,
        name: line.name_snapshot,
        variantName: line.variant_snapshot,
        unitPriceCents: line.unit_price_cents,
        // PostgREST serialises numeric as a string to keep it exact; a quantity
        // is not money, so turning it into a number here is safe. Every AMOUNT
        // above stays an integer and is never touched.
        quantity: Number(line.quantity),
        discountCents: line.discount_cents,
        taxCents: line.tax_cents,
        totalCents: line.total_cents,
        notes: line.notes,
        position: line.position,
      }))
      .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name)),
    history: (row.order_status_history ?? [])
      .map((entry) => ({
        id: entry.id,
        fromStatus: entry.from_status,
        toStatus: entry.to_status,
        reason: entry.reason,
        createdAt: entry.created_at,
      }))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
  };
}
