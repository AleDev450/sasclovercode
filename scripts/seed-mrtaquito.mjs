/**
 * Mr. Taquito: one demo business, filled the way a real one would be.
 *
 * WHY A SECOND SEED SCRIPT. `seed-demo-tenant.mjs` builds three shops out of
 * GENERATED images - brand-coloured cards, one per dish - and says so in its
 * own header: "the script cannot invent a ceviche". That was the right call for
 * judging a palette, and it is the wrong answer to the question this script
 * exists for, which is "what does this product look like once a business has
 * actually finished setting it up". A page of tinted rectangles answers that
 * with a no, however good the theme underneath is, and the first thing anybody
 * says on seeing one is that the site looks plain.
 *
 * So this one uses PHOTOGRAPHS: real pictures of real tacos, from Wikimedia
 * Commons under CC licences, cropped to the ratios the `carbon` style actually
 * renders at and uploaded into the tenant's own private bucket like any other
 * business's. They are a stand-in for a photographer, not a substitute for one
 * - a real customer replaces them on day one - but they are what makes the
 * difference between a demo of the theming and a demo of the product.
 *
 * ATTRIBUTION IS NOT OPTIONAL. Every licence here except CC0 requires credit,
 * so the credit travels with the photo: `PHOTOS` carries it row by row and the
 * run writes `docs/mrtaquito-photo-credits.md` from those same rows. Removing a
 * photo removes its credit; adding one without a credit is a missing field.
 *
 * WHY THE PHOTOS ARE DOWNLOADED AND NOT COMMITTED. Thirty photographs is about
 * five megabytes of binaries in a repository that deliberately has none, for a
 * demo. The URLs are Commons' own and stable, and the fetch is cached under the
 * system temp folder, so a second run costs nothing. `--no-images` skips it.
 *
 * IT IS IDEMPOTENT, like the other seed: every row is matched on its natural
 * key first, so running it twice does not produce two taquerias.
 *
 * HOW IT TALKS TO SUPABASE. PostgREST and the Storage API with the service key
 * from `.env.local`, which bypasses RLS. That is the right tool for an operator
 * script running on a laptop and the wrong one inside the application.
 *
 *   node scripts/seed-mrtaquito.mjs                  crea o actualiza el negocio
 *   node scripts/seed-mrtaquito.mjs --reset          lo borra y lo rehace
 *   node scripts/seed-mrtaquito.mjs --no-images      solo textos, sin fotos
 *   node scripts/seed-mrtaquito.mjs --preview=fotos  procesa las fotos a ./fotos
 *                                                    y no toca la base de datos
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const nodeRequire = createRequire(import.meta.url);
/** Already a dependency: `next build` uses it to optimise images. */
const sharp = nodeRequire("sharp");

const ENV_FILE = join(process.cwd(), ".env.local");
const CREDITS_FILE = join(process.cwd(), "docs", "mrtaquito-photo-credits.md");
const BUCKET = "tenant-assets";
const CACHE = join(tmpdir(), "clovercode-mrtaquito-fotos");

/** The platform domain that issues system subdomains. Mirrors `config/app.ts`. */
const SYSTEM_DOMAIN = "clovercodeapp.com";

/**
 * The plan this business is on.
 *
 * `professional` is S/ 199 a month in the price list (migration
 * 20260830130000). Provisioning puts a new tenant on `enterprise`, so this is a
 * deliberate move to the plan the demo is meant to be showing.
 */
const PLAN_CODE = "professional";

/* -------------------------------------------------------------------------- */
/*  The business                                                              */
/* -------------------------------------------------------------------------- */

