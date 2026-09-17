"use server";

/**
 * Online payment Server Actions (Phase 31, ADR-034).
 *
 * Two audiences:
 *
 *   The PLATFORM configures a tenant's gateway. `requirePlatformAdmin()` here,
 *   and `is_platform_admin()` again inside `set_payment_gateway`.
 *
 *   A CUSTOMER with a tracking token starts a payment, or completes a Culqi
 *   charge. No session: the tenant comes from the hostname and the order from a
 *   244-bit token, and nothing the browser sends can mark an order paid - only
 *   the provider's own answer, fetched or received by the server, is recorded.
 */

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { FormState } from "@/lib/forms/state";
import { logger } from "@/lib/logger";
import { requirePlatformAdmin } from "@/lib/platform/access";
import {
  consumeRateLimitForCaller,
  RATE_LIMITED_MESSAGE,
  RATE_LIMITS,
} from "@/lib/security/rate-limit";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { toFieldErrors } from "@/lib/validation";
import { getSiteContext } from "@/modules/cms/server/site-context";
import { getPrimaryDomain, getPublicIdentity } from "@/modules/seo/server/queries";
import { CREDENTIAL_SCHEMAS, NEEDS_PUBLIC_KEY } from "../credentials";
import { createCulqiCharge } from "../providers/culqi";
import { createIzipayFormToken } from "../providers/izipay";
import { createMercadoPagoCheckout } from "../providers/mercadopago";
import { ProviderError, type CheckoutStart, type PaymentRequest } from "../providers/types";
import { loadGateway, recordPayment } from "./gateway";

function readText(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

/* -------------------------------------------------------------------------- */
/*  Platform: configuring a tenant's gateway                                   */
/* -------------------------------------------------------------------------- */

const gatewayFormSchema = z.object({
  tenantId: z.uuid(),
  provider: z.enum(["culqi", "izipay", "mercadopago"]),
  mode: z.enum(["test", "live"]),
  enabled: z.boolean(),
  publicKey: z.string().max(300),
});

export async function setPaymentGatewayAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  await requirePlatformAdmin();

  const base = gatewayFormSchema.safeParse({
    tenantId: readText(formData, "tenantId"),
    provider: readText(formData, "provider"),
    mode: readText(formData, "mode"),
    enabled: formData.get("enabled") === "on",
    publicKey: readText(formData, "publicKey"),
  });
  if (!base.success) {
    return { status: "error", fieldErrors: toFieldErrors(base.error) };
  }

  const { tenantId, provider, mode, enabled, publicKey } = base.data;

  if (NEEDS_PUBLIC_KEY[provider] && publicKey.length === 0) {
    return {
      status: "error",
      fieldErrors: { publicKey: ["Este proveedor necesita la llave publica."] },
    };
  }

  // The secret fields of THIS provider. All blank means "keep what is stored";
  // anything typed has to be a complete, valid set.
  const secretFields: Record<string, string> =
    provider === "mercadopago"
      ? {
          accessToken: readText(formData, "accessToken"),
          webhookSecret: readText(formData, "webhookSecret"),
        }
      : provider === "izipay"
        ? {
            username: readText(formData, "username"),
            password: readText(formData, "password"),
            hmacKey: readText(formData, "hmacKey"),
          }
        : { secretKey: readText(formData, "secretKey") };

  let credentials: string | null = null;
  if (Object.values(secretFields).some((value) => value.length > 0)) {
    const cleaned = Object.fromEntries(
      Object.entries(secretFields).filter(([, value]) => value.length > 0),
    );
    const parsed = CREDENTIAL_SCHEMAS[provider].safeParse(cleaned);
    if (!parsed.success) {
      return { status: "error", fieldErrors: toFieldErrors(parsed.error) };
    }
    credentials = JSON.stringify(parsed.data);
  }

  const client = await createSupabaseServerClient();
  const { error } = await client.rpc("set_payment_gateway", {
    p_tenant_id: tenantId,
    p_provider: provider,
    p_mode: mode,
    p_public_key: publicKey.length > 0 ? publicKey : null,
    p_credentials: credentials,
    p_enabled: enabled,
  });

  if (error) {
    if (error.code === "23514") {
      return {
        status: "error",
        message: error.message.includes("Switching provider")
          ? "Para cambiar de proveedor escribe las credenciales del nuevo."
          : "No se puede activar sin credenciales guardadas.",
      };
    }
    logger.error("online_payments.gateway_save_failed", { tenantId, provider, error });
    return { status: "error", message: "No se pudo guardar la pasarela." };
  }

  // Provider and mode only - never a key, not even its length.
  logger.info("online_payments.gateway_saved", {
    tenantId,
    provider,
    mode,
    enabled,
    credentialsChanged: credentials !== null,
  });
  revalidatePath(`/super-admin/tenants/${tenantId}`);
  revalidatePath("/sitio", "layout");
  return { status: "success", message: "Pasarela guardada." };
}

