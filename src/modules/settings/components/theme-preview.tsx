import type { ThemeValues } from "@/modules/seo/theme";
import { themeCssVariables } from "@/modules/seo/theme";
import { cn } from "@/lib/utils";

/**
 * A miniature of the public website, painted with one theme.
 *
 * THE POINT OF THE WHOLE THEME SCREEN. Until this existed, choosing a theme
 * meant typing `#b91c1c` into a field and pressing save to find out - and a
 * business that has to publish its site to see its colours will publish an ugly
 * site at least once.
 *
 * It renders the SAME custom properties the real site layout renders
 * (`themeCssVariables`), so what is shown here cannot drift from what visitors
 * get: change the mapping in `seo/theme.ts` and both move together. What it is
 * NOT is a live copy of the tenant's actual pages - it is a representative
 * arrangement (header, hero, two product cards, a button), which is enough to
 * judge a palette and cheap enough to render sixteen times on one screen.
 *
 * Deliberately a Server Component with no state. The gallery renders one of
 * these per preset; making them interactive would ship a client bundle to do
 * what a link already does.
 */

export interface ThemePreviewProps {
  theme: ThemeValues;
  /** The shop name to print in the header. */
  businessName: string;
  /** `card` for the gallery tiles, `full` for the large preview. */
  size?: "card" | "full";
  className?: string;
}

export function ThemePreview({ theme, businessName, size = "card", className }: ThemePreviewProps) {
  const full = size === "full";

  return (
    <div
      aria-hidden
      className={cn(
        "border-border overflow-hidden rounded-xl border select-none",
        full ? "shadow-e2" : "shadow-e1",
        className,
      )}
      style={{
        ...themeCssVariables(theme),
        background: "var(--site-background)",
        fontFamily: "var(--site-font)",
      }}
    >
      {/* Header */}
      <div
        className={cn(
          "flex items-center justify-between gap-3 border-b border-black/10",
          full ? "px-5 py-3.5" : "px-3 py-2.5",
        )}
      >
        <span
          className={cn("truncate font-semibold", full ? "text-base" : "text-[0.6875rem]")}
          style={{ color: "var(--site-primary)" }}
        >
          {businessName}
        </span>
        <div className={cn("flex shrink-0 items-center", full ? "gap-3" : "gap-2")}>
          {["Inicio", "Carta", "Contacto"].map((item) => (
            <span key={item} className={cn("text-black/60", full ? "text-xs" : "text-[0.5rem]")}>
              {item}
            </span>
          ))}
        </div>
      </div>

      {/* Hero */}
      <div className={cn("flex flex-col", full ? "gap-3 px-5 py-6" : "gap-1.5 px-3 py-3.5")}>
        <span
          className={cn(
            "self-start font-medium text-white",
            full ? "px-3 py-1 text-[0.625rem]" : "px-1.5 py-0.5 text-[0.4375rem]",
          )}
          style={{ background: "var(--site-accent)", borderRadius: "var(--site-radius)" }}
        >
          Abierto ahora
        </span>
        <p
          className={cn("font-semibold tracking-tight", full ? "text-2xl" : "text-[0.8125rem]")}
          style={{ color: "var(--site-primary)" }}
        >
          Sabor de siempre, a un clic
        </p>
        <p className={cn("text-black/55", full ? "max-w-sm text-sm" : "text-[0.5rem]")}>
          Pide en linea y recibelo en casa, o recogelo en el local.
        </p>
        <span
          className={cn(
            "mt-1 self-start font-medium text-white",
            full ? "px-5 py-2.5 text-sm" : "px-2.5 py-1.5 text-[0.5rem]",
          )}
          style={{ background: "var(--site-primary)", borderRadius: "var(--site-radius)" }}
        >
          Ver la carta
        </span>
      </div>

      {/* Two product cards */}
      <div className={cn("grid grid-cols-2", full ? "gap-3 px-5 pb-6" : "gap-2 px-3 pb-3.5")}>
        {[
          { name: "Lomo saltado", price: "S/ 32.00" },
          { name: "Ceviche mixto", price: "S/ 38.00" },
        ].map((product) => (
          <div
            key={product.name}
            className="border border-black/10 bg-white/70"
            style={{ borderRadius: "var(--site-radius)" }}
          >
            <div
              className={cn("w-full", full ? "h-16" : "h-7")}
              style={{
                background: "var(--site-accent)",
                opacity: 0.18,
                borderTopLeftRadius: "var(--site-radius)",
                borderTopRightRadius: "var(--site-radius)",
              }}
            />
            <div className={cn("flex flex-col", full ? "gap-1 p-3" : "gap-0.5 p-1.5")}>
              <span className={cn("font-medium", full ? "text-xs" : "text-[0.5rem]")}>
                {product.name}
              </span>
              <span
                className={cn("font-semibold tabular-nums", full ? "text-sm" : "text-[0.5rem]")}
                style={{ color: "var(--site-primary)" }}
              >
                {product.price}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