const BUSINESS = {
  slug: "mrtaquito",
  name: "Mr. Taquito",
  tagline: "Taqueria mexicana, al carbon",

  /*
   * `carbon`, with the three colours of the logo.
   *
   * The STYLE is the finished look - Inter at 800 over a carbon page, sections
   * that breathe at eleven rem, photography to the edge of the card, a gradient
   * on the button the whole site points at - and a business does not choose it
   * by picking a hue.
   *
   * The three colours ARE the part it owns, and these were sampled out of the
   * logo the owner uploaded: the orange of its background (#e36626), the gold
   * of the sombrero trim, and a near-black warmed toward both. All four
   * readable pairs clear 4.5:1, which `seo-theme.test.ts` re-measures.
   */
  theme: {
    primary_color: "#e36626",
    accent_color: "#f2b23e",
    background_color: "#120b07",
    font_family: "inter",
    border_radius: "lg",
    style: "carbon",
  },

  settings: {
    trade_name: "Mr. Taquito",
    legal_name: "Taqueria Mr Taquito S.A.C.",
    tax_id: "20603918472",
    phone: "+51 936 512 780",
    whatsapp: "+51 936 512 780",
    contact_email: "hola@mrtaquito.pe",
    address_line: "Av. Jose Pardo 610",
    district: "Miraflores",
    city: "Lima",
    currency: "PEN",
    timezone: "America/Lima",
  },

  location: {
    name: "Local Miraflores",
    reference: "A media cuadra del parque Kennedy, entrando por la Diagonal",
  },

  /*
   * [dia, abre, cierra]. Monday is missing on purpose: a taqueria that closes
   * one day a week is ordinary, and a demo open seven days never once shows
   * the "Cerrado" state the header was built to show.
   */
  hours: [
    [0, "12:00", "22:00"],
    [2, "12:30", "23:00"],
    [3, "12:30", "23:00"],
    [4, "12:30", "23:00"],
    [5, "12:30", "23:30"],
    [6, "12:00", "23:30"],
  ],

  categories: [
    {
      slug: "tacos",
      name: "Tacos",
      description: "Tortilla de maiz hecha en el momento. Van de tres en tres, nadie pide uno.",
    },
    {
      slug: "antojitos",
      name: "Antojitos",
      description: "Para picar entre todos mientras salen los tacos.",
    },
    {
      slug: "bebidas",
      name: "Bebidas",
      description: "Aguas frescas del dia y chelas bien heladas.",
    },
    { slug: "postres", name: "Postres", description: "Lo dulce, para terminar." },
    {
      slug: "promos",
      name: "Promociones",
      description: "Combos para compartir. Precio cerrado, sin sorpresas.",
    },
  ],

  /* [categoria, slug, nombre, descripcion, precio en centimos, flags, foto] */
  products: [
    [
      "tacos",
      "taco-al-pastor",
      "Taco al pastor",
      "Cerdo adobado en achiote, cortado del trompo al momento, con pina, cebolla y cilantro.",
      890,
      { featured: true },
      "al-pastor",
    ],
    [
      "tacos",
      "taco-carne-asada",
      "Taco de carne asada",
      "Res a la parrilla picada gruesa, cebolla asada y guacamole de la casa.",
      990,
      {},
      "carne-asada",
    ],
    [
      "tacos",
      "taco-carnitas",
      "Taco de carnitas",
      "Cerdo confitado cuatro horas en su propia grasa: crujiente por fuera, jugoso por dentro.",
      950,
      {},
      "carnitas",
    ],
    [
      "tacos",
      "taco-suadero",
      "Taco de suadero",
      "El corte que se dora en la plancha de cobre, con cilantro, cebolla y limon.",
      950,
      {},
      "suadero",
    ],
    [
      "tacos",
      "taco-birria",
      "Taco de birria con consome",
      "Res deshebrada en chiles, tortilla pasada por la grasa y su consome aparte para remojar.",
      1190,
      { featured: true },
      "birria",
    ],
    [
      "tacos",
      "taco-pollo",
      "Taco de pollo al carbon",
      "Pechuga marinada en chile guajillo y asada al carbon, con frijol negro y lechuga.",
      850,
      {},
      "pollo",
    ],
    [
      "tacos",
      "taco-pescado",
      "Taco de pescado estilo Ensenada",
      "Pescado rebozado, col morada, crema de chipotle y una rodaja de limon.",
      1150,
      {},
      "pescado",
    ],
    [
      "tacos",
      "taco-campechano",
      "Taco campechano",
      "Suadero y longaniza en la misma tortilla. El taco de los que no se deciden.",
      1050,
      {},
      "campechano",
    ],
    [
      "tacos",
      "taco-arrachera",
      "Taco de arrachera",
      "Arrachera madurada, sal de grano y cilantro, servida en tortilla doble.",
      1290,
      { featured: true },
      "arrachera",
    ],

    [
      "antojitos",
      "quesadilla-oaxaca",
      "Quesadilla de queso Oaxaca",
      "Tortilla grande a la plancha con queso Oaxaca deshebrado y epazote.",
      1390,
      {},
      "quesadilla",
    ],
    [
      "antojitos",
      "gringa-al-pastor",
      "Gringa al pastor",
      "Dos tortillas de harina, queso fundido y pastor adentro. Se come con las manos.",
      1590,
      { featured: true },
      "gringa",
    ],
    [
      "antojitos",
      "nachos-de-la-casa",
      "Nachos de la casa",
      "Totopos horneados con queso fundido, frijol, jalapenos y crema.",
      1690,
      {},
      "nachos",
    ],
    [
      "antojitos",
      "guacamole-totopos",
      "Guacamole con totopos",
      "Hecho en molcajete al momento, con tomate, cebolla morada y chile serrano.",
      1590,
      {},
      "guacamole",
    ],
    [
      "antojitos",
      "esquites",
      "Esquites con queso",
      "Grano de maiz tierno con mayonesa, queso cotija, limon y chile en polvo.",
      990,
      {},
      "esquites",
    ],
    [
      "antojitos",
      "burrito-asada",
      "Burrito de carne asada",
      "Tortilla de harina rellena de asada, frijol, arroz y pico de gallo.",
      2190,
      {},
      "burrito",
    ],

    [
      "bebidas",
      "agua-horchata",
      "Agua de horchata",
      "Arroz, canela y leche. Vaso grande, bien helada.",
      790,
      { featured: true },
      "horchata",
    ],
    [
      "bebidas",
      "agua-jamaica",
      "Agua de jamaica",
      "Flor de jamaica hervida en casa, sin azucar de mas.",
      790,
      {},
      "jamaica",
    ],
    [
      "bebidas",
      "michelada",
      "Michelada clasica",
      "Cerveza, limon, salsas y escarchado de chile. La botella se sirve aparte.",
      1490,
      {},
      "michelada",
    ],

    [
      "postres",
      "churros-cajeta",
      "Churros con cajeta",
      "Cuatro churros recien fritos, azucar con canela y cajeta para mojar.",
      1090,
      { featured: true },
      "churros",
    ],

    /*
     * Los combos, que son productos y no descuentos.
     *
     * WHY THEY ARE PRODUCTS. `promotions` in this database is a RULE - a
     * percentage, a minimum, a date range - which is the right model for "10%
     * los martes" and the wrong one for "3 al pastor por S/ 20". The second is
     * a thing somebody adds to a cart, with a price, a photograph and a place
     * in the menu, and modelling it as a discount would mean it could not be
     * ordered. It is also what the page it fills is for.
     *
     * They reuse the dish photographs on purpose: a combo of three al pastor is
     * a picture of three al pastor, and a separate photo of the same tacos on a
     * different plate would be a lie with extra steps.
     */
    [
      "promos",
      "combo-martes-pastor",
      "Martes de tacos: 3 al pastor",
      "Tres tacos al pastor con su pina, cebolla y cilantro. Solo los martes, todo el dia.",
      2000,
      { featured: true },
      "al-pastor",
    ],
    [
      "promos",
      "combo-pareja",
      "Combo pareja",
      "Seis tacos a eleccion, dos aguas frescas del dia y una orden de esquites.",
      4990,
      { featured: true },
      "surtido",
    ],
    [
      "promos",
      "taquiza-cuatro",
      "Taquiza para cuatro",
      "Dieciseis tacos surtidos, guacamole, totopos y cuatro bebidas. Para la mesa entera.",
      11900,
      {},
      "dorados",
    ],
    [
      "promos",
      "combo-gringa",
      "Gringa + michelada",
      "Una gringa al pastor y una michelada bien helada. El plan de siempre.",
      2790,
      {},
      "gringa",
    ],
    [
      "promos",
      "docena-churros",
      "Docena de churros",
      "Doce churros con cajeta para compartir. Se piden con 20 minutos de anticipacion.",
      2490,
      {},
      "churros",
    ],
  ],

  /** The delivery areas, so "Zonas de delivery" is a page with something on it. */
  zones: [
    ["Miraflores", "Miraflores", "Reparto propio, 25 a 35 minutos.", 590, 6000, 30],
    ["San Isidro", "San Isidro", "Cruzando la via expresa.", 690, 7000, 35],
    ["Barranco", "Barranco", "Hasta la bajada de banos.", 790, 8000, 40],
    ["Surquillo", "Surquillo", "Solo hasta Angamos.", 690, 7000, 35],
  ],

  home: {
    heroSubheading:
      "Trompo de pastor prendido desde el mediodia, tortilla hecha en casa y salsas molidas en molcajete. Pide en linea y recogelo en Miraflores, o te lo mandamos a tu puerta.",
    banner: {
      message: "Martes de tacos: 3 al pastor por S/ 20, todo el dia.",
      tone: "success",
    },
    about: {
      heading: "Como nacio Mr. Taquito",
      paragraphs: [
        "Empezamos en 2019 con un trompo prestado y una carpa en la Diagonal. La receta del adobo es la de la abuela de Chucho, nuestro taquero, que vino de Puebla con ella escrita a mano y no ha cambiado una coma desde entonces.",
        "Hacemos la tortilla aqui mismo, con maiz nixtamalizado, porque una tortilla de bolsa arruina el mejor pastor del mundo. Las salsas se muelen en molcajete cada manana: la roja pica, la verde pica mas, y avisamos siempre cual es cual.",
        "Cuando se acaba el pastor del dia, se acaba. Preferimos cerrar el trompo antes que servir carne que lleve dos dias dando vueltas.",
      ],
    },
    faq: [
      [
        "Hacen delivery?",
        "Si, con reparto propio en Miraflores, San Isidro, Barranco y Surquillo. Entre 25 y 40 minutos segun la zona, y desde S/ 60 el envio es gratis.",
      ],
      [
        "Los tacos pican?",
        "El taco no pica: la salsa si. Van siempre aparte, en tres niveles, y el que sirve te dice cual es cual antes de que la pruebes.",
      ],
      [
        "Tienen opciones vegetarianas?",
        "Quesadilla de Oaxaca, esquites, guacamole y nachos sin carne. Avisanos al pedir y preparamos los nachos sin frijol con chorizo.",
      ],
      [
        "Puedo reservar mesa?",
        "Para grupos de seis o mas, si. Escribenos por WhatsApp con un dia de anticipacion y te guardamos la mesa larga del fondo.",
      ],
      [
        "Hacen pedidos para eventos?",
        "Si, llevamos el trompo a domicilio desde 30 personas. Se cotiza por WhatsApp con una semana de anticipacion.",
      ],
    ],
    cta: {
      heading: "El trompo esta prendido",
      body: "Escribenos por WhatsApp y te confirmamos el pedido al toque. Recojo en 15 minutos, delivery en 30.",
      buttonLabel: "Pedir por WhatsApp",
    },
  },
};

/* -------------------------------------------------------------------------- */
/*  The photographs                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Every photograph, with the credit its licence requires.
 *
 * `focus` picks the crop when the ratio of the source and the ratio the site
 * renders at disagree, which is most of the time: `attention` asks sharp for
 * the most salient region, which on a plate of food is the plate, and `centre`
 * is for the ones where it guessed wrong.
 *
 * All of them are Commons' own 1920px renditions, which is the largest size
 * the API hands out without an account and comfortably more than the 1200px
 * the widest crop below needs.
 */
const COMMONS = "https://thumb.wikimedia.org/wikipedia/commons/thumb";
const UPLOAD = "https://upload.wikimedia.org/wikipedia/commons";

