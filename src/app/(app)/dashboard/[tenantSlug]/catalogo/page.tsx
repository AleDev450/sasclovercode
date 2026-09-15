import Link from "next/link";
import { notFound } from "next/navigation";
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  PageHeader,
  StatCard,
  StatGrid,
  buttonVariants,
} from "@/components/ui";
import { IconBox, IconCheckCircle, IconSparkle, IconStore } from "@/components/ui/icons";
import { formatCurrency } from "@/lib/money";
import { PERMISSIONS } from "@/lib/permissions";
import { hasPermission } from "@/lib/permissions/check";
import { MODULES } from "@/lib/features";
import { hasFeature } from "@/lib/features/check";
import { requireActiveTenant } from "@/lib/tenant/active";
import { cn } from "@/lib/utils";
import { CategoryForm, ProductForm } from "@/modules/catalog/components/catalog-forms";
import {
  listCategories,
  listProducts,
  type Category,
  type Product,
} from "@/modules/catalog/server/queries";
import { getBusinessSettings } from "@/modules/settings/server/queries";

export const metadata = { title: "Catalogo" };

const STATUS_LABEL = { draft: "Borrador", active: "Publicado", archived: "Archivado" } as const;
const STATUS_VARIANT = { draft: "neutral", active: "success", archived: "warning" } as const;

/**
 * One product row inside its category.
 *
 * A row rather than a card: a business with sixty products scans a list, and a
 * grid of sixty cards is a scroll. The card grid belongs on the PUBLIC site,
 * where there are twelve of them and the photo is the point.
 */
function ProductRow({
  product,
  tenantSlug,
  currency,
}: {
  product: Product;
  tenantSlug: string;
  currency: string;
}) {
  return (
    <li>
      <Link
        href={`/dashboard/${tenantSlug}/catalogo/${product.id}`}
        className={cn(
          "border-border flex items-center gap-4 rounded-lg border px-4 py-3 transition-colors",
          "hover:border-primary/40 hover:bg-muted/50",
        )}
      >
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate font-medium">{product.name}</span>
            {product.isFeatured ? (
              <Badge variant="brand">
                <IconSparkle className="size-3" />
                Destacado
              </Badge>
            ) : null}
            {!product.isAvailable ? <Badge variant="warning">Agotado</Badge> : null}
          </div>
          {product.description !== null ? (
            <p className="text-muted-foreground truncate text-sm">{product.description}</p>
          ) : null}
        </div>

        <span className="shrink-0 font-semibold tabular-nums">
          {formatCurrency(product.basePriceCents, currency)}
        </span>

        <Badge variant={STATUS_VARIANT[product.status]} dot className="shrink-0">
          {STATUS_LABEL[product.status]}
        </Badge>
      </Link>
    </li>
  );
}

