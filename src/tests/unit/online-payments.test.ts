import { createHmac } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildContentSecurityPolicy, isPaymentPath } from "@/lib/security/csp";
import { CREDENTIAL_SCHEMAS, parseStoredCredentials } from "@/modules/online-payments/credentials";
import { createCulqiCharge } from "@/modules/online-payments/providers/culqi";
import { readIzipayIpn, verifyIzipayHash } from "@/modules/online-payments/providers/izipay";
import {
  createMercadoPagoCheckout,
  fetchMercadoPagoPayment,
  verifyMercadoPagoSignature,
} from "@/modules/online-payments/providers/mercadopago";
import { centsToDecimal, ProviderError } from "@/modules/online-payments/providers/types";

const ORDER = "11111111-1111-4111-8111-111111111111";
const REQUEST = {
  orderId: ORDER,
  orderNumber: 42,
  amountCents: 5750,
  currency: "PEN",
  businessName: "Sugu Rolls",
};

/** A fetch that records what it was asked and answers with `body`. */
function fakeFetch(status: number, body: unknown) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const impl = async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status });
  };
  return { impl, calls };
}

describe("money at the provider boundary", () => {
  it("turns cents into the decimal an API wants without float drift", () => {
    expect(centsToDecimal(5750)).toBe(57.5);
    expect(centsToDecimal(807)).toBe(8.07);
    expect(centsToDecimal(1)).toBe(0.01);
  });
});

describe("Mercado Pago", () => {
  const secret = "webhook-secret";

  function sign(manifest: string) {
    return createHmac("sha256", secret).update(manifest).digest("hex");
  }

  it("accepts a signature built from id, request-id and ts, with the id lowercased", () => {
    const v1 = sign("id:abc123;request-id:req-1;ts:1704908010;");
    expect(
      verifyMercadoPagoSignature({
        signatureHeader: `ts=1704908010,v1=${v1}`,
        requestId: "req-1",
        dataId: "ABC123",
        secret,
      }),
    ).toBe(true);
  });

  it("omits an absent request-id from the manifest", () => {
    const v1 = sign("id:99;ts:1;");
    expect(
      verifyMercadoPagoSignature({
        signatureHeader: `ts=1,v1=${v1}`,
        requestId: null,
        dataId: "99",
        secret,
      }),
    ).toBe(true);
  });

  it("refuses a wrong secret, a changed id, and a malformed header", () => {
    const v1 = sign("id:99;request-id:r;ts:1;");
    const base = { signatureHeader: `ts=1,v1=${v1}`, requestId: "r", dataId: "99" };
    expect(verifyMercadoPagoSignature({ ...base, secret: "other" })).toBe(false);
    expect(verifyMercadoPagoSignature({ ...base, dataId: "100", secret })).toBe(false);
    expect(verifyMercadoPagoSignature({ ...base, signatureHeader: "garbage", secret })).toBe(false);
    expect(verifyMercadoPagoSignature({ ...base, signatureHeader: null, secret })).toBe(false);
  });

  it("creates a preference for the order and returns where to send the customer", async () => {
    const { impl, calls } = fakeFetch(201, {
      init_point: "https://www.mercadopago.com.pe/checkout/v1/redirect?pref_id=1",
      sandbox_init_point: "https://sandbox.mercadopago.com.pe/checkout/v1/redirect?pref_id=1",
    });

    const url = await createMercadoPagoCheckout(
      { accessToken: "TEST-token-123" },
      REQUEST,
      {
        returnUrl: "https://sugu.pe/sitio/pedido/x",
        notificationUrl: "https://sugu.pe/api/pagos/mercadopago/t",
      },
      "live",
      impl,
    );

    expect(url).toBe("https://www.mercadopago.com.pe/checkout/v1/redirect?pref_id=1");
    const sent = JSON.parse(String(calls[0]!.init!.body)) as Record<string, unknown>;
    expect(sent.external_reference).toBe(ORDER);
    expect((sent.items as { unit_price: number }[])[0]!.unit_price).toBe(57.5);
    expect((calls[0]!.init!.headers as Record<string, string>).Authorization).toBe(
      "Bearer TEST-token-123",
    );
  });

  it("reads a payment from the API, which is the only thing recorded", async () => {
    const approved = fakeFetch(200, {
      id: 987,
      status: "approved",
      external_reference: ORDER,
      transaction_amount: 57.5,
      currency_id: "PEN",
    });
    expect(
      await fetchMercadoPagoPayment({ accessToken: "TEST-x-123456" }, "987", approved.impl),
    ).toEqual({
      orderId: ORDER,
      amountCents: 5750,
      currency: "PEN",
      reference: "mercadopago:987",
      outcome: "approved",
    });

    const rejected = fakeFetch(200, {
      id: 1,
      status: "rejected",
      external_reference: ORDER,
      transaction_amount: 57.5,
    });
    expect(
      (await fetchMercadoPagoPayment({ accessToken: "TEST-x-123456" }, "1", rejected.impl))
        ?.outcome,
    ).toBe("rejected");

    const missing = fakeFetch(404, {});
    expect(
      await fetchMercadoPagoPayment({ accessToken: "TEST-x-123456" }, "1", missing.impl),
    ).toBeNull();

    // An id that could escape the path is never sent.
    expect(
      await fetchMercadoPagoPayment({ accessToken: "TEST-x-123456" }, "../me", missing.impl),
    ).toBeNull();
  });
});

