/**
 * Builds a complete demo business, from nothing.
 *
 * WHY THIS EXISTS. Every screen in this product is empty until a business fills
 * it, which means nobody - not a developer, not somebody being shown the
 * product - can actually SEE what is being sold without spending an hour typing
 * a menu in. This script is that hour, once, in a file.
 *
 * WHAT IT CREATES: one tenant, its system subdomain, a branded theme, three
 * categories, fourteen products, a published home page with real sections, a
 * navigation bar, and a location with opening hours. The result is a working
 * public website and a dashboard with something in it.
 *
 * IT IS NOT A MIGRATION, deliberately. Demo content is not schema: a migration
 * would recreate this business on every environment forever, including
 * production, and there would be no supported way to be rid of it. A script is
 * run when somebody wants it and deleted with `--reset`.
 *
 * IT IS IDEMPOTENT. Running it twice does not produce two demo businesses or
 * twenty-eight products: every row is matched on its natural key first. That
 * matters because the most common use is running it again after changing one
 * product name.
 *
 * HOW IT TALKS TO THE DATABASE. PostgREST with the service key, which bypasses
 * RLS. That is the right tool here and the wrong one in application code: this
 * is an operator script that runs on a laptop, not a request path. The key is
 * read from `.env.local` and never printed.
 *
 *   node scripts/seed-demo-tenant.mjs
 *   node scripts/seed-demo-tenant.mjs --reset   # delete it and rebuild
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";

const ENV_FILE = join(process.cwd(), ".env.local");

const TENANT = {
  name: "Sabor Criollo",
  slug: "demo",
  /** The system subdomain. `toLookupDomain` maps demo.localhost to this. */
  domain: "demo.clovercodeapp.com",
};

/** The theme, copied from the `brasa` preset in `modules/settings/theme-presets.ts`. */
const THEME = {
  primary_color: "#b91c1c",
  accent_color: "#ea580c",
  background_color: "#fffbf7",
  font_family: "poppins",
  border_radius: "md",
};

const SETTINGS = {
  trade_name: "Sabor Criollo",
  legal_name: "Inversiones Sabor Criollo S.A.C.",
  phone: "+51 987 654 321",
  whatsapp: "+51 987 654 321",
  contact_email: "hola@saborcriollo.pe",
  address_line: "Av. Arequipa 2450",
  district: "Lince",
  city: "Lima",
  currency: "PEN",
  timezone: "America/Lima",
};

/**
 * The three sections of the menu.
 *
 * Three, because that is what the landing page promises a business it can
 * organise, and because a demo with one category demonstrates nothing about
 * grouping.
 */
const CATEGORIES = [
  {
    slug: "entradas",
    name: "Entradas",
    description: "Para empezar, mientras llega el fondo.",
    position: 10,
  },
  {
    slug: "fondos",
    name: "Fondos",
    description: "Los platos de siempre, como en casa.",
    position: 20,
  },
  {
    slug: "bebidas",
    name: "Bebidas",
    description: "Frescas, heladas y bien servidas.",
    position: 30,
  },
];

/** Prices in cents (ADR-015). `featured` products lead the grid on the website. */
const PRODUCTS = [
  // Entradas
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

  // Fondos
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

  // Bebidas
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
];

/** The home page, as the CMS stores it: structured content, never markup. */
const HOME_SECTIONS = [
  {
    type: "hero",
    position: 10,
    content: {
      heading: "Comida criolla como en casa",
      subheading:
        "Cocinamos todos los dias desde 1998 en el corazon de Lince. Pide en linea y recogelo en el local, o te lo llevamos a tu puerta.",
      ctaLabel: "Ver la carta",
      ctaHref: "/sitio/carta",
    },
  },
  {
    type: "banner",
    position: 20,
    content: {
      message: "Delivery gratis en Lince por pedidos desde S/ 60.",
      tone: "success",
    },
  },
  {
    type: "products",
    position: 30,
    content: { heading: "Nuestros fondos", categorySlug: "fondos", limit: 6 },
  },
  {
    type: "products",
    position: 40,
    content: { heading: "Para empezar", categorySlug: "entradas", limit: 3 },
  },
  {
    type: "text",
    position: 50,
    content: {
      heading: "Quienes somos",
      paragraphs: [
        "Sabor Criollo nacio como una fonda de barrio y sigue siendo la misma cocina: ollas grandes, fuego lento y recetas que no han cambiado en veinticinco anos.",
        "Compramos en el mercado cada manana. Si algo se acaba, se acaba - preferimos decirlo antes que servir algo que no nos gustaria comer.",
      ],
    },
  },
  {
    type: "faq",
    position: 60,
    content: {
      heading: "Preguntas frecuentes",
      items: [
        {
          question: "Hacen delivery?",
          answer:
            "Si, en Lince, Jesus Maria y San Isidro. El reparto demora entre 30 y 45 minutos segun el trafico.",
        },
        {
          question: "Puedo reservar mesa?",
          answer:
            "Para grupos de seis personas o mas, si. Escribenos por WhatsApp con un dia de anticipacion.",
        },
        {
          question: "Tienen opciones vegetarianas?",
          answer:
            "Tenemos causa de palta, tequenos y tallarin saltado de verduras. Avisanos al pedir y lo preparamos sin carne.",
        },
      ],
    },
  },
  {
    type: "cta",
    position: 70,
    content: {
      heading: "Tu almuerzo listo en 30 minutos",
      body: "Escribenos por WhatsApp y te confirmamos el pedido al toque.",
      buttonLabel: "Pedir por WhatsApp",
      buttonHref: "https://wa.me/51987654321",
    },
  },
];

