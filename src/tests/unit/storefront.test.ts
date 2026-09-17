import { describe, expect, it } from "vitest";
import { SECTION_SCHEMAS } from "@/modules/cms/sections";
import { SECTION_TEMPLATES } from "@/modules/cms/section-meta";
import {
  addLine,
  cartCount,
  cartSubtotal,
  lineKey,
  MAX_LINE_QUANTITY,
  parseStoredCart,
  priceLines,
  removeLine,
  setLineQuantity,
  type PricingProduct,
} from "@/modules/storefront/cart";
import {
  GENERIC_WEB_ORDER_ERROR,
  WEB_ORDER_ERRORS,
  webOrderErrorMessage,
} from "@/modules/storefront/errors";
import { planHomeUpgrade } from "@/modules/storefront/home-upgrade";
import { summarizeWeek } from "@/modules/storefront/hours";
import { checkoutSchema, storefrontSettingsSchema } from "@/modules/storefront/schemas";
import { orderWhatsappMessage, whatsappDigits, whatsappUrl } from "@/modules/storefront/whatsapp";

const MAKI = "11111111-1111-4111-8111-111111111111";
const BOWL = "22222222-2222-4222-8222-222222222222";
const BIG = "33333333-3333-4333-8333-333333333333";
const SAUCE = "44444444-4444-4444-8444-444444444444";
const AVOCADO = "55555555-5555-4555-8555-555555555555";

function line(overrides: Partial<Parameters<typeof addLine>[1]> = {}) {
  return {
    productId: MAKI,
    variantId: null,
    optionIds: [],
    name: "Maki acevichado",
    detail: "",
    unitPriceCents: 2500,
    ...overrides,
  };
}

describe("cart", () => {
  it("merges the same product with the same extras, in any order", () => {
    let lines = addLine([], line({ optionIds: [SAUCE, AVOCADO] }));
    lines = addLine(lines, line({ optionIds: [AVOCADO, SAUCE], quantity: 2 }));

    expect(lines).toHaveLength(1);
    expect(lines[0]!.quantity).toBe(3);
    expect(lines[0]!.key).toBe(lineKey(MAKI, null, [SAUCE, AVOCADO]));
  });

  it("keeps different extras as different lines", () => {
    let lines = addLine([], line({ optionIds: [SAUCE] }));
    lines = addLine(lines, line({ optionIds: [AVOCADO] }));
    expect(lines).toHaveLength(2);
  });

  it("clamps quantities and removes a line set to zero", () => {
    let lines = addLine([], line({ quantity: 500 }));
    expect(lines[0]!.quantity).toBe(MAX_LINE_QUANTITY);

    lines = setLineQuantity(lines, lines[0]!.key, 0);
    expect(lines).toEqual([]);
  });

  it("counts and adds up", () => {
    let lines = addLine([], line({ quantity: 2 }));
    lines = addLine(lines, line({ productId: BOWL, unitPriceCents: 3200 }));
    expect(cartCount(lines)).toBe(3);
    expect(cartSubtotal(lines)).toBe(2 * 2500 + 3200);
    expect(removeLine(lines, lines[0]!.key)).toHaveLength(1);
  });

  it("survives whatever is in storage", () => {
    expect(parseStoredCart(null)).toEqual([]);
    expect(parseStoredCart("{not json")).toEqual([]);
    expect(parseStoredCart(JSON.stringify({ productId: MAKI }))).toEqual([]);

    const restored = parseStoredCart(
      JSON.stringify([
        { productId: MAKI, quantity: 2, name: "Maki", unitPriceCents: 2500, optionIds: [SAUCE, 7] },
        { productId: "not-a-uuid", quantity: 1 },
        null,
        { productId: BOWL, variantId: "nope", quantity: -4, unitPriceCents: "free" },
      ]),
    );

    expect(restored).toHaveLength(2);
    expect(restored[0]!.optionIds).toEqual([SAUCE]);
    expect(restored[1]!).toMatchObject({ variantId: null, quantity: 1, unitPriceCents: 0 });
  });
});