const PHOTOS = {
  /* --- los tacos ---------------------------------------------------------- */
  "al-pastor": {
    url: `${COMMONS}/d/d1/%28El_Flaco%29_Al_Pastor_Tacos.jpg/1920px-%28El_Flaco%29_Al_Pastor_Tacos.jpg`,
    title: "(El Flaco) Al Pastor Tacos",
    license: "CC BY 2.0",
    page: "https://commons.wikimedia.org/wiki/File:(El_Flaco)_Al_Pastor_Tacos.jpg",
    focus: "attention",
  },
  "carne-asada": {
    url: `${COMMONS}/0/0f/Salud_carne_asada_tacos.jpg/1920px-Salud_carne_asada_tacos.jpg`,
    title: "Salud carne asada tacos",
    license: "CC BY 4.0",
    page: "https://commons.wikimedia.org/wiki/File:Salud_carne_asada_tacos.jpg",
    // `attention` found the darkest corner of the plate here. This is the case
    // `focus` exists for.
    focus: "centre",
  },
  carnitas: {
    url: `${COMMONS}/e/ec/Tacos_de_cabeza%2C_carnitas_y_asada.jpg/1920px-Tacos_de_cabeza%2C_carnitas_y_asada.jpg`,
    title: "Tacos de cabeza, carnitas y asada",
    license: "CC BY-SA 2.0",
    page: "https://commons.wikimedia.org/wiki/File:Tacos_de_cabeza,_carnitas_y_asada.jpg",
    focus: "centre",
  },
  suadero: {
    url: `${COMMONS}/5/5e/Tacos_de_suadero_en_Tacos_Charly.jpg/1920px-Tacos_de_suadero_en_Tacos_Charly.jpg`,
    title: "Tacos de suadero en Tacos Charly",
    license: "CC BY-SA 4.0",
    page: "https://commons.wikimedia.org/wiki/File:Tacos_de_suadero_en_Tacos_Charly.jpg",
    focus: "centre",
  },
  birria: {
    url: `${COMMONS}/1/10/Birria_tacos_at_Teddy%27s_Red_Tacos_in_Venice%2C_California.jpg/1920px-Birria_tacos_at_Teddy%27s_Red_Tacos_in_Venice%2C_California.jpg`,
    title: "Birria tacos at Teddy's Red Tacos in Venice, California",
    license: "CC BY 2.0",
    page: "https://commons.wikimedia.org/wiki/File:Birria_tacos_at_Teddy%27s_Red_Tacos_in_Venice,_California.jpg",
    focus: "centre",
  },
  pollo: {
    url: `${COMMONS}/9/99/Tacos_de_pollo_asado_mesquite_grilled_chicken%2C_black_bean_puree%2C_lettuce%2C_charred_onion%2C_chunky_fire_roasted_tomato_sauce_%2826834480122%29.jpg/1920px-Tacos_de_pollo_asado_mesquite_grilled_chicken%2C_black_bean_puree%2C_lettuce%2C_charred_onion%2C_chunky_fire_roasted_tomato_sauce_%2826834480122%29.jpg`,
    title: "Tacos de pollo asado (26834480122)",
    license: "CC BY 2.0",
    page: "https://commons.wikimedia.org/wiki/File:Tacos_de_pollo_asado_mesquite_grilled_chicken,_black_bean_puree,_lettuce,_charred_onion,_chunky_fire_roasted_tomato_sauce_(26834480122).jpg",
    focus: "attention",
  },
  pescado: {
    url: `${COMMONS}/f/f8/Tacos_de_pescado_estilo_Ensenada.jpg/1920px-Tacos_de_pescado_estilo_Ensenada.jpg`,
    title: "Tacos de pescado estilo Ensenada",
    license: "CC BY-SA 4.0",
    page: "https://commons.wikimedia.org/wiki/File:Tacos_de_pescado_estilo_Ensenada.jpg",
    focus: "centre",
  },
  campechano: {
    url: `${COMMONS}/7/7e/Suadero%2C_sesos_%2841205623390%29.jpg/1920px-Suadero%2C_sesos_%2841205623390%29.jpg`,
    title: "Suadero, sesos (41205623390)",
    license: "CC BY 2.0",
    page: "https://commons.wikimedia.org/wiki/File:Suadero,_sesos_(41205623390).jpg",
    focus: "centre",
  },
  arrachera: {
    url: `${COMMONS}/8/8d/Tacos_de_Arrachera.jpg/1920px-Tacos_de_Arrachera.jpg`,
    title: "Tacos de Arrachera",
    license: "CC BY 2.0",
    page: "https://commons.wikimedia.org/wiki/File:Tacos_de_Arrachera.jpg",
    focus: "centre",
  },

  /* --- los antojitos ------------------------------------------------------ */
  quesadilla: {
    url: `${COMMONS}/7/75/Quesadilla_2.jpg/1920px-Quesadilla_2.jpg`,
    title: "Quesadilla 2",
    license: "CC BY-SA 3.0",
    page: "https://commons.wikimedia.org/wiki/File:Quesadilla_2.jpg",
    focus: "centre",
  },
  gringa: {
    url: `${COMMONS}/b/b2/Quesadillas_de_Coyoac%C3%A1n.jpg/1920px-Quesadillas_de_Coyoac%C3%A1n.jpg`,
    title: "Quesadillas de Coyoacan",
    license: "CC BY-SA 4.0",
    page: "https://commons.wikimedia.org/wiki/File:Quesadillas_de_Coyoac%C3%A1n.jpg",
    focus: "attention",
  },
  nachos: {
    url: `${COMMONS}/c/c3/Nachos-cheese_%28cropped%29.jpg/1920px-Nachos-cheese_%28cropped%29.jpg`,
    title: "Nachos-cheese (cropped)",
    license: "CC BY 2.0",
    page: "https://commons.wikimedia.org/wiki/File:Nachos-cheese_(cropped).jpg",
    focus: "centre",
  },
  guacamole: {
    url: `${UPLOAD}/f/fb/Guacamole_tradicional.jpg`,
    title: "Guacamole tradicional",
    license: "CC BY 4.0",
    page: "https://commons.wikimedia.org/wiki/File:Guacamole_tradicional.jpg",
    focus: "centre",
  },
  esquites: {
    url: `${COMMONS}/5/57/Esquites_in_the_streets_of_Coyoacan%2C_Mexico.jpg/1920px-Esquites_in_the_streets_of_Coyoacan%2C_Mexico.jpg`,
    title: "Esquites in the streets of Coyoacan, Mexico",
    license: "CC BY-SA 4.0",
    page: "https://commons.wikimedia.org/wiki/File:Esquites_in_the_streets_of_Coyoacan,_Mexico.jpg",
    focus: "attention",
  },
  burrito: {
    url: `${COMMONS}/a/a6/Mexican_Food_Burrito_vegetarian_bell_pepper_and_sour_cream_20260418_161105_%2812%29.jpg/1920px-Mexican_Food_Burrito_vegetarian_bell_pepper_and_sour_cream_20260418_161105_%2812%29.jpg`,
    title: "Mexican Food Burrito with bell pepper and sour cream",
    license: "CC0",
    page: "https://commons.wikimedia.org/wiki/File:Mexican_Food_Burrito_vegetarian_bell_pepper_and_sour_cream_20260418_161105_(12).jpg",
    focus: "attention",
  },

  /* --- bebidas y postre --------------------------------------------------- */
  horchata: {
    url: `${COMMONS}/4/43/Agua_de_horchata_%2821253977200%29.jpg/1920px-Agua_de_horchata_%2821253977200%29.jpg`,
    title: "Agua de horchata (21253977200)",
    license: "CC BY-SA 2.0",
    page: "https://commons.wikimedia.org/wiki/File:Agua_de_horchata_(21253977200).jpg",
    focus: "attention",
  },
  jamaica: {
    url: `${UPLOAD}/8/89/Chai_torsh_-_Hibiscus_tea.png`,
    title: "Hibiscus tea",
    license: "CC BY-SA 4.0",
    page: "https://commons.wikimedia.org/wiki/File:Chai_torsh_-_Hibiscus_tea.png",
    focus: "centre",
  },
  michelada: {
    url: `${COMMONS}/6/64/Michelada_made_with_beer_20260513_212007_%283%29.jpg/1920px-Michelada_made_with_beer_20260513_212007_%283%29.jpg`,
    title: "Michelada made with beer",
    license: "CC0",
    page: "https://commons.wikimedia.org/wiki/File:Michelada_made_with_beer_20260513_212007_(3).jpg",
    // A tall photograph whose subject is the glass in the middle; `attention`
    // cropped to the blurred jug behind it.
    focus: "centre",
  },
  churros: {
    url: `${COMMONS}/7/79/Churros%2C_Mexico_City_%2826984977061%29.jpg/1920px-Churros%2C_Mexico_City_%2826984977061%29.jpg`,
    title: "Churros, Mexico City (26984977061)",
    license: "CC BY 2.0",
    page: "https://commons.wikimedia.org/wiki/File:Churros,_Mexico_City_(26984977061).jpg",
    focus: "attention",
  },

  /* --- portada, accesos y galeria ----------------------------------------- */
  trompo: {
    url: `${COMMONS}/1/1e/Trompo_de_carne%2C_de_tacos_al_pastor.jpg/1920px-Trompo_de_carne%2C_de_tacos_al_pastor.jpg`,
    title: "Trompo de carne, de tacos al pastor",
    license: "CC BY-SA 2.0",
    page: "https://commons.wikimedia.org/wiki/File:Trompo_de_carne,_de_tacos_al_pastor.jpg",
    focus: "attention",
  },
  taquero: {
    url: `${COMMONS}/8/8d/Tacos_Pastor.JPG/1920px-Tacos_Pastor.JPG`,
    title: "Tacos Pastor",
    license: "CC BY-SA 4.0",
    page: "https://commons.wikimedia.org/wiki/File:Tacos_Pastor.JPG",
    // `attention` climbed to the sign above the stall and cut the trompo out.
    focus: "centre",
  },
  oaxaca: {
    url: `${COMMONS}/f/f8/Street_Tacos_Oaxaca.jpg/1920px-Street_Tacos_Oaxaca.jpg`,
    title: "Street Tacos Oaxaca",
    license: "CC BY-SA 2.0",
    page: "https://commons.wikimedia.org/wiki/File:Street_Tacos_Oaxaca.jpg",
    focus: "centre",
  },
  camaron: {
    url: `${COMMONS}/c/cc/Tacos_de_camar%C3%B3n_gourmet.jpg/1920px-Tacos_de_camar%C3%B3n_gourmet.jpg`,
    title: "Tacos de camaron gourmet",
    license: "CC BY-SA 4.0",
    page: "https://commons.wikimedia.org/wiki/File:Tacos_de_camar%C3%B3n_gourmet.jpg",
    focus: "centre",
  },
  campechanos: {
    url: `${COMMONS}/0/02/Tacos_Campechanos.jpg/1920px-Tacos_Campechanos.jpg`,
    title: "Tacos Campechanos",
    license: "CC BY-SA 4.0",
    page: "https://commons.wikimedia.org/wiki/File:Tacos_Campechanos.jpg",
    focus: "attention",
  },
  dorados: {
    url: `${COMMONS}/c/c0/Tacos_de_Barba_Birria_6.jpg/1920px-Tacos_de_Barba_Birria_6.jpg`,
    title: "Tacos de Barba Birria 6",
    license: "CC BY 2.0",
    page: "https://commons.wikimedia.org/wiki/File:Tacos_de_Barba_Birria_6.jpg",
    focus: "attention",
  },
  surtido: {
    url: `${COMMONS}/7/73/001_Tacos_de_carnitas%2C_carne_asada_y_al_pastor.jpg/1920px-001_Tacos_de_carnitas%2C_carne_asada_y_al_pastor.jpg`,
    title: "001 Tacos de carnitas, carne asada y al pastor",
    license: "CC BY-SA 2.0",
    page: "https://commons.wikimedia.org/wiki/File:001_Tacos_de_carnitas,_carne_asada_y_al_pastor.jpg",
    focus: "centre",
  },
  molcajete: {
    url: `${COMMONS}/a/a1/Molcajete_con_salsa_roja_mexicana_-_3.jpg/1920px-Molcajete_con_salsa_roja_mexicana_-_3.jpg`,
    title: "Molcajete con salsa roja mexicana",
    license: "CC BY-SA 4.0",
    page: "https://commons.wikimedia.org/wiki/File:Molcajete_con_salsa_roja_mexicana_-_3.jpg",
    focus: "centre",
  },
  tortillas: {
    url: `${COMMONS}/4/46/Haciendo_tortillas_a_mano.jpg/1920px-Haciendo_tortillas_a_mano.jpg`,
    title: "Haciendo tortillas a mano",
    license: "CC BY-SA 4.0",
    page: "https://commons.wikimedia.org/wiki/File:Haciendo_tortillas_a_mano.jpg",
    focus: "attention",
  },
  puesto: {
    url: `${COMMONS}/8/85/Esquites_variados.jpg/1920px-Esquites_variados.jpg`,
    title: "Esquites variados",
    license: "CC BY-SA 4.0",
    page: "https://commons.wikimedia.org/wiki/File:Esquites_variados.jpg",
    focus: "centre",
  },
  parrillero: {
    url: `${UPLOAD}/2/27/Barbacoa_Tacos_Chef%2C_Guadalajara.jpg`,
    title: "Barbacoa Tacos Chef, Guadalajara",
    license: "CC BY 2.0",
    page: "https://commons.wikimedia.org/wiki/File:Barbacoa_Tacos_Chef,_Guadalajara.jpg",
    focus: "attention",
  },
  churreria: {
    url: `${COMMONS}/9/95/%22Churros%22_of_all_flavors.jpg/1920px-%22Churros%22_of_all_flavors.jpg`,
    title: '"Churros" of all flavors',
    license: "CC BY-SA 4.0",
    page: "https://commons.wikimedia.org/wiki/File:%22Churros%22_of_all_flavors.jpg",
    focus: "centre",
  },
};

