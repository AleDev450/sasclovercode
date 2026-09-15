import { Badge, Card, CardContent } from "@/components/ui";
import { IconCheck, IconMail, IconWhatsApp } from "@/components/ui/icons";
import { CONTACT_EMAIL, CONTACT_PHONE_DISPLAY, CONTACT_WHATSAPP } from "@/config/app";
import { ContactForm } from "@/modules/marketing/components/contact-form";
import { Pricing } from "@/modules/marketing/components/pricing";
import { Features } from "@/modules/marketing/components/landing/features";
import { FinalCta } from "@/modules/marketing/components/landing/final-cta";
import { Hero } from "@/modules/marketing/components/landing/hero";
import { RestaurantShowcase } from "@/modules/marketing/components/landing/restaurant-showcase";
import { Steps } from "@/modules/marketing/components/landing/steps";
import { Transformation } from "@/modules/marketing/components/landing/transformation";

/**
 * The landing page for `Vendra`.
 *
 * WHAT IS NOT ON THIS PAGE, and why. There are no customer logos, no
 * testimonials and no "+500 negocios ya confian en nosotros". Every one of
 * those would be an invented claim about real people, and a landing page that
 * opens with a fabricated number is a product that has already told its first
 * lie. What is here instead is what the software actually does - which is a
 * great deal, and is checkable against the modules the platform ships.
 *
 * The three restaurants in the showcase are the one apparent exception, and
 * they are framed as what a visitor's own site COULD look like rather than as
 * anybody's client list. `restaurant-showcase.tsx` says so at the point of the
 * decision.
 *
 * The prices in the plans section are read from the `plans` table at request
 * time for the same reason: a quoted figure the billing system would not honour
 * is a promise nobody can keep. The three rows currently in that table happen
 * to be S/ 99, S/ 199 and S/ 399 - which is what the brief for this page asked
 * for - but the page shows whatever the catalogue says, not what a designer
 * typed.
 *
 * COMPOSITION ONLY. Each section is its own component under
 * `modules/marketing/components/landing/`, and their copy and lists live in
 * `landing-data.ts`. This file is the running order and nothing else, so the
 * question "what is on the landing page, in what sequence" is answered by
 * reading twelve lines.
 *
 * EVERY SECTION IS A SERVER COMPONENT. The only client component on this route
 * is the header, which needs state for the mobile menu and the scrolled border.
 * The entrance animations are CSS (`.reveal` in `globals.css`), so none of them
 * costs a byte of JavaScript on a phone.
 */

const FAQS = [
  {
    q: "Tengo que cambiar la forma en que trabajo?",
    a: "No. Configuramos el sistema alrededor de tu operacion actual: tus productos, tus precios, tus turnos y tus metodos de pago. Lo que cambia es que dejas de anotar lo mismo tres veces.",
  },
  {
    q: "Sirve si vendo por WhatsApp?",
    a: "Si, y es el caso mas comun. Tus clientes siguen escribiendote, pero el pedido lo registras una sola vez y ya queda en caja, en cocina y en tus reportes. Ademas te damos tu propia pagina para que pidan solos.",
  },
  {
    q: "Necesito internet todo el tiempo?",
    a: "Si, el sistema trabaja en linea para que todos tus dispositivos vean lo mismo al instante. Funciona bien con una conexion normal de local comercial.",
  },
  {
    q: "Emite boletas y facturas validas?",
    a: "El modulo de facturacion electronica emite comprobantes desde el mismo pedido y guarda su estado de envio. La conexion con tu proveedor autorizado se configura durante la implementacion.",
  },
  {
    q: "Que pasa si tengo mas de un local?",
    a: "Cada sede tiene su propio stock, su caja y sus horarios, y tu ves los numeros de todas desde una sola cuenta. Esta incluido en el plan que contempla multi-sede.",
  },
  {
    q: "Cuanto demora tenerlo funcionando?",
    a: "Depende del tamano de tu catalogo. Un negocio con una sede suele estar vendiendo con el sistema en pocos dias desde que nos entregas la informacion.",
  },
] as const;

