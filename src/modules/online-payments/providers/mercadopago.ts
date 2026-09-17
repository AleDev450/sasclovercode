import "server-only";

/**
 * Mercado Pago, Checkout Pro by redirection.
 *
 * Verified against the official documentation while planning Phase 31 (not
 * from memory): a preference is created with the access token, the customer is
 * redirected to its `init_point`, and Mercado Pago POSTs a notification to
 * `notification_url` with `type: "payment"` and `data.id`.
 *
 * THE NOTIFICATION IS A HINT, NEVER THE TRUTH. Whatever it says, the payment is
 * fetched from `GET /v1/payments/{id}` with the tenant's own access token, and
 * only that response is recorded. A forged notification can at most make us ask
 * Mercado Pago about a payment that does not exist in that account.
 *
 * The `x-signature` check is the belt on top: HMAC-SHA256 over
 * `id:{data.id lowercased};request-id:{x-request-id};ts:{ts};`, each pair omitted
 * when absent, compared in constant time.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import type { GatewayCredentials } from "../credentials";
import {
  centsToDecimal,
  decimalToCents,
  ProviderError,
  type ConfirmedPayment,
  type FetchLike,
  type PaymentRequest,
} from "./types";

export const MERCADOPAGO_API = "https://api.mercadopago.com";

type Credentials = GatewayCredentials["mercadopago"];

export async function createMercadoPagoCheckout(
  credentials: Credentials,
  request: PaymentRequest,
  urls: { readonly returnUrl: string; readonly notificationUrl: string },
  mode: "test" | "live",
  fetchImpl: FetchLike = fetch,
): Promise<string> {
  const response = await fetchImpl(`${MERCADOPAGO_API}/checkout/preferences`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${credentials.accessToken}`,
      "Content-Type": "application/json",
      // The same order and amount is the same preference: a double click on
      // "Pagar" must not open two.
      "X-Idempotency-Key": `pref-${request.orderId}-${request.amountCents}`,
    },
    body: JSON.stringify({
      items: [
        {
          id: request.orderId,
          title: `Pedido #${request.orderNumber} - ${request.businessName}`.slice(0, 250),
          quantity: 1,
          unit_price: centsToDecimal(request.amountCents),
          currency_id: request.currency,
        },
      ],
      external_reference: request.orderId,
      notification_url: urls.notificationUrl,
      back_urls: { success: urls.returnUrl, pending: urls.returnUrl, failure: urls.returnUrl },
      auto_return: "approved",
      statement_descriptor: request.businessName.replace(/[^A-Za-z0-9 ]/g, "").slice(0, 22),
    }),
  });

  if (!response.ok) {
    throw new ProviderError(`Mercado Pago preference failed with HTTP ${response.status}.`);
  }

  const body = (await response.json()) as { init_point?: unknown; sandbox_init_point?: unknown };
  const url =
    mode === "test" && typeof body.sandbox_init_point === "string"
      ? body.sandbox_init_point
      : body.init_point;

  if (typeof url !== "string" || !url.startsWith("https://")) {
    throw new ProviderError("Mercado Pago preference returned no checkout URL.");
  }
  return url;
}

/** Parses `ts=...,v1=...`. */
function parseSignatureHeader(header: string): { ts: string; v1: string } | null {
  const parts = new Map(
    header.split(",").map((part) => {
      const [key, ...rest] = part.trim().split("=");
      return [key ?? "", rest.join("=")] as const;
    }),
  );
  const ts = parts.get("ts");
  const v1 = parts.get("v1");
  return ts && v1 ? { ts, v1 } : null;
}

export function verifyMercadoPagoSignature(input: {
  readonly signatureHeader: string | null;
  readonly requestId: string | null;
  readonly dataId: string | null;
  readonly secret: string;
}): boolean {
  if (input.signatureHeader === null) return false;
  const parsed = parseSignatureHeader(input.signatureHeader);
  if (parsed === null) return false;

  const manifest = [
    input.dataId ? `id:${input.dataId.toLowerCase()};` : "",
    input.requestId ? `request-id:${input.requestId};` : "",
    `ts:${parsed.ts};`,
  ].join("");

  const expected = createHmac("sha256", input.secret).update(manifest).digest("hex");
  const given = parsed.v1.toLowerCase();

  return (
    expected.length === given.length &&
    timingSafeEqual(Buffer.from(expected, "utf8"), Buffer.from(given, "utf8"))
  );
}

const REJECTED = new Set(["rejected", "cancelled", "refunded", "charged_back"]);

/** The payment as Mercado Pago's API reports it, or null when it does not exist. */
export async function fetchMercadoPagoPayment(
  credentials: Credentials,
  paymentId: string,
  fetchImpl: FetchLike = fetch,
): Promise<ConfirmedPayment | null> {
  if (!/^[A-Za-z0-9-]{1,64}$/.test(paymentId)) return null;

  const response = await fetchImpl(`${MERCADOPAGO_API}/v1/payments/${paymentId}`, {
    headers: { Authorization: `Bearer ${credentials.accessToken}` },
  });

  if (response.status === 404) return null;
  if (!response.ok) {
    throw new ProviderError(`Mercado Pago payment lookup failed with HTTP ${response.status}.`);
  }

  const body = (await response.json()) as {
    id?: unknown;
    status?: unknown;
    external_reference?: unknown;
    transaction_amount?: unknown;
    currency_id?: unknown;
  };

  if (
    typeof body.external_reference !== "string" ||
    typeof body.transaction_amount !== "number" ||
    typeof body.status !== "string"
  ) {
    return null;
  }

  return {
    orderId: body.external_reference,
    amountCents: decimalToCents(body.transaction_amount),
    currency: typeof body.currency_id === "string" ? body.currency_id : "PEN",
    reference: `mercadopago:${String(body.id ?? paymentId)}`,
    outcome:
      body.status === "approved" ? "approved" : REJECTED.has(body.status) ? "rejected" : "pending",
  };
}
