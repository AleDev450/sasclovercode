import Link from "next/link";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui";
import { formatCurrency } from "@/lib/money";
import type { DeliveryStatus } from "@/types/database";
import { DELIVERY_STATUS_LABELS } from "../lifecycle";
import type { DeliverySummary } from "../server/queries";
import {
  AdvanceDeliveryForm,
  AssignCourierForm,
  CloseDeliveryForm,
  type CourierOption,
} from "./delivery-forms";

const STATUS_VARIANT: Readonly<
  Record<DeliveryStatus, "neutral" | "success" | "warning" | "destructive">
> = {
  pending: "neutral",
  assigned: "warning",
  in_transit: "warning",
  delivered: "success",
  failed: "destructive",
  cancelled: "neutral",
};

export function DeliveryStatusBadge({ status }: { status: DeliveryStatus }) {
  return <Badge variant={STATUS_VARIANT[status]}>{DELIVERY_STATUS_LABELS[status]}</Badge>;
}

/**
 * One section of the board.
 *
 * A server component: it renders rows and delegates every write to the small
 * client forms. Nothing here decides whether an action is allowed - the page
 * passes `canManage`, and the server action checks the permission again anyway
 * (master section 45).
 */
export function DeliveryTable({
  tenantSlug,
  deliveries,
  couriers,
  currency,
  canManage,
  title,
  description,
  showActions,
}: {
  tenantSlug: string;
  deliveries: readonly DeliverySummary[];
  couriers: readonly CourierOption[];
  currency: string;
  canManage: boolean;
  title: string;
  description: string;
  showActions: boolean;
}) {
  const courierName = (userId: string | null): string =>
    userId === null
      ? "Sin asignar"
      : (couriers.find((courier) => courier.userId === userId)?.label ?? "Miembro retirado");

  return (
    <Card className="overflow-x-auto">
      <CardHeader>
        <CardTitle as="h2">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <table className="w-full min-w-[52rem] border-collapse text-sm">
          <caption className="sr-only">{title}</caption>
          <thead>
            <tr className="border-border text-muted-foreground border-b text-left text-xs">
              <th scope="col" className="px-2 py-2 font-medium">
                Pedido
              </th>
              <th scope="col" className="px-2 py-2 font-medium">
                Zona
              </th>
              <th scope="col" className="px-2 py-2 font-medium">
                Direccion
              </th>
              <th scope="col" className="px-2 py-2 font-medium">
                Envio
              </th>
              <th scope="col" className="px-2 py-2 font-medium">
                Estado
              </th>
              <th scope="col" className="px-2 py-2 font-medium">
                Repartidor
              </th>
              {showActions && canManage ? (
                <th scope="col" className="px-2 py-2 font-medium">
                  Acciones
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {deliveries.map((delivery) => (
              <tr key={delivery.id} className="border-border/60 border-b align-top last:border-0">
                <td className="px-2 py-3 font-medium">
                  <Link
                    href={`/dashboard/${tenantSlug}/pedidos/${delivery.orderId}`}
                    className="hover:underline"
                  >
                    #{delivery.orderNumber}
                  </Link>
                </td>
                <td className="px-2 py-3">{delivery.zoneName}</td>
                <td className="px-2 py-3">
                  <span className="block">{delivery.addressLine}</span>
                  {delivery.district !== null ? (
                    <span className="text-muted-foreground block text-xs">{delivery.district}</span>
                  ) : null}
                  {delivery.reference !== null ? (
                    <span className="text-muted-foreground block text-xs">
                      {delivery.reference}
                    </span>
                  ) : null}
                  {delivery.recipientPhone !== null ? (
                    <span className="text-muted-foreground block text-xs">
                      {delivery.recipientName ?? "Recibe"} · {delivery.recipientPhone}
                    </span>
                  ) : null}
                </td>
                <td className="px-2 py-3 tabular-nums">
                  {formatCurrency(delivery.feeCents, currency)}
                </td>
                <td className="px-2 py-3">
                  <DeliveryStatusBadge status={delivery.status} />
                  {delivery.failureReason !== null ? (
                    <span className="text-muted-foreground mt-1 block text-xs">
                      {delivery.failureReason}
                    </span>
                  ) : null}
                </td>
                <td className="px-2 py-3">
                  {showActions && canManage ? (
                    <AssignCourierForm
                      tenantSlug={tenantSlug}
                      deliveryId={delivery.id}
                      couriers={couriers}
                      currentCourierId={delivery.courierUserId}
                    />
                  ) : (
                    courierName(delivery.courierUserId)
                  )}
                </td>
                {showActions && canManage ? (
                  <td className="px-2 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <AdvanceDeliveryForm
                        tenantSlug={tenantSlug}
                        deliveryId={delivery.id}
                        status={delivery.status}
                      />
                      {delivery.status === "in_transit" ? (
                        <CloseDeliveryForm
                          tenantSlug={tenantSlug}
                          deliveryId={delivery.id}
                          status="failed"
                        />
                      ) : null}
                      <CloseDeliveryForm
                        tenantSlug={tenantSlug}
                        deliveryId={delivery.id}
                        status="cancelled"
                      />
                    </div>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}
