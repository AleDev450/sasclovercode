import Link from "next/link";
import { formatCurrency } from "@/lib/money";
import { cn } from "@/lib/utils";
import { SECTION_SCHEMAS, type SectionType } from "../sections";

/**
 * Renders one section of a tenant page.
 *
 * The rule of this file, and the reason master section 33 exists: **nothing
 * here interprets markup**. Every value below reaches the DOM as a JSX child or
 * an attribute, both of which React escapes. There is no
 * `dangerouslySetInnerHTML`, no `innerHTML`, and no template that concatenates
 * a stored value into markup — and a test asserts that over the source, so it
 * stays true when somebody adds a section type next year.
 *
 * A business that types `<script>` into a heading gets those characters printed
 * on their page. That is their content, not their code.
 *
 * COLOURS COME FROM THE TENANT, NOT FROM THE PLATFORM. Every visual value here
 * is a `--site-*` custom property set by the layout from `tenant_themes`. This
 * used to be `bg-primary` and `text-muted-foreground` — the DASHBOARD's tokens
 * — which meant a business could pick any three colours it liked and its
 * website would still come out CloverCode-coloured. That was the real reason
 * the theming feature looked like it did nothing.
 *
 * The one thing still borrowed from Tailwind is layout: spacing, grid and type
 * scale are the product's opinion, not the tenant's, and a business choosing a
 * theme is not choosing a margin.
 */

export interface RenderableSection {
  readonly id: string;
  readonly type: SectionType;
  readonly content: unknown;
}

/**
 * Signed URLs by stored path.
 *
 * A Map and not a function: the bucket is private, so a URL has to be signed,
 * and signing is asynchronous. The page signs everything up front and this
 * component looks the result up. A path missing from the map means signing
 * failed, and the image is skipped rather than rendered broken.
 */
export type AssetUrls = ReadonlyMap<string, string>;

/** What the `products` section needs in order to render. */
export interface CatalogForSections {
  readonly products: readonly {
    id: string;
    name: string;
    description: string | null;
    basePriceCents: number;
    isAvailable: boolean;
    isFeatured: boolean;
    position: number;
    imagePath: string | null;
    categorySlug: string | null;
  }[];
  /** From `tenant_settings` via the public identity function (Phase 06/11). */
  readonly currency: string;
}

function Heading({ children, className }: { children: string; className?: string }) {
  if (children.length === 0) return null;
  return (
    <h2
      className={cn("text-2xl font-semibold tracking-tight sm:text-3xl", className)}
      style={{ color: "var(--site-foreground)" }}
    >
      {children}
    </h2>
  );
}

/**
 * A link that stays safe whatever was stored.
 *
 * `next/link` for an internal path, a plain anchor for an external one with
 * `rel="noreferrer"` so the destination cannot reach back through
 * `window.opener`. The href itself was already constrained to https-or-path by
 * the schema; this is the second layer.
 */
