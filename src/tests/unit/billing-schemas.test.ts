import { describe, expect, it } from "vitest";
import {
  acceptBillingDocumentSchema,
  billingProviderConfigSchema,
  cancelBillingDocumentSchema,
  issueBillingDocumentSchema,
  markSentBillingDocumentSchema,
  rejectBillingDocumentSchema,
  setBillingActiveSchema,
  setBillingCredentialsSchema,
} from "@/modules/billing/schemas";

/**
 * Phase 17 - the form contract.
 *
 * The property worth stating first, same posture as `payment-schemas.test.ts`
 * toward a payment's amount: nothing a trigger computes has a matching field
 * here. No `series`, `number`, `subtotalCents`, `taxCents` or `totalCents` on
 * `issueBillingDocumentSchema` - `assign_billing_document()` and
 * `populate_billing_document_items()` (Phase 17 migrations) derive every one
 * of those, and a client sending its own would simply be ignored by the
 * insert this schema feeds.
 */

const orderId = "11111111-1111-4111-8111-111111111111";
const documentId = "22222222-2222-4222-8222-222222222222";
const customerId = "33333333-3333-4333-8333-333333333333";
const relatedDocumentId = "44444444-4444-4444-8444-444444444444";

describe("issuing a document carries no computed field", () => {
  it("has exactly the fields a cashier chooses", () => {
    const result = issueBillingDocumentSchema.parse({
      orderId,
      type: "boleta",
      customerId: "",
      relatedDocumentId: "",
    });
    expect(Object.keys(result).sort()).toEqual(
      ["orderId", "type", "customerId", "relatedDocumentId"].sort(),
    );
    expect(result).not.toHaveProperty("series");
    expect(result).not.toHaveProperty("number");
    expect(result).not.toHaveProperty("subtotalCents");
    expect(result).not.toHaveProperty("taxCents");
    expect(result).not.toHaveProperty("totalCents");
    expect(result).not.toHaveProperty("issuerRuc");
  });

  it("accepts one of the four types from master section 33", () => {
    for (const type of ["boleta", "factura", "nota_credito", "nota_debito"]) {
      expect(
        issueBillingDocumentSchema.safeParse({
          orderId,
          type,
          customerId: "",
          relatedDocumentId: "",
        }).success,
        type,
      ).toBe(true);
    }
  });

  it("refuses a type outside that list", () => {
    expect(
      issueBillingDocumentSchema.safeParse({
        orderId,
        type: "recibo",
        customerId: "",
        relatedDocumentId: "",
      }).success,
    ).toBe(false);
  });

  it("treats a blank customer or related document as absent, not as an error", () => {
    const result = issueBillingDocumentSchema.parse({
      orderId,
      type: "boleta",
      customerId: "",
      relatedDocumentId: "",
    });
    expect(result.customerId).toBeNull();
    expect(result.relatedDocumentId).toBeNull();
  });

  it("accepts a real customer and related document id", () => {
    const result = issueBillingDocumentSchema.parse({
      orderId,
      type: "nota_credito",
      customerId,
      relatedDocumentId,
    });
    expect(result.customerId).toBe(customerId);
    expect(result.relatedDocumentId).toBe(relatedDocumentId);
  });

  it("refuses a customer id that is not a UUID", () => {
    expect(
      issueBillingDocumentSchema.safeParse({
        orderId,
        type: "boleta",
        customerId: "not-a-uuid",
        relatedDocumentId: "",
      }).success,
    ).toBe(false);
  });

  it("does not itself enforce factura-needs-RUC or note-needs-related-document: that lives in the database", () => {
    // A factura with no customer, or a nota_credito with no related document,
    // both PARSE fine - refusing them is billing_documents_factura_needs_ruc_customer
    // and billing_documents_notes_need_related_document's job.
    expect(
      issueBillingDocumentSchema.safeParse({
        orderId,
        type: "factura",
        customerId: "",
        relatedDocumentId: "",
      }).success,
    ).toBe(true);
  });
});

describe("advancing a document", () => {
  it("mark-sent and accept carry only the document id", () => {
    expect(markSentBillingDocumentSchema.parse({ documentId })).toEqual({ documentId });
    expect(acceptBillingDocumentSchema.parse({ documentId })).toEqual({ documentId });
  });

  it("rejecting requires a reason", () => {
    expect(rejectBillingDocumentSchema.safeParse({ documentId, reason: "" }).success).toBe(false);
    expect(rejectBillingDocumentSchema.safeParse({ documentId, reason: "   " }).success).toBe(
      false,
    );
    expect(
      rejectBillingDocumentSchema.safeParse({ documentId, reason: "RUC del cliente invalido" })
        .success,
    ).toBe(true);
  });

  it("cancelling requires a reason", () => {
    expect(cancelBillingDocumentSchema.safeParse({ documentId, reason: "" }).success).toBe(false);
    expect(
      cancelBillingDocumentSchema.safeParse({ documentId, reason: "pedido anulado" }).success,
    ).toBe(true);
  });
});

describe("provider configuration", () => {
  const baseConfig = {
    providerName: "manual",
    seriesBoleta: "",
    seriesFactura: "",
    seriesNotaCredito: "",
    seriesNotaDebito: "",
  };

  it("requires a provider name", () => {
    expect(billingProviderConfigSchema.safeParse({ ...baseConfig, providerName: "" }).success).toBe(
      false,
    );
  });

  it("treats a blank series override as absent, not as an error", () => {
    const result = billingProviderConfigSchema.parse(baseConfig);
    expect(result.seriesBoleta).toBeNull();
    expect(result.seriesFactura).toBeNull();
    expect(result.seriesNotaCredito).toBeNull();
    expect(result.seriesNotaDebito).toBeNull();
  });

  it("accepts an explicit series override", () => {
    const result = billingProviderConfigSchema.parse({ ...baseConfig, seriesBoleta: "B002" });
    expect(result.seriesBoleta).toBe("B002");
  });

  it("has no credentials field: those go through set_billing_credentials, never a plain column", () => {
    const result = billingProviderConfigSchema.parse(baseConfig);
    expect(result).not.toHaveProperty("credentials");
    expect(result).not.toHaveProperty("credentialsSecretId");
  });
});

describe("toggling active", () => {
  it("parses the string form fields send into a boolean", () => {
    expect(setBillingActiveSchema.parse({ isActive: "true" }).isActive).toBe(true);
    expect(setBillingActiveSchema.parse({ isActive: "false" }).isActive).toBe(false);
  });

  it("refuses anything other than exactly true or false", () => {
    expect(setBillingActiveSchema.safeParse({ isActive: "yes" }).success).toBe(false);
    expect(setBillingActiveSchema.safeParse({ isActive: "" }).success).toBe(false);
  });
});

describe("setting credentials", () => {
  it("requires a non-empty value", () => {
    expect(setBillingCredentialsSchema.safeParse({ credentials: "" }).success).toBe(false);
    expect(setBillingCredentialsSchema.safeParse({ credentials: "   " }).success).toBe(false);
  });

  it("accepts an opaque credential string, whatever shape the provider needs", () => {
    const result = setBillingCredentialsSchema.parse({
      credentials: JSON.stringify({ user: "x", pass: "y" }),
    });
    expect(result.credentials.length).toBeGreaterThan(0);
  });

  it("refuses a value over 4000 characters", () => {
    expect(setBillingCredentialsSchema.safeParse({ credentials: "a".repeat(4001) }).success).toBe(
      false,
    );
  });
});
