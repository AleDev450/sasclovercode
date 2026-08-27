import { describe, expect, it } from "vitest";
import {
  advanceOrderSchema,
  cancelOrderSchema,
  createOrderSchema,
  orderFiltersSchema,
  orderItemInputSchema,
} from "@/modules/orders/schemas";

/**
 * Phase 13 - the form contract (TEST-1305, TEST-1306).
 *
 * The property worth stating first: THERE IS NO PRICE FIELD. A line carries a
 * product and a quantity; the price is copied from the catalogue by the
 * database. These tests assert the absence, because a price field added later
 * "for convenience" is the shopping-cart vulnerability walking back in.
 */

const productId = "11111111-1111-4111-8111-111111111111";
const locationId = "22222222-2222-4222-8222-222222222222";

const line = { productId, variantId: "", quantity: "2", discount: "", notes: "" };

describe("a line carries no price (AB-1301)", () => {
  it("has no price key in the parsed output", () => {
    const result = orderItemInputSchema.parse(line);
    expect(Object.keys(result)).toEqual([
      "productId",
      "variantId",
      "quantity",
      "discount",
      "notes",
    ]);
    expect(result).not.toHaveProperty("unitPrice");
    expect(result).not.toHaveProperty("unitPriceCents");
    expect(result).not.toHaveProperty("total");
  });

  it("silently ignores a price somebody adds to the request", () => {
    const result = orderItemInputSchema.parse({ ...line, unitPriceCents: 1, total: 1 });
    expect(result).not.toHaveProperty("unitPriceCents");
  });
});

describe("quantities (TEST-1305)", () => {
  it("accepts whole and fractional amounts", () => {
    expect(orderItemInputSchema.parse({ ...line, quantity: "1" }).quantity).toBe(1);
    expect(orderItemInputSchema.parse({ ...line, quantity: "0.75" }).quantity).toBe(0.75);
  });

  it("accepts a comma, because a Peruvian keyboard produces one", () => {
    expect(orderItemInputSchema.parse({ ...line, quantity: "0,75" }).quantity).toBe(0.75);
  });

  it("refuses zero, negative and non-numeric", () => {
    for (const quantity of ["0", "-1", "dos", ""]) {
      expect(orderItemInputSchema.safeParse({ ...line, quantity }).success, quantity).toBe(false);
    }
  });

  it("refuses more than three decimals, matching numeric(10,3)", () => {
    expect(orderItemInputSchema.safeParse({ ...line, quantity: "0.7555" }).success).toBe(false);
  });

  it("refuses an absurd quantity", () => {
    expect(orderItemInputSchema.safeParse({ ...line, quantity: "100001" }).success).toBe(false);
  });
});

describe("discounts", () => {
  it("treats an empty discount as zero, not as an error", () => {
    expect(orderItemInputSchema.parse({ ...line, discount: "" }).discount).toBe(0);
  });

  it("parses money into integer cents", () => {
    expect(orderItemInputSchema.parse({ ...line, discount: "5.50" }).discount).toBe(550);
    expect(orderItemInputSchema.parse({ ...line, discount: "5,50" }).discount).toBe(550);
  });

  it("refuses a negative discount", () => {
    expect(orderItemInputSchema.safeParse({ ...line, discount: "-1" }).success).toBe(false);
  });
});

describe("creating an order", () => {
  const base = {
    locationId,
    customerId: "",
    source: "manual",
    shipping: "",
    notes: "",
    items: [line],
  };

  it("accepts an order with no customer", () => {
    const result = createOrderSchema.parse(base);
    expect(result.customerId).toBeNull();
  });

  it("refuses an order with no lines", () => {
    const result = createOrderSchema.safeParse({ ...base, items: [] });
    expect(result.success).toBe(false);
  });

  it("refuses a source outside master section 33", () => {
    expect(createOrderSchema.safeParse({ ...base, source: "telepatia" }).success).toBe(false);
  });

  it("requires a location", () => {
    expect(createOrderSchema.safeParse({ ...base, locationId: "" }).success).toBe(false);
  });
});

describe("status changes", () => {
  it("does not let `cancelled` through the advance action", () => {
    // Cancelling has its own action and its own permission. Accepting it here
    // would let `orders.update` void a sale.
    expect(
      advanceOrderSchema.safeParse({ orderId: productId, toStatus: "cancelled" }).success,
    ).toBe(false);
  });

  it("does not let `pending` through either: nothing goes back", () => {
    expect(advanceOrderSchema.safeParse({ orderId: productId, toStatus: "pending" }).success).toBe(
      false,
    );
  });

  it("requires a reason to cancel", () => {
    expect(cancelOrderSchema.safeParse({ orderId: productId, reason: "" }).success).toBe(false);
    expect(cancelOrderSchema.safeParse({ orderId: productId, reason: "  " }).success).toBe(false);
    expect(
      cancelOrderSchema.safeParse({ orderId: productId, reason: "el cliente se fue" }).success,
    ).toBe(true);
  });
});

describe("listing filters (TEST-1306)", () => {
  it("defaults to everything, page one", () => {
    expect(orderFiltersSchema.parse({})).toEqual({ status: null, locationId: null, page: 1 });
  });

  it("ignores a status that does not exist rather than failing", () => {
    expect(orderFiltersSchema.parse({ status: "inventado" }).status).toBeNull();
  });

  it("keeps a real status", () => {
    expect(orderFiltersSchema.parse({ status: "preparing" }).status).toBe("preparing");
  });

  it("ignores a location that is not a uuid", () => {
    expect(orderFiltersSchema.parse({ locationId: "../../etc/passwd" }).locationId).toBeNull();
  });

  it("survives a nonsense page", () => {
    for (const page of ["0", "-3", "abc", ""]) {
      expect(orderFiltersSchema.parse({ page }).page, page).toBe(1);
    }
  });
});
