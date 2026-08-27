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
} from "@/components/ui";
import { formatCurrency } from "@/lib/money";
import { PERMISSIONS } from "@/lib/permissions";
import { hasPermission } from "@/lib/permissions/check";
import { requireActiveTenant } from "@/lib/tenant/active";
import { CategoryForm, ProductForm } from "@/modules/catalog/components/catalog-forms";
import { listCategories, listProducts } from "@/modules/catalog/server/queries";
import { getBusinessSettings } from "@/modules/settings/server/queries";

export const metadata = { title: "Catalogo" };

const STATUS_LABEL = { draft: "Borrador", active: "Publicado", archived: "Archivado" } as const;
const STATUS_VARIANT = { draft: "neutral", active: "success", archived: "warning" } as const;

export default async function CatalogPage({ params }: { params: Promise<{ tenantSlug: string }> }) {
  const { tenantSlug } = await params;
  const tenant = await requireActiveTenant(tenantSlug);

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

  const categoryName = new Map(categories.map((category) => [category.id, category.name]));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Catalogo</h1>
        <p className="text-muted-foreground text-sm">
          Lo que vende {tenant.name}. Un producto nace en borrador y sale a la web cuando lo
          publicas.
        </p>
      </div>

      {products.length === 0 ? (
        <EmptyState
          title="Aun no hay productos"
          description="Crea una categoria si la necesitas, y despues el primer producto."
        />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[44rem] border-collapse text-sm">
            <caption className="sr-only">Productos de {tenant.name}</caption>
            <thead>
              <tr className="border-border text-muted-foreground border-b text-left text-xs">
                <th scope="col" className="px-4 py-3 font-medium">
                  Producto
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Categoria
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Precio
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Estado
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Accion
                </th>
              </tr>
            </thead>
            <tbody>
              {products.map((product) => (
                <tr key={product.id} className="border-border border-b last:border-0">
                  <td className="px-4 py-3">
                    <span className="font-medium">{product.name}</span>
                    {product.isFeatured ? (
                      <Badge variant="neutral" className="ml-2">
                        Destacado
                      </Badge>
                    ) : null}
                    {!product.isAvailable ? (
                      <Badge variant="warning" className="ml-2">
                        Agotado
                      </Badge>
                    ) : null}
                  </td>
                  <td className="text-muted-foreground px-4 py-3">
                    {product.categoryId === null
                      ? "Sin categoria"
                      : (categoryName.get(product.categoryId) ?? "Sin categoria")}
                  </td>
                  <td className="px-4 py-3 font-mono tabular-nums">
                    {formatCurrency(product.basePriceCents, settings.currency)}
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={STATUS_VARIANT[product.status]}>
                      {STATUS_LABEL[product.status]}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/dashboard/${tenant.slug}/catalogo/${product.id}`}
                      className="text-sm hover:underline"
                    >
                      Abrir
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
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
                Opcional. Un negocio con pocos productos no necesita categorias.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <CategoryForm tenantSlug={tenant.slug} />
            </CardContent>
          </Card>
        </div>
      ) : null}

      {categories.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle as="h2">Categorias</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-wrap gap-2">
              {categories.map((category) => (
                <li key={category.id}>
                  <Badge variant={category.isActive ? "success" : "neutral"}>{category.name}</Badge>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