/**
 * What gets made out of each photograph, and at which proportion.
 *
 * The ratios are NOT arbitrary and NOT the photographer's: they are the ones
 * `carbon` renders at (`modules/seo/theme.ts`), so the browser never letterboxes
 * or crops a second time. 4:3 for a dish and for the gallery, 16:9 for a page
 * hero, 16:9 for a slide on a laptop and 9:14 for the same slide on a phone -
 * that last pair being the whole reason a slide stores two files (FR2909).
 */
const SIZES = {
  product: { width: 1200, height: 900, folder: "products" },
  card: { width: 1200, height: 900, folder: "banners" },
  hero: { width: 1600, height: 900, folder: "banners" },
  slideDesktop: { width: 1920, height: 1080, folder: "banners" },
  slideMobile: { width: 1080, height: 1680, folder: "banners" },
};

/**
 * The three slides of the cover, top of the home page.
 *
 * NO SLIDE REUSES A DISH PHOTOGRAPH. The first draft opened on the same three
 * pictures that "Los mas pedidos" shows two screens further down, and a visitor
 * reads that as a site with six photos rather than one with twenty-eight. These
 * three are the wide shots nothing else uses.
 *
 * `mobilePhoto` is set only where a second photograph says the same thing
 * better in portrait; otherwise the desktop one is recropped to 9:14.
 */
const SLIDES = [
  {
    photo: "surtido",
    mobilePhoto: "trompo",
    heading: "Del trompo a tu mesa",
    subheading: "Pastor cortado al momento, tortilla hecha en casa y pina que se dora sola.",
    ctaLabel: "Ver la carta",
    ctaHref: "/sitio/carta",
    overlay: 45,
  },
  {
    photo: "campechanos",
    heading: "Tacos de la calle, en la mesa",
    subheading: "La receta es de Puebla y no ha cambiado una coma desde 2019.",
    ctaLabel: "Pedir ahora",
    ctaHref: "/sitio/carta",
    overlay: 42,
  },
  {
    photo: "camaron",
    heading: "Delivery en 30 minutos",
    subheading: "Miraflores, San Isidro, Barranco y Surquillo. Gratis desde S/ 60.",
    ctaLabel: "Ver zonas",
    ctaHref: "/sitio/zonas-de-delivery",
    overlay: 50,
  },
];

/** The three doors under the cover. */
const SHORTCUTS = [
  {
    photo: "puesto",
    title: "Nuestra carta",
    body: "Nueve tacos, antojitos para compartir y aguas frescas del dia.",
    href: "/sitio/carta",
    linkLabel: "Ver la carta",
  },
  {
    photo: "dorados",
    title: "Zonas de delivery",
    body: "Mira si llegamos a tu distrito y cuanto cuesta el envio.",
    href: "/sitio/zonas-de-delivery",
    linkLabel: "Ver zonas",
  },
  {
    photo: "tortillas",
    title: "Quienes somos",
    body: "El trompo, la tortilla y el adobo que trajimos de Puebla.",
    href: "/sitio/nosotros",
    linkLabel: "Conocenos",
  },
];

