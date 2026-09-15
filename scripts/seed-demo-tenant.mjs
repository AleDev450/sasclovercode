/**
 * Builds complete demo businesses, from nothing.
 *
 * WHY THIS EXISTS. Every screen in this product is empty until a business fills
 * it, which means nobody - not a developer, not somebody being shown the
 * product - can actually SEE what is being sold without spending an hour typing
 * a menu in. This script is that hour, once, in a file.
 *
 * WHY THREE BUSINESSES AND NOT ONE. A single demo tenant proves the product
 * runs; it proves nothing about the thing it is actually for, which is that a
 * hundred different shops each get a site that looks like THEIRS. One seeded
 * restaurant with one palette cannot show that, and a theme gallery judged
 * against a single set of content is judged against nothing. Three businesses
 * in three verticals, on three palettes, with their own logos, is the smallest
 * set where "does the theming work" is a question with a visible answer.
 *
 * WHY IT UPLOADS IMAGES. A tenant site with no photographs renders the tinted
 * placeholder blocks `section-renderer` falls back to, and a palette judged
 * against grey rectangles is not judged at all. These are not photographs -
 * the script cannot invent a ceviche - they are brand-coloured cards generated
 * from the theme, one per dish, which is enough to see whether a palette holds
 * up next to real content. See `scripts/lib/png.mjs`.
 *
 * IT IS NOT A MIGRATION, deliberately. Demo content is not schema: a migration
 * would recreate these businesses on every environment forever, including
 * production, and there would be no supported way to be rid of them.
 *
 * IT IS IDEMPOTENT. Running it twice does not produce six businesses: every row
 * is matched on its natural key first. That matters because the most common use
 * is running it again after changing one product name.
 *
 * HOW IT TALKS TO SUPABASE. PostgREST and the Storage API with the service key,
 * which bypasses RLS. That is the right tool here and the wrong one in
 * application code: this is an operator script that runs on a laptop, not a
 * request path. The key is read from `.env.local` and never printed.
 *
 *   node scripts/seed-demo-tenant.mjs
 *   node scripts/seed-demo-tenant.mjs --reset          # delete them and rebuild
 *   node scripts/seed-demo-tenant.mjs --only=sugurolls # just one
 *   node scripts/seed-demo-tenant.mjs --no-images      # skip the uploads
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { bannerImage, faviconImage, logoImage, productImage } from "./lib/png.mjs";

const ENV_FILE = join(process.cwd(), ".env.local");
const BUCKET = "tenant-assets";

/** The platform domain that issues system subdomains. Mirrors `config/app.ts`. */
const SYSTEM_DOMAIN = "clovercodeapp.com";

/* -------------------------------------------------------------------------- */
/*  The businesses                                                            */
/* -------------------------------------------------------------------------- */

/*
 * Each entry is one shop. The shape is the same for all three on purpose: a
 * demo whose businesses differ in STRUCTURE as well as content would be testing
 * the seed script rather than the product.
 *
 * Every theme is copied from a preset in `modules/settings/theme-presets.ts`,
 * so what you see here is what a real business gets by clicking one card.
 */
