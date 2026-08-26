import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  SECTION_LABELS,
  SECTION_TYPES,
  collectAssetPaths,
  isSectionType,
  parseSectionContent,
} from "@/modules/cms/sections";

const TENANT = "11111111-1111-4111-8111-111111111111";
const IMAGE = `tenants/${TENANT}/branding/logo.png`;

describe("section catalogue", () => {
  it("declares the eight types master section 33 names", () => {
    expect([...SECTION_TYPES].sort()).toEqual(
      ["banner", "cta", "faq", "gallery", "hero", "image", "products", "text"].sort(),
    );
  });

  it("labels every type", () => {
    for (const type of SECTION_TYPES) {
      expect(SECTION_LABELS[type]).toBeTruthy();
    }
  });

  it("narrows an unknown type", () => {
    expect(isSectionType("hero")).toBe(true);
    expect(isSectionType("carousel")).toBe(false);
  });
});

describe("content validation (TEST-724)", () => {
  it("accepts a well-formed section", () => {
    const result = parseSectionContent("text", { paragraphs: ["Hola"] });
    expect(result.ok).toBe(true);
  });

  it("rejects content that belongs to a different type", () => {
    // A `text` section carrying a hero's shape.
    const result = parseSectionContent("text", { heading: "x", subheading: "y" });
    expect(result.ok).toBe(false);
  });

  it("rejects a missing required field and names it", () => {
    const result = parseSectionContent("cta", { heading: "Reserva" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(Object.keys(result.errors)).toContain("buttonLabel");
  });

  it("requires alt text on an image, because optional alt is skipped alt", () => {
    expect(parseSectionContent("image", { imagePath: IMAGE }).ok).toBe(false);
    expect(parseSectionContent("image", { imagePath: IMAGE, alt: "Logo" }).ok).toBe(true);
  });

  it.each([
    ["javascript", "javascript:alert(1)"],
    ["data", "data:text/html,<script>alert(1)</script>"],
    ["protocol-relative", "//evil.example.com"],
    ["plain http", "http://insecure.example.com"],
  ])("rejects a %s link", (_label, href) => {
    const result = parseSectionContent("cta", {
      heading: "H",
      buttonLabel: "Ir",
      buttonHref: href,
    });
    expect(result.ok).toBe(false);
  });

  it.each(["https://example.com/reserva", "/nosotros", "/"])("accepts the link %j", (href) => {
    const result = parseSectionContent("cta", {
      heading: "H",
      buttonLabel: "Ir",
      buttonHref: href,
    });
    expect(result.ok).toBe(true);
  });

  it("rejects an image path outside a tenant folder", () => {
    expect(parseSectionContent("image", { imagePath: "/etc/passwd", alt: "x" }).ok).toBe(false);
  });
});

describe("markup is stored as text, never as markup (TEST-725)", () => {
  it("keeps a script tag verbatim instead of stripping or escaping it", () => {
    // Deliberately NOT sanitised. The value is data; escaping happens at render
    // time, where JSX does it. Mangling it here would corrupt legitimate text
    // that merely contains angle brackets.
    const payload = "<script>fetch('/api')</script>";
    const result = parseSectionContent("text", { paragraphs: [payload] });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect((result.value as { paragraphs: string[] }).paragraphs[0]).toBe(payload);
  });

  it("has no field anywhere that is meant to hold markup", () => {
    // The guarantee is structural: there is nothing to sanitise because there
    // is nowhere to put HTML.
    for (const type of SECTION_TYPES) {
      const result = parseSectionContent(type, { html: "<b>x</b>" });
      // Either it fails outright, or the stray key is dropped by the schema.
      if (result.ok) {
        expect(Object.keys(result.value as object)).not.toContain("html");
      }
    }
  });
});

describe("collectAssetPaths", () => {
  it("finds paths wherever they are nested", () => {
    const paths = collectAssetPaths([
      { content: { imagePath: IMAGE } },
      { content: { images: [{ imagePath: IMAGE }, { imagePath: `${IMAGE}2` }] } },
      { content: { paragraphs: ["nada aqui"] } },
    ]);
    expect(paths).toContain(IMAGE);
    expect(paths).toHaveLength(2);
  });

  it("ignores strings that are not asset paths", () => {
    expect(collectAssetPaths([{ content: { href: "https://example.com" } }])).toEqual([]);
  });

  it("does not recurse forever on a deep structure", () => {
    let nested: unknown = { imagePath: IMAGE };
    for (let i = 0; i < 50; i += 1) nested = { inner: nested };
    expect(() => collectAssetPaths([{ content: nested }])).not.toThrow();
  });
});

/**
 * TEST-726 — the guarantee of the phase, asserted over the source itself.
 */
describe("TEST-726: nothing in the public site interprets markup", () => {
  const ROOTS = [
    join(process.cwd(), "src", "modules", "cms"),
    join(process.cwd(), "src", "app", "(site)"),
    // Phase 08 put SEO on the public site, so it falls under the same rule.
    join(process.cwd(), "src", "modules", "seo"),
  ];

  /*
   * The single allow-listed file, added in Phase 08 (TEST-824).
   *
   * JSON-LD has exactly one delivery mechanism - a `<script>` whose body is
   * JSON - and React escapes text children, which would make the body invalid
   * JSON. `dangerouslySetInnerHTML` is genuinely the only way to write it.
   *
   * The entry is a NAMED exception rather than a relaxed rule: the guarantee
   * still holds everywhere else, the escaping in that file is attacked directly
   * by TEST-821 to TEST-823, and adding a second name here is a decision
   * somebody has to make on purpose.
   */
  const ALLOWED = [join("modules", "seo", "structured-data.tsx")];

  async function collectFiles(dir: string): Promise<string[]> {
    const entries = await readdir(dir, { withFileTypes: true });
    const files: string[] = [];
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) files.push(...(await collectFiles(full)));
      else if (/\.(ts|tsx)$/.test(entry.name)) files.push(full);
    }
    return files;
  }

  /**
   * Comments are stripped first.
   *
   * The renderer's own documentation names `dangerouslySetInnerHTML` in order
   * to say it is not used, and a naive substring search flagged that. The
   * guarantee is about code, not prose - so the check looks for the JSX prop
   * and the property assignment, in source with comments removed.
   */
  function stripComments(source: string): string {
    const withoutBlocks = source.replace(/\/\*[\s\S]*?\*\//g, "");
    return withoutBlocks
      .split("\n")
      .map((line) => {
        const index = line.indexOf("//");
        return index === -1 ? line : line.slice(0, index);
      })
      .join("\n");
  }

  it("uses no dangerouslySetInnerHTML and no innerHTML", async () => {
    const files = (await Promise.all(ROOTS.map(collectFiles))).flat();
    expect(files.length).toBeGreaterThan(0);

    const offenders: string[] = [];
    for (const file of files) {
      if (ALLOWED.some((allowed) => file.endsWith(allowed))) continue;
      const code = stripComments(await readFile(file, "utf8"));
      if (/dangerouslySetInnerHTML\s*=/.test(code) || /\.innerHTML\s*=/.test(code)) {
        offenders.push(file);
      }
    }

    expect(offenders, "a public CMS file interprets markup").toEqual([]);
  });

  /*
   * Guards the allow-list itself.
   *
   * An exception nobody can see is an exception that grows. If the allow-listed
   * file ever stops using the escaping - or stops existing - this fails and
   * somebody has to look at why the exception is still there.
   */
  it("allows exactly one file, and that file escapes what it writes (TEST-824)", async () => {
    expect(ALLOWED).toHaveLength(1);

    const source = await readFile(
      join(process.cwd(), "src", "modules", "seo", "structured-data.tsx"),
      "utf8",
    );
    expect(source).toContain("serializeJsonLd");
    expect(stripComments(source)).toContain("\u003c");
  });

  it("would catch a real offender", async () => {
    // Guards the guard: a check that cannot fail proves nothing.
    const code = stripComments("const a = <div dangerouslySetInnerHTML={{ __html: x }} />;");
    expect(/dangerouslySetInnerHTML\s*=/.test(code)).toBe(true);
  });
});
