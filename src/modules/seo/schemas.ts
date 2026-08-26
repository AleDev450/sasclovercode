/**
 * Validation for the SEO forms.
 *
 * Mirrors the CHECK constraints in
 * `supabase/migrations/20260825180000_create_tenant_seo.sql` and
 * `20260825180100_add_page_seo.sql`. The database remains the authority; this
 * layer exists so an operator sees "el titulo es demasiado largo" instead of a
 * raw constraint name.
 */

import { z } from "zod";

/** Blank means "not set", which for SEO means "inherit". Never stored as "". */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Maximo ${max} caracteres.`)
    .transform((value) => (value.length === 0 ? null : value))
    .nullable();

/**
 * A storage path inside the tenant's own public folders.
 *
 * The shape is checked here and the OWNERSHIP is checked by the database: the
 * CHECK compares the path against the row's own `tenant_id`, which this layer
 * cannot do without another round trip. Both matter - this one gives a decent
 * message, that one is the guarantee.
 */
const assetPath = z
  .string()
  .trim()
  .max(300)
  .transform((value) => (value.length === 0 ? null : value))
  .nullable()
  .refine(
    (value) =>
      value === null ||
      /^tenants\/[0-9a-f-]{36}\/(branding|banners|products)\/[A-Za-z0-9._-]+$/.test(value),
    "La ruta debe apuntar a un archivo de esta empresa.",
  );

export const tenantSeoSchema = z.object({
  siteTitle: optionalText(120),
  siteDescription: optionalText(320),
  ogTitle: optionalText(120),
  ogDescription: optionalText(320),
  ogImagePath: assetPath,
  twitterImagePath: assetPath,
  // An unchecked checkbox is simply absent from the FormData, so the action
  // sends the literal "true"/"false" instead of relying on presence.
  robotsIndex: z.enum(["true", "false"]).transform((value) => value === "true"),
  googleVerification: z
    .string()
    .trim()
    .transform((value) => (value.length === 0 ? null : value))
    .nullable()
    .refine(
      (value) => value === null || /^[A-Za-z0-9_-]{10,100}$/.test(value),
      "El codigo de verificacion solo admite letras, numeros, guion y guion bajo.",
    ),
});

export type TenantSeoInput = z.output<typeof tenantSeoSchema>;

export const pageSeoSchema = z.object({
  seoTitle: optionalText(120),
  seoDescription: optionalText(320),
  ogImagePath: assetPath,
});

export type PageSeoInput = z.output<typeof pageSeoSchema>;
