import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui";
import { formatCurrency } from "@/lib/money";
import { PERMISSIONS } from "@/lib/permissions";
import { hasPermission } from "@/lib/permissions/check";
import { MODULES } from "@/lib/features";
import { hasFeature } from "@/lib/features/check";
import { requireActiveTenant } from "@/lib/tenant/active";
import {
  AdvanceOrderForm,
  CancelOrderForm,
} from "@/modules/orders/components/order-status-actions";
import { ORDER_SOURCE_LABELS, ORDER_STATUS_LABELS } from "@/modules/orders/lifecycle";
import { getOrderDetail } from "@/modules/orders/server/queries";
import { PaymentBalance, PaymentsList } from "@/modules/payments/components/payments-list";
import { RecordPaymentForm } from "@/modules/payments/components/record-payment-form";
import { listOpenSessionsForLocation, listPaymentMethods } from "@/modules/payments/server/queries";
import { PrintButton } from "@/modules/pos/components/print-button";
import { Receipt } from "@/modules/pos/components/receipt";
import { getBusinessSettings } from "@/modules/settings/server/queries";
import { BillingDocumentsList } from "@/modules/billing/components/billing-documents-list";
import {
  IssueBillingDocumentForm,
  type RelatableDocument,
} from "@/modules/billing/components/issue-billing-document-form";
import { BILLING_DOCUMENT_TYPE_LABELS } from "@/modules/billing/lifecycle";
import { listBillingDocumentsForOrder } from "@/modules/billing/server/queries";
import { OrderDeliveryCard } from "@/modules/delivery/components/order-delivery-card";
import {
  getOrderDelivery,
  listCouriers,
  listDeliveryZones,
} from "@/modules/delivery/server/queries";
import { getCustomerDetail } from "@/modules/customers/server/queries";
import { OrderDiscountsCard } from "@/modules/loyalty/components/order-discounts-card";
import type { PromotionOption } from "@/modules/loyalty/components/loyalty-forms";
import { maxRedeemablePoints } from "@/modules/loyalty/points";
import {
  discountFor,
  ineligibilityReason,
  INELIGIBILITY_LABELS,
} from "@/modules/loyalty/promotions";
import {
  getAccountForCustomer,
  getLoyaltyProgramme,
  listOrderDiscounts,
  listPromotions,
} from "@/modules/loyalty/server/queries";

export const metadata = { title: "Pedido" };

