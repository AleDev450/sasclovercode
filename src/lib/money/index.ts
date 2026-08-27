/**
 * Money, as integers in the currency's minor unit.
 *
 * CLOVERCODE_MASTER.md section 39 forbids floating point for money and asks for
 * a consistent, DOCUMENTED strategy. This is that strategy; the reasoning is in
 * `docs/adr/015-money-as-minor-units.md`.
 *
 * S/ 24.90 is the integer 2490. Never 24.90.
 *
 * The reason to prefer this over `numeric(12,2)` is not what PostgreSQL does -
 * numeric arithmetic in SQL is exact either way. It is what happens on the way
 * out: PostgREST serialises `numeric` as a JSON number, JavaScript parses that
 * into a double, and from then on every total computed in the application is a
 * float. `0.1 + 0.2` is `0.30000000000000004` in every JavaScript runtime, and
 * a cent that appears or disappears in a till reconciliation is a real problem
 * for a real business.
 *
 * Integers remove the hazard by construction rather than by discipline: there
 * is no float to get wrong, because there is no float.
 *
 * The currency itself is NOT stored per amount. It lives once per business in
 * `tenant_settings.currency` (Phase 06), because a tenant transacts in one
 * currency and repeating it on every row would be a chance for two rows to
 * disagree.
 */

/** An amount in the minor unit. 2490 means S/ 24.90 when the currency is PEN. */
export type Cents = number;

/**
 * The largest amount this system will accept, in cents.
 *
 * S/ 100 million, which is far beyond any single price or order in the market
 * this serves, and far below `Number.MAX_SAFE_INTEGER` (about 9.0e15 cents, or
 * 90 trillion soles). That gap is what keeps every sum below exact: adding
 * thousands of these can never reach the point where a JavaScript integer stops
 * being one.
 */
export const MAX_CENTS = 10_000_000_000;

/** Minor units per major unit. Two for PEN, USD, EUR and every currency here. */
const MINOR_UNITS = 100;

export interface ParseMoneyResult {
  readonly ok: boolean;
  readonly cents?: Cents;
  readonly reason?: string;
}

/**
 * Reads a human-typed amount into cents.
 *
 * Deliberately NOT `Math.round(Number(value) * 100)`, which is the obvious
 * implementation and is wrong in a way that only shows up on some inputs:
 * `Number("8.07") * 100` is `806.9999999999999`, and `Math.round` saves it,
 * but `Math.trunc` would not and neither would a later `* 3`. Splitting the
 * string on the decimal separator never involves a float at all.
 *
 * Accepts a comma as the decimal separator: a Peruvian keyboard and a Peruvian
 * spreadsheet both produce `24,90`, and rejecting that reads as "the form
 * dislikes my number" rather than "wrong punctuation".
 */
export function parseMoney(value: string): ParseMoneyResult {
  const trimmed = value.trim().replace(",", ".");

  if (trimmed.length === 0) {
    return { ok: false, reason: "Escribe un importe." };
  }

  // One optional sign, digits, and at most two decimals. Three decimals is
  // rejected rather than rounded: a price of "24.905" is a typo or a
  // misunderstanding, and silently turning it into 24.91 hides both.
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(trimmed);
  if (match === null) {
    return { ok: false, reason: "Usa un importe como 24.90, con dos decimales." };
  }

  const [, sign, whole, decimals = ""] = match;
  const padded = decimals.padEnd(2, "0");
  const cents = Number(whole) * MINOR_UNITS + Number(padded);

  if (cents > MAX_CENTS) {
    return { ok: false, reason: "El importe es demasiado grande." };
  }

  return { ok: true, cents: sign === "-" ? -cents : cents };
}

/**
 * Writes cents as a plain decimal string: 2490 becomes "24.90".
 *
 * No currency symbol and no thousands separator, because this is the value a
 * form field holds and a form field must round-trip: `parseMoney(formatMoney(x))`
 * is `x` for every amount. Presentation with a symbol is `formatCurrency`.
 */
export function formatMoney(cents: Cents): string {
  const negative = cents < 0;
  const absolute = Math.abs(Math.trunc(cents));
  const whole = Math.floor(absolute / MINOR_UNITS);
  const rest = absolute % MINOR_UNITS;
  return `${negative ? "-" : ""}${whole}.${String(rest).padStart(2, "0")}`;
}

/** Currency symbols for the currencies this product actually sees. */
const SYMBOLS: Record<string, string> = {
  PEN: "S/",
  USD: "$",
  EUR: "€",
};

/**
 * For display: "S/ 24.90".
 *
 * Falls back to the ISO code when the symbol is unknown, which is correct
 * rather than clever: "CLP 5000" is unambiguous, and an invented symbol is not.
 */
export function formatCurrency(cents: Cents, currency: string): string {
  const code = currency.trim().toUpperCase();
  const symbol = SYMBOLS[code] ?? code;
  return `${symbol} ${formatMoney(cents)}`;
}

/**
 * `cents * quantity`, rounded to a whole cent.
 *
 * Quantity may be fractional - 0.75 kg of something priced by the kilo - so the
 * product can land between cents and a rounding rule is unavoidable. Round half
 * up, which is what a Peruvian till does and what a customer expects when they
 * check the arithmetic on a receipt.
 */
export function multiplyMoney(cents: Cents, quantity: number): Cents {
  if (!Number.isFinite(quantity)) return 0;
  return Math.round(cents * quantity);
}

/** Adds a list of amounts. Integer addition, so the result is exact. */
export function sumMoney(amounts: readonly Cents[]): Cents {
  return amounts.reduce((total, amount) => total + Math.trunc(amount), 0);
}

/**
 * A percentage of an amount, rounded to a whole cent.
 *
 * `percent` is a plain number: 18 means 18%. Phase 17 will need this for IGV,
 * and having one implementation of "a percentage of money" means the tax and
 * the discount cannot round differently.
 */
export function percentOfMoney(cents: Cents, percent: number): Cents {
  if (!Number.isFinite(percent)) return 0;
  return Math.round((cents * percent) / 100);
}

/** True when the value is a whole number of cents inside the accepted range. */
export function isValidCents(value: number): boolean {
  return Number.isInteger(value) && Math.abs(value) <= MAX_CENTS;
}
