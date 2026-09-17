import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui";
import { PROVIDER_LABELS } from "../credentials";
import { clearPaymentGatewayAction } from "../server/actions";
import type { GatewaySummary } from "../server/queries";
import { GatewayForm } from "./gateway-form";

/**
 * The online payments card of a tenant, on the Super Admin screen (Phase 31).
 *
 * Shows whether the plan includes the module, what is configured, the URL each
 * provider has to be told about, and the form. Authorization is not decided
 * here: every action starts with `requirePlatformAdmin()` and the database
 * functions check `is_platform_admin()` again.
 */
export function TenantGatewayCard({
  tenantId,
  domain,
  hasModule,
  gateway,
}: {
  tenantId: string;
  domain: string | null;
  hasModule: boolean;
  gateway: GatewaySummary | null;
}) {
  const base = domain === null ? "https://{dominio}" : `https://${domain}`;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle as="h2">Pagos online</CardTitle>
            <CardDescription>
              La pasarela con la que la web de este negocio cobra con tarjeta y Yape.
            </CardDescription>
          </div>
          {gateway === null ? (
            <Badge variant="neutral">Sin pasarela</Badge>
          ) : (
            <Badge variant={gateway.isEnabled ? "success" : "warning"} dot>
              {PROVIDER_LABELS[gateway.provider]} ·{" "}
              {gateway.mode === "live" ? "Produccion" : "Pruebas"} ·{" "}
              {gateway.isEnabled ? "Activa" : "Inactiva"}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {!hasModule ? (
          <Alert variant="warning">
            <AlertDescription>
              El plan de este negocio no incluye Pagos online (Starter solo cobra Yape y Plin a
              mano). Puedes configurarla igual: la web no la ofrecera hasta que el plan o un ajuste
              de modulo la incluya.
            </AlertDescription>
          </Alert>
        ) : null}

        {gateway?.provider === "izipay" ? (
          <Alert variant="info">
            <AlertDescription>
              En el back office de Izipay, configura la URL de notificacion al final del pago:{" "}
              <code className="break-all">{`${base}/api/pagos/izipay/${tenantId}`}</code>
            </AlertDescription>
          </Alert>
        ) : null}
        {gateway?.provider === "mercadopago" ? (
          <Alert variant="info">
            <AlertDescription>
              Mercado Pago recibe la URL de notificacion con cada cobro. Para validar la firma, en
              Tus integraciones -&gt; Webhooks registra{" "}
              <code className="break-all">{`${base}/api/pagos/mercadopago/${tenantId}`}</code> y
              copia su clave secreta aqui.
            </AlertDescription>
          </Alert>
        ) : null}

        <GatewayForm
          tenantId={tenantId}
          current={
            gateway === null
              ? null
              : {
                  provider: gateway.provider,
                  mode: gateway.mode,
                  publicKey: gateway.publicKey,
                  isEnabled: gateway.isEnabled,
                  hasCredentials: gateway.hasCredentials,
                }
          }
        />

        {gateway !== null ? (
          <form
            action={clearPaymentGatewayAction}
            className="border-border flex items-center gap-3 border-t pt-4"
          >
            <input type="hidden" name="tenantId" value={tenantId} />
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" required className="size-4" />
              Confirmo quitar la pasarela y borrar sus credenciales
            </label>
            <Button type="submit" size="sm" variant="destructive">
              Quitar pasarela
            </Button>
          </form>
        ) : null}
      </CardContent>
    </Card>
  );
}