export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ tenantSlug: string; orderId: string }>;
}) {
  const { tenantSlug, orderId } = await params;
  const tenant = await requireActiveTenant(tenantSlug);

  // Phase 21: the plan decides before the person does. 404, not 403 - the
  // same posture every permission guard here takes toward a section that is
  // not yours to know about.
  if (!(await hasFeature(tenant.id, MODULES.ORDERS))) {
    notFound();
  }

  if (!(await hasPermission(tenant.id, PERMISSIONS.ORDERS_VIEW))) {
    notFound();
  }

  const [
    order,
    settings,
    canUpdate,
    canCancel,
    canViewPayments,
    canCreatePayment,
    canVoidPayment,
    canViewBilling,
    canCreateBilling,
    canCancelBilling,
    canViewDelivery,
    canManageDelivery,
    canViewPromotions,
    canManagePromotions,
    canViewLoyalty,
    canManageLoyalty,
  ] = await Promise.all([
    getOrderDetail(tenant.id, orderId),
    getBusinessSettings(tenant.id),
    hasPermission(tenant.id, PERMISSIONS.ORDERS_UPDATE),
    hasPermission(tenant.id, PERMISSIONS.ORDERS_CANCEL),
    hasPermission(tenant.id, PERMISSIONS.PAYMENTS_VIEW),
    hasPermission(tenant.id, PERMISSIONS.PAYMENTS_CREATE),
    hasPermission(tenant.id, PERMISSIONS.PAYMENTS_VOID),
    hasPermission(tenant.id, PERMISSIONS.BILLING_VIEW),
    hasPermission(tenant.id, PERMISSIONS.BILLING_CREATE),
    hasPermission(tenant.id, PERMISSIONS.BILLING_CANCEL),
    hasPermission(tenant.id, PERMISSIONS.DELIVERIES_VIEW),
    hasPermission(tenant.id, PERMISSIONS.DELIVERIES_MANAGE),
    hasPermission(tenant.id, PERMISSIONS.PROMOTIONS_VIEW),
    hasPermission(tenant.id, PERMISSIONS.PROMOTIONS_MANAGE),
    hasPermission(tenant.id, PERMISSIONS.LOYALTY_VIEW),
    hasPermission(tenant.id, PERMISSIONS.LOYALTY_MANAGE),
  ]);

  // An order that does not exist and one belonging to another business give the
  // same answer, for the reason Phase 12 gave: telling them apart lets someone
  // discover which ids exist elsewhere.
  if (order === null) notFound();

  const [methods, openSessions] = canCreatePayment
    ? await Promise.all([
        listPaymentMethods(tenant.id, { activeOnly: true }),
        listOpenSessionsForLocation(tenant.id, order.locationId),
      ])
    : [[], []];

  // Only what this viewer may see, and only what the card will actually use:
  // the zone list and the address book are for attaching, which needs
  // `deliveries.manage` and an order still in draft.
  const [delivery, deliveryZones, couriers] = canViewDelivery
    ? await Promise.all([
        getOrderDelivery(tenant.id, order.id),
        canManageDelivery
          ? listDeliveryZones(tenant.id, { activeOnly: true })
          : Promise.resolve([]),
        canManageDelivery ? listCouriers(tenant.id) : Promise.resolve([]),
      ])
    : [null, [], []];

  // The customer's saved addresses, so attaching can copy one instead of
  // asking for a house the business already knows.
  const customerAddresses =
    canManageDelivery &&
    delivery === null &&
    order.status === "pending" &&
    order.customerId !== null
      ? ((await getCustomerDetail(tenant.id, order.customerId))?.addresses ?? [])
      : [];

  const billingDocuments = canViewBilling
    ? await listBillingDocumentsForOrder(tenant.id, order.id)
    : [];
  const relatableDocuments: readonly RelatableDocument[] = billingDocuments
    .filter((doc) => doc.type === "boleta" || doc.type === "factura")
    .map((doc) => ({
      id: doc.id,
      label: `${BILLING_DOCUMENT_TYPE_LABELS[doc.type]} ${doc.series}-${String(doc.number).padStart(6, "0")}`,
    }));

  const money = (cents: number): string => formatCurrency(cents, settings.currency);

  // The discount side. `promotions` and the account are only needed to APPLY
  // something, which takes `.manage` and a draft order - so a viewer pays for
  // the list of postings and nothing else.
  const orderDiscounts =
    canViewPromotions || canViewLoyalty ? await listOrderDiscounts(tenant.id, order.id) : [];

  const canApplyNow = canManagePromotions && order.status === "pending";

  const [applicablePromotions, programme, loyaltyAccount] = await Promise.all([
    canApplyNow ? listPromotions(tenant.id, { activeOnly: true }) : Promise.resolve([]),
    canViewLoyalty ? getLoyaltyProgramme(tenant.id) : Promise.resolve(null),
    canManageLoyalty && order.customerId !== null
      ? getAccountForCustomer(tenant.id, order.customerId)
      : Promise.resolve(null),
  ]);

  // What a discount is measured against: the goods, plus the shipping that
  // `free_delivery` targets. The same two numbers `guard_order_promotion()`
  // uses, so the preview and the refusal cannot disagree.
  const discountBasis = {
    goodsCents: order.lines.reduce((sum, line) => sum + line.totalCents, 0),
    shippingCents: delivery?.feeCents ?? 0,
  };

  const promotionOptions: readonly PromotionOption[] = applicablePromotions.map((promotion) => {
    const reason = ineligibilityReason(promotion, discountBasis);
    return {
      id: promotion.id,
      label: `${promotion.name} · -${money(discountFor(promotion, discountBasis))}`,
      blockedReason: reason === null ? null : INELIGIBILITY_LABELS[reason],
    };
  });

  // Bounded by the balance, by what is still owed and by whole points, so the
  // form cannot offer a number the RPC will refuse.
  const alreadyDiscounted = orderDiscounts.reduce((sum, row) => sum + row.discountCents, 0);
  const redeemablePoints =
    programme === null || loyaltyAccount === null
      ? 0
      : maxRedeemablePoints(programme, {
          balance: loyaltyAccount.pointsBalance,
          payableCents: discountBasis.goodsCents + discountBasis.shippingCents - alreadyDiscounted,
        });

  // Only the receipt itself is meant to come out of "Imprimir" - everything
  // else on this page (nav, forms, history) is print:hidden so a reprint
  // from here is the same ticket a POS checkout produces (Phase 15), not a
  // screenshot of the dashboard.
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-6 print:hidden">
        <div className="flex flex-col gap-2">
          <Link
            href={`/dashboard/${tenant.slug}/pedidos`}
            className="text-muted-foreground text-sm hover:underline"
          >
            ← Pedidos
          </Link>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">Pedido #{order.number}</h1>
            <Badge variant={order.status === "cancelled" ? "neutral" : "success"}>
              {ORDER_STATUS_LABELS[order.status]}
            </Badge>
            <span className="text-muted-foreground text-sm">
              {ORDER_SOURCE_LABELS[order.source]} · {order.locationName ?? "—"}
            </span>
          </div>
          {order.cancelReason !== null ? (
            <p className="text-muted-foreground text-sm">Anulado: {order.cancelReason}</p>
          ) : null}
        </div>

        <Card className="overflow-x-auto">
          <CardHeader>
            <CardTitle as="h2">Detalle</CardTitle>
            <CardDescription>
              Estos importes son los del momento de la venta. No cambian aunque cambie el catalogo.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <table className="w-full min-w-[36rem] border-collapse text-sm">
              <caption className="sr-only">Lineas del pedido #{order.number}</caption>
              <thead>
                <tr className="border-border text-muted-foreground border-b text-left text-xs">
                  <th scope="col" className="py-2 font-medium">
                    Producto
                  </th>
                  <th scope="col" className="py-2 text-right font-medium">
                    Cantidad
                  </th>
                  <th scope="col" className="py-2 text-right font-medium">
                    Precio
                  </th>
                  <th scope="col" className="py-2 text-right font-medium">
                    Descuento
                  </th>
                  <th scope="col" className="py-2 text-right font-medium">
                    Total
                  </th>
                </tr>
              </thead>
              <tbody>
                {order.lines.map((line) => (
                  <tr key={line.id} className="border-border border-b last:border-0">
                    <td className="py-2">
                      {line.name}
                      {line.variantName !== null ? (
                        <span className="text-muted-foreground"> · {line.variantName}</span>
                      ) : null}
                    </td>
                    <td className="py-2 text-right tabular-nums">{line.quantity}</td>
                    <td className="py-2 text-right tabular-nums">{money(line.unitPriceCents)}</td>
                    <td className="py-2 text-right tabular-nums">
                      {line.discountCents > 0 ? `- ${money(line.discountCents)}` : "—"}
                    </td>
                    <td className="py-2 text-right tabular-nums">{money(line.totalCents)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={4} className="py-2 text-right">
                    Subtotal
                  </td>
                  <td className="py-2 text-right tabular-nums">{money(order.subtotalCents)}</td>
                </tr>
                {order.discountCents > 0 ? (
                  <tr>
                    <td colSpan={4} className="py-2 text-right">
                      Descuentos
                    </td>
                    <td className="py-2 text-right tabular-nums">- {money(order.discountCents)}</td>
                  </tr>
                ) : null}
                {order.shippingCents > 0 ? (
                  <tr>
                    <td colSpan={4} className="py-2 text-right">
                      Envio
                    </td>
                    <td className="py-2 text-right tabular-nums">{money(order.shippingCents)}</td>
                  </tr>
                ) : null}
                <tr className="font-medium">
                  <td colSpan={4} className="py-2 text-right">
                    Total
                  </td>
                  <td className="py-2 text-right tabular-nums">{money(order.totalCents)}</td>
                </tr>
              </tfoot>
            </table>
          </CardContent>
        </Card>

        {canViewPayments ? (
          <Card>
            <CardHeader>
              <CardTitle as="h2">Pagos</CardTitle>
              <PaymentBalance
                totalCents={order.totalCents}
                paidCents={order.paidCents}
                balanceCents={order.balanceCents}
                currency={settings.currency}
              />
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              <PaymentsList
                tenantSlug={tenant.slug}
                orderId={order.id}
                payments={order.payments}
                currency={settings.currency}
                canVoid={canVoidPayment}
              />
              {canCreatePayment && order.status !== "cancelled" && order.balanceCents > 0 ? (
                <RecordPaymentForm
                  tenantSlug={tenant.slug}
                  orderId={order.id}
                  balanceCents={order.balanceCents}
                  methods={methods}
                  openSessions={openSessions}
                />
              ) : null}
            </CardContent>
          </Card>
        ) : null}

        {canViewBilling ? (
          <Card>
            <CardHeader>
              <CardTitle as="h2">Comprobante</CardTitle>
              <CardDescription>
                Boletas, facturas y notas emitidas para este pedido.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              <BillingDocumentsList
                tenantSlug={tenant.slug}
                orderId={order.id}
                documents={billingDocuments}
                currency={settings.currency}
                canCreate={canCreateBilling}
                canCancel={canCancelBilling}
              />
              {canCreateBilling && order.status !== "cancelled" ? (
                <IssueBillingDocumentForm
                  tenantSlug={tenant.slug}
                  orderId={order.id}
                  initialCustomer={
                    order.customerId !== null && order.customerName !== null
                      ? { id: order.customerId, name: order.customerName }
                      : null
                  }
                  relatableDocuments={relatableDocuments}
                />
              ) : null}
            </CardContent>
          </Card>
        ) : null}

        {canViewPromotions || canViewLoyalty ? (
          <OrderDiscountsCard
            tenantSlug={tenant.slug}
            orderId={order.id}
            orderStatus={order.status}
            discounts={orderDiscounts}
            promotions={promotionOptions}
            account={loyaltyAccount}
            programme={programme ?? { enabled: false, pointsPerSol: 0, pointValueCents: 10 }}
            maxRedeemablePoints={redeemablePoints}
            currency={settings.currency}
            canManagePromotions={canManagePromotions}
            canManageLoyalty={canManageLoyalty}
          />
        ) : null}

        {canViewDelivery ? (
          <OrderDeliveryCard
            tenantSlug={tenant.slug}
            orderId={order.id}
            orderStatus={order.status}
            delivery={delivery}
            zones={deliveryZones.map((zone) => ({ id: zone.id, name: zone.name }))}
            addresses={customerAddresses.map((address) => ({
              id: address.id,
              label: address.label,
              addressLine: address.addressLine,
              district: address.district,
              city: address.city,
              reference: address.reference,
              latitude: address.latitude,
              longitude: address.longitude,
            }))}
            couriers={couriers.map((courier) => ({
              userId: courier.userId,
              label: courier.fullName ?? courier.email,
            }))}
            currency={settings.currency}
            canManage={canManageDelivery}
          />
        ) : null}

        {canUpdate || canCancel ? (
          <div className="grid gap-6 sm:grid-cols-2">
            {canUpdate ? (
              <Card>
                <CardHeader>
                  <CardTitle as="h2">Avanzar</CardTitle>
                  <CardDescription>
                    Un pedido avanza paso a paso. No se puede saltar ni volver atras.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <AdvanceOrderForm
                    tenantSlug={tenant.slug}
                    orderId={order.id}
                    status={order.status}
                  />
                </CardContent>
              </Card>
            ) : null}

            {canCancel ? (
              <Card>
                <CardHeader>
                  <CardTitle as="h2">Anular</CardTitle>
                  <CardDescription>Requiere un motivo y no se puede deshacer.</CardDescription>
                </CardHeader>
                <CardContent>
                  <CancelOrderForm
                    tenantSlug={tenant.slug}
                    orderId={order.id}
                    status={order.status}
                  />
                </CardContent>
              </Card>
            ) : null}
          </div>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle as="h2">Historial</CardTitle>
            <CardDescription>
              Lo escribe la base de datos en cada cambio. No se puede editar.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ol className="flex flex-col gap-3">
              {order.history.map((entry) => (
                <li key={entry.id} className="flex flex-wrap items-baseline gap-2 text-sm">
                  <span className="text-muted-foreground tabular-nums">
                    {new Date(entry.createdAt).toLocaleString("es-PE")}
                  </span>
                  <span>
                    {entry.fromStatus === null
                      ? "Creado"
                      : `${ORDER_STATUS_LABELS[entry.fromStatus]} → ${ORDER_STATUS_LABELS[entry.toStatus]}`}
                  </span>
                  {entry.reason !== null ? (
                    <span className="text-muted-foreground">· {entry.reason}</span>
                  ) : null}
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 print:hidden">
          <CardTitle as="h2">Recibo</CardTitle>
          <PrintButton />
        </CardHeader>
        <CardContent>
          <Receipt
            orderNumber={order.number}
            locationName={order.locationName ?? "—"}
            customerName={order.customerName}
            lines={order.lines.map((line) => ({
              name: line.name,
              variantName: line.variantName,
              quantity: line.quantity,
              unitPriceCents: line.unitPriceCents,
              totalCents: line.totalCents,
            }))}
            totalCents={order.totalCents}
            currency={settings.currency}
            placedAt={order.placedAt}
            payments={order.payments
              .filter((payment) => payment.voidedAt === null)
              .map((payment) => ({
                methodName: payment.methodName,
                amountCents: payment.amountCents,
              }))}
          />
        </CardContent>
      </Card>
    </div>
  );
}