const BUSINESSES = [
  {
    slug: "demo",
    name: "Sabor Criollo",
    tagline: "Comida criolla como en casa",
    preset: "brasa",
    theme: {
      primary_color: "#b42318",
      accent_color: "#e4762a",
      background_color: "#fffaf5",
      font_family: "poppins",
      border_radius: "md",
    },
    settings: {
      trade_name: "Sabor Criollo",
      legal_name: "Inversiones Sabor Criollo S.A.C.",
      tax_id: "20512345671",
      phone: "+51 987 654 321",
      whatsapp: "+51 987 654 321",
      contact_email: "hola@saborcriollo.pe",
      address_line: "Av. Arequipa 2450",
      district: "Lince",
      city: "Lima",
      currency: "PEN",
      timezone: "America/Lima",
    },
    location: { name: "Local Lince", reference: "A media cuadra del parque Castilla" },
    hours: [
      [0, "11:00", "16:00"],
      [1, "12:00", "22:00"],
      [2, "12:00", "22:00"],
      [3, "12:00", "22:00"],
      [4, "12:00", "22:00"],
      [5, "12:00", "23:00"],
      [6, "11:00", "23:00"],
    ],
    categories: [
      { slug: "entradas", name: "Entradas", description: "Para empezar, mientras llega el fondo." },
      { slug: "fondos", name: "Fondos", description: "Los platos de siempre, como en casa." },
      { slug: "bebidas", name: "Bebidas", description: "Frescas, heladas y bien servidas." },
    ],
    // [category, slug, name, description, priceCents, flags]
    products: [
      [
        "entradas",
        "papa-a-la-huancaina",
        "Papa a la huancaina",
        "Papa amarilla sancochada con crema de queso fresco y aji amarillo.",
        1600,
        { featured: true },
      ],
      [
        "entradas",
        "causa-limena",
        "Causa limena",
        "Papa amarilla prensada con limon, rellena de pollo y palta.",
        1800,
        {},
      ],
      [
        "entradas",
        "anticuchos",
        "Anticuchos de corazon",
        "Dos palos a la parrilla con papa dorada y choclo.",
        2200,
        { featured: true },
      ],
      [
        "entradas",
        "tequenos",
        "Tequenos de queso",
        "Seis unidades crocantes con salsa de guacamole.",
        1900,
        {},
      ],
      [
        "entradas",
        "chicharron-calamar",
        "Chicharron de calamar",
        "Calamar apanado con salsa criolla y limon.",
        2800,
        { available: false },
      ],
      [
        "fondos",
        "lomo-saltado",
        "Lomo saltado",
        "Lomo fino salteado al wok con papas fritas y arroz graneado.",
        3200,
        { featured: true },
      ],
      [
        "fondos",
        "aji-de-gallina",
        "Aji de gallina",
        "Pollo deshilachado en crema de aji amarillo, con papa y arroz.",
        2600,
        {},
      ],
      [
        "fondos",
        "ceviche-mixto",
        "Ceviche mixto",
        "Pescado del dia y mariscos en leche de tigre, camote y choclo.",
        3800,
        { featured: true },
      ],
      [
        "fondos",
        "arroz-con-pollo",
        "Arroz con pollo",
        "Arroz verde con culantro, presa de pollo y salsa criolla.",
        2400,
        {},
      ],
      [
        "fondos",
        "seco-de-res",
        "Seco de res a la nortena",
        "Res cocida a fuego lento con frejoles y arroz.",
        2900,
        {},
      ],
      [
        "fondos",
        "tallarin-saltado",
        "Tallarin saltado criollo",
        "Fideos salteados al wok con res, cebolla y tomate.",
        2700,
        {},
      ],
      [
        "bebidas",
        "chicha-morada",
        "Chicha morada del dia",
        "Jarra de un litro, preparada en casa.",
        1400,
        { featured: true },
      ],
      ["bebidas", "limonada-frozen", "Limonada frozen", "Vaso grande, bien helada.", 1000, {}],
      ["bebidas", "inca-kola", "Inca Kola 500 ml", "Botella personal bien fria.", 600, {}],
    ],
    home: {
      heroSubheading:
        "Cocinamos todos los dias desde 1998 en el corazon de Lince. Pide en linea y recogelo en el local, o te lo llevamos a tu puerta.",
      banner: { message: "Delivery gratis en Lince por pedidos desde S/ 60.", tone: "success" },
      about: {
        heading: "Quienes somos",
        paragraphs: [
          "Sabor Criollo nacio como una fonda de barrio y sigue siendo la misma cocina: ollas grandes, fuego lento y recetas que no han cambiado en veinticinco anos.",
          "Compramos en el mercado cada manana. Si algo se acaba, se acaba - preferimos decirlo antes que servir algo que no nos gustaria comer.",
        ],
      },
      faq: [
        [
          "Hacen delivery?",
          "Si, en Lince, Jesus Maria y San Isidro. El reparto demora entre 30 y 45 minutos segun el trafico.",
        ],
        [
          "Puedo reservar mesa?",
          "Para grupos de seis personas o mas, si. Escribenos por WhatsApp con un dia de anticipacion.",
        ],
        [
          "Tienen opciones vegetarianas?",
          "Tenemos causa de palta, tequenos y tallarin saltado de verduras. Avisanos al pedir y lo preparamos sin carne.",
        ],
      ],
      cta: {
        heading: "Tu almuerzo listo en 30 minutos",
        body: "Escribenos por WhatsApp y te confirmamos el pedido al toque.",
        buttonLabel: "Pedir por WhatsApp",
      },
    },
  },

  {
    slug: "sugurolls",
    name: "Sugu Rolls",
    tagline: "Nikkei de barra, para llevar",
    preset: "noche",
    theme: {
      primary_color: "#5b21b6",
      accent_color: "#a78bfa",
      background_color: "#faf7ff",
      font_family: "poppins",
      border_radius: "lg",
    },
    settings: {
      trade_name: "Sugu Rolls",
      legal_name: "Sugu Rolls E.I.R.L.",
      tax_id: "20604417892",
      phone: "+51 912 345 678",
      whatsapp: "+51 912 345 678",
      contact_email: "pedidos@sugurolls.pe",
      address_line: "Calle Berlin 690",
      district: "Miraflores",
      city: "Lima",
      currency: "PEN",
      timezone: "America/Lima",
    },
    location: { name: "Barra Miraflores", reference: "Frente al parque Kennedy, segundo piso" },
    /*
     * Closing times stop at 23:45, never "00:00".
     *
     * `location_hours_order` requires closes_at > opens_at, and midnight is
     * stored as 00:00 of the SAME day - so a bar that shuts at twelve reads to
     * the constraint as one that shut thirteen hours before it opened. Spanning
     * midnight needs a second row or a day-crossing flag, and this is a seed:
     * the honest fix is to write the time the door actually locks.
     */
    hours: [
      [0, "13:00", "21:00"],
      [2, "13:00", "23:00"],
      [3, "13:00", "23:00"],
      [4, "13:00", "23:00"],
      [5, "13:00", "23:45"],
      [6, "13:00", "23:45"],
    ],
    categories: [
      { slug: "rolls", name: "Rolls", description: "Nuestra barra, enrollada al momento." },
      { slug: "tiraditos", name: "Tiraditos", description: "Pescado fresco, cortes finos." },
      { slug: "para-compartir", name: "Para compartir", description: "Tablas y combinados." },
    ],
    products: [
      [
        "rolls",
        "acevichado",
        "Roll acevichado",
        "Langostino tempura por dentro, palta y salsa acevichada encima.",
        3400,
        { featured: true },
      ],
      [
        "rolls",
        "tataki-roll",
        "Tataki roll",
        "Atun sellado, cebolla china y crema de rocoto.",
        3600,
        { featured: true },
      ],
      [
        "rolls",
        "furai",
        "Furai roll",
        "Roll empanizado y frito, relleno de queso crema y langostino.",
        3200,
        {},
      ],
      [
        "rolls",
        "veggie-roll",
        "Veggie roll",
        "Palta, pepino, mango y ajonjoli. Sin pescado.",
        2600,
        {},
      ],
      [
        "rolls",
        "sugu-especial",
        "Sugu especial",
        "Nuestro roll de la casa: doble relleno y salsa anguila.",
        3900,
        { featured: true },
      ],
      [
        "rolls",
        "california",
        "California clasico",
        "Kanikama, palta y pepino. El de siempre.",
        2400,
        {},
      ],
      [
        "tiraditos",
        "tiradito-nikkei",
        "Tiradito nikkei",
        "Pescado del dia en salsa de soya, limon y aji limo.",
        3300,
        {},
      ],
      [
        "tiraditos",
        "tiradito-rocoto",
        "Tiradito al rocoto",
        "Corte fino con crema de rocoto y chalaquita.",
        3100,
        {},
      ],
      [
        "tiraditos",
        "sashimi-mixto",
        "Sashimi mixto",
        "Doce cortes de pescado y langostino.",
        4200,
        { available: false },
      ],
      [
        "para-compartir",
        "tabla-sugu",
        "Tabla Sugu",
        "Veinte piezas surtidas. Alcanza para tres.",
        6900,
        { featured: true },
      ],
      [
        "para-compartir",
        "gyozas",
        "Gyozas de cerdo",
        "Seis unidades a la plancha con salsa ponzu.",
        2200,
        {},
      ],
      [
        "para-compartir",
        "edamame",
        "Edamame con sal marina",
        "Para picar mientras llega la tabla.",
        1200,
        {},
      ],
    ],
    home: {
      heroSubheading:
        "Barra pequena en Miraflores. Todo se arma cuando pides, nada se guarda de ayer. Recoges en veinte minutos o te lo llevamos.",
      banner: { message: "Martes cerrado. Pedidos por WhatsApp hasta las 23:30.", tone: "info" },
      about: {
        heading: "La barra",
        paragraphs: [
          "Somos seis personas y una barra de ocho asientos. El pescado llega cada manana del terminal y lo que no se usa ese dia no se usa.",
          "Trabajamos nikkei sin solemnidad: cortes limpios, salsas peruanas y porciones que llenan.",
        ],
      },
      faq: [
        [
          "Cuanto demora un pedido?",
          "Entre 20 y 30 minutos. En viernes y sabado por la noche puede llegar a 45.",
        ],
        [
          "Tienen opciones sin pescado?",
          "Si. El veggie roll, las gyozas y el edamame no llevan pescado.",
        ],
        [
          "Puedo reservar la barra?",
          "La barra es por orden de llegada. Para grupos usamos las mesas del fondo.",
        ],
      ],
      cta: {
        heading: "Pide ahora y recoge en 20 minutos",
        body: "Mandanos tu pedido por WhatsApp y te avisamos cuando este listo.",
        buttonLabel: "Pedir por WhatsApp",
      },
    },
  },

  {
    slug: "dulcehorno",
    name: "Dulce Horno",
    tagline: "Pasteleria de barrio, horneada cada manana",
    preset: "dulce",
    theme: {
      primary_color: "#be185d",
      accent_color: "#f472b6",
      background_color: "#fffafc",
      font_family: "poppins",
      border_radius: "lg",
    },
    settings: {
      trade_name: "Dulce Horno",
      legal_name: "Pasteleria Dulce Horno S.A.C.",
      tax_id: "20556677881",
      phone: "+51 945 112 233",
      whatsapp: "+51 945 112 233",
      contact_email: "hola@dulcehorno.pe",
      address_line: "Jr. Manuel Segura 415",
      district: "Barranco",
      city: "Lima",
      currency: "PEN",
      timezone: "America/Lima",
    },
    location: {
      name: "Tienda Barranco",
      reference: "Media cuadra antes del puente de los suspiros",
    },
    hours: [
      [0, "08:00", "14:00"],
      [1, "08:00", "20:00"],
      [2, "08:00", "20:00"],
      [3, "08:00", "20:00"],
      [4, "08:00", "20:00"],
      [5, "08:00", "21:00"],
      [6, "08:00", "21:00"],
    ],
    categories: [
      { slug: "tortas", name: "Tortas", description: "Enteras o por porcion." },
      { slug: "panaderia", name: "Panaderia", description: "Del horno de la manana." },
      { slug: "cafeteria", name: "Cafeteria", description: "Para acompanar." },
    ],
    products: [
      [
        "tortas",
        "tres-leches",
        "Tres leches",
        "Porcion generosa, con merengue tostado.",
        1500,
        { featured: true },
      ],
      [
        "tortas",
        "chocolate-belga",
        "Torta de chocolate belga",
        "Tres capas y ganache. Torta entera de 20 cm.",
        9500,
        { featured: true },
      ],
      [
        "tortas",
        "cheesecake-maracuya",
        "Cheesecake de maracuya",
        "Base de galleta y cobertura de fruta fresca.",
        1700,
        {},
      ],
      [
        "tortas",
        "selva-negra",
        "Selva negra",
        "Chocolate, crema y cerezas. Por porcion.",
        1600,
        {},
      ],
      ["tortas", "torta-helada", "Torta helada de fresa", "Clasica limena, bien fria.", 1300, {}],
      [
        "panaderia",
        "croissant",
        "Croissant de mantequilla",
        "Hojaldre laminado a mano, horneado a las 6 a.m.",
        700,
        { featured: true },
      ],
      [
        "panaderia",
        "empanada-carne",
        "Empanada de carne",
        "Masa casera con relleno jugoso.",
        900,
        {},
      ],
      ["panaderia", "pan-chocolate", "Pan de chocolate", "Con barra de chocolate al 60%.", 800, {}],
      [
        "panaderia",
        "alfajores",
        "Alfajores de maicena",
        "Caja de seis con manjar blanco.",
        1800,
        {},
      ],
      [
        "panaderia",
        "pan-integral",
        "Pan integral de masa madre",
        "Hogaza de 800 g. Horneamos 20 al dia.",
        1600,
        { available: false },
      ],
      [
        "cafeteria",
        "cafe-filtrado",
        "Cafe filtrado",
        "Grano de Chanchamayo, tostado esta semana.",
        800,
        {},
      ],
      [
        "cafeteria",
        "capuccino",
        "Capuccino",
        "Doble shot y leche texturizada.",
        1100,
        { featured: true },
      ],
      [
        "cafeteria",
        "chocolate-caliente",
        "Chocolate caliente",
        "Con chocolate de Cusco, no en polvo.",
        1200,
        {},
      ],
    ],
    home: {
      heroSubheading:
        "Horneamos desde las cinco de la manana en Barranco. Tortas por encargo con 48 horas y pan fresco todos los dias.",
      banner: { message: "Encargos de torta entera: avisanos con 48 horas.", tone: "warning" },
      about: {
        heading: "El horno",
        paragraphs: [
          "Dulce Horno empezo en la cocina de la casa y sigue con las mismas recetas: mantequilla de verdad, fruta de estacion y nada congelado.",
          "Lo que no se vende en el dia se dona por la tarde. Por eso el pan de la manana siempre es el pan de la manana.",
        ],
      },
      faq: [
        [
          "Hacen tortas por encargo?",
          "Si, con 48 horas de anticipacion. Escribenos por WhatsApp con la fecha y el numero de porciones.",
        ],
        [
          "Tienen opciones sin azucar?",
          "El cheesecake y la torta de chocolate se pueden pedir con endulzante. Avisanos al encargar.",
        ],
        ["A que hora sale el pan?", "La primera tanda sale a las 7 a.m. y la segunda a las 4 p.m."],
      ],
      cta: {
        heading: "Encarga tu torta",
        body: "Dinos la fecha y las porciones y te confirmamos el mismo dia.",
        buttonLabel: "Escribir por WhatsApp",
      },
    },
  },
];

