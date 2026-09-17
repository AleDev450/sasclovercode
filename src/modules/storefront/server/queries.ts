import "server-only";

/**
 * Read side of the storefront (Phase 29).
 *
 * The public half runs for a visitor with no session, through the `security
 * definer` functions of `20260916120100_create_storefront.sql`. Every one of them
 * degrades instead of throwing: a restaurant whose delivery zones momentarily
 * fail to load should still show its menu, the same posture the branch list and
 * the catalogue took in Phases 10 and 11.
 *
 * The admin half (`getStorefrontSettings`) runs as a member and goes through the
 * table's own policy.
 */

import { cache } from "react";
import { LIST_CAP } from "@/config/app";
import { DatabaseError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type {
  DeliveryStatus,
  OrderStatus,
  PaymentMethodType,
  SocialPlatform,
  StorefrontMode,
} from "@/types/database";

/* -------------------------------------------------------------------------- */
/*  The storefront                                                             */
/* -------------------------------------------------------------------------- */

export interface PublicStorefront {
  readonly orderingEnabled: boolean;
  /** Enabled, has the module, and open right now. */
  readonly canOrder: boolean;
  readonly isOpen: boolean;
  readonly mode: StorefrontMode;
  readonly closedMessage: string | null;
  readonly acceptsDelivery: boolean;
  readonly acceptsPickup: boolean;
  readonly minOrderCents: number;
  readonly whatsapp: string | null;
  readonly whatsappButton: boolean;
  readonly whatsappMessage: string | null;
  readonly tagline: string | null;
  readonly publicEmail: string | null;
  readonly locationId: string | null;
}

/** What the site renders when the row cannot be read: a menu, and no checkout. */
const CLOSED_STOREFRONT: PublicStorefront = {
  orderingEnabled: false,
  canOrder: false,
  isOpen: false,
  mode: "closed",
  closedMessage: null,
  acceptsDelivery: false,
  acceptsPickup: true,
  minOrderCents: 0,
  whatsapp: null,
  whatsappButton: false,
  whatsappMessage: null,
  tagline: null,
  publicEmail: null,
  locationId: null,
};

export const getPublicStorefront = cache(async (tenantId: string): Promise<PublicStorefront> => {
  const client = await createSupabaseServerClient();
  const { data, error } = await client.rpc("get_public_storefront", { p_tenant_id: tenantId });

  if (error) {
    logger.error("storefront.read_failed", { tenantId, error });
    return CLOSED_STOREFRONT;
  }

  const row = data?.[0];
  if (row === undefined) return CLOSED_STOREFRONT;

  return {
    orderingEnabled: row.ordering_enabled,
    canOrder: row.can_order,
    isOpen: row.is_open,
    mode: row.mode,
    closedMessage: row.closed_message,
    acceptsDelivery: row.accepts_delivery,
    acceptsPickup: row.accepts_pickup,
    minOrderCents: Number(row.min_order_cents),
    whatsapp: row.whatsapp,
    whatsappButton: row.whatsapp_button,
    whatsappMessage: row.whatsapp_message,
    tagline: row.tagline,
    publicEmail: row.public_email,
    locationId: row.location_id,
  };
});

export interface PublicSocialLink {
  readonly platform: SocialPlatform;
  readonly url: string;
}

export const listPublicSocialLinks = cache(
  async (tenantId: string): Promise<readonly PublicSocialLink[]> => {
    const client = await createSupabaseServerClient();
    const { data, error } = await client.rpc("list_public_social_links", {
      p_tenant_id: tenantId,
    });

    if (error) {
      logger.error("storefront.social_failed", { tenantId, error });
      return [];
    }
    return (data ?? []).map((row) => ({ platform: row.platform, url: row.url }));
  },
);

export interface PublicDeliveryZone {
  readonly id: string;
  readonly name: string;
  readonly district: string | null;
  readonly notes: string | null;
  readonly feeCents: number;
  readonly minOrderFreeCents: number | null;
  readonly estimatedMinutes: number | null;
}

export const listPublicDeliveryZones = cache(
  async (tenantId: string): Promise<readonly PublicDeliveryZone[]> => {
    const client = await createSupabaseServerClient();
    const { data, error } = await client.rpc("list_public_delivery_zones", {
      p_tenant_id: tenantId,
    });

    if (error) {
      logger.error("storefront.zones_failed", { tenantId, error });
      return [];
    }
    return (data ?? []).map((row) => ({
      id: row.zone_id,
      name: row.name,
      district: row.district,
      notes: row.notes,
      feeCents: Number(row.fee_cents),
      minOrderFreeCents:
        row.min_order_free_cents === null ? null : Number(row.min_order_free_cents),
      estimatedMinutes: row.estimated_minutes,
    }));
  },
);

export interface PublicPaymentMethod {
  readonly id: string;
  readonly type: PaymentMethodType;
  readonly name: string;
  readonly reference: string | null;
}

export const listPublicPaymentMethods = cache(
  async (tenantId: string): Promise<readonly PublicPaymentMethod[]> => {
    const client = await createSupabaseServerClient();
    const { data, error } = await client.rpc("list_public_payment_methods", {
      p_tenant_id: tenantId,
    });

    if (error) {
      logger.error("storefront.payment_methods_failed", { tenantId, error });
      return [];
    }
    return (data ?? []).map((row) => ({
      id: row.id,
      type: row.type,
      name: row.name,
      reference: row.reference,
    }));
  },
);

/** Product ids, best-selling first. Empty when nothing has sold yet. */
export const listBestsellerIds = cache(
  async (tenantId: string, limit: number): Promise<readonly string[]> => {
    const client = await createSupabaseServerClient();
    const { data, error } = await client.rpc("list_public_bestsellers", {
      p_tenant_id: tenantId,
      p_limit: limit,
    });

    if (error) {
      logger.error("storefront.bestsellers_failed", { tenantId, error });
      return [];
    }
    return (data ?? []).map((row) => row.product_id);
  },
);

/* -------------------------------------------------------------------------- */
/*  The menu                                                                   */
/* -------------------------------------------------------------------------- */

export interface MenuVariant {
  readonly id: string;
  readonly name: string;
  readonly priceCents: number;
}

export interface MenuOption {
  readonly id: string;
  readonly groupLabel: string;
  readonly name: string;
  readonly priceDeltaCents: number;
}

export interface MenuProduct {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly basePriceCents: number;
  readonly isAvailable: boolean;
  readonly isFeatured: boolean;
  readonly position: number;
  readonly categoryId: string | null;
  readonly imagePath: string | null;
  readonly variants: readonly MenuVariant[];
  readonly options: readonly MenuOption[];
}

export interface MenuCategory {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly description: string | null;
}

export interface PublicMenu {
  readonly categories: readonly MenuCategory[];
  readonly products: readonly MenuProduct[];
}

/**
 * The whole sellable menu: active products with their active variants and
 * extras, and the categories that group them.
 *
 * One query per table rather than one nested select, because the public
 * policies of Phase 11 are per table and PostgREST applies each to its own
 * embed anyway - and because a nested select returns inactive children that
 * would then have to be filtered in memory, which is where a sold-out extra
 * would slip back onto a website.
 */
export const listPublicMenu = cache(async (tenantId: string): Promise<PublicMenu> => {
  const client = await createSupabaseServerClient();

  const [categories, products, variants, options, images] = await Promise.all([
    client
      .from("categories")
      .select("id, slug, name, description, position")
      .eq("tenant_id", tenantId)
      .eq("is_active", true)
      .order("position")
      .order("name")
      .limit(LIST_CAP),
    client
      .from("products")
      .select(
        "id, name, description, base_price_cents, is_available, is_featured, position, category_id",
      )
      .eq("tenant_id", tenantId)
      // The policy hides drafts from a visitor, but a member reading their own
      // site matches the member policy, which shows everything (Phase 07 A7-2).
      .eq("status", "active")
      .order("position")
      .order("name")
      .limit(LIST_CAP),
    client
      .from("product_variants")
      .select("id, product_id, name, price_cents, position")
      .eq("tenant_id", tenantId)
      .eq("is_active", true)
      .order("position")
      .limit(LIST_CAP),
    client
      .from("product_options")
      .select("id, product_id, group_label, name, price_delta_cents, position")
      .eq("tenant_id", tenantId)
      .eq("is_active", true)
      .order("position")
      .limit(LIST_CAP),
    client
      .from("product_images")
      .select("product_id, path, position, is_primary")
      .eq("tenant_id", tenantId)
      .order("position")
      .limit(LIST_CAP),
  ]);

  const failed = [categories, products, variants, options, images].find(
    (result) => result.error !== null,
  );
  if (failed !== undefined) {
    logger.error("storefront.menu_failed", { tenantId, error: failed.error });
    return { categories: [], products: [] };
  }

  const variantsByProduct = new Map<string, MenuVariant[]>();
  for (const row of variants.data ?? []) {
    const list = variantsByProduct.get(row.product_id) ?? [];
    list.push({ id: row.id, name: row.name, priceCents: Number(row.price_cents) });
    variantsByProduct.set(row.product_id, list);
  }

  const optionsByProduct = new Map<string, MenuOption[]>();
  for (const row of options.data ?? []) {
    const list = optionsByProduct.get(row.product_id) ?? [];
    list.push({
      id: row.id,
      groupLabel: row.group_label,
      name: row.name,
      priceDeltaCents: Number(row.price_delta_cents),
    });
    optionsByProduct.set(row.product_id, list);
  }

  const imageByProduct = new Map<string, string>();
  for (const row of images.data ?? []) {
    if (row.is_primary || !imageByProduct.has(row.product_id)) {
      imageByProduct.set(row.product_id, row.path);
    }
  }

  return {
    categories: (categories.data ?? []).map((row) => ({
      id: row.id,
      slug: row.slug,
      name: row.name,
      description: row.description,
    })),
    products: (products.data ?? []).map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      basePriceCents: Number(row.base_price_cents),
      isAvailable: row.is_available,
      isFeatured: row.is_featured,
      position: row.position,
      categoryId: row.category_id,
      imagePath: imageByProduct.get(row.id) ?? null,
      variants: variantsByProduct.get(row.id) ?? [],
      options: optionsByProduct.get(row.id) ?? [],
    })),
  };
});