describe("re-pricing against the live menu", () => {
  const menu: PricingProduct[] = [
    {
      id: MAKI,
      name: "Maki acevichado",
      basePriceCents: 2500,
      isAvailable: true,
      variants: [],
      options: [
        { id: SAUCE, groupLabel: "Salsa", name: "Acevichada", priceDeltaCents: 0 },
        { id: AVOCADO, groupLabel: "Extras", name: "Palta", priceDeltaCents: 300 },
      ],
    },
    {
      id: BOWL,
      name: "Poke bowl",
      basePriceCents: 0,
      isAvailable: true,
      variants: [{ id: BIG, name: "Grande", priceCents: 3900 }],
      options: [],
    },
  ];

  it("prices like snapshot_order_item: variant or base, plus every extra", () => {
    const priced = priceLines(
      [
        // The stored label says 1 cent. The label is not the price.
        ...addLine([], line({ optionIds: [AVOCADO], unitPriceCents: 1, quantity: 2 })),
        ...addLine([], line({ productId: BOWL, variantId: BIG, unitPriceCents: 1 })),
      ],
      menu,
    );

    expect(priced.map((entry) => [entry.available, entry.lineTotalCents])).toEqual([
      [true, 2 * 2800],
      [true, 3900],
    ]);
  });

  it("marks a line unavailable instead of guessing its price", () => {
    const priced = priceLines(
      [
        ...addLine([], line({ productId: BOWL })), // has variants, line has none
        ...addLine([], line({ optionIds: ["66666666-6666-4666-8666-666666666666"] })),
        ...addLine([], line({ productId: "77777777-7777-4777-8777-777777777777" })),
      ],
      menu,
    );
    expect(priced.every((entry) => !entry.available && entry.lineTotalCents === 0)).toBe(true);
  });
});

describe("whatsapp", () => {
  it("adds Peru's country code to a bare mobile number", () => {
    expect(whatsappDigits("997 516 391")).toBe("51997516391");
    expect(whatsappDigits("+51 997-516-391")).toBe("51997516391");
    expect(whatsappDigits("123")).toBeNull();
    expect(whatsappDigits(null)).toBeNull();
  });

  it("encodes the message", () => {
    expect(whatsappUrl("997516391", "Hola & chau")).toBe(
      "https://wa.me/51997516391?text=Hola%20%26%20chau",
    );
    expect(whatsappUrl(null, "Hola")).toBeNull();
  });

  it("writes an order the owner can read at a glance", () => {
    const message = orderWhatsappMessage({
      businessName: "Sugu Rolls",
      orderNumber: 42,
      contactName: "Rosa",
      items: [{ name: "Maki", detail: "Salsa: Acevichada", quantity: 2, total: "S/ 50.00" }],
      total: "S/ 57.00",
      fulfillment: "delivery",
      zoneName: "Pueblo Libre",
      paymentMethod: "Yape",
      trackingUrl: "https://sugurolls.com/sitio/pedido/abc",
    });

    expect(message).toContain("*#42*");
    expect(message).toContain("2 x Maki");
    expect(message).toContain("Delivery a Pueblo Libre");
    expect(message).toContain("*Pago:* Yape");
  });
});

describe("error messages", () => {
  it("translates every code the database raises, and nothing else", () => {
    for (const code of Object.keys(WEB_ORDER_ERRORS)) {
      expect(webOrderErrorMessage(code)).not.toBe(GENERIC_WEB_ORDER_ERROR);
    }
    expect(webOrderErrorMessage('duplicate key value violates "orders_pkey"')).toBe(
      GENERIC_WEB_ORDER_ERROR,
    );
    expect(webOrderErrorMessage("toString")).toBe(GENERIC_WEB_ORDER_ERROR);
  });
});

describe("opening hours summary", () => {
  it("folds identical consecutive days", () => {
    const shifts = [1, 2, 3, 4, 5].map((day) => ({
      dayOfWeek: day,
      opensAt: "12:00:00",
      closesAt: "22:00:00",
    }));
    shifts.push({ dayOfWeek: 6, opensAt: "12:00:00", closesAt: "23:00:00" });

    expect(summarizeWeek(shifts)).toEqual([
      { days: "Lunes a viernes", hours: "12:00 - 22:00" },
      { days: "Sábado", hours: "12:00 - 23:00" },
      { days: "Domingo", hours: "Cerrado" },
    ]);
  });

  it("says every day when every day is the same, and nothing when unknown", () => {
    const shifts = [0, 1, 2, 3, 4, 5, 6].map((day) => ({
      dayOfWeek: day,
      opensAt: "12:00:00",
      closesAt: "24:00:00",
    }));
    expect(summarizeWeek(shifts)).toEqual([{ days: "Todos los días", hours: "12:00 - 24:00" }]);
    expect(summarizeWeek([])).toEqual([]);
  });
});

