/**
 * Validation for promotions, coupons, discounts and points.
 *
 * The property worth stating first, the same posture every schema in this
 * project takes toward a computed field: nothing here accepts `tenant_id`,
 * `times_redeemed`, `points_balance`, `promotion_discount_cents` or
 * `total_cents`. Those are exactly what the database derives (ADR-024), and a
 * field for them here would be a second place they could disagree.
 *
 * `discount_cents` is not an input either: applying a promotion sends the
 * promotion, and the server resolves the amount with `discountFor()`. A
 * discount the browser could name is a price the customer chose.
 */

import { z } from "zod";
import { MANUAL_LOYALTY_TYPES } from "./points";

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
        message: `Usa un importe como 24.90 para ${label.toLowerCase()}.`,
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

/**
 * A whole number typed by a person.
 *
 * Two functions rather than one with an `optional` flag: the flag would be a
 * runtime value, so TypeScript would have to infer `number | null` for both
 * cases and every required field downstream would carry a null it can never
 * hold.
 */
const intField = (label: string, min: number, max: number) =>
  z.string().transform((value, ctx) => {
    const raw = value.trim();
    if (raw.length === 0) {
      ctx.addIssue({ code: "custom", message: `${label} es obligatorio.` });
      return z.NEVER;
    }
    if (!/^\d+$/.test(raw)) {
      ctx.addIssue({ code: "custom", message: `${label} debe ser un numero entero.` });
      return z.NEVER;
    }
    const parsed = Number(raw);
    if (parsed < min || parsed > max) {
      ctx.addIssue({ code: "custom", message: `${label} debe estar entre ${min} y ${max}.` });
      return z.NEVER;
    }
    return parsed;
  });

/** The same, where blank means "no limit" rather than a mistake. */
const optionalIntField = (label: string, min: number, max: number) =>
  z.string().transform((value, ctx): number | null => {
    const raw = value.trim();
    if (raw.length === 0) return null;
    const parsed = intField(label, min, max).safeParse(raw);
    if (!parsed.success) {
      ctx.addIssue({
        code: "custom",
        message: parsed.error.issues[0]?.message ?? `${label} no es valido.`,
      });
      return z.NEVER;
    }
    return parsed.data;
  });

/** An ISO date-time from a `datetime-local` input. Blank means "no limit". */
const optionalDateTime = (label: string) =>
  z.string().transform((value, ctx) => {
    const raw = value.trim();
    if (raw.length === 0) return null;
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) {
      ctx.addIssue({ code: "custom", message: `${label} no es una fecha valida.` });
      return z.NEVER;
    }
    return parsed.toISOString();
  });

// ---------------------------------------------------------------------------
// Promotions
// ---------------------------------------------------------------------------

/**
 * The shape of the form, before the type/value agreement is checked.
 *
 * `percentOff` and `amountOffCents` are both optional here and the refinement
 * below decides which one this promotion needed - mirroring the two CHECK
 * constraints, so the message lands on the field instead of arriving as a
 * constraint name.
 */
const promotionFields = {
  name: requiredText(120, "El nombre"),
  description: optionalText(300),
  type: z.enum(["percentage", "fixed_amount", "free_delivery"]),
  percentOff: optionalIntField("El porcentaje", 1, 100),
  amountOffCents: z
    .string()
    .transform((value, ctx) => {
      if (value.trim().length === 0) return null;
      const parsed = moneyField("El monto", false).safeParse(value);
      if (!parsed.success) {
        ctx.addIssue({
          code: "custom",
          message: parsed.error.issues[0]?.message ?? "El monto no es valido.",
        });
        return z.NEVER;
      }
      return parsed.data;
    })
    .nullable(),
  minOrderCents: z.string().transform((value, ctx) => {
    if (value.trim().length === 0) return 0;
    const parsed = moneyField("El pedido minimo").safeParse(value);
    if (!parsed.success) {
      ctx.addIssue({
        code: "custom",
        message: parsed.error.issues[0]?.message ?? "El minimo no es valido.",
      });
      return z.NEVER;
    }
    return parsed.data;
  }),
  startsAt: optionalDateTime("La fecha de inicio"),
  endsAt: optionalDateTime("La fecha de fin"),
  maxRedemptions: optionalIntField("El tope de canjes", 1, 1_000_000),
};