/* -------------------------------------------------------------------------- */
/*  Tracking                                                                   */
/* -------------------------------------------------------------------------- */

export interface PublicWebOrder {
  readonly number: number;
  readonly status: OrderStatus;
  readonly placedAt: string;
  readonly fulfillment: "delivery" | "pickup";
  readonly contactName: string;
  readonly subtotalCents: number;
  readonly discountCents: number;
  readonly shippingCents: number;
  readonly totalCents: number;
  readonly paidCents: number;
  readonly paymentMethod: string | null;
  readonly paymentType: PaymentMethodType | null;
  readonly paymentReference: string | null;
  readonly deliveryStatus: DeliveryStatus | null;
  readonly zoneName: string | null;
  /** Phase 31. */
  readonly payOnline: boolean;
  readonly onlinePaymentStatus: "none" | "pending" | "approved" | "rejected";
  readonly items: readonly {
    name: string;
    variant: string | null;
    options: string | null;
    quantity: number;
    totalCents: number;
  }[];
}

const TOKEN = /^[0-9a-f]{64}$/;

export async function getPublicWebOrder(
  tenantId: string,
  token: string,
): Promise<PublicWebOrder | null> {
  // Rejected before the round trip: the function would return nothing anyway,
  // and a crawler probing random paths should not cost a query each.
  if (!TOKEN.test(token)) return null;

  const client = await createSupabaseServerClient();
  const { data, error } = await client.rpc("get_public_web_order", {
    p_tenant_id: tenantId,
    p_token: token,
  });

  if (error) {
    logger.error("storefront.tracking_failed", { tenantId, error });
    throw new DatabaseError("Web order lookup failed.", { cause: error });
  }

  const row = data?.[0];
  if (row === undefined) return null;

  const items = Array.isArray(row.items) ? row.items : [];

  return {
    number: row.order_number,
    status: row.status,
    placedAt: row.placed_at,
    fulfillment: row.fulfillment,
    contactName: row.contact_name,
    subtotalCents: Number(row.subtotal_cents),
    discountCents: Number(row.discount_cents),
    shippingCents: Number(row.shipping_cents),
    totalCents: Number(row.total_cents),
    paidCents: Number(row.paid_cents),
    paymentMethod: row.payment_method,
    paymentType: row.payment_type,
    paymentReference: row.payment_reference,
    deliveryStatus: row.delivery_status,
    zoneName: row.zone_name,
    payOnline: row.pay_online,
    onlinePaymentStatus: row.online_payment_status,
    items: items.map((item) => {
      const value = (item ?? {}) as Record<string, unknown>;
      return {
        name: typeof value.name === "string" ? value.name : "",
        variant: typeof value.variant === "string" ? value.variant : null,
        options: typeof value.options === "string" ? value.options : null,
        quantity: Number(value.quantity ?? 0),
        totalCents: Number(value.total_cents ?? 0),
      };
    }),
  };
}

