import { IconChevronDown, IconTrendUp } from "@/components/ui/icons";
import { VendraMark } from "@/components/ui";
import { PRODUCT_NAME } from "@/config/app";
import { DEMO_DASHBOARD } from "../../landing-data";

/**
 * Turns a series of numbers into a polyline, normalised to a 100x32 box.
 *
 * WHY IT IS COMPUTED. The alternative is a hand-authored `d` attribute, which
 * is a shape nobody can edit: changing the numbers in `landing-data.ts` would
 * mean redrawing bezier coordinates by hand, so in practice the curve would
 * stop matching the story the figures tell.
 *
 * The guard on a flat series is not theoretical - a demo dataset of identical
 * values divides by zero and renders `NaN`, which silently drops the line.
 */
function sparklinePoints(values: readonly number[]): string {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;

  return values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * 100;
      const y = 32 - ((value - min) / span) * 28 - 2;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
}

/**
 * The owner's side of the same evening.
 *
 * The third of the three hero mockups, and the one that says the product is
 * more than a website: the browser is what the diner sees, the phone is what
 * they order on, this is what the money looks like afterwards. Together they
 * are the whole sentence.
 *
 * The figures are a demonstration, not a claim about anybody's revenue - they
 * are a plausible Tuesday for a mid-sized restaurant, which is the point. The
 * landing page deliberately makes no statement about customers it does not
 * have.
 */
export function DashboardMockup() {
  const points = sparklinePoints(DEMO_DASHBOARD.trend);

  return (
    <div
      aria-hidden
      className="border-border/70 bg-card shadow-e3 w-full rounded-2xl border p-4 select-none sm:p-5"
    >
      <div className="border-border/60 flex items-center justify-between gap-3 border-b pb-3">
        <span className="flex items-center gap-2">
          <VendraMark className="h-4" />
          <span className="text-ink text-xs font-semibold">{PRODUCT_NAME}</span>
        </span>
        <span className="text-muted-foreground flex items-center gap-1 text-[0.625rem]">
          Restaurante
          <IconChevronDown className="size-3" />
        </span>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3">
        {DEMO_DASHBOARD.stats.map((stat) => (
          <div key={stat.label}>
            <dt className="text-muted-foreground text-[0.625rem]">{stat.label}</dt>
            {/*
              `flex-wrap` plus a non-breaking value: in a 230px card two stats
              across leaves about 90px per column, and a delta badge beside a
              four-digit sol amount is what pushed "S/ 2,580" onto two lines
              with the currency stranded above the number. The badge wraps
              instead, which is the piece that can afford to.
            */}
            <dd className="mt-0.5 flex flex-wrap items-baseline gap-x-1.5">
              <span className="text-ink text-base font-semibold whitespace-nowrap tabular-nums">
                {stat.value}
              </span>
              {stat.delta !== null ? (
                <span className="text-success flex items-center gap-0.5 text-[0.625rem] font-medium">
                  <IconTrendUp className="size-3" />
                  {stat.delta}
                </span>
              ) : null}
            </dd>
          </div>
        ))}
      </dl>

      {/*
        The sparkline. `preserveAspectRatio="none"` lets one 100x32 viewBox
        stretch to whatever width the card ends up at, which is what keeps the
        card fluid between the phone and the desktop layout.
      */}
      <svg
        viewBox="0 0 100 32"
        preserveAspectRatio="none"
        className="mt-3 h-10 w-full"
        role="presentation"
      >
        <polyline
          points={points}
          fill="none"
          stroke="var(--brand-600)"
          strokeWidth={1.75}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>

      <div className="border-border/60 mt-3 border-t pt-3">
        <p className="text-muted-foreground text-[0.625rem] font-medium">
          {DEMO_DASHBOARD.topDishesHeading}
        </p>
        <ul className="mt-2 flex flex-col gap-1.5">
          {DEMO_DASHBOARD.topDishes.map((dish) => (
            <li key={dish.name} className="flex items-center justify-between gap-3">
              <span className="text-ink truncate text-[0.6875rem]">{dish.name}</span>
              <span className="text-muted-foreground text-[0.6875rem] font-semibold tabular-nums">
                {dish.count}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
