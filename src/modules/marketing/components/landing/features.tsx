import Link from "next/link";
import { IconArrowRight } from "@/components/ui/icons";
import { FEATURES } from "../../landing-data";

/**
 * The six capabilities, as a 3x2 grid.
 *
 * Every one of them names software this repository actually ships - the KDS is
 * `modules/kitchen`, the QR ordering is `modules/orders`, the invoicing is
 * `modules/billing`. That constraint is the reason the list stops at six: there
 * are more modules, and the ones left out are the ones a restaurant owner would
 * not recognise from the name.
 */
export function Features() {
  return (
    <section id="producto" className="scroll-mt-24">
      <div className="mx-auto max-w-[1280px] px-6 py-20 sm:px-8 lg:py-28 xl:px-12">
        <div className="reveal flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
          <h2 className="type-display text-ink max-w-[18ch] text-[2rem] text-balance sm:text-[2.6rem]">
            Todo lo que necesitas para vender y operar mejor
          </h2>
          <Link
            href="#planes"
            className="text-primary group inline-flex shrink-0 items-center gap-1.5 text-sm font-medium hover:underline"
          >
            Ver todas las soluciones
            <IconArrowRight className="size-4 transition-transform duration-200 group-hover:translate-x-0.5" />
          </Link>
        </div>

        <ul className="reveal mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(({ title, body, Icon }) => (
            <li
              key={title}
              className="group border-border/70 bg-card shadow-e1 hover:border-primary/30 hover:shadow-e2 rounded-[1.25rem] border p-6 transition-[box-shadow,border-color,transform] duration-300 hover:-translate-y-0.5"
            >
              <span className="bg-brand-50 text-brand-700 group-hover:bg-brand-100 flex size-12 items-center justify-center rounded-full transition-colors duration-300">
                <Icon className="size-5.5" />
              </span>
              <h3 className="text-ink mt-5 text-base font-semibold">{title}</h3>
              <p className="text-muted-foreground mt-2 text-sm leading-relaxed">{body}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
