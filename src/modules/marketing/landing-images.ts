/**
 * Every photograph on the landing page, in one file.
 *
 * WHY THEY ARE ALL HERE. These are STOCK images standing in for photography
 * that does not exist yet, and the single most likely thing to happen to this
 * page is somebody replacing them with real restaurant photos. Scattered across
 * nine components that is an afternoon of grepping; here it is one file, and
 * the components never learn whether a URL is remote or a path in `/public`.
 *
 * WHAT THEY MAY AND MAY NOT SHOW. Peruvian food, kitchens, restaurants and the
 * people who run them. No fashion, no generic e-commerce, no models holding
 * shopping bags - the product is sold to restaurants and a landing page that
 * illustrates itself with a clothing rack tells a visitor they are in the wrong
 * place before they have read a word.
 *
 * `images.unsplash.com` is the one remote host `next/image` is allowed to fetch
 * (`next.config.ts`). Replacing these with local assets under `/public` means
 * changing the strings below and nothing else; the allow-list can then go.
 *
 * Each entry carries its own alt text, because the alt describes THE IMAGE and
 * belongs with the URL - a component that hard-codes alt text beside a URL it
 * receives as a prop is describing a photograph it cannot see.
 */

export interface LandingImage {
  readonly src: string;
  /** Spanish, describing what is shown. Empty only where the image is decorative. */
  readonly alt: string;
}

/** Unsplash serves a resized JPEG from query parameters; ask for what we draw. */
function unsplash(id: string, width: number): string {
  return `https://images.unsplash.com/${id}?auto=format&fit=crop&q=75&w=${width}`;
}

export const LANDING_IMAGES = {
  /** Inside the browser mockup, as the demo restaurant's own hero photo. */
  heroDish: {
    src: unsplash("photo-1559847844-5315695dadae", 1200),
    alt: "Plato de mariscos peruano servido en un bol de ceramica",
  },

  /** The four dishes on the demo restaurant's carta. */
  ceviche: {
    src: unsplash("photo-1559847844-5315695dadae", 320),
    alt: "Ceviche de pescado con camote y choclo",
  },
  lomo: {
    src: unsplash("photo-1504674900247-0877df9cc836", 320),
    alt: "Plato de carne salteada con guarnicion",
  },
  ajiDeGallina: {
    src: unsplash("photo-1546069901-ba9599a7e63c", 320),
    alt: "Bol de comida casera con arroz y salsa amarilla",
  },
  arrozMariscos: {
    src: unsplash("photo-1512058564366-18510be2db19", 320),
    alt: "Arroz con mariscos servido en sarten con limon",
  },

  /** The three restaurants in the showcase. */
  marea: {
    src: unsplash("photo-1512058564366-18510be2db19", 900),
    alt: "Arroz con mariscos recien servido en una cevicheria",
  },
  brasa: {
    src: unsplash("photo-1555939594-58d7cb561ad1", 900),
    alt: "Anticuchos y papas doradas sobre la parrilla",
  },
  casaNativa: {
    src: unsplash("photo-1495474472287-4d71bcdd2085", 900),
    alt: "Dos tazas de cafe con arte latte sobre una mesa de madera",
  },

  /** The kitchen in the "how most restaurants work today" panel. */
  kitchenRush: {
    src: unsplash("photo-1551218808-94e220e084d2", 800),
    alt: "Manos picando hierbas frescas sobre una tabla en plena cocina",
  },

  /** The closing section: a room, and the person who runs it. */
  diningRoom: {
    src: unsplash("photo-1517248135467-4c7edcad34c4", 1600),
    alt: "",
  },
  chef: {
    src: unsplash("photo-1577219491135-ce391730fb2c", 600),
    alt: "Cocinero emplatando en la barra de pase de un restaurante",
  },
} as const satisfies Record<string, LandingImage>;
