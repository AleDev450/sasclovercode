import { describe, expect, it } from "vitest";
import { parseInline, parseLegalMarkup } from "@/modules/legal/markup";
import { complaintSchema } from "@/modules/legal/schemas";
import { legalTemplate, type LegalIdentity } from "@/modules/legal/templates";

const identity: LegalIdentity = {
  name: "Sugu Rolls",
  legalName: "INVERSIONES SUGU S.A.C.",
  taxId: "20608920961",
  address: "Jr. Fernandini 1195, Pueblo Libre",
  email: "hola@sugurolls.pe",
  phone: "997 516 391",
};

describe("legal markup", () => {
  it("parses headings, lists, paragraphs and bold", () => {
    const blocks = parseLegalMarkup(
      "### Pedidos\n\nPrimera linea\nsigue el parrafo.\n\n- uno **dos**\n- tres\n\nFin",
    );

    expect(blocks.map((block) => block.kind)).toEqual([
      "heading",
      "paragraph",
      "list",
      "paragraph",
    ]);
    expect(blocks[1]).toEqual({
      kind: "paragraph",
      parts: [{ text: "Primera linea sigue el parrafo.", bold: false }],
    });
    expect(blocks[2]).toEqual({
      kind: "list",
      items: [
        [
          { text: "uno ", bold: false },
          { text: "dos", bold: true },
        ],
        [{ text: "tres", bold: false }],
      ],
    });
  });

  it("never turns markup into anything but text", () => {
    const blocks = parseLegalMarkup('<script>alert("x")</script>\n\n<img src=x onerror=alert(1)>');
    const text = blocks
      .flatMap((block) => (block.kind === "list" ? [] : block.parts))
      .map((part) => part.text);
    expect(text).toEqual(['<script>alert("x")</script>', "<img src=x onerror=alert(1)>"]);
  });

  it("leaves an unclosed ** as literal asterisks", () => {
    expect(parseInline("precio **sin cerrar")).toEqual([
      { text: "precio **sin cerrar", bold: false },
    ]);
  });
});

describe("legal templates", () => {
  it("names the business, its RUC and the law, in every document", () => {
    for (const kind of ["terms", "privacy", "cookies"] as const) {
      const body = legalTemplate(kind, identity);
      expect(body).toContain("INVERSIONES SUGU S.A.C.");
      expect(body).toContain("20608920961");
      expect(parseLegalMarkup(body).some((block) => block.kind === "heading")).toBe(true);
    }
    expect(legalTemplate("privacy", identity)).toContain("Ley 29733");
    expect(legalTemplate("terms", identity)).toContain("15 días hábiles");
  });

  it("does not print empty placeholders when the business has no legal data yet", () => {
    const bare = legalTemplate("terms", {
      ...identity,
      legalName: null,
      taxId: null,
      address: null,
    });
    expect(bare).toContain("**Sugu Rolls**");
    expect(bare).not.toContain("null");
    expect(bare).not.toContain("RUC");
  });
});

describe("complaint schema", () => {
  const valid = {
    consumerName: "Rosa Quispe",
    consumerAddress: "Av. Brasil 123",
    documentType: "DNI",
    documentNumber: "4567 8901",
    consumerEmail: "rosa@correo.pe",
    consumerPhone: "999 888 777",
    isMinor: false,
    itemType: "producto",
    amountCents: null,
    itemDescription: "Makis",
    incidentDate: "",
    type: "reclamo",
    detail: "Llego frio.",
    consumerRequest: "Devolucion.",
    responseChannel: "email",
    acceptedDeclaration: true,
  };

  it("accepts a complete sheet and normalises the document number", () => {
    const parsed = complaintSchema.safeParse(valid);
    expect(parsed.success).toBe(true);
    expect(parsed.data?.documentNumber).toBe("45678901");
  });

  it("requires a guardian for a minor and the declaration always", () => {
    expect(complaintSchema.safeParse({ ...valid, isMinor: true }).success).toBe(false);
    expect(complaintSchema.safeParse({ ...valid, acceptedDeclaration: false }).success).toBe(false);
  });
});