describe("schemas", () => {
  it("accepts every new section template as valid content", () => {
    for (const type of ["slider", "shortcuts", "bestsellers"] as const) {
      expect(SECTION_SCHEMAS[type].safeParse(SECTION_TEMPLATES[type]).success).toBe(true);
    }
  });

  it("refuses a slide without its desktop photograph and a javascript: link", () => {
    expect(SECTION_SCHEMAS.slider.safeParse({ slides: [{ heading: "Hola" }] }).success).toBe(false);
    expect(
      SECTION_SCHEMAS.shortcuts.safeParse({
        cards: [{ title: "Carta", href: "javascript:alert(1)" }],
      }).success,
    ).toBe(false);
  });

  it("requires delivery details only for delivery, and the terms always", () => {
    const base = {
      contact: { name: "Rosa", phone: "999 888 777" },
      fulfillment: "pickup",
      paymentMethodId: null,
      acceptedTerms: true,
      items: [{ productId: MAKI, variantId: null, optionIds: [], quantity: 1 }],
    };
    expect(checkoutSchema.safeParse(base).success).toBe(true);
    expect(checkoutSchema.safeParse({ ...base, fulfillment: "delivery" }).success).toBe(false);
    expect(checkoutSchema.safeParse({ ...base, acceptedTerms: false }).success).toBe(false);
  });

  it("parses the settings form, money included", () => {
    const parsed = storefrontSettingsSchema.safeParse({
      orderingEnabled: "on",
      mode: "auto",
      closedMessage: "",
      acceptsDelivery: "on",
      acceptsPickup: "",
      minOrder: "30,50",
      orderLocationId: "",
      whatsappButton: "on",
      whatsappMessage: "",
      tagline: "Makis que te hacen feliz",
      publicEmail: "",
      bestsellersDays: "30",
    });
    expect(parsed.success).toBe(true);
    expect(parsed.data).toMatchObject({
      minOrder: 3050,
      acceptsPickup: false,
      closedMessage: null,
    });

    const neither = storefrontSettingsSchema.safeParse({
      ...parsed.data,
      orderingEnabled: "on",
      acceptsDelivery: "",
      acceptsPickup: "",
      minOrder: "0",
      orderLocationId: "",
      closedMessage: "",
      whatsappButton: "",
      whatsappMessage: "",
      tagline: "",
      publicEmail: "",
      bestsellersDays: "30",
    });
    expect(neither.success).toBe(false);
  });
});

describe("upgrading an existing home page", () => {
  const section = (id: string, type: string, position: number, isVisible = true) => ({
    id,
    type,
    position,
    isVisible,
  });

  it("puts the structure on top, moves everything down and hides what it replaces", () => {
    const plan = planHomeUpgrade([
      section("hero", "hero", 0),
      section("banner", "banner", 1),
      section("carta", "products", 2),
      section("nosotros", "text", 3),
      section("oculta", "products", 4, false),
    ]);

    expect(plan.alreadyApplied).toBe(false);
    expect(plan.insert).toEqual([
      { type: "slider", position: 0 },
      { type: "shortcuts", position: 1 },
      { type: "bestsellers", position: 2 },
    ]);
    expect(plan.move).toEqual([
      { id: "hero", position: 3 },
      { id: "banner", position: 4 },
      { id: "carta", position: 5 },
      { id: "nosotros", position: 6 },
      { id: "oculta", position: 7 },
    ]);
    // Hidden, never deleted; an already hidden section is left as it was.
    expect(plan.hide).toEqual(["hero", "carta"]);
  });

  it("creates the three on an empty page and does nothing to a page that has them", () => {
    expect(planHomeUpgrade([]).insert).toHaveLength(3);
    expect(planHomeUpgrade([section("s", "slider", 0), section("t", "text", 1)])).toEqual({
      alreadyApplied: true,
      insert: [],
      move: [],
      hide: [],
    });
  });
});
