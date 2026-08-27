import { Badge, Card, CardContent, CardHeader, CardTitle } from "@/components/ui";
import { AdvanceOrderForm } from "@/modules/orders/components/order-status-actions";
import { ORDER_SOURCE_LABELS } from "@/modules/orders/lifecycle";
import { KITCHEN_STATION_LABELS } from "../constants";
import type { KitchenTicket } from "../server/queries";

/**
 * One order, one card. The advance button is `AdvanceOrderForm` (Phase 13)
 * unmodified - this phase never touches the state machine, only reads a
 * slice of it (ADR-020, decision 6).
 */
export function TicketCard({
  tenantSlug,
  ticket,
  canAdvance,
  showAllStations,
}: {
  tenantSlug: string;
  ticket: KitchenTicket;
  canAdvance: boolean;
  showAllStations: boolean;
}) {
  // An absolute time, not "N minutes ago": a relative label would need
  // `Date.now()` read during render, which React's purity rule (this is a
  // client component tree) forbids - components must not depend on a clock
  // ticking outside of props/state. The board already refreshes on every
  // relevant Realtime event (ADR-020), so a card's own staleness is never
  // more than one refetch behind regardless.
  const placedAtLabel = new Date(ticket.placedAt).toLocaleTimeString("es-PE", {
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle as="h3" className="text-base">
          #{ticket.number}
        </CardTitle>
        <span className="text-muted-foreground text-xs">{placedAtLabel}</span>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-muted-foreground text-xs">
          {ORDER_SOURCE_LABELS[ticket.source]}
          {ticket.locationName !== null ? ` · ${ticket.locationName}` : ""}
          {ticket.customerName !== null ? ` · ${ticket.customerName}` : ""}
        </p>

        <ul className="flex flex-col gap-1 text-sm">
          {ticket.items.map((item) => (
            <li key={item.id} className="flex items-start justify-between gap-2">
              <span>
                <span className="font-medium">{item.quantity}×</span> {item.name}
                {item.variantName !== null ? (
                  <span className="text-muted-foreground"> ({item.variantName})</span>
                ) : null}
                {item.notes !== null ? (
                  <span className="text-muted-foreground block text-xs">{item.notes}</span>
                ) : null}
              </span>
              {showAllStations ? (
                <Badge variant="neutral">{KITCHEN_STATION_LABELS[item.station]}</Badge>
              ) : null}
            </li>
          ))}
        </ul>

        {canAdvance ? (
          <AdvanceOrderForm tenantSlug={tenantSlug} orderId={ticket.id} status={ticket.status} />
        ) : null}
      </CardContent>
    </Card>
  );
}
