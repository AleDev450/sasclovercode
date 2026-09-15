import Image from "next/image";
import {
  IconArrowRight,
  IconCard,
  IconCheck,
  IconChart,
  IconChef,
  IconMonitor,
  IconReceipt,
  IconWhatsApp,
} from "@/components/ui/icons";
import {
  PROBLEM_LABELS,
  PROBLEM_MESSAGES,
  SOLUTION_CHECKLIST,
  SOLUTION_FLOW,
} from "../../landing-data";
import { LANDING_IMAGES } from "../../landing-images";

/** One icon per step of the flow, in the order `SOLUTION_FLOW` declares them. */
const FLOW_ICONS = [IconMonitor, IconReceipt, IconChef, IconCard, IconChart] as const;

/**
 * Before and after, side by side.
 *
 * THE CONVERSION SECTION, and the one that has to be SEEN rather than read. The
 * left panel is what a visitor's Tuesday actually looks like - a phone full of
 * WhatsApp messages and notes on paper - and the right is the same Tuesday
 * through the product. Two columns of bullet points would make the identical
 * argument and none of the impression.
 *
 * WHY THE LEFT PANEL IS WARM AND NOT RED. It is describing how the visitor
 * works today, which is not a failure - it is how almost every restaurant in
 * Peru works, and a panel that reads as an accusation makes them defensive
 * rather than curious. Warm beige is "this is hard", red would be "you are
 * doing it wrong".
 */
export function Transformation() {
  return (
    <section id="como-funciona" className="relative scroll-mt-24 overflow-hidden">
      {/* The gradient the brief asks for: teal to nothing, extremely subtle. */}
      <div
        aria-hidden
        className="from-brand-50/70 absolute inset-0 bg-gradient-to-b via-transparent to-transparent"
      />

      <div className="relative mx-auto max-w-[1280px] px-6 py-20 sm:px-8 lg:py-28 xl:px-12">
        <div className="reveal max-w-3xl">
          <h2 className="type-display text-ink text-[2rem] text-balance sm:text-[2.6rem]">
            De pedidos por WhatsApp y papel a una operacion ordenada.
          </h2>
          <p className="text-muted-foreground mt-4 text-base leading-relaxed sm:text-lg">
            Deja el caos atras. Lleva tu restaurante al siguiente nivel con Vendra.
          </p>
        </div>

        <div className="reveal mt-12 grid gap-6 lg:grid-cols-2">
          {/* ------------------------------------------------------- before */}
          <div className="border-border/70 flex flex-col overflow-hidden rounded-[1.5rem] border bg-[oklch(0.972_0.012_60)] p-6 sm:p-8">
            <h3 className="text-ink text-lg font-semibold">Asi opera la mayoria hoy:</h3>

            <div className="relative mt-6">
              <Image
                src={LANDING_IMAGES.kitchenRush.src}
                alt={LANDING_IMAGES.kitchenRush.alt}
                width={800}
                height={520}
                sizes="(max-width: 1024px) 90vw, 560px"
                className="aspect-[4/3] w-full rounded-2xl object-cover"
              />
              <div aria-hidden className="absolute inset-0 rounded-2xl bg-neutral-900/25" />

              {/*
                The messages, floating over the photograph.

                `aria-hidden` on the decorative stack: the three of them are one
                idea - "your phone never stops" - and reading them out one by
                one to a screen reader is noise. The heading above already says
                it.
              */}
              <ul aria-hidden className="absolute inset-x-4 top-4 flex flex-col gap-2">
                {PROBLEM_MESSAGES.map((message, index) => (
                  <li
                    key={message}
                    className={`shadow-e2 flex max-w-[82%] items-center gap-2 rounded-xl bg-white px-3 py-2 text-[0.6875rem] text-neutral-700 ${
                      index % 2 === 1 ? "ml-auto" : ""
                    }`}
                  >
                    <IconWhatsApp className="size-3.5 shrink-0 text-[#25D366]" />
                    <span className="truncate">{message}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/*
              `mt-auto` rather than a fixed margin: the panel beside this one is
              a five-step flow and is always the taller of the two, so a fixed
              gap left this column ending in a hundred pixels of empty beige.
              The stickers drop to the foot of whatever height the row settles
              at.
            */}
            <ul className="mt-6 flex flex-wrap gap-2 pt-2 lg:mt-auto">
              {PROBLEM_LABELS.map((label) => (
                <li
                  key={label}
                  className="rounded-lg border border-neutral-900/10 bg-white/80 px-3 py-1.5 text-xs text-neutral-600"
                >
                  {label}
                </li>
              ))}
            </ul>
          </div>

          {/* -------------------------------------------------------- after */}
          <div className="border-brand-200 bg-brand-50/60 overflow-hidden rounded-[1.5rem] border p-6 sm:p-8">
            <h3 className="text-ink text-lg font-semibold">Asi operas con Vendra:</h3>

            <ol className="mt-6 flex flex-col gap-2">
              {SOLUTION_FLOW.map(({ step, detail }, index) => {
                const Icon = FLOW_ICONS[index]!;
                return (
                  <li key={step}>
                    <div className="border-border/60 bg-card shadow-e1 flex items-center gap-3 rounded-xl border px-4 py-3">
                      <span className="bg-brand-100 text-brand-700 flex size-8 shrink-0 items-center justify-center rounded-lg">
                        <Icon className="size-4" />
                      </span>
                      <span className="min-w-0">
                        <span className="text-ink block truncate text-sm font-medium">{step}</span>
                        <span className="text-muted-foreground block truncate text-xs">
                          {detail}
                        </span>
                      </span>
                    </div>
                    {index < SOLUTION_FLOW.length - 1 ? (
                      <span
                        aria-hidden
                        className="text-brand-400 flex justify-center py-0.5 text-xs"
                      >
                        ↓
                      </span>
                    ) : null}
                  </li>
                );
              })}
            </ol>

            {/*
              The payment marks, as TEXT.

              Visa and Yape are other people's trademarks and the product has no
              licence to reproduce their artwork on a sales page. Their names in
              a neutral chip is accurate - the product does accept both - and
              carries no implication that either company endorses it.
            */}
            <div className="mt-5 flex flex-wrap items-center gap-2">
              <span className="text-muted-foreground text-xs">Cobra con</span>
              {["Visa", "Mastercard", "Yape", "Plin"].map((brand) => (
                <span
                  key={brand}
                  className="border-border/70 bg-card text-ink rounded-md border px-2.5 py-1 text-[0.6875rem] font-semibold"
                >
                  {brand}
                </span>
              ))}
            </div>

            <ul className="mt-6 grid gap-2 sm:grid-cols-2">
              {SOLUTION_CHECKLIST.map((item) => (
                <li key={item} className="text-ink flex items-center gap-2 text-sm">
                  <IconCheck className="text-brand-700 size-4 shrink-0" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* A quiet closing line, so the section resolves instead of stopping. */}
        <p className="text-muted-foreground reveal mt-10 flex items-center gap-2 text-sm">
          <IconArrowRight className="text-brand-600 size-4" />
          El mismo restaurante, la misma carta, una operacion que si escala.
        </p>
      </div>
    </section>
  );
}