/* -------------------------------------------------------------------------- */
/*  Plumbing                                                                  */
/* -------------------------------------------------------------------------- */

async function readEnv() {
  const raw = await readFile(ENV_FILE, "utf8");
  const env = {};

  for (const line of raw.split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match !== null) env[match[1]] = match[2].trim();
  }

  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SECRET_KEY;

  if (!url || !key) {
    throw new Error("`.env.local` must define NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY.");
  }
  return { url, key };
}

function makeClient({ url, key }) {
  const headers = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };

  async function request(method, path, body, extraHeaders = {}) {
    const response = await fetch(`${url}/rest/v1/${path}`, {
      method,
      headers: { ...headers, ...extraHeaders },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    const text = await response.text();

    if (!response.ok) {
      // The body carries the constraint name, which is the only useful part of
      // a PostgREST failure. The key never appears in it.
      throw new Error(`${method} ${path} -> ${response.status} ${text}`);
    }

    return text.length === 0 ? null : JSON.parse(text);
  }

  /**
   * Puts an object in the tenant bucket.
   *
   * `x-upsert` because this script is idempotent: a second run must replace the
   * generated image rather than fail on a duplicate key. The path is built the
   * same way `lib/storage/assets.ts` builds it, because the `product_images`
   * CHECK constraint validates that shape and would reject anything else.
   */
  async function upload(path, body, contentType) {
    const response = await fetch(`${url}/storage/v1/object/${BUCKET}/${path}`, {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": contentType,
        "x-upsert": "true",
      },
      body,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`upload ${path} -> ${response.status} ${text}`);
    }
    return path;
  }

  return {
    select: (path) => request("GET", path),
    insert: (table, rows) => request("POST", table, rows, { Prefer: "return=representation" }),
    update: (path, patch) => request("PATCH", path, patch, { Prefer: "return=representation" }),
    remove: (path) => request("DELETE", path),
    upload,
  };
}