describe("Izipay", () => {
  const credentials = {
    username: "12345678",
    password: "testpassword_abc",
    hmacKey: "hmac-key-123",
  };

  function ipn(answer: object, key = credentials.password, hashKey = "password") {
    const raw = JSON.stringify(answer);
    return { answer: raw, hash: createHmac("sha256", key).update(raw).digest("hex"), hashKey };
  }

  const paid = {
    orderStatus: "PAID",
    orderDetails: { orderId: ORDER, orderTotalAmount: 5750, orderCurrency: "PEN" },
    transactions: [{ uuid: "tx-1" }],
  };

  it("verifies kr-hash with HMAC-SHA256", () => {
    const fields = ipn(paid);
    expect(verifyIzipayHash(fields.answer, fields.hash, credentials.password)).toBe(true);
    expect(verifyIzipayHash(fields.answer, fields.hash, credentials.hmacKey)).toBe(false);
  });

  it("reads a paid IPN signed with the password", () => {
    expect(readIzipayIpn(credentials, ipn(paid))).toEqual({
      orderId: ORDER,
      amountCents: 5750,
      currency: "PEN",
      reference: "izipay:tx-1",
      outcome: "approved",
    });
    expect(readIzipayIpn(credentials, ipn({ ...paid, orderStatus: "UNPAID" }))?.outcome).toBe(
      "rejected",
    );
  });

  it("refuses a browser-return signature, a tampered answer and a missing hash", () => {
    expect(readIzipayIpn(credentials, ipn(paid, credentials.hmacKey, "sha256_hmac"))).toBeNull();

    const fields = ipn(paid);
    expect(
      readIzipayIpn(credentials, { ...fields, answer: fields.answer.replace("5750", "1") }),
    ).toBeNull();
    expect(readIzipayIpn(credentials, { ...fields, hash: null })).toBeNull();
  });
});

