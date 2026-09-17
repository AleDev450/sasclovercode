import { IconWhatsApp } from "@/components/ui/icons";

/**
 * The floating WhatsApp button.
 *
 * A plain link, no JavaScript: it has to work on the slowest phone on the worst
 * connection, because that is who is most likely to prefer writing to ordering.
 *
 * WhatsApp green on every theme. The mark is recognised by its colour first, and
 * a gold WhatsApp button on Atelier would be one more thing a customer has to
 * read before they tap it.
 */
export function WhatsAppButton({ href, businessName }: { href: string; businessName: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`Escribir a ${businessName} por WhatsApp`}
      className="fixed right-5 bottom-5 z-30 flex size-14 items-center justify-center rounded-full text-white shadow-[0_12px_32px_-8px_rgba(37,211,102,0.7)] transition-transform hover:scale-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#25D366] print:hidden"
      style={{ background: "#25D366" }}
    >
      <IconWhatsApp className="size-7" strokeWidth={2} />
    </a>
  );
}
