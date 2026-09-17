"use client";

/**
 * Mi web -> Tienda online.
 *
 * Everything that decides whether and how the website sells, on one form. Every
 * field maps to one column of `tenant_storefronts`; the database's CHECKs are
 * repeated in `storefrontSettingsSchema` only so the owner reads a sentence
 * instead of a constraint name.
 */

import { useActionState, useId } from "react";
import { Alert, AlertDescription, Button, Input, Label, Select, Textarea } from "@/components/ui";
import { IDLE_FORM_STATE } from "@/lib/forms/state";
import { formatMoney } from "@/lib/money";
import { applyStorefrontTemplateAction, updateStorefrontAction } from "../server/actions";
import type { StorefrontSettings } from "../server/queries";

function Checkbox({
  name,
  label,
  description,
  defaultChecked,
}: {
  name: string;
  label: string;
  description: string;
  defaultChecked: boolean;
}) {
  const id = useId();
  return (
    <label
      htmlFor={id}
      className="border-border flex cursor-pointer items-start gap-3 rounded-lg border p-3"
    >
      <input
        id={id}
        name={name}
        type="checkbox"
        defaultChecked={defaultChecked}
        className="mt-0.5 size-4"
      />
      <span className="flex flex-col gap-0.5">
        <span className="text-sm font-medium">{label}</span>
        <span className="text-muted-foreground text-xs">{description}</span>
      </span>
    </label>
  );
}

function FieldError({ errors }: { errors?: readonly string[] }) {
  return errors !== undefined ? <p className="text-destructive text-xs">{errors[0]}</p> : null;
}