describe("Culqi", () => {
  it("charges the token and reads a successful sale", async () => {
    const { impl, calls } = fakeFetch(201, {
      object: "charge",
      id: "chr_test_abc",
      amount: 5750,
      currency_code: "PEN",
      outcome: { type: "venta_exitosa" },
    });

    const payment = await createCulqiCharge(
      { secretKey: "sk_test_abcdef123" },
      REQUEST,
      { tokenId: "tkn_test_abcdef", email: "rosa@correo.pe" },
      impl,
    );

    expect(payment).toMatchObject({
      outcome: "approved",
      reference: "culqi:chr_test_abc",
      amountCents: 5750,
    });
    const sent = JSON.parse(String(calls[0]!.init!.body)) as Record<string, unknown>;
    expect(sent).toMatchObject({
      amount: 5750,
      currency_code: "PEN",
      source_id: "tkn_test_abcdef",
    });
  });

  it("turns a refusal into a message for the customer, and 3-D Secure into an honest one", async () => {
    const declined = fakeFetch(402, { object: "error", user_message: "Tu tarjeta fue rechazada." });
    await expect(
      createCulqiCharge(
        { secretKey: "sk_test_abcdef123" },
        REQUEST,
        { tokenId: "tkn_test_abcdef", email: "a@b.pe" },
        declined.impl,
      ),
    ).rejects.toMatchObject({ userMessage: "Tu tarjeta fue rechazada." });

    const review = fakeFetch(200, { object: "error", action_code: "REVIEW" });
    const error = await createCulqiCharge(
      { secretKey: "sk_test_abcdef123" },
      REQUEST,
      { tokenId: "tkn_test_abcdef", email: "a@b.pe" },
      review.impl,
    ).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ProviderError);
    expect((error as ProviderError).userMessage).toContain("verificación adicional");
  });
});

describe("credentials", () => {
  it("validates each provider's shape before it reaches Vault", () => {
    expect(CREDENTIAL_SCHEMAS.culqi.safeParse({ secretKey: "pk_test_123" }).success).toBe(false);
    expect(CREDENTIAL_SCHEMAS.culqi.safeParse({ secretKey: "sk_live_abc123" }).success).toBe(true);
    expect(CREDENTIAL_SCHEMAS.izipay.safeParse({ username: "1234", password: "x" }).success).toBe(
      false,
    );
  });

  it("reads back only a well-formed stored value", () => {
    expect(parseStoredCredentials("mercadopago", '{"accessToken":"APP_USR-1234"}')).toEqual({
      accessToken: "APP_USR-1234",
    });
    expect(parseStoredCredentials("mercadopago", "not json")).toBeNull();
    expect(parseStoredCredentials("culqi", '{"accessToken":"APP_USR-1234"}')).toBeNull();
    expect(parseStoredCredentials("culqi", null)).toBeNull();
  });
});

describe("the payment page CSP", () => {
  it("frames the providers on the tracking page, and nowhere else", () => {
    expect(isPaymentPath("/sitio/pedido/abc123")).toBe(true);
    expect(isPaymentPath("/vista/sugu/pedido/abc123")).toBe(true);
    expect(isPaymentPath("/sitio/carta")).toBe(false);
    expect(isPaymentPath("/dashboard/sugu/pedidos/abc")).toBe(false);

    const payment = buildContentSecurityPolicy("nonce", false, { paymentForms: true });
    expect(payment).toContain("frame-src https://checkout.culqi.com");
    expect(payment).not.toContain("frame-src 'none'");
    expect(payment).toContain("frame-ancestors 'none'");
    // The provider hosts are added to styles, never "unsafe-inline" to scripts.
    expect(payment).not.toMatch(/script-src[^;]*unsafe-inline/);

    expect(buildContentSecurityPolicy("nonce", false)).toContain("frame-src 'none'");
  });
});

describe("the service-role client (ADR-034)", () => {
  it("is imported only by the online payments server code", async () => {
    const root = join(process.cwd(), "src");
    const importers: string[] = [];

    async function walk(dir: string): Promise<void> {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(full);
        } else if (/\.(ts|tsx)$/.test(entry.name) && !full.includes(`${join("src", "tests")}`)) {
          const source = await readFile(full, "utf8");
          if (source.includes("@/lib/supabase/service")) {
            importers.push(full.replace(root, "").replace(/\\/g, "/"));
          }
        }
      }
    }
    await walk(root);

    expect(importers).toEqual(["/modules/online-payments/server/gateway.ts"]);
  });
});
