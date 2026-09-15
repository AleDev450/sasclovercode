import type { ThemeValues } from "@/modules/seo/theme";
import { themeCssVariables } from "@/modules/seo/theme";
import { SITE_FONT_CLASSNAME } from "@/modules/seo/fonts";
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
 * (`themeCssVariables`) and carries the SAME font class (`SITE_FONT_CLASSNAME`),
 * so what is shown here cannot drift from what visitors get: change the mapping
 * in `seo/theme.ts` and both move together. The font class is not decoration -
 * a preview of Atelier set in the system sans is a preview of a different
 * website, and typography is most of what separates these three themes.
 *
 * What it is NOT is a live copy of the tenant's actual pages - it is a
 * representative arrangement (header, hero, two dishes), which is enough to
 * judge a design and cheap enough to render four times on one screen.
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

/**
 * Two dishes, priced like a restaurant that means it.
 *
 * Concrete rather than "Producto 1". Somebody deciding between three themes is
 * imagining their own carta on the page, and lorem ipsum makes that work harder
 * than it needs to be.
 */
const DISHES = [
  { name: "Tiradito de fondo", price: "S/ 46" },
  { name: "Lomo a la piedra", price: "S/ 58" },
] as const;

export function ThemePreview({ theme, businessName, size = "card", className }: ThemePreviewProps) {
  const full = size === "full";

  /** The side gutter, named once because four blocks have to share it exactly. */
  const pad = full ? "1.75rem" : "0.9rem";

  return (
    <div
      aria-hidden
      className={cn(
        "overflow-hidden select-none",
        SITE_FONT_CLASSNAME,
        full ? "rounded-xl" : "rounded-lg",
        className,
      )}
      style={{
        ...themeCssVariables(theme),
        background: "var(--site-background)",
        color: "var(--site-foreground)",
        fontFamily: "var(--site-font)",
        letterSpacing: "var(--site-body-tracking)",
        // The tenant's own hairline, not the dashboard's border token: the frame
        // has to work on a near-black tile and on a bone one.
        border: "1px solid var(--site-border)",
      }}
    >
      {/* ------------------------------------------------------------ header */}
      <div
        className="flex items-center justify-between gap-3"
        style={{
          padding: `${full ? "0.9rem" : "0.5rem"} ${pad}`,
          borderBottom: "1px solid var(--site-border)",
        }}
      >
        <span
          className="truncate"
          style={{
            fontFamily: "var(--site-display-font)",
            fontWeight: "var(--site-display-weight)",
            letterSpacing: "var(--site-display-tracking)",
            fontSize: full ? "1.05rem" : "0.6rem",
            color: "var(--site-primary)",
          }}
        >
          {businessName}
        </span>

        <div className="flex shrink-0 items-center" style={{ gap: full ? "1.1rem" : "0.55rem" }}>
          {["Carta", "Reservas"].map((item) => (
            <span
              key={item}
              style={{
                color: "var(--site-muted)",
                fontSize: full ? "0.6875rem" : "0.4rem",
                letterSpacing: "var(--site-eyebrow-tracking)",
                textTransform: "var(--site-eyebrow-transform)" as "uppercase",
              }}
            >
              {item}
            </span>
          ))}
          <span
            style={{
              background: "var(--site-primary)",
              color: "var(--site-on-primary)",
              borderRadius: "var(--site-radius-chip)",
              padding: full ? "0.45rem 0.9rem" : "0.2rem 0.4rem",
              fontSize: full ? "0.6875rem" : "0.4rem",
              fontWeight: 600,
            }}
          >
            Pedir
          </span>
        </div>
      </div>

      {/* -------------------------------------------------------------- hero */}
      <div
        className="flex flex-col"
        style={{
          padding: `${full ? "2.75rem" : "1.35rem"} ${pad} ${full ? "2rem" : "1rem"}`,
          gap: full ? "0.85rem" : "0.4rem",
          alignItems: "var(--site-hero-items)" as "center",
          textAlign: "var(--site-hero-align)" as "center",
        }}
      >
        <span
          style={{
            color: "var(--site-accent)",
            fontSize: full ? "0.625rem" : "0.375rem",
            fontWeight: 600,
            letterSpacing: "var(--site-eyebrow-tracking)",
            textTransform: "var(--site-eyebrow-transform)" as "uppercase",
          }}
        >
          Cocina de temporada
        </span>

        <p
          style={{
            fontFamily: "var(--site-display-font)",
            fontWeight: "var(--site-display-weight)",
            letterSpacing: "var(--site-display-tracking)",
            lineHeight: "var(--site-display-leading)",
            fontSize: full ? "2.6rem" : "1.15rem",
            textWrap: "balance",
            maxWidth: full ? "22ch" : "16ch",
          }}
        >
          Una carta que cambia con el mercado
        </p>

        <p
          style={{
            color: "var(--site-muted)",
            fontSize: full ? "0.875rem" : "0.4375rem",
            lineHeight: 1.6,
            maxWidth: full ? "42ch" : "34ch",
          }}
        >
          Reserva tu mesa o pide para llevar. Atendemos de martes a domingo.
        </p>

        <span
          style={{
            marginTop: full ? "0.6rem" : "0.25rem",
            background: "var(--site-primary)",
            color: "var(--site-on-primary)",
            borderRadius: "var(--site-radius-chip)",
            boxShadow: "var(--site-shadow)",
            padding: full ? "0.8rem 1.9rem" : "0.35rem 0.8rem",
            fontSize: full ? "0.8125rem" : "0.4375rem",
            fontWeight: 600,
            letterSpacing: "var(--site-eyebrow-tracking)",
            textTransform: "var(--site-eyebrow-transform)" as "uppercase",
          }}
        >
          Ver la carta
        </span>
      </div>

      {/* ------------------------------------------------------------ dishes */}
      <div
        className="grid grid-cols-2"
        style={{
          gap: full ? "1.25rem" : "0.6rem",
          padding: `0 ${pad} ${full ? "2.25rem" : "1.1rem"}`,
        }}
      >
        {DISHES.map((dish) => (
          <div
            key={dish.name}
            className="overflow-hidden"
            style={{
              background: "var(--site-surface)",
              border: "1px solid var(--site-border)",
              borderRadius: "var(--site-radius)",
              boxShadow: "var(--site-shadow)",
            }}
          >
            {/*
              The photograph, as a tint rather than a picture.

              The RATIO is the point - it is one of the things a style decides,
              and a portrait frame next to a panoramic one is the fastest way to
              see that Atelier and Brasa are not the same page in two palettes.
              A stock photo here would be a photo the business does not have.
            */}
            <div
              style={{
                aspectRatio: "var(--site-media-ratio)",
                background: "var(--site-accent-soft)",
                borderBottom: "1px solid var(--site-border)",
              }}
            />
            <div
              className="flex flex-col"
              style={{
                gap: full ? "0.3rem" : "0.15rem",
                padding: full ? "0.9rem 1rem" : "0.4rem 0.45rem",
              }}
            >
              <span
                style={{
                  fontFamily: "var(--site-display-font)",
                  fontWeight: "var(--site-display-weight)",
                  letterSpacing: "var(--site-display-tracking)",
                  fontSize: full ? "0.9375rem" : "0.4688rem",
                }}
              >
                {dish.name}
              </span>
              <span
                className="tabular-nums"
                style={{
                  color: "var(--site-primary)",
                  fontSize: full ? "0.875rem" : "0.4375rem",
                  fontWeight: 600,
                }}
              >
                {dish.price}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
