import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui";
import { formatCurrency } from "@/lib/money";
import { DELIVERY_STATUS_LABELS } from "../lifecycle";
import type { DeliveryDetail } from "../server/queries";
import { DeliveryStatusBadge } from "./delivery-board";
import {
  AdvanceDeliveryForm,
  AssignCourierForm,
  AttachDeliveryForm,
  CloseDeliveryForm,
  type AddressOption,
  type CourierOption,
  DetachDeliveryForm,
  UpdateDeliveryAddressForm,
  UpdateDeliveryFeeForm,
  type ZoneOption,
} from "./delivery-forms";

/**
 * The delivery of one order, on the order's own page.
 *
 * This is where a delivery is BORN, because attaching one is only possible
 * while the order is still `pending` (ADR-023 decision 3) - and that is a fact
 * about the order, not about the board. The board is where it is then worked.
 */
export function OrderDeliveryCard({
  tenantSlug,
  orderId,
  orderStatus,
  delivery,
  zones,
  addresses,
  couriers,
  currency,
  canManage,
}: {
  tenantSlug: string;
  orderId: string;
  orderStatus: string;
  delivery: DeliveryDetail | null;
  zones: readonly ZoneOption[];
  addresses: readonly AddressOption[];
  couriers: readonly CourierOption[];
  currency: string;
  canManage: boolean;
}) {
  const isDraft = orderStatus === "pending";

  if (delivery === null) {
    return (
      <Card>
        <CardHeader>
          <CardTitle as="h2">Entrega</CardTitle>
          <CardDescription>
            {isDraft
              ? "Adjunta una entrega para cobrar el envio en este pedido."
              : "Este pedido no tiene entrega."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {canManage && isDraft ? (
            <AttachDeliveryForm
              tenantSlug={tenantSlug}
              orderId={orderId}
              zones={zones}
              addresses={addresses}
            />
          ) : (
            <p className="text-muted-foreground text-sm">
              {isDraft
                ? "No tienes permiso para adjuntar una entrega."
                : "Solo se puede adjuntar una entrega mientras el pedido esta pendiente."}
            </p>
          )}
        </CardContent>
      </Card>
    );
  }

  const courierLabel =
    delivery.courierUserId === null
      ? "Sin asignar"
      : (couriers.find((courier) => courier.userId === delivery.courierUserId)?.label ??
        "Miembro retirado");

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle as="h2">Entrega</CardTitle>
            <CardDescription>
              {delivery.zoneName} · {formatCurrency(delivery.feeCents, currency)} · {courierLabel}
            </CardDescription>
          </div>
          <DeliveryStatusBadge status={delivery.status} />
        </div>
      </CardHeader>

      <CardContent className="flex flex-col gap-6">
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground text-xs">Direccion</dt>
            <dd>{delivery.addressLine}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-xs">Distrito / ciudad</dt>
            <dd>{[delivery.district, delivery.city].filter(Boolean).join(", ") || "—"}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-xs">Referencia</dt>
            <dd>{delivery.reference ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-xs">Coordenadas</dt>
            <dd className="tabular-nums">
              {delivery.latitude === null || delivery.longitude === null
                ? "—"
                : `${delivery.latitude}, ${delivery.longitude}`}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-xs">Recibe</dt>
            <dd>
              {delivery.recipientName ?? "—"}
              {delivery.recipientPhone === null ? "" : ` · ${delivery.recipientPhone}`}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-xs">Notas</dt>
            <dd>{delivery.notes ?? "—"}</dd>
          </div>
        </dl>

        {canManage ? (
          <div className="flex flex-wrap items-center gap-3">
            <AssignCourierForm
              tenantSlug={tenantSlug}
              deliveryId={delivery.id}
              couriers={couriers}
              currentCourierId={delivery.courierUserId}
            />
            <AdvanceDeliveryForm
              tenantSlug={tenantSlug}
              deliveryId={delivery.id}
              status={delivery.status}
            />
            {delivery.status === "in_transit" ? (
              <CloseDeliveryForm tenantSlug={tenantSlug} deliveryId={delivery.id} status="failed" />
            ) : null}
            {delivery.status !== "delivered" && delivery.status !== "cancelled" ? (
              <CloseDeliveryForm
                tenantSlug={tenantSlug}
                deliveryId={delivery.id}
                status="cancelled"
              />
            ) : null}
            {isDraft ? (
              <DetachDeliveryForm tenantSlug={tenantSlug} deliveryId={delivery.id} />
            ) : null}
          </div>
        ) : null}

        {/*
         * The fee is editable only while the order is a draft - the same rule
         * the trigger enforces. Hiding it afterwards means the button is not
         * there to be pressed into an error message.
         */}
        {canManage && isDraft ? (
          <UpdateDeliveryFeeForm
            tenantSlug={tenantSlug}
            deliveryId={delivery.id}
            feeCents={delivery.feeCents}
          />
        ) : null}

        {canManage && delivery.status !== "delivered" && delivery.status !== "cancelled" ? (
          <details className="text-sm">
            <summary className="cursor-pointer font-medium">Corregir la direccion</summary>
            <div className="pt-4">
              <UpdateDeliveryAddressForm tenantSlug={tenantSlug} delivery={delivery} />
            </div>
          </details>
        ) : null}

        <div>
          <h3 className="mb-2 text-sm font-medium">Historial</h3>
          <ol className="flex flex-col gap-1 text-sm">
            {delivery.history.map((entry) => (
              <li key={entry.id} className="flex flex-wrap gap-2">
                <span className="text-muted-foreground tabular-nums">
                  {new Date(entry.createdAt).toLocaleString("es-PE")}
                </span>
                <span>
                  {entry.fromStatus === null
                    ? `Creada como ${DELIVERY_STATUS_LABELS[entry.toStatus].toLowerCase()}`
                    : `${DELIVERY_STATUS_LABELS[entry.fromStatus]} → ${DELIVERY_STATUS_LABELS[entry.toStatus]}`}
                </span>
                {entry.reason !== null ? (
                  <span className="text-muted-foreground">· {entry.reason}</span>
                ) : null}
              </li>
            ))}
          </ol>
        </div>
      </CardContent>
    </Card>
  );
}
