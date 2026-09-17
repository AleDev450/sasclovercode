/**
 * The website cart, as pure data.
 *
 * No React and no storage here: the provider that persists it is a thin shell
 * around these functions, and these are what the unit tests exercise.
 *
 * WHAT A LINE STORES, AND WHAT IT DOES NOT. Ids and a quantity - which is all the
 * server accepts (ADR-033) - plus the name and price the visitor SAW when they
 * added it, for drawing the drawer without a round trip. That price is a label,
 * never an input: the checkout re-prices every line from the live catalogue
 * before showing a total, and the database prices it again when the order is
 * placed. A stale price in somebody's localStorage can make the drawer wrong
 * for a moment; it cannot make an order cheaper.
 *
 * No image URL either. Storage URLs are signed and expire within the hour, and a
 * cart can sit in a browser for days.
 */

export const MAX_CART_LINES = 50;
export const MAX_LINE_QUANTITY = 99;

export interface CartLine {
  /** Identity of the line: the same product with other extras is another line. */
  readonly key: string;
  readonly productId: string;
  readonly variantId: string | null;
  readonly optionIds: readonly string[];
  readonly quantity: number;
  readonly name: string;
  /** "Por 10 · Salsa: Acevichada", for the drawer. */
  readonly detail: string;
  /** What the visitor saw. A label, re-priced before anything is charged. */
  readonly unitPriceCents: number;
}

export type NewCartLine = Omit<CartLine, "key" | "quantity"> & { readonly quantity?: number };

/** Two lines are the same line when product, variant and the SET of extras match. */
export function lineKey(
  productId: string,
  variantId: string | null,
  optionIds: readonly string[],
): string {
  return `${productId}|${variantId ?? ""}|${[...new Set(optionIds)].sort().join(",")}`;
}

function clampQuantity(quantity: number): number {
  if (!Number.isFinite(quantity)) return 1;
  return Math.min(MAX_LINE_QUANTITY, Math.max(1, Math.trunc(quantity)));
}

/** Adds a line, merging it into an identical one instead of duplicating it. */
export function addLine(lines: readonly CartLine[], input: NewCartLine): CartLine[] {
  const optionIds = [...new Set(input.optionIds)].sort();
  const key = lineKey(input.productId, input.variantId, optionIds);
  const quantity = clampQuantity(input.quantity ?? 1);

  const existing = lines.find((line) => line.key === key);
  if (existing !== undefined) {
    return lines.map((line) =>
      line.key === key
        ? {
            ...line,
            quantity: clampQuantity(line.quantity + quantity),
            // The newest label wins: it is the one the visitor just looked at.
            name: input.name,
            detail: input.detail,
            unitPriceCents: input.unitPriceCents,
          }
        : line,
    );
  }

  if (lines.length >= MAX_CART_LINES) return [...lines];

  return [...lines, { ...input, optionIds, key, quantity }];
}

/** Sets a quantity. Zero or less removes the line. */
export function setLineQuantity(
  lines: readonly CartLine[],
  key: string,
  quantity: number,
): CartLine[] {
  if (quantity <= 0) return removeLine(lines, key);
  return lines.map((line) =>
    line.key === key ? { ...line, quantity: clampQuantity(quantity) } : line,
  );
}

export function removeLine(lines: readonly CartLine[], key: string): CartLine[] {
  return lines.filter((line) => line.key !== key);
}

export function cartCount(lines: readonly CartLine[]): number {
  return lines.reduce((total, line) => total + line.quantity, 0);
}

export function cartSubtotal(lines: readonly CartLine[]): number {
  return lines.reduce((total, line) => total + line.unitPriceCents * line.quantity, 0);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Reads a cart back from storage, dropping anything that is not a line.
 *
 * Storage is written by this code, but it is also editable by anyone with dev
 * tools and by older versions of this code. A malformed entry is skipped rather
 * than breaking the page - the cart is a convenience, and losing one line of it
 * is better than a website that crashes for one visitor forever.
 */
export function parseStoredCart(raw: string | null): CartLine[] {
  if (raw === null) return [];

  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];

  let lines: CartLine[] = [];
  for (const entry of data.slice(0, MAX_CART_LINES)) {
    if (typeof entry !== "object" || entry === null) continue;
    const value = entry as Record<string, unknown>;

    if (typeof value.productId !== "string" || !UUID.test(value.productId)) continue;
    const variantId =
      typeof value.variantId === "string" && UUID.test(value.variantId) ? value.variantId : null;
    const optionIds = Array.isArray(value.optionIds)
      ? value.optionIds.filter((id): id is string => typeof id === "string" && UUID.test(id))
      : [];

    lines = addLine(lines, {
      productId: value.productId,
      variantId,
      optionIds,
      quantity: typeof value.quantity === "number" ? value.quantity : 1,
      name: typeof value.name === "string" ? value.name.slice(0, 200) : "Producto",
      detail: typeof value.detail === "string" ? value.detail.slice(0, 300) : "",
      unitPriceCents:
        typeof value.unitPriceCents === "number" && Number.isFinite(value.unitPriceCents)
          ? Math.max(0, Math.trunc(value.unitPriceCents))
          : 0,
    });
  }
  return lines;
}

/* -------------------------------------------------------------------------- */
/*  Re-pricing against the live menu                                           */
/* -------------------------------------------------------------------------- */

/** The slice of the public menu the checkout needs to price a line. */
export interface PricingProduct {
  readonly id: string;
  readonly name: string;
  readonly basePriceCents: number;
  readonly isAvailable: boolean;
  readonly variants: readonly { id: string; name: string; priceCents: number }[];
  readonly options: readonly {
    id: string;
    groupLabel: string;
    name: string;
    priceDeltaCents: number;
  }[];
}

export interface PricedLine extends CartLine {
  /** False when the product, variant or an extra is gone or sold out today. */
  readonly available: boolean;
  readonly lineTotalCents: number;
}

/**
 * Prices every line from the live menu, the same way `snapshot_order_item`
 * will: variant price or base price, plus every extra's delta, floored at zero.
 *
 * Agreement with the database is the point. The total the checkout shows is the
 * total the order is placed at, unless the catalogue changes in between - and
 * then the database is right and the confirmation page shows its number.
 */
export function priceLines(
  lines: readonly CartLine[],
  products: readonly PricingProduct[],
): PricedLine[] {
  const byId = new Map(products.map((product) => [product.id, product]));

  return lines.map((line) => {
    const product = byId.get(line.productId);
    if (product === undefined || !product.isAvailable) {
      return { ...line, available: false, lineTotalCents: 0 };
    }

    const variant =
      line.variantId === null
        ? null
        : (product.variants.find((candidate) => candidate.id === line.variantId) ?? undefined);

    // A variant that disappeared, or a product that now has variants and the
    // line has none, cannot be priced honestly.
    if (variant === undefined || (variant === null && product.variants.length > 0)) {
      return { ...line, available: false, lineTotalCents: 0 };
    }

    const options = line.optionIds.map((id) => product.options.find((option) => option.id === id));
    if (options.some((option) => option === undefined)) {
      return { ...line, available: false, lineTotalCents: 0 };
    }

    const base = variant === null ? product.basePriceCents : variant.priceCents;
    const unit = Math.max(
      0,
      base + options.reduce((total, option) => total + (option?.priceDeltaCents ?? 0), 0),
    );

    return {
      ...line,
      name: product.name,
      unitPriceCents: unit,
      available: true,
      lineTotalCents: unit * line.quantity,
    };
  });
}