/** Inserts `row` unless a row already matches `filter`. Returns the row. */
async function ensure(db, table, filter, row) {
  const existing = await db.select(`${table}?${filter}&select=*`);
  if (existing.length > 0) return existing[0];

  const created = await db.insert(table, [row]);
  return created[0];
}

function log(step, detail = "") {
  process.stdout.write(`    ${step}${detail === "" ? "" : ` — ${detail}`}\n`);
}

/* -------------------------------------------------------------------------- */
/*  Page content, built from the business                                     */
/* -------------------------------------------------------------------------- */

/**
 * The home page, as the CMS stores it: structured content, never markup.
 *
 * Built from the business rather than written out three times, so all three
 * demos exercise the same section types and a change to the shape cannot leave
 * one of them behind.
 */
function homeSections(business, images) {
  const whatsapp = `https://wa.me/${business.settings.whatsapp.replace(/[^0-9]/g, "")}`;
  const [first, second] = business.categories;

  const sections = [
    {
      type: "hero",
      position: 0,
      content: {
        heading: business.tagline,
        subheading: business.home.heroSubheading,
        ctaLabel: "Ver la carta",
        ctaHref: "/sitio/carta",
        ...(images.hero === undefined ? {} : { imagePath: images.hero }),
      },
    },
    { type: "banner", position: 1, content: business.home.banner },
    {
      type: "products",
      position: 2,
      content: { heading: first.name, categorySlug: first.slug, limit: 6 },
    },
    {
      type: "products",
      position: 3,
      content: { heading: second.name, categorySlug: second.slug, limit: 3 },
    },
    { type: "text", position: 4, content: business.home.about },
  ];

  // The gallery only appears when there are images to put in it, which is what
  // `--no-images` produces. An empty gallery fails its own schema (min 1).
  if (images.gallery.length > 0) {
    sections.push({
      type: "gallery",
      position: 5,
      content: {
        heading: "El local",
        images: images.gallery.map((path, index) => ({
          imagePath: path,
          alt: `${business.name}, foto ${index + 1}`,
        })),
      },
    });
  }

  sections.push(
    {
      type: "faq",
      position: 6,
      content: {
        heading: "Preguntas frecuentes",
        items: business.home.faq.map(([question, answer]) => ({ question, answer })),
      },
    },
    {
      type: "cta",
      position: 7,
      content: { ...business.home.cta, buttonHref: whatsapp },
    },
  );

  return sections;
}

