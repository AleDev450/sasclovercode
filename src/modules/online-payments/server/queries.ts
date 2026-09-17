import "server-only";

/**
 * Read side of online payments (Phase 31). Nothing here touches a secret: the
 * service-role reads live in `gateway.ts` and nowhere else.
 */

import { cache } from "react";
import { logger } from "@/lib/logger";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { PaymentGatewayMode, PaymentGatewayProvider } from "@/types/database";

export interface PublicPaymentGateway {
  readonly provider: PaymentGatewayProvider;
  readonly mode: PaymentGatewayMode;
}

/** The gateway a website may offer right now, or null. */
export const getPublicPaymentGateway = cache(
  async (tenantId: string): Promise<PublicPaymentGateway | null> => {
    const client = await createSupabaseServerClient();
    const { data, error } = await client.rpc("get_public_payment_gateway", {
      p_tenant_id: tenantId,
    });

    if (error) {
      logger.error("online_payments.public_gateway_failed", { tenantId, error });
      return null;
    }
    const row = data?.[0];
    return row === undefined ? null : { provider: row.provider, mode: row.mode };
  },
);

export interface GatewaySummary {
  readonly provider: PaymentGatewayProvider;
  readonly mode: PaymentGatewayMode;
  readonly publicKey: string | null;
  readonly isEnabled: boolean;
  readonly hasCredentials: boolean;
  readonly credentialsUpdatedAt: string | null;
}

/**
 * The configured gateway as a member or a platform admin sees it: which, in
 * what mode, whether it has a secret. Never the secret.
 */
export async function getGatewaySummary(tenantId: string): Promise<GatewaySummary | null> {
  const client = await createSupabaseServerClient();
  const { data, error } = await client
    .from("tenant_payment_gateways")
    .select("provider, mode, public_key, is_enabled, credentials_secret_id, credentials_updated_at")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (error) {
    logger.error("online_payments.summary_failed", { tenantId, error });
    return null;
  }
  if (data === null) return null;

  return {
    provider: data.provider,
    mode: data.mode,
    publicKey: data.public_key,
    isEnabled: data.is_enabled,
    hasCredentials: data.credentials_secret_id !== null,
    credentialsUpdatedAt: data.credentials_updated_at,
  };
}

/** Whether the tenant's plan (or an override) includes online payments. */
export async function hasOnlinePaymentsModule(tenantId: string): Promise<boolean> {
  const client = await createSupabaseServerClient();
  const { data, error } = await client.rpc("has_module", {
    p_tenant_id: tenantId,
    p_module: "online_payments",
  });
  if (error) {
    logger.error("online_payments.module_check_failed", { tenantId, error });
    return false;
  }
  return data === true;
}
