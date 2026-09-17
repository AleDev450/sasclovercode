import "server-only";

/**
 * Culqi: Checkout v4 in the browser, the charge from the server.
 *
 * Verified against Culqi's official documentation while planning Phase 31: the
 * page loads `https://checkout.culqi.com/js/v4`, configures it with the public
 * key and the amount, and receives a token in the `culqi()` callback. The
 * server then creates a charge with the SECRET key through the Charges API.
 *
 * The outcome arrives in the same response, so there is no webhook to verify:
 * what the charge endpoint answered, with our own secret key, over TLS, is the
 * provider's word.
 *
 * NOT HANDLED: 3-D Secure. A card whose bank demands authentication comes back
 * as a review, and the customer is told to use another card or method. See the
 * Phase 31 SPEC, known limitations.
 */

import type { GatewayCredentials } from "../credentials";
import { ProviderError, type ConfirmedPayment, type FetchLike, type PaymentRequest } from "./types";

export const CULQI_API = "https://api.culqi.com/v2";
export const CULQI_CHECKOUT_SCRIPT = "https://checkout.culqi.com/js/v4";

type Credentials = GatewayCredentials["culqi"];

export async function createCulqiCharge(
  credentials: Credentials,
  request: PaymentRequest,
  source: { readonly tokenId: string; readonly email: string },
  fetchImpl: FetchLike = fetch,
): Promise<ConfirmedPayment> {
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(source.tokenId)) {
    throw new ProviderError(
      "Invalid Culqi token.",
      "No pudimos leer los datos del pago. Inténtalo de nuevo.",
    );
  }

  const response = await fetchImpl(`${CULQI_API}/charges`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${credentials.secretKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      amount: Math.trunc(request.amountCents),
      currency_code: request.currency,
      email: source.email,
      source_id: source.tokenId,
      description: `Pedido #${request.orderNumber}`.slice(0, 80),
      metadata: { order_id: request.orderId },
    }),
  });

  const body = (await response.json().catch(() => ({}))) as {
    object?: unknown;
    id?: unknown;
    amount?: unknown;
    currency_code?: unknown;
    outcome?: { type?: unknown };
    action_code?: unknown;
    user_message?: unknown;
    merchant_message?: unknown;
  };

  if (!response.ok || body.object === "error") {
    const review = body.action_code === "REVIEW";
    throw new ProviderError(
      `Culqi charge refused: ${String(body.merchant_message ?? response.status)}.`,
      review
        ? "Tu banco pide una verificación adicional que aún no admitimos. Prueba con otra tarjeta o con Yape."
        : typeof body.user_message === "string"
          ? body.user_message
          : "El pago fue rechazado. Prueba con otra tarjeta.",
    );
  }

  if (typeof body.id !== "string") {
    throw new ProviderError("Culqi charge returned no id.");
  }

  return {
    orderId: request.orderId,
    amountCents: typeof body.amount === "number" ? body.amount : request.amountCents,
    currency: typeof body.currency_code === "string" ? body.currency_code : request.currency,
    reference: `culqi:${body.id}`,
    outcome: body.outcome?.type === "venta_exitosa" ? "approved" : "rejected",
  };
}