/** A second page, so the navigation bar has somewhere to point. */
function menuSections(business) {
  return [
    {
      type: "hero",
      position: 0,
      content: {
        heading: "Nuestra carta",
        subheading: "Todo se prepara al momento. Los precios incluyen IGV.",
      },
    },
    ...business.categories.map((category, index) => ({
      type: "products",
      position: index + 1,
      content: { heading: category.name, categorySlug: category.slug, limit: 12 },
    })),
  ];
}

/* -------------------------------------------------------------------------- */
/*  The seed                                                                  */
/* -------------------------------------------------------------------------- */

async function reset(db, business) {
  const tenants = await db.select(`tenants?slug=eq.${business.slug}&select=id`);
  if (tenants.length === 0) {
    log("Nada que borrar");
    return;
  }

  // Everything else cascades from the tenant row: every table in this script
  // has `on delete cascade` on its tenant foreign key. Storage objects do NOT
  // cascade, and are deliberately left: a re-run overwrites them by path, and
  // deleting files is not something a seed script should do by default.
  await db.remove(`tenants?slug=eq.${business.slug}`);
  log("Borrado", `${business.name} y todo su contenido`);
}

/**
 * Generates and uploads every image this business needs.
 *
 * Returns the PATHS, never URLs: the bucket is private, and a stored URL would
 * expire in the row. That is the same rule the application follows and the
 * reason `product_images.path` is called `path`.
 */