export async function clearPaymentGatewayAction(formData: FormData): Promise<void> {
  await requirePlatformAdmin();

  const tenantId = z.uuid().safeParse(readText(formData, "tenantId"));
  if (!tenantId.success) return;

  const client = await createSupabaseServerClient();
  const { error } = await client.rpc("clear_payment_gateway", { p_tenant_id: tenantId.data });
  if (error) {
    logger.error("online_payments.gateway_clear_failed", { tenantId: tenantId.data, error });
    return;
  }

  logger.info("online_payments.gateway_cleared", { tenantId: tenantId.data });
  revalidatePath(`/super-admin/tenants/${tenantId.data}`);
  revalidatePath("/sitio", "layout");
}

/* -------------------------------------------------------------------------- */
/*  Public: paying an order                                                    */
/* -------------------------------------------------------------------------- */

export type StartPaymentResult =
  | { readonly ok: true; readonly start: CheckoutStart }
  | { readonly ok: false; readonly message: string };

interface PayableOrder {
  readonly tenantId: string;
  readonly request: PaymentRequest;
  readonly domain: string;
}

const UNAVAILABLE = "El pago online no está disponible para este pedido.";

/** Resolves the order behind a tracking token, if it can still be paid online. */
async function payableOrder(token: string): Promise<PayableOrder | { error: string }> {
  const site = await getSiteContext();
  if (site === null || !site.isServing) return { error: UNAVAILABLE };

  const client = await createSupabaseServerClient();
  const { data, error } = await client.rpc("get_web_order_for_payment", {
    p_tenant_id: site.tenant.id,
    p_token: token,
  });

  const row = data?.[0];
  if (error || row === undefined) return { error: UNAVAILABLE };
  if (row.online_payment_status === "approved") return { error: "Este pedido ya está pagado." };
  if (row.status === "cancelled") return { error: "Este pedido fue cancelado." };
  if (Number(row.balance_cents) <= 0) return { error: "Este pedido no tiene saldo pendiente." };

  const [identity, domain] = await Promise.all([
    getPublicIdentity(site.tenant.id, site.tenant.name),
    getPrimaryDomain(site.tenant.id),
  ]);

  return {
    tenantId: site.tenant.id,
    domain: domain ?? site.tenant.domain,
    request: {
      orderId: row.order_id,
      orderNumber: row.order_number,
      amountCents: Number(row.balance_cents),
      currency: identity.currency,
      businessName: identity.name,
    },
  };
}

/**
 * Where the customer comes back to: the host they are on, so a preview or a
 * local subdomain returns to itself rather than to the canonical domain.
 */
async function requestOrigin(fallbackDomain: string): Promise<string> {
  const list = await headers();
  const host = list.get("x-forwarded-host") ?? list.get("host");
  const proto = list.get("x-forwarded-proto") ?? "https";
  return host === null ? `https://${fallbackDomain}` : `${proto}://${host}`;
}

