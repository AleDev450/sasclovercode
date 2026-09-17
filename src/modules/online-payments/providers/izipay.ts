import "server-only";

/**
 * Izipay (micuentaweb.pe), embedded form, REST API V4.
 *
 * Verified against Izipay Peru's official integration repositories while
 * planning Phase 31: the server calls `Charge/CreatePayment` with Basic auth
 * (shop username : password) and the amount in cents, receives a `formToken`,
 * and the browser renders the form with the public key. At the end of the
 * payment Izipay POSTs an IPN with `kr-answer` (JSON) and `kr-hash`.
 *
 * TWO KEYS, AND WHICH ONE MATTERS. `kr-hash` is an HMAC-SHA256 of `kr-answer`.
 * For the server-to-server IPN the key is the PASSWORD; for the browser return
 * it is the HMAC-SHA-256 key. `kr-hash-key` says which was used, and anything
 * else is rejected. Only the IPN is recorded.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import type { GatewayCredentials } from "../credentials";
import { ProviderError, type ConfirmedPayment, type FetchLike, type PaymentRequest } from "./types";

export const IZIPAY_API = "https://api.micuentaweb.pe/api-payment/V4";
export const IZIPAY_SCRIPT =
  "https://static.micuentaweb.pe/static/js/krypton-client/V4.0/stable/kr-payment-form.min.js";
export const IZIPAY_THEME_CSS =
  "https://static.micuentaweb.pe/static/js/krypton-client/V4.0/ext/classic.css";
export const IZIPAY_THEME_JS =
  "https://static.micuentaweb.pe/static/js/krypton-client/V4.0/ext/classic.js";

type Credentials = GatewayCredentials["izipay"];

export async function createIzipayFormToken(
  credentials: Credentials,
  request: PaymentRequest,
  fetchImpl: FetchLike = fetch,
): Promise<string> {
  const auth = Buffer.from(`${credentials.username}:${credentials.password}`).toString("base64");

  const response = await fetchImpl(`${IZIPAY_API}/Charge/CreatePayment`, {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      amount: Math.trunc(request.amountCents),
      currency: request.currency,
      orderId: request.orderId,
    }),
  });

  if (!response.ok) {
    throw new ProviderError(`Izipay CreatePayment failed with HTTP ${response.status}.`);
  }

  const body = (await response.json()) as {
    status?: unknown;
    answer?: { formToken?: unknown; errorCode?: unknown };
  };

  if (body.status !== "SUCCESS" || typeof body.answer?.formToken !== "string") {
    throw new ProviderError(
      `Izipay CreatePayment refused: ${String(body.answer?.errorCode ?? body.status)}.`,
    );
  }
  return body.answer.formToken;
}

export function verifyIzipayHash(answer: string, hash: string, key: string): boolean {
  const expected = createHmac("sha256", key).update(answer).digest("hex");
  const given = hash.toLowerCase();
  return (
    expected.length === given.length &&
    timingSafeEqual(Buffer.from(expected, "utf8"), Buffer.from(given, "utf8"))
  );
}

/**
 * The IPN, verified and reduced to a confirmed payment. Null when the hash does
 * not verify with the PASSWORD or the answer is not a payment.
 */
export function readIzipayIpn(
  credentials: Credentials,
  fields: { answer: string | null; hash: string | null; hashKey: string | null },
): ConfirmedPayment | null {
  if (fields.answer === null || fields.hash === null) return null;
  // The IPN is signed with the password; a browser-return signature arriving at
  // the IPN endpoint is not accepted as one.
  if (fields.hashKey !== null && fields.hashKey !== "password") return null;
  if (!verifyIzipayHash(fields.answer, fields.hash, credentials.password)) return null;

  let parsed: {
    orderStatus?: unknown;
    orderDetails?: { orderId?: unknown; orderTotalAmount?: unknown; orderCurrency?: unknown };
    transactions?: { uuid?: unknown }[];
  };
  try {
    parsed = JSON.parse(fields.answer) as typeof parsed;
  } catch {
    return null;
  }

  const orderId = parsed.orderDetails?.orderId;
  const amount = parsed.orderDetails?.orderTotalAmount;
  if (typeof orderId !== "string" || typeof amount !== "number") return null;

  const uuid = parsed.transactions?.[0]?.uuid;

  return {
    orderId,
    amountCents: Math.trunc(amount),
    currency:
      typeof parsed.orderDetails?.orderCurrency === "string"
        ? parsed.orderDetails.orderCurrency
        : "PEN",
    reference: `izipay:${typeof uuid === "string" ? uuid : orderId}`,
    outcome:
      parsed.orderStatus === "PAID"
        ? "approved"
        : parsed.orderStatus === "UNPAID"
          ? "rejected"
          : "pending",
  };
}
