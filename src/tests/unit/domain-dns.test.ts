import { describe, expect, it } from "vitest";
import { DNS_TARGET_CNAME, DNS_TARGET_IPV4 } from "@/config/app";
import {
  checkDomainOwnership,
  dnsInstructions,
  verificationRecordName,
  type TxtResolver,
} from "@/modules/domains/dns";

/**
 * TEST-930 to TEST-934 — the DNS check without a network.
 *
 * The resolver is the only impure part, so it is the only part injected. That
 * lets these tests cover the cases that actually happen to real businesses and
 * are impossible to arrange on demand: a zone that already holds four other
 * verification tokens, a provider that splits a long TXT value in two, a
 * nameserver that times out.
 */

const TOKEN = "clovercode-site-verification=0123456789abcdef0123456789abcdef";

/** A resolver that answers with fixed records. */
function resolverReturning(records: string[][]): TxtResolver {
  return async () => records;
}

/** A resolver that fails the way Node's does, with a `code`. */
function resolverFailing(code: string): TxtResolver {
  return async () => {
    const error = new Error("dns failure") as Error & { code: string };
    error.code = code;
    throw error;
  };
}

describe("verificationRecordName (TEST-930)", () => {
  it("derives the record name from the domain", () => {
    expect(verificationRecordName("sugurolls.com")).toBe("_clovercode.sugurolls.com");
    expect(verificationRecordName("tienda.sugurolls.com")).toBe("_clovercode.tienda.sugurolls.com");
  });
});

describe("checkDomainOwnership", () => {
  it("accepts the token when the zone holds several TXT records (TEST-931)", async () => {
    const resolver = resolverReturning([
      ["v=spf1 include:_spf.google.com ~all"],
      ["google-site-verification=somethingelse"],
      [TOKEN],
    ]);
    await expect(checkDomainOwnership("sugurolls.com", TOKEN, resolver)).resolves.toEqual({
      ok: true,
    });
  });

  /*
   * TEST-932. A TXT record is a sequence of strings of at most 255 characters,
   * and DNS providers split longer values at that boundary on their own.
   * Comparing chunk by chunk would fail for any token that straddled the split -
   * which presents as "the business typed it wrong" and is impossible to argue
   * with over the phone.
   */
  it("joins the chunks of a split TXT record before comparing (TEST-932)", async () => {
    const half = Math.floor(TOKEN.length / 2);
    const resolver = resolverReturning([[TOKEN.slice(0, half), TOKEN.slice(half)]]);
    await expect(checkDomainOwnership("sugurolls.com", TOKEN, resolver)).resolves.toEqual({
      ok: true,
    });
  });

  it("tolerates surrounding whitespace, which some panels add", async () => {
    const resolver = resolverReturning([[` ${TOKEN} `]]);
    await expect(checkDomainOwnership("sugurolls.com", TOKEN, resolver)).resolves.toEqual({
      ok: true,
    });
  });

  it("says the record is missing when the zone is empty (TEST-933)", async () => {
    const result = await checkDomainOwnership("sugurolls.com", TOKEN, resolverReturning([]));
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("_clovercode.sugurolls.com");
  });

  it("distinguishes 'no records' from 'records but none match'", async () => {
    const result = await checkDomainOwnership(
      "sugurolls.com",
      TOKEN,
      resolverReturning([["clovercode-site-verification=elviejo"]]),
    );
    expect(result.ok).toBe(false);
    // The business needs to know it published something, just not this value -
    // usually the token of a domain they connected and then removed.
    expect(result.reason).toContain("ninguno coincide");
  });

  it("does not accept a near miss", async () => {
    const resolver = resolverReturning([[`${TOKEN}x`]]);
    await expect(checkDomainOwnership("sugurolls.com", TOKEN, resolver)).resolves.toMatchObject({
      ok: false,
    });
  });

  /*
   * TEST-934. Asking the internet a question fails constantly: the domain may
   * not exist yet, the zone may be half-configured, a resolver may time out. A
   * business clicking "check" must see an explanation, never an error page - so
   * this function does not throw, whatever the resolver does.
   */
  it.each([
    ["ENOTFOUND", "48 horas"],
    ["ENODATA", "48 horas"],
    ["ETIMEOUT", "no respondio"],
    ["ESERVFAIL", "no respondio"],
    ["EREFUSED", "rechazo"],
    ["SOMETHING_ELSE", "No se pudo consultar"],
  ])("turns a %s failure into a readable reason (TEST-934)", async (code, expected) => {
    const result = await checkDomainOwnership("sugurolls.com", TOKEN, resolverFailing(code));
    expect(result.ok).toBe(false);
    expect(result.reason).toContain(expected);
  });

  it("never leaks the underlying error text", async () => {
    const resolver: TxtResolver = async () => {
      throw new Error("queryTxt ENOTFOUND _clovercode.sugurolls.com at QueryReqWrap.onresolve");
    };
    const result = await checkDomainOwnership("sugurolls.com", TOKEN, resolver);
    expect(result.reason).not.toContain("QueryReqWrap");
  });

  it("does not throw when the resolver rejects with an error carrying no code", async () => {
    const resolver: TxtResolver = () => Promise.reject(new Error("boom"));
    await expect(checkDomainOwnership("sugurolls.com", TOKEN, resolver)).resolves.toMatchObject({
      ok: false,
    });
  });
});

describe("dnsInstructions", () => {
  it("always asks for the TXT record that proves ownership", () => {
    const records = dnsInstructions("sugurolls.com", TOKEN);
    const txt = records.find((record) => record.type === "TXT");
    expect(txt?.name).toBe("_clovercode.sugurolls.com");
    expect(txt?.value).toBe(TOKEN);
  });

  /*
   * An apex domain cannot carry a CNAME - the DNS specification forbids one at
   * a zone apex - so it gets an A record. Handing a business a CNAME for
   * `sugurolls.com` is the single most common reason a domain connection fails,
   * and it is decidable from the name itself.
   */
  it("gives an apex domain an A record", () => {
    const records = dnsInstructions("sugurolls.com", TOKEN);
    const target = records.find((record) => record.type !== "TXT");
    expect(target?.type).toBe("A");
    expect(target?.value).toBe(DNS_TARGET_IPV4);
  });

  it("gives a subdomain a CNAME", () => {
    const records = dnsInstructions("tienda.sugurolls.com", TOKEN);
    const target = records.find((record) => record.type !== "TXT");
    expect(target?.type).toBe("CNAME");
    expect(target?.value).toBe(DNS_TARGET_CNAME);
  });

  it("explains what each record is for", () => {
    for (const record of dnsInstructions("sugurolls.com", TOKEN)) {
      expect(record.purpose.length).toBeGreaterThan(0);
    }
  });
});
