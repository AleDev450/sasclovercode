/**
 * Pure cart logic for the POS screen. No I/O, nothing async.
 *
 * Every total here is a PREVIEW, the same posture `orders/lifecycle.ts`'s
 * `lineTotalCents` takes toward the database's own trigger: what the cashier
 * sees while building the sale, not what gets stored. The actual order is
 * whatever `createOrderForPos` and the database compute once the cart is
 * submitted (ADR-019) - a mismatch here is a display bug, never a data bug.
 */

export interface CartLine {
  readonly productId: string;
  readonly variantId: string | null;
  readonly name: string;
  readonly variantName: string | null;
  readonly unitPriceCents: number;
  readonly quantity: number;
}

export interface Tender {
  readonly paymentMethodId: string;
  readonly amountCents: number;
}

/** Identifies a cart line by what it's a line OF, not by insertion order. */
export function cartLineKey(productId: string, variantId: string | null): string {
  return `${productId}:${variantId ?? ""}`;
}

export function lineTotalCents(line: Pick<CartLine, "unitPriceCents" | "quantity">): number {
  return Math.round(line.unitPriceCents * line.quantity);
}

export function cartTotalCents(lines: readonly CartLine[]): number {
  return lines.reduce((sum, line) => sum + lineTotalCents(line), 0);
}

/**
 * Adds a line, or increases quantity if the same product+variant is already
 * in the cart - tapping a tile twice means "two of these", not two rows.
 */
export function addToCart(lines: readonly CartLine[], addition: CartLine): CartLine[] {
  const key = cartLineKey(addition.productId, addition.variantId);
  const index = lines.findIndex((line) => cartLineKey(line.productId, line.variantId) === key);

  if (index === -1) return [...lines, addition];

  return lines.map((line, i) =>
    i === index ? { ...line, quantity: line.quantity + addition.quantity } : line,
  );
}

/** Setting a quantity to zero or less removes the line - there is no "0 of something" in a cart. */
export function setCartQuantity(
  lines: readonly CartLine[],
  key: string,
  quantity: number,
): CartLine[] {
  if (quantity <= 0)
    return lines.filter((line) => cartLineKey(line.productId, line.variantId) !== key);
  return lines.map((line) =>
    cartLineKey(line.productId, line.variantId) === key ? { ...line, quantity } : line,
  );
}

export function removeFromCart(lines: readonly CartLine[], key: string): CartLine[] {
  return lines.filter((line) => cartLineKey(line.productId, line.variantId) !== key);
}

export function tenderedTotalCents(tenders: readonly Tender[]): number {
  return tenders.reduce((sum, tender) => sum + tender.amountCents, 0);
}

/** What's still owed after the tenders staged so far. Never negative. */
export function remainingBalanceCents(totalCents: number, tenders: readonly Tender[]): number {
  return Math.max(0, totalCents - tenderedTotalCents(tenders));
}

/**
 * Change owed on a single cash tender that exceeds the remaining balance.
 * Only cash makes sense to "hand back" - a card or Yape tender is never
 * entered for more than the balance in the first place, so this is only
 * ever called for the cash line.
 */
export function changeDueCents(
  remainingBeforeTenderCents: number,
  cashTenderedCents: number,
): number {
  return Math.max(0, cashTenderedCents - remainingBeforeTenderCents);
}
