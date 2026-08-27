/**
 * Validation for payments, cash sessions, cash movements and payment methods.
 *
 * The shape worth noticing, same posture as `orders/schemas.ts`: nothing here
 * accepts a value the database is about to compute. There is no
 * `expectedCents` or `differenceCents` field on the close-session schema -
 * only `closingCents`, the one number a cashier actually declares - and no
 * `voidedAt` on the record-payment schema. A payment's `amount`, by contrast,
 * IS accepted from the caller: unlike an order line's price, there is no
 * catalogue fact it could disagree with, so the cap against the order's
 * remaining balance is what the database enforces instead (ADR-018 §2).
 */

import { z } from "zod";
import { parseMoney } from "@/lib/money";
import { MANUAL_CASH_MOVEMENT_TYPES, PAYMENT_METHOD_TYPES } from "./constants";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Maximo ${max} caracteres.`)
    .transform((value) => (value.length === 0 ? null : value))
    .nullable();

const optionalUuid = (label: string) =>
  z
    .string()
    .trim()
    .transform((value) => (value.length === 0 ? null : value))
    .nullable()
    .refine((value) => value === null || z.uuid().safeParse(value).success, label);

/** A money field typed by a person, as integer cents. Mirrors `orders/schemas.ts`. */
const moneyField = (label: string, allowZero = false) =>
  z.string().transform((value, ctx) => {
    const raw = value.trim();
    if (raw.length === 0) {
      ctx.addIssue({ code: "custom", message: `${label} es obligatorio.` });
      return z.NEVER;
    }

    const result = parseMoney(raw);
    if (!result.ok || result.cents === undefined) {
      ctx.addIssue({ code: "custom", message: result.reason ?? `${label} invalido.` });
      return z.NEVER;
    }
    if (result.cents < 0 || (!allowZero && result.cents === 0)) {
      ctx.addIssue({
        code: "custom",
        message: allowZero ? `${label} no puede ser negativo.` : `${label} debe ser mayor que cero.`,
      });
      return z.NEVER;
    }
    return result.cents;
  });

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------

export const recordPaymentSchema = z.object({
  orderId: z.uuid(),
  paymentMethodId: z.uuid("Elige un metodo de pago."),
  // NOT validated as "cash requires a session" here - that rule lives in
  // `guard_payment()`, because the application is not the only writer
  // (Phase 15's POS). Duplicating it here would be a second copy that can
  // drift, the same reasoning `orders/schemas.ts` gives for the state
  // machine.
  cashSessionId: optionalUuid("Sesion de caja invalida."),
  amount: moneyField("El monto"),
  reference: optionalText(120),
  notes: optionalText(300),
});

export const voidPaymentSchema = z.object({
  paymentId: z.uuid(),
  reason: z.string().trim().min(1, "Escribe por que se anula.").max(300, "Maximo 300 caracteres."),
});

// ---------------------------------------------------------------------------
// Payment methods
// ---------------------------------------------------------------------------

export const paymentMethodTypeSchema = z.enum(PAYMENT_METHOD_TYPES);

export const createPaymentMethodSchema = z.object({
  type: paymentMethodTypeSchema,
  name: z.string().trim().min(1, "Escribe un nombre.").max(80, "Maximo 80 caracteres."),
  reference: optionalText(120),
});

// `type` is absent on purpose: existing payments were validated under the
// type the method had when they were made, and letting it change afterward
// would make that validation retroactively meaningless.
export const updatePaymentMethodSchema = z.object({
  paymentMethodId: z.uuid(),
  name: z.string().trim().min(1, "Escribe un nombre.").max(80, "Maximo 80 caracteres."),
  reference: optionalText(120),
});

export const setPaymentMethodActiveSchema = z.object({
  paymentMethodId: z.uuid(),
  isActive: z.enum(["true", "false"]).transform((value) => value === "true"),
});

// ---------------------------------------------------------------------------
// Cash registers, sessions and movements
// ---------------------------------------------------------------------------

export const createCashRegisterSchema = z.object({
  locationId: z.uuid("Elige una sede."),
  name: z.string().trim().min(1, "Escribe un nombre.").max(80, "Maximo 80 caracteres."),
});

export const setCashRegisterActiveSchema = z.object({
  cashRegisterId: z.uuid(),
  isActive: z.enum(["true", "false"]).transform((value) => value === "true"),
});

export const openCashSessionSchema = z.object({
  cashRegisterId: z.uuid("Elige una caja."),
  // A float of zero is normal: some businesses start a shift with nothing in
  // the drawer and rely entirely on card/Yape.
  opening: moneyField("El monto inicial", true),
  notes: optionalText(500),
});

export const closeCashSessionSchema = z.object({
  cashSessionId: z.uuid(),
  // The one number a cashier declares. `expectedCents`/`differenceCents` are
  // computed by `close_cash_session()` - there is no field for either here.
  closing: moneyField("El monto contado", true),
});

/**
 * Signed, unlike every other money field in the project: a manual movement is
 * the one place a person states a DIRECTION, not just a magnitude - "the till
 * had 20 more than expected" is a real adjustment. `payout` and `deposit`
 * have only one legal sign; the Server Action fixes it regardless of what was
 * typed, so the sign only matters for `adjustment`.
 */
const signedMoneyField = (label: string) =>
  z.string().transform((value, ctx) => {
    const raw = value.trim();
    if (raw.length === 0) {
      ctx.addIssue({ code: "custom", message: `${label} es obligatorio.` });
      return z.NEVER;
    }

    const negative = raw.startsWith("-");
    const result = parseMoney(negative ? raw.slice(1) : raw);
    if (!result.ok || result.cents === undefined) {
      ctx.addIssue({ code: "custom", message: result.reason ?? `${label} invalido.` });
      return z.NEVER;
    }
    if (result.cents === 0) {
      ctx.addIssue({ code: "custom", message: `${label} debe ser distinto de cero.` });
      return z.NEVER;
    }
    return negative ? -result.cents : result.cents;
  });

export const recordCashMovementSchema = z.object({
  cashSessionId: z.uuid(),
  type: z.enum(MANUAL_CASH_MOVEMENT_TYPES),
  amount: signedMoneyField("El monto"),
  reason: z.string().trim().min(1, "Escribe el motivo.").max(300, "Maximo 300 caracteres."),
});
