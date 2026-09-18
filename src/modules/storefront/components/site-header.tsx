"use client";

/**
 * The header of every restaurant site: logo, menu, whether the shop is open,
 * and "Pedir ahora".
 *
 * The structure is Sugu Rolls' - sticky, the order button always in reach, a
 * full-screen menu on a phone - and every colour is the tenant's theme.
 *
 * "Pedir ahora" opens the cart rather than navigating: somebody who has already
 * picked three makis wants to see them, and somebody with an empty cart is
 * offered the menu from inside the drawer, one tap away either way.
 */

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { IconCart, IconChevronDown, IconClose, IconMenu } from "@/components/ui/icons";
import { useCart } from "./cart-provider";
import { buttonClass, displayStyle, primaryButtonStyle } from "./site-styles";

export interface HeaderNavItem {
  readonly label: string;
  readonly href: string;
  readonly children: readonly { label: string; href: string }[];
}

export function SiteHeader({
  basePath,
  name,
  logoUrl,
  nav,
  isOpen,
  showStatus,
}: {
  basePath: string;
  name: string;
  logoUrl: string | null;
  nav: readonly HeaderNavItem[];
  isOpen: boolean;
  /** False when web orders are off: "Cerrado" would then be misleading. */
  showStatus: boolean;
}) {
  const cart = useCart();
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const bar = useRef<HTMLElement>(null);
  const menuId = useId();

  /*
   * Two things happen at the top of the page, and both are the same decision.
   *
   * THE BAR DISAPPEARS. On a style whose header floats over the cover
   * (`--site-header-overlay`), the background, the blur and the hairline are
   * withheld until the visitor has scrolled past the first 24 pixels, so the
   * page opens on the photograph rather than on a strip of chrome. The nav
   * itself does not move, so nothing reflows when it comes back.
   *
   * THE COVER CLIMBS UNDER IT. The header stays in the flow, and the slider
   * pulls itself up by `--site-header-height` - which is published here, from
   * the element's own measured box, rather than written as a number somebody
   * has to remember to change when the logo grows.
   */
  useEffect(() => {
    const publish = () => {
      const height = bar.current?.offsetHeight;
      if (height !== undefined && height > 0) {
        document.documentElement.style.setProperty("--site-header-height", `${height}px`);
      }
    };
    publish();
    window.addEventListener("resize", publish);
    return () => window.removeEventListener("resize", publish);
  }, []);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // No scrolling behind the full-screen menu, and Escape closes it.
  useEffect(() => {
    if (!menuOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const orderButton = (
    <button
      type="button"
      onClick={() => {
        setMenuOpen(false);
        cart.open();
      }}
      className={`${buttonClass} relative`}
      style={primaryButtonStyle}
    >
      <IconCart className="size-4" />
      <span>Pedir ahora</span>
      {cart.count > 0 ? (
        <span
          className="absolute -top-2 -right-2 flex size-6 items-center justify-center rounded-full text-[0.7rem] font-bold tabular-nums"
          style={{
            background: "var(--site-accent)",
            color: "var(--site-on-accent)",
            letterSpacing: "0",
          }}
          aria-label={`${cart.count} en el carrito`}
        >
          {cart.count > 99 ? "99+" : cart.count}
        </span>
      ) : null}
    </button>
  );

  /*
   * `bare` is the transparent state, and it only exists on a style that asked
   * for it. The custom property is read as a string because that is what a
   * custom property is; comparing it here rather than emitting two class names
   * keeps the decision in the theme, where the rest of the look lives.
   */
  const overlay = "var(--site-header-overlay)";

  return (
    <header
      ref={bar}
      className="sticky top-0 z-40 transition-[background-color,border-color] duration-500 print:hidden"
      style={{
        // At the top of an overlaid page: no bar at all. Everywhere else: the
        // page colour at 90% behind a blur, which is what keeps a photograph
        // legible as it scrolls under the nav.
        borderBottom: scrolled
          ? "1px solid var(--site-border)"
          : `1px solid color-mix(in srgb, var(--site-border) calc((1 - ${overlay}) * 100%), transparent)`,
        background: scrolled
          ? "color-mix(in srgb, var(--site-background) 92%, transparent)"
          : `color-mix(in srgb, var(--site-background) calc((1 - ${overlay}) * 92%), transparent)`,
        backdropFilter: scrolled ? "blur(16px)" : undefined,
      }}
    >
      {/*
        A veil under the nav while it floats over the cover.

        Without it the labels are set on whatever the first slide happens to be,
        and a photograph of a tortilla under a white nav is a nav nobody can
        read. It is drawn only where the style floats the header
        (`--site-header-overlay` is the opacity) and only until the bar's own
        background arrives on scroll - so on a solid header it renders as a
        fully transparent element, which costs a paint and decides nothing.
      */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[180%] transition-opacity duration-500"
        style={{
          background: "linear-gradient(to bottom, rgb(0 0 0 / 0.62), rgb(0 0 0 / 0))",
          opacity: scrolled ? 0 : "var(--site-header-overlay)",
        }}
      />
      <div className="relative mx-auto flex h-18 w-full max-w-6xl items-center justify-between gap-6 px-6 sm:px-10">
        <Link
          href={basePath}
          className="flex min-w-0 items-center gap-3"
          aria-label={`${name}, inicio`}
        >
          {logoUrl !== null ? (
            /* eslint-disable-next-line @next/next/no-img-element -- a signed
               Storage URL, whose host is not known at build time. */
            <img
              src={logoUrl}
              alt={name}
              className="h-11 w-auto max-w-[190px] object-contain sm:h-12"
            />
          ) : (
            <span
              className="truncate text-xl"
              style={{ ...displayStyle, color: "var(--site-primary)" }}
            >
              {name}
            </span>
          )}
        </Link>

        <nav aria-label="Principal" className="hidden lg:block">
          <ul className="flex items-center gap-7">
            {nav.map((item) => (
              <li key={item.href} className="group relative">
                {/*
                  Sentence case and a rule that grows under the word.

                  It was set in the overline style - caps at up to 0.42em of
                  tracking, which is the treatment for a two-word label ABOVE a
                  heading and turns a five-item nav into a band of letters you
                  read one at a time. The underline is the cheapest hover a nav
                  can have and the only one that does not move the layout.
                */}
                <Link
                  href={item.href}
                  className="relative inline-flex items-center gap-1 py-2 text-[0.9rem] font-medium transition-colors hover:text-[color:var(--site-foreground)]"
                  style={{ color: "var(--site-muted)" }}
                >
                  {item.label}
                  {item.children.length > 0 ? <IconChevronDown className="size-3.5" /> : null}
                  <span
                    aria-hidden
                    className="absolute -bottom-0.5 left-0 h-px w-0 transition-all duration-300 group-hover:w-full"
                    style={{ background: "var(--site-primary)" }}
                  />
                </Link>
                {item.children.length > 0 ? (
                  <ul
                    className="invisible absolute top-full left-0 z-10 min-w-48 py-2 opacity-0 transition-opacity group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100"
                    style={{
                      background: "var(--site-background)",
                      border: "1px solid var(--site-border)",
                      borderRadius: "var(--site-radius-chip)",
                      boxShadow: "var(--site-shadow-lifted)",
                    }}
                  >
                    {item.children.map((child) => (
                      <li key={child.href}>
                        <Link
                          href={child.href}
                          className="block px-4 py-2 text-sm transition-opacity hover:opacity-70"
                        >
                          {child.label}
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
        </nav>

        <div className="flex shrink-0 items-center gap-3">
          {showStatus ? <OpenStatus isOpen={isOpen} className="hidden sm:inline-flex" /> : null}
          <div className="hidden sm:block">{orderButton}</div>
          <button
            type="button"
            onClick={() => cart.open()}
            className="relative flex size-11 items-center justify-center sm:hidden"
            style={{
              border: "1px solid var(--site-border-strong)",
              borderRadius: "var(--site-radius-chip)",
            }}
            aria-label={`Abrir carrito${cart.count > 0 ? `, ${cart.count} productos` : ""}`}
          >
            <IconCart className="size-5" />
            {cart.count > 0 ? (
              <span
                className="absolute -top-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full text-[0.65rem] font-bold"
                style={{ background: "var(--site-primary)", color: "var(--site-on-primary)" }}
                aria-hidden
              >
                {cart.count > 99 ? "99+" : cart.count}
              </span>
            ) : null}
          </button>
          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            className="flex size-11 items-center justify-center lg:hidden"
            style={{
              border: "1px solid var(--site-border-strong)",
              borderRadius: "var(--site-radius-chip)",
            }}
            aria-label="Abrir menú"
            aria-expanded={menuOpen}
            aria-controls={menuId}
          >
            <IconMenu className="size-5" />
          </button>
        </div>
      </div>

      {menuOpen ? (
        <div
          id={menuId}
          role="dialog"
          aria-modal="true"
          aria-label="Menú"
          className="fixed inset-0 z-50 flex flex-col overflow-y-auto lg:hidden"
          style={{ background: "var(--site-background)" }}
        >
          <div className="flex h-18 items-center justify-between px-6">
            <span
              className="truncate text-xl"
              style={{ ...displayStyle, color: "var(--site-primary)" }}
            >
              {name}
            </span>
            <button
              type="button"
              onClick={() => setMenuOpen(false)}
              className="flex size-11 items-center justify-center"
              style={{
                border: "1px solid var(--site-border-strong)",
                borderRadius: "var(--site-radius-chip)",
              }}
              aria-label="Cerrar menú"
              // The only control in the panel a keyboard user needs first.
              autoFocus
            >
              <IconClose className="size-5" />
            </button>
          </div>

          <nav aria-label="Principal" className="flex flex-col px-6 pt-4">
            {nav.map((item) => (
              <div key={item.href} style={{ borderBottom: "1px solid var(--site-border)" }}>
                <Link
                  href={item.href}
                  onClick={() => setMenuOpen(false)}
                  className="block py-4 text-2xl"
                  style={displayStyle}
                >
                  {item.label}
                </Link>
                {item.children.map((child) => (
                  <Link
                    key={child.href}
                    href={child.href}
                    onClick={() => setMenuOpen(false)}
                    className="block pb-3 pl-4 text-base"
                    style={{ color: "var(--site-muted)" }}
                  >
                    {child.label}
                  </Link>
                ))}
              </div>
            ))}
          </nav>

          <div className="mt-auto flex flex-col gap-4 px-6 py-8">
            {showStatus ? <OpenStatus isOpen={isOpen} /> : null}
            <div className="[&>button]:w-full">{orderButton}</div>
          </div>
        </div>
      ) : null}
    </header>
  );
}

/** "Abierto ahora" / "Cerrado ahora", decided by the database at render time. */
export function OpenStatus({ isOpen, className }: { isOpen: boolean; className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-2 text-xs font-medium ${className ?? ""}`}
      style={{ color: "var(--site-muted)" }}
    >
      <span
        aria-hidden
        className="size-2 rounded-full"
        // Semantic, like the banner tones: open is green and closed is grey on
        // every theme, because a brand colour cannot mean "open".
        style={{ background: isOpen ? "#16a34a" : "#9ca3af" }}
      />
      {isOpen ? "Abierto ahora" : "Cerrado ahora"}
    </span>
  );
}
