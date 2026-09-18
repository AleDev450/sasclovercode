import Link from "next/link";
import { IconBook, IconMail, IconMapPin, IconPhone, IconWhatsApp } from "@/components/ui/icons";
import { PRODUCT_NAME, VENDOR_NAME, VENDOR_SITE } from "@/config/app";
import type { PublicSocialLink } from "../server/queries";
import { SocialLinks } from "./social-links";
import { displayStyle, subtleStyle } from "./site-styles";

export interface FooterLink {
  readonly label: string;
  readonly href: string;
}

/**
 * The footer of every restaurant site, in Sugu Rolls' four columns: the brand,
 * quick links, help and policies, and contact - the hours live on Contacto.
 *
 * THE LIBRO DE RECLAMACIONES GETS ITS OWN BOX, outside the link lists. The
 * consumer protection rules ask for it to be clearly visible from every page -
 * a line among "Politica de cookies" and "Terminos" does not meet that, a
 * bordered block with the book icon does.
 */
export function SiteFooter({
  basePath,
  name,
  logoUrl,
  tagline,
  social,
  quickLinks,
  helpLinks,
  address,
  phone,
  whatsappHref,
  email,
}: {
  basePath: string;
  name: string;
  logoUrl: string | null;
  tagline: string | null;
  social: readonly PublicSocialLink[];
  quickLinks: readonly FooterLink[];
  helpLinks: readonly FooterLink[];
  address: string | null;
  phone: string | null;
  whatsappHref: string | null;
  email: string | null;
}) {
  const year = new Date().getFullYear();

  const columnTitle = "text-[0.7rem] font-semibold uppercase tracking-[0.2em]";

  return (
    <footer
      className="mt-[var(--site-section-space)] print:hidden"
      style={{ borderTop: "1px solid var(--site-border)", background: "var(--site-surface)" }}
    >
      <div className="mx-auto grid max-w-6xl gap-12 px-6 pt-16 pb-12 sm:grid-cols-2 sm:px-10 lg:grid-cols-4">
        <div className="flex flex-col gap-5">
          <Link href={basePath} aria-label={`${name}, inicio`}>
            {logoUrl !== null ? (
              /* eslint-disable-next-line @next/next/no-img-element -- signed Storage URL */
              <img
                src={logoUrl}
                alt={name}
                className="h-20 w-auto max-w-[200px] object-contain"
                style={{ borderRadius: "var(--site-radius-chip)" }}
              />
            ) : (
              <span className="text-2xl" style={{ ...displayStyle, color: "var(--site-primary)" }}>
                {name}
              </span>
            )}
          </Link>
          {tagline !== null ? (
            <p className="max-w-xs text-sm leading-relaxed" style={{ color: "var(--site-muted)" }}>
              {tagline}
            </p>
          ) : null}
          <SocialLinks links={social} />
        </div>

        <nav aria-labelledby="footer-quick">
          <h2 id="footer-quick" className={columnTitle}>
            Enlaces rápidos
          </h2>
          <ul className="mt-5 flex flex-col gap-3">
            {quickLinks.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  className="text-sm transition-opacity hover:opacity-70"
                  style={{ color: "var(--site-muted)" }}
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <nav aria-labelledby="footer-help">
          <h2 id="footer-help" className={columnTitle}>
            Ayuda y políticas
          </h2>
          <ul className="mt-5 flex flex-col gap-3">
            {helpLinks.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  className="text-sm transition-opacity hover:opacity-70"
                  style={{ color: "var(--site-muted)" }}
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div>
          <h2 className={columnTitle}>Contacto</h2>
          <ul className="mt-5 flex flex-col gap-3.5 text-sm" style={{ color: "var(--site-muted)" }}>
            {address !== null ? (
              <li className="flex items-start gap-2.5">
                <IconMapPin
                  className="mt-0.5 size-4 shrink-0"
                  style={{ color: "var(--site-primary)" }}
                />
                {address}
              </li>
            ) : null}
            {phone !== null ? (
              <li>
                <a
                  href={`tel:${phone.replace(/[^+0-9]/g, "")}`}
                  className="flex items-start gap-2.5 transition-opacity hover:opacity-70"
                >
                  <IconPhone
                    className="mt-0.5 size-4 shrink-0"
                    style={{ color: "var(--site-primary)" }}
                  />
                  {phone}
                </a>
              </li>
            ) : null}
            {whatsappHref !== null ? (
              <li>
                <a
                  href={whatsappHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-start gap-2.5 transition-opacity hover:opacity-70"
                >
                  <IconWhatsApp
                    className="mt-0.5 size-4 shrink-0"
                    style={{ color: "var(--site-primary)" }}
                  />
                  WhatsApp
                </a>
              </li>
            ) : null}
            {email !== null ? (
              <li>
                <a
                  href={`mailto:${email}`}
                  className="flex items-start gap-2.5 break-all transition-opacity hover:opacity-70"
                >
                  <IconMail
                    className="mt-0.5 size-4 shrink-0"
                    style={{ color: "var(--site-primary)" }}
                  />
                  {email}
                </a>
              </li>
            ) : null}
          </ul>

          {/*
            The week's hours used to be printed here, on every page, as a
            seven-line table - which made the footer the tallest block on the
            site and repeated, word for word, the table Contacto exists to show.
            A footer is for finding things, not for reading them; the hours are
            one link away, next to the address they belong with.
          */}
          <Link
            href={`${basePath}/contacto`}
            className="mt-6 inline-flex items-center gap-2 text-sm font-semibold transition-opacity hover:opacity-80"
            style={{ color: "var(--site-primary)" }}
          >
            Ver horario y cómo llegar
            <span aria-hidden>→</span>
          </Link>
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-6 pb-10 sm:px-10">
        <Link
          href={`${basePath}/libro-de-reclamaciones`}
          className="inline-flex items-center gap-3 px-4 py-3 transition-opacity hover:opacity-80"
          style={{
            border: "1px solid var(--site-border-strong)",
            borderRadius: "var(--site-radius-chip)",
          }}
        >
          <IconBook className="size-6 shrink-0" />
          <span className="text-left text-xs leading-tight font-semibold tracking-wide uppercase">
            Libro de
            <br />
            Reclamaciones
          </span>
        </Link>
      </div>

      <div style={{ borderTop: "1px solid var(--site-border)" }}>
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-2 px-6 py-6 text-center text-xs sm:flex-row sm:px-10 sm:text-left">
          <p style={subtleStyle}>
            © {year} {name}. Todos los derechos reservados.
          </p>
          {/* The platform credit links out, not to `/`, which on this hostname is
              the restaurant's own site. */}
          <a
            href={VENDOR_SITE}
            target="_blank"
            rel="noopener noreferrer"
            className="transition-opacity hover:opacity-100"
            style={subtleStyle}
          >
            Hecho con {PRODUCT_NAME} de {VENDOR_NAME}
          </a>
        </div>
      </div>
    </footer>
  );
}
