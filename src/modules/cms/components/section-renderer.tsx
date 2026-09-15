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

/**
 * The vertical rhythm every section shares.
 *
 * HALF the style's section space on each side, so the gap between two adjacent
 * sections is exactly one unit of it rather than two. Spacing is the loudest
 * difference between the three themes - `atelier` breathes at up to 9rem and
 * `brasa` at 6 - and hard-coded `py-10` everywhere is why they used to look
 * identical below the fold.
 */
const sectionSpacing: React.CSSProperties = {
  paddingBlock: "calc(var(--site-section-space) / 2)",
};

/**
 * The small capitalised label above a heading.
 *
 * Tracking and case come from the style, not from this file: `atelier` sets it
 * at 0.34em in caps and a theme that wanted sentence case would say so. It is
 * the cheapest piece of typographic craft in the system and the one that most
 * reliably makes a section look composed rather than dumped.
 */
function Eyebrow({ children }: { children: string }) {
  return (
    <span
      className="text-xs font-semibold"
      style={{
        color: "var(--site-accent)",
        letterSpacing: "var(--site-eyebrow-tracking)",
        textTransform: "var(--site-eyebrow-transform)" as "uppercase",
      }}
    >
      {children}
    </span>
  );
}

function Heading({ children, className }: { children: string; className?: string }) {
  if (children.length === 0) return null;
  return (
    <h2
      className={cn("text-3xl text-balance sm:text-4xl", className)}
      style={{
        color: "var(--site-foreground)",
        fontFamily: "var(--site-display-font)",
        fontWeight: "var(--site-display-weight)",
        letterSpacing: "var(--site-display-tracking)",
        lineHeight: "var(--site-display-leading)",
      }}
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
  basePath = "/sitio",
}: {
  href: string;
  children: string;
  className?: string;
  style?: React.CSSProperties;
  /** Where an internal `/sitio/...` link should actually go. See the renderer. */
  basePath?: string;
}) {
  const isExternal = href.startsWith("https://");

  if (isExternal) {
    return (
      <a href={href} target="_blank" rel="noreferrer noopener" className={className} style={style}>
        {children}
      </a>
    );
  }
  // A stored link is written against `/sitio`, which is where a visitor reads
  // it. The preview renders the same content under a different base, and a
  // button that navigated out of the preview would be a dead end.
  const localised =
    href === "/sitio" || href.startsWith("/sitio/") ? `${basePath}${href.slice(6)}` : href;

  return (
    <Link href={localised} className={className} style={style}>
      {children}
    </Link>
  );
}

/** Shared geometry of every call to action. Colour arrives separately. */
const buttonClass =
  "inline-flex h-12 items-center justify-center px-8 text-xs font-semibold transition-opacity hover:opacity-90";

const primaryButtonStyle: React.CSSProperties = {
  background: "var(--site-primary)",
  color: "var(--site-on-primary)",
  // The CHIP radius, not the card one. `--site-radius` is `lg` on Marea, and a
  // 48px-tall button with a 16px radius is a pill nobody asked for.
  borderRadius: "var(--site-radius-chip)",
  letterSpacing: "var(--site-eyebrow-tracking)",
  textTransform: "var(--site-eyebrow-transform)" as "uppercase",
  boxShadow: "var(--site-shadow)",
};

