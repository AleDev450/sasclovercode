/**
 * JSON-LD structured data.
 *
 * ---------------------------------------------------------------------------
 * THE ONE EXCEPTION IN THE PUBLIC SITE
 * ---------------------------------------------------------------------------
 *
 * Phase 07 established that nothing on a tenant website interprets markup, and
 * TEST-726 asserts it over the source of every file in `src/modules/cms`,
 * `src/app/(site)` and - since this phase - `src/modules/seo`.
 *
 * This file is the single allow-listed exception, and it is one on purpose
 * rather than by oversight. Structured data has exactly one delivery mechanism:
 * a `<script type="application/ld+json">` whose body is JSON. React escapes
 * text children, and escaped text is not valid JSON, so the payload cannot be
 * passed as a child - `dangerouslySetInnerHTML` is the only way to write it.
 *
 * That makes this the one place where tenant-authored text is written into a
 * script element, so it gets the treatment such a place deserves:
 *
 *   - the payload is built by `JSON.stringify`, never by string concatenation
 *   - every `<` becomes `\u003c`, so no value can close the script element
 *   - the escaping is a pure exported function, and TEST-821 to TEST-823
 *     attack it directly with a `</script>` payload
 *
 * Deciding this in the open is the point. Quietly weakening a guarantee because
 * one feature needs it is how guarantees stop meaning anything.
 */

/**
 * Serialises a value for embedding in a `<script>` element.
 *
 * `JSON.stringify` alone is NOT safe here. It emits `</script>` verbatim inside
 * a string, and an HTML parser scanning for the closing tag does not care that
 * it sits inside a JSON string: the element ends there, and everything after it
 * is parsed as markup. Escaping `<` as `\u003c` defeats that - the JSON
 * value is unchanged, because `\u003c` IS `<` to a JSON parser, while the HTML
 * parser never sees a `<` at all.
 *
 * U+2028 and U+2029 are escaped for the same class of reason: they are legal in
 * JSON but were historically line terminators in JavaScript, and some consumers
 * still treat them that way.
 */
export function serializeJsonLd(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

/** A JSON-LD block. Renders nothing when there is no data to describe. */
export function JsonLd({ data }: { data: unknown }): React.ReactElement | null {
  if (data === null || data === undefined) return null;

  return (
    <script
      type="application/ld+json"
      // The one allow-listed use in the public site. See the header.
      dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }}
    />
  );
}

export interface LocalBusinessInput {
  readonly name: string;
  readonly url: string;
  readonly description: string | null;
  readonly imageUrl: string | null;
  readonly phone: string | null;
  readonly addressLine: string | null;
  readonly district: string | null;
  readonly city: string | null;
}

/**
 * A schema.org LocalBusiness description of a tenant.
 *
 * Only fields the business actually filled in are emitted. A structured-data
 * block padded with empty strings is worse than a short one: search engines
 * treat contradictory or empty properties as a quality signal against the site.
 */
export function localBusinessJsonLd(input: LocalBusinessInput): Record<string, unknown> {
  const address: Record<string, string> = {};
  if (input.addressLine !== null) address.streetAddress = input.addressLine;
  if (input.district !== null) address.addressLocality = input.district;
  if (input.city !== null) address.addressRegion = input.city;

  const data: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    name: input.name,
    url: input.url,
  };

  if (input.description !== null) data.description = input.description;
  if (input.imageUrl !== null) data.image = input.imageUrl;
  if (input.phone !== null) data.telephone = input.phone;
  if (Object.keys(address).length > 0) {
    data.address = { "@type": "PostalAddress", ...address };
  }

  return data;
}
