/**
 * Validation for billing documents and provider configuration.
 *
 * No amount field anywhere here, same posture as `orders/schemas.ts`
 * toward price: `billing_document_items` is populated entirely by
 * `populate_billing_document_items()` from the order's own lines (Phase 17
 * migrations) - there is nothing for a caller to send that the database
 * would trust.
 */

import { z } from "zod";
import { BILLING_DOCUMENT_TYPES } from "./lifecycle";

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

export const billingDocumentTypeSchema = z.enum(BILLING_DOCUMENT_TYPES);

export const issueBillingDocumentSchema = z.object({
  orderId: z.uuid(),
  type: billingDocumentTypeSchema,
  customerId: optionalUuid("Cliente invalido."),
  relatedDocumentId: optionalUuid("Documento relacionado invalido."),
});

export const markSentBillingDocumentSchema = z.object({
  documentId: z.uuid(),
});

export const acceptBillingDocumentSchema = z.object({
  documentId: z.uuid(),
});

export const rejectBillingDocumentSchema = z.object({
  documentId: z.uuid(),
  reason: z.string().trim().min(1, "Escribe el motivo del rechazo.").max(500),
});

export const cancelBillingDocumentSchema = z.object({
  documentId: z.uuid(),
  reason: z.string().trim().min(1, "Escribe por que se anula.").max(500),
});

// ---------------------------------------------------------------------------
// Provider configuration
// ---------------------------------------------------------------------------

const seriesField = optionalText(20);

export const billingProviderConfigSchema = z.object({
  providerName: z.string().trim().min(1, "Elige un proveedor.").max(40),
  seriesBoleta: seriesField,
  seriesFactura: seriesField,
  seriesNotaCredito: seriesField,
  seriesNotaDebito: seriesField,
});

export const setBillingActiveSchema = z.object({
  isActive: z.enum(["true", "false"]).transform((value) => value === "true"),
});

export const setBillingCredentialsSchema = z.object({
  credentials: z.string().trim().min(1, "Ingresa las credenciales.").max(4000),
});