async function seedImages(db, business, tenantId, enabled) {
  const images = {
    logo: undefined,
    favicon: undefined,
    hero: undefined,
    gallery: [],
    byProduct: new Map(),
  };
  if (!enabled) return images;

  const { primary_color: primary, accent_color: accent } = business.theme;
  const folder = (name, file) => `tenants/${tenantId}/${name}/${file}`;

  // --- branding -----------------------------------------------------------
  images.logo = await db.upload(
    folder("branding", "logo.png"),
    logoImage(business.name, primary, accent),
    "image/png",
  );
  images.favicon = await db.upload(
    folder("branding", "favicon.png"),
    faviconImage(business.name, primary),
    "image/png",
  );

  // --- the hero and the gallery -------------------------------------------
  images.hero = await db.upload(
    folder("banners", "portada.png"),
    bannerImage(`${business.slug}-hero`, primary, accent),
    "image/png",
  );

  for (let i = 1; i <= 3; i++) {
    images.gallery.push(
      await db.upload(
        folder("banners", `local-${i}.png`),
        bannerImage(`${business.slug}-local-${i}`, primary, accent, 900, 900),
        "image/png",
      ),
    );
  }

  // --- one per product ----------------------------------------------------
  for (const [, slug, name] of business.products) {
    images.byProduct.set(
      slug,
      await db.upload(
        folder("products", `${slug}.png`),
        productImage(name, primary, accent),
        "image/png",
      ),
    );
  }

  log("Imagenes", `${images.byProduct.size + images.gallery.length + 3} archivos subidos`);
  return images;
}

