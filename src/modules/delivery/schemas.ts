/**
 * Validation for delivery zones, rates and the delivery of an order.
 *
 * The property worth stating first, the same posture every schema in this
 * project takes toward a computed field: nothing here accepts `tenant_id`,
 * `shipping_cents`, `total_cents`, a status timestamp, or `fee_cents` on the
 * attach form. Those are exactly what the database derives (ADR-023), and a
 * field for them here would be a second place they could disagree.
 *
 * `fee_cents` IS accepted when editing an existing delivery, because correcting
 * a price somebody agreed to over the phone is a real operation - and the
 * database still refuses it once the order has left `pending`.
 */

import { z } from "zod";
import { DELIVERY_STATUSES } from "./lifecycle";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Maximo ${max} caracteres.`)
    .transform((value) => (value.length === 0 ? null : value))
    .nullable();

const requiredText = (max: number, label: string) =>
  z.string().trim().min(1, `${label} es obligatorio.`).max(max, `Maximo ${max} caracteres.`);

const uuid = z.uuid({ error: "Identificador invalido." });

/** A money field typed by a person, as integer cents. Mirrors `payments/schemas.ts`. */
const moneyField = (label: string, allowZero = true) =>
  z.string().transform((value, ctx) => {
    const raw = value.trim().replace(",", ".");
    const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(raw);
    if (match === null) {
      ctx.addIssue({
        code: "custom",
        message: `Usa un importe como 8.50 para ${label.toLowerCase()}.`,
      });
      return z.NEVER;
    }
    const [, whole, decimals = ""] = match;
    const cents = Number(whole) * 100 + Number(decimals.padEnd(2, "0"));
    if (!allowZero && cents === 0) {
      ctx.addIssue({ code: "custom", message: `${label} debe ser mayor que cero.` });
      return z.NEVER;
    }
    if (cents > 10_000_000_000) {
      ctx.addIssue({ code: "custom", message: `${label} es demasiado grande.` });
      return z.NEVER;
    }
    return cents;
  });

/** The same money field, but blank means "not set" rather than zero. */
const optionalMoneyField = (label: string) =>
  z.string().transform((value, ctx) => {
    if (value.trim().length === 0) return null;
    const parsed = moneyField(label).safeParse(value);
    if (!parsed.success) {
      ctx.addIssue({
        code: "custom",
        message: parsed.error.issues[0]?.message ?? `${label} no es valido.`,
      });
      return z.NEVER;
    }
    return parsed.data;
  });

/**
 * One half of a coordinate.
 *
 * Kept as a nullable number rather than a string so the both-or-neither rule
 * below can be expressed once, on the object, instead of twice.
 */
const coordinateField = (label: string, limit: number) =>
  z.string().transform((value, ctx) => {
    const raw = value.trim().replace(",", ".");
    if (raw.length === 0) return null;
    if (!/^-?\d{1,3}(\.\d{1,6})?$/.test(raw)) {
      ctx.addIssue({ code: "custom", message: `${label} debe ser un numero como -12.121500.` });
      return z.NEVER;
    }
    const parsed = Number(raw);
    if (Number.isNaN(parsed) || parsed < -limit || parsed > limit) {
      ctx.addIssue({ code: "custom", message: `${label} esta fuera de rango.` });
      return z.NEVER;
    }
    return parsed;
  });

/**
 * Half a coordinate is not a location.
 *
 * Enforced here as well as by the CHECK constraint, so the person typing gets a
 * message on the right field instead of a constraint name after a round trip.
 */
const coordinatePair = {
  latitude: coordinateField("La latitud", 90),
  longitude: coordinateField("La longitud", 180),
};

function refineCoordinates<T extends { latitude: number | null; longitude: number | null }>(
  value: T,
  ctx: z.RefinementCtx,
): void {
  if ((value.latitude === null) === (value.longitude === null)) return;
  ctx.addIssue({
    code: "custom",
    path: [value.latitude === null ? "latitude" : "longitude"],
    message: "Escribe las dos coordenadas o ninguna.",
  });
}

const positiveInt = (label: string, max: number) =>
  z.string().transform((value, ctx) => {
    if (value.trim().length === 0) return null;
    if (!/^\d+$/.test(value.trim())) {
      ctx.addIssue({ code: "custom", message: `${label} debe ser un numero entero.` });
      return z.NEVER;
    }
    const parsed = Number(value.trim());
    if (parsed < 1 || parsed > max) {
      ctx.addIssue({ code: "custom", message: `${label} debe estar entre 1 y ${max}.` });
      return z.NEVER;
    }
    return parsed;
  });

// ---------------------------------------------------------------------------
// Zones
// ---------------------------------------------------------------------------

export const createDeliveryZoneSchema = z.object({
  name: requiredText(80, "El nombre"),
  district: optionalText(100),
  notes: optionalText(300),
});

export const updateDeliveryZoneSchema = createDeliveryZoneSchema.extend({
  zoneId: uuid,
});

export const setDeliveryZoneActiveSchema = z.object({
  zoneId: uuid,
  isActive: z.enum(["true", "false"]).transform((value) => value === "true"),
});

export const deleteDeliveryZoneSchema = z.object({ zoneId: uuid });

// ---------------------------------------------------------------------------
// Rates
// ---------------------------------------------------------------------------

export const saveDeliveryRateSchema = z.object({
  zoneId: uuid,
  /** Blank means the zone's default rate, which is what NULL stores. */
  locationId: z
    .string()
    .trim()
    .transform((value) => (value.length === 0 ? null : value))
    .nullable()
    .refine((value) => value === null || z.uuid().safeParse(value).success, {
      message: "Sede invalida.",
    }),
  feeCents: moneyField("El costo"),
  minOrderFreeCents: optionalMoneyField("El monto para envio gratis"),
  estimatedMinutes: positiveInt("El tiempo estimado", 600),
});

export const deleteDeliveryRateSchema = z.object({ rateId: uuid });

// ---------------------------------------------------------------------------
// The delivery of an order
// ---------------------------------------------------------------------------

/**
 * No `feeCents`: attaching resolves the rate on the server from the zone and
 * the order's branch. A fee sent by the browser would be a price the customer
 * chose.
 */
export const attachDeliverySchema = z
  .object({
    orderId: uuid,
    zoneId: uuid,
    addressLine: requiredText(300, "La direccion"),
    district: optionalText(100),
    city: optionalText(100),
    reference: optionalText(200),
    recipientName: optionalText(120),
    recipientPhone: optionalText(30),
    notes: optionalText(500),
    ...coordinatePair,
  })
  .superRefine(refineCoordinates);

export const updateDeliveryAddressSchema = z
  .object({
    deliveryId: uuid,
    addressLine: requiredText(300, "La direccion"),
    district: optionalText(100),
    city: optionalText(100),
    reference: optionalText(200),
    recipientName: optionalText(120),
    recipientPhone: optionalText(30),
    notes: optionalText(500),
    ...coordinatePair,
  })
  .superRefine(refineCoordinates);

/** Correcting what was agreed. The database refuses it once the order is settled. */
export const updateDeliveryFeeSchema = z.object({
  deliveryId: uuid,
  feeCents: moneyField("El costo"),
});

export const assignCourierSchema = z.object({
  deliveryId: uuid,
  courierUserId: uuid,
});

export const advanceDeliveryStatusSchema = z.object({
  deliveryId: uuid,
  status: z.enum(DELIVERY_STATUSES),
});

/**
 * Ending badly requires saying why - the same rule the CHECK states, raised
 * here so the message lands on the field instead of arriving as a constraint.
 */
export const closeDeliverySchema = z.object({
  deliveryId: uuid,
  status: z.enum(["failed", "cancelled"]),
  failureReason: requiredText(300, "El motivo"),
});

export const detachDeliverySchema = z.object({ deliveryId: uuid });
