import { STEPS } from "../../landing-data";

/**
 * Configura, publica, vende.
 *
 * Three steps and no more, because the honest answer to "how long does this
 * take" is the thing being sold here, and a five-step diagram says "this is a
 * project" where a three-step one says "this is an afternoon".
 *
 * The connecting arrows are decorative and only appear from `lg`, where the
 * cards are actually side by side. Rotating them to point downward on mobile
 * was the alternative and it makes the column twice as tall to restate what the
 * numbers already say.
 */
export function Steps() {
  return (
    <section className="bg-surface border-border border-y">
      <div className="mx-auto max-w-[1280px] px-6 py-20 sm:px-8 lg:py-28 xl:px-12">
        <div className="reveal flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <h2 className="type-display text-ink text-[2rem] sm:text-[2.6rem]">
            Configura <span className="text-brand-500">→</span> Publica{" "}
            <span className="text-brand-500">→</span> Vende
          </h2>
          <p className="text-muted-foreground shrink-0 text-sm">En minutos. Sin complicaciones.</p>
        </div>

        <ol className="reveal mt-12 grid gap-6 lg:grid-cols-3">
          {STEPS.map((step, index) => (
            <li key={step.number} className="relative">
              <div className="border-border/70 bg-card shadow-e1 h-full rounded-[1.25rem] border p-7">
                <span className="type-display text-brand-500/35 block text-5xl leading-none">
                  {step.number}
                </span>
                <h3 className="text-ink mt-5 text-lg font-semibold">{step.title}</h3>
                <p className="text-muted-foreground mt-2 text-sm leading-relaxed">{step.body}</p>
              </div>

              {index < STEPS.length - 1 ? (
                <span
                  aria-hidden
                  className="text-brand-400 absolute top-1/2 -right-4 hidden -translate-y-1/2 text-xl lg:block"
                >
                  →
                </span>
              ) : null}
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
