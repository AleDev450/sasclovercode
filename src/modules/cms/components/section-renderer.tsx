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

function Heading({ children }: { children: string }) {
  if (children.length === 0) return null;
  return <h2 className="text-2xl font-semibold tracking-tight">{children}</h2>;
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
}: {
  href: string;
  children: string;
  className?: string;
}) {
  const isExternal = href.startsWith("https://");

  if (isExternal) {
    return (
      <a href={href} target="_blank" rel="noreferrer noopener" className={className}>
        {children}
      </a>
    );
  }
  return (
    <Link href={href} className={className}>
      {children}
    </Link>
  );
}

const buttonClass =
  "bg-primary text-primary-foreground inline-flex h-10 items-center rounded-md px-5 text-sm font-medium";

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
      return (
        <section className="flex flex-col items-start gap-4 py-12">
          <h1 className="text-4xl font-semibold tracking-tight">{c.heading}</h1>
          {c.subheading.length > 0 ? (
            <p className="text-muted-foreground max-w-prose text-lg">{c.subheading}</p>
          ) : null}
          {c.imagePath !== undefined && assetUrls.has(c.imagePath) ? (
            /* eslint-disable-next-line @next/next/no-img-element -- the asset is
               a signed URL from Storage, whose host is not known at build time,
               so next/image cannot be configured for it until Phase 09. */
            <img
              src={assetUrls.get(c.imagePath) ?? ""}
              alt=""
              className="w-full rounded-lg object-cover"
            />
          ) : null}
          {c.ctaLabel.length > 0 && c.ctaHref !== undefined ? (
            <SafeLink href={c.ctaHref} className={buttonClass}>
              {c.ctaLabel}
            </SafeLink>
          ) : null}
        </section>
      );
    }

    case "text": {
      const c = parsed.data as (typeof SECTION_SCHEMAS)["text"]["_output"];
      return (
        <section className="flex flex-col gap-4 py-8">
          <Heading>{c.heading}</Heading>
          {/* One <p> per stored paragraph. Line structure survives without any
              markup ever being stored. */}
          {c.paragraphs.map((paragraph, index) => (
            <p key={index} className="max-w-prose leading-relaxed">
              {paragraph}
            </p>
          ))}
        </section>
      );
    }

    case "image": {
      const c = parsed.data as (typeof SECTION_SCHEMAS)["image"]["_output"];
      return (
        <figure className="flex flex-col gap-2 py-8">
          {/* eslint-disable-next-line @next/next/no-img-element -- see hero */}
          <img src={assetUrls.get(c.imagePath) ?? ""} alt={c.alt} className="w-full rounded-lg" />
          {c.caption.length > 0 ? (
            <figcaption className="text-muted-foreground text-sm">{c.caption}</figcaption>
          ) : null}
        </figure>
      );
    }

    case "banner": {
      const c = parsed.data as (typeof SECTION_SCHEMAS)["banner"]["_output"];
      const tone = {
        info: "border-info/30 bg-info/10",
        success: "border-success/30 bg-success/10",
        warning: "border-warning/30 bg-warning/10",
      }[c.tone];

      return (
        <section className={cn("my-6 rounded-lg border px-4 py-3", tone)}>
          {c.href !== undefined ? (
            <SafeLink href={c.href} className="text-sm underline-offset-4 hover:underline">
              {c.message}
            </SafeLink>
          ) : (
            <p className="text-sm">{c.message}</p>
          )}
        </section>
      );
    }

    case "cta": {
      const c = parsed.data as (typeof SECTION_SCHEMAS)["cta"]["_output"];
      return (
        <section className="border-border my-8 flex flex-col items-start gap-4 rounded-lg border p-8">
          <h2 className="text-2xl font-semibold tracking-tight">{c.heading}</h2>
          {c.body.length > 0 ? <p className="text-muted-foreground max-w-prose">{c.body}</p> : null}
          <SafeLink href={c.buttonHref} className={buttonClass}>
            {c.buttonLabel}
          </SafeLink>
        </section>
      );
    }

    case "gallery": {
      const c = parsed.data as (typeof SECTION_SCHEMAS)["gallery"]["_output"];
      return (
        <section className="flex flex-col gap-4 py-8">
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
                    className="aspect-square w-full rounded-md object-cover"
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
        <section className="flex flex-col gap-4 py-8">
          <Heading>{c.heading}</Heading>
          <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {shown.map((product) => {
              const imageUrl =
                product.imagePath === null ? undefined : assetUrls.get(product.imagePath);
              return (
                <li key={product.id} className="flex flex-col gap-2">
                  {imageUrl !== undefined ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={imageUrl}
                      alt={product.name}
                      className="aspect-[4/3] w-full rounded-md object-cover"
                    />
                  ) : null}
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="text-sm font-medium">{product.name}</h3>
                    <span className="font-mono text-sm whitespace-nowrap tabular-nums">
                      {formatCurrency(product.basePriceCents, catalog?.currency ?? "PEN")}
                    </span>
                  </div>
                  {product.description !== null ? (
                    <p className="text-muted-foreground max-w-prose text-sm">
                      {product.description}
                    </p>
                  ) : null}
                  {!product.isAvailable ? (
                    // Sold out today, still on the menu. Hiding it would tell a
                    // customer the business does not serve this at all.
                    <span className="text-muted-foreground text-xs">Agotado por hoy</span>
                  ) : null}
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
        <section className="flex flex-col gap-4 py-8">
          <Heading>{c.heading}</Heading>
          <dl className="flex flex-col gap-4">
            {c.items.map((item, index) => (
              <div key={index} className="flex flex-col gap-1">
                <dt className="font-medium">{item.question}</dt>
                <dd className="text-muted-foreground max-w-prose">{item.answer}</dd>
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
