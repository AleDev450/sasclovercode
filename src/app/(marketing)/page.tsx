import Link from "next/link";
import { Badge, Card, CardContent, buttonVariants } from "@/components/ui";
import {
  IconAlert,
  IconArrowRight,
  IconBox,
  IconBuilding,
  IconCard,
  IconChart,
  IconCart,
  IconCheck,
  IconCheckCircle,
  IconChef,
  IconClock,
  IconGift,
  IconGlobe,
  IconMail,
  IconPhone,
  IconReceipt,
  IconShield,
  IconSparkle,
  IconStore,
  IconTruck,
  IconUsers,
  IconWhatsApp,
} from "@/components/ui/icons";
import {
  CONTACT_EMAIL,
  CONTACT_PHONE_DISPLAY,
  CONTACT_WHATSAPP,
  PRODUCT_NAME,
  VENDOR_NAME,
} from "@/config/app";
import { AppPreview } from "@/modules/marketing/components/app-preview";
import { ContactForm } from "@/modules/marketing/components/contact-form";
import { Pricing } from "@/modules/marketing/components/pricing";

/**
 * The landing page for `Tu Tiendita`.
 *
 * WHAT IS NOT ON THIS PAGE, and why. There are no customer logos, no
 * testimonials and no "+500 negocios ya confian en nosotros". Every one of
 * those would be an invented claim about real people, and a landing page that
 * opens with a fabricated number is a product that has already told its first
 * lie. What is here instead is what the software actually does - which is a
 * great deal, and is checkable against the modules the platform ships.
 *
 * The prices in the plans section are read from the `plans` table at request
 * time for the same reason: a quoted figure the billing system would not honour
 * is a promise nobody can keep.
 */

const PAIN_POINTS = [
  {
    icon: IconAlert,
    title: "Los pedidos se pierden entre WhatsApp y el cuaderno",
    body: "Uno se anota en un papel, otro queda en un chat sin leer y el de la mesa 4 nadie lo recuerda.",
  },
  {
    icon: IconBox,
    title: "Nunca sabes cuanto stock queda de verdad",
    body: "Te enteras de que falto un insumo cuando el cliente ya pidio el plato.",
  },
  {
    icon: IconChart,
    title: "Cerrar el dia toma una hora y una calculadora",
    body: "Sumar boletas a mano al final del turno, y aun asi la caja no cuadra.",
  },
] as const;

const MODULES = [
  {
    icon: IconGlobe,
    name: "Tu pagina web",
    body: "Tu catalogo publicado en tu propio dominio, con tus fotos, tus precios y tus horarios. Tus clientes piden desde ahi, sin apps ni comisiones de terceros.",
  },
  {
    icon: IconStore,
    name: "Catalogo",
    body: "Categorias, productos, variantes, tamanos y agregados. Cambias un precio una vez y cambia en todos lados: en la web, en la caja y en la cocina.",
  },
  {
    icon: IconCart,
    name: "Pedidos",
    body: "Todos los canales en una sola lista: mostrador, web, delivery y telefono. Cada pedido con su estado, su historial y quien lo atendio.",
  },
  {
    icon: IconCard,
    name: "Punto de venta",
    body: "Cobra en tablet o computadora, con apertura y cierre de caja, arqueo y varios metodos de pago en un mismo ticket.",
  },
  {
    icon: IconChef,
    name: "Pantalla de cocina",
    body: "Las comandas llegan solas a la estacion que corresponde y se actualizan en vivo. Nadie grita pedidos ni imprime papelitos.",
  },
  {
    icon: IconBox,
    name: "Inventario",
    body: "Insumos, proveedores, compras y recetas. Vendes un plato y el sistema descuenta lo que llevo, sin que nadie anote nada.",
  },
  {
    icon: IconTruck,
    name: "Delivery",
    body: "Zonas de reparto con su propia tarifa, asignacion de repartidor y seguimiento del pedido hasta la puerta del cliente.",
  },
  {
    icon: IconReceipt,
    name: "Facturacion electronica",
    body: "Boletas y facturas emitidas desde el mismo pedido, con su serie, su estado y su historial de envio.",
  },
  {
    icon: IconGift,
    name: "Fidelizacion",
    body: "Promociones, cupones y puntos por compra. Tus clientes vuelven porque les conviene, no porque te acordaste de escribirles.",
  },
  {
    icon: IconBuilding,
    name: "Multi-sede",
    body: "Varios locales con su propio stock, su propia caja y sus propios horarios, y una sola vista para verlos todos juntos.",
  },
  {
    icon: IconChart,
    name: "Reportes",
    body: "Que se vendio, a que hora, en que canal y con cuanto margen. Los numeros que necesitas para decidir, no una hoja de calculo.",
  },
  {
    icon: IconUsers,
    name: "Equipo y permisos",
    body: "Cada persona ve solo lo suyo: el cajero cobra, el mozo toma pedidos, el contador mira los comprobantes. Tu ves todo.",
  },
] as const;