/** A second page, so the navigation bar has somewhere to point. */
const MENU_SECTIONS = [
  {
    type: "hero",
    position: 10,
    content: {
      heading: "Nuestra carta",
      subheading: "Todo se prepara al momento. Los precios incluyen IGV.",
    },
  },
  {
    type: "products",
    position: 20,
    content: { heading: "Entradas", categorySlug: "entradas", limit: 12 },
  },
  {
    type: "products",
    position: 30,
    content: { heading: "Fondos", categorySlug: "fondos", limit: 12 },
  },
  {
    type: "products",
    position: 40,
    content: { heading: "Bebidas", categorySlug: "bebidas", limit: 12 },
  },
];

/** Monday to Saturday midday service, Sunday shorter. 0 = Sunday. */
const HOURS = [
  [0, "11:00", "16:00"],
  [1, "12:00", "22:00"],
  [2, "12:00", "22:00"],
  [3, "12:00", "22:00"],
  [4, "12:00", "22:00"],
  [5, "12:00", "23:00"],
  [6, "11:00", "23:00"],
];

// ---------------------------------------------------------------------------
// Plumbing
// ---------------------------------------------------------------------------

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

  return {
    select: (path) => request("GET", path),
    insert: (table, rows) => request("POST", table, rows, { Prefer: "return=representation" }),
    update: (path, patch) => request("PATCH", path, patch, { Prefer: "return=representation" }),
    remove: (path) => request("DELETE", path),
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
  process.stdout.write(`  ${step}${detail === "" ? "" : ` — ${detail}`}\n`);
}

// ---------------------------------------------------------------------------
// The seed
// ---------------------------------------------------------------------------

async function reset(db) {
  const tenants = await db.select(`tenants?slug=eq.${TENANT.slug}&select=id`);
  if (tenants.length === 0) {
    log("Nada que borrar");
    return;
  }

  // Everything else cascades from the tenant row: every table in this script
  // has `on delete cascade` on its tenant foreign key.
  await db.remove(`tenants?slug=eq.${TENANT.slug}`);
  log("Borrado", `${TENANT.name} y todo su contenido`);
}

