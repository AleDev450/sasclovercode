import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { CloverWordmark, ProductLogo } from "@/components/ui";
import { IconMail, IconWhatsApp } from "@/components/ui/icons";
import {
  CONTACT_EMAIL,
  CONTACT_PHONE_DISPLAY,
  CONTACT_WHATSAPP,
  PRODUCT_NAME,
  PRODUCT_TAGLINE,
  VENDOR_NAME,
  VENDOR_SITE,
} from "@/config/app";
import { SiteHeader } from "@/modules/marketing/components/site-header";

/**
 * The public commercial surface.
 *
 * THE ONE PART OF THIS APPLICATION THAT WANTS TO BE INDEXED. The root layout
 * sets `robots: { index: false }` because everything else here is a dashboard
 * or a console, and this override is the deliberate exception: a landing page
 * nobody can find is not a landing page. Tenant public sites get their own
 * robots configuration from Phase 08, which is a separate surface.
 */
export const metadata: Metadata = {
  title: {
    default: `${PRODUCT_NAME} - Software para tu negocio`,
    template: `%s | ${PRODUCT_NAME}`,
  },
  description: PRODUCT_TAGLINE,
  robots: { index: true, follow: true },
  openGraph: {
    type: "website",
    siteName: PRODUCT_NAME,
    title: `${PRODUCT_NAME} - Software para tu negocio`,
    description: PRODUCT_TAGLINE,
    locale: "es_PE",
  },
  twitter: {
    card: "summary_large_image",
    title: `${PRODUCT_NAME} - Software para tu negocio`,
    description: PRODUCT_TAGLINE,
  },
};

const FOOTER_SECTIONS = [
  {
    title: "Producto",
    links: [
      { href: "#producto", label: "Que es" },
      { href: "#modulos", label: "Modulos" },
      { href: "#como-funciona", label: "Como funciona" },
      { href: "#planes", label: "Planes y precios" },
    ],
  },
  {
    title: "Empezar",
    links: [
      { href: "#contacto", label: "Pedir una demo" },
      { href: "#preguntas", label: "Preguntas frecuentes" },
      { href: "/login", label: "Ingresar a mi cuenta" },
    ],
  },
] as const;

export default function MarketingLayout({ children }: { children: ReactNode }) {
  const year = new Date().getFullYear();

  return (
    <div className="flex min-h-dvh flex-col">
      {/*
        The keyboard escape hatch. First focusable element on the page, visible
        only while focused, because a landing page has a long navigation and
        tabbing through it to reach the content every time is punishing (§19).
      */}
      <a
        href="#contenido"
        className="bg-primary text-primary-foreground sr-only rounded-lg px-4 py-2 text-sm font-medium focus-visible:not-sr-only focus-visible:absolute focus-visible:top-3 focus-visible:left-3 focus-visible:z-[60]"
      >
        Saltar al contenido
      </a>

      <SiteHeader />

      <main id="contenido" className="flex-1">
        {children}
      </main>

      <footer className="border-border bg-surface border-t">
        <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
          <div className="grid gap-10 md:grid-cols-[1.4fr_1fr_1fr_1.2fr]">
            <div className="flex flex-col gap-4">
              <ProductLogo size="md" withSlogan />
              <p className="text-muted-foreground max-w-xs text-sm">{PRODUCT_TAGLINE}</p>
            </div>

            {FOOTER_SECTIONS.map((section) => (
              <nav key={section.title} aria-label={section.title} className="flex flex-col gap-3">
                <h2 className="text-sm font-semibold">{section.title}</h2>
                <ul className="flex flex-col gap-2.5">
                  {section.links.map((link) => (
                    <li key={link.href}>
                      {link.href.startsWith("#") ? (
                        <a
                          href={link.href}
                          className="text-muted-foreground hover:text-foreground text-sm transition-colors"
                        >
                          {link.label}
                        </a>
                      ) : (
                        <Link
                          href={link.href}
                          className="text-muted-foreground hover:text-foreground text-sm transition-colors"
                        >
                          {link.label}
                        </Link>
                      )}
                    </li>
                  ))}
                </ul>
              </nav>
            ))}

            <div className="flex flex-col gap-3">
              <h2 className="text-sm font-semibold">Contacto</h2>
              <a
                href={`https://wa.me/${CONTACT_WHATSAPP}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-muted-foreground hover:text-foreground flex items-center gap-2 text-sm transition-colors"
              >
                <IconWhatsApp className="size-4" />
                {CONTACT_PHONE_DISPLAY}
              </a>
              <a
                href={`mailto:${CONTACT_EMAIL}`}
                className="text-muted-foreground hover:text-foreground flex items-center gap-2 text-sm transition-colors"
              >
                <IconMail className="size-4" />
                {CONTACT_EMAIL}
              </a>
            </div>
          </div>

          <div className="border-border mt-12 flex flex-col items-start justify-between gap-6 border-t pt-8 sm:flex-row sm:items-center">
            <p className="text-muted-foreground text-sm">
              &copy; {year} {PRODUCT_NAME}. Todos los derechos reservados.
            </p>

            {/*
              The authorship credit. The company mark, not the product one - the
              whole point of this line is that they are two different entities,
              which is also why it links out rather than back to `/`.
            */}
            <a
              href={VENDOR_SITE}
              target="_blank"
              rel="noopener noreferrer"
              className="group flex items-center gap-3 rounded-lg"
            >
              <span className="text-muted-foreground text-xs">Desarrollado por</span>
              <CloverWordmark className="w-28 opacity-80 transition-opacity group-hover:opacity-100 dark:hidden" />
              <CloverWordmark
                tone="inverted"
                className="hidden w-28 opacity-80 transition-opacity group-hover:opacity-100 dark:block"
              />
              <span className="sr-only">{VENDOR_NAME}</span>
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
