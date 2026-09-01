import "server-only";

/**
 * Read side of inventory: units, items, suppliers, purchases, stock
 * movements and recipes.
 *
 * One audience: members of the business holding `inventory.view`/
 * `suppliers.view`/`purchases.view`. Current stock always comes from
 * `inventory_stock_levels` (the view, ADR-022) - nothing here sums
 * `stock_movements` by hand, the same posture `payments/server/queries.ts`
 * takes toward a CLOSED cash session's `expected_cents`.
 */

import { DatabaseError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { StockMovementType } from "@/types/database";
import { LIST_CAP } from "@/config/app";

export interface UnitSummary {
  readonly id: string;
  readonly name: string;
  readonly abbreviation: string;
  readonly isActive: boolean;
}

export async function listUnits(
  tenantId: string,
  options: { activeOnly?: boolean } = {},
): Promise<readonly UnitSummary[]> {
  const client = await createSupabaseServerClient();
  let query = client
    .from("units")
    .select("id, name, abbreviation, is_active")
    .eq("tenant_id", tenantId);
  if (options.activeOnly === true) query = query.eq("is_active", true);

  const { data, error } = await query.order("name").limit(LIST_CAP);
  if (error) {
    logger.error("inventory.list_units_failed", { tenantId, error });
    throw new DatabaseError("Unit listing failed.", { cause: error });
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    abbreviation: row.abbreviation,
    isActive: row.is_active,
  }));
}

export interface InventoryItemSummary {
  readonly id: string;
  readonly name: string;
  readonly sku: string | null;
  readonly isActive: boolean;
  readonly unitId: string;
  readonly unitAbbreviation: string;
}

export async function listInventoryItems(
  tenantId: string,
  options: { activeOnly?: boolean } = {},
): Promise<readonly InventoryItemSummary[]> {
  const client = await createSupabaseServerClient();
  let query = client
    .from("inventory_items")
    .select("id, name, sku, is_active, unit_id, units(abbreviation)")
    .eq("tenant_id", tenantId)
    .limit(LIST_CAP);
  if (options.activeOnly === true) query = query.eq("is_active", true);

  const { data, error } = await query.order("name");
  if (error) {
    logger.error("inventory.list_items_failed", { tenantId, error });
    throw new DatabaseError("Inventory item listing failed.", { cause: error });
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    sku: row.sku,
    isActive: row.is_active,
    unitId: row.unit_id,
    unitAbbreviation: (row.units as unknown as { abbreviation: string } | null)?.abbreviation ?? "",
  }));
}

export interface StockByLocation {
  readonly locationId: string;
  readonly locationName: string;
  readonly quantityOnHand: number;
}

export interface StockMovementEntry {
  readonly id: string;
  readonly type: StockMovementType;
  readonly quantity: number;
  readonly locationName: string;
  readonly reason: string | null;
  readonly createdAt: string;
}

export interface InventoryItemDetail extends InventoryItemSummary {
  readonly stockByLocation: readonly StockByLocation[];
  readonly recentMovements: readonly StockMovementEntry[];
}

