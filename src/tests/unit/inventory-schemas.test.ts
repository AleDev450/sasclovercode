import { describe, expect, it } from "vitest";
import {
  createInventoryItemSchema,
  createSupplierSchema,
  createUnitSchema,
  recordPurchaseSchema,
  recordStockMovementSchema,
  recordStockTransferSchema,
  saveRecipeSchema,
  setUnitActiveSchema,
} from "@/modules/inventory/schemas";

/**
 * Phase 18 - the form contract.
 *
 * The property worth stating first, same posture as `payment-schemas.test.ts`
 * toward `orders/paid_cents`: nothing a trigger computes has a matching
 * field here. No `totalCostCents` on `recordPurchaseSchema`, no
 * `quantityOnHand` anywhere - `purchases.total_cost_cents` and
 * `inventory_stock_levels` are exactly what ADR-022 derives, and a field
 * for either here would be a second place it could disagree with the
 * ledger.
 */

const unitId = "11111111-1111-4111-8111-111111111111";
const supplierId = "22222222-2222-4222-8222-222222222222";
const locationA = "33333333-3333-4333-8333-333333333333";
const locationB = "44444444-4444-4444-8444-444444444444";
const itemId = "55555555-5555-4555-8555-555555555555";
const productId = "66666666-6666-4666-8666-666666666666";

describe("units", () => {
  it("requires both a name and an abbreviation", () => {
    expect(createUnitSchema.safeParse({ name: "", abbreviation: "kg" }).success).toBe(false);
    expect(createUnitSchema.safeParse({ name: "Kilogramo", abbreviation: "" }).success).toBe(false);
    expect(createUnitSchema.safeParse({ name: "Kilogramo", abbreviation: "kg" }).success).toBe(true);
  });

  it("parses the active toggle from its string form", () => {
    expect(setUnitActiveSchema.parse({ unitId, isActive: "true" }).isActive).toBe(true);
    expect(setUnitActiveSchema.parse({ unitId, isActive: "false" }).isActive).toBe(false);
  });
});

describe("inventory items carry no computed field", () => {
  it("has exactly the fields a person fills in", () => {
    const result = createInventoryItemSchema.parse({ unitId, name: "Salmon", sku: "" });
    expect(Object.keys(result).sort()).toEqual(["unitId", "name", "sku"].sort());
    expect(result).not.toHaveProperty("isActive");
  });

  it("treats a blank sku as absent, not as an error", () => {
    const result = createInventoryItemSchema.parse({ unitId, name: "Salmon", sku: "" });
    expect(result.sku).toBeNull();
  });

  it("requires a name", () => {
    expect(createInventoryItemSchema.safeParse({ unitId, name: "", sku: "" }).success).toBe(false);
  });
});

describe("suppliers", () => {
  const base = {
    name: "Distribuidora Marina",
    taxId: "",
    contactName: "",
    phone: "",
    email: "",
    address: "",
    notes: "",
  };

  it("accepts a supplier with no RUC at all - an informal vendor is valid", () => {
    expect(createSupplierSchema.safeParse(base).success).toBe(true);
  });

  it("refuses a RUC that is not exactly 11 digits", () => {
    expect(createSupplierSchema.safeParse({ ...base, taxId: "123" }).success).toBe(false);
    expect(createSupplierSchema.safeParse({ ...base, taxId: "20131312955" }).success).toBe(true);
  });

  it("refuses a malformed email or phone, accepts blank", () => {
    expect(createSupplierSchema.safeParse({ ...base, email: "not-an-email" }).success).toBe(false);
    expect(createSupplierSchema.safeParse({ ...base, phone: "abc" }).success).toBe(false);
    expect(createSupplierSchema.safeParse(base).success).toBe(true);
  });
});