function SafeLink({
  href,
  children,
  className,
  style,
}: {
  href: string;
  children: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  const isExternal = href.startsWith("https://");

  if (isExternal) {
    return (
      <a href={href} target="_blank" rel="noreferrer noopener" className={className} style={style}>
        {children}
      </a>
    );
  }
  return (
    <Link href={href} className={className} style={style}>
      {children}
    </Link>
  );
}

/** Shared geometry of every call to action. Colour arrives separately. */
const buttonClass =
  "inline-flex h-11 items-center justify-center px-6 text-sm font-semibold transition-opacity hover:opacity-90";

const primaryButtonStyle: React.CSSProperties = {
  background: "var(--site-primary)",
  color: "var(--site-on-primary)",
  borderRadius: "var(--site-radius)",
};

export function SectionRenderer({
  section,
  assetUrls,
  catalog,
}: {
  section: RenderableSection;
  assetUrls: AssetUrls;
  /**
   * The tenant's published catalogue, read once by the page and passed down.
   *
   * Passed in rather than fetched here so this component stays synchronous and
   * pure: it renders what it is given, which is what makes it testable and what
   * keeps the "nothing here interprets markup" guarantee of Phase 07 easy to
   * check by reading one file.
   */
  catalog?: CatalogForSections;
}) {
  // Re-validated at render time, not trusted from the row.
  //
  // The write path validates, but content can also arrive from a migration, a
  // seed, or a future admin tool. Parsing here means a malformed row renders as
  // nothing instead of crashing the whole public page of a business.
  const parsed = SECTION_SCHEMAS[section.type].safeParse(section.content);
  if (!parsed.success) return null;

  switch (section.type) {
    case "hero": {
      const c = parsed.data as (typeof SECTION_SCHEMAS)["hero"]["_output"];
      const image = c.imagePath !== undefined ? assetUrls.get(c.imagePath) : undefined;

      return (
        <section
          className={cn(
            "grid items-center gap-8 py-12 sm:py-16",
            image !== undefined && "lg:grid-cols-2 lg:gap-12",
          )}
        >
          <div className="flex flex-col items-start gap-5">
            <h1
              className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl"
              style={{ color: "var(--site-primary)" }}
            >
              {c.heading}
            </h1>
            {c.subheading.length > 0 ? (
              <p
                className="max-w-prose text-lg leading-relaxed"
                style={{ color: "var(--site-muted)" }}
              >
                {c.subheading}
              </p>
            ) : null}
            {c.ctaLabel.length > 0 && c.ctaHref !== undefined ? (
              <SafeLink href={c.ctaHref} className={buttonClass} style={primaryButtonStyle}>
                {c.ctaLabel}
              </SafeLink>
            ) : null}
          </div>

          {image !== undefined ? (
            /* eslint-disable-next-line @next/next/no-img-element -- the asset is
               a signed URL from Storage, whose host is not known at build time,
               so next/image cannot be configured for it until Phase 09. */
            <img
              src={image}
              alt=""
              className="aspect-[4/3] w-full object-cover"
              style={{ borderRadius: "var(--site-radius)" }}
            />
          ) : null}
        </section>
      );
    }

    case "text": {
      const c = parsed.data as (typeof SECTION_SCHEMAS)["text"]["_output"];
      return (
        <section className="flex flex-col gap-4 py-10">
          <Heading>{c.heading}</Heading>
          {/* One <p> per stored paragraph. Line structure survives without any
              markup ever being stored. */}
          {c.paragraphs.map((paragraph, index) => (
            <p
              key={index}
              className="max-w-prose leading-relaxed"
              style={{ color: "var(--site-muted)" }}
            >
              {paragraph}
            </p>
          ))}
        </section>
      );
    }

    case "image": {
      const c = parsed.data as (typeof SECTION_SCHEMAS)["image"]["_output"];
      return (
        <figure className="flex flex-col gap-3 py-10">
          {/* eslint-disable-next-line @next/next/no-img-element -- see hero */}
          <img
            src={assetUrls.get(c.imagePath) ?? ""}
            alt={c.alt}
            className="w-full"
            style={{ borderRadius: "var(--site-radius)" }}
          />
          {c.caption.length > 0 ? (
            <figcaption className="text-sm" style={{ color: "var(--site-subtle)" }}>
              {c.caption}
            </figcaption>
          ) : null}
        </figure>
      );
    }

    case "banner": {
      const c = parsed.data as (typeof SECTION_SCHEMAS)["banner"]["_output"];

      /*
       * A banner keeps SEMANTIC colour, not theme colour.
       *
       * "Cerrado por feriado" has to read as a warning on every site, including
       * one whose brand colour happens to be amber. The tint is the only thing
       * on the public site that ignores the tenant palette, and it does so on
       * purpose.
       */
      const tone = {
        info: { border: "#bfdbfe", background: "#eff6ff", color: "#1e40af" },
        success: { border: "#bbf7d0", background: "#f0fdf4", color: "#166534" },
        warning: { border: "#fde68a", background: "#fffbeb", color: "#92400e" },
      }[c.tone];

      return (
        <section
          className="my-6 border px-5 py-4"
          style={{
            borderColor: tone.border,
            background: tone.background,
            color: tone.color,
            borderRadius: "var(--site-radius)",
          }}
        >
          {c.href !== undefined ? (
            <SafeLink
              href={c.href}
              className="text-sm font-medium underline-offset-4 hover:underline"
            >
              {c.message}
            </SafeLink>
          ) : (
            <p className="text-sm font-medium">{c.message}</p>
          )}
        </section>
      );
    }

    case "cta": {
      const c = parsed.data as (typeof SECTION_SCHEMAS)["cta"]["_output"];
      return (
        <section
          className="my-10 flex flex-col items-center gap-5 px-6 py-12 text-center sm:px-12"
          style={{
            background: "var(--site-primary-soft)",
            borderRadius: "var(--site-radius)",
          }}
        >
          <h2
            className="max-w-2xl text-2xl font-semibold tracking-tight text-balance sm:text-3xl"
            style={{ color: "var(--site-primary)" }}
          >
            {c.heading}
          </h2>
          {c.body.length > 0 ? (
            <p className="max-w-prose" style={{ color: "var(--site-muted)" }}>
              {c.body}
            </p>
          ) : null}
          <SafeLink href={c.buttonHref} className={buttonClass} style={primaryButtonStyle}>
            {c.buttonLabel}
          </SafeLink>
        </section>
      );
    }

    case "gallery": {
      const c = parsed.data as (typeof SECTION_SCHEMAS)["gallery"]["_output"];
      return (
        <section className="flex flex-col gap-5 py-10">
          <Heading>{c.heading}</Heading>
          <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            {c.images
              .filter((image) => assetUrls.has(image.imagePath))
              .map((image, index) => (
                <li key={index}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- see hero */}
                  <img
                    src={assetUrls.get(image.imagePath) ?? ""}
                    alt={image.alt}
                    className="aspect-square w-full object-cover"
                    style={{ borderRadius: "var(--site-radius)" }}
                  />
                </li>
              ))}
          </ul>
        </section>
      );
    }

    case "products": {
      const c = parsed.data as (typeof SECTION_SCHEMAS)["products"]["_output"];

      const all = catalog?.products ?? [];
      // A section pointing at a category that no longer exists shows the whole
      // catalogue rather than an empty block (EC-1108): the business lost a
      // grouping, not its products.
      const matching =
        c.categorySlug === undefined ||
        !all.some((product) => product.categorySlug === c.categorySlug)
          ? all
          : all.filter((product) => product.categorySlug === c.categorySlug);

      // Featured first, then the order the business chose.
      const shown = [...matching]
        .sort(
          (a, b) =>
            Number(b.isFeatured) - Number(a.isFeatured) ||
            a.position - b.position ||
            a.name.localeCompare(b.name),
        )
        .slice(0, c.limit);

      if (shown.length === 0) return null;

      return (
        <section className="flex flex-col gap-6 py-10">
          <Heading>{c.heading}</Heading>
          <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {shown.map((product) => {
              const imageUrl =
                product.imagePath === null ? undefined : assetUrls.get(product.imagePath);

              return (
                <li
                  key={product.id}
                  className="flex flex-col overflow-hidden border transition-transform hover:-translate-y-0.5"
                  style={{
                    borderColor: "var(--site-border)",
                    background: "var(--site-surface)",
                    borderRadius: "var(--site-radius)",
                  }}
                >
                  {imageUrl !== undefined ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={imageUrl}
                      alt={product.name}
                      className="aspect-[4/3] w-full object-cover"
                    />
                  ) : (
                    /* No photo is the common case for a business starting out.
                       A tinted block keeps the grid even instead of leaving
                       one card visibly shorter than its neighbours. */
                    <div
                      aria-hidden
                      className="aspect-[4/3] w-full"
                      style={{ background: "var(--site-accent-soft)" }}
                    />
                  )}

                  <div className="flex flex-1 flex-col gap-2 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <h3 className="font-semibold" style={{ color: "var(--site-foreground)" }}>
                        {product.name}
                      </h3>
                      <span
                        className="shrink-0 font-semibold whitespace-nowrap tabular-nums"
                        style={{ color: "var(--site-primary)" }}
                      >
                        {formatCurrency(product.basePriceCents, catalog?.currency ?? "PEN")}
                      </span>
                    </div>

                    {product.description !== null ? (
                      <p className="text-sm leading-relaxed" style={{ color: "var(--site-muted)" }}>
                        {product.description}
                      </p>
                    ) : null}

                    {!product.isAvailable ? (
                      // Sold out today, still on the menu. Hiding it would tell
                      // a customer the business does not serve this at all.
                      <span
                        className="mt-auto self-start px-2.5 py-1 text-xs font-medium"
                        style={{
                          background: "var(--site-border)",
                          color: "var(--site-muted)",
                          borderRadius: "var(--site-radius)",
                        }}
                      >
                        Agotado por hoy
                      </span>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      );
    }

    case "faq": {
      const c = parsed.data as (typeof SECTION_SCHEMAS)["faq"]["_output"];
      return (
        <section className="flex flex-col gap-5 py-10">
          <Heading>{c.heading}</Heading>
          <dl className="flex flex-col gap-3">
            {c.items.map((item, index) => (
              <div
                key={index}
                className="flex flex-col gap-2 border p-5"
                style={{
                  borderColor: "var(--site-border)",
                  borderRadius: "var(--site-radius)",
                }}
              >
                <dt className="font-semibold" style={{ color: "var(--site-foreground)" }}>
                  {item.question}
                </dt>
                <dd className="max-w-prose leading-relaxed" style={{ color: "var(--site-muted)" }}>
                  {item.answer}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      );
    }

    default:
      return null;
  }
}
