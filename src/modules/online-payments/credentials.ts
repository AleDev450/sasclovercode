/**
 * What each gateway needs, validated before it reaches Vault.
 *
 * The secret half of each is stored as one JSON string in Vault; the public key
 * travels in its own column because the browser needs it. A shape checked here
 * is a shape the provider adapters can rely on without re-validating on every
 * payment.
 *
 * Field names follow what each provider calls them in its own dashboard, so the
 * operator copying them across does not have to translate.
 */

import { z } from "zod";
import type { PaymentGatewayProvider } from "@/types/database";

const secret = (label: string) => z.string().trim().min(8, `${label}: demasiado corto.`).max(500);

export const CREDENTIAL_SCHEMAS = {
  /** Mercado Pago: Checkout Pro by redirection. */
  mercadopago: z.object({
    accessToken: secret("Access token"),
    /** "Tus integraciones -> Webhooks": validates `x-signature`. Optional but recommended. */
    webhookSecret: z.string().trim().max(200).optional(),
  }),
  /** Izipay (micuentaweb): embedded form, REST V4. */
  izipay: z.object({
    username: z.string().trim().min(4).max(60),
    password: secret("Contrasena"),
    hmacKey: secret("Clave HMAC-SHA-256"),
  }),
  /** Culqi: Checkout v4 in the browser, charge from the server. */
  culqi: z.object({
    secretKey: z
      .string()
      .trim()
      .regex(
        /^sk_(test|live)_[A-Za-z0-9]+$/,
        "La llave secreta de Culqi empieza con sk_test_ o sk_live_.",
      ),
  }),
} as const satisfies Record<PaymentGatewayProvider, z.ZodType>;

export type GatewayCredentials = {
  [K in PaymentGatewayProvider]: z.output<(typeof CREDENTIAL_SCHEMAS)[K]>;
};

/** Whether this provider needs a public key for the browser. */
export const NEEDS_PUBLIC_KEY: Record<PaymentGatewayProvider, boolean> = {
  mercadopago: false,
  izipay: true,
  culqi: true,
};

export const PROVIDER_LABELS: Record<PaymentGatewayProvider, string> = {
  culqi: "Culqi",
  izipay: "Izipay",
  mercadopago: "Mercado Pago",
};

/** Parses what Vault returned. Null when it is not this provider's shape. */
export function parseStoredCredentials<P extends PaymentGatewayProvider>(
  provider: P,
  raw: string | null,
): GatewayCredentials[P] | null {
  if (raw === null) return null;
  try {
    const parsed = CREDENTIAL_SCHEMAS[provider].safeParse(JSON.parse(raw));
    return parsed.success ? (parsed.data as GatewayCredentials[P]) : null;
  } catch {
    return null;
  }
}
