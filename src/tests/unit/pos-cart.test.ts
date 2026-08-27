import { describe, expect, it } from "vitest";
import {
  addToCart,
  cartLineKey,
  cartTotalCents,
  changeDueCents,
  lineTotalCents,
  remainingBalanceCents,
  removeFromCart,
  setCartQuantity,
  tenderedTotalCents,
  type CartLine,
} from "@/modules/pos/cart";

/**
 * Phase 15 - the cart is client-side and ephemeral (ADR-019); everything
 * here is a PREVIEW of what the database will compute once the sale is
 * actually submitted through `createOrderForPos`. These tests are about the
 * arithmetic and the reducers, not about anything ever being persisted.
 */

const maki: CartLine = {
  productId: "11111111-1111-4111-8111-111111111111",
  variantId: null,
  name: "Maki acevichado",
  variantName: null,
  unitPriceCents: 2490,
  quantity: 1,
};

const pollo: CartLine = {
  productId: "22222222-2222-4222-8222-222222222222",
  variantId: "33333333-3333-4333-8333-333333333333",
  name: "Pollo a la brasa",
  variantName: "1/4",
  unitPriceCents: 1800,
  quantity: 1,
};

describe("line and cart totals", () => {
  it("rounds unit price times quantity, matching the server's rounding rule", () => {
    expect(lineTotalCents({ unitPriceCents: 2490, quantity: 2 })).toBe(4980);
    expect(lineTotalCents({ unitPriceCents: 333, quantity: 3 })).toBe(999);
  });

  it("sums every line", () => {
    expect(cartTotalCents([maki, pollo])).toBe(2490 + 1800);
    expect(cartTotalCents([])).toBe(0);
  });
});

describe("addToCart", () => {
  it("adds a new line for a product+variant not already in the cart", () => {
    const cart = addToCart([maki], pollo);
    expect(cart).toHaveLength(2);
  });

  it("increases quantity instead of duplicating a line when tapped again", () => {
    const cart = addToCart([maki], { ...maki, quantity: 1 });
    expect(cart).toHaveLength(1);
    expect(cart[0]?.quantity).toBe(2);
  });

  it("treats the same product with a different variant as a different line", () => {
    const withVariant: CartLine = { ...pollo, variantId: "44444444-4444-4444-8444-444444444444" };
    const cart = addToCart([pollo], withVariant);
    expect(cart).toHaveLength(2);
  });
});

describe("setCartQuantity", () => {
  it("updates the quantity of the matching line", () => {
    const key = cartLineKey(maki.productId, maki.variantId);
    const cart = setCartQuantity([maki], key, 5);
    expect(cart[0]?.quantity).toBe(5);
  });

  it("removes the line when the quantity is set to zero or less", () => {
    const key = cartLineKey(maki.productId, maki.variantId);
    expect(setCartQuantity([maki, pollo], key, 0)).toEqual([pollo]);
    expect(setCartQuantity([maki, pollo], key, -1)).toEqual([pollo]);
  });
});

describe("removeFromCart", () => {
  it("removes exactly the matching line and keeps the rest", () => {
    const key = cartLineKey(maki.productId, maki.variantId);
    expect(removeFromCart([maki, pollo], key)).toEqual([pollo]);
  });
});

describe("tenders, balance and change", () => {
  const tenders = [
    { paymentMethodId: "cash", amountCents: 3000 },
    { paymentMethodId: "yape", amountCents: 1000 },
  ];

  it("sums staged tenders", () => {
    expect(tenderedTotalCents(tenders)).toBe(4000);
    expect(tenderedTotalCents([])).toBe(0);
  });

  it("computes what's left to charge, never negative", () => {
    expect(remainingBalanceCents(4290, tenders)).toBe(290);
    expect(remainingBalanceCents(4000, tenders)).toBe(0);
    expect(remainingBalanceCents(3000, tenders)).toBe(0);
  });

  it("computes change owed on a cash tender that covers more than what's left", () => {
    expect(changeDueCents(1000, 1000)).toBe(0);
    expect(changeDueCents(1000, 1500)).toBe(500);
  });

  it("never returns negative change for an insufficient cash tender", () => {
    expect(changeDueCents(1000, 700)).toBe(0);
  });
});
