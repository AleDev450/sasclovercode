/**
 * Peruvian identity documents.
 *
 * Pure and free of I/O, so the rules can be asserted directly and so the same
 * function runs in the form, in the Server Action and in a test.
 *
 * This module MIRRORS the CHECK constraints of
 * `20260827120100_create_customers.sql`; it does not replace them. The database
 * is the authority - it is the only layer every writer goes through, and from
 * Phase 13 the dashboard form stops being the only writer. What this layer adds
 * is a person reading "el RUC no es valido: revisa el ultimo digito" instead of
 * `customers_document_format`.
 */

/** The three documents master section 33 names for Phase 12. */
export const DOC_TYPES = ["dni", "ruc", "ce"] as const;

export type DocType = (typeof DOC_TYPES)[number];

export const DOC_TYPE_LABELS: Readonly<Record<DocType, string>> = {
  dni: "DNI",
  ruc: "RUC",
  ce: "Carne de extranjeria",
};

export function isDocType(value: string): value is DocType {
  return (DOC_TYPES as readonly string[]).includes(value);
}

/**
 * What a person types, as what the database stores.
 *
 * People type "45678912", "45.678.912" and "45 678 912" for the same document,
 * and a CE arrives in whatever case the keyboard was in. Normalising before
 * validating means the three become one row rather than three, and it is the
 * reason `doc_number` can carry a unique index at all.
 */
export function normalizeDocument(value: string): string {
  return value
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 12);
}

/**
 * SUNAT's modulo-11 check digit.
 *
 * Kept identical to `public.is_valid_ruc` in SQL, weight for weight. The two
 * exist because they run at different moments, not because they disagree.
 *
 *   weights 5,4,3,2,7,6,5,4,3,2 over the first ten digits
 *   expected = 11 - (sum mod 11), with 10 -> 0 and 11 -> 1
 */
const RUC_WEIGHTS = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2] as const;

/**
 * The taxpayer kinds SUNAT issues.
 *
 * A number can satisfy the check digit and still not be a RUC: the first two
 * digits say what kind of taxpayer it belongs to, and only these exist.
 */
const RUC_PREFIXES = ["10", "15", "16", "17", "20"] as const;

export function isValidRuc(value: string): boolean {
  if (!/^[0-9]{11}$/.test(value)) return false;
  if (!(RUC_PREFIXES as readonly string[]).includes(value.slice(0, 2))) return false;

  let sum = 0;
  for (let i = 0; i < 10; i += 1) {
    sum += Number(value[i]) * RUC_WEIGHTS[i]!;
  }

  let expected = 11 - (sum % 11);
  if (expected === 10) expected = 0;
  if (expected === 11) expected = 1;

  return expected === Number(value[10]);
}

export interface DocumentCheck {
  readonly ok: boolean;
  /** Why it was rejected, in words a person at a till can act on. */
  readonly reason?: string;
}

/**
 * Whether `value` is a valid document of `type`, already normalised.
 *
 * The message names the fix rather than the rule. "El RUC debe tener 11
 * digitos" tells someone what to do; "formato invalido" sends them to support.
 */
export function checkDocument(type: DocType, value: string): DocumentCheck {
  if (value.length === 0) {
    return { ok: false, reason: "Escribe el numero del documento." };
  }

  switch (type) {
    case "dni":
      return /^[0-9]{8}$/.test(value)
        ? { ok: true }
        : { ok: false, reason: "El DNI tiene 8 digitos." };

    case "ce":
      return /^[A-Z0-9]{8,12}$/.test(value)
        ? { ok: true }
        : { ok: false, reason: "El carne de extranjeria tiene entre 8 y 12 caracteres." };

    case "ruc":
      if (!/^[0-9]{11}$/.test(value)) {
        return { ok: false, reason: "El RUC tiene 11 digitos." };
      }
      if (!(RUC_PREFIXES as readonly string[]).includes(value.slice(0, 2))) {
        return { ok: false, reason: "Un RUC empieza en 10, 15, 16, 17 o 20." };
      }
      return isValidRuc(value)
        ? { ok: true }
        : { ok: false, reason: "Ese RUC no existe: revisa el ultimo digito." };
  }
}

/**
 * A phone number as it will be stored: digits, with an optional country prefix.
 *
 * Peruvian numbers get written "987 654 321", "987-654-321" and "+51 987654321"
 * for the same line. Storing them as typed would mean the same customer is
 * unfindable by the number they gave, which at a till is the only way anybody
 * looks anyone up.
 */
export function normalizePhone(value: string): string {
  const trimmed = value.trim();
  const hasPrefix = trimmed.startsWith("+");
  const digits = trimmed.replace(/[^0-9]/g, "");
  return digits.length === 0 ? "" : `${hasPrefix ? "+" : ""}${digits}`;
}

/**
 * Escapes a user's search term for use inside ILIKE.
 *
 * Without this, searching for "%" lists every customer in the business and "_"
 * matches any single character - a search box that quietly ignores what it was
 * given. The backslash is the default ILIKE escape character.
 */
export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}
