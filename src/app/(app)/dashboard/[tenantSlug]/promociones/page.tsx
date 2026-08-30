import { notFound } from "next/navigation";
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
} from "@/components/ui";
import { formatCurrency } from "@/lib/money";
import { PERMISSIONS } from "@/lib/permissions";
import { hasPermission } from "@/lib/permissions/check";
import { MODULES } from "@/lib/features";
import { hasFeature } from "@/lib/features/check";
import { requireActiveTenant } from "@/lib/tenant/active";
import {
  CreateCouponForm,
  CreatePromotionForm,
  DeleteCouponForm,
  DeletePromotionForm,
  SetCouponActiveForm,
  SetPromotionActiveForm,
  UpdatePromotionForm,
} from "@/modules/loyalty/components/promotion-forms";
import { PROMOTION_TYPE_LABELS } from "@/modules/loyalty/promotions";
import { listCoupons, listPromotions } from "@/modules/loyalty/server/queries";
import { getBusinessSettings } from "@/modules/settings/server/queries";

export const metadata = { title: "Promociones" };

function windowLabel(startsAt: string | null, endsAt: string | null): string {
  if (startsAt === null && endsAt === null) return "Siempre vigente";
  const from = startsAt === null ? "—" : new Date(startsAt).toLocaleDateString("es-PE");
  const to = endsAt === null ? "—" : new Date(endsAt).toLocaleDateString("es-PE");
  return `${from} → ${to}`;
}

