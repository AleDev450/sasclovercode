/**
 * Validation for the storefront settings form and the website checkout.
 *
 * Mirrors the CHECK constraints of `tenant_storefronts` and the refusals of
 * `place_web_order`. The database is the authority on both; this layer exists so
 * the owner gets a field-level message and the visitor is stopped before a
 * round trip that was always going to fail.
 */

import { z } from "zod";
import { parseMoney } from "@/lib/money";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value.length === 0 ? null : value))
    .nullable();

/** A checkbox arrives as "on" when ticked and is absent when not. */
const checkbox = z
  .union([z.literal("on"), z.literal("true"), z.literal("false"), z.literal("")])
  .optional()
  .transform((value) => value === "on" || value === "true");

export const STOREFRONT_MODES = ["auto", "open", "closed"] as const;

export const storefrontSettingsSchema = z
  .object({
    orderingEnabled: checkbox,
    mode: z.enum(STOREFRONT_MODES),
    closedMessage: optionalText(300),
    acceptsDelivery: checkbox,
    acceptsPickup: checkbox,
    minOrder: z
      .string()
      .trim()
      .transform((value, context) => {
        if (value.length === 0) return 0;
        const parsed = parseMoney(value);
        if (!parsed.ok || parsed.cents === undefined || parsed.cents < 0) {
          context.addIssue({
            code: "custom",
            message: parsed.reason ?? "Escribe un monto, por ejemplo 30.00",
          });
          return z.NEVER;
        }
        return parsed.cents;
      }),
    orderLocationId: z
      .string()
      .trim()
      .transform((value) => (value.length === 0 ? null : value))
      .nullable()
      .refine((value) => value === null || z.uuid().safeParse(value).success, "Sede invalida."),
    whatsappButton: checkbox,
    whatsappMessage: optionalText(300),
    tagline: optionalText(200),
    publicEmail: z
      .string()
      .trim()
      .max(200)
      .transform((value) => (value.length === 0 ? null : value))
      .nullable()
      .refine((value) => value === null || z.email().safeParse(value).success, "Correo invalido."),
    bestsellersDays: z.coerce.number().int().min(7, "Minimo 7 dias.").max(365, "Maximo 365 dias."),
  })
  .refine((value) => value.acceptsDelivery || value.acceptsPickup, {
    message: "Activa al menos delivery o recojo en tienda.",
    path: ["acceptsPickup"],
  });

export type StorefrontSettingsInput = z.output<typeof storefrontSettingsSchema>;

/* -------------------------------------------------------------------------- */
/*  Checkout                                                                   */
/* -------------------------------------------------------------------------- */

const uuid = z.uuid();

/**
 * The payload the checkout sends to `placeWebOrderAction`.
 *
 * Ids and quantities, never an amount. The shape is exactly the JSON
 * `place_web_order` reads, so the action forwards what it validated without
 * translating field names - a translation layer is a second place for a field to
 * be dropped.
 */
export const checkoutSchema = z
  .object({
    contact: z.object({
      name: z.string().trim().min(1, "Escribe tu nombre.").max(120),
      phone: z
        .string()
        .trim()
        .max(30)
        .refine(
          (value) => /^\+?[0-9]{6,20}$/.test(value.replace(/[\s().-]/g, "")),
          "Escribe un teléfono válido.",
        ),
    }),
    fulfillment: z.enum(["delivery", "pickup"]),
    delivery: z
      .object({
        zoneId: uuid,
        address: z.string().trim().min(1, "Escribe la dirección.").max(300),
        district: z.string().trim().max(100).optional(),
        reference: z.string().trim().max(200).optional(),
      })
      .optional(),
    paymentMethodId: uuid.nullable(),
    /** Phase 31: pay through the gateway the platform enabled. */
    payOnline: z.boolean().default(false),
    note: z.string().trim().max(300).optional(),
    acceptedTerms: z.literal(true, { error: "Acepta los términos para continuar." }),
    items: z
      .array(
        z.object({
          productId: uuid,
          variantId: uuid.nullable(),
          optionIds: z.array(uuid).max(20),
          quantity: z.number().int().min(1).max(99),
        }),
      )
      .min(1, "Tu carrito está vacío.")
      .max(50),
  })
  .refine((value) => value.fulfillment !== "delivery" || value.delivery !== undefined, {
    message: "Completa los datos de entrega.",
    path: ["delivery"],
  });

export type CheckoutInput = z.output<typeof checkoutSchema>;