async function seed(db, business, withImages) {
  // --- tenant -------------------------------------------------------------
  // The `tenants_create_defaults` trigger gives it a settings row and a theme
  // row on insert, so neither is created here - only updated.
  const tenant = await ensure(db, "tenants", `slug=eq.${business.slug}`, {
    name: business.name,
    slug: business.slug,
  });
  log("Empresa", `${tenant.name} (${tenant.id})`);

  // --- domain -------------------------------------------------------------
  // `verification_status: 'active'` is what makes it resolve: the resolver
  // ignores domains that are merely registered.
  const domain = `${business.slug}.${SYSTEM_DOMAIN}`;
  await ensure(db, "tenant_domains", `tenant_id=eq.${tenant.id}&domain=eq.${domain}`, {
    tenant_id: tenant.id,
    domain,
    type: "system",
    is_primary: true,
    verification_status: "active",
    // `tenant_domains_verified_at_consistency` requires the timestamp to be
    // present exactly when the status is `active`, so the two cannot disagree.
    // A system subdomain is verified by construction - the platform owns the
    // zone - so it is stamped now.
    verified_at: new Date().toISOString(),
  });
  log("Dominio", domain);

  // --- images -------------------------------------------------------------
  const images = await seedImages(db, business, tenant.id, withImages);

  // --- settings and theme -------------------------------------------------
  await db.update(`tenant_settings?tenant_id=eq.${tenant.id}`, business.settings);
  await db.update(`tenant_themes?tenant_id=eq.${tenant.id}`, {
    ...business.theme,
    ...(images.logo === undefined ? {} : { logo_path: images.logo }),
    ...(images.favicon === undefined ? {} : { favicon_path: images.favicon }),
  });
  log("Tema", `${business.preset} · ${business.theme.primary_color}`);

  // --- categories ---------------------------------------------------------
  const categoryId = new Map();
  let categoryPosition = 0;
  for (const category of business.categories) {
    categoryPosition += 10;
    const row = await ensure(
      db,
      "categories",
      `tenant_id=eq.${tenant.id}&slug=eq.${category.slug}`,
      {
        tenant_id: tenant.id,
        ...category,
        position: categoryPosition,
      },
    );
    categoryId.set(category.slug, row.id);
  }
  log("Categorias", business.categories.map((c) => c.name).join(", "));

  // --- products -----------------------------------------------------------
  let position = 0;
  for (const [category, slug, name, description, priceCents, flags] of business.products) {
    position += 10;
    const product = await ensure(db, "products", `tenant_id=eq.${tenant.id}&slug=eq.${slug}`, {
      tenant_id: tenant.id,
      category_id: categoryId.get(category),
      name,
      slug,
      description,
      base_price_cents: priceCents,
      // Published, not draft: a demo whose products are invisible on the
      // website demonstrates the opposite of what it is for.
      status: "active",
      is_available: flags.available !== false,
      is_featured: flags.featured === true,
      position,
    });

    const imagePath = images.byProduct.get(slug);
    if (imagePath !== undefined) {
      // `tenant_id` is deliberately NOT sent: the `sync_product_child_tenant`
      // trigger derives it from the parent, and sending our own would be the
      // habit the Phase 11 audit warned about (AB-1101).
      await ensure(db, "product_images", `product_id=eq.${product.id}&is_primary=is.true`, {
        product_id: product.id,
        tenant_id: tenant.id,
        path: imagePath,
        alt_text: name,
        is_primary: true,
        position: 0,
      });
    }
  }
  log("Productos", `${business.products.length} publicados`);

  // --- pages --------------------------------------------------------------
  async function page(slug, title, sections) {
    const row = await ensure(db, "pages", `tenant_id=eq.${tenant.id}&slug=eq.${slug}`, {
      tenant_id: tenant.id,
      slug,
      title,
      status: "published",
    });

    // Sections are replaced rather than matched one by one: they have no
    // natural key, and rewriting them is what makes editing this file and
    // re-running the script do what you expect.
    await db.remove(`page_sections?page_id=eq.${row.id}`);
    await db.insert(
      "page_sections",
      sections.map((section) => ({
        page_id: row.id,
        tenant_id: tenant.id,
        type: section.type,
        content: section.content,
        position: section.position,
        is_visible: true,
      })),
    );

    return row;
  }

  const home = await page("inicio", "Inicio", homeSections(business, images));
  const menu = await page("carta", "Carta", menuSections(business));
  log("Paginas", "inicio, carta (publicadas)");

  // --- navigation ---------------------------------------------------------
  await db.remove(`navigation_items?tenant_id=eq.${tenant.id}`);

  /*
   * Every row carries BOTH target columns, one of them null.
   *
   * PostgREST rejects a bulk insert whose objects do not all have the same keys
   * ("All object keys must match") - it builds one INSERT statement with one
   * column list. A page link and an external link naturally have different
   * shapes, so the nulls are spelled out. The
   * `navigation_items_target_matches_type` CHECK still enforces that exactly
   * one of them is set for the declared type.
   */
  const whatsapp = `https://wa.me/${business.settings.whatsapp.replace(/[^0-9]/g, "")}`;
  await db.insert(
    "navigation_items",
    [
      { label: "Inicio", link_type: "page", page_id: home.id, external_url: null, position: 10 },
      { label: "Carta", link_type: "page", page_id: menu.id, external_url: null, position: 20 },
      {
        label: "WhatsApp",
        link_type: "external",
        page_id: null,
        external_url: whatsapp,
        position: 30,
      },
    ].map((item) => ({ tenant_id: tenant.id, is_active: true, ...item })),
  );
  log("Navegacion", "Inicio, Carta, WhatsApp");

  // --- location and hours -------------------------------------------------
  /*
   * The tenant ALREADY HAS a location, and the first version of this script did
   * not know that.
   *
   * `create_tenant_defaults` inserts one named after the business the moment the
   * tenant row appears, so creating a second beside it produced two branches in
   * the footer - one real, one an empty placeholder reading "Consultar horario".
   * The fix is to fill in the row that exists rather than add a second.
   */
  const existing = await db.select(
    `locations?tenant_id=eq.${tenant.id}&select=id&order=created_at.asc`,
  );

  const details = {
    name: business.location.name,
    address_line: business.settings.address_line,
    district: business.settings.district,
    city: business.settings.city,
    reference: business.location.reference,
    phone: business.settings.phone,
    is_active: true,
  };

  // Leftovers from an earlier run go FIRST, before the rename.
  //
  // `locations_tenant_name_key` is unique on (tenant_id, lower(name)), so
  // renaming the default while a stale row of the same name still exists is a
  // constraint violation - which is exactly what happened the first time this
  // ran against an already-seeded database.
  for (const stale of existing.slice(1)) {
    await db.remove(`locations?id=eq.${stale.id}`);
  }

  const location =
    existing.length > 0
      ? (await db.update(`locations?id=eq.${existing[0].id}`, details))[0]
      : (await db.insert("locations", [{ tenant_id: tenant.id, ...details }]))[0];

  await db.remove(`location_hours?location_id=eq.${location.id}`);
  await db.insert(
    "location_hours",
    business.hours.map(([day, opens, closes]) => ({
      location_id: location.id,
      tenant_id: tenant.id,
      day_of_week: day,
      opens_at: opens,
      closes_at: closes,
    })),
  );
  log("Sede", `${details.name}, con horarios`);

  // --- SEO ----------------------------------------------------------------
  // Filled in so the demo shows what a finished site looks like to Google and
  // to WhatsApp, which is one of the things the website module is sold on.
  await db.update(`tenant_seo?tenant_id=eq.${tenant.id}`, {
    site_title: `${business.name} · ${business.settings.district}`,
    site_description: business.home.heroSubheading.slice(0, 160),
    og_title: business.tagline,
    og_description: business.home.heroSubheading.slice(0, 200),
    ...(images.hero === undefined ? {} : { og_image_path: images.hero }),
    robots_index: true,
  });

  // --- access -------------------------------------------------------------
  /*
   * Every platform operator becomes an owner of the demo business.
   *
   * Without this the seed produces a dashboard nobody can open: platform
   * authority and tenant membership are deliberately separate things
   * (`platform_admins` is not `tenant_members`, master section 29), so being a
   * CloverCode operator does NOT let you into a business's own panel.
   *
   * That separation is right for real customers and pure friction for a demo
   * shop that belongs to nobody. Operators are the only accounts granted it,
   * and only on these tenants.
   */
  const operators = await db.select("platform_admins?status=eq.active&select=user_id");

  for (const operator of operators) {
    await ensure(db, "tenant_members", `tenant_id=eq.${tenant.id}&user_id=eq.${operator.user_id}`, {
      tenant_id: tenant.id,
      user_id: operator.user_id,
      role: "owner",
      status: "active",
    });
  }
  log("Acceso", `${operators.length} operador(es) como owner`);

  return tenant;
}

