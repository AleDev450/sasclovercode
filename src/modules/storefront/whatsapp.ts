/**
 * WhatsApp links, built without trusting what was typed into the settings.
 *
 * `tenant_settings.whatsapp` is free text up to 30 characters (Phase 06):
 * "+51 997 516 391", "997516391", "(01) 555-1234". `wa.me` wants digits only,
 * with the country code, and silently opens a chat with the WRONG person when
 * the country code is missing - a nine-digit Peruvian mobile is read as some
 * other country's number. That failure is invisible to the owner, who never
 * clicks their own button, so it is handled here rather than documented.
 */

/** Country code prepended to a bare Peruvian mobile. */
const PERU = "51";

/**
 * Digits `wa.me` accepts, or null when the value cannot be a WhatsApp number.
 *
 * A nine-digit number starting with 9 is a Peruvian mobile without its country
 * code, which is how almost everybody in Peru writes their own number.
 */
export function whatsappDigits(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;

  const digits = value.replace(/\D/g, "");
  if (digits.length === 9 && digits.startsWith("9")) return `${PERU}${digits}`;
  if (digits.length < 8 || digits.length > 15) return null;
  return digits;
}

/** `https://wa.me/51...?text=...`, or null when there is no usable number. */
export function whatsappUrl(number: string | null | undefined, message: string): string | null {
  const digits = whatsappDigits(number);
  if (digits === null) return null;

  const text = message.trim();
  return text.length === 0
    ? `https://wa.me/${digits}`
    : `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

export interface OrderMessageInput {
  readonly businessName: string;
  readonly orderNumber: number;
  readonly contactName: string;
  readonly items: readonly { name: string; detail: string; quantity: number; total: string }[];
  readonly total: string;
  readonly fulfillment: "delivery" | "pickup";
  readonly zoneName: string | null;
  readonly paymentMethod: string | null;
  readonly trackingUrl: string;
}

/**
 * The message a customer sends after ordering.
 *
 * WhatsApp renders `*bold*`, and that is the only formatting used: it is what a
 * restaurant owner reading forty of these at lunchtime needs to find the order
 * number and the total at a glance.
 */
export function orderWhatsappMessage(input: OrderMessageInput): string {
  const lines = input.items.map((item) => {
    const detail = item.detail.length > 0 ? `\n   ${item.detail}` : "";
    return `• ${item.quantity} x ${item.name}${detail} — ${item.total}`;
  });

  return [
    `¡Hola ${input.businessName}! Acabo de hacer el pedido *#${input.orderNumber}* en la web.`,
    "",
    ...lines,
    "",
    `*Total: ${input.total}*`,
    input.fulfillment === "delivery"
      ? `*Entrega:* Delivery${input.zoneName !== null ? ` a ${input.zoneName}` : ""}`
      : "*Entrega:* Recojo en tienda",
    input.paymentMethod !== null ? `*Pago:* ${input.paymentMethod}` : null,
    `*Nombre:* ${input.contactName}`,
    "",
    `Seguimiento: ${input.trackingUrl}`,
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}
