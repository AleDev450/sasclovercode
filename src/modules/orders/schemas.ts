/**
 * Validation for the order forms.
 *
 * The shape worth noticing: **no schema here accepts a price.**
 *
 * A line arrives as a product and a quantity. The unit price is copied from the
 * catalogue by the database (`snapshot_order_item`), so there is no field for a
 * caller to tamper with — which is a stronger guarantee than validating a
 * submitted price against the catalogue, because a field that does not exist
 * cannot be wrong.
 *
 * The discount DOES arrive from the form: it is a decision the business makes,
 * not a fact about the catalogue. It is bounded here and again by a CHECK.
 */

import { z } from "zod";
import { parseMoney } from "@/lib/money";
import { ORDER_SOURCES } from "./lifecycle";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Maximo ${max} caracteres.`)
    .transform((value) => (value.length === 0 ? null : value))
    .nullable();

/**
 * A money field typed by a person, as integer cents.
 *
 * Parsed inside the transform with the issue context so the message
 * `parseMoney` produced is the message the person reads, exactly as Phase 11
 * does for prices.
 */
const moneyField = (label: string) =>
  z.string().transform((value, ctx) => {
    const raw = value.trim();
    if (raw.length === 0) return 0;

    const result = parseMoney(raw);
    if (!result.ok || result.cents === undefined) {
      ctx.addIssue({ code: "custom", message: result.reason ?? `${label} invalido.` });
      return z.NEVER;
    }
    if (result.cents < 0) {
      ctx.addIssue({ code: "custom", message: `${label} no puede ser negativo.` });
      return z.NEVER;
    }
    return result.cents;
  });

/**
 * A quantity, which may be fractional: 0,75 kg of something sold by the kilo.
 *
 * Three decimals, matching `numeric(10,3)`. A comma is accepted as the decimal
 * separator for the same reason `parseMoney` accepts one — a Peruvian keyboard
 * produces it.
 */
const quantityField = z.string().transform((value, ctx) => {
  const normalized = value.trim().replace(",", ".");

  if (!/^\d+(\.\d{1,3})?$/.test(normalized)) {
    ctx.addIssue({ code: "custom", message: "Usa una cantidad como 1 o 0.75." });
    return z.NEVER;
  }

  const parsed = Number(normalized);
  if (parsed <= 0) {
    ctx.addIssue({ code: "custom", message: "La cantidad debe ser mayor que cero." });
    return z.NEVER;
  }
  if (parsed > 100000) {
    ctx.addIssue({ code: "custom", message: "Esa cantidad es demasiado grande." });
    return z.NEVER;
  }

  return parsed;
});

export const orderItemInputSchema = z.object({
  productId: z.uuid("Elige un producto."),
  variantId: z
    .string()
    .trim()
    .transform((value) => (value.length === 0 ? null : value))
    .nullable()
    .refine((value) => value === null || z.uuid().safeParse(value).success, "Variante invalida."),
  quantity: quantityField,
  discount: moneyField("El descuento"),
  notes: optionalText(300),
});

export type OrderItemInput = z.output<typeof orderItemInputSchema>;

export const createOrderSchema = z.object({
  locationId: z.uuid("Elige una sede."),
  customerId: z
    .string()
    .trim()
    .transform((value) => (value.length === 0 ? null : value))
    .nullable()
    .refine((value) => value === null || z.uuid().safeParse(value).success, "Cliente invalido."),
  source: z.enum(ORDER_SOURCES),
  shipping: moneyField("El envio"),
  notes: optionalText(1000),
  // At least one line: an order with nothing in it cannot move forward anyway
  // (the database refuses), so refusing it here gives a message instead of a
  // dead end.
  items: z.array(orderItemInputSchema).min(1, "Anade al menos un producto."),
});

export const addOrderItemSchema = orderItemInputSchema.extend({
  orderId: z.uuid(),
});

export const removeOrderItemSchema = z.object({
  orderId: z.uuid(),
  itemId: z.uuid(),
});

export const advanceOrderSchema = z.object({
  orderId: z.uuid(),
  toStatus: z.enum(["confirmed", "preparing", "ready", "completed"]),
});

export const cancelOrderSchema = z.object({
  orderId: z.uuid(),
  reason: z.string().trim().min(1, "Escribe por que se anula.").max(300, "Maximo 300 caracteres."),
});

/** How many orders one page of the listing shows. */
export const ORDERS_PAGE_SIZE = 20;

/**
 * Listing filters, as they arrive from the URL.
 *
 * Same posture as Phase 12: shareable, reload-proof, readable by a Server
 * Component without JavaScript, and tolerant of anything — a URL is typed by
 * hand and an unknown status is "no filter", not an error.
 */
export const orderFiltersSchema = z.object({
  status: z
    .string()
    .optional()
    .transform((value) => {
      const statuses = [
        "pending",
        "confirmed",
        "preparing",
        "ready",
        "completed",
        "cancelled",
      ] as const;
      return value !== undefined && (statuses as readonly string[]).includes(value)
        ? (value as (typeof statuses)[number])
        : null;
    }),
  locationId: z
    .string()
    .optional()
    .transform((value) =>
      value !== undefined && z.uuid().safeParse(value).success ? value : null,
    ),
  page: z
    .string()
    .optional()
    .transform((value) => {
      const parsed = Number.parseInt(value ?? "1", 10);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
    }),
});

export type OrderFilters = z.output<typeof orderFiltersSchema>;
