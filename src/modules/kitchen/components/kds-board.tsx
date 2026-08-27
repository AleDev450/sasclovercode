"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import type { KitchenStation } from "@/types/database";
import { BOARD_STATUSES, BOARD_STATUS_LABELS } from "../constants";
import type { KitchenTicket } from "../server/queries";
import { TicketCard } from "./ticket-card";

/**
 * The board and its one Realtime subscription.
 *
 * ADR-020: Realtime here only ever triggers `router.refresh()`. It does not
 * carry data - the payload of a `postgres_changes` event is never read,
 * because reconstructing "which tickets belong on this board" from it would
 * be a second copy of exactly what `listKitchenOrders` already computes.
 *
 * Filtered to `tenant_id` always, and additionally to `station` when one is
 * selected - `order_items.station` exists on the row specifically so this
 * filter can be expressed at all (ADR-020 §1); without it every station's
 * tablet would receive every other station's ticket events too.
 */
export function KdsBoard({
  tenantSlug,
  tenantId,
  locationId,
  station,
  tickets,
  canAdvance,
}: {
  tenantSlug: string;
  tenantId: string;
  /** Present only when the tenant has more than one location (Phase 10). */
  locationId?: string;
  station?: KitchenStation;
  tickets: readonly KitchenTicket[];
  canAdvance: boolean;
}) {
  const router = useRouter();

  useEffect(() => {
    const client = createSupabaseBrowserClient();
    const tenantAndLocation =
      locationId === undefined ? `tenant_id=eq.${tenantId}` : `tenant_id=eq.${tenantId},location_id=eq.${locationId}`;
    // `order_items` has no `location_id` of its own (it belongs to an order,
    // which has one) - the tenant/station filter is as precise as this table
    // can express; the location narrowing happens on the `orders` side and
    // on the refetch itself (`listKitchenOrders`).
    const itemsFilter =
      station === undefined ? `tenant_id=eq.${tenantId}` : `tenant_id=eq.${tenantId},station=eq.${station}`;

    const channel = client
      .channel(`kds:${tenantId}:${locationId ?? "any"}:${station ?? "all"}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "order_items", filter: itemsFilter },
        () => router.refresh(),
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "orders", filter: tenantAndLocation },
        () => router.refresh(),
      )
      .subscribe();

    return () => {
      void client.removeChannel(channel);
    };
  }, [tenantId, locationId, station, router]);

  const showAllStations = station === undefined;

  return (
    <div className="grid gap-4 sm:grid-cols-3">
      {BOARD_STATUSES.map((status) => {
        const column = tickets.filter((ticket) => ticket.status === status);
        return (
          <div key={status} className="flex flex-col gap-3">
            <h2 className="text-muted-foreground text-sm font-semibold tracking-wide uppercase">
              {BOARD_STATUS_LABELS[status]} <span className="tabular-nums">({column.length})</span>
            </h2>
            <div className="flex flex-col gap-3">
              {column.length === 0 ? (
                <p className="text-muted-foreground text-sm">Sin pedidos.</p>
              ) : (
                column.map((ticket) => (
                  <TicketCard
                    key={ticket.id}
                    tenantSlug={tenantSlug}
                    ticket={ticket}
                    canAdvance={canAdvance}
                    showAllStations={showAllStations}
                  />
                ))
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