export default async function PromotionsPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  const tenant = await requireActiveTenant(tenantSlug);

  // Phase 21: the plan decides before the person does. 404, not 403 - the
  // same posture every permission guard here takes toward a section that is
  // not yours to know about.
  if (!(await hasFeature(tenant.id, MODULES.LOYALTY))) {
    notFound();
  }

  // The nav hides this without the permission, but hiding is cosmetic (§45).
  // A typed URL lands here, so the page checks too - and answers 404, not 403,
  // to avoid confirming the section exists.
  if (!(await hasPermission(tenant.id, PERMISSIONS.PROMOTIONS_VIEW))) {
    notFound();
  }

  const canManage = await hasPermission(tenant.id, PERMISSIONS.PROMOTIONS_MANAGE);

  const [promotions, coupons, settings] = await Promise.all([
    listPromotions(tenant.id),
    listCoupons(tenant.id),
    getBusinessSettings(tenant.id),
  ]);

  const money = (cents: number): string => formatCurrency(cents, settings.currency);

  function valueLabel(promotion: (typeof promotions)[number]): string {
    switch (promotion.type) {
      case "percentage":
        return `${promotion.percentOff ?? 0}%`;
      case "fixed_amount":
        return money(promotion.amountOffCents ?? 0);
      case "free_delivery":
        return "Envio";
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Promociones</h1>
        <p className="text-muted-foreground text-sm">
          Los descuentos que {tenant.name} ofrece, y los codigos que los abren.
        </p>
      </div>

      {canManage ? (
        <Card>
          <CardHeader>
            <CardTitle as="h2">Nueva promocion</CardTitle>
            <CardDescription>
              Un descuento con sus condiciones: cuanto, desde que pedido y entre que fechas.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CreatePromotionForm tenantSlug={tenant.slug} />
          </CardContent>
        </Card>
      ) : null}

      {promotions.length === 0 ? (
        <EmptyState
          title="Aun no tienes promociones"
          description="Crea tu primera promocion para poder aplicar descuentos a los pedidos y emitir cupones."
        />
      ) : (
        promotions.map((promotion) => {
          const promotionCoupons = coupons.filter((coupon) => coupon.promotionId === promotion.id);

          return (
            <Card key={promotion.id}>
              <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <CardTitle as="h2">
                      {promotion.name}{" "}
                      {promotion.isActive ? null : <Badge variant="neutral">Inactiva</Badge>}
                    </CardTitle>
                    <CardDescription>
                      {PROMOTION_TYPE_LABELS[promotion.type]} · {valueLabel(promotion)}
                      {promotion.minOrderCents > 0
                        ? ` · desde ${money(promotion.minOrderCents)}`
                        : ""}
                      {" · "}
                      {windowLabel(promotion.startsAt, promotion.endsAt)}
                      {" · "}
                      {promotion.timesRedeemed}
                      {promotion.maxRedemptions === null
                        ? " canjes"
                        : ` / ${promotion.maxRedemptions} canjes`}
                    </CardDescription>
                  </div>
                  {canManage ? (
                    <div className="flex items-center gap-1">
                      <SetPromotionActiveForm
                        tenantSlug={tenant.slug}
                        promotionId={promotion.id}
                        isActive={promotion.isActive}
                      />
                      <DeletePromotionForm
                        tenantSlug={tenant.slug}
                        promotionId={promotion.id}
                        promotionName={promotion.name}
                      />
                    </div>
                  ) : null}
                </div>
              </CardHeader>

              <CardContent className="flex flex-col gap-6">
                {canManage ? (
                  <details className="text-sm">
                    <summary className="cursor-pointer font-medium">Editar promocion</summary>
                    <div className="pt-4">
                      <UpdatePromotionForm tenantSlug={tenant.slug} promotion={promotion} />
                    </div>
                  </details>
                ) : null}

                <div className="flex flex-col gap-4">
                  <h3 className="text-sm font-medium">Cupones</h3>

                  {promotionCoupons.length === 0 ? (
                    <p className="text-muted-foreground text-sm">
                      Sin cupones. Esta promocion solo se aplica a mano.
                    </p>
                  ) : (
                    <table className="w-full min-w-[30rem] border-collapse text-sm">
                      <caption className="sr-only">Cupones de {promotion.name}</caption>
                      <thead>
                        <tr className="border-border text-muted-foreground border-b text-left text-xs">
                          <th scope="col" className="px-2 py-2 font-medium">
                            Codigo
                          </th>
                          <th scope="col" className="px-2 py-2 font-medium">
                            Canjes
                          </th>
                          <th scope="col" className="px-2 py-2 font-medium">
                            Caduca
                          </th>
                          <th scope="col" className="px-2 py-2 font-medium">
                            Estado
                          </th>
                          {canManage ? (
                            <th scope="col" className="px-2 py-2 font-medium">
                              Accion
                            </th>
                          ) : null}
                        </tr>
                      </thead>
                      <tbody>
                        {promotionCoupons.map((coupon) => (
                          <tr key={coupon.id} className="border-border/60 border-b last:border-0">
                            <td className="px-2 py-2 font-mono">{coupon.code}</td>
                            <td className="px-2 py-2 tabular-nums">
                              {coupon.timesRedeemed}
                              {coupon.maxRedemptions === null ? "" : ` / ${coupon.maxRedemptions}`}
                            </td>
                            <td className="px-2 py-2">
                              {coupon.expiresAt === null
                                ? "—"
                                : new Date(coupon.expiresAt).toLocaleDateString("es-PE")}
                            </td>
                            <td className="px-2 py-2">
                              <Badge variant={coupon.isActive ? "success" : "neutral"}>
                                {coupon.isActive ? "Activo" : "Inactivo"}
                              </Badge>
                            </td>
                            {canManage ? (
                              <td className="px-2 py-2">
                                <div className="flex items-center gap-1">
                                  <SetCouponActiveForm
                                    tenantSlug={tenant.slug}
                                    couponId={coupon.id}
                                    isActive={coupon.isActive}
                                  />
                                  <DeleteCouponForm tenantSlug={tenant.slug} couponId={coupon.id} />
                                </div>
                              </td>
                            ) : null}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}

                  {canManage ? (
                    <CreateCouponForm tenantSlug={tenant.slug} promotionId={promotion.id} />
                  ) : null}
                </div>
              </CardContent>
            </Card>
          );
        })
      )}
    </div>
  );
}