/** "El local". Five photographs no other section on the page is using. */
const GALLERY = [
  ["taquero", "La barra del trompo, a la hora en que se llena"],
  ["parrillero", "Chucho, nuestro taquero, en la plancha"],
  ["molcajete", "Las salsas se muelen en molcajete cada manana"],
  ["oaxaca", "Para llevar, en su plato de papel, como debe ser"],
  ["churreria", "Los churros salen del aceite cada media hora"],
];

/* -------------------------------------------------------------------------- */
/*  The provisional logo                                                      */
/* -------------------------------------------------------------------------- */

/**
 * A logo, drawn rather than uploaded.
 *
 * WHY THE SCRIPT DRAWS IT. A business without a logo renders its NAME in the
 * header, which is a perfectly good fallback and tells you nothing about what
 * the product looks like for the ninety per cent of restaurants that have one.
 * Somebody had to decide whether the header survives an image of unknown
 * proportion next to a nav bar, and the answer is only visible with a logo in
 * it. This one is a placeholder in the honest sense: a real taqueria replaces
 * it in Configuracion > Marca in about a minute.
 *
 * SVG IN, PNG OUT. The bucket rejects `image/svg+xml` on purpose (an SVG is a
 * document that can carry script, and serving one from the tenant's own origin
 * would be stored XSS). sharp rasterises it here, so what reaches Storage is
 * pixels.
 */
const MAIZ = "#f0b323";
const MAIZ_D = "#d29413";
const MAIZ_L = "#f8d372";
const CARNE = "#a8471c";
const VERDE = "#5b9b34";
const VERDE_L = "#78bd4a";
const CREMA = "#fff6e4";
const ROJO_SALSA = "#cf3b28";

/**
 * A taco seen from the side.
 *
 * The order of the three layers is the whole drawing: back shell, then a THIN
 * band of filling, then the front shell over it. Pile the filling into a dome
 * and it stops being a taco and becomes a bowl of chili - which is what the
 * first two attempts were.
 */
function tacoMark({
  w = 58,
  hBack = 40,
  hFront = 46,
  tilt = -12,
  shell = MAIZ,
  shellDark = MAIZ_D,
  shellLight = MAIZ_L,
} = {}) {
  const leaves = [];
  for (let i = -3; i <= 3; i++) {
    const x = i * (w / 4);
    const lift = i % 2 === 0 ? 6 : 0;
    leaves.push(
      `<ellipse cx="${x}" cy="${-12 - lift}" rx="13" ry="9" fill="${i % 2 === 0 ? VERDE : VERDE_L}"/>`,
    );
  }
  return `<g transform="rotate(${tilt})">
    <path d="M ${-w} -8 A ${w} ${hBack} 0 0 0 ${w} -8 Z" fill="${shellDark}"/>
    <rect x="${-w + 4}" y="-14" width="${2 * w - 8}" height="26" rx="10" fill="${CARNE}"/>
    ${leaves.join("")}
    <circle cx="${-w * 0.45}" cy="-4" r="5" fill="${CREMA}"/>
    <circle cx="${w * 0.1}" cy="-2" r="5" fill="${ROJO_SALSA}"/>
    <circle cx="${w * 0.55}" cy="-5" r="5" fill="${CREMA}"/>
    <path d="M ${-w} 2 A ${w} ${hFront} 0 0 0 ${w} 2 Z" fill="${shell}"/>
    <path d="M ${-w} 2 A ${w} ${hFront} 0 0 0 ${w} 2" fill="none" stroke="${shellLight}" stroke-width="7" stroke-linecap="round"/>
    <path d="M ${-w * 0.62} ${hFront * 0.45} A ${w * 0.6} ${hFront * 0.5} 0 0 0 ${-w * 0.1} ${hFront * 0.72}" fill="none" stroke="${shellDark}" stroke-width="5" stroke-linecap="round" opacity="0.5"/>
  </g>`;
}

/**
 * The wordmark, transparent, 960x240.
 *
 * Four to one, because the header draws it at `h-10 w-auto max-w-[170px]`: a
 * squarer logo would be capped by the height and leave the width unused, and a
 * wider one would be squeezed to illegibility next to the nav.
 */
function logoImage() {
  const red = BUSINESS.theme.primary_color;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="240" viewBox="0 0 960 240">
      <g transform="translate(120 120)">
        <circle r="106" fill="${red}"/>
        <circle r="94" fill="none" stroke="${MAIZ}" stroke-width="4"/>
        <g transform="translate(0 14) scale(1.02)">${tacoMark()}</g>
      </g>
      <text x="262" y="122" font-family="Georgia, 'Times New Roman', serif" font-size="80" font-weight="bold" fill="${red}">Mr. Taquito</text>
      <text x="266" y="170" font-family="Arial, Helvetica, sans-serif" font-size="25" font-weight="bold" letter-spacing="8.5" fill="${MAIZ_D}">TAQUERIA AL CARBON</text>
    </svg>`;
  return sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();
}

/** The tab icon: the mark alone, on the brand red, 256 square. */
function faviconImage() {
  const red = BUSINESS.theme.primary_color;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
      <rect width="256" height="256" rx="54" fill="${red}"/>
      <g transform="translate(128 132) scale(1.55)">${tacoMark({ tilt: -12 })}</g>
    </svg>`;
  return sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();
}

/* -------------------------------------------------------------------------- */
/*  Photographs: download, cache, crop                                        */
/* -------------------------------------------------------------------------- */

/**
 * The bytes of one photograph, from the cache when it is there.
 *
 * The cache is not an optimisation, it is what makes this script usable: a run
 * touches twenty-eight photographs, and iterating on a caption should not mean
 * pulling thirty megabytes off Commons again. Anything under the temp folder is
 * disposable by definition, so a corrupted entry is fixed by deleting it.
 */
async function photoBytes(key) {
  const photo = PHOTOS[key];
  if (photo === undefined) throw new Error(`No hay foto declarada para "${key}".`);

  const file = join(CACHE, `${key}${photo.url.endsWith(".png") ? ".png" : ".jpg"}`);
  try {
    return await readFile(file);
  } catch {
    /* not cached yet */
  }

  const response = await fetch(photo.url, {
    headers: { "User-Agent": "CloverCode seed (https://clovercodeapp.com)" },
  });
  if (!response.ok) throw new Error(`No se pudo bajar ${key}: HTTP ${response.status}`);

  const bytes = Buffer.from(await response.arrayBuffer());
  await mkdir(CACHE, { recursive: true });
  await writeFile(file, bytes);
  return bytes;
}

/**
 * One photograph, cropped to a size and encoded as WebP.
 *
 * WebP and not JPEG because the folder ceilings are real: `banners` accepts 4
 * MB and `products` 3 (`lib/storage/asset-folders.ts`), a 1920x1080 JPEG at a
 * quality worth looking at is around 900 KB, and the same frame in WebP is a
 * third of that with no visible difference on a photograph of food.
 */
async function photoBuffer(key, size) {
  const photo = PHOTOS[key];
  const position = photo.focus === "attention" ? sharp.strategy.attention : sharp.gravity.centre;

  return sharp(await photoBytes(key))
    .rotate()
    .resize({ width: size.width, height: size.height, fit: "cover", position })
    .webp({ quality: 80 })
    .toBuffer();
}

/* -------------------------------------------------------------------------- */
/*  Supabase                                                                  */
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
    throw new Error("`.env.local` debe definir NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SECRET_KEY.");
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
    // The body carries the constraint name, which is the only useful part of a
    // PostgREST failure. The key never appears in it.
    if (!response.ok) throw new Error(`${method} ${path} -> ${response.status} ${text}`);
    return text.length === 0 ? null : JSON.parse(text);
  }

  /**
   * Puts an object in the tenant bucket.
   *
   * `x-upsert` because the script is idempotent: a second run must replace the
   * file rather than fail on a duplicate key. The path is built the way
   * `lib/storage/assets.ts` builds it, because the `product_images` CHECK
   * validates that shape and would reject anything else.
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
    if (!response.ok)
      throw new Error(`upload ${path} -> ${response.status} ${await response.text()}`);
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
/*  Uploads                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Every image this business needs, uploaded, as PATHS.
 *
 * Paths and never URLs: the bucket is private, a signed URL expires, and a row
 * holding one would rot. That is the same rule the application follows and the
 * reason `product_images.path` is called `path`.
 */
