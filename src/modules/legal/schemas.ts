/**
 * Validation for the Libro de Reclamaciones form and the policy editor.
 *
 * Mirrors the CHECK constraints of `complaints` and `tenant_legal_documents`.
 * The database decides; this layer turns a refusal into a sentence next to the
 * field that caused it. Public-facing messages carry accents.
 */

import { z } from "zod";

export const DOCUMENT_TYPES = ["DNI", "CE", "PASAPORTE", "RUC"] as const;

const required = (max: number, message: string) => z.string().trim().min(1, message).max(max);

export const complaintSchema = z
  .object({
    consumerName: required(200, "Escribe tu nombre completo."),
    consumerAddress: required(300, "Escribe tu domicilio."),
    documentType: z.enum(DOCUMENT_TYPES),
    documentNumber: z
      .string()
      .trim()
      .transform((value) => value.replace(/\s/g, "").toUpperCase())
      .pipe(z.string().min(4, "Escribe tu número de documento.").max(20)),
    consumerEmail: z.email("Escribe un correo válido.").max(200),
    consumerPhone: z
      .string()
      .trim()
      .max(30)
      .refine(
        (value) => /^\+?[0-9]{6,20}$/.test(value.replace(/[\s().-]/g, "")),
        "Escribe un teléfono válido.",
      ),
    isMinor: z.boolean(),
    guardianName: z.string().trim().max(200).optional(),
    itemType: z.enum(["producto", "servicio"]),
    amountCents: z.number().int().min(0).max(10_000_000_000).nullable(),
    itemDescription: required(1000, "Describe el producto o servicio."),
    orderReference: z.string().trim().max(60).optional(),
    incidentDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional()
      .or(z.literal("")),
    type: z.enum(["reclamo", "queja"]),
    detail: required(3000, "Cuéntanos qué pasó."),
    consumerRequest: required(2000, "Indica qué solicitas."),
    responseChannel: z.enum(["email", "address"]),
    acceptedDeclaration: z.literal(true, {
      error: "Confirma que la información es verdadera.",
    }),
  })
  .refine((value) => !value.isMinor || (value.guardianName ?? "").length > 0, {
    message: "Escribe el nombre del padre, madre o apoderado.",
    path: ["guardianName"],
  });

export type ComplaintInput = z.output<typeof complaintSchema>;

export const legalDocumentSchema = z.object({
  kind: z.enum(["terms", "privacy", "cookies"]),
  body: z
    .string()
    .trim()
    .min(1, "El texto no puede quedar vacio.")
    .max(30000, "Maximo 30000 caracteres."),
});

export const complaintAnswerSchema = z.object({
  complaintId: z.uuid(),
  response: z.string().trim().max(5000, "Maximo 5000 caracteres."),
});
