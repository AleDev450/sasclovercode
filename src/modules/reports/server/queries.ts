import "server-only";

/**
 * Read side of reporting - and there is no other side. This module writes
 * nothing.
 *
 * Every function here is one RPC to one aggregate function. Nothing is summed
 * in JavaScript: master section 33 warns against "consultas extremadamente
 * costosas en cada request", and bringing a month of orders into Node to add
 * them up is that cost paid in memory instead of in CPU (ADR-027 decision 1).
 *
 * Authorization is inside the SQL: the seven functions are SECURITY DEFINER
 * with an explicit `reports.view` gate, so a caller without it gets zero rows
 * rather than an error - the same behaviour `get_tenant_members` has had since
 * Phase 03.
 */

import { DatabaseError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { PaymentMethodType } from "@/types/database";
import type { DateRange } from "../ranges";

export interface SalesSummary {
  readonly orderCount: number;
  readonly grossCents: number;
  readonly discountCents: number;
  readonly shippingCents: number;
  readonly netCents: number;
  readonly averageTicketCents: number;
  readonly itemCount: number;
}

/** A tenant with no sales, and the answer for a caller with no permission. */
export const EMPTY_SUMMARY: SalesSummary = {
  orderCount: 0,
  grossCents: 0,
  discountCents: 0,
  shippingCents: 0,
  netCents: 0,
  averageTicketCents: 0,
  itemCount: 0,
};

export async function getSalesSummary(
  tenantId: string,
  range: DateRange,
  locationId: string | null,
): Promise<SalesSummary> {
  const client = await createSupabaseServerClient();
  const { data, error } = await client.rpc("report_sales_summary", {
    p_tenant_id: tenantId,
    p_from: range.from,
    p_to: range.to,
    p_location_id: locationId,
  });

  if (error) {
    logger.error("reports.summary_failed", { tenantId, error });
    throw new DatabaseError("Sales summary failed.", { cause: error });
  }

  const row = data?.[0];
  if (row === undefined) return EMPTY_SUMMARY;

  return {
    orderCount: Number(row.order_count),
    grossCents: Number(row.gross_cents),
    discountCents: Number(row.discount_cents),
    shippingCents: Number(row.shipping_cents),
    netCents: Number(row.net_cents),
    averageTicketCents: Number(row.average_ticket_cents),
    itemCount: Number(row.item_count),
  };
}

export interface DailySales {
  readonly day: string;
  readonly orderCount: number;
  readonly netCents: number;
}

export async function getSalesByDay(
  tenantId: string,
  range: DateRange,
  locationId: string | null,
): Promise<readonly DailySales[]> {
  const client = await createSupabaseServerClient();
  const { data, error } = await client.rpc("report_sales_by_day", {
    p_tenant_id: tenantId,
    p_from: range.from,
    p_to: range.to,
    p_location_id: locationId,
  });

  if (error) {
    logger.error("reports.by_day_failed", { tenantId, error });
    throw new DatabaseError("Daily sales report failed.", { cause: error });
  }

  return (data ?? []).map((row) => ({
    day: row.day,
    orderCount: Number(row.order_count),
    netCents: Number(row.net_cents),
  }));
}

export interface HourlySales {
  readonly hour: number;
  readonly orderCount: number;
  readonly netCents: number;
}

/** Always 24 rows: the hours with no sales are the useful ones. */
export async function getSalesByHour(
  tenantId: string,
  range: DateRange,
  locationId: string | null,
): Promise<readonly HourlySales[]> {
  const client = await createSupabaseServerClient();
  const { data, error } = await client.rpc("report_sales_by_hour", {
    p_tenant_id: tenantId,
    p_from: range.from,
    p_to: range.to,
    p_location_id: locationId,
  });

  if (error) {
    logger.error("reports.by_hour_failed", { tenantId, error });
    throw new DatabaseError("Hourly sales report failed.", { cause: error });
  }

  return (data ?? []).map((row) => ({
    hour: Number(row.hour),
    orderCount: Number(row.order_count),
    netCents: Number(row.net_cents),
  }));
}

export interface LocationSales {
  readonly locationId: string;
  readonly locationName: string;
  readonly orderCount: number;
  readonly netCents: number;
}

export async function getSalesByLocation(
  tenantId: string,
  range: DateRange,
): Promise<readonly LocationSales[]> {
  const client = await createSupabaseServerClient();
  const { data, error } = await client.rpc("report_sales_by_location", {
    p_tenant_id: tenantId,
    p_from: range.from,
    p_to: range.to,
  });

  if (error) {
    logger.error("reports.by_location_failed", { tenantId, error });
    throw new DatabaseError("Location sales report failed.", { cause: error });
  }

  return (data ?? []).map((row) => ({
    locationId: row.location_id,
    locationName: row.location_name,
    orderCount: Number(row.order_count),
    netCents: Number(row.net_cents),
  }));
}

export interface ProductSales {
  readonly productId: string | null;
  readonly name: string;
  readonly quantity: number;
  readonly netCents: number;
  readonly orderCount: number;
}

export async function getTopProducts(
  tenantId: string,
  range: DateRange,
  locationId: string | null,
  limit: number,
): Promise<readonly ProductSales[]> {
  const client = await createSupabaseServerClient();
  const { data, error } = await client.rpc("report_top_products", {
    p_tenant_id: tenantId,
    p_from: range.from,
    p_to: range.to,
    p_location_id: locationId,
    p_limit: limit,
  });

  if (error) {
    logger.error("reports.top_products_failed", { tenantId, error });
    throw new DatabaseError("Product report failed.", { cause: error });
  }

  return (data ?? []).map((row) => ({
    productId: row.product_id,
    name: row.name,
    quantity: Number(row.quantity),
    netCents: Number(row.net_cents),
    orderCount: Number(row.order_count),
  }));
}

export interface CustomerSales {
  readonly customerId: string;
  readonly name: string;
  readonly orderCount: number;
  readonly netCents: number;
}

export async function getTopCustomers(
  tenantId: string,
  range: DateRange,
  limit: number,
): Promise<readonly CustomerSales[]> {
  const client = await createSupabaseServerClient();
  const { data, error } = await client.rpc("report_top_customers", {
    p_tenant_id: tenantId,
    p_from: range.from,
    p_to: range.to,
    p_limit: limit,
  });

  if (error) {
    logger.error("reports.top_customers_failed", { tenantId, error });
    throw new DatabaseError("Customer report failed.", { cause: error });
  }

  return (data ?? []).map((row) => ({
    customerId: row.customer_id,
    name: row.name,
    orderCount: Number(row.order_count),
    netCents: Number(row.net_cents),
  }));
}

export interface PaymentMethodSales {
  readonly paymentMethodId: string;
  readonly name: string;
  readonly type: PaymentMethodType;
  readonly paymentCount: number;
  readonly netCents: number;
}

export async function getSalesByPaymentMethod(
  tenantId: string,
  range: DateRange,
): Promise<readonly PaymentMethodSales[]> {
  const client = await createSupabaseServerClient();
  const { data, error } = await client.rpc("report_sales_by_payment_method", {
    p_tenant_id: tenantId,
    p_from: range.from,
    p_to: range.to,
  });

  if (error) {
    logger.error("reports.by_payment_method_failed", { tenantId, error });
    throw new DatabaseError("Payment method report failed.", { cause: error });
  }

  return (data ?? []).map((row) => ({
    paymentMethodId: row.payment_method_id,
    name: row.name,
    type: row.type,
    paymentCount: Number(row.payment_count),
    netCents: Number(row.net_cents),
  }));
}
