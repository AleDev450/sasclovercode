import "server-only";

/**
 * Read side of the catalogue.
 *
 * Two audiences with two different rules:
 *
 *   the dashboard  sees drafts too, through `products.view`
 *   the website    sees only `active` products of an active business
 *
 * Both filter by tenant in the query as well as relying on the policy. The
 * policy decides whether the caller may see any of it; the filter decides which
 * business's catalogue this is.
 *
 * Every price crossing this boundary is an integer number of cents. Nothing
 * here divides by 100 - formatting happens at the edge, in the component that
 * renders it.
 */

import { cache } from "react";
import { DatabaseError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { KitchenStation, ProductStatus } from "@/types/database";
import { LIST_CAP } from "@/config/app";

export interface Category {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly description: string | null;
  readonly position: number;
  readonly isActive: boolean;
  /** Which kitchen screen this category's items show up on (Phase 16). */
  readonly kitchenStation: KitchenStation;
}

export interface ProductImage {
  readonly id: string;
  readonly path: string;
  readonly altText: string | null;
  readonly position: number;
  readonly isPrimary: boolean;
}

export interface ProductVariant {
  readonly id: string;
  readonly name: string;
  readonly sku: string | null;
  readonly priceCents: number;
  readonly isActive: boolean;
  readonly position: number;
}

export interface ProductOption {
  readonly id: string;
  readonly groupLabel: string;
  readonly name: string;
  readonly priceDeltaCents: number;
  readonly isActive: boolean;
  readonly position: number;
}

export interface Product {
  readonly id: string;
  readonly categoryId: string | null;
  readonly name: string;
  readonly slug: string;
  readonly description: string | null;
  readonly basePriceCents: number;
  readonly status: ProductStatus;
  readonly isAvailable: boolean;
  readonly isFeatured: boolean;
  readonly position: number;
}

export interface ProductDetail extends Product {
  readonly images: readonly ProductImage[];
  readonly variants: readonly ProductVariant[];
  readonly options: readonly ProductOption[];
}

const CATEGORY_COLUMNS = "id, name, slug, description, position, is_active, kitchen_station";
const PRODUCT_COLUMNS =
  "id, category_id, name, slug, description, base_price_cents, status, is_available, is_featured, position";

function toCategory(row: {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  position: number;
  is_active: boolean;
  kitchen_station: KitchenStation;
}): Category {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    position: row.position,
    kitchenStation: row.kitchen_station,
    isActive: row.is_active,
  };
}

function toProduct(row: {
  id: string;
  category_id: string | null;
  name: string;
  slug: string;
  description: string | null;
  base_price_cents: number;
  status: ProductStatus;
  is_available: boolean;
  is_featured: boolean;
  position: number;
}): Product {
  return {
    id: row.id,
    categoryId: row.category_id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    basePriceCents: row.base_price_cents,
    status: row.status,
    isAvailable: row.is_available,
    isFeatured: row.is_featured,
    position: row.position,
  };
}

export async function listCategories(tenantId: string): Promise<Category[]> {
  const client = await createSupabaseServerClient();
  const { data, error } = await client
    .from("categories")
    .select(CATEGORY_COLUMNS)
    .eq("tenant_id", tenantId)
    .order("position")
    .order("name")
    .limit(LIST_CAP);

  if (error) {
    logger.error("catalog.categories_failed", { tenantId, error });
    throw new DatabaseError("Category listing failed.", { cause: error });
  }
  return (data ?? []).map(toCategory);
}

export async function listProducts(tenantId: string): Promise<Product[]> {
  const client = await createSupabaseServerClient();
  const { data, error } = await client
    .from("products")
    .select(PRODUCT_COLUMNS)
    .eq("tenant_id", tenantId)
    .order("position")
    .order("name")
    .limit(LIST_CAP);

  if (error) {
    logger.error("catalog.products_failed", { tenantId, error });
    throw new DatabaseError("Product listing failed.", { cause: error });
  }
  return (data ?? []).map(toProduct);
}

/** One product of THIS tenant with everything hanging off it, or null. */
export async function getProductDetail(
  tenantId: string,
  productId: string,
): Promise<ProductDetail | null> {
  const client = await createSupabaseServerClient();
  const { data, error } = await client
    .from("products")
    .select(
      `${PRODUCT_COLUMNS}, product_images(id, path, alt_text, position, is_primary), product_variants(id, name, sku, price_cents, is_active, position), product_options(id, group_label, name, price_delta_cents, is_active, position)`,
    )
    .eq("tenant_id", tenantId)
    .eq("id", productId)
    .maybeSingle();

  if (error) {
    logger.error("catalog.product_detail_failed", { tenantId, productId, error });
    throw new DatabaseError("Product lookup failed.", { cause: error });
  }
  if (data === null) return null;

  return {
    ...toProduct(data),
    images: (data.product_images ?? [])
      .map((row) => ({
        id: row.id,
        path: row.path,
        altText: row.alt_text,
        position: row.position,
        isPrimary: row.is_primary,
      }))
      .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || a.position - b.position),
    variants: (data.product_variants ?? [])
      .map((row) => ({
        id: row.id,
        name: row.name,
        sku: row.sku,
        priceCents: row.price_cents,
        isActive: row.is_active,
        position: row.position,
      }))
      .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name)),
    options: (data.product_options ?? [])
      .map((row) => ({
        id: row.id,
        groupLabel: row.group_label,
        name: row.name,
        priceDeltaCents: row.price_delta_cents,
        isActive: row.is_active,
        position: row.position,
      }))
      .sort(
        (a, b) =>
          a.groupLabel.localeCompare(b.groupLabel) ||
          a.position - b.position ||
          a.name.localeCompare(b.name),
      ),
  };
}