export function StorefrontSettingsForm({
  tenantSlug,
  settings,
  locations,
  hasDeliveryModule,
}: {
  tenantSlug: string;
  settings: StorefrontSettings;
  locations: readonly { id: string; name: string }[];
  hasDeliveryModule: boolean;
}) {
  const [state, formAction, isPending] = useActionState(updateStorefrontAction, IDLE_FORM_STATE);
  const e = state.fieldErrors ?? {};

  const modeId = useId();
  const closedId = useId();
  const minId = useId();
  const locationId = useId();
  const taglineId = useId();
  const emailId = useId();
  const messageId = useId();
  const daysId = useId();

  return (
    <form action={formAction} className="flex flex-col gap-8">
      <input type="hidden" name="tenantSlug" value={tenantSlug} />

      {state.status === "success" && state.message !== undefined ? (
        <Alert variant="success">
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}
      {state.status === "error" ? (
        <Alert variant="destructive">
          <AlertDescription>Revisa los campos marcados.</AlertDescription>
        </Alert>
      ) : null}

      <section className="flex flex-col gap-4">
        <h3 className="text-sm font-semibold">Pedidos por la web</h3>
        <Checkbox
          name="orderingEnabled"
          label="Recibir pedidos desde la web"
          description="Apagado, la web muestra la carta pero no deja pedir: solo WhatsApp."
          defaultChecked={settings.orderingEnabled}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={modeId}>Horario de atencion</Label>
            <Select id={modeId} name="mode" defaultValue={settings.mode}>
              <option value="auto">Automatico: segun el horario de la sede</option>
              <option value="open">Abierta siempre</option>
              <option value="closed">Cerrada ahora</option>
            </Select>
            <p className="text-muted-foreground text-xs">
              En automatico, la tienda abre y cierra sola con los turnos de la sede (Sedes,
              horario). Usa &ldquo;Cerrada ahora&rdquo; para un feriado o un dia sin personal.
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={locationId}>Sede que recibe los pedidos</Label>
            <Select
              id={locationId}
              name="orderLocationId"
              defaultValue={settings.orderLocationId ?? ""}
            >
              <option value="">La sede principal</option>
              {locations.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.name}
                </option>
              ))}
            </Select>
            <FieldError errors={e.orderLocationId} />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={closedId}>Aviso cuando esta cerrada</Label>
          <Textarea
            id={closedId}
            name="closedMessage"
            rows={2}
            maxLength={300}
            defaultValue={settings.closedMessage ?? ""}
            placeholder="Estamos cerrados en este momento. Atendemos de martes a domingo, de 12:00 a 22:00."
          />
          <FieldError errors={e.closedMessage} />
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <h3 className="text-sm font-semibold">Entrega</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <Checkbox
            name="acceptsDelivery"
            label="Delivery"
            description={
              hasDeliveryModule
                ? "Se cobra segun la zona. Las zonas y tarifas se configuran en Zonas de delivery."
                : "Tu plan no incluye el modulo de delivery: la web ofrecera solo recojo."
            }
            defaultChecked={settings.acceptsDelivery}
          />
          <Checkbox
            name="acceptsPickup"
            label="Recojo en tienda"
            description="El cliente pasa a recoger su pedido a la sede."
            defaultChecked={settings.acceptsPickup}
          />
        </div>
        <FieldError errors={e.acceptsPickup} />

        <div className="flex max-w-xs flex-col gap-1.5">
          <Label htmlFor={minId}>Pedido minimo (S/)</Label>
          <Input
            id={minId}
            name="minOrder"
            inputMode="decimal"
            defaultValue={settings.minOrderCents > 0 ? formatMoney(settings.minOrderCents) : ""}
            placeholder="0.00"
            invalid={e.minOrder !== undefined}
          />
          <FieldError errors={e.minOrder} />
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <h3 className="text-sm font-semibold">Contacto y marca</h3>
        <Checkbox
          name="whatsappButton"
          label="Boton flotante de WhatsApp"
          description="Usa el numero de WhatsApp de Datos del negocio."
          defaultChecked={settings.whatsappButton}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={messageId}>Mensaje de WhatsApp</Label>
            <Input
              id={messageId}
              name="whatsappMessage"
              maxLength={300}
              defaultValue={settings.whatsappMessage ?? ""}
              placeholder="Hola! Quisiera hacer un pedido."
            />
            <FieldError errors={e.whatsappMessage} />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={emailId}>Correo publico</Label>
            <Input
              id={emailId}
              name="publicEmail"
              type="email"
              maxLength={200}
              defaultValue={settings.publicEmail ?? ""}
              placeholder="hola@turestaurante.pe"
              invalid={e.publicEmail !== undefined}
            />
            <FieldError errors={e.publicEmail} />
          </div>

          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label htmlFor={taglineId}>Eslogan</Label>
            <Input
              id={taglineId}
              name="tagline"
              maxLength={200}
              defaultValue={settings.tagline ?? ""}
              placeholder="Makis que te hacen feliz"
            />
            <p className="text-muted-foreground text-xs">
              Sale en la portada mientras no subas fotos al slider, y en el pie de pagina.
            </p>
          </div>

          <div className="flex max-w-xs flex-col gap-1.5">
            <Label htmlFor={daysId}>&ldquo;Los mas pedidos&rdquo;: dias a contar</Label>
            <Input
              id={daysId}
              name="bestsellersDays"
              type="number"
              min={7}
              max={365}
              defaultValue={settings.bestsellersDays}
              invalid={e.bestsellersDays !== undefined}
            />
            <FieldError errors={e.bestsellersDays} />
          </div>
        </div>
      </section>

      <div>
        <Button type="submit" loading={isPending} loadingLabel="Guardando">
          Guardar
        </Button>
      </div>
    </form>
  );
}

/** One click to the Sugu Rolls home page: slider, shortcuts, bestsellers. */
export function ApplyTemplateForm({ tenantSlug }: { tenantSlug: string }) {
  const [state, formAction, isPending] = useActionState(
    applyStorefrontTemplateAction,
    IDLE_FORM_STATE,
  );

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="tenantSlug" value={tenantSlug} />
      {state.message !== undefined ? (
        <Alert variant={state.status === "success" ? "success" : "warning"}>
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}
      <div>
        <Button type="submit" variant="secondary" loading={isPending} loadingLabel="Creando">
          Crear portada de restaurante
        </Button>
      </div>
    </form>
  );
}
