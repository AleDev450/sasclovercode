import { DEMO_PHONE, DEMO_RESTAURANT } from "../../landing-data";

/**
 * The same carta, on the phone of somebody sitting at a table.
 *
 * It exists to make one claim visible next to the browser frame: this is the
 * SAME site, not a second product a restaurant has to buy and maintain. That is
 * why the header repeats the restaurant's name rather than showing a Vendra
 * logo - a diner scanning a QR at a table never sees this product's brand, and
 * the mockup should not imply otherwise.
 *
 * Hidden below `lg` by its caller. Three overlapping mockups on a 390px screen
 * is the collage the brief warns about.
 */
export function PhoneMockup() {
  return (
    <div
      aria-hidden
      className="border-border/60 shadow-e3 w-[168px] rounded-[1.75rem] border-[6px] border-neutral-900 bg-neutral-900 select-none"
    >
      <div className="bg-card overflow-hidden rounded-[1.25rem]">
        {/* The notch. Four pixels of detail that make the frame read as a phone. */}
        <div className="flex justify-center bg-neutral-900 pt-1 pb-2">
          <span className="h-1 w-10 rounded-full bg-neutral-700" />
        </div>

        <div className="px-3 pt-3 pb-4">
          <p className="text-muted-foreground text-[0.5rem] tracking-[0.18em] uppercase">
            {DEMO_RESTAURANT.name}
          </p>
          <p className="type-display text-ink mt-0.5 text-sm">{DEMO_PHONE.heading}</p>

          <div className="mt-2.5 flex gap-1">
            {DEMO_PHONE.tabs.map((tab, index) => (
              <span
                key={tab}
                className={
                  index === 0
                    ? "bg-brand-700 rounded-full px-2 py-0.5 text-[0.5rem] font-medium text-white"
                    : "border-border text-muted-foreground rounded-full border px-2 py-0.5 text-[0.5rem]"
                }
              >
                {tab}
              </span>
            ))}
          </div>

          <ul className="mt-3 flex flex-col gap-2">
            {DEMO_PHONE.items.map((item) => (
              <li key={item.name} className="flex items-center gap-2">
                {/* A tinted square stands in for the dish photo. A fourth remote
                    image at 28px would cost a request to render 784 pixels. */}
                <span className="bg-brand-100 size-7 shrink-0 rounded-md" />
                <span className="min-w-0 flex-1">
                  <span className="text-ink block truncate text-[0.5625rem] font-medium">
                    {item.name}
                  </span>
                  <span className="text-brand-700 block text-[0.5625rem] font-semibold tabular-nums">
                    {item.price}
                  </span>
                </span>
              </li>
            ))}
          </ul>

          <span className="bg-ink mt-3 block rounded-lg py-1.5 text-center text-[0.5625rem] font-semibold text-white">
            Ver mi pedido
          </span>
        </div>
      </div>
    </div>
  );
}
