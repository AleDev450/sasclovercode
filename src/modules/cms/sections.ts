/**
 * Section content: structured data with a fixed shape per type.
 *
 * CLOVERCODE_MASTER.md section 33 states the constraint of this phase in one
 * line: "Evitar permitir HTML arbitrario peligroso."
 *
 * The way that is honoured is not by sanitising markup, it is by never
 * accepting markup. Every field below is plain text, a URL, or a small list of
 * plain-text objects. There is no `html` field anywhere, so there is nothing to
 * sanitise and nothing to get wrong later.
 *
 * A caller may still TYPE `<script>` into a heading. It is stored verbatim and
 * rendered by JSX, which escapes it - so it appears on the page as the literal
 * characters the person typed. That is the correct outcome: their content, not
 * their code.
 */

import { z } from "zod";

/** Plain text, bounded. Never interpreted as markup anywhere. */
const text = (max: number) => z.string().trim().max(max);
const requiredText = (max: number) => text(max).min(1, "Este campo es obligatorio.");

/**
 * True for a path inside this site.
 *
 * A leading `//` is excluded deliberately: `//evil.com` is a protocol-relative
 * URL, which looks like a path and navigates off-site.
 */
function isInternalPath(value: string): boolean {
  return value.startsWith("/") && !value.startsWith("//");
}

/**
 * A link a business may point at.
 *
 * https or an internal path. `javascript:` and `data:` are excluded by
 * construction rather than by blacklist - anything that is not one of these two
 * shapes is rejected.
 */
const link = z
  .string()
  .trim()
  .max(500)
  .refine(
    (value) => value.startsWith("https://") || isInternalPath(value),
    "Usa un enlace https:// o una ruta interna que empiece con /",
  );

/** A path inside the tenant's own storage folder, produced by Phase 06. */
const ASSET_PATH_PATTERN = /^tenants\/[0-9a-f-]{36}\/(branding|banners|products)\//;

const assetPath = z.string().trim().max(300).regex(ASSET_PATH_PATTERN, "Ruta de imagen invalida.");

const heroSchema = z.object({
  heading: requiredText(120),
  subheading: text(300).optional().default(""),
  imagePath: assetPath.optional(),
  ctaLabel: text(40).optional().default(""),
  ctaHref: link.optional(),
});

const textSchema = z.object({
  heading: text(120).optional().default(""),
  // Paragraphs as a LIST of strings, not one blob with markup. The renderer
  // emits one <p> per entry, so line structure survives without HTML.
  paragraphs: z.array(requiredText(2000)).min(1).max(20),
});

const imageSchema = z.object({
  imagePath: assetPath,
  // Required, not optional: an image with no alternative text is inaccessible,
  // and making it optional guarantees it will be skipped.
  alt: requiredText(200),
  caption: text(200).optional().default(""),
});

const bannerSchema = z.object({
  message: requiredText(200),
  href: link.optional(),
  tone: z.enum(["info", "success", "warning"]).default("info"),
});

const ctaSchema = z.object({
  heading: requiredText(120),
  body: text(400).optional().default(""),
  buttonLabel: requiredText(40),
  buttonHref: link,
});

const gallerySchema = z.object({
  heading: text(120).optional().default(""),
  images: z
    .array(z.object({ imagePath: assetPath, alt: requiredText(200) }))
    .min(1)
    .max(24),
});

/**
 * The products section, which Phase 11 filled in.
 *
 * It still stores only PRESENTATION - a heading, how many to show, and which
 * category - never the products themselves. The catalogue is read at render
 * time from `products`, so publishing a price change does not mean rewriting
 * every page that mentions it.
 *
 * `categorySlug` is optional and refers to a category by slug rather than by
 * id: a slug survives a category being recreated, and a section pointing at a
 * category that no longer exists falls back to the whole catalogue rather than
 * failing (EC-1108).
 */
const productsSchema = z.object({
  heading: text(120).optional().default(""),
  limit: z.coerce.number().int().min(1).max(24).default(8),
  categorySlug: z
    .string()
    .trim()
    .max(80)
    .regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/, "Slug de categoria invalido.")
    .optional(),
});

const faqSchema = z.object({
  heading: text(120).optional().default(""),
  items: z
    .array(z.object({ question: requiredText(200), answer: requiredText(1000) }))
    .min(1)
    .max(30),
});

export const SECTION_SCHEMAS = {
  hero: heroSchema,
  text: textSchema,
  image: imageSchema,
  banner: bannerSchema,
  cta: ctaSchema,
  gallery: gallerySchema,
  products: productsSchema,
  faq: faqSchema,
} as const;

export type SectionType = keyof typeof SECTION_SCHEMAS;

export const SECTION_TYPES = Object.keys(SECTION_SCHEMAS) as SectionType[];

export type SectionContent = {
  [K in SectionType]: z.output<(typeof SECTION_SCHEMAS)[K]>;
};

/** Human labels for the editor. */
export const SECTION_LABELS: Record<SectionType, string> = {
  hero: "Portada",
  text: "Texto",
  image: "Imagen",
  banner: "Aviso",
  cta: "Llamada a la accion",
  gallery: "Galeria",
  products: "Productos",
  faq: "Preguntas frecuentes",
};

export function isSectionType(value: string): value is SectionType {
  return Object.hasOwn(SECTION_SCHEMAS, value);
}

/**
 * Validates content against the schema of its own type.
 *
 * Returns a discriminated result rather than throwing, so a Server Action can
 * turn it into field errors.
 */
export function parseSectionContent(
  type: SectionType,
  content: unknown,
): { ok: true; value: unknown } | { ok: false; errors: Record<string, string[]> } {
  const result = SECTION_SCHEMAS[type].safeParse(content);

  if (result.success) return { ok: true, value: result.data };

  const errors: Record<string, string[]> = {};
  for (const issue of result.error.issues) {
    const key = issue.path.length > 0 ? issue.path.map(String).join(".") : "_form";
    (errors[key] ??= []).push(issue.message);
  }
  return { ok: false, errors };
}

/**
 * Every asset path referenced by a set of sections.
 *
 * Walks the stored content rather than knowing which field of which type holds
 * an image. That means a section type added later is covered without anyone
 * remembering to update this - the alternative is a switch that silently stops
 * being exhaustive.
 */
export function collectAssetPaths(sections: readonly { content: unknown }[]): string[] {
  const found: string[] = [];

  const walk = (value: unknown, depth: number): void => {
    if (depth > 6) return;

    if (typeof value === "string") {
      if (ASSET_PATH_PATTERN.test(value)) found.push(value);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) walk(item, depth + 1);
      return;
    }
    if (typeof value === "object" && value !== null) {
      for (const item of Object.values(value)) walk(item, depth + 1);
    }
  };

  for (const section of sections) walk(section.content, 0);
  return [...new Set(found)];
}