export async function getInventoryItemDetail(
  tenantId: string,
  itemId: string,
): Promise<InventoryItemDetail | null> {
  const client = await createSupabaseServerClient();

  const { data: item, error: itemError } = await client
    .from("inventory_items")
    .select("id, name, sku, is_active, unit_id, units(abbreviation)")
    .eq("tenant_id", tenantId)
    .eq("id", itemId)
    .maybeSingle();

  if (itemError) {
    logger.error("inventory.item_detail_failed", { tenantId, itemId, error: itemError });
    throw new DatabaseError("Inventory item lookup failed.", { cause: itemError });
  }
  if (item === null) return null;

  const [{ data: stockRows, error: stockError }, { data: movementRows, error: movementError }] =
    await Promise.all([
      client
        .from("inventory_stock_levels")
        .select("location_id, quantity_on_hand, locations(name)")
        .eq("tenant_id", tenantId)
        .eq("inventory_item_id", itemId),
      client
        .from("stock_movements")
        .select("id, type, quantity, reason, created_at, locations(name)")
        .eq("tenant_id", tenantId)
        .eq("inventory_item_id", itemId)
        .order("created_at", { ascending: false })
        .limit(30),
    ]);

  if (stockError) {
    logger.error("inventory.stock_levels_failed", { tenantId, itemId, error: stockError });
    throw new DatabaseError("Stock level lookup failed.", { cause: stockError });
  }
  if (movementError) {
    logger.error("inventory.movements_failed", { tenantId, itemId, error: movementError });
    throw new DatabaseError("Stock movement listing failed.", { cause: movementError });
  }

  return {
    id: item.id,
    name: item.name,
    sku: item.sku,
    isActive: item.is_active,
    unitId: item.unit_id,
    unitAbbreviation:
      (item.units as unknown as { abbreviation: string } | null)?.abbreviation ?? "",
    stockByLocation: (stockRows ?? []).map((row) => ({
      locationId: row.location_id,
      locationName: (row.locations as unknown as { name: string } | null)?.name ?? "—",
      quantityOnHand: row.quantity_on_hand,
    })),
    recentMovements: (movementRows ?? []).map((row) => ({
      id: row.id,
      type: row.type,
      quantity: row.quantity,
      locationName: (row.locations as unknown as { name: string } | null)?.name ?? "—",
      reason: row.reason,
      createdAt: row.created_at,
    })),
  };
}

export interface SupplierSummary {
  readonly id: string;
  readonly name: string;
  readonly taxId: string | null;
  readonly contactName: string | null;
  readonly phone: string | null;
  readonly email: string | null;
  readonly address: string | null;
  readonly notes: string | null;
  readonly isActive: boolean;
}

export async function listSuppliers(
  tenantId: string,
  options: { activeOnly?: boolean } = {},
): Promise<readonly SupplierSummary[]> {
  const client = await createSupabaseServerClient();
  let query = client
    .from("suppliers")
    .select("id, name, tax_id, contact_name, phone, email, address, notes, is_active")
    .eq("tenant_id", tenantId)
    .limit(LIST_CAP);
  if (options.activeOnly === true) query = query.eq("is_active", true);

  const { data, error } = await query.order("name");
  if (error) {
    logger.error("inventory.list_suppliers_failed", { tenantId, error });
    throw new DatabaseError("Supplier listing failed.", { cause: error });
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    taxId: row.tax_id,
    contactName: row.contact_name,
    phone: row.phone,
    email: row.email,
    address: row.address,
    notes: row.notes,
    isActive: row.is_active,
  }));
}

export interface PurchaseSummary {
  readonly id: string;
  readonly supplierName: string;
  readonly locationName: string;
  readonly reference: string | null;
  readonly totalCostCents: number;
  readonly purchasedAt: string;
}

export const PURCHASES_PAGE_SIZE = 20;

export interface PurchasePage {
  readonly purchases: readonly PurchaseSummary[];
  readonly total: number;
  readonly page: number;
  readonly pageCount: number;
}

export async function listPurchases(tenantId: string, page: number): Promise<PurchasePage> {
  const client = await createSupabaseServerClient();
  const from = (page - 1) * PURCHASES_PAGE_SIZE;

  const { data, error, count } = await client
    .from("purchases")
    .select("id, reference, total_cost_cents, purchased_at, suppliers(name), locations(name)", {
      count: "exact",
    })
    .eq("tenant_id", tenantId)
    .order("purchased_at", { ascending: false })
    .range(from, from + PURCHASES_PAGE_SIZE - 1);

  if (error) {
    logger.error("inventory.list_purchases_failed", { tenantId, error });
    throw new DatabaseError("Purchase listing failed.", { cause: error });
  }

  const total = count ?? 0;
  return {
    purchases: (data ?? []).map((row) => ({
      id: row.id,
      supplierName: (row.suppliers as unknown as { name: string } | null)?.name ?? "—",
      locationName: (row.locations as unknown as { name: string } | null)?.name ?? "—",
      reference: row.reference,
      totalCostCents: row.total_cost_cents,
      purchasedAt: row.purchased_at,
    })),
    total,
    page,
    pageCount: Math.max(1, Math.ceil(total / PURCHASES_PAGE_SIZE)),
  };
}

