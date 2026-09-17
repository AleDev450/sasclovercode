/**
 * Gives the existing businesses the restaurant home page (Phase 29).
 *
 *   node scripts/apply-storefront-home.mjs              dry run: prints the plan
 *   node scripts/apply-storefront-home.mjs --apply      writes it
 *   node scripts/apply-storefront-home.mjs --apply --only=sugurolls
 *
 * The same plan as the "Crear portada de restaurante" button in Tienda online
 * (`src/modules/storefront/home-upgrade.ts`), for every active business at once:
 * the slider, the shortcuts and "Los mas pedidos" on top; the old hero and
 * product lists HIDDEN, never deleted; everything else one step lower. A business
 * whose home already has the structure is skipped, so running it twice is safe.
 *
 * Uses SUPABASE_SECRET_KEY from `.env.local`, like the demo seed: this is an
 * operator tool, not something the application runs.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const APPLY = process.argv.includes("--apply");
const ONLY = process.argv.find((arg) => arg.startsWith("--only="))?.slice("--only=".length) ?? null;

// Node strips the TypeScript types itself; both files avoid the `@/` alias.
const { planHomeUpgrade } = await import(
  pathToFileURL(join(root, "src", "modules", "storefront", "home-upgrade.ts")).href
);
const { SECTION_TEMPLATES } = await import(
  pathToFileURL(join(root, "src", "modules", "cms", "section-meta.ts")).href
);

async function readEnv() {
  const raw = await readFile(join(root, ".env.local"), "utf8");
  const env = {};
  for (const line of raw.split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match !== null) env[match[1]] = match[2].trim();
  }
  if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SECRET_KEY) {
    throw new Error("`.env.local` must define NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY.");
  }
  return { url: env.NEXT_PUBLIC_SUPABASE_URL, key: env.SUPABASE_SECRET_KEY };
}

function makeClient({ url, key }) {
  async function request(method, path, body) {
    const response = await fetch(`${url}/rest/v1/${path}`, {
      method,
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`${method} ${path} -> ${response.status} ${text}`);
    return text.length === 0 ? null : JSON.parse(text);
  }
  return {
    select: (path) => request("GET", path),
    insert: (table, rows) => request("POST", table, rows),
    update: (path, values) => request("PATCH", path, values),
  };
}

function say(line) {
  process.stdout.write(`${line}
`);
}

const db = makeClient(await readEnv());

const tenants = await db.select(
  `tenants?status=eq.active&select=id,slug,name&order=created_at${ONLY === null ? "" : `&slug=eq.${encodeURIComponent(ONLY)}`}`,
);

if (tenants.length === 0) {
  say(ONLY === null ? "No hay negocios activos." : `No hay un negocio activo con slug "${ONLY}".`);
  process.exit(0);
}

say(
  APPLY
    ? "\nAplicando la portada de restaurante:\n"
    : "\nSimulacion (usa --apply para escribir):\n",
);

for (const tenant of tenants) {
  const pages = await db.select(
    `pages?tenant_id=eq.${tenant.id}&slug=eq.inicio&select=id,status,page_sections(id,type,position,is_visible)`,
  );
  const page = pages[0] ?? null;

  const plan = planHomeUpgrade(
    (page?.page_sections ?? []).map((section) => ({
      id: section.id,
      type: section.type,
      position: section.position,
      isVisible: section.is_visible,
    })),
  );

  const label = `${tenant.name} (${tenant.slug})`;

  if (plan.alreadyApplied) {
    say(`  = ${label}: ya tiene la estructura, sin cambios.`);
    continue;
  }

  const hiddenTypes = (page?.page_sections ?? [])
    .filter((section) => plan.hide.includes(section.id))
    .map((section) => section.type);

  say(
    `  + ${label}: ${page === null ? "crea la portada" : `${page.page_sections.length} secciones bajan`}` +
      ` · agrega slider, accesos y mas pedidos` +
      (hiddenTypes.length > 0 ? ` · oculta: ${hiddenTypes.join(", ")}` : ""),
  );

  if (!APPLY) continue;

  let pageId = page?.id ?? null;
  if (pageId === null) {
    const created = await db.insert("pages", [
      { tenant_id: tenant.id, slug: "inicio", title: "Inicio", status: "published" },
    ]);
    pageId = created[0].id;
  }

  for (const move of plan.move) {
    await db.update(`page_sections?id=eq.${move.id}&tenant_id=eq.${tenant.id}`, {
      position: move.position,
    });
  }
  if (plan.hide.length > 0) {
    await db.update(`page_sections?id=in.(${plan.hide.join(",")})&tenant_id=eq.${tenant.id}`, {
      is_visible: false,
    });
  }
  await db.insert(
    "page_sections",
    plan.insert.map(({ type, position }) => ({
      page_id: pageId,
      tenant_id: tenant.id,
      type,
      content: SECTION_TEMPLATES[type],
      position,
    })),
  );
  await db.update(`pages?id=eq.${pageId}&tenant_id=eq.${tenant.id}`, { status: "published" });
}

say(APPLY ? "\nListo.\n" : "\nNada se escribio.\n");
