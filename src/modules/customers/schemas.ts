/**
 * Validation for the customer forms.
 *
 * Mirrors the CHECK constraints of the Phase 12 migrations. The database is the
 * authority; this layer exists so a person reads "El DNI tiene 8 digitos"
 * rather than `customers_document_format`.
 *
 * The document is validated as a PAIR, not field by field, because neither half
 * means anything alone: a type with no number is a half-filled form, and a
 * number with no type is a string nobody can check.
 */

import { z } from "zod";
import { checkDocument, isDocType, normalizeDocument, normalizePhone } from "./documents";
import type { DocType } from "./documents";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Maximo ${max} caracteres.`)
    .transform((value) => (value.length === 0 ? null : value))
    .nullable();

/**
 * An email, lowercased, or null.
 *
 * Lowercased on the way in because the unique index is on `lower(email)`: if
 * this layer stored "Ana@x.pe" the row would be rejected by an index the person
 * cannot see, with a message about a duplicate they never typed.
 */
const email = z
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

const phone = z
  .string()
  .transform((value) => {
    const normalized = normalizePhone(value);
    return normalized.length === 0 ? null : normalized;
  })
  .nullable()
  .refine(
    (value) => value === null || /^\+?[0-9]{6,20}$/.test(value),
    "El telefono debe tener entre 6 y 20 digitos.",
  );

/**
 * Name, type and number, checked together.
 *
 * `superRefine` rather than three independent field rules, because the
 * interesting failures are relationships: a type without a number, and a number
 * that is only wrong once you know which document it claims to be.
 */
export const customerSchema = z
  .object({
    name: z.string().trim().min(1, "El nombre es obligatorio.").max(200),
    docType: z
      .string()
      .trim()
      .toLowerCase()
      .transform((value) => (value.length === 0 ? null : value))
      .nullable(),
    docNumber: z
      .string()
      .transform((value) => {
        const normalized = normalizeDocument(value);
        return normalized.length === 0 ? null : normalized;
      })
      .nullable(),
    email,
    phone,
  })
  .superRefine((value, ctx) => {
    const { docType, docNumber } = value;

    // No document at all is the normal case for someone paying cash.
    if (docType === null && docNumber === null) return;

    if (docType === null) {
      ctx.addIssue({
        code: "custom",
        path: ["docType"],
        message: "Elige el tipo de documento.",
      });
      return;
    }

    if (!isDocType(docType)) {
      ctx.addIssue({ code: "custom", path: ["docType"], message: "Tipo de documento invalido." });
      return;
    }

    if (docNumber === null) {
      ctx.addIssue({
        code: "custom",
        path: ["docNumber"],
        message: "Escribe el numero del documento.",
      });
      return;
    }

    const result = checkDocument(docType, docNumber);
    if (!result.ok) {
      ctx.addIssue({
        code: "custom",
        path: ["docNumber"],
        message: result.reason ?? "Documento invalido.",
      });
    }
  })
  // Narrows `docType` to the enum for everything downstream, so a Server Action
  // never has to re-check what `superRefine` already established.
  .transform((value) => ({
    ...value,
    docType: value.docType === null ? null : (value.docType as DocType),
  }));

export type CustomerInput = z.output<typeof customerSchema>;

export const customerActiveSchema = z.object({
  customerId: z.uuid(),
  isActive: z.enum(["true", "false"]).transform((value) => value === "true"),
});

export const customerAddressSchema = z.object({
  customerId: z.uuid(),
  label: z.string().trim().min(1, "Ponle un nombre: Casa, Oficina.").max(60),
  addressLine: z.string().trim().min(1, "La direccion es obligatoria.").max(300),
  district: optionalText(100),
  city: optionalText(100),
  reference: optionalText(200),
  isDefault: z.enum(["true", "false"]).transform((value) => value === "true"),
});

export const deleteAddressSchema = z.object({
  customerId: z.uuid(),
  addressId: z.uuid(),
});

/** How many customers one page of the listing shows. */
export const CUSTOMERS_PAGE_SIZE = 20;

/**
 * The listing filters, as they arrive from the URL.
 *
 * They live in the query string rather than in client state so a search can be
 * shared, survives a reload, and is read by a Server Component without any
 * JavaScript. Everything here tolerates nonsense: a URL is typed by hand.
 */
export const customerFiltersSchema = z.object({
  search: z
    .string()
    .trim()
    .max(100)
    .optional()
    .transform((value) => (value === undefined || value.length === 0 ? null : value)),
  includeInactive: z
    .string()
    .optional()
    .transform((value) => value === "1"),
  page: z
    .string()
    .optional()
    .transform((value) => {
      const parsed = Number.parseInt(value ?? "1", 10);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
    }),
});

export type CustomerFilters = z.output<typeof customerFiltersSchema>;