export interface PurchaseLine {
  readonly id: string;
  readonly inventoryItemName: string;
  readonly unitAbbreviation: string;
  readonly quantity: number;
  readonly unitCostCents: number | null;
}

export interface PurchaseDetail extends PurchaseSummary {
  readonly supplierId: string;
  readonly locationId: string;
  readonly notes: string | null;
  readonly lines: readonly PurchaseLine[];
}

export async function getPurchaseDetail(
  tenantId: string,
  purchaseId: string,
): Promise<PurchaseDetail | null> {
  const client = await createSupabaseServerClient();

  const { data, error } = await client
    .from("purchases")
    .select(
      `id, supplier_id, location_id, reference, notes, total_cost_cents, purchased_at,
       suppliers(name), locations(name)`,
    )
    .eq("tenant_id", tenantId)
    .eq("id", purchaseId)
    .maybeSingle();

  if (error) {
    logger.error("inventory.purchase_detail_failed", { tenantId, purchaseId, error });
    throw new DatabaseError("Purchase lookup failed.", { cause: error });
  }
  if (data === null) return null;

  const { data: lineRows, error: lineError } = await client
    .from("stock_movements")
    .select("id, quantity, unit_cost_cents, inventory_items(name, units(abbreviation))")
    .eq("tenant_id", tenantId)
    .eq("purchase_id", purchaseId)
    .order("created_at");

  if (lineError) {
    logger.error("inventory.purchase_lines_failed", { tenantId, purchaseId, error: lineError });
    throw new DatabaseError("Purchase line listing failed.", { cause: lineError });
  }

  return {
    id: data.id,
    supplierId: data.supplier_id,
    locationId: data.location_id,
    supplierName: (data.suppliers as unknown as { name: string } | null)?.name ?? "—",
    locationName: (data.locations as unknown as { name: string } | null)?.name ?? "—",
    reference: data.reference,
    notes: data.notes,
    totalCostCents: data.total_cost_cents,
    purchasedAt: data.purchased_at,
    lines: (lineRows ?? []).map((row) => {
      const item = row.inventory_items as unknown as {
        name: string;
        units: { abbreviation: string } | null;
      } | null;
      return {
        id: row.id,
        inventoryItemName: item?.name ?? "—",
        unitAbbreviation: item?.units?.abbreviation ?? "",
        quantity: row.quantity,
        unitCostCents: row.unit_cost_cents,
      };
    }),
  };
}

export interface RecipeItemEntry {
  readonly inventoryItemId: string;
  readonly inventoryItemName: string;
  readonly unitAbbreviation: string;
  readonly quantity: number;
}

export interface RecipeForProduct {
  readonly id: string;
  readonly notes: string | null;
  readonly isActive: boolean;
  readonly items: readonly RecipeItemEntry[];
}

/** Null when the product has no recipe yet - never an error (ADR-022). */
export async function getRecipeForProduct(
  tenantId: string,
  productId: string,
): Promise<RecipeForProduct | null> {
  const client = await createSupabaseServerClient();

  const { data, error } = await client
    .from("recipes")
    .select(
      `id, notes, is_active,
       recipe_items(inventory_item_id, quantity, position, inventory_items(name, units(abbreviation)))`,
    )
    .eq("tenant_id", tenantId)
    .eq("product_id", productId)
    .maybeSingle();

  if (error) {
    logger.error("inventory.recipe_lookup_failed", { tenantId, productId, error });
    throw new DatabaseError("Recipe lookup failed.", { cause: error });
  }
  if (data === null) return null;

  const items = [
    ...(data.recipe_items as unknown as readonly {
      inventory_item_id: string;
      quantity: number;
      position: number;
      inventory_items: { name: string; units: { abbreviation: string } | null } | null;
    }[]),
  ].sort((a, b) => a.position - b.position);

  return {
    id: data.id,
    notes: data.notes,
    isActive: data.is_active,
    items: items.map((item) => ({
      inventoryItemId: item.inventory_item_id,
      inventoryItemName: item.inventory_items?.name ?? "—",
      unitAbbreviation: item.inventory_items?.units?.abbreviation ?? "",
      quantity: item.quantity,
    })),
  };
}
