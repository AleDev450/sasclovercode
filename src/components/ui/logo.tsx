import Image from "next/image";
import { cn } from "@/lib/utils";
import { PRODUCT_NAME, PRODUCT_SLOGAN, VENDOR_NAME } from "@/config/app";

/**
 * The brand marks.
 *
 * TWO IDENTITIES, AND KEEPING THEM APART MATTERS. `Vendra` is the product a
 * shop owner buys; `Clover Code` is the company that makes it. A screen inside
 * the product wears the product mark, and the company mark appears where
 * authorship is the point - the landing footer, the platform console header.
 * Mixing them is how a customer ends up thinking they bought "a CloverCode".
 *
 * They have SEPARATE GLYPHS: a shopping cart for Vendra, a clover for Clover
 * Code. Both are drawn in the same teal and both carry the same corner bracket,
 * so the pair reads as a family without either standing in for the other.
 *
 * ASSETS. `public/brand/` holds two sets of four. Per identity: the glyph alone
 * in teal and in white, and the full wordmark with dark ink and with white ink.
 * Which one to use is decided by the SURFACE it sits on, never by the theme
 * alone - a white logo on the teal hero is correct in light mode too.
 */

/** Intrinsic sizes, so `next/image` never guesses and never reflows. */
const VENDRA_MARK_ASPECT = { width: 419, height: 329 } as const;
const VENDRA_WORDMARK_ASPECT = { width: 1444, height: 331 } as const;
const CLOVER_MARK_ASPECT = { width: 161, height: 156 } as const;
const CLOVER_WORDMARK_ASPECT = { width: 639, height: 274 } as const;

export interface MarkProps {
  /** `teal` on light surfaces, `white` on the teal or ink ones. */
  tone?: "teal" | "white";
  /** The drawn box. Pass a Tailwind size, e.g. `size-8`. */
  className?: string;
  /**
   * Set only when the mark is the sole content of a link or button. Inside a
   * lockup that already spells the name out, the mark is decorative and must
   * stay silent so a screen reader does not read the brand twice.
   */
  label?: string;
}

/**
 * The Vendra cart.
 *
 * Wider than it is tall, unlike the clover - so it takes `h-*` rather than
 * `size-*` at call sites that care about optical balance.
 */
export function VendraMark({ tone = "teal", className, label }: MarkProps) {
  const src = tone === "white" ? "/brand/vendra-mark-white.png" : "/brand/vendra-mark.png";

  return (
    <Image
      src={src}
      alt={label ?? ""}
      aria-hidden={label === undefined ? true : undefined}
      // The INTRINSIC dimensions Next.js needs to reserve space. What the
      // browser actually draws comes from `className`.
      width={VENDRA_MARK_ASPECT.width}
      height={VENDRA_MARK_ASPECT.height}
      // `unoptimized` because these are already small, hand-tuned PNGs with
      // alpha; running them through the optimiser costs a function invocation
      // per variant and gains nothing measurable.
      unoptimized
      className={cn("w-auto object-contain", className)}
    />
  );
}

/** The Clover Code clover. The COMPANY mark - see the note at the top. */
export function CloverMark({ tone = "teal", className, label }: MarkProps) {
  const src = tone === "white" ? "/brand/clover-mark-white.png" : "/brand/clover-mark.png";

  return (
    <Image
      src={src}
      alt={label ?? ""}
      aria-hidden={label === undefined ? true : undefined}
      width={CLOVER_MARK_ASPECT.width}
      height={CLOVER_MARK_ASPECT.height}
      unoptimized
      className={cn("object-contain", className)}
    />
  );
}

export interface ProductLogoProps {
  /** `default` on light surfaces; `inverted` on the ink and teal ones. */
  tone?: "default" | "inverted";
  size?: "sm" | "md" | "lg";
  className?: string;
  /**
   * Adds `Vende. Gestiona. Crece.` under the name, as the artwork has it. For
   * a first impression - the landing header, the sign-in screen - not for a
   * dashboard sidebar that shows it on every page view.
   */
  withSlogan?: boolean;
  /** Adds the `por Clover Code` credit instead. Mutually exclusive in practice. */
  withVendor?: boolean;
}

const PRODUCT_SIZES = {
  sm: { mark: "h-5", name: "text-sm", sub: "text-[0.5625rem]" },
  md: { mark: "h-7", name: "text-lg", sub: "text-[0.625rem]" },
  lg: { mark: "h-10", name: "text-2xl", sub: "text-xs" },
} as const;

/**
 * The product lockup: the cart + `Vendra`.
 *
 * The name is TEXT, not an image. It scales with the user font size, it is
 * selectable, it is in the accessibility tree without an `alt`, and it costs no
 * request - none of which an image of a word does. `VendraWordmark` below is
 * the artwork, for the few places that want the real logotype.
 */
export function ProductLogo({
  tone = "default",
  size = "md",
  className,
  withSlogan = false,
  withVendor = false,
}: ProductLogoProps) {
  const s = PRODUCT_SIZES[size];
  const inverted = tone === "inverted";

  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <VendraMark tone={inverted ? "white" : "teal"} className={s.mark} />
      <span className="flex flex-col leading-none">
        <span
          className={cn(
            "font-semibold tracking-tight",
            s.name,
            inverted ? "text-white" : "text-foreground",
          )}
        >
          {PRODUCT_NAME}
        </span>
        {withSlogan ? (
          <span
            className={cn(
              "mt-1 font-medium",
              s.sub,
              inverted ? "text-white/70" : "text-muted-foreground",
            )}
          >
            {PRODUCT_SLOGAN}
          </span>
        ) : withVendor ? (
          <span
            className={cn(
              "mt-1 font-medium tracking-wide uppercase",
              s.sub,
              inverted ? "text-white/60" : "text-muted-foreground",
            )}
          >
            por {VENDOR_NAME}
          </span>
        ) : null}
      </span>
    </span>
  );
}

export interface WordmarkProps {
  /** `default` for light surfaces, `inverted` for dark ones. */
  tone?: "default" | "inverted";
  /** The drawn width, e.g. `w-36`. The height follows the aspect ratio. */
  className?: string;
}

/**
 * The full Vendra logotype, as artwork - cart, name and slogan together.
 *
 * An image rather than text, because it is a drawn logotype with bespoke
 * letterforms; reproducing it with a web font would produce something that is
 * NEARLY the logo, which is worse than an image. Use `ProductLogo` anywhere the
 * mark has to sit inline with interface type.
 */
export function VendraWordmark({ tone = "default", className }: WordmarkProps) {
  const src =
    tone === "inverted" ? "/brand/vendra-wordmark-light.png" : "/brand/vendra-wordmark-dark.png";

  return (
    <Image
      src={src}
      alt={`${PRODUCT_NAME} — ${PRODUCT_SLOGAN}`}
      width={VENDRA_WORDMARK_ASPECT.width}
      height={VENDRA_WORDMARK_ASPECT.height}
      unoptimized
      priority
      className={cn("h-auto object-contain", className)}
    />
  );
}

/** The full Clover Code wordmark, as artwork. The COMPANY logotype. */
export function CloverWordmark({ tone = "default", className }: WordmarkProps) {
  const src =
    tone === "inverted"
      ? "/brand/clovercode-wordmark-light.png"
      : "/brand/clovercode-wordmark-dark.png";

  return (
    <Image
      src={src}
      alt={VENDOR_NAME}
      width={CLOVER_WORDMARK_ASPECT.width}
      height={CLOVER_WORDMARK_ASPECT.height}
      unoptimized
      className={cn("h-auto object-contain", className)}
    />
  );
}
