import Image from "next/image";
import { DEMO_RESTAURANT } from "../../landing-data";
import { LANDING_IMAGES } from "../../landing-images";

/**
 * A restaurant's own website, drawn inside a browser frame.
 *
 * WHAT THIS IS SELLING. The product's single hardest thing to explain is that a
 * restaurant gets a REAL website, not a listing on somebody's marketplace. A
 * browser frame says that in less time than a sentence can: the address bar is
 * the argument.
 *
 * WHY IT IS MARKUP AND NOT A SCREENSHOT. A PNG of a website goes stale the
 * afternoon the product's own site renderer changes, weighs several hundred
 * kilobytes, and is unreadable to a screen reader and to Google. This is a few
 * kilobytes of HTML that stays crisp on a phone and on a 5K display, and it is
 * marked `aria-hidden` because it is an ILLUSTRATION - the surrounding section
 * says in words what it shows.
 */
export function BrowserMockup() {
  return (
    <div
      aria-hidden
      className="border-border/70 bg-card shadow-e3 overflow-hidden rounded-2xl border select-none"
    >
      {/* ------------------------------------------------------ browser chrome */}
      <div className="border-border/70 bg-surface flex items-center gap-3 border-b px-4 py-3">
        <div className="flex gap-1.5">
          {["bg-destructive/40", "bg-warning/40", "bg-success/40"].map((tone) => (
            <span key={tone} className={`size-2.5 rounded-full ${tone}`} />
          ))}
        </div>
        {/* The address bar. The whole point of drawing a browser at all. */}
        <div className="bg-background border-border/70 text-muted-foreground flex-1 truncate rounded-md border px-3 py-1 text-center text-[0.6875rem]">
          costanorte.pe
        </div>
      </div>

      {/* ------------------------------------------------ the restaurant's site */}
      <div className="bg-card">
        <div className="border-border/60 flex items-center justify-between gap-4 border-b px-5 py-3.5">
          <div className="leading-none">
            <p className="text-ink text-sm font-semibold tracking-[0.12em]">
              {DEMO_RESTAURANT.name}
            </p>
            <p className="text-muted-foreground mt-1 text-[0.625rem] tracking-[0.18em] uppercase">
              {DEMO_RESTAURANT.kind}
            </p>
          </div>

          <div className="hidden items-center gap-4 sm:flex">
            {DEMO_RESTAURANT.nav.map((item) => (
              <span key={item} className="text-muted-foreground text-[0.6875rem]">
                {item}
              </span>
            ))}
            <span className="bg-ink rounded-md px-3 py-1.5 text-[0.6875rem] font-medium text-white">
              Pedir ahora
            </span>
          </div>
        </div>

        {/* The restaurant's own hero: photograph, scrim, type on top. */}
        <div className="relative">
          <Image
            src={LANDING_IMAGES.heroDish.src}
            alt=""
            width={1200}
            height={640}
            sizes="(max-width: 1024px) 92vw, 640px"
            className="h-44 w-full object-cover sm:h-56"
            priority
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/30 to-transparent" />
          <div className="absolute inset-x-0 bottom-0 flex flex-col items-start gap-2 p-5 sm:p-6">
            <p className="type-display max-w-[16ch] text-xl text-balance text-white sm:text-2xl">
              {DEMO_RESTAURANT.heroHeading}
            </p>
            <p className="hidden max-w-[38ch] text-[0.6875rem] leading-relaxed text-white/80 sm:block">
              {DEMO_RESTAURANT.heroBody}
            </p>
            <span className="mt-1 rounded-lg bg-white px-4 py-2 text-[0.6875rem] font-semibold text-neutral-900">
              {DEMO_RESTAURANT.heroCta} →
            </span>
          </div>
        </div>

        {/* The carta. Four real dishes at real prices - see `landing-data.ts`. */}
        <div className="p-5 sm:p-6">
          <p className="text-ink mb-3 text-xs font-semibold">{DEMO_RESTAURANT.menuHeading}</p>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {DEMO_RESTAURANT.dishes.map((dish) => (
              <li
                key={dish.name}
                className="border-border/60 overflow-hidden rounded-lg border bg-white"
              >
                <Image
                  src={dish.image.src}
                  alt=""
                  width={320}
                  height={240}
                  sizes="160px"
                  className="h-12 w-full object-cover sm:h-14"
                />
                <div className="p-2">
                  <p className="text-ink truncate text-[0.625rem] font-medium">{dish.name}</p>
                  <p className="text-brand-700 text-[0.625rem] font-semibold tabular-nums">
                    {dish.price}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