const STEPS = [
  {
    step: "01",
    title: "Conversamos",
    body: "Nos cuentas como trabajas hoy: que vendes, cuantos locales tienes y que te esta costando mas. Sin formularios eternos.",
  },
  {
    step: "02",
    title: "Configuramos tu tienda",
    body: "Cargamos tu catalogo, tus sedes, tus metodos de pago y tu dominio. Te entregamos el sistema listo para usarse, no una cuenta vacia.",
  },
  {
    step: "03",
    title: "Capacitamos a tu equipo",
    body: "Una sesion corta con quienes van a usarlo todos los dias. El punto de venta se aprende en una tarde.",
  },
  {
    step: "04",
    title: "Vendes, y nosotros seguimos ahi",
    body: "Soporte real por WhatsApp, actualizaciones incluidas y tus datos respaldados. No te dejamos solo despues de la firma.",
  },
] as const;

const GUARANTEES = [
  {
    icon: IconShield,
    title: "Tus datos son tuyos",
    body: "Cada negocio esta aislado del resto a nivel de base de datos. Nadie mas puede leer tu informacion, ni por error.",
  },
  {
    icon: IconClock,
    title: "Funciona en cualquier pantalla",
    body: "La misma cuenta en la computadora del local, en la tablet de la caja y en el telefono cuando no estas ahi.",
  },
  {
    icon: IconSparkle,
    title: "Crece contigo",
    body: "Empiezas con lo que necesitas hoy y activas modulos cuando los necesites. No pagas por lo que no usas.",
  },
] as const;

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
      {/* ------------------------------------------------------------- hero */}
      <section className="relative overflow-hidden">
        <div aria-hidden className="bg-brand-aura absolute inset-x-0 top-0 h-[42rem]" />
        <div aria-hidden className="bg-grid absolute inset-x-0 top-0 h-[42rem] opacity-40" />

        <div className="relative mx-auto max-w-6xl px-4 pt-16 pb-20 sm:px-6 sm:pt-24 lg:pt-28">
          <div className="grid items-center gap-12 lg:grid-cols-[1.05fr_1fr] lg:gap-16">
            <div className="animate-rise flex flex-col items-start gap-6">
              <Badge variant="brand" className="px-3 py-1.5">
                <IconSparkle className="size-3.5" />
                Hecho en Peru para negocios peruanos
              </Badge>

              <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl lg:text-[3.5rem] lg:leading-[1.05]">
                Todo tu negocio, <span className="text-gradient-brand">en un solo sistema</span>
              </h1>

              <p className="text-muted-foreground max-w-xl text-lg leading-relaxed">
                {PRODUCT_NAME} reune tu catalogo, tus pedidos, tu caja, tu inventario, tu delivery y
                tus boletas en una sola plataforma. Deja el cuaderno y el Excel: mira tu negocio
                completo desde una pantalla.
              </p>

              <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:items-center">
                <a href="#contacto" className={buttonVariants({ variant: "brand", size: "xl" })}>
                  Pedir una demo gratis
                  <IconArrowRight />
                </a>
                <a href="#modulos" className={buttonVariants({ variant: "outline", size: "xl" })}>
                  Ver que incluye
                </a>
              </div>

              <ul className="text-muted-foreground flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
                {["Sin permanencia", "Implementacion acompanada", "Soporte por WhatsApp"].map(
                  (item) => (
                    <li key={item} className="flex items-center gap-2">
                      <IconCheckCircle className="text-primary size-4" />
                      {item}
                    </li>
                  ),
                )}
              </ul>
            </div>

            <div className="animate-fade lg:pl-4">
              <AppPreview />
            </div>
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------- problem */}
      <section id="producto" className="border-border bg-surface border-y">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-24">
          <div className="mx-auto flex max-w-2xl flex-col items-center gap-4 text-center">
            <Badge variant="neutral">El problema</Badge>
            <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              Si tu negocio vive en papeles sueltos, no es culpa tuya
            </h2>
            <p className="text-muted-foreground text-lg">
              Es lo que pasa cuando cada parte de la operacion vive en una herramienta distinta.
            </p>
          </div>

          <div className="mt-14 grid gap-6 md:grid-cols-3">
            {PAIN_POINTS.map((point) => (
              <Card key={point.title} variant="flat" className="bg-card/60">
                <CardContent className="flex flex-col gap-4 p-6 pt-6">
                  <span className="bg-destructive/10 text-destructive flex size-11 items-center justify-center rounded-xl">
                    <point.icon />
                  </span>
                  <h3 className="text-base font-semibold">{point.title}</h3>
                  <p className="text-muted-foreground text-sm leading-relaxed">{point.body}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="border-primary/20 bg-accent/50 mt-10 flex flex-col items-center gap-3 rounded-2xl border p-8 text-center">
            <h3 className="text-xl font-semibold tracking-tight sm:text-2xl">
              {PRODUCT_NAME} conecta todo eso en un solo lugar.
            </h3>
            <p className="text-muted-foreground max-w-2xl">
              Un pedido que entra por la web llega a la cocina, descuenta el inventario, se cobra en
              caja, emite su boleta y aparece en el reporte del dia. Sin que nadie lo copie a mano.
            </p>
          </div>
        </div>
      </section>

      {/* --------------------------------------------------------- features */}
      <section id="modulos">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-24">
          <div className="flex max-w-2xl flex-col gap-4">
            <Badge variant="brand" className="self-start">
              Modulos
            </Badge>
            <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              Todo lo que tu negocio necesita, ya incluido
            </h2>
            <p className="text-muted-foreground text-lg">
              No son integraciones de terceros ni plugins que hay que conectar. Es un solo sistema,
              pensado como un solo sistema.
            </p>
          </div>

          <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {MODULES.map((module) => (
              <Card key={module.name} variant="interactive" className="h-full">
                <CardContent className="flex h-full flex-col gap-3.5 p-6 pt-6">
                  <span className="bg-accent text-accent-foreground flex size-11 items-center justify-center rounded-xl">
                    <module.icon />
                  </span>
                  <h3 className="font-semibold tracking-tight">{module.name}</h3>
                  <p className="text-muted-foreground text-sm leading-relaxed">{module.body}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------- guarantees */}
      <section className="border-border bg-surface border-y">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <div className="grid gap-8 md:grid-cols-3">
            {GUARANTEES.map((item) => (
              <div key={item.title} className="flex gap-4">
                <span className="bg-primary/10 text-primary flex size-11 shrink-0 items-center justify-center rounded-xl">
                  <item.icon />
                </span>
                <div className="flex flex-col gap-1.5">
                  <h3 className="font-semibold tracking-tight">{item.title}</h3>
                  <p className="text-muted-foreground text-sm leading-relaxed">{item.body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------ how it works */}
      <section id="como-funciona">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-24">
          <div className="mx-auto flex max-w-2xl flex-col items-center gap-4 text-center">
            <Badge variant="neutral">Como funciona</Badge>
            <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              De la primera llamada a tu primera venta
            </h2>
            <p className="text-muted-foreground text-lg">
              No te entregamos un usuario y una contrasena. Te entregamos tu negocio configurado.
            </p>
          </div>

          <ol className="mt-14 grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((step) => (
              <li key={step.step}>
                <Card className="h-full">
                  <CardContent className="flex h-full flex-col gap-3 p-6 pt-6">
                    <span className="text-primary/30 text-3xl font-semibold tabular-nums">
                      {step.step}
                    </span>
                    <h3 className="font-semibold tracking-tight">{step.title}</h3>
                    <p className="text-muted-foreground text-sm leading-relaxed">{step.body}</p>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ----------------------------------------------------------- pricing */}
      <section id="planes" className="border-border bg-surface border-y">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-24">
          <div className="mx-auto flex max-w-2xl flex-col items-center gap-4 text-center">
            <Badge variant="brand">Planes</Badge>
            <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              Un precio claro, sin sorpresas
            </h2>
            <p className="text-muted-foreground text-lg">
              Todos los planes incluyen implementacion acompanada, actualizaciones y soporte. Puedes
              cambiar de plan cuando lo necesites.
            </p>
          </div>

          <div className="mt-14">
            <Pricing />
          </div>

          <p className="text-muted-foreground mt-10 text-center text-sm">
            Precios en soles, sin IGV. Necesitas algo distinto?{" "}
            <a href="#contacto" className="text-primary font-medium hover:underline">
              Conversemos tu caso
            </a>
            .
          </p>
        </div>
      </section>

      {/* --------------------------------------------------------------- faq */}
      <section id="preguntas">
        <div className="mx-auto max-w-3xl px-4 py-20 sm:px-6 sm:py-24">
          <div className="flex flex-col gap-4">
            <Badge variant="neutral" className="self-start">
              Preguntas frecuentes
            </Badge>
            <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
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

      {/* ----------------------------------------------------------- contact */}
      <section id="contacto" className="bg-ink relative overflow-hidden">
        <div
          aria-hidden
          className="bg-brand/15 absolute -top-40 -right-32 size-[30rem] rounded-full blur-3xl"
        />

        <div className="relative mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-24">
          <div className="grid gap-12 lg:grid-cols-[1fr_1.1fr] lg:gap-16">
            <div className="flex flex-col gap-6">
              <Badge className="self-start border-white/15 bg-white/10 text-white/80">
                Contacto
              </Badge>

              <h2 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">
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

      {/* --------------------------------------------------------- final cta */}
      <section>
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <div className="border-border bg-card shadow-e2 flex flex-col items-center gap-6 rounded-2xl border p-10 text-center sm:p-14">
            <span className="bg-accent text-accent-foreground flex size-14 items-center justify-center rounded-2xl">
              <IconPhone className="size-6" />
            </span>
            <h2 className="max-w-2xl text-2xl font-semibold tracking-tight sm:text-3xl">
              Tu competencia ya dejo el cuaderno. Te ayudamos a alcanzarla.
            </h2>
            <p className="text-muted-foreground max-w-xl">
              {PRODUCT_NAME} es desarrollado y soportado por {VENDOR_NAME}. Hablas con las mismas
              personas que construyen el sistema.
            </p>
            <div className="flex flex-col gap-3 sm:flex-row">
              <a href="#contacto" className={buttonVariants({ variant: "brand", size: "lg" })}>
                Pedir una demo
                <IconArrowRight />
              </a>
              <Link href="/login" className={buttonVariants({ variant: "outline", size: "lg" })}>
                Ya soy cliente
              </Link>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
