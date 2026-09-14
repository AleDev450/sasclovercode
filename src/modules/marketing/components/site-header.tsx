"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ProductLogo, buttonVariants } from "@/components/ui";
import { IconClose, IconMenu } from "@/components/ui/icons";
import { cn } from "@/lib/utils";

const SECTIONS = [
  { href: "#producto", label: "Producto" },
  { href: "#modulos", label: "Modulos" },
  { href: "#como-funciona", label: "Como funciona" },
  { href: "#planes", label: "Planes" },
  { href: "#contacto", label: "Contacto" },
] as const;

/**
 * The landing header.
 *
 * A client component for two reasons and no others: the mobile menu is state,
 * and the header gains a border and a background only once the page has
 * scrolled past the hero. Everything else on the landing page is a Server
 * Component.
 *
 * WHY THE SCROLL STATE. A translucent header over the hero, and a solid one
 * over content, is what stops the navigation from looking like it is floating
 * unattached above the page. It listens passively and reads a single boolean,
 * so it costs nothing per frame.
 */
export function SiteHeader() {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 16);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // A menu that survives a rotation into desktop width would leave the page
  // scroll-locked with no visible way out.
  useEffect(() => {
    if (!menuOpen) return;
    const media = window.matchMedia("(min-width: 768px)");
    const close = () => setMenuOpen(false);
    media.addEventListener("change", close);
    return () => media.removeEventListener("change", close);
  }, [menuOpen]);

  return (
    <header
      className={cn(
        "sticky top-0 z-50 transition-[background-color,border-color,box-shadow] duration-300",
        scrolled || menuOpen
          ? "bg-background/85 border-border shadow-e1 border-b backdrop-blur-lg"
          : "border-b border-transparent",
      )}
    >
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link href="/" className="rounded-lg" aria-label="Tu Tiendita, inicio">
          <ProductLogo size="md" />
        </Link>

        <nav aria-label="Secciones" className="hidden items-center gap-1 md:flex">
          {SECTIONS.map((section) => (
            <a
              key={section.href}
              href={section.href}
              className="text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg px-3 py-2 text-sm font-medium transition-colors"
            >
              {section.label}
            </a>
          ))}
        </nav>

        <div className="hidden items-center gap-2 md:flex">
          <Link href="/login" className={buttonVariants({ variant: "ghost", size: "md" })}>
            Ingresar
          </Link>
          <a href="#contacto" className={buttonVariants({ variant: "brand", size: "md" })}>
            Pedir demo
          </a>
        </div>

        <button
          type="button"
          onClick={() => setMenuOpen((open) => !open)}
          aria-expanded={menuOpen}
          aria-controls="menu-movil"
          aria-label={menuOpen ? "Cerrar menu" : "Abrir menu"}
          className="hover:bg-muted rounded-lg p-2 transition-colors md:hidden"
        >
          {menuOpen ? <IconClose /> : <IconMenu />}
        </button>
      </div>

      <div
        id="menu-movil"
        hidden={!menuOpen}
        className="border-border bg-background border-t md:hidden"
      >
        <nav aria-label="Secciones" className="flex flex-col gap-1 px-4 py-4">
          {SECTIONS.map((section) => (
            <a
              key={section.href}
              href={section.href}
              onClick={() => setMenuOpen(false)}
              className="hover:bg-muted rounded-lg px-3 py-2.5 text-sm font-medium transition-colors"
            >
              {section.label}
            </a>
          ))}
          <div className="mt-2 flex flex-col gap-2">
            <Link
              href="/login"
              className={buttonVariants({ variant: "outline", size: "lg" })}
              onClick={() => setMenuOpen(false)}
            >
              Ingresar
            </Link>
            <a
              href="#contacto"
              className={buttonVariants({ variant: "brand", size: "lg" })}
              onClick={() => setMenuOpen(false)}
            >
              Pedir demo
            </a>
          </div>
        </nav>
      </div>
    </header>
  );
}