async function seed(db) {
  // --- tenant -------------------------------------------------------------
  // The `tenants_create_defaults` trigger gives it a settings row and a theme
  // row on insert, so neither is created here - only updated.
  const tenant = await ensure(db, "tenants", `slug=eq.${TENANT.slug}`, {
    name: TENANT.name,
    slug: TENANT.slug,
  });
  log("Empresa", `${tenant.name} (${tenant.id})`);

  // --- domain -------------------------------------------------------------
  // `verification_status: 'active'` is what makes it resolve: the resolver
  // ignores domains that are merely registered.
  await ensure(db, "tenant_domains", `tenant_id=eq.${tenant.id}&domain=eq.${TENANT.domain}`, {
    tenant_id: tenant.id,
    domain: TENANT.domain,
    type: "system",
    is_primary: true,
    verification_status: "active",
    // `tenant_domains_verified_at_consistency` requires the timestamp to be
    // present exactly when the status is `active`, so the two cannot
    // disagree. A system subdomain is verified by construction - the platform
    // owns the zone - so it is stamped now.
    verified_at: new Date().toISOString(),
  });
  log("Dominio", TENANT.domain);

  // --- settings and theme -------------------------------------------------
  await db.update(`tenant_settings?tenant_id=eq.${tenant.id}`, SETTINGS);
  await db.update(`tenant_themes?tenant_id=eq.${tenant.id}`, THEME);
  log("Tema", `${THEME.primary_color} / ${THEME.font_family}`);

  // --- categories ---------------------------------------------------------
  const categoryId = new Map();
  for (const category of CATEGORIES) {
    const row = await ensure(
      db,
      "categories",
      `tenant_id=eq.${tenant.id}&slug=eq.${category.slug}`,
      { tenant_id: tenant.id, ...category },
    );
    categoryId.set(category.slug, row.id);
  }
  log("Categorias", CATEGORIES.map((c) => c.name).join(", "));

  // --- products -----------------------------------------------------------
  let position = 0;
  for (const [category, slug, name, description, priceCents, flags] of PRODUCTS) {
    position += 10;
    await ensure(db, "products", `tenant_id=eq.${tenant.id}&slug=eq.${slug}`, {
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
  }
  log("Productos", `${PRODUCTS.length} publicados`);

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

  const home = await page("inicio", "Inicio", HOME_SECTIONS);
  const menu = await page("carta", "Carta", MENU_SECTIONS);
  log("Paginas", "inicio, carta (publicadas)");

  // --- navigation ---------------------------------------------------------
  await db.remove(`navigation_items?tenant_id=eq.${tenant.id}`);

  /*
   * Every row carries BOTH target columns, one of them null.
   *
   * PostgREST rejects a bulk insert whose objects do not all have the same
   * keys ("All object keys must match") - it builds one INSERT statement with
   * one column list. A page link and an external link naturally have different
   * shapes, so the nulls are spelled out. The
   * `navigation_items_target_matches_type` CHECK still enforces that exactly
   * one of them is set for the declared type.
   */
  await db.insert(
    "navigation_items",
    [
      { label: "Inicio", link_type: "page", page_id: home.id, external_url: null, position: 10 },
      { label: "Carta", link_type: "page", page_id: menu.id, external_url: null, position: 20 },
      {
        label: "WhatsApp",
        link_type: "external",
        page_id: null,
        external_url: "https://wa.me/51987654321",
        position: 30,
      },
    ].map((item) => ({ tenant_id: tenant.id, is_active: true, ...item })),
  );
  log("Navegacion", "Inicio, Carta, WhatsApp");

  // --- location and hours -------------------------------------------------
  /*
   * The tenant ALREADY HAS a location, and the first version of this script
   * did not know that.
   *
   * `create_tenant_defaults` inserts one named after the business the moment
   * the tenant row appears, so creating "Local Lince" beside it produced two
   * branches in the footer - one real, one an empty placeholder reading
   * "Consultar horario". The fix is to fill in the row that exists rather than
   * add a second: a demo shop has one branch.
   */
  const existing = await db.select(
    `locations?tenant_id=eq.${tenant.id}&select=id&order=created_at.asc`,
  );

  const details = {
    name: "Local Lince",
    address_line: SETTINGS.address_line,
    district: SETTINGS.district,
    city: SETTINGS.city,
    reference: "A media cuadra del parque Castilla",
    phone: SETTINGS.phone,
    is_active: true,
  };

  // Leftovers from an earlier run go FIRST, before the rename.
  //
  // `locations_tenant_name_key` is unique on (tenant_id, lower(name)), so
  // renaming the default to "Local Lince" while a stale "Local Lince" still
  // exists is a constraint violation - which is exactly what happened the first
  // time this ran against an already-seeded database.
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
    HOURS.map(([day, opens, closes]) => ({
      location_id: location.id,
      tenant_id: tenant.id,
      day_of_week: day,
      opens_at: opens,
      closes_at: closes,
    })),
  );
  log("Sede", "Local Lince, con horarios");

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
   * and only on this one tenant.
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

async function main() {
  const shouldReset = process.argv.includes("--reset");
  const db = makeClient(await readEnv());

  process.stdout.write(`\nSembrando "${TENANT.name}"\n\n`);

  if (shouldReset) await reset(db);
  const tenant = await seed(db);

  process.stdout.write(
    [
      "",
      "Listo. Para verlo:",
      "",
      `  Web publica        http://${TENANT.slug}.localhost:3000/sitio`,
      `  Carta              http://${TENANT.slug}.localhost:3000/sitio/carta`,
      `  Panel del negocio  http://localhost:3000/dashboard/${TENANT.slug}`,
      `  Temas              http://localhost:3000/dashboard/${TENANT.slug}/configuracion/tema`,
      "",
      "Inicia sesion con tu cuenta de operador: ya quedaste como owner de esta",
      "empresa, asi que el panel se abre directamente.",
      "",
      `  Ficha en el super admin  http://localhost:3000/super-admin/tenants/${tenant.id}`,
      "",
    ].join("\n"),
  );
}

main().catch((error) => {
  process.stderr.write(`\n${error.message}\n\n`);
  process.exitCode = 1;
});