describe("recording a purchase carries no computed field", () => {
  const baseLine = { inventoryItemId: itemId, quantity: "10", unitCost: "5.50" };

  it("has exactly the fields a person fills in - no totalCostCents", () => {
    const result = recordPurchaseSchema.parse({
      supplierId,
      locationId: locationA,
      reference: "",
      notes: "",
      lines: [baseLine],
    });
    expect(Object.keys(result).sort()).toEqual(
      ["supplierId", "locationId", "reference", "notes", "lines"].sort(),
    );
    expect(result).not.toHaveProperty("totalCostCents");
  });

  it("requires at least one line", () => {
    expect(
      recordPurchaseSchema.safeParse({
        supplierId,
        locationId: locationA,
        reference: "",
        notes: "",
        lines: [],
      }).success,
    ).toBe(false);
  });

  it("parses a line's quantity and unit cost", () => {
    const result = recordPurchaseSchema.parse({
      supplierId,
      locationId: locationA,
      reference: "",
      notes: "",
      lines: [baseLine],
    });
    expect(result.lines[0]).toEqual({ inventoryItemId: itemId, quantity: 10, unitCost: 550 });
  });

  it("accepts a zero unit cost - a free sample received", () => {
    expect(
      recordPurchaseSchema.safeParse({
        supplierId,
        locationId: locationA,
        reference: "",
        notes: "",
        lines: [{ ...baseLine, unitCost: "0" }],
      }).success,
    ).toBe(true);
  });

  it("refuses a zero or negative quantity", () => {
    expect(
      recordPurchaseSchema.safeParse({
        supplierId,
        locationId: locationA,
        reference: "",
        notes: "",
        lines: [{ ...baseLine, quantity: "0" }],
      }).success,
    ).toBe(false);
  });
});

describe("a manual stock movement", () => {
  const base = { inventoryItemId: itemId, locationId: locationA, reason: "conteo fisico" };

  it("accepts a leading minus sign for an adjustment", () => {
    const result = recordStockMovementSchema.parse({ ...base, type: "adjustment", quantity: "-3.5" });
    expect(result.quantity).toBe(-3.5);
  });

  it("accepts a positive quantity for a return", () => {
    const result = recordStockMovementSchema.parse({ ...base, type: "return", quantity: "2" });
    expect(result.quantity).toBe(2);
  });

  it("does not itself fix waste's sign: that lives in the Server Action", () => {
    // Mirrors payment-schemas.test.ts's note on recordCashMovementSchema:
    // the schema parses whatever sign was typed; recordStockMovementAction
    // is what forces `waste` negative regardless, so this PARSES fine.
    const result = recordStockMovementSchema.parse({ ...base, type: "waste", quantity: "5" });
    expect(result.quantity).toBe(5);
  });

  it("refuses a zero quantity: a movement that moves nothing is not a movement", () => {
    expect(
      recordStockMovementSchema.safeParse({ ...base, type: "adjustment", quantity: "0" }).success,
    ).toBe(false);
  });

  it("refuses `purchase`, `sale` and `transfer`: those go through their own actions", () => {
    for (const type of ["purchase", "sale", "transfer"]) {
      expect(
        recordStockMovementSchema.safeParse({ ...base, type, quantity: "1" }).success,
        type,
      ).toBe(false);
    }
  });

  it("requires a reason", () => {
    expect(
      recordStockMovementSchema.safeParse({ ...base, type: "adjustment", quantity: "1", reason: "" })
        .success,
    ).toBe(false);
  });
});

describe("a transfer", () => {
  const base = { inventoryItemId: itemId, quantity: "5", reason: "" };

  it("requires two distinct locations", () => {
    expect(
      recordStockTransferSchema.safeParse({ ...base, fromLocationId: locationA, toLocationId: locationA })
        .success,
    ).toBe(false);
    expect(
      recordStockTransferSchema.safeParse({ ...base, fromLocationId: locationA, toLocationId: locationB })
        .success,
    ).toBe(true);
  });

  it("requires a positive quantity - the sign is not typed, the two locations imply direction", () => {
    expect(
      recordStockTransferSchema.safeParse({
        inventoryItemId: itemId,
        fromLocationId: locationA,
        toLocationId: locationB,
        quantity: "-5",
        reason: "",
      }).success,
    ).toBe(false);
  });
});

describe("recipes", () => {
  it("accepts zero ingredient lines - a recipe filled in gradually", () => {
    const result = saveRecipeSchema.parse({
      productId,
      notes: "",
      isActive: "true",
      items: [],
    });
    expect(result.items).toEqual([]);
  });

  it("refuses the same inventory item twice in one submission", () => {
    expect(
      saveRecipeSchema.safeParse({
        productId,
        notes: "",
        isActive: "true",
        items: [
          { inventoryItemId: itemId, quantity: "1" },
          { inventoryItemId: itemId, quantity: "2" },
        ],
      }).success,
    ).toBe(false);
  });

  it("parses each line's quantity", () => {
    const result = saveRecipeSchema.parse({
      productId,
      notes: "",
      isActive: "true",
      items: [{ inventoryItemId: itemId, quantity: "0.75" }],
    });
    expect(result.items[0]).toEqual({ inventoryItemId: itemId, quantity: 0.75 });
  });
});
