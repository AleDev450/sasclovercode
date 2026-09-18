import { IconWhatsApp } from "@/components/ui/icons";

/**
 * The floating WhatsApp button.
 *
 * A plain link, no JavaScript: it has to work on the slowest phone on the worst
 * connection, because that is who is most likely to prefer writing to ordering.
 * Every movement below is CSS for the same reason - the keyframes live in
 * `globals.css` under "TENANT SITE MOTION".
 *
 * WhatsApp green on every theme. The mark is recognised by its colour first, and
 * a gold WhatsApp button on Atelier would be one more thing a customer has to
 * read before they tap it.
 *
 * WHY IT MOVES. It is the one control on the page that is not part of the
 * layout, and a still green circle in a corner is the thing the eye learns to
 * skip within a second. So it does what the site this product is measured
 * against does: it arrives a moment after the page with a small overshoot,
 * and a ring breathes out of it for as long as the page is open. The ring is
 * the only loop on the site, on purpose - one thing asking for attention is a
 * signal, two is noise.
 *
 * THE ENTRANCE USES `backwards`, NOT `both`. A fill that held the last frame
 * would keep owning `transform` after the animation ended, and the hover scale
 * would never be seen. `backwards` holds the first frame during the delay (so
 * the button does not flash in and then pop) and lets go the moment it lands.
 */
export function WhatsAppButton({ href, businessName }: { href: string; businessName: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`Escribir a ${businessName} por WhatsApp`}
      className="group fixed right-5 bottom-5 z-30 flex size-14 items-center justify-center rounded-full text-white shadow-[0_12px_32px_-8px_rgba(37,211,102,0.7)] transition-[scale,box-shadow] duration-300 hover:scale-110 hover:shadow-[0_18px_44px_-8px_rgba(37,211,102,0.95)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#25D366] print:hidden"
      style={{
        background: "#25D366",
        animation: "site-pop-in 0.7s cubic-bezier(0.34, 1.56, 0.64, 1) 0.8s backwards",
      }}
    >
      <span
        aria-hidden
        className="absolute inset-0 rounded-full"
        style={{
          background: "#25D366",
          animation: "site-ping 2.4s cubic-bezier(0, 0, 0.2, 1) 1.6s infinite",
        }}
      />
      <IconWhatsApp
        className="relative size-7 transition-transform duration-300 group-hover:-rotate-12"
        strokeWidth={2}
      />
    </a>
  );
}
