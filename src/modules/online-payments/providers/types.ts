/**
 * The shape every gateway adapter speaks (master section 44: "PaymentProvider").
 *
 * Three providers with three different integration models, which is why this
 * is a small set of types rather than one interface with three methods:
 *
 *   Mercado Pago  redirect to a hosted Checkout Pro; confirmation by webhook.
 *   Izipay        embedded form from a server-issued formToken; IPN.
 *   Culqi         Checkout v4 in the browser returns a token; the server
 *                 charges it and learns the outcome in the same request.
 *
 * What they share is the end: a payment the PROVIDER vouches for, reduced to an
 * order id, an amount in cents, a reference, and an outcome. That is all
 * `record_online_payment` accepts.
 */

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface PaymentRequest {
  /** Our order id. Carried by the provider and handed back on confirmation. */
  readonly orderId: string;
  readonly orderNumber: number;
  readonly amountCents: number;
  /** ISO 4217. Every provider here takes PEN. */
  readonly currency: string;
  readonly businessName: string;
}

export type PaymentOutcome = "approved" | "rejected" | "pending";

export interface ConfirmedPayment {
  readonly orderId: string;
  readonly amountCents: number;
  readonly currency: string;
  /** The provider's own id, prefixed with the provider: `mercadopago:123`. */
  readonly reference: string;
  readonly outcome: PaymentOutcome;
}

/** What the tracking page does next, per provider. */
export type CheckoutStart =
  | { readonly kind: "redirect"; readonly url: string }
  | { readonly kind: "izipay"; readonly formToken: string; readonly publicKey: string }
  | {
      readonly kind: "culqi";
      readonly publicKey: string;
      readonly amountCents: number;
      readonly currency: string;
      readonly title: string;
    };

export class ProviderError extends Error {
  constructor(
    message: string,
    /** Safe to show a customer. The `message` is for the log. */
    readonly userMessage: string = "No pudimos conectar con la pasarela de pago. Inténtalo en unos minutos.",
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

/** Cents to the decimal amount an API wants, without float drift: 2550 -> 25.5. */
export function centsToDecimal(cents: number): number {
  return Number((Math.trunc(cents) / 100).toFixed(2));
}

/** A decimal amount from an API to cents, rounding the float it arrived as. */
export function decimalToCents(amount: number): number {
  return Math.round(amount * 100);
}
