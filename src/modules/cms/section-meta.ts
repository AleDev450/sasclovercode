/**
 * What each section type IS, in the words of somebody choosing one.
 *
 * `sections.ts` says what a section may contain; this says what it is for. They
 * are separate files because they answer to different readers: the schema is
 * read by the server when it validates, and this is read by a shop owner at the
 * moment they are looking at eight cards and wondering which one puts photos of
 * their food on the page.
 *
 * Client-safe - the editor imports it - so nothing here may reach for
 * `server-only` code.
 */

import type { SectionType } from "./sections";

export interface SectionMeta {
  readonly label: string;
  /** One line, in plain language. Never the field names. */
  readonly description: string;
  /** Key into the glyph map in `section-editor.tsx`. */
  readonly icon: string;
}

export const SECTION_META: Record<SectionType, SectionMeta> = {
  hero: {
    label: "Portada",
    description: "El titular grande con el que abre la pagina, con foto y un boton.",
    icon: "hero",
  },
  text: {
    label: "Texto",
    description: "Uno o varios parrafos. Para contar la historia del negocio.",
    icon: "text",
  },
  image: {
    label: "Imagen",
    description: "Una sola foto a lo ancho, con pie opcional.",
    icon: "image",
  },
  banner: {
    label: "Aviso",
    description: "Una franja corta para algo puntual: un feriado, un horario especial.",
    icon: "banner",
  },
  cta: {
    label: "Llamada a la accion",
    description: "Un bloque destacado que empuja a pedir, reservar o escribir.",
    icon: "cta",
  },
  gallery: {
    label: "Galeria",
    description: "Varias fotos en cuadricula. El local, el equipo, los platos.",
    icon: "gallery",
  },
  products: {
    label: "Productos",
    description: "Trae tu carta automaticamente. Si cambias un precio, aqui cambia solo.",
    icon: "products",
  },
  faq: {
    label: "Preguntas frecuentes",
    description: "Pregunta y respuesta. Ahorra llamadas repetidas.",
    icon: "faq",
  },
  slider: {
    label: "Slider de portada",
    description: "Fotos a todo lo ancho que pasan solas. Una para computadora y otra para celular.",
    icon: "slider",
  },
  shortcuts: {
    label: "Accesos",
    description: "Tarjetas grandes con foto que llevan a la carta, al delivery o a otra pagina.",
    icon: "shortcuts",
  },
  bestsellers: {
    label: "Los mas pedidos",
    description: "Tus platos mas vendidos, calculados solos con tus pedidos reales.",
    icon: "bestsellers",
  },
};

/**
 * Starting content for each type.
 *
 * A new section has to be VALID the moment it is created, not after the person
 * decodes an error message - which is what a blank template guaranteed. The
 * values are deliberately real sentences rather than "Lorem": somebody who
 * saves without editing gets a page that reads as unfinished, which is honest,
 * instead of a page that reads as broken.
 */
export const SECTION_TEMPLATES: Record<SectionType, Record<string, unknown>> = {
  hero: {
    heading: "Bienvenido",
    subheading: "Cuenta en una linea que ofreces y por que volver.",
    ctaLabel: "Ver la carta",
    ctaHref: "/sitio/carta",
  },
  text: {
    heading: "Sobre nosotros",
    paragraphs: ["Escribe aqui la historia de tu negocio."],
  },
  image: { imagePath: "", alt: "" },
  banner: { message: "Abierto de martes a domingo.", tone: "info" },
  cta: {
    heading: "Haz tu pedido hoy",
    body: "Llamanos o escribenos por WhatsApp.",
    buttonLabel: "Contactar",
    buttonHref: "/sitio/contacto",
  },
  gallery: { heading: "Nuestro local", images: [] },
  products: { heading: "Nuestra carta", limit: 8 },
  faq: {
    heading: "Preguntas frecuentes",
    items: [{ question: "Hacen delivery?", answer: "Si, en todo el distrito." }],
  },
  // Empty on purpose: valid, and renders the brand cover until photos exist.
  slider: { slides: [], intervalSeconds: 6 },
  shortcuts: {
    cards: [
      {
        title: "Nuestra carta",
        body: "Todos nuestros platos, preparados al momento.",
        href: "/sitio/carta",
        linkLabel: "Ver la carta",
      },
      {
        title: "Zonas de delivery",
        body: "Mira si llegamos a tu distrito y cuanto cuesta el envio.",
        href: "/sitio/zonas-de-delivery",
        linkLabel: "Ver zonas",
      },
    ],
  },
  bestsellers: {
    eyebrow: "Los mas pedidos",
    heading: "Nuestros favoritos",
    limit: 4,
    linkLabel: "Ver la carta completa",
  },
};

/** The tone options of a banner, named for the person choosing one. */
export const BANNER_TONES = [
  { value: "info", label: "Informativo (azul)" },
  { value: "success", label: "Buena noticia (verde)" },
  { value: "warning", label: "Atencion (ambar)" },
] as const;
