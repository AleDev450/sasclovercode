import "server-only";

/**
 * The two service-role operations of Phase 31, and nothing else (ADR-034).
 *
 * `loadGateway` reads a tenant's gateway WITH its secret; `recordPayment` writes
 * a provider-confirmed payment. Both go through the service-role client because
 * both functions are executable by `service_role` alone. Every caller verifies
 * the payment with the provider before calling `recordPayment`.
 */

import { logger } from "@/lib/logger";
import { createServiceRoleClient, isServiceRoleConfigured } from "@/lib/supabase/service";
import type { PaymentGatewayMode, PaymentGatewayProvider } from "@/types/database";
import { parseStoredCredentials, type GatewayCredentials } from "../credentials";
import type { ConfirmedPayment } from "../providers/types";

export type LoadedGateway = {
  [P in PaymentGatewayProvider]: {
    readonly provider: P;
    readonly mode: PaymentGatewayMode;
    readonly publicKey: string | null;
    readonly credentials: GatewayCredentials[P];
  };
}[PaymentGatewayProvider];

/** The tenant's enabled gateway with parsed credentials, or null. */
export async function loadGateway(tenantId: string): Promise<LoadedGateway | null> {
  if (!isServiceRoleConfigured()) {
    logger.error("online_payments.secret_key_missing", { tenantId });
    return null;
  }

  const client = createServiceRoleClient();
  const { data, error } = await client.rpc("get_payment_gateway_credentials", {
    p_tenant_id: tenantId,
  });

  if (error) {
    logger.error("online_payments.gateway_load_failed", { tenantId, error });
    return null;
  }

  const row = data?.[0];
  if (row === undefined || !row.is_enabled) return null;

  const credentials = parseStoredCredentials(row.provider, row.credentials);
  if (credentials === null) {
    // Never log the value: only that it did not parse.
    logger.error("online_payments.credentials_unreadable", { tenantId, provider: row.provider });
    return null;
  }

  return {
    provider: row.provider,
    mode: row.mode,
    publicKey: row.public_key,
    credentials,
  } as LoadedGateway;
}

export type RecordResult =
  "recorded" | "already_recorded" | "rejected" | "needs_attention" | "unknown_order" | "failed";

/** Writes what the provider confirmed. A pending outcome is not written at all. */
export async function recordPayment(
  tenantId: string,
  payment: ConfirmedPayment,
): Promise<RecordResult> {
  if (payment.outcome === "pending") return "failed";

  const client = createServiceRoleClient();
  const { data, error } = await client.rpc("record_online_payment", {
    p_tenant_id: tenantId,
    p_order_id: payment.orderId,
    p_provider_reference: payment.reference,
    p_amount_cents: payment.amountCents,
    p_approved: payment.outcome === "approved",
  });

  if (error) {
    logger.error("online_payments.record_failed", {
      tenantId,
      reference: payment.reference,
      error,
    });
    return "failed";
  }

  const result = data as RecordResult;
  const level = result === "needs_attention" || result === "unknown_order" ? "warn" : "info";
  logger[level]("online_payments.recorded", {
    tenantId,
    orderId: payment.orderId,
    reference: payment.reference,
    outcome: payment.outcome,
    result,
  });
  return result;
}
