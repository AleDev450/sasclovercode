import Image from "next/image";
import { cn } from "@/lib/utils";
import { PRODUCT_NAME, VENDOR_NAME } from "@/config/app";

/**
 * The brand marks.
 *
 * TWO IDENTITIES, AND KEEPING THEM APART MATTERS. `Tu Tiendita` is the product
 * a shop owner buys; `CloverCode` is the company that makes it. A screen inside
 * the product wears the product mark, and the company mark appears where
 * authorship is the point - the landing footer, the platform console header.
 * Mixing them is how a customer ends up thinking they bought "a CloverCode".
 *
 * The clover glyph is shared by both, because it is the company mark the
 * product inherits, and it is the one piece of the identity that is genuinely
 * the same object.
 *
 * ASSETS. `public/brand/` holds four files derived from the original logo
 * artwork: the clover on its own in teal and in white, and the CloverCode
 * wordmark with dark ink and with white ink. Which one to use is decided by
 * the SURFACE it sits on, never by the theme alone - a white logo on the teal
 * hero is correct in light mode too.
 */

/** Intrinsic size of `clover-mark.png`, so `next/image` never guesses. */
const MARK_ASPECT = { width: 161, height: 156 } as const;

/** Intrinsic size of the wordmark files. */
const WORDMARK_ASPECT = { width: 639, height: 274 } as const;

export interface CloverMarkProps {
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

export function CloverMark({ tone = "teal", className, label }: CloverMarkProps) {
  const src = tone === "white" ? "/brand/clover-mark-white.png" : "/brand/clover-mark.png";

  return (
    <Image
      src={src}
      alt={label ?? ""}
      aria-hidden={label === undefined ? true : undefined}
      // The INTRINSIC dimensions Next.js needs to reserve space. What the
      // browser actually draws comes from `className`.
      width={MARK_ASPECT.width}
      height={MARK_ASPECT.height}
      // `unoptimized` because these are already small, hand-tuned PNGs with
      // alpha; running them through the optimiser costs a function invocation
      // per variant and gains nothing measurable.
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
   * Adds the `por CloverCode` credit under the name. The landing header and
   * the sign-in screen use it; a dashboard sidebar does not need it on every
   * page view.
   */
  withVendor?: boolean;
}

const PRODUCT_SIZES = {
  sm: { mark: "size-6", name: "text-sm", vendor: "text-[0.625rem]" },
  md: { mark: "size-8", name: "text-lg", vendor: "text-[0.6875rem]" },
  lg: { mark: "size-11", name: "text-2xl", vendor: "text-xs" },
} as const;

/**
 * The product lockup: clover glyph + `Tu Tiendita`.
 *
 * The name is TEXT, not an image. It scales with the user font size, it is
 * selectable, it is in the accessibility tree without an `alt`, and it costs
 * no request - all of which an image of a word does not do.
 */
export function ProductLogo({
  tone = "default",
  size = "md",
  className,
  withVendor = false,
}: ProductLogoProps) {
  const s = PRODUCT_SIZES[size];
  const inverted = tone === "inverted";

  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <CloverMark tone={inverted ? "white" : "teal"} className={s.mark} />
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
        {withVendor ? (
          <span
            className={cn(
              "mt-1 font-medium tracking-wide uppercase",
              s.vendor,
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

export interface CloverWordmarkProps {
  /** `default` for light surfaces, `inverted` for dark ones. */
  tone?: "default" | "inverted";
  /** The drawn width, e.g. `w-36`. The height follows the aspect ratio. */
  className?: string;
}

/**
 * The full CloverCode wordmark, as artwork.
 *
 * This one IS an image, because it is a drawn logotype with a bespoke glyph -
 * reproducing it with a web font would produce something that is nearly the
 * logo, which is worse than an image.
 */
export function CloverWordmark({ tone = "default", className }: CloverWordmarkProps) {
  const src =
    tone === "inverted"
      ? "/brand/clovercode-wordmark-light.png"
      : "/brand/clovercode-wordmark-dark.png";

  return (
    <Image
      src={src}
      alt={VENDOR_NAME}
      width={WORDMARK_ASPECT.width}
      height={WORDMARK_ASPECT.height}
      unoptimized
      className={cn("h-auto object-contain", className)}
    />
  );
}