export async function startOnlinePaymentAction(token: string): Promise<StartPaymentResult> {
  if (!(await consumeRateLimitForCaller(RATE_LIMITS.STOREFRONT_PAYMENT))) {
    return { ok: false, message: RATE_LIMITED_MESSAGE };
  }
  if (typeof token !== "string" || !/^[0-9a-f]{64}$/.test(token)) {
    return { ok: false, message: UNAVAILABLE };
  }

  const order = await payableOrder(token);
  if ("error" in order) return { ok: false, message: order.error };

  const gateway = await loadGateway(order.tenantId);
  if (gateway === null) return { ok: false, message: UNAVAILABLE };

  try {
    switch (gateway.provider) {
      case "mercadopago": {
        const origin = await requestOrigin(order.domain);
        const url = await createMercadoPagoCheckout(
          gateway.credentials,
          order.request,
          {
            returnUrl: `${origin}/sitio/pedido/${token}`,
            // Always the canonical domain: Mercado Pago has to reach it from the
            // internet, which a local or preview host cannot promise.
            notificationUrl: `https://${order.domain}/api/pagos/mercadopago/${order.tenantId}`,
          },
          gateway.mode,
        );
        return { ok: true, start: { kind: "redirect", url } };
      }
      case "izipay": {
        if (gateway.publicKey === null) return { ok: false, message: UNAVAILABLE };
        const formToken = await createIzipayFormToken(gateway.credentials, order.request);
        return { ok: true, start: { kind: "izipay", formToken, publicKey: gateway.publicKey } };
      }
      case "culqi": {
        if (gateway.publicKey === null) return { ok: false, message: UNAVAILABLE };
        return {
          ok: true,
          start: {
            kind: "culqi",
            publicKey: gateway.publicKey,
            amountCents: order.request.amountCents,
            currency: order.request.currency,
            title: order.request.businessName,
          },
        };
      }
    }
  } catch (error) {
    logger.error("online_payments.start_failed", {
      tenantId: order.tenantId,
      provider: gateway.provider,
      error,
    });
    return {
      ok: false,
      message: error instanceof ProviderError ? error.userMessage : UNAVAILABLE,
    };
  }
}

export type CulqiChargeResult =
  { readonly ok: true } | { readonly ok: false; readonly message: string };

const culqiChargeSchema = z.object({
  token: z.string().regex(/^[0-9a-f]{64}$/),
  culqiTokenId: z.string().min(8).max(100),
  email: z.email().max(200),
});

export async function chargeCulqiAction(input: unknown): Promise<CulqiChargeResult> {
  if (!(await consumeRateLimitForCaller(RATE_LIMITS.STOREFRONT_PAYMENT))) {
    return { ok: false, message: RATE_LIMITED_MESSAGE };
  }

  const parsed = culqiChargeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: UNAVAILABLE };

  const order = await payableOrder(parsed.data.token);
  if ("error" in order) return { ok: false, message: order.error };

  const gateway = await loadGateway(order.tenantId);
  if (gateway === null || gateway.provider !== "culqi") return { ok: false, message: UNAVAILABLE };

  try {
    const payment = await createCulqiCharge(gateway.credentials, order.request, {
      tokenId: parsed.data.culqiTokenId,
      email: parsed.data.email,
    });
    const result = await recordPayment(order.tenantId, payment);

    if (payment.outcome !== "approved") {
      return { ok: false, message: "El pago fue rechazado. Prueba con otra tarjeta." };
    }
    if (result === "failed") {
      // The charge went through and the record did not: never tell the customer
      // to pay again. The reference is in the log for a person to reconcile.
      return {
        ok: false,
        message:
          "Recibimos tu pago, pero no pudimos marcarlo en tu pedido. Escríbenos por WhatsApp.",
      };
    }
    return { ok: true };
  } catch (error) {
    logger.error("online_payments.culqi_charge_failed", { tenantId: order.tenantId, error });
    return {
      ok: false,
      message: error instanceof ProviderError ? error.userMessage : UNAVAILABLE,
    };
  }
}