async function seedImages(db, tenantId, enabled) {
  const images = {
    logo: undefined,
    favicon: undefined,
    hero: undefined,
    byProduct: new Map(),
    slides: [],
    shortcuts: new Map(),
    gallery: [],
  };
  if (!enabled) return images;

  const folder = (name, file) => `tenants/${tenantId}/${name}/${file}`;
  let count = 0;

  images.logo = await db.upload(folder("branding", "logo.png"), await logoImage(), "image/png");
  images.favicon = await db.upload(
    folder("branding", "favicon.png"),
    await faviconImage(),
    "image/png",
  );
  count += 2;

  for (const [index, slide] of SLIDES.entries()) {
    const desktop = await db.upload(
      folder("banners", `portada-${index + 1}.webp`),
      await photoBuffer(slide.photo, SIZES.slideDesktop),
      "image/webp",
    );
    const mobile = await db.upload(
      folder("banners", `portada-${index + 1}-movil.webp`),
      await photoBuffer(slide.mobilePhoto ?? slide.photo, SIZES.slideMobile),
      "image/webp",
    );
    images.slides.push({ desktop, mobile });
    count += 2;
  }

  for (const card of SHORTCUTS) {
    images.shortcuts.set(
      card.photo,
      await db.upload(
        folder("banners", `acceso-${card.photo}.webp`),
        await photoBuffer(card.photo, SIZES.card),
        "image/webp",
      ),
    );
    count += 1;
  }

  for (const [key, alt] of GALLERY) {
    images.gallery.push({
      path: await db.upload(
        folder("banners", `local-${key}.webp`),
        await photoBuffer(key, SIZES.card),
        "image/webp",
      ),
      alt,
    });
    count += 1;
  }

  images.hero = await db.upload(
    folder("banners", "nosotros.webp"),
    await photoBuffer("surtido", SIZES.hero),
    "image/webp",
  );
  count += 1;

  for (const [, slug, , , , , photo] of BUSINESS.products) {
    images.byProduct.set(
      slug,
      await db.upload(
        folder("products", `${slug}.webp`),
        await photoBuffer(photo, SIZES.product),
        "image/webp",
      ),
    );
    count += 1;
  }

  log("Imagenes", `${count} archivos subidos`);
  return images;
}

/** `--preview=dir`: the same processing, written to disk, nothing uploaded. */
async function previewImages(dir) {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "logo.png"), await logoImage());
  await writeFile(join(dir, "favicon.png"), await faviconImage());

  for (const [index, slide] of SLIDES.entries()) {
    await writeFile(
      join(dir, `portada-${index + 1}.webp`),
      await photoBuffer(slide.photo, SIZES.slideDesktop),
    );
    await writeFile(
      join(dir, `portada-${index + 1}-movil.webp`),
      await photoBuffer(slide.mobilePhoto ?? slide.photo, SIZES.slideMobile),
    );
  }
  for (const card of SHORTCUTS) {
    await writeFile(
      join(dir, `acceso-${card.photo}.webp`),
      await photoBuffer(card.photo, SIZES.card),
    );
  }
  for (const [key] of GALLERY) {
    await writeFile(join(dir, `local-${key}.webp`), await photoBuffer(key, SIZES.card));
  }
  await writeFile(join(dir, "nosotros.webp"), await photoBuffer("surtido", SIZES.hero));
  for (const [, slug, , , , , photo] of BUSINESS.products) {
    await writeFile(join(dir, `${slug}.webp`), await photoBuffer(photo, SIZES.product));
  }
  process.stdout.write(
    `\n  Fotos procesadas en ${dir}. No se escribio nada en la base de datos.\n\n`,
  );
}

/* -------------------------------------------------------------------------- */
/*  The pages                                                                 */
/* -------------------------------------------------------------------------- */

const whatsappUrl = `https://wa.me/${BUSINESS.settings.whatsapp.replace(/[^0-9]/g, "")}`;

/**
 * The home page, in the order Phase 29 decided a restaurant reads in:
 * cover, doors, what sells most - and only then the prose.
 *
 * `HOME_STRUCTURE` in `modules/storefront/home-upgrade.ts` is the same three
 * sections in the same order; this page is what that upgrade produces when the
 * business has photographs to put in it.
 */
function homeSections(images) {
  const sections = [];

  sections.push({
    type: "slider",
    position: 0,
    content: {
      intervalSeconds: 6,
      slides: SLIDES.map((slide, index) => ({
        heading: slide.heading,
        subheading: slide.subheading,
        ctaLabel: slide.ctaLabel,
        ctaHref: slide.ctaHref,
        overlay: slide.overlay,
        ...(images.slides[index] === undefined
          ? {}
          : {
              imagePath: images.slides[index].desktop,
              mobileImagePath: images.slides[index].mobile,
            }),
      })),
    },
  });

  sections.push({
    type: "shortcuts",
    position: 1,
    content: {
      cards: SHORTCUTS.map((card) => ({
        title: card.title,
        body: card.body,
        href: card.href,
        linkLabel: card.linkLabel,
        ...(images.shortcuts.has(card.photo)
          ? { imagePath: images.shortcuts.get(card.photo) }
          : {}),
      })),
    },
  });

  sections.push({
    type: "bestsellers",
    position: 2,
    content: {
      eyebrow: "Los mas pedidos",
      heading: "Lo que sale sin parar",
      limit: 8,
      linkLabel: "Ver la carta completa",
    },
  });

  sections.push({ type: "banner", position: 3, content: BUSINESS.home.banner });

  sections.push({
    type: "products",
    position: 4,
    content: { heading: "Antojitos para compartir", categorySlug: "antojitos", limit: 6 },
  });

  sections.push({
    type: "text",
    position: 5,
    content: {
      heading: BUSINESS.home.about.heading,
      paragraphs: BUSINESS.home.about.paragraphs.slice(0, 2),
    },
  });

  // A gallery with no images fails its own schema (min 1), which is exactly
  // what `--no-images` would produce.
  if (images.gallery.length > 0) {
    sections.push({
      type: "gallery",
      position: 6,
      content: {
        heading: "El local",
        images: images.gallery.map((image) => ({ imagePath: image.path, alt: image.alt })),
      },
    });
  }

  sections.push(
    {
      type: "faq",
      position: 7,
      content: {
        heading: "Preguntas frecuentes",
        items: BUSINESS.home.faq.map(([question, answer]) => ({ question, answer })),
      },
    },
    {
      type: "cta",
      position: 8,
      content: { ...BUSINESS.home.cta, buttonHref: whatsappUrl },
    },
  );

  return sections;
}

/** "Nosotros": the page the third shortcut opens, and the one nav item with prose. */
function aboutSections(images) {
  return [
    {
      type: "hero",
      position: 0,
      content: {
        heading: "Quienes somos",
        subheading: BUSINESS.tagline,
        ctaLabel: "Ver la carta",
        ctaHref: "/sitio/carta",
        ...(images.hero === undefined ? {} : { imagePath: images.hero }),
      },
    },
    { type: "text", position: 1, content: BUSINESS.home.about },
    ...(images.shortcuts.has("tortillas")
      ? [
          {
            type: "image",
            position: 2,
            content: {
              imagePath: images.shortcuts.get("tortillas"),
              alt: "Manos prensando una tortilla de maiz sobre el metate",
              caption: "Maiz nixtamalizado, molido y prensado aqui mismo cada manana.",
            },
          },
        ]
      : []),
    {
      type: "cta",
      position: 3,
      content: {
        heading: "Ven a probarlos",
        body: `${BUSINESS.settings.address_line}, ${BUSINESS.settings.district}. De martes a domingo desde las 12:30.`,
        buttonLabel: "Escribenos por WhatsApp",
        buttonHref: whatsappUrl,
      },
    },
  ];
}

/**
 * "Promociones": the combos, and the small print under them.
 *
 * A CMS page and not a route, unlike Contacto - because what goes in it IS
 * editable content. Which combos run this month, what the cover says and
 * whether the conditions mention a holiday are decisions a restaurant changes
 * every few weeks, and a hard-coded page would send them to a developer to do
 * it.
 */
