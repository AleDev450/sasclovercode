import { logger } from "@/lib/logger";
import { readIzipayIpn } from "@/modules/online-payments/providers/izipay";
import { loadGateway, recordPayment } from "@/modules/online-payments/server/gateway";

/**
 * Izipay IPN, server to server (Phase 31, ADR-034).
 *
 * Configure in the Izipay back office ("Reglas de notificacion -> URL de
 * notificacion al final del pago") as `https://{dominio}/api/pagos/izipay/{tenantId}`.
 *
 * The body is signed with the shop's PASSWORD; a body whose `kr-hash` does not
 * verify is refused before anything is read from it.
 */

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function field(form: FormData, key: string): string | null {
  const value = form.get(key);
  return typeof value === "string" ? value : null;
}

export async function POST(
  request: Request,
  context: { params: Promise<{ tenantId: string }> },
): Promise<Response> {
  const { tenantId } = await context.params;
  if (!UUID.test(tenantId)) return new Response(null, { status: 404 });

  const form = await request.formData().catch(() => null);
  if (form === null) return new Response(null, { status: 400 });

  const gateway = await loadGateway(tenantId);
  if (gateway === null || gateway.provider !== "izipay") {
    return new Response(null, { status: 404 });
  }

  const payment = readIzipayIpn(gateway.credentials, {
    answer: field(form, "kr-answer"),
    hash: field(form, "kr-hash"),
    hashKey: field(form, "kr-hash-key"),
  });

  if (payment === null) {
    logger.warn("online_payments.izipay_bad_ipn", { tenantId });
    return new Response(null, { status: 401 });
  }

  if (payment.outcome !== "pending") {
    const result = await recordPayment(tenantId, payment);
    if (result === "failed") return new Response(null, { status: 500 });
  }

  return new Response("OK", { status: 200 });
}
