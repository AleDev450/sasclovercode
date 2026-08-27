import "server-only";

/**
 * Read side of the kitchen board.
 *
 * The only new read this phase needs - everything it selects already exists
 * (`orders`, `order_items`, Phase 13; `station`, Phase 16 in this same
 * module's own migrations). This is what both the page's first load AND the
 * Realtime-triggered refetch call (ADR-020): one implementation, so a
 * refetch can never show something the initial load wouldn't have.
 */

import { DatabaseError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { KitchenStation, OrderSource, OrderStatus } from "@/types/database";
import { BOARD_STATUSES } from "../constants";

export interface KitchenTicketItem {
  readonly id: string;
  readonly name: string;
  readonly variantName: string | null;
  readonly quantity: number;
  readonly notes: string | null;
  readonly station: KitchenStation;
}

export interface KitchenTicket {
  readonly id: string;
  readonly number: number;
  readonly status: OrderStatus;
  readonly source: OrderSource;
  readonly locationName: string | null;
  readonly customerName: string | null;
  readonly placedAt: string;
  readonly items: readonly KitchenTicketItem[];
}

interface TicketRowShape {
  id: string;
  number: number;
  status: OrderStatus;
  source: OrderSource;
  placed_at: string;
  locations: { name: string } | null;
  customers: { name: string } | null;
  order_items: readonly {
    id: string;
    name_snapshot: string;
    variant_snapshot: string | null;
    quantity: number;
    notes: string | null;
    station: KitchenStation;
  }[];
}

export interface KitchenOrdersFilter {
  /** Which board this is. Omitted shows every station's items together. */
  readonly station?: KitchenStation;
  /**
   * A multi-branch business has a kitchen per branch (Phase 10): omitted
   * only when the tenant has exactly one location, the same rule the POS
   * page (Phase 15) already applies to its own location picker.
   */
  readonly locationId?: string;
}

/**
 * Orders currently on the board (`confirmed`, `preparing`, `ready`), oldest
 * first - the queue order a kitchen actually works in.
 *
 * `station` filters which lines show on each ticket. An order with no line
 * for that station is dropped entirely: PostgREST's embedded-resource
 * filter narrows the nested `order_items` array but does not exclude a
 * parent row left with none, so that step happens here.
 */
export async function listKitchenOrders(
  tenantId: string,
  filters: KitchenOrdersFilter = {},
): Promise<readonly KitchenTicket[]> {
  const client = await createSupabaseServerClient();

  const itemsSelect = "order_items(id, name_snapshot, variant_snapshot, quantity, notes, station)";
  let query = client
    .from("orders")
    .select(`id, number, status, source, placed_at, locations(name), customers(name), ${itemsSelect}`)
    .eq("tenant_id", tenantId)
    .in("status", BOARD_STATUSES);

  if (filters.locationId !== undefined) {
    query = query.eq("location_id", filters.locationId);
  }
  if (filters.station !== undefined) {
    query = query.eq("order_items.station", filters.station);
  }

  const { data, error } = await query.order("placed_at", { ascending: true });

  if (error) {
    logger.error("kitchen.list_failed", { tenantId, filters, error });
    throw new DatabaseError("Kitchen order listing failed.", { cause: error });
  }

  return (data as unknown as TicketRowShape[])
    .map((row) => ({
      id: row.id,
      number: row.number,
      status: row.status,
      source: row.source,
      locationName: row.locations?.name ?? null,
      customerName: row.customers?.name ?? null,
      placedAt: row.placed_at,
      items: (row.order_items ?? [])
        .map((item) => ({
          id: item.id,
          name: item.name_snapshot,
          variantName: item.variant_snapshot,
          quantity: Number(item.quantity),
          notes: item.notes,
          station: item.station,
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    }))
    // A station board never shows a ticket with nothing on it for that
    // station (see the doc comment above); the "all stations" board (no
    // `station` filter) never filters items in the first place, so this
    // only ever drops rows when a station WAS requested.
    .filter((ticket) => filters.station === undefined || ticket.items.length > 0);
}