export default function LandingPage() {
  return (
    <>
      <Hero />
      <RestaurantShowcase />
      <Features />
      <Transformation />
      <Steps />

      {/* ------------------------------------------------------------ plans */}
      <section id="planes" className="scroll-mt-24">
        <div className="mx-auto max-w-[1280px] px-6 py-20 sm:px-8 lg:py-28 xl:px-12">
          <div className="reveal flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <h2 className="type-display text-ink max-w-[16ch] text-[2rem] text-balance sm:text-[2.6rem]">
              Planes para cada etapa de tu restaurante.
            </h2>
            <p className="text-muted-foreground shrink-0 text-sm">
              Sin comisiones por venta. Cancela cuando quieras.
            </p>
          </div>

          <div className="reveal mt-12">
            <Pricing />
          </div>
        </div>
      </section>

      <section id="preguntas">
        <div className="mx-auto max-w-3xl px-6 py-20 sm:px-8 lg:py-28">
          <div className="flex flex-col gap-4">
            <Badge variant="neutral" className="self-start">
              Preguntas frecuentes
            </Badge>
            <h2 className="type-display text-ink text-[2rem] sm:text-[2.6rem]">
              Lo que todos nos preguntan
            </h2>
          </div>

          <div className="mt-10 flex flex-col gap-3">
            {FAQS.map((faq) => (
              <details
                key={faq.q}
                className="border-border bg-card group [&[open]]:shadow-e1 rounded-xl border px-5 py-4"
              >
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium">
                  {faq.q}
                  <span
                    aria-hidden
                    className="text-muted-foreground shrink-0 text-xl leading-none transition-transform group-open:rotate-45"
                  >
                    +
                  </span>
                </summary>
                <p className="text-muted-foreground mt-3 text-sm leading-relaxed">{faq.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/*
        The dark closing section, then the form it asks for.

        Order matters here: the CTA button anchors to `#contacto`, so it has to
        sit ABOVE the form or the page would scroll a visitor backwards to
        convert them.
      */}
      <FinalCta />

      {/* ----------------------------------------------------------- contact */}
      <section id="contacto" className="bg-ink relative overflow-hidden">
        <div
          aria-hidden
          className="bg-brand/15 absolute -top-40 -right-32 size-[30rem] rounded-full blur-3xl"
        />

        <div className="relative mx-auto max-w-[1280px] px-6 py-20 sm:px-8 lg:py-28 xl:px-12">
          <div className="grid gap-12 lg:grid-cols-[1fr_1.1fr] lg:gap-16">
            <div className="flex flex-col gap-6">
              <Badge className="self-start border-white/15 bg-white/10 text-white/80">
                Contacto
              </Badge>

              <h2 className="type-display text-[2rem] text-balance text-white sm:text-[2.6rem]">
                Cuentanos de tu negocio y te mostramos como quedaria
              </h2>

              <p className="text-lg leading-relaxed text-white/70">
                Una demostracion de veinte minutos, con tu catalogo y tu forma de vender. Sin
                compromiso y sin tarjeta.
              </p>

              <ul className="flex flex-col gap-3">
                {[
                  "Te respondemos dentro de 24 horas habiles",
                  "Te decimos si el sistema te sirve, aunque la respuesta sea no",
                  "Te pasamos un presupuesto cerrado, sin costos ocultos",
                ].map((item) => (
                  <li key={item} className="flex items-start gap-3 text-white/80">
                    <IconCheck className="mt-0.5 size-4 shrink-0 text-[color:var(--brand-500)]" />
                    <span className="text-sm">{item}</span>
                  </li>
                ))}
              </ul>

              <div className="mt-4 flex flex-col gap-3 border-t border-white/10 pt-6">
                <p className="text-xs font-medium tracking-wide text-white/50 uppercase">
                  O escribenos directo
                </p>
                <div className="flex flex-wrap gap-3">
                  <a
                    href={`https://wa.me/${CONTACT_WHATSAPP}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 rounded-lg border border-white/15 bg-white/5 px-4 py-2.5 text-sm text-white transition-colors hover:bg-white/10"
                  >
                    <IconWhatsApp className="size-4" />
                    {CONTACT_PHONE_DISPLAY}
                  </a>
                  <a
                    href={`mailto:${CONTACT_EMAIL}`}
                    className="flex items-center gap-2 rounded-lg border border-white/15 bg-white/5 px-4 py-2.5 text-sm text-white transition-colors hover:bg-white/10"
                  >
                    <IconMail className="size-4" />
                    {CONTACT_EMAIL}
                  </a>
                </div>
              </div>
            </div>

            {/*
              The form keeps the light surface on the dark section. It is the
              one interactive thing here, and inverting a whole form - inputs,
              placeholders, focus rings, error states - to sit on the ink would
              be four more states to get right for no gain in legibility.
            */}
            <Card variant="elevated" className="h-fit">
              <CardContent className="p-6 pt-6 sm:p-8 sm:pt-8">
                <h3 className="text-lg font-semibold tracking-tight">Solicita tu demo</h3>
                <p className="text-muted-foreground mt-1 mb-6 text-sm">
                  Completa esto y te contactamos nosotros.
                </p>
                <ContactForm />
              </CardContent>
            </Card>
          </div>
        </div>
      </section>
    </>
  );
}
