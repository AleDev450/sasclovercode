import { CloverMark } from "@/components/ui";
import { IconCart, IconChart, IconStore, IconTruck } from "@/components/ui/icons";

/**
 * The hero illustration: a small, honest picture of the dashboard.
 *
 * WHY IT IS MARKUP AND NOT A SCREENSHOT. A screenshot goes stale the first time
 * a screen changes, weighs several hundred kilobytes, is unreadable on a phone
 * and says nothing to a screen reader. This is built from the same tokens as
 * the real product, so it follows the theme, scales with the viewport, and
 * cannot drift from the palette it is advertising.
 *
 * WHAT IT MAY CONTAIN. Shapes, labels and plausibly-shaped figures - the visual
 * grammar of the product. It must never carry a number presented as a fact
 * about a real business, or a named customer. The whole block is `aria-hidden`:
 * it is decoration beside a headline that already says what the product does,
 * and reading a fake sales figure aloud would be worse than silence.
 */

const NAV = [
  { label: "Resumen", icon: IconChart, active: true },
  { label: "Pedidos", icon: IconCart, active: false },
  { label: "Catalogo", icon: IconStore, active: false },
  { label: "Delivery", icon: IconTruck, active: false },
] as const;

const TILES = [
  { label: "Ventas de hoy", value: "S/ 2,480" },
  { label: "Pedidos", value: "37" },
  { label: "Ticket promedio", value: "S/ 67" },
] as const;

/**
 * The week, as height classes.
 *
 * Literal class names rather than numbers fed through a `style` attribute, for
 * two reasons that point the same way: Tailwind only emits an arbitrary value
 * it can SEE in the source, and the Content-Security-Policy of Phase 25 carries
 * no `unsafe-inline`, so a computed `style` would be dropped by the browser
 * and every bar would render full height.
 *
 * Shaped like a real week, with the peak on Saturday.
 */
const BARS = [
  { day: "L", height: "h-[42%]", peak: false },
  { day: "M", height: "h-[55%]", peak: false },
  { day: "X", height: "h-[38%]", peak: false },
  { day: "J", height: "h-[61%]", peak: false },
  { day: "V", height: "h-[74%]", peak: false },
  { day: "S", height: "h-[96%]", peak: true },
  { day: "D", height: "h-[83%]", peak: false },
] as const;

const ORDERS = [
  { id: "#1042", channel: "Delivery", state: "En cocina", tone: "warning" },
  { id: "#1041", channel: "Mostrador", state: "Pagado", tone: "success" },
  { id: "#1040", channel: "Web", state: "En camino", tone: "info" },
] as const;

const STATE_TONE = {
  warning: "bg-warning/15 text-warning",
  success: "bg-success/15 text-success",
  info: "bg-info/12 text-info",
} as const;

export function AppPreview() {
  return (
    <div
      aria-hidden
      className="border-border bg-card shadow-e3 overflow-hidden rounded-2xl border select-none"
    >
      {/* Window chrome. Three dots read as "an application" faster than any label. */}
      <div className="border-border bg-muted/60 flex items-center gap-2 border-b px-4 py-3">
        <span className="bg-destructive/40 size-2.5 rounded-full" />
        <span className="bg-warning/40 size-2.5 rounded-full" />
        <span className="bg-success/40 size-2.5 rounded-full" />
        <span className="text-muted-foreground ml-3 truncate text-[0.6875rem] font-medium">
          mitienda.clovercodeapp.com
        </span>
      </div>

      <div className="flex">
        {/* Sidebar. Hidden on a phone, where it would leave no room for content. */}
        <div className="border-border hidden w-40 shrink-0 flex-col gap-1 border-r p-3 sm:flex">
          <div className="mb-3 flex items-center gap-2 px-1">
            <CloverMark className="size-5" />
            <span className="text-xs font-semibold">Mi Bodega</span>
          </div>
          {NAV.map((item) => (
            <div
              key={item.label}
              className={
                item.active
                  ? "bg-accent text-accent-foreground flex items-center gap-2 rounded-lg px-2.5 py-2 text-xs font-medium"
                  : "text-muted-foreground flex items-center gap-2 rounded-lg px-2.5 py-2 text-xs"
              }
            >
              <item.icon className="size-3.5" />
              {item.label}
            </div>
          ))}
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-4 p-4">
          <div className="grid grid-cols-3 gap-3">
            {TILES.map((tile) => (
              <div key={tile.label} className="border-border rounded-lg border p-3">
                <p className="text-muted-foreground truncate text-[0.625rem] font-medium">
                  {tile.label}
                </p>
                <p className="mt-1 text-sm font-semibold tabular-nums sm:text-base">{tile.value}</p>
              </div>
            ))}
          </div>

          <div className="border-border rounded-lg border p-3">
            <p className="text-muted-foreground text-[0.625rem] font-medium">Ventas de la semana</p>
            <div className="mt-3 flex h-20 items-end gap-1.5">
              {BARS.map((bar, index) => (
                <div
                  key={`${bar.day}-${index}`}
                  className="flex h-full flex-1 flex-col items-center justify-end gap-1.5"
                >
                  <div
                    className={`w-full rounded-t-sm ${bar.height} ${
                      bar.peak ? "bg-primary" : "bg-primary/25"
                    }`}
                  />
                  <span className="text-muted-foreground text-[0.5rem]">{bar.day}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="border-border rounded-lg border">
            {ORDERS.map((order, index) => (
              <div
                key={order.id}
                className={
                  index === ORDERS.length - 1
                    ? "flex items-center justify-between gap-2 p-2.5"
                    : "border-border flex items-center justify-between gap-2 border-b p-2.5"
                }
              >
                <span className="text-[0.6875rem] font-medium tabular-nums">{order.id}</span>
                <span className="text-muted-foreground truncate text-[0.6875rem]">
                  {order.channel}
                </span>
                <span
                  className={`rounded-full px-2 py-0.5 text-[0.5625rem] font-medium ${STATE_TONE[order.tone]}`}
                >
                  {order.state}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