function promoSections(images) {
  return [
    {
      type: "hero",
      position: 0,
      content: {
        heading: "Promociones",
        subheading:
          "Combos armados para compartir, a precio cerrado. Valen para llevar, para comer aqui y para delivery.",
        ctaLabel: "Pedir ahora",
        ctaHref: "/sitio/carta",
        ...(images.shortcuts.has("dorados") ? { imagePath: images.shortcuts.get("dorados") } : {}),
      },
    },
    {
      type: "products",
      position: 1,
      content: { heading: "Lo que esta en promocion", categorySlug: "promos", limit: 8 },
    },
    {
      type: "text",
      position: 2,
      content: {
        heading: "Condiciones",
        paragraphs: [
          "Las promociones no se acumulan entre si ni con cupones. El martes de tacos aplica solo para consumo del dia, y la taquiza se pide con dos horas de anticipacion.",
          "Los precios incluyen IGV. Si pides delivery, el envio se cobra aparte segun tu zona.",
        ],
      },
    },
    {
      type: "cta",
      position: 3,
      content: {
        heading: "Arma tu combo",
        body: "Te lo confirmamos por WhatsApp en menos de cinco minutos.",
        buttonLabel: "Pedir por WhatsApp",
        buttonHref: whatsappUrl,
      },
    },
  ];
}

/**
 * The "carta" page, which nothing renders.
 *
 * `/sitio/carta` is a STATIC segment that wins over `[pageSlug]`, and the
 * preview route special-cases the same slug, so both show the real menu with
 * its cart rather than this content. The row exists because a navigation item
 * points at a PAGE, not at a route: without it there is no way to put "Carta"
 * in the nav bar. Its sections are filled in anyway, so that a person who opens
 * it in Paginas sees what it would say rather than an empty editor.
 */
function menuSections() {
  return BUSINESS.categories.map((category, index) => ({
    type: "products",
    position: index,
    content: { heading: category.name, categorySlug: category.slug, limit: 12 },
  }));
}

/* -------------------------------------------------------------------------- */
/*  The seed                                                                  */
/* -------------------------------------------------------------------------- */

async function reset(db) {
  const tenants = await db.select(`tenants?slug=eq.${BUSINESS.slug}&select=id`);
  if (tenants.length === 0) {
    log("Nada que borrar");
    return;
  }
  // Everything else cascades from the tenant row. Storage objects do NOT
  // cascade and are left alone: a re-run overwrites them by path, and deleting
  // files is not something a seed script should do by default.
  await db.remove(`tenants?slug=eq.${BUSINESS.slug}`);
  log("Borrado", `${BUSINESS.name} y todo su contenido`);
}

