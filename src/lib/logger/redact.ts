/**
 * Redaction for structured log context.
 *
 * CLOVERCODE_MASTER.md section 9 forbids logging tokens or passwords, and
 * section 17 forbids storing secrets in audit logs. Redaction is applied
 * centrally so that no call site has to remember to do it.
 *
 * The policy is deliberately over-inclusive: redacting a harmless field is
 * cheap, leaking a credential is not.
 */

export const REDACTED = "[REDACTED]";

/** Applied to the key after lowercasing and stripping non-alphanumerics. */
const SENSITIVE_KEY_PATTERNS: readonly RegExp[] = [
  /pass(word|wd|phrase)?$/,
  /^pwd$/,
  /secret/,
  /token/,
  /apikey/,
  /authorization/,
  /^auth$/,
  /^cookie/,
  /setcookie/,
  /servicerole/,
  /credential/,
  /privatekey/,
  /signature/,
  /^otp$/,
  /^pin$/,
  /^cvv$/,
  /^cvc$/,
  /^jwt$/,
  /bearer/,
];

/** Guards against pathological or cyclic structures blowing the stack. */
const MAX_DEPTH = 8;
const MAX_ARRAY_ITEMS = 100;
const MAX_STRING_LENGTH = 8_000;

export function isSensitiveKey(key: string): boolean {
  const normalised = key.toLowerCase().replace(/[^a-z0-9]/g, "");
  return SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(normalised));
}

function redactValue(value: unknown, depth: number, ancestors: WeakSet<object>): unknown {
  if (value === null || value === undefined) return value;

  switch (typeof value) {
    case "string":
      return value.length > MAX_STRING_LENGTH
        ? `${value.slice(0, MAX_STRING_LENGTH)}...[truncated]`
        : value;
    case "number":
    case "boolean":
      return value;
    case "bigint":
      return `${value.toString()}n`;
    case "function":
      return "[Function]";
    case "symbol":
      return value.toString();
    default:
      break;
  }

  if (depth >= MAX_DEPTH) return "[MaxDepth]";

  if (value instanceof Date) return value.toISOString();

  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
      ...(value.cause === undefined
        ? {}
        : { cause: redactValue(value.cause, depth + 1, ancestors) }),
    };
  }

  const asObject = value as object;

  // `ancestors` holds only the objects on the CURRENT path, not everything
  // visited. Tracking every visited object would flag a repeated-but-acyclic
  // reference - the same tenant object attached to two orders, say - as
  // "[Circular]" and silently drop it from the log record.
  if (ancestors.has(asObject)) return "[Circular]";
  ancestors.add(asObject);

  try {
    if (Array.isArray(value)) {
      const items = value
        .slice(0, MAX_ARRAY_ITEMS)
        .map((item) => redactValue(item, depth + 1, ancestors));
      if (value.length > MAX_ARRAY_ITEMS) {
        items.push(`...[${value.length - MAX_ARRAY_ITEMS} more]`);
      }
      return items;
    }

    if (value instanceof Map) {
      return redactValue(Object.fromEntries(value), depth + 1, ancestors);
    }
    if (value instanceof Set) {
      return redactValue([...value], depth + 1, ancestors);
    }

    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      result[key] = isSensitiveKey(key) ? REDACTED : redactValue(entry, depth + 1, ancestors);
    }
    return result;
  } finally {
    // Leaving this branch: the object is no longer an ancestor.
    ancestors.delete(asObject);
  }
}

/**
 * Returns a deep copy of `input` with every sensitive value replaced.
 *
 * Never throws: a logger that can crash a request is worse than no logger.
 */
export function redact(input: unknown): unknown {
  try {
    return redactValue(input, 0, new WeakSet<object>());
  } catch {
    return "[RedactionFailed]";
  }
}
