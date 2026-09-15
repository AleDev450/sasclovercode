import Image from "next/image";
import Link from "next/link";
import { buttonVariants } from "@/components/ui";
import { IconArrowRight, IconCheck } from "@/components/ui/icons";
import { LANDING_IMAGES } from "../../landing-images";
import { PeruFlag } from "./peru-flag";

/** The three reassurances beside the closing CTA. */
const ASSURANCES = ["Sin permanencia", "Soporte en espanol"] as const;

/**
 * The last thing on the page before the footer.
 *
 * A DARK SECTION ON PURPOSE. Everything above it is a warm near-white, and the
 * page needs one moment of weight at the end or the final ask reads as just
 * another band. The photograph is a dining room, heavily overlaid, so it sets a
 * mood without competing with the words - the overlay is two layers, a teal
 * tint for the brand and a near-black gradient for the contrast the text needs.
 *
 * WHAT IT DOES NOT CLAIM. "Unete a restaurantes peruanos que estan
 * modernizando..." is a description of what the product is for, not a count of
 * anybody. No "+500 negocios", no logos, no testimonials, for the reason the
 * rest of this page holds to: an invented number is the first lie.
 */
export function FinalCta() {
  return (
    <section className="relative overflow-hidden">
      <Image
        src={LANDING_IMAGES.diningRoom.src}
        alt={LANDING_IMAGES.diningRoom.alt}
        fill
        sizes="100vw"
        className="object-cover"
      />
      <div aria-hidden className="absolute inset-0 bg-neutral-950/82" />
      <div
        aria-hidden
        className="from-brand-950/70 absolute inset-0 bg-gradient-to-br to-transparent"
      />

      <div className="relative mx-auto grid max-w-[1280px] items-center gap-10 px-6 py-20 sm:px-8 lg:grid-cols-[auto_1fr_auto] lg:gap-14 lg:py-28 xl:px-12">
        {/* The person. Hidden on small screens, where the headline needs the
            whole width more than the page needs a portrait. */}
        <div className="hidden lg:block">
          <Image
            src={LANDING_IMAGES.chef.src}
            alt={LANDING_IMAGES.chef.alt}
            width={600}
            height={720}
            sizes="220px"
            className="shadow-e3 aspect-[5/6] w-[220px] rounded-[1.5rem] object-cover"
          />
        </div>

        <div className="reveal max-w-2xl">
          <h2 className="type-display text-[2.25rem] text-balance text-white sm:text-[3rem]">
            Tu proxima mesa tambien puede vender mas.
          </h2>
          <p className="mt-5 max-w-[52ch] text-base leading-relaxed text-white/70 sm:text-lg">
            Unete a restaurantes peruanos que estan modernizando sus ventas y operaciones con
            Vendra.
          </p>

          <Link
            href="#contacto"
            className={buttonVariants({
              variant: "brand",
              size: "xl",
              className: "group mt-8",
            })}
          >
            Crear mi restaurante
            <IconArrowRight className="transition-transform duration-200 group-hover:translate-x-0.5" />
          </Link>
        </div>

        <ul className="flex shrink-0 flex-col gap-3 lg:pr-2">
          {ASSURANCES.map((item) => (
            <li key={item} className="flex items-center gap-2 text-sm text-white/85">
              <IconCheck className="text-brand-400 size-4 shrink-0" />
              {item}
            </li>
          ))}
          <li className="flex items-center gap-2 text-sm text-white/85">
            <PeruFlag className="h-3.5" />
            Hecho en Peru
          </li>
        </ul>
      </div>
    </section>
  );
}
