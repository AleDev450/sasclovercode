import { logger } from "@/lib/logger";
import {
  verifyMercadoPagoSignature,
  fetchMercadoPagoPayment,
} from "@/modules/online-payments/providers/mercadopago";
import { loadGateway, recordPayment } from "@/modules/online-payments/server/gateway";

/**
 * Mercado Pago payment notifications (Phase 31, ADR-034).
 *
 * The tenant is in the URL because each business has its own Mercado Pago
 * account: the notification has to be checked against THAT account's token.
 * Knowing the URL grants nothing - the payment is fetched from Mercado Pago with
 * the tenant's credentials, and an id that does not exist there is ignored.
 *
 * Always answers 200 once the notification is understood, including for
 * payments it chose not to record: a non-2xx makes Mercado Pago retry for days,
 * and retrying a notification we deliberately ignored helps nobody.
 */

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(
  request: Request,
  context: { params: Promise<{ tenantId: string }> },
): Promise<Response> {
  const { tenantId } = await context.params;
  if (!UUID.test(tenantId)) return new Response(null, { status: 404 });

  const url = new URL(request.url);
  const body = (await request.json().catch(() => ({}))) as {
    type?: unknown;
    topic?: unknown;
    data?: { id?: unknown };
  };

  const type =
    url.searchParams.get("type") ?? url.searchParams.get("topic") ?? body.type ?? body.topic;
  const dataId =
    url.searchParams.get("data.id") ??
    url.searchParams.get("id") ??
    (typeof body.data?.id === "string" || typeof body.data?.id === "number"
      ? String(body.data.id)
      : null);

  // Merchant orders, plans, chargebacks: not what this endpoint records.
  if (type !== "payment" || dataId === null) return new Response(null, { status: 200 });

  const gateway = await loadGateway(tenantId);
  if (gateway === null || gateway.provider !== "mercadopago") {
    return new Response(null, { status: 404 });
  }

  if (
    gateway.credentials.webhookSecret !== undefined &&
    gateway.credentials.webhookSecret.length > 0
  ) {
    const valid = verifyMercadoPagoSignature({
      signatureHeader: request.headers.get("x-signature"),
      requestId: request.headers.get("x-request-id"),
      dataId,
      secret: gateway.credentials.webhookSecret,
    });
    if (!valid) {
      logger.warn("online_payments.mercadopago_bad_signature", { tenantId });
      return new Response(null, { status: 401 });
    }
  }

  try {
    const payment = await fetchMercadoPagoPayment(gateway.credentials, dataId);
    if (payment !== null && payment.outcome !== "pending") {
      await recordPayment(tenantId, payment);
    }
    return new Response(null, { status: 200 });
  } catch (error) {
    // The provider was unreachable: a 500 asks Mercado Pago to try again later,
    // which is exactly right.
    logger.error("online_payments.mercadopago_webhook_failed", { tenantId, error });
    return new Response(null, { status: 500 });
  }
}
