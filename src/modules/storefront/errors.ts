/**
 * What `place_web_order` can refuse, in the words of the person refused.
 *
 * The function raises a stable code as its message (see the header of
 * `20260916120300_create_web_orders.sql`). Anything else - a constraint name, a
 * Postgres sentence - is never shown: it means something the application did
 * not anticipate, and the visitor gets the generic line while the log gets the
 * detail.
 *
 * Written with accents, unlike the dashboard: this is read by a restaurant's
 * customers, on the restaurant's own website, and "Estamos cerrados en este
 * momento" without its tildes reads as a site nobody finished.
 */

export const WEB_ORDER_ERRORS = {
  STORE_UNAVAILABLE: "Este negocio no está recibiendo pedidos por la web en este momento.",
  ORDERING_DISABLED: "Los pedidos por la web están desactivados. Escríbenos por WhatsApp.",
  STORE_CLOSED: "Estamos cerrados en este momento. Vuelve en nuestro horario de atención.",
  INVALID_ORDER: "Algo en tu pedido no es válido. Revisa el carrito e inténtalo de nuevo.",
  INVALID_CONTACT: "Revisa tu nombre y tu número de teléfono.",
  FULFILLMENT_UNAVAILABLE: "Esa forma de entrega no está disponible. Elige otra.",
  INVALID_PAYMENT_METHOD: "Elige un método de pago de la lista.",
  EMPTY_CART: "Tu carrito está vacío.",
  PRODUCT_UNAVAILABLE:
    "Uno de los productos ya no está disponible hoy. Quítalo del carrito y vuelve a intentarlo.",
  VARIANT_REQUIRED: "Elige la presentación de cada producto antes de pedir.",
  BELOW_MINIMUM: "Tu pedido no alcanza el monto mínimo.",
  INVALID_ZONE: "Elige una zona de delivery de la lista.",
  INVALID_ADDRESS: "Escribe la dirección de entrega.",
  ONLINE_PAYMENT_UNAVAILABLE: "El pago online no está disponible ahora. Elige otro método de pago.",
} as const;

export type WebOrderErrorCode = keyof typeof WEB_ORDER_ERRORS;

export const GENERIC_WEB_ORDER_ERROR =
  "No pudimos registrar tu pedido. Revisa tu conexión e inténtalo de nuevo.";

/** The Spanish message for a database error message, or the generic one. */
export function webOrderErrorMessage(databaseMessage: string | null | undefined): string {
  if (databaseMessage === null || databaseMessage === undefined) return GENERIC_WEB_ORDER_ERROR;
  const code = databaseMessage.trim();
  return Object.hasOwn(WEB_ORDER_ERRORS, code)
    ? WEB_ORDER_ERRORS[code as WebOrderErrorCode]
    : GENERIC_WEB_ORDER_ERROR;
}

/** True when the message is one of the codes above, i.e. an expected refusal. */
export function isKnownWebOrderError(databaseMessage: string | null | undefined): boolean {
  return (
    databaseMessage !== null &&
    databaseMessage !== undefined &&
    Object.hasOwn(WEB_ORDER_ERRORS, databaseMessage.trim())
  );
}