export interface ProductWithVariants extends Product {
  readonly variants: readonly ProductVariant[];
}

/**
 * The sellable catalogue, variants included, in ONE query.
 *
 * Built for the POS grid (Phase 15): tapping a product needs to know
 * immediately whether it has variants to offer a choice, and a per-product
 * `getProductDetail` call on every tap would be the N+1 that query exists to
 * avoid elsewhere in the codebase. The embed is one round trip regardless of
 * how many products a tenant has, the same way `getOrderDetail`'s line embed
 * is (Phase 13).
 *
 * `active` only: a draft or archived product is not something a till should
 * be able to ring up, unlike the dashboard's own `listProducts`, which shows
 * everything because it's for managing the catalogue, not selling from it.
 */
export async function listProductsWithVariants(
  tenantId: string,
): Promise<readonly ProductWithVariants[]> {
  const client = await createSupabaseServerClient();
  const { data, error } = await client
    .from("products")
    .select(`${PRODUCT_COLUMNS}, product_variants(id, name, sku, price_cents, is_active, position)`)
    .eq("tenant_id", tenantId)
    .eq("status", "active")
    .order("position")
    .order("name")
    .limit(LIST_CAP);

  if (error) {
    logger.error("catalog.products_with_variants_failed", { tenantId, error });
    throw new DatabaseError("Product listing failed.", { cause: error });
  }

  return (data ?? []).map((row) => ({
    ...toProduct(row),
    variants: (row.product_variants ?? [])
      .filter((variant) => variant.is_active)
      .map((variant) => ({
        id: variant.id,
        name: variant.name,
        sku: variant.sku,
        priceCents: variant.price_cents,
        isActive: variant.is_active,
        position: variant.position,
      }))
      .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name)),
  }));
}

export interface PublicProduct extends Product {
  readonly imagePath: string | null;
  readonly categorySlug: string | null;
}

/**
 * The catalogue a visitor may see.
 *
 * Memoised per request: the `products` section may appear more than once on a
 * page, and Next.js would otherwise run the query once per occurrence.
 *
 * Failure degrades to an empty list rather than throwing, like the Phase 10
 * branch list: a catalogue that momentarily fails to load should leave a gap in
 * the page, not replace the whole site with an error.
 */
export const listPublicProducts = cache(
  async (tenantId: string, categorySlug?: string | null): Promise<PublicProduct[]> => {
    const client = await createSupabaseServerClient();

    let query = client
      .from("products")
      .select(`${PRODUCT_COLUMNS}, categories(slug), product_images(path, position, is_primary)`)
      .eq("tenant_id", tenantId)
      // The policy already hides drafts from a visitor, but a MEMBER reading
      // their own public site matches the member policy instead, which shows
      // everything. Without this filter the site would render differently
      // depending on who was looking - the defect the Phase 07 audit found in
      // the navigation (A7-2).
      .eq("status", "active")
      .limit(LIST_CAP);

    if (categorySlug !== undefined && categorySlug !== null && categorySlug.length > 0) {
      query = query.eq("categories.slug", categorySlug).not("category_id", "is", null);
    }

    const { data, error } = await query.order("position").order("name");

    if (error) {
      logger.error("catalog.public_failed", { tenantId, error });
      return [];
    }

    return (data ?? []).map((row) => {
      const images = row.product_images ?? [];
      const primary =
        images.find((image) => image.is_primary) ??
        [...images].sort((a, b) => a.position - b.position)[0];

      return {
        ...toProduct(row),
        imagePath: primary?.path ?? null,
        categorySlug: (row.categories as { slug: string } | null)?.slug ?? null,
      };
    });
  },
);

/** The active categories a visitor may see, for grouping the public menu. */
export const listPublicCategories = cache(async (tenantId: string): Promise<Category[]> => {
  const client = await createSupabaseServerClient();
  const { data, error } = await client
    .from("categories")
    .select(CATEGORY_COLUMNS)
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .order("position")
    .order("name")
    .limit(LIST_CAP);

  if (error) {
    logger.error("catalog.public_categories_failed", { tenantId, error });
    return [];
  }
  return (data ?? []).map(toCategory);
});