async function seed(db, withImages) {
  /* --- tenant ------------------------------------------------------------- */
  // `create_tenant_defaults` gives a new tenant its settings, theme, SEO,
  // subscription and first location on insert, so none of those are created
  // here - only filled in.
  const tenant = await ensure(db, "tenants", `slug=eq.${BUSINESS.slug}`, {
    name: BUSINESS.name,
    slug: BUSINESS.slug,
  });
  await db.update(`tenants?id=eq.${tenant.id}`, { name: BUSINESS.name });
  log("Empresa", `${BUSINESS.name} (${tenant.id})`);

  /* --- plan --------------------------------------------------------------- */
  // What "un tenant de 199" means: the S/ 199 plan, not the S/ 399 one every
  // new business is provisioned onto.
  const subscription = await db.select(`subscriptions?tenant_id=eq.${tenant.id}&select=id`);
  if (subscription.length > 0) {
    await db.update(`subscriptions?tenant_id=eq.${tenant.id}`, {
      plan_code: PLAN_CODE,
      status: "active",
      trial_ends_at: null,
    });
  } else {
    await db.insert("subscriptions", [
      { tenant_id: tenant.id, plan_code: PLAN_CODE, status: "active" },
    ]);
  }
  const plan = (await db.select(`plans?code=eq.${PLAN_CODE}&select=name,price_cents`))[0];
  log("Plan", `${plan.name} · S/ ${(plan.price_cents / 100).toFixed(0)} al mes`);

  /* --- domain ------------------------------------------------------------- */
  // `verification_status: 'active'` is what makes it resolve: the resolver
  // ignores domains that are merely registered. A system subdomain is verified
  // by construction - the platform owns the zone - so it is stamped now, which
  // is also what `tenant_domains_verified_at_consistency` requires.
  const domain = `${BUSINESS.slug}.${SYSTEM_DOMAIN}`;
  await ensure(db, "tenant_domains", `tenant_id=eq.${tenant.id}&domain=eq.${domain}`, {
    tenant_id: tenant.id,
    domain,
    type: "system",
    is_primary: true,
    verification_status: "active",
    verified_at: new Date().toISOString(),
  });
  log("Dominio", domain);

  /* --- images ------------------------------------------------------------- */
  const images = await seedImages(db, tenant.id, withImages);

  /* --- settings and theme ------------------------------------------------- */
  await db.update(`tenant_settings?tenant_id=eq.${tenant.id}`, BUSINESS.settings);

  /*
   * A LOGO THE OWNER UPLOADED IS NEVER OVERWRITTEN.
   *
   * The drawn one (`logoImage`) exists so a demo has something in its header;
   * the moment somebody uploads a real mark from Configuracion > Marca, the
   * drawing has done its job. An earlier run of this script replaced a real
   * logo with the placeholder on every re-seed, which is the seed deciding
   * something that belongs to the business.
   */
  const current = (await db.select(`tenant_themes?tenant_id=eq.${tenant.id}&select=*`))[0] ?? {};
  const branding = {
    ...(images.logo === undefined || current.logo_path ? {} : { logo_path: images.logo }),
    ...(images.favicon === undefined || current.favicon_path
      ? {}
      : { favicon_path: images.favicon }),
  };

  /*
   * THE STYLE IS WRITTEN SEPARATELY, and on purpose.
   *
   * `tenant_themes_style_allowed` is a CHECK, so a database that has not run
   * migration 20260919120000 yet rejects `carbon` - and it would reject the
   * colours with it, leaving the business half-themed and the run aborted
   * halfway through. Writing the colours first means the only thing a missing
   * migration costs is the style, and the message says exactly that instead of
   * printing a constraint name.
   */
  const { style, ...palette } = BUSINESS.theme;
  await db.update(`tenant_themes?tenant_id=eq.${tenant.id}`, { ...palette, ...branding });

  let styleApplied = true;
  try {
    await db.update(`tenant_themes?tenant_id=eq.${tenant.id}`, { style });
  } catch (error) {
    if (!String(error.message).includes("tenant_themes_style_allowed")) throw error;
    styleApplied = false;
  }

  log(
    "Tema",
    styleApplied
      ? `${style} · ${palette.primary_color} / ${palette.accent_color}`
      : `${palette.primary_color} / ${palette.accent_color} — FALTA el estilo "${style}": aplica supabase/migrations/20260919120000_add_carbon_theme_style.sql y vuelve a correr`,
  );

  /* --- categories --------------------------------------------------------- */
  const categoryId = new Map();
  let categoryPosition = 0;
  for (const category of BUSINESS.categories) {
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
  log("Categorias", BUSINESS.categories.map((category) => category.name).join(", "));

  /* --- products ----------------------------------------------------------- */
  let position = 0;
  for (const [category, slug, name, description, priceCents, flags] of BUSINESS.products) {
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
      // `tenant_id` is sent because `product_images` carries it, but never
      // invented: the `sync_product_child_tenant` trigger derives it from the
      // parent and would overwrite a wrong one.
      const existing = await db.select(
        `product_images?product_id=eq.${product.id}&is_primary=is.true&select=id`,
      );
      if (existing.length === 0) {
        await db.insert("product_images", [
          {
            product_id: product.id,
            tenant_id: tenant.id,
            path: imagePath,
            alt_text: name,
            is_primary: true,
            position: 0,
          },
        ]);
      } else {
        await db.update(`product_images?id=eq.${existing[0].id}`, {
          path: imagePath,
          alt_text: name,
        });
      }
    }
  }
  log("Productos", `${BUSINESS.products.length} publicados, con foto`);

  /* --- pages -------------------------------------------------------------- */
  async function page(slug, title, sections) {
    const row = await ensure(db, "pages", `tenant_id=eq.${tenant.id}&slug=eq.${slug}`, {
      tenant_id: tenant.id,
      slug,
      title,
      status: "published",
    });
    await db.update(`pages?id=eq.${row.id}`, { title, status: "published" });

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

  await page("inicio", "Inicio", homeSections(images));
  await page("carta", "Carta", menuSections());
  const promos = await page("promociones", "Promociones", promoSections(images));
  const about = await page("nosotros", "Nosotros", aboutSections(images));
  log("Paginas", "inicio, carta, promociones, nosotros (publicadas)");

  /* --- navigation --------------------------------------------------------- */
  await db.remove(`navigation_items?tenant_id=eq.${tenant.id}`);
  /*
   * Every row carries BOTH target columns, one of them null: PostgREST builds
   * one INSERT with one column list and rejects a bulk insert whose objects do
   * not all have the same keys. The
   * `navigation_items_target_matches_type` CHECK still enforces that exactly
   * one of them is set for the declared type.
   */
  /*
   * ONLY THE PAGES THIS BUSINESS ADDED.
   *
   * Inicio, Nuestra carta and Contacto are drawn by `SiteChrome` for every
   * restaurant, and it drops a stored entry pointing at any of them rather than
   * printing it twice. WhatsApp left the bar as well: it is the floating button
   * on every screen and the last row of the footer, and a third copy was
   * spending the most valuable row on the page on the one thing nobody can
   * miss.
   */
  await db.insert(
    "navigation_items",
    [
      {
        label: "Promociones",
        link_type: "page",
        page_id: promos.id,
        external_url: null,
        position: 10,
      },
      { label: "Nosotros", link_type: "page", page_id: about.id, external_url: null, position: 20 },
    ].map((item) => ({ tenant_id: tenant.id, is_active: true, ...item })),
  );
  log("Navegacion", "Promociones, Nosotros (Inicio, Carta y Contacto son fijas)");

  /* --- location and hours ------------------------------------------------- */
  /*
   * The tenant ALREADY HAS a location: `create_tenant_defaults` inserts one
   * named after the business the moment the tenant row appears. Creating a
   * second beside it is what produced two branches in the footer, one of them
   * an empty placeholder reading "Consultar horario".
   */
  const existing = await db.select(
    `locations?tenant_id=eq.${tenant.id}&select=id&order=created_at.asc`,
  );

  const details = {
    name: BUSINESS.location.name,
    address_line: BUSINESS.settings.address_line,
    district: BUSINESS.settings.district,
    city: BUSINESS.settings.city,
    reference: BUSINESS.location.reference,
    phone: BUSINESS.settings.phone,
    is_active: true,
  };

  // Leftovers from an earlier run go FIRST, before the rename:
  // `locations_tenant_name_key` is unique on (tenant_id, lower(name)), so
  // renaming the default while a stale row of the same name exists violates it.
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
    BUSINESS.hours.map(([day, opens, closes]) => ({
      location_id: location.id,
      tenant_id: tenant.id,
      day_of_week: day,
      opens_at: opens,
      closes_at: closes,
    })),
  );
  log("Sede", `${details.name}, abierta martes a domingo`);

  /* --- delivery ----------------------------------------------------------- */
  // Without these, "Zonas de delivery" is a page that says the business has not
  // set up delivery - which is true of a new tenant and false of this demo.
  await db.remove(`delivery_zones?tenant_id=eq.${tenant.id}`);
  for (const [name, district, notes, feeCents, freeFromCents, minutes] of BUSINESS.zones) {
    const zone = (
      await db.insert("delivery_zones", [
        { tenant_id: tenant.id, name, district, notes, is_active: true },
      ])
    )[0];
    await db.insert("delivery_rates", [
      {
        tenant_id: tenant.id,
        zone_id: zone.id,
        location_id: null,
        fee_cents: feeCents,
        min_order_free_cents: freeFromCents,
        estimated_minutes: minutes,
        is_active: true,
      },
    ]);
  }
  log("Delivery", `${BUSINESS.zones.length} zonas con tarifa`);

  /* --- SEO ---------------------------------------------------------------- */
  await db.update(`tenant_seo?tenant_id=eq.${tenant.id}`, {
    site_title: `${BUSINESS.name} · Tacos en ${BUSINESS.settings.district}`,
    site_description: BUSINESS.home.heroSubheading.slice(0, 160),
    og_title: `${BUSINESS.name} — ${BUSINESS.tagline}`,
    og_description: BUSINESS.home.heroSubheading.slice(0, 200),
    ...(images.slides[0] === undefined ? {} : { og_image_path: images.slides[0].desktop }),
    robots_index: true,
  });
  log("SEO", "titulo, descripcion y og:image");

  /* --- access ------------------------------------------------------------- */
  /*
   * Every platform operator becomes an owner of the demo business.
   *
   * Platform authority and tenant membership are deliberately separate things
   * (master section 29), so being a CloverCode operator does NOT open a
   * business's own panel. That separation is right for real customers and pure
   * friction for a demo shop that belongs to nobody.
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
/*  Credits                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Writes the attribution the licences require.
 *
 * Generated rather than typed so it cannot drift from `PHOTOS`: a photograph
 * swapped for a better one changes its credit in the same edit.
 */
async function writeCredits() {
  const lines = [
    "# Fotos de la demo Mr. Taquito",
    "",
    "Las fotografias del negocio de demostracion `mrtaquito` NO son nuestras. Son",
    "imagenes de Wikimedia Commons bajo licencias Creative Commons, usadas como",
    "relleno para poder ver el producto lleno, y `scripts/seed-mrtaquito.mjs` las",
    "recorta y las sube al bucket del tenant en cada corrida.",
    "",
    "Este archivo lo genera ese mismo script (`node scripts/seed-mrtaquito.mjs`) a",
    "partir de la tabla `PHOTOS`: no lo edites a mano.",
    "",
    "**Un cliente real reemplaza estas fotos por las suyas.** Las licencias CC BY y",
    "CC BY-SA exigen credito y, en el caso de BY-SA, compartir las obras derivadas",
    "bajo la misma licencia; ninguna de las dos cosas es razonable para la web de un",
    "restaurante, asi que esto sirve para la demo y no para produccion.",
    "",
    "| Foto | Autoria / archivo | Licencia | Fuente |",
    "| --- | --- | --- | --- |",
  ];

  for (const [key, photo] of Object.entries(PHOTOS)) {
    lines.push(`| \`${key}\` | ${photo.title} | ${photo.license} | [Commons](${photo.page}) |`);
  }
  lines.push("");

  await mkdir(join(process.cwd(), "docs"), { recursive: true });
  await writeFile(CREDITS_FILE, lines.join("\n"), "utf8");
}

/* -------------------------------------------------------------------------- */
/*  Entry point                                                               */
/* -------------------------------------------------------------------------- */

async function main() {
  const shouldReset = process.argv.includes("--reset");
  const withImages = !process.argv.includes("--no-images");
  const previewArg = process.argv.find((arg) => arg.startsWith("--preview="));

  if (previewArg !== undefined) {
    await previewImages(resolve(process.cwd(), previewArg.slice("--preview=".length)));
    return;
  }

  const db = makeClient(await readEnv());

  process.stdout.write(`\n  ${BUSINESS.name} (${BUSINESS.slug})\n`);
  if (shouldReset) await reset(db);
  const tenant = await seed(db, withImages);

  if (withImages) {
    await writeCredits();
    log("Creditos", "docs/mrtaquito-photo-credits.md");
  }

  process.stdout.write(
    [
      "",
      "Listo. Para verlo:",
      "",
      "  Vista previa (funciona en cualquier host, incluido Vercel)",
      `    /vista/${BUSINESS.slug}`,
      "  Web publica por dominio propio",
      `    http://${BUSINESS.slug}.localhost:3000/sitio`,
      "  Panel del negocio",
      `    /dashboard/${BUSINESS.slug}`,
      "  Ficha en el super admin",
      `    /super-admin/tenants/${tenant.id}`,
      "",
      "Las fotos son de Wikimedia Commons bajo licencia CC: relleno para la demo,",
      "no para produccion. Los creditos estan en docs/mrtaquito-photo-credits.md.",
      "",
    ].join("\n"),
  );
}

main().catch((error) => {
  process.stderr.write(`\n${error.message}\n\n`);
  process.exitCode = 1;
});
