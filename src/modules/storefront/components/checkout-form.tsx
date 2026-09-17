"use client";

/**
 * "Pedir ahora", without an account.
 *
 * The owner asked for no customer accounts, and that is also the faster
 * checkout: a name, a phone, delivery or pickup, how you will pay. Nothing is
 * remembered about the visitor beyond the order itself.
 *
 * THE TOTAL ON THIS PAGE IS AN ESTIMATE THAT HAPPENS TO BE RIGHT. Every line is
 * re-priced from the live menu with the same rule `snapshot_order_item` uses,
 * and the delivery fee with the same rule `place_web_order` uses - so it agrees
 * with the database unless the catalogue changes between this render and the
 * click. When it does, the database wins and the tracking page shows its number.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useMemo, useState, useTransition } from "react";
import { IconAlert, IconTrash, IconWhatsApp } from "@/components/ui/icons";
import { formatCurrency } from "@/lib/money";
import { priceLines, type PricingProduct } from "../cart";
import type { PublicDeliveryZone, PublicPaymentMethod } from "../server/queries";
import { placeWebOrderAction } from "../server/actions";
import { whatsappUrl } from "../whatsapp";
import { useCart } from "./cart-provider";
import {
  buttonClass,
  displayStyle,
  fieldClass,
  fieldStyle,
  mutedStyle,
  outlineButtonStyle,
  panelStyle,
  primaryButtonStyle,
  subtleStyle,
} from "./site-styles";

export interface CheckoutStorefront {
  readonly canOrder: boolean;
  readonly orderingEnabled: boolean;
  readonly closedMessage: string | null;
  readonly acceptsDelivery: boolean;
  readonly acceptsPickup: boolean;
  readonly minOrderCents: number;
  readonly whatsapp: string | null;
}

const PAYMENT_HINT: Partial<Record<PublicPaymentMethod["type"], string>> = {
  yape: "Yapea el total al número indicado y envía la captura por WhatsApp.",
  plin: "Envía el total por Plin al número indicado y manda la captura por WhatsApp.",
  transfer: "Transfiere el total a la cuenta indicada y envía el comprobante por WhatsApp.",
  cash: "Pagas en efectivo al recibir o recoger tu pedido.",
  card: "Pagas con tarjeta al recibir o recoger tu pedido.",
};

function Field({
  label,
  error,
  children,
  hint,
}: {
  label: string;
  error?: string;
  hint?: string;
  children: (id: string) => React.ReactNode;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      {children(id)}
      {error !== undefined ? (
        <p className="text-xs" style={{ color: "#dc2626" }}>
          {error}
        </p>
      ) : hint !== undefined ? (
        <p className="text-xs" style={subtleStyle}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** The radio value that means "pay online through the gateway" (Phase 31). */
const ONLINE = "__online__";