export function SectionRenderer({
  section,
  assetUrls,
  catalog,
  basePath = "/sitio",
}: {
  section: RenderableSection;
  assetUrls: AssetUrls;
  /** Forwarded to every internal link. `/sitio` for a visitor. */
  basePath?: string;
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

      /*
       * THE HERO IS THE PAGE.
       *
       * What was here was a tinted rounded rectangle with a 4xl heading and a
       * 4:3 photograph, identical on every theme, and it is the single reason
       * the product's sites looked like a template. A restaurant is judged on
       * this block: the type size, the space around it, and the shape of the
       * one photograph.
       *
       * Everything that varies now comes from the theme rather than from a
       * branch here - the column track, the photograph's ratio, where the words
       * sit, how far the section breathes. `atelier` resolves to one centred
       * column over a wide establishing shot; `marea` to type beside a tall
       * frame. Same markup, two restaurants.
       *
       * The band survives as a WASH: full-bleed, no radius, and fading to
       * nothing at the bottom instead of ending in a seam. Its job is unchanged
       * - a heading on a bare background was one coloured line of type and
       * nothing else - but see `--site-hero-wash` for why a flat slab of the
       * primary was the wrong way to do it.
       */
      return (
        <section className="relative -mx-6 px-6 sm:-mx-10 sm:px-10" style={sectionSpacing}>
          <div
            aria-hidden
            className="absolute inset-0 -z-10"
            style={{ background: "var(--site-hero-wash)" }}
          />

          <div
            className={cn(
              "grid items-center gap-10",
              image !== undefined && "lg:grid-cols-[var(--site-hero-columns)] lg:gap-16",
            )}
          >
            <div
              className="flex flex-col gap-6"
              style={{
                alignItems: "var(--site-hero-items)" as "center",
                textAlign: "var(--site-hero-align)" as "center",
              }}
            >
              <h1
                className="text-[clamp(2.5rem,6vw,4.5rem)] text-balance"
                style={{
                  color: "var(--site-foreground)",
                  fontFamily: "var(--site-display-font)",
                  fontWeight: "var(--site-display-weight)",
                  letterSpacing: "var(--site-display-tracking)",
                  lineHeight: "var(--site-display-leading)",
                }}
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
                <SafeLink
                  href={c.ctaHref}
                  basePath={basePath}
                  className={cn(buttonClass, "mt-2")}
                  style={primaryButtonStyle}
                >
                  {c.ctaLabel}
                </SafeLink>
              ) : null}
            </div>

            {image !== undefined ? (
              <div className="relative w-full">
                {/* eslint-disable-next-line @next/next/no-img-element -- the asset
                    is a signed URL from Storage, whose host is not known at build
                    time, so next/image cannot be configured for it. */}
                <img
                  src={image}
                  alt=""
                  className="w-full object-cover"
                  style={{
                    aspectRatio: "var(--site-hero-ratio)",
                    borderRadius: "var(--site-radius)",
                    boxShadow: "var(--site-shadow-lifted)",
                  }}
                />
                {/*
                  The photograph fades into the page instead of stopping at a
                  hard edge. The gradient is built from the tenant's own
                  background (`--site-scrim`), so it works on bone and on
                  near-black without either being special-cased.
                */}
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-x-0 bottom-0 h-1/3"
                  style={{
                    background: "var(--site-scrim)",
                    borderBottomLeftRadius: "var(--site-radius)",
                    borderBottomRightRadius: "var(--site-radius)",
                  }}
                />
              </div>
            ) : null}
          </div>
        </section>
      );
    }

    case "text": {
      const c = parsed.data as (typeof SECTION_SCHEMAS)["text"]["_output"];
      return (
        <section className="flex max-w-3xl flex-col gap-5" style={sectionSpacing}>
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
        <figure className="flex flex-col gap-3" style={sectionSpacing}>
          {/* eslint-disable-next-line @next/next/no-img-element -- see hero */}
          <img
            src={assetUrls.get(c.imagePath) ?? ""}
            alt={c.alt}
            className="w-full"
            style={{
              borderRadius: "var(--site-radius)",
              boxShadow: "var(--site-shadow)",
            }}
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
              basePath={basePath}
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
          className="my-10 flex flex-col items-center gap-6 px-6 py-16 text-center sm:px-12"
          style={{
            background: "var(--site-primary-soft)",
            borderRadius: "var(--site-radius)",
            border: "1px solid var(--site-primary-line)",
          }}
        >
          <h2
            className="max-w-2xl text-3xl text-balance sm:text-4xl"
            style={{
              color: "var(--site-primary)",
              fontFamily: "var(--site-display-font)",
              fontWeight: "var(--site-display-weight)",
              letterSpacing: "var(--site-display-tracking)",
              lineHeight: "var(--site-display-leading)",
            }}
          >
            {c.heading}
          </h2>
          {c.body.length > 0 ? (
            <p className="max-w-prose" style={{ color: "var(--site-muted)" }}>
              {c.body}
            </p>
          ) : null}
          <SafeLink
            href={c.buttonHref}
            basePath={basePath}
            className={buttonClass}
            style={primaryButtonStyle}
          >
            {c.buttonLabel}
          </SafeLink>
        </section>
      );
    }

    case "gallery": {
      const c = parsed.data as (typeof SECTION_SCHEMAS)["gallery"]["_output"];
      return (
        <section className="flex flex-col gap-8" style={sectionSpacing}>
          <Heading>{c.heading}</Heading>
          <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 sm:gap-6">
            {c.images
              .filter((image) => assetUrls.has(image.imagePath))
              .map((image, index) => (
                <li
                  key={index}
                  className="group overflow-hidden"
                  style={{ borderRadius: "var(--site-radius)" }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- see hero */}
                  <img
                    src={assetUrls.get(image.imagePath) ?? ""}
                    alt={image.alt}
                    className="w-full object-cover transition-transform duration-500 group-hover:scale-105"
                    style={{
                      // The theme's ratio, so a gallery of a tasting menu is a
                      // column of portraits and a parrilla's is panoramic.
                      aspectRatio: "var(--site-media-ratio)",
                      borderRadius: "var(--site-radius)",
                    }}
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
        <section className="flex flex-col gap-10" style={sectionSpacing}>
          <div className="flex flex-col gap-3">
            <Eyebrow>Nuestra carta</Eyebrow>
            <Heading>{c.heading}</Heading>
          </div>

          <ul className="grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
            {shown.map((product) => {
              const imageUrl =
                product.imagePath === null ? undefined : assetUrls.get(product.imagePath);

              return (
                /*
                 * A DISH, NOT A PRODUCT TILE.
                 *
                 * This was a bordered, tinted, shadowed rectangle with a 4:3
                 * photograph and the price at the bottom - the shape of an
                 * e-commerce grid, which is what made every menu in the product
                 * read as a catalogue of things rather than a carta.
                 *
                 * What changed is what a restaurant's own menu does: the
                 * photograph carries the frame and the type sits on the page
                 * under it, with the name and the price on one line separated by
                 * a leader rule. The box is gone; the elevation the theme asks
                 * for lives on the IMAGE, which is the object worth lifting.
                 */
                <li
                  key={product.id}
                  className={cn("group flex flex-col gap-4", !product.isAvailable && "opacity-70")}
                >
                  <div
                    className="relative overflow-hidden"
                    style={{
                      borderRadius: "var(--site-radius)",
                      boxShadow: "var(--site-shadow)",
                      // On a dark theme the shadow resolves to `none` and this
                      // hairline is what separates the frame from the page.
                      border: "1px solid var(--site-border)",
                    }}
                  >
                    {imageUrl !== undefined ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={imageUrl}
                        alt={product.name}
                        className="w-full object-cover transition-transform duration-500 group-hover:scale-105"
                        style={{ aspectRatio: "var(--site-media-ratio)" }}
                      />
                    ) : (
                      /* No photo is the common case for a business starting
                         out. A tinted block keeps the grid even instead of
                         leaving one card visibly shorter than its neighbours. */
                      <div
                        aria-hidden
                        className="w-full"
                        style={{
                          aspectRatio: "var(--site-media-ratio)",
                          background: "var(--site-accent-soft)",
                        }}
                      />
                    )}

                    {product.isFeatured ? (
                      <span
                        className="absolute top-3 left-3 px-3 py-1 text-[0.625rem] font-semibold"
                        style={{
                          background: "var(--site-accent)",
                          color: "var(--site-on-accent)",
                          borderRadius: "var(--site-radius-chip)",
                          letterSpacing: "var(--site-eyebrow-tracking)",
                          textTransform: "var(--site-eyebrow-transform)" as "uppercase",
                        }}
                      >
                        Recomendado
                      </span>
                    ) : null}

                    {!product.isAvailable ? (
                      // Sold out today, still on the menu. Hiding it would tell
                      // a customer the business does not serve this at all.
                      <span
                        className="absolute top-3 right-3 px-3 py-1 text-[0.625rem] font-semibold"
                        style={{
                          background: "var(--site-background)",
                          color: "var(--site-muted)",
                          borderRadius: "var(--site-radius-chip)",
                          letterSpacing: "var(--site-eyebrow-tracking)",
                          textTransform: "var(--site-eyebrow-transform)" as "uppercase",
                        }}
                      >
                        Agotado hoy
                      </span>
                    ) : null}
                  </div>

                  <div className="flex flex-col gap-2">
                    {/*
                      Name and price on one line, joined by a leader.

                      It is how a printed menu has set a dish for a century, and
                      it answers the two questions a diner has in one eye
                      movement. The rule is a flexible spacer rather than dot
                      leaders, which do not survive a 40-character dish name on
                      a phone.
                    */}
                    <div className="flex items-baseline gap-3">
                      <h3
                        className="text-lg leading-snug"
                        style={{
                          color: "var(--site-foreground)",
                          fontFamily: "var(--site-display-font)",
                          fontWeight: "var(--site-display-weight)",
                          letterSpacing: "var(--site-display-tracking)",
                        }}
                      >
                        {product.name}
                      </h3>
                      <span
                        aria-hidden
                        className="min-w-4 flex-1"
                        style={{ borderBottom: "1px solid var(--site-border)" }}
                      />
                      <span
                        className="shrink-0 text-base font-semibold tabular-nums"
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
        <section className="flex max-w-3xl flex-col gap-8" style={sectionSpacing}>
          <Heading>{c.heading}</Heading>
          <dl className="flex flex-col">
            {c.items.map((item, index) => (
              <div
                key={index}
                className="flex flex-col gap-2 py-6 first:pt-0"
                style={{
                  // A rule between answers, not a box around each one. Six
                  // bordered rectangles stacked vertically read as a form;
                  // hairlines read as a printed page.
                  borderTop: index === 0 ? "none" : "1px solid var(--site-border)",
                }}
              >
                <dt
                  className="text-lg"
                  style={{
                    color: "var(--site-foreground)",
                    fontFamily: "var(--site-display-font)",
                    fontWeight: "var(--site-display-weight)",
                    letterSpacing: "var(--site-display-tracking)",
                  }}
                >
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