function refinePromotion(
  value: {
    type: string;
    percentOff: number | null;
    amountOffCents: number | null;
    startsAt: string | null;
    endsAt: string | null;
  },
  ctx: z.RefinementCtx,
): void {
  if (value.type === "percentage" && value.percentOff === null) {
    ctx.addIssue({
      code: "custom",
      path: ["percentOff"],
      message: "Un descuento porcentual necesita su porcentaje.",
    });
  }
  if (value.type !== "percentage" && value.percentOff !== null) {
    ctx.addIssue({
      code: "custom",
      path: ["percentOff"],
      message: "Solo un descuento porcentual lleva porcentaje.",
    });
  }
  if (value.type === "fixed_amount" && value.amountOffCents === null) {
    ctx.addIssue({
      code: "custom",
      path: ["amountOffCents"],
      message: "Un descuento fijo necesita su monto.",
    });
  }
  if (value.type !== "fixed_amount" && value.amountOffCents !== null) {
    ctx.addIssue({
      code: "custom",
      path: ["amountOffCents"],
      message: "Solo un descuento fijo lleva monto.",
    });
  }
  if (
    value.startsAt !== null &&
    value.endsAt !== null &&
    new Date(value.endsAt) <= new Date(value.startsAt)
  ) {
    ctx.addIssue({
      code: "custom",
      path: ["endsAt"],
      message: "El fin debe ser posterior al inicio.",
    });
  }
}

export const createPromotionSchema = z.object(promotionFields).superRefine(refinePromotion);

export const updatePromotionSchema = z
  .object({ ...promotionFields, promotionId: uuid })
  .superRefine(refinePromotion);

export const setPromotionActiveSchema = z.object({
  promotionId: uuid,
  isActive: z.enum(["true", "false"]).transform((value) => value === "true"),
});

export const deletePromotionSchema = z.object({ promotionId: uuid });

// ---------------------------------------------------------------------------
// Coupons
// ---------------------------------------------------------------------------

export const createCouponSchema = z.object({
  promotionId: uuid,
  code: z
    .string()
    .trim()
    .min(3, "El codigo necesita al menos 3 caracteres.")
    .max(40, "Maximo 40 caracteres.")
    .regex(/^[A-Za-z0-9_-]+$/, "Usa solo letras, numeros, guion y guion bajo.")
    // Stored as typed, matched case-insensitively by the unique index - but
    // normalising here means the list reads the way a flyer does.
    .transform((value) => value.toUpperCase()),
  maxRedemptions: optionalIntField("El tope de canjes", 1, 1_000_000),
  expiresAt: optionalDateTime("La caducidad"),
});

export const setCouponActiveSchema = z.object({
  couponId: uuid,
  isActive: z.enum(["true", "false"]).transform((value) => value === "true"),
});

export const deleteCouponSchema = z.object({ couponId: uuid });

// ---------------------------------------------------------------------------
// Applying a discount to an order
// ---------------------------------------------------------------------------

/** No `discountCents`: the server resolves it from the promotion and the order. */
export const applyPromotionSchema = z.object({
  orderId: uuid,
  promotionId: uuid,
});

export const applyCouponSchema = z.object({
  orderId: uuid,
  code: z
    .string()
    .trim()
    .min(3, "Escribe el codigo del cupon.")
    .max(40, "Ese codigo es demasiado largo.")
    .transform((value) => value.toUpperCase()),
});

export const removeOrderPromotionSchema = z.object({ orderPromotionId: uuid });

// ---------------------------------------------------------------------------
// Points
// ---------------------------------------------------------------------------

export const enrollCustomerSchema = z.object({ customerId: uuid });

export const recordLoyaltyAdjustmentSchema = z.object({
  accountId: uuid,
  type: z.enum(MANUAL_LOYALTY_TYPES),
  /**
   * Signed, unlike every other point field: an adjustment states a DIRECTION.
   * "Contamos 20 puntos de menos" and "le regalamos 50" are both real, and one
   * of them is negative.
   */
  points: z.string().transform((value, ctx) => {
    const raw = value.trim();
    if (!/^-?\d+$/.test(raw)) {
      ctx.addIssue({ code: "custom", message: "Usa un numero entero, con signo si resta." });
      return z.NEVER;
    }
    const parsed = Number(raw);
    if (parsed === 0) {
      ctx.addIssue({
        code: "custom",
        message: "Un movimiento de cero puntos no es un movimiento.",
      });
      return z.NEVER;
    }
    if (Math.abs(parsed) > 1_000_000) {
      ctx.addIssue({ code: "custom", message: "Esa cantidad es demasiado grande." });
      return z.NEVER;
    }
    return parsed;
  }),
  reason: requiredText(300, "El motivo"),
});

export const redeemLoyaltyPointsSchema = z.object({
  orderId: uuid,
  accountId: uuid,
  points: intField("Los puntos", 1, 1_000_000),
});

// ---------------------------------------------------------------------------
// The programme's settings
// ---------------------------------------------------------------------------

export const loyaltySettingsSchema = z.object({
  loyaltyEnabled: z.enum(["true", "false"]).transform((value) => value === "true"),
  pointsPerSol: intField("Los puntos por sol", 0, 1000),
  pointValueCents: intField("El valor del punto en centimos", 1, 10000),
});
