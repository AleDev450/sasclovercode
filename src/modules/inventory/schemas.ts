/**
 * Validation for units, inventory items, suppliers, purchases, manual
 * stock movements, transfers and recipes.
 *
 * The property worth stating first, same posture as every other schema in
 * this project toward a computed field: nothing here accepts
 * `stock_movements.tenant_id`, `purchases.total_cost_cents`, or a stock
 * balance of any kind - those are exactly what the database derives
 * (ADR-022), and a field for them here would be a second place they could
 * disagree with the ledger.
 */

import { z } from "zod";
import { MANUAL_STOCK_MOVEMENT_TYPES } from "./constants";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Maximo ${max} caracteres.`)
    .transform((value) => (value.length === 0 ? null : value))
    .nullable();

/** A money field typed by a person, as integer cents. Mirrors `payments/schemas.ts`. */
const moneyField = (label: string, allowZero = false) =>
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

/** A quantity, which may be fractional. Three decimals, matching `numeric(12,3)`. */
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

/**
 * Signed, unlike `quantityField`: an adjustment or a return states a
 * DIRECTION, not just a magnitude - "we counted three more than the
 * system thought" is a real correction. Mirrors `payments/schemas.ts`'
 * `signedMoneyField`.
 */
const signedQuantityField = z.string().transform((value, ctx) => {
  const raw = value.trim().replace(",", ".");
  const negative = raw.startsWith("-");
  const normalized = negative ? raw.slice(1) : raw;
  if (!/^\d+(\.\d{1,3})?$/.test(normalized)) {
    ctx.addIssue({ code: "custom", message: "Usa una cantidad como 1 o 0.75." });
    return z.NEVER;
  }
  const parsed = Number(normalized);
  if (parsed === 0) {
    ctx.addIssue({ code: "custom", message: "La cantidad debe ser distinta de cero." });
    return z.NEVER;
  }
  if (parsed > 100000) {
    ctx.addIssue({ code: "custom", message: "Esa cantidad es demasiado grande." });
    return z.NEVER;
  }
  return negative ? -parsed : parsed;
});

// ---------------------------------------------------------------------------
// Units
// ---------------------------------------------------------------------------

export const createUnitSchema = z.object({
  name: z.string().trim().min(1, "Escribe un nombre.").max(60, "Maximo 60 caracteres."),
  abbreviation: z
    .string()
    .trim()
    .min(1, "Escribe una abreviatura.")
    .max(10, "Maximo 10 caracteres."),
});

export const setUnitActiveSchema = z.object({
  unitId: z.uuid(),
  isActive: z.enum(["true", "false"]).transform((value) => value === "true"),
});

// ---------------------------------------------------------------------------
// Inventory items
// ---------------------------------------------------------------------------

export const createInventoryItemSchema = z.object({
  unitId: z.uuid("Elige una unidad."),
  name: z.string().trim().min(1, "Escribe un nombre.").max(200, "Maximo 200 caracteres."),
  sku: optionalText(60),
});

export const updateInventoryItemSchema = z.object({
  inventoryItemId: z.uuid(),
  unitId: z.uuid("Elige una unidad."),
  name: z.string().trim().min(1, "Escribe un nombre.").max(200, "Maximo 200 caracteres."),
  sku: optionalText(60),
});

export const setInventoryItemActiveSchema = z.object({
  inventoryItemId: z.uuid(),
  isActive: z.enum(["true", "false"]).transform((value) => value === "true"),
});

// ---------------------------------------------------------------------------
// Suppliers
// ---------------------------------------------------------------------------

const supplierTaxId = optionalText(11).refine(
  (value) => value === null || /^[0-9]{11}$/.test(value),
  "El RUC debe tener 11 digitos.",
);

const supplierEmail = z
  .string()
  .trim()
  .toLowerCase()
  .max(200, "Maximo 200 caracteres.")
  .transform((value) => (value.length === 0 ? null : value))
  .nullable()
  .refine(
    (value) => value === null || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value),
    "Ese correo no parece valido.",
  );

const supplierPhone = optionalText(30).refine(
  (value) => value === null || /^\+?[0-9]{6,20}$/.test(value),
  "El telefono debe tener entre 6 y 20 digitos.",
);

const supplierFields = {
  name: z.string().trim().min(1, "Escribe un nombre.").max(200, "Maximo 200 caracteres."),
  taxId: supplierTaxId,
  contactName: optionalText(200),
  phone: supplierPhone,
  email: supplierEmail,
  address: optionalText(300),
  notes: optionalText(1000),
};

export const createSupplierSchema = z.object(supplierFields);

export const updateSupplierSchema = z.object({
  supplierId: z.uuid(),
  ...supplierFields,
});

export const setSupplierActiveSchema = z.object({
  supplierId: z.uuid(),
  isActive: z.enum(["true", "false"]).transform((value) => value === "true"),
});

// ---------------------------------------------------------------------------
// Purchases
// ---------------------------------------------------------------------------

export const purchaseLineInputSchema = z.object({
  inventoryItemId: z.uuid("Elige un insumo."),
  quantity: quantityField,
  unitCost: moneyField("El costo unitario", true),
});

export type PurchaseLineInput = z.output<typeof purchaseLineInputSchema>;

export const recordPurchaseSchema = z.object({
  supplierId: z.uuid("Elige un proveedor."),
  locationId: z.uuid("Elige una sede."),
  reference: optionalText(120),
  notes: optionalText(1000),
  lines: z.array(purchaseLineInputSchema).min(1, "Anade al menos un insumo."),
});

// ---------------------------------------------------------------------------
// Manual stock movements (adjustment, waste, return)
// ---------------------------------------------------------------------------

export const recordStockMovementSchema = z.object({
  inventoryItemId: z.uuid("Elige un insumo."),
  locationId: z.uuid("Elige una sede."),
  type: z.enum(MANUAL_STOCK_MOVEMENT_TYPES),
  // `waste` always decreases regardless of sign typed (fixed by the
  // Server Action, the same way `payout` is always negative in
  // `payments/server/actions.ts`); `adjustment`/`return` keep the sign
  // as typed, since both are genuinely bidirectional.
  quantity: signedQuantityField,
  reason: z.string().trim().min(1, "Escribe el motivo.").max(500, "Maximo 500 caracteres."),
});

// ---------------------------------------------------------------------------
// Transfers
// ---------------------------------------------------------------------------

export const recordStockTransferSchema = z
  .object({
    inventoryItemId: z.uuid("Elige un insumo."),
    fromLocationId: z.uuid("Elige la sede de origen."),
    toLocationId: z.uuid("Elige la sede de destino."),
    quantity: quantityField,
    reason: optionalText(500),
  })
  .refine((value) => value.fromLocationId !== value.toLocationId, {
    message: "El origen y el destino deben ser sedes distintas.",
    path: ["toLocationId"],
  });

// ---------------------------------------------------------------------------
// Recipes
// ---------------------------------------------------------------------------

export const recipeItemInputSchema = z.object({
  inventoryItemId: z.uuid("Elige un insumo."),
  quantity: quantityField,
});

export type RecipeItemInput = z.output<typeof recipeItemInputSchema>;

// A recipe may be saved with zero lines - that just means it currently
// consumes nothing, not an error (a business filling one in gradually).
export const saveRecipeSchema = z.object({
  productId: z.uuid(),
  notes: optionalText(1000),
  isActive: z.enum(["true", "false"]).transform((value) => value === "true"),
  items: z
    .array(recipeItemInputSchema)
    .refine(
      (items) => new Set(items.map((item) => item.inventoryItemId)).size === items.length,
      "Cada insumo aparece una sola vez en la receta.",
    ),
});