/** A category and everything filed under it. */
function CategoryGroup({
  category,
  products,
  tenantSlug,
  currency,
}: {
  category: Category | null;
  products: readonly Product[];
  tenantSlug: string;
  currency: string;
}) {
  const published = products.filter((product) => product.status === "active").length;

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div className="flex items-center gap-2.5">
          <h2 className="text-base font-semibold tracking-tight">
            {category?.name ?? "Sin categoria"}
          </h2>
          {category !== null && !category.isActive ? <Badge variant="neutral">Oculta</Badge> : null}
        </div>

        <p className="text-muted-foreground text-sm tabular-nums">
          {products.length} producto{products.length === 1 ? "" : "s"}
          {published !== products.length ? ` · ${published} publicado(s)` : ""}
        </p>
      </div>

      {category?.description != null && category.description.length > 0 ? (
        <p className="text-muted-foreground -mt-1 text-sm">{category.description}</p>
      ) : null}

      {category === null ? (
        <p className="text-muted-foreground -mt-1 text-sm">
          Estos productos no aparecen agrupados en tu web. Asignales una categoria para ordenarlos.
        </p>
      ) : null}

      {products.length === 0 ? (
        <p className="border-border text-muted-foreground rounded-lg border border-dashed px-4 py-6 text-center text-sm">
          Esta categoria todavia no tiene productos.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {products.map((product) => (
            <ProductRow
              key={product.id}
              product={product}
              tenantSlug={tenantSlug}
              currency={currency}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * The catalogue, arranged the way the shop is arranged.
 *
 * WHY THIS IS NOT A TABLE ANY MORE. It was: one flat list of every product with
 * a "Categoria" column, and two creation forms dropped underneath it. Which
 * meant the ONE structure that matters here - a menu is a set of sections, and
 * the sections are what a customer sees on the website - was reduced to a
 * repeated cell value. A business with forty products could not answer "what is
 * in my Bebidas section" without reading forty rows.
 *
 * Grouping by category makes the screen a mirror of the published site: the
 * order here is the order there, an empty category is visibly empty, and the
 * products nobody filed are called out rather than blending in as
 * "Sin categoria" forty times.
 */
export default async function CatalogPage({ params }: { params: Promise<{ tenantSlug: string }> }) {
  const { tenantSlug } = await params;
  const tenant = await requireActiveTenant(tenantSlug);

  // Phase 21: the plan decides before the person does. 404, not 403 - the
  // same posture every permission guard here takes toward a section that is
  // not yours to know about.
  if (!(await hasFeature(tenant.id, MODULES.CATALOG))) {
    notFound();
  }

  // The nav hides this entry without the permission, but hiding is cosmetic
  // (master section 45): a typed URL lands here, so the page checks too.
  if (!(await hasPermission(tenant.id, PERMISSIONS.PRODUCTS_VIEW))) {
    notFound();
  }

  const canCreate = await hasPermission(tenant.id, PERMISSIONS.PRODUCTS_CREATE);
  const [categories, products, settings] = await Promise.all([
    listCategories(tenant.id),
    listProducts(tenant.id),
    // The currency is a property of the business, stored once (Phase 06). Every
    // price on this page is formatted with it.
    getBusinessSettings(tenant.id),
  ]);

  const byCategory = new Map<string, Product[]>();
  const uncategorised: Product[] = [];

  for (const product of products) {
    if (product.categoryId === null) {
      uncategorised.push(product);
      continue;
    }
    const bucket = byCategory.get(product.categoryId);
    if (bucket === undefined) byCategory.set(product.categoryId, [product]);
    else bucket.push(product);
  }

  const published = products.filter((product) => product.status === "active").length;
  const unavailable = products.filter((product) => !product.isAvailable).length;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Catalogo"
        description={`Lo que vende ${tenant.name}. Un producto nace en borrador y sale a la web cuando lo publicas.`}
        actions={
          <Link
            href={`/dashboard/${tenant.slug}/configuracion/tema`}
            className={buttonVariants({ variant: "outline", size: "md" })}
          >
            Ver como se ve mi web
          </Link>
        }
      />

      {products.length > 0 ? (
        <StatGrid className="xl:grid-cols-4">
          <StatCard
            label="Productos"
            value={products.length}
            hint={`${categories.length} categoria(s)`}
            icon={<IconStore />}
            tone="brand"
          />
          <StatCard
            label="Publicados"
            value={published}
            hint={`${products.length - published} en borrador o archivados`}
            icon={<IconCheckCircle />}
            tone={published > 0 ? "success" : "default"}
          />
          <StatCard
            label="Agotados hoy"
            value={unavailable}
            hint="Siguen en la carta, marcados como agotados"
            icon={<IconBox />}
            tone={unavailable > 0 ? "warning" : "default"}
          />
          <StatCard
            label="Sin categoria"
            value={uncategorised.length}
            hint="No se agrupan en tu web publica"
            tone={uncategorised.length > 0 ? "warning" : "success"}
          />
        </StatGrid>
      ) : null}

      {products.length === 0 && categories.length === 0 ? (
        <EmptyState
          title="Tu catalogo esta vacio"
          description="Empieza creando las categorias de tu carta - por ejemplo Entradas, Fondos y Bebidas - y despues agrega los productos de cada una."
          icon={<IconStore className="size-8" />}
          titleAs="h2"
        />
      ) : (
        <div className="flex flex-col gap-10">
          {categories.map((category) => (
            <CategoryGroup
              key={category.id}
              category={category}
              products={byCategory.get(category.id) ?? []}
              tenantSlug={tenant.slug}
              currency={settings.currency}
            />
          ))}

          {/* Last, and only when it has something in it. A permanent "Sin
              categoria" heading on a tidy catalogue is a reproach for nothing. */}
          {uncategorised.length > 0 ? (
            <CategoryGroup
              category={null}
              products={uncategorised}
              tenantSlug={tenant.slug}
              currency={settings.currency}
            />
          ) : null}
        </div>
      )}

      {canCreate ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle as="h2">Nuevo producto</CardTitle>
              <CardDescription>
                Se crea en borrador: nadie lo vera hasta publicarlo.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ProductForm tenantSlug={tenant.slug} categories={categories} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle as="h2">Nueva categoria</CardTitle>
              <CardDescription>
                Son las secciones de tu carta, y el orden en que salen en tu web.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <CategoryForm tenantSlug={tenant.slug} />
            </CardContent>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
