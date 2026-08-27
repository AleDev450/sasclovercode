/**
 * DNS ownership checking, as pure logic plus one injected resolver.
 *
 * The only impure thing a domain check does is ask a DNS server a question, so
 * that is the only thing injected. Everything else - what record to ask for,
 * how to reassemble a TXT value, what counts as a match, what to tell the
 * business when it does not - is decided here and can be tested without a
 * network.
 *
 * What this proves, and what it does not:
 *
 *   PROVES      the business can write records in that domain's zone, so it
 *               controls the domain
 *   DOES NOT    prove the domain points at us, and does not prove the hosting
 *               provider will serve it
 *
 * Those two are separate facts with separate columns, because master section 33
 * says never to assume that a row in our database configured anything.
 */

import { DNS_TARGET_CNAME, DNS_TARGET_IPV4, VERIFICATION_RECORD_PREFIX } from "@/config/app";

/**
 * Resolves TXT records, in Node's shape: one array per record, and one string
 * per 255-character chunk within it.
 */
export type TxtResolver = (name: string) => Promise<string[][]>;

export interface DnsCheckResult {
  readonly ok: boolean;
  /** Shown to the business and stored in `last_error`. Never a stack trace. */
  readonly reason?: string;
}

/** The name whose TXT record carries the token: `_clovercode.sugurolls.com`. */
export function verificationRecordName(domain: string): string {
  return `${VERIFICATION_RECORD_PREFIX}.${domain}`;
}

/**
 * Joins the chunks of one TXT record.
 *
 * A TXT record is a sequence of strings of at most 255 characters, and DNS
 * providers split longer values at that boundary on their own. Comparing chunk
 * by chunk would fail for any token that happened to straddle the split - which
 * would look like "the business typed it wrong" and be very hard to argue with.
 */
function joinChunks(record: readonly string[]): string {
  return record.join("").trim();
}

export interface DnsInstruction {
  readonly type: "TXT" | "CNAME" | "A";
  readonly name: string;
  readonly value: string;
  readonly purpose: string;
}

/**
 * The records a business has to create, derived rather than written by hand.
 *
 * Apex domains (`sugurolls.com`) cannot carry a CNAME - the DNS specification
 * forbids one at the zone apex - so they get an A record instead. Getting this
 * wrong is the single most common reason a domain connection fails, and it is
 * decidable from the name itself.
 */
export function dnsInstructions(domain: string, token: string): DnsInstruction[] {
  const labels = domain.split(".");
  // Two labels is an apex (`sugurolls.com`); three or more is a subdomain.
  // Not perfect for multi-part suffixes such as `com.pe`, which is why the
  // screen shows both records and says which applies.
  const isApex = labels.length <= 2;

  return [
    {
      type: "TXT",
      name: verificationRecordName(domain),
      value: token,
      purpose: "Demuestra que el dominio es tuyo.",
    },
    isApex
      ? {
          type: "A",
          name: domain,
          value: DNS_TARGET_IPV4,
          purpose: "Envia el trafico a la plataforma.",
        }
      : {
          type: "CNAME",
          name: domain,
          value: DNS_TARGET_CNAME,
          purpose: "Envia el trafico a la plataforma.",
        },
  ];
}

/** Node's DNS errors carry a `code`; anything else is treated as unknown. */
function errorCode(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : "UNKNOWN";
}

/**
 * Turns a resolver failure into something a restaurant owner can act on.
 *
 * `ENOTFOUND` and `ENODATA` are the normal answer while DNS is still
 * propagating, so they say "not there yet" rather than "error" - the business
 * has usually done nothing wrong and just needs to wait.
 */
function describeFailure(error: unknown, recordName: string): string {
  switch (errorCode(error)) {
    case "ENOTFOUND":
    case "ENODATA":
      return `Todavia no vemos el registro TXT en ${recordName}. Los cambios de DNS pueden tardar hasta 48 horas.`;
    case "ETIMEOUT":
    case "ESERVFAIL":
      return "El servidor DNS del dominio no respondio. Intentalo de nuevo en unos minutos.";
    case "EREFUSED":
      return "El servidor DNS del dominio rechazo la consulta.";
    default:
      return "No se pudo consultar el DNS del dominio.";
  }
}

/**
 * Looks for `token` among the TXT records of `_clovercode.<domain>`.
 *
 * Never throws. A DNS lookup failing is an ordinary outcome of asking the
 * internet a question - the domain may not exist yet, the zone may be
 * half-configured, a resolver may time out - and a business clicking "check"
 * should see an explanation, not an error page.
 */
export async function checkDomainOwnership(
  domain: string,
  token: string,
  resolveTxt: TxtResolver,
): Promise<DnsCheckResult> {
  const recordName = verificationRecordName(domain);

  let records: string[][];
  try {
    records = await resolveTxt(recordName);
  } catch (error) {
    return { ok: false, reason: describeFailure(error, recordName) };
  }

  const values = records.map(joinChunks);

  // A zone legitimately holds many TXT records at one name - SPF, other
  // vendors' verification tokens. Ours only has to be among them.
  if (values.includes(token.trim())) return { ok: true };

  if (values.length === 0) {
    return {
      ok: false,
      reason: `No hay ningun registro TXT en ${recordName}.`,
    };
  }

  return {
    ok: false,
    reason: `Hay registros TXT en ${recordName}, pero ninguno coincide con el codigo de verificacion.`,
  };
}

/** The live resolver. Imported lazily so the pure logic stays testable. */
export async function nodeTxtResolver(name: string): Promise<string[][]> {
  const { resolveTxt } = await import("node:dns/promises");
  return resolveTxt(name);
}
