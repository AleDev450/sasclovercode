import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui";
import { formatCurrency, formatMoney } from "@/lib/money";
import { PERMISSIONS } from "@/lib/permissions";
import { hasPermission } from "@/lib/permissions/check";
import { requireActiveTenant } from "@/lib/tenant/active";
import {
  AddImageForm,
  AddOptionForm,
  AddVariantForm,
  DeleteChildForm,
  ProductForm,
  ProductStatusForms,
} from "@/modules/catalog/components/catalog-forms";
import { getProductDetail, listCategories } from "@/modules/catalog/server/queries";
import { RecipeForm } from "@/modules/inventory/components/recipe-form";
import { getRecipeForProduct, listInventoryItems } from "@/modules/inventory/server/queries";
import { getBusinessSettings } from "@/modules/settings/server/queries";

export const metadata = { title: "Producto" };

const STATUS_LABEL = { draft: "Borrador", active: "Publicado", archived: "Archivado" } as const;
const STATUS_VARIANT = { draft: "neutral", active: "success", archived: "warning" } as const;

export default async function ProductDetailPage({
  params,
}: {
  params: Promise<{ tenantSlug: string; productId: string }>;
}) {
  const { tenantSlug, productId } = await params;
  const tenant = await requireActiveTenant(tenantSlug);

  if (!(await hasPermission(tenant.id, PERMISSIONS.PRODUCTS_VIEW))) {
    notFound();
  }

  const product = await getProductDetail(tenant.id, productId);
  if (product === null) notFound();

  const canManage = await hasPermission(tenant.id, PERMISSIONS.PRODUCTS_UPDATE);
  const canManageInventory = await hasPermission(tenant.id, PERMISSIONS.INVENTORY_MANAGE);
  const canViewInventory = canManageInventory || (await hasPermission(tenant.id, PERMISSIONS.INVENTORY_VIEW));

  const [categories, settings, recipe, inventoryItems] = await Promise.all([
    listCategories(tenant.id),
    getBusinessSettings(tenant.id),
    canViewInventory ? getRecipeForProduct(tenant.id, product.id) : Promise.resolve(null),
    canManageInventory ? listInventoryItems(tenant.id, { activeOnly: true }) : Promise.resolve([]),
  ]);

  // Options are stored flat with the group label repeated per row (Phase 11
  // models `product_options` as the single table master section 33 asks for),
  // so the grouping happens here, at the only place that has to display it.
  const groups = new Map<string, typeof product.options>();
  for (const option of product.options) {
    groups.set(option.groupLabel, [...(groups.get(option.groupLabel) ?? []), option]);
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{product.name}</h1>
          <p className="text-muted-foreground font-mono text-sm">/{product.slug}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!product.isAvailable ? <Badge variant="warning">Agotado hoy</Badge> : null}
          <Badge variant={STATUS_VARIANT[product.status]}>{STATUS_LABEL[product.status]}</Badge>
        </div>
      </div>

      {canManage ? (
        <Card>
          <CardHeader>
            <CardTitle as="h2">Estado</CardTitle>
            <CardDescription>
              Publicar es una decision editorial. Agotado es de hoy: el producto sigue en la carta,
              marcado como no disponible.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ProductStatusForms tenantSlug={tenant.slug} product={product} />
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle as="h2">Datos</CardTitle>
        </CardHeader>
        <CardContent>
          {canManage ? (
            <ProductForm tenantSlug={tenant.slug} categories={categories} product={product} />
          ) : (
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-muted-foreground text-xs">Precio</dt>
                <dd className="font-mono">
                  {formatCurrency(product.basePriceCents, settings.currency)}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground text-xs">Descripcion</dt>
                <dd>{product.description ?? "-"}</dd>
              </div>
            </dl>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle as="h2">Imagenes</CardTitle>
          <CardDescription>
            Solo una puede ser la principal. Es la que se ve en la carta.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          {product.images.length === 0 ? (
            <p className="text-muted-foreground text-sm">Sin imagenes.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {product.images.map((image) => (
                <li
                  key={image.id}
                  className="border-border flex flex-wrap items-center justify-between gap-3 border-b pb-2 last:border-0"
                >
                  <span className="font-mono text-xs break-all">{image.path}</span>
                  <div className="flex items-center gap-2">
                    {image.isPrimary ? <Badge variant="success">Principal</Badge> : null}
                    {canManage ? (
                      <DeleteChildForm
                        tenantSlug={tenant.slug}
                        productId={product.id}
                        childId={image.id}
                        kind="image"
                      />
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {canManage ? <AddImageForm tenantSlug={tenant.slug} productId={product.id} /> : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle as="h2">Variantes</CardTitle>
          <CardDescription>
            Cada variante lleva su propio precio completo, no una diferencia.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          {product.variants.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              Sin variantes. Se vende al precio del producto.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {product.variants.map((variant) => (
                <li
                  key={variant.id}
                  className="border-border flex flex-wrap items-center justify-between gap-3 border-b pb-2 last:border-0"
                >
                  <span className="text-sm">
                    {variant.name}
                    {variant.sku !== null ? (
                      <span className="text-muted-foreground ml-2 font-mono text-xs">
                        {variant.sku}
                      </span>
                    ) : null}
                  </span>
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-sm tabular-nums">
                      {formatCurrency(variant.priceCents, settings.currency)}
                    </span>
                    {canManage ? (
                      <DeleteChildForm
                        tenantSlug={tenant.slug}
                        productId={product.id}
                        childId={variant.id}
                        kind="variant"
                      />
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {canManage ? <AddVariantForm tenantSlug={tenant.slug} productId={product.id} /> : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle as="h2">Opciones</CardTitle>
          <CardDescription>
            Extras y modificadores. El ajuste se suma al precio; puede ser negativo.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          {groups.size === 0 ? (
            <p className="text-muted-foreground text-sm">Sin opciones.</p>
          ) : (
            <div className="flex flex-col gap-4">
              {[...groups.entries()].map(([label, options]) => (
                <div key={label} className="flex flex-col gap-2">
                  <h3 className="text-sm font-medium">{label}</h3>
                  <ul className="flex flex-col gap-1">
                    {options.map((option) => (
                      <li
                        key={option.id}
                        className="flex flex-wrap items-center justify-between gap-3 text-sm"
                      >
                        <span>{option.name}</span>
                        <div className="flex items-center gap-3">
                          <span className="font-mono tabular-nums">
                            {option.priceDeltaCents >= 0 ? "+" : ""}
                            {formatMoney(option.priceDeltaCents)}
                          </span>
                          {canManage ? (
                            <DeleteChildForm
                              tenantSlug={tenant.slug}
                              productId={product.id}
                              childId={option.id}
                              kind="option"
                            />
                          ) : null}
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
          {canManage ? <AddOptionForm tenantSlug={tenant.slug} productId={product.id} /> : null}
        </CardContent>
      </Card>

      {canViewInventory ? (
        <Card>
          <CardHeader>
            <CardTitle as="h2">Receta</CardTitle>
            <CardDescription>
              Lo que consume una unidad vendida. Al completar un pedido con este producto, el stock
              se descuenta solo.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {canManageInventory ? (
              <RecipeForm
                tenantSlug={tenant.slug}
                productId={product.id}
                items={inventoryItems.map((item) => ({
                  id: item.id,
                  name: item.name,
                  unitAbbreviation: item.unitAbbreviation,
                }))}
                initial={{
                  notes: recipe?.notes ?? null,
                  isActive: recipe?.isActive ?? true,
                  lines: (recipe?.items ?? []).map((item) => ({
                    inventoryItemId: item.inventoryItemId,
                    quantity: item.quantity,
                  })),
                }}
              />
            ) : recipe === null ? (
              <p className="text-muted-foreground text-sm">Este producto no tiene receta.</p>
            ) : (
              <ul className="flex flex-col gap-1 text-sm">
                {recipe.items.map((item) => (
                  <li key={item.inventoryItemId} className="flex items-center justify-between">
                    <span>{item.inventoryItemName}</span>
                    <span className="text-muted-foreground font-mono">
                      {item.quantity} {item.unitAbbreviation}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      ) : null}

      <Link
        href={`/dashboard/${tenant.slug}/catalogo`}
        className="text-muted-foreground text-sm hover:underline"
      >
        Volver al catalogo
      </Link>
    </div>
  );
}