/* -------------------------------------------------------------------------- */
/*  Admin                                                                      */
/* -------------------------------------------------------------------------- */

export interface StorefrontSettings {
  readonly orderingEnabled: boolean;
  readonly mode: StorefrontMode;
  readonly closedMessage: string | null;
  readonly acceptsDelivery: boolean;
  readonly acceptsPickup: boolean;
  readonly minOrderCents: number;
  readonly orderLocationId: string | null;
  readonly whatsappButton: boolean;
  readonly whatsappMessage: string | null;
  readonly tagline: string | null;
  readonly publicEmail: string | null;
  readonly bestsellersDays: number;
}

export async function getStorefrontSettings(tenantId: string): Promise<StorefrontSettings> {
  const client = await createSupabaseServerClient();
  const { data, error } = await client
    .from("tenant_storefronts")
    .select("*")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (error) {
    logger.error("storefront.settings_failed", { tenantId, error });
    throw new DatabaseError("Storefront settings lookup failed.", { cause: error });
  }
  if (data === null) {
    throw new DatabaseError("Storefront settings row is missing.");
  }

  return {
    orderingEnabled: data.ordering_enabled,
    mode: data.mode,
    closedMessage: data.closed_message,
    acceptsDelivery: data.accepts_delivery,
    acceptsPickup: data.accepts_pickup,
    minOrderCents: Number(data.min_order_cents),
    orderLocationId: data.order_location_id,
    whatsappButton: data.whatsapp_button,
    whatsappMessage: data.whatsapp_message,
    tagline: data.tagline,
    publicEmail: data.public_email,
    bestsellersDays: data.bestsellers_days,
  };
}
