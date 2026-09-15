import Image from "next/image";
import { IconArrowUpRight } from "@/components/ui/icons";
import { SHOWCASE_RESTAURANTS } from "../../landing-data";

/**
 * Three restaurants that could be theirs.
 *
 * WHY FICTIONAL, AND WHY THAT IS SAID OUT LOUD. Real customer names would be
 * better and the product does not have permission to use any, so these are
 * three plausible Peruvian restaurants - a cevicheria, a parrilla, a cafe -
 * which is also the three market segments the pitch is aimed at. The section
 * heading frames them as what a visitor's site COULD look like ("tu restaurante
 * merece una experiencia asi"), never as a client list. A landing page that
 * opens with a fabricated customer has already told its first lie.
 *
 * Each card is a link in shape but not in fact: these domains do not resolve.
 * The footer row shows the address as TEXT with an arrow glyph, which reads as
 * "this is what your address would look like" without promising a destination -
 * an `<a>` to `marea.pe` would be a broken link on the product's main page.
 */
export function RestaurantShowcase() {
  return (
    <section id="soluciones" className="bg-surface border-border scroll-mt-24 border-y">
      <div className="mx-auto max-w-[1280px] px-6 py-20 sm:px-8 lg:py-28 xl:px-12">
        <div className="reveal max-w-2xl">
          <h2 className="type-display text-ink text-[2rem] text-balance sm:text-[2.6rem]">
            Tu restaurante merece una experiencia asi.
          </h2>
          <p className="text-muted-foreground mt-4 text-base leading-relaxed sm:text-lg">
            Disenos atractivos. Mas pedidos. Mejor experiencia para tus comensales.
          </p>
        </div>

        <ul className="reveal mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {SHOWCASE_RESTAURANTS.map((restaurant) => (
            <li
              key={restaurant.name}
              className="group border-border/70 bg-card shadow-e1 hover:shadow-e3 overflow-hidden rounded-[1.25rem] border transition-[box-shadow,transform] duration-300 hover:-translate-y-1"
            >
              <div className="relative aspect-[4/5] overflow-hidden">
                <Image
                  src={restaurant.image.src}
                  alt={restaurant.image.alt}
                  fill
                  sizes="(max-width: 640px) 90vw, (max-width: 1024px) 45vw, 400px"
                  className="object-cover transition-transform duration-500 group-hover:scale-[1.04]"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/35 to-black/10" />

                <span className="absolute top-4 left-4 rounded-full bg-white/15 px-3 py-1 text-[0.6875rem] font-medium text-white backdrop-blur-sm">
                  {restaurant.tag}
                </span>

                <div className="absolute inset-x-0 bottom-0 p-5">
                  <p className="text-[0.6875rem] tracking-[0.22em] text-white/70 uppercase">
                    {restaurant.kind}
                  </p>
                  <p className="mt-1 text-lg font-semibold tracking-[0.06em] text-white">
                    {restaurant.name}
                  </p>
                  <p className="type-display mt-3 max-w-[14ch] text-2xl text-balance text-white">
                    {restaurant.headline}
                  </p>
                </div>
              </div>

              <p className="text-muted-foreground flex items-center justify-between gap-2 px-5 py-4 text-sm">
                {restaurant.domain}
                <IconArrowUpRight className="size-4 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
              </p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
