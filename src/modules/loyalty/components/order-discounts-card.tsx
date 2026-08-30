import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui";
import { formatCurrency } from "@/lib/money";
import type { LoyaltyProgramme } from "../points";
import type { AppliedDiscount, LoyaltyAccountSummary } from "../server/queries";
import {
  ApplyCouponForm,
  ApplyPromotionForm,
  type PromotionOption,
  RedeemPointsForm,
  RemoveDiscountForm,
} from "./loyalty-forms";

const SOURCE_LABELS = {
  promotion: "Promocion",
  coupon: "Cupon",
  loyalty: "Puntos",
} as const;

/**
 * The discounts on one order, on the order's own page.
 *
 * This is where a discount is applied, because applying one is only possible
 * while the order is still `pending` - and that is a fact about the order, not
 * about the promotions screen, which is where the rules are configured.
 */
export function OrderDiscountsCard({
  tenantSlug,
  orderId,
  orderStatus,
  discounts,
  promotions,
  account,
  programme,
  maxRedeemablePoints,
  currency,
  canManagePromotions,
  canManageLoyalty,
}: {
  tenantSlug: string;
  orderId: string;
  orderStatus: string;
  discounts: readonly AppliedDiscount[];
  promotions: readonly PromotionOption[];
  account: LoyaltyAccountSummary | null;
  programme: LoyaltyProgramme;
  maxRedeemablePoints: number;
  currency: string;
  canManagePromotions: boolean;
  canManageLoyalty: boolean;
}) {
  const isDraft = orderStatus === "pending";
  const total = discounts.reduce((sum, discount) => sum + discount.discountCents, 0);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle as="h2">Descuentos</CardTitle>
            <CardDescription>
              {discounts.length === 0
                ? isDraft
                  ? "Aplica una promocion, un cupon o los puntos del cliente."
                  : "Este pedido no lleva descuentos."
                : `${discounts.length} descuento(s) por ${formatCurrency(total, currency)}.`}
            </CardDescription>
          </div>
          {total > 0 ? <Badge variant="success">-{formatCurrency(total, currency)}</Badge> : null}
        </div>
      </CardHeader>

      <CardContent className="flex flex-col gap-6">
        {discounts.length > 0 ? (
          <table className="w-full min-w-[24rem] border-collapse text-sm">
            <caption className="sr-only">Descuentos aplicados a este pedido</caption>
            <thead>
              <tr className="border-border text-muted-foreground border-b text-left text-xs">
                <th scope="col" className="px-2 py-2 font-medium">
                  Origen
                </th>
                <th scope="col" className="px-2 py-2 font-medium">
                  Concepto
                </th>
                <th scope="col" className="px-2 py-2 font-medium">
                  Importe
                </th>
                {isDraft && canManagePromotions ? (
                  <th scope="col" className="px-2 py-2 font-medium">
                    Accion
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {discounts.map((discount) => (
                <tr key={discount.id} className="border-border/60 border-b last:border-0">
                  <td className="px-2 py-2">{SOURCE_LABELS[discount.source]}</td>
                  <td className="px-2 py-2">{discount.label}</td>
                  <td className="px-2 py-2 tabular-nums">
                    -{formatCurrency(discount.discountCents, currency)}
                  </td>
                  {isDraft && canManagePromotions ? (
                    <td className="px-2 py-2">
                      <RemoveDiscountForm tenantSlug={tenantSlug} orderPromotionId={discount.id} />
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}

        {/*
         * Everything below only exists while the order is a draft - the same
         * rule the trigger enforces. Hiding it afterwards means no button is
         * there to be pressed into an error message.
         */}
        {isDraft && canManagePromotions ? (
          <div className="flex flex-col gap-4">
            <ApplyPromotionForm tenantSlug={tenantSlug} orderId={orderId} promotions={promotions} />
            <ApplyCouponForm tenantSlug={tenantSlug} orderId={orderId} />
          </div>
        ) : null}

        {isDraft && canManageLoyalty && account !== null && programme.enabled ? (
          <div className="border-border/60 border-t pt-4">
            <h3 className="mb-3 text-sm font-medium">Puntos de {account.customerName}</h3>
            <RedeemPointsForm
              tenantSlug={tenantSlug}
              orderId={orderId}
              accountId={account.id}
              balance={account.pointsBalance}
              maxPoints={maxRedeemablePoints}
              pointValueCents={programme.pointValueCents}
            />
          </div>
        ) : null}

        {!isDraft && discounts.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            Solo se pueden aplicar descuentos mientras el pedido esta pendiente.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
