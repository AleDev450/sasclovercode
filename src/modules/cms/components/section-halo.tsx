/**
 * A halo of brand light behind a block, bleeding in from one side.
 *
 * The light of the site this product is measured against: a 900px disc of the
 * brand, darkened, sitting half off the edge of the page behind the content.
 * Its colour and falloff are `--site-halo` (`modules/seo/theme.ts`), which is
 * `none` on every style that does not want one - so this element costs a
 * layout box and paints nothing there, and the call sites never ask which
 * style they are in.
 *
 * The parent has to be `relative isolate`: `isolate` gives it its own stacking
 * context, which is what lets `-z-10` put the halo BEHIND the block's content
 * without sending it behind the page background as well.
 */
export function SectionHalo({ side }: { side: "left" | "right" }) {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute top-1/2 -z-10 size-[56rem] max-w-none -translate-y-1/2 rounded-full"
      style={{
        background: "var(--site-halo)",
        // A quarter of it off the page, the way the reference sets it: the
        // light reads as coming from beyond the edge rather than as a shape.
        ...(side === "right" ? { right: "-22rem" } : { left: "-22rem" }),
      }}
    />
  );
}

/**
 * Which blocks of a page get a halo, and from which side.
 *
 * Not every one: a halo behind every section is not light, it is a tinted page.
 * The first block when it is not the cover (a page that opens on type, like
 * the FAQ, needs its light there), and then every other block, alternating
 * sides so the light moves as the page scrolls. Never the slider: a
 * full-bleed photograph covers it completely.
 */
export function haloFor(index: number, type: string): "left" | "right" | null {
  if (type === "slider") return null;
  if (index === 0) return "right";
  if (index % 2 === 0) return null;
  return index % 4 === 1 ? "right" : "left";
}