/* -------------------------------------------------------------------------- */
/*  Entry point                                                               */
/* -------------------------------------------------------------------------- */

async function main() {
  const shouldReset = process.argv.includes("--reset");
  const withImages = !process.argv.includes("--no-images");

  const onlyArg = process.argv.find((arg) => arg.startsWith("--only="));
  const only = onlyArg === undefined ? null : onlyArg.slice("--only=".length);

  const chosen = only === null ? BUSINESSES : BUSINESSES.filter((b) => b.slug === only);
  if (chosen.length === 0) {
    throw new Error(
      `No hay un negocio con slug "${only}". Opciones: ${BUSINESSES.map((b) => b.slug).join(", ")}.`,
    );
  }

  const db = makeClient(await readEnv());
  const seeded = [];

  for (const business of chosen) {
    process.stdout.write(`\n  ${business.name} (${business.slug})\n`);
    if (shouldReset) await reset(db, business);
    seeded.push({ business, tenant: await seed(db, business, withImages) });
  }

  const lines = ["", "Listo. Para verlo:", ""];

  for (const { business, tenant } of seeded) {
    lines.push(
      `  ${business.name}`,
      `    Vista previa (funciona en cualquier host, incluido Vercel)`,
      `      /vista/${business.slug}`,
      `    Web publica por dominio propio`,
      `      http://${business.slug}.localhost:3000/sitio`,
      `    Panel del negocio`,
      `      /dashboard/${business.slug}`,
      `    Ficha en el super admin`,
      `      /super-admin/tenants/${tenant.id}`,
      "",
    );
  }

  lines.push(
    "Inicia sesion con tu cuenta de operador: ya quedaste como owner de estas",
    "empresas, asi que los paneles se abren directamente.",
    "",
  );

  process.stdout.write(lines.join("\n"));
}

main().catch((error) => {
  process.stderr.write(`\n${error.message}\n\n`);
  process.exitCode = 1;
});
