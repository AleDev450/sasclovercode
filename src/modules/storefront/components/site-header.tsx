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
import { useEffect, useId, useState } from "react";
import { IconCart, IconChevronDown, IconClose, IconMenu } from "@/components/ui/icons";
import { useCart } from "./cart-provider";
import { buttonClass, displayStyle, eyebrowStyle, primaryButtonStyle } from "./site-styles";

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
  const menuId = useId();

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
      className={`${buttonClass} relative h-11 px-5`}
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

  return (
    <header
      className="sticky top-0 z-40 backdrop-blur-md print:hidden"
      style={{
        borderBottom: "1px solid var(--site-border)",
        background: "color-mix(in srgb, var(--site-background) 90%, transparent)",
      }}
    >
      <div className="mx-auto flex h-18 w-full max-w-6xl items-center justify-between gap-6 px-6 sm:px-10">
        <Link
          href={basePath}
          className="flex min-w-0 items-center gap-3"
          aria-label={`${name}, inicio`}
        >
          {logoUrl !== null ? (
            /* eslint-disable-next-line @next/next/no-img-element -- a signed
               Storage URL, whose host is not known at build time. */
            <img src={logoUrl} alt={name} className="h-10 w-auto max-w-[170px] object-contain" />
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
                <Link
                  href={item.href}
                  className="inline-flex items-center gap-1 py-2 text-xs font-medium transition-opacity hover:opacity-70"
                  style={{ ...eyebrowStyle, color: "var(--site-foreground)" }}
                >
                  {item.label}
                  {item.children.length > 0 ? <IconChevronDown className="size-3.5" /> : null}
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
