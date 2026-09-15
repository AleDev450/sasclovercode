/**
 * Validation for business settings and theme.
 *
 * Mirrors the CHECK constraints in
 * `supabase/migrations/20260825160000_create_tenant_settings.sql`. The database
 * is the authority; this layer exists so an operator gets a field-level message
 * instead of a raw constraint violation.
 */

import { z } from "zod";

/** Blank inputs arrive as "" from a form; they mean "not set", not "empty". */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value.length === 0 ? null : value))
    .nullable();

/** True when the runtime knows the zone. A CHECK cannot consult the tz table. */
export function isKnownTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export const businessSettingsSchema = z.object({
  legalName: optionalText(200),
  tradeName: optionalText(200),
  taxId: z
    .string()
    .trim()
    .transform((value) => (value.length === 0 ? null : value))
    .nullable()
    .refine(
      (value) => value === null || /^[0-9]{11}$/.test(value),
      "El RUC debe tener 11 digitos.",
    ),
  contactEmail: z
    .string()
    .trim()
    .transform((value) => (value.length === 0 ? null : value))
    .nullable()
    .refine((value) => value === null || z.email().safeParse(value).success, "Correo invalido."),
  phone: optionalText(30),
  whatsapp: optionalText(30),
  addressLine: optionalText(300),
  district: optionalText(100),
  city: optionalText(100),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, "Usa un codigo ISO de 3 letras, por ejemplo PEN."),
  timezone: z.string().trim().refine(isKnownTimezone, "Zona horaria desconocida."),
});

export type BusinessSettingsInput = z.output<typeof businessSettingsSchema>;

/** Lowercase 6-digit hex, exactly what the CHECK accepts. */
const hexColor = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^#[0-9a-f]{6}$/, "Usa un color hexadecimal, por ejemplo #16a34a.");

/**
 * The body faces a business may choose, and the three it may no longer.
 *
 * `poppins`, `lora` and `roboto` are still accepted by the CHECK - rows written
 * before the theme rework hold them and have to stay writable - but they are
 * deliberately absent here, because none of the three is self-hosted and
 * offering a face that silently resolves to something else is what this rework
 * exists to stop. A row already holding one keeps rendering; nothing can choose
 * one again.
 */
export const THEME_FONTS = [
  "system",
  "inter",
  "jost",
  "dm-sans",
  "cormorant",
  "playfair",
  "fraunces",
] as const;

/** Mirrors `tenant_themes_style_allowed` and the keys of `SITE_STYLES`. */
export const THEME_STYLES = ["atelier", "brasa", "marea"] as const;

export const themeSchema = z.object({
  primaryColor: hexColor,
  accentColor: hexColor,
  backgroundColor: hexColor,
  fontFamily: z.enum(THEME_FONTS),
  borderRadius: z.enum(["none", "sm", "md", "lg", "full"]),
  style: z.enum(THEME_STYLES),
});

export type ThemeInput = z.output<typeof themeSchema>;

export const socialLinkSchema = z.object({
  platform: z.enum(["facebook", "instagram", "tiktok", "x", "youtube", "linkedin"]),
  url: z
    .string()
    .trim()
    .max(300)
    .refine((value) => value.startsWith("https://"), "El enlace debe empezar con https://")
    .refine((value) => z.url().safeParse(value).success, "Enlace invalido."),
  position: z.coerce.number().int().min(0).max(100).default(0),
});
