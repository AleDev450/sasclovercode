/**
 * Validation for the catalogue forms.
 *
 * Mirrors the CHECK constraints in the Phase 11 migrations. The database is the
 * authority; this layer exists so a person sees "usa un importe como 24.90"
 * rather than `products_price_range`.
 *
 * Every price field goes through `parseMoney`, so a price is an integer number
 * of cents from the first moment it exists in this process. There is no point
 * at which a price is a float that later gets rounded.
 */

import { z } from "zod";
import { parseMoney } from "@/lib/money";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Maximo ${max} caracteres.`)
    .transform((value) => (value.length === 0 ? null : value))
    .nullable();

/** Lowercase, hyphenated, exactly what the CHECK accepts. */
const slug = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, "El slug es obligatorio.")
  .max(100)
  .regex(
    /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/,
    "Solo minusculas, numeros y guiones, sin empezar ni terminar en guion.",
  );

/**
 * Derives a slug from a name, so nobody has to type one.
 *
 * Accents are stripped rather than percent-encoded: `piña` becomes `pina`,
 * which is what a Peruvian business would type into a URL bar anyway and is
 * what the CHECK accepts.
 */
export function slugify(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
}

/**
 * A price typed by a human, as an integer number of cents.
 *
 * Parsed inside a `transform` with the issue context rather than through
 * `refine`, so the message `parseMoney` produced - "usa un importe como 24.90",
 * "el importe es demasiado grande" - is the message the person reads. A refine
 * could only say that the value was rejected, not why.
 */
const priceField = (label: string) =>
  z.string().transform((value, ctx) => {
    const result = parseMoney(value);

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

/** A signed price delta, which may legitimately subtract. */
const deltaField = z.string().transform((value, ctx) => {
  // An empty field means "no change", which is what an option without a price
  // difference is - not a validation failure.
  const result = parseMoney(value.trim().length === 0 ? "0" : value);

  if (!result.ok || result.cents === undefined) {
    ctx.addIssue({ code: "custom", message: result.reason ?? "Importe invalido." });
    return z.NEVER;
  }
  if (result.cents < -1000000 || result.cents > 1000000) {
    ctx.addIssue({ code: "custom", message: "El ajuste de precio esta fuera de rango." });
    return z.NEVER;
  }

  return result.cents;
});

export const categorySchema = z.object({
  name: z.string().trim().min(1, "El nombre es obligatorio.").max(120),
  slug,
  description: optionalText(500),
  position: z.coerce.number().int().min(0).max(1000).default(0),
});

export type CategoryInput = z.output<typeof categorySchema>;

export const productSchema = z.object({
  name: z.string().trim().min(1, "El nombre es obligatorio.").max(200),
  slug,
  description: optionalText(2000),
  // Empty means "no category", which is a valid answer for a shop with twelve
  // products - not a validation failure.
  categoryId: z
    .string()
    .trim()
    .transform((value) => (value.length === 0 ? null : value))
    .nullable()
    .refine((value) => value === null || z.uuid().safeParse(value).success, "Categoria invalida."),
  basePrice: priceField("El precio"),
  position: z.coerce.number().int().min(0).max(1000).default(0),
  isFeatured: z.enum(["true", "false"]).transform((value) => value === "true"),
});

export type ProductInput = z.output<typeof productSchema>;

export const productStatusSchema = z.object({
  productId: z.uuid(),
  status: z.enum(["draft", "active", "archived"]),
});

export const productAvailabilitySchema = z.object({
  productId: z.uuid(),
  isAvailable: z.enum(["true", "false"]).transform((value) => value === "true"),
});

/**
 * A storage path inside the tenant's own `products` folder.
 *
 * The shape is checked here and OWNERSHIP is checked by the database, which
 * compares the path against the row's own `tenant_id` (the Phase 06 A6-2
 * lesson). Both matter: this one gives a decent message, that one is the
 * guarantee.
 */
export const productImageSchema = z.object({
  productId: z.uuid(),
  path: z
    .string()
    .trim()
    .max(300)
    .refine(
      (value) => /^tenants\/[0-9a-f-]{36}\/products\/[A-Za-z0-9._-]+$/.test(value),
      "La ruta debe apuntar a un archivo de esta empresa.",
    ),
  altText: optionalText(200),
  isPrimary: z.enum(["true", "false"]).transform((value) => value === "true"),
});

export const productVariantSchema = z.object({
  productId: z.uuid(),
  name: z.string().trim().min(1, "El nombre es obligatorio.").max(120),
  sku: optionalText(60),
  price: priceField("El precio"),
  position: z.coerce.number().int().min(0).max(1000).default(0),
});

export const productOptionSchema = z.object({
  productId: z.uuid(),
  groupLabel: z.string().trim().min(1, "El grupo es obligatorio.").max(80),
  name: z.string().trim().min(1, "El nombre es obligatorio.").max(120),
  priceDelta: deltaField,
  position: z.coerce.number().int().min(0).max(1000).default(0),
});