export function CheckoutForm({
  onlinePaymentLabel,
  basePath,
  businessName,
  currency,
  storefront,
  zones,
  paymentMethods,
  pickupAddress,
  menu,
  preview,
}: {
  basePath: string;
  businessName: string;
  currency: string;
  storefront: CheckoutStorefront;
  zones: readonly PublicDeliveryZone[];
  paymentMethods: readonly PublicPaymentMethod[];
  pickupAddress: string | null;
  menu: readonly PricingProduct[];
  preview: boolean;
  /** "Mercado Pago", when the platform enabled a gateway for this business. */
  onlinePaymentLabel: string | null;
}) {
  const cart = useCart();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [fulfillment, setFulfillment] = useState<"delivery" | "pickup">(
    storefront.acceptsDelivery ? "delivery" : "pickup",
  );
  const [zoneId, setZoneId] = useState(zones[0]?.id ?? "");
  const [address, setAddress] = useState("");
  const [reference, setReference] = useState("");
  const [paymentMethodId, setPaymentMethodId] = useState<string | null>(
    onlinePaymentLabel !== null ? ONLINE : (paymentMethods[0]?.id ?? null),
  );
  const [note, setNote] = useState("");
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Readonly<Record<string, readonly string[]>>>({});

  const priced = useMemo(() => priceLines(cart.lines, menu), [cart.lines, menu]);
  const unavailable = priced.filter((line) => !line.available);
  const subtotal = priced.reduce((total, line) => total + line.lineTotalCents, 0);

  const zone = zones.find((candidate) => candidate.id === zoneId) ?? null;
  const deliveryFee =
    fulfillment !== "delivery" || zone === null
      ? 0
      : zone.minOrderFreeCents !== null && subtotal >= zone.minOrderFreeCents
        ? 0
        : zone.feeCents;
  const total = subtotal + deliveryFee;

  const belowMinimum = storefront.minOrderCents > 0 && subtotal < storefront.minOrderCents;
  const method = paymentMethods.find((candidate) => candidate.id === paymentMethodId) ?? null;

  const blocked =
    preview ||
    !storefront.canOrder ||
    priced.length === 0 ||
    unavailable.length > 0 ||
    belowMinimum ||
    pending;

  const firstError = (key: string) => fieldErrors[key]?.[0];

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (blocked) return;

    setError(null);
    setFieldErrors({});

    startTransition(async () => {
      const result = await placeWebOrderAction({
        contact: { name, phone },
        fulfillment,
        delivery:
          fulfillment === "delivery"
            ? { zoneId, address, reference: reference.length > 0 ? reference : undefined }
            : undefined,
        paymentMethodId: paymentMethodId === ONLINE ? null : paymentMethodId,
        payOnline: paymentMethodId === ONLINE,
        note: note.length > 0 ? note : undefined,
        acceptedTerms,
        items: cart.lines.map((line) => ({
          productId: line.productId,
          variantId: line.variantId,
          optionIds: [...line.optionIds],
          quantity: line.quantity,
        })),
      });

      if (!result.ok) {
        setError(result.message);
        setFieldErrors(result.fieldErrors ?? {});
        return;
      }

      cart.clear();
      router.push(`${basePath}/pedido/${result.token}`);
    });
  };

  if (priced.length === 0) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-5 py-10 text-center">
        <p style={mutedStyle}>Tu carrito está vacío. Elige tus platos en la carta.</p>
        <Link href={`${basePath}/carta`} className={buttonClass} style={primaryButtonStyle}>
          Ver la carta
        </Link>
      </div>
    );
  }

  // The same cart as a WhatsApp message: a way out for somebody who would
  // rather write, and the only way when web orders are switched off.
  const whatsappText = [
    `¡Hola ${businessName}! Quisiera hacer un pedido:`,
    "",
    ...priced.map(
      (line) =>
        `• ${line.quantity} x ${line.name}${line.detail.length > 0 ? ` (${line.detail})` : ""}`,
    ),
  ].join("\n");
  const whatsappHref = whatsappUrl(storefront.whatsapp, whatsappText);

  return (
    <form
      onSubmit={submit}
      className="grid gap-8 lg:grid-cols-[1fr_24rem] lg:items-start"
      noValidate
    >
      <div className="flex flex-col gap-8">
        {preview ? (
          <Notice>
            Esta es la vista previa: el formulario se ve igual que para tus clientes, pero no envía
            pedidos.
          </Notice>
        ) : !storefront.canOrder ? (
          <Notice>
            {!storefront.orderingEnabled
              ? "Por ahora no tomamos pedidos por la web."
              : (storefront.closedMessage ??
                "Estamos cerrados en este momento. Vuelve en nuestro horario de atención.")}
          </Notice>
        ) : null}

        <fieldset className="flex flex-col gap-5 p-6" style={panelStyle}>
          <legend className="sr-only">Tus datos</legend>
          <h2 className="text-xl" style={displayStyle}>
            Tus datos
          </h2>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Nombre" error={firstError("contact.name")}>
              {(id) => (
                <input
                  id={id}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  autoComplete="name"
                  maxLength={120}
                  required
                  className={fieldClass}
                  style={fieldStyle}
                />
              )}
            </Field>
            <Field
              label="Celular"
              error={firstError("contact.phone")}
              hint="Te escribimos aquí si hay algo que coordinar."
            >
              {(id) => (
                <input
                  id={id}
                  type="tel"
                  inputMode="tel"
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                  autoComplete="tel"
                  placeholder="999 123 456"
                  maxLength={30}
                  required
                  className={fieldClass}
                  style={fieldStyle}
                />
              )}
            </Field>
          </div>
        </fieldset>

        <fieldset className="flex flex-col gap-5 p-6" style={panelStyle}>
          <legend className="sr-only">Entrega</legend>
          <h2 className="text-xl" style={displayStyle}>
            ¿Cómo lo quieres recibir?
          </h2>

          {storefront.acceptsDelivery && storefront.acceptsPickup ? (
            <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Forma de entrega">
              {(
                [
                  ["delivery", "Delivery"],
                  ["pickup", "Recojo en tienda"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={fulfillment === value}
                  onClick={() => setFulfillment(value)}
                  className="h-12 text-sm font-medium transition-colors"
                  style={{
                    borderRadius: "var(--site-radius-chip)",
                    border: `1px solid ${
                      fulfillment === value ? "var(--site-primary)" : "var(--site-border-strong)"
                    }`,
                    background: fulfillment === value ? "var(--site-primary-soft)" : "transparent",
                    color: "var(--site-foreground)",
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          ) : (
            <p className="text-sm" style={mutedStyle}>
              {storefront.acceptsDelivery ? "Delivery a tu dirección." : "Recojo en tienda."}
            </p>
          )}

          {fulfillment === "delivery" ? (
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Zona" error={firstError("delivery.zoneId")}>
                {(id) => (
                  <select
                    id={id}
                    value={zoneId}
                    onChange={(event) => setZoneId(event.target.value)}
                    className={fieldClass}
                    style={fieldStyle}
                  >
                    {zones.map((candidate) => (
                      <option key={candidate.id} value={candidate.id}>
                        {candidate.name} —{" "}
                        {candidate.feeCents === 0
                          ? "Gratis"
                          : formatCurrency(candidate.feeCents, currency)}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
              <Field label="Dirección" error={firstError("delivery.address")}>
                {(id) => (
                  <input
                    id={id}
                    value={address}
                    onChange={(event) => setAddress(event.target.value)}
                    autoComplete="street-address"
                    placeholder="Av. Brasil 1234, dpto 301"
                    maxLength={300}
                    className={fieldClass}
                    style={fieldStyle}
                  />
                )}
              </Field>
              <div className="sm:col-span-2">
                <Field label="Referencia (opcional)" error={firstError("delivery.reference")}>
                  {(id) => (
                    <input
                      id={id}
                      value={reference}
                      onChange={(event) => setReference(event.target.value)}
                      placeholder="Frente al parque, timbre 2"
                      maxLength={200}
                      className={fieldClass}
                      style={fieldStyle}
                    />
                  )}
                </Field>
              </div>
            </div>
          ) : pickupAddress !== null ? (
            <p className="text-sm" style={mutedStyle}>
              Recoges en:{" "}
              <span className="font-medium" style={{ color: "var(--site-foreground)" }}>
                {pickupAddress}
              </span>
            </p>
          ) : null}
        </fieldset>

        {paymentMethods.length > 0 || onlinePaymentLabel !== null ? (
          <fieldset className="flex flex-col gap-4 p-6" style={panelStyle}>
            <legend className="sr-only">Pago</legend>
            <h2 className="text-xl" style={displayStyle}>
              ¿Cómo vas a pagar?
            </h2>
            <div className="grid gap-2 sm:grid-cols-2">
              {onlinePaymentLabel !== null ? (
                <label
                  className="flex cursor-pointer items-center gap-3 px-4 py-3 text-sm sm:col-span-2"
                  style={{
                    borderRadius: "var(--site-radius-chip)",
                    border: `1px solid ${paymentMethodId === ONLINE ? "var(--site-primary)" : "var(--site-border-strong)"}`,
                    background:
                      paymentMethodId === ONLINE ? "var(--site-primary-soft)" : "transparent",
                  }}
                >
                  <input
                    type="radio"
                    name="paymentMethod"
                    checked={paymentMethodId === ONLINE}
                    onChange={() => setPaymentMethodId(ONLINE)}
                    className="size-4"
                    style={{ accentColor: "var(--site-primary)" }}
                  />
                  <span className="flex flex-col">
                    <span className="font-medium">Pagar online ahora</span>
                    <span className="text-xs" style={subtleStyle}>
                      Tarjeta o Yape, con {onlinePaymentLabel}
                    </span>
                  </span>
                </label>
              ) : null}
              {paymentMethods.map((candidate) => {
                const checked = candidate.id === paymentMethodId;
                return (
                  <label
                    key={candidate.id}
                    className="flex cursor-pointer items-center gap-3 px-4 py-3 text-sm"
                    style={{
                      borderRadius: "var(--site-radius-chip)",
                      border: `1px solid ${checked ? "var(--site-primary)" : "var(--site-border-strong)"}`,
                      background: checked ? "var(--site-primary-soft)" : "transparent",
                    }}
                  >
                    <input
                      type="radio"
                      name="paymentMethod"
                      checked={checked}
                      onChange={() => setPaymentMethodId(candidate.id)}
                      className="size-4"
                      style={{ accentColor: "var(--site-primary)" }}
                    />
                    {candidate.name}
                  </label>
                );
              })}
            </div>
            {paymentMethodId === ONLINE ? (
              <p className="text-sm leading-relaxed" style={mutedStyle}>
                Al confirmar, te llevamos a pagar de forma segura. Tu pedido se marca como pagado
                apenas {onlinePaymentLabel} lo confirme.
              </p>
            ) : null}
            {method !== null ? (
              <p className="text-sm leading-relaxed" style={mutedStyle}>
                {PAYMENT_HINT[method.type] ?? "Coordinamos el pago contigo por WhatsApp."}
                {method.reference !== null ? (
                  <>
                    {" "}
                    <span className="font-semibold" style={{ color: "var(--site-foreground)" }}>
                      {method.reference}
                    </span>
                  </>
                ) : null}
              </p>
            ) : null}
            {firstError("paymentMethodId") !== undefined ? (
              <p className="text-xs" style={{ color: "#dc2626" }}>
                {firstError("paymentMethodId")}
              </p>
            ) : null}
          </fieldset>
        ) : null}

        <fieldset className="flex flex-col gap-4 p-6" style={panelStyle}>
          <legend className="sr-only">Nota</legend>
          <Field label="Nota para el local (opcional)">
            {(id) => (
              <textarea
                id={id}
                value={note}
                onChange={(event) => setNote(event.target.value)}
                rows={3}
                maxLength={300}
                placeholder="Sin cebolla, tocar el timbre…"
                className="w-full px-4 py-3 text-sm outline-none focus:ring-2"
                style={fieldStyle}
              />
            )}
          </Field>
        </fieldset>
      </div>

      <aside className="flex flex-col gap-5 p-6 lg:sticky lg:top-24" style={panelStyle}>
        <h2 className="text-xl" style={displayStyle}>
          Tu pedido
        </h2>

        <ul className="flex flex-col gap-3">
          {priced.map((line) => (
            <li key={line.key} className="flex items-start justify-between gap-3 text-sm">
              <div className="min-w-0">
                <p className={line.available ? undefined : "line-through opacity-60"}>
                  {line.quantity} x {line.name}
                </p>
                {line.detail.length > 0 ? (
                  <p className="text-xs" style={subtleStyle}>
                    {line.detail}
                  </p>
                ) : null}
                {!line.available ? (
                  <button
                    type="button"
                    onClick={() => cart.remove(line.key)}
                    className="mt-1 inline-flex items-center gap-1 text-xs font-medium"
                    style={{ color: "#dc2626" }}
                  >
                    <IconTrash className="size-3.5" />
                    Ya no está disponible · Quitar
                  </button>
                ) : null}
              </div>
              <span className="shrink-0 tabular-nums">
                {line.available ? formatCurrency(line.lineTotalCents, currency) : "—"}
              </span>
            </li>
          ))}
        </ul>

        <dl
          className="flex flex-col gap-2 pt-4 text-sm"
          style={{ borderTop: "1px solid var(--site-border)" }}
        >
          <div className="flex justify-between">
            <dt style={mutedStyle}>Subtotal</dt>
            <dd className="tabular-nums">{formatCurrency(subtotal, currency)}</dd>
          </div>
          {fulfillment === "delivery" ? (
            <div className="flex justify-between">
              <dt style={mutedStyle}>Delivery{zone !== null ? ` · ${zone.name}` : ""}</dt>
              <dd className="tabular-nums">
                {deliveryFee === 0 ? "Gratis" : formatCurrency(deliveryFee, currency)}
              </dd>
            </div>
          ) : null}
          <div className="flex items-baseline justify-between pt-2">
            <dt className="font-semibold">Total</dt>
            <dd
              className="text-2xl font-semibold tabular-nums"
              style={{ color: "var(--site-primary)" }}
            >
              {formatCurrency(total, currency)}
            </dd>
          </div>
        </dl>

        {belowMinimum ? (
          <Notice>
            El pedido mínimo es {formatCurrency(storefront.minOrderCents, currency)}. Te faltan{" "}
            {formatCurrency(storefront.minOrderCents - subtotal, currency)}.
          </Notice>
        ) : null}

        <label className="flex items-start gap-3 text-xs leading-relaxed" style={mutedStyle}>
          <input
            type="checkbox"
            checked={acceptedTerms}
            onChange={(event) => setAcceptedTerms(event.target.checked)}
            className="mt-0.5 size-4 shrink-0"
            style={{ accentColor: "var(--site-primary)" }}
          />
          <span>
            Acepto los{" "}
            <Link
              href={`${basePath}/terminos`}
              target="_blank"
              className="underline underline-offset-2"
            >
              términos y condiciones
            </Link>{" "}
            y la{" "}
            <Link
              href={`${basePath}/privacidad`}
              target="_blank"
              className="underline underline-offset-2"
            >
              política de privacidad
            </Link>
            .
          </span>
        </label>
        {firstError("acceptedTerms") !== undefined ? (
          <p className="-mt-3 text-xs" style={{ color: "#dc2626" }}>
            {firstError("acceptedTerms")}
          </p>
        ) : null}

        {error !== null ? (
          <p role="alert" className="text-sm" style={{ color: "#dc2626" }}>
            {error}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={blocked || !acceptedTerms}
          className={`${buttonClass} w-full`}
          style={primaryButtonStyle}
        >
          {pending ? "Enviando pedido…" : `Confirmar pedido · ${formatCurrency(total, currency)}`}
        </button>

        {whatsappHref !== null ? (
          <a
            href={whatsappHref}
            target="_blank"
            rel="noopener noreferrer"
            className={`${buttonClass} w-full`}
            style={outlineButtonStyle}
          >
            <IconWhatsApp className="size-4" />
            Prefiero pedir por WhatsApp
          </a>
        ) : null}
      </aside>
    </form>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <p
      role="status"
      className="flex items-start gap-3 p-4 text-sm leading-relaxed"
      style={{
        background: "#fffbeb",
        color: "#92400e",
        border: "1px solid #fde68a",
        borderRadius: "var(--site-radius-chip)",
      }}
    >
      <IconAlert className="mt-0.5 size-4 shrink-0" />
      <span>{children}</span>
    </p>
  );
}
