import Link from "next/link";
import { IconCheck, IconWhatsApp } from "@/components/ui/icons";
import { formatCurrency } from "@/lib/money";
import type { OrderStatus } from "@/types/database";
import type { PublicWebOrder } from "../server/queries";
import { orderWhatsappMessage, whatsappUrl } from "../whatsapp";
import { PayNow } from "@/modules/online-payments/components/pay-now";
import { AutoRefresh } from "./auto-refresh";
import {
  buttonClass,
  displayStyle,
  eyebrowStyle,
  mutedStyle,
  outlineButtonStyle,
  panelStyle,
  primaryButtonStyle,
  subtleStyle,
} from "./site-styles";

/**
 * The page a customer lands on after ordering, and keeps open until lunch
 * arrives.
 *
 * Three jobs, in the order they matter to that person: "it worked, this is your
 * number"; "this is how you pay"; "this is where it is". The WhatsApp button
 * carries the whole order, because in Peru that is still where a restaurant
 * confirms a delivery - the website takes the order, it does not replace the
 * conversation.
 */

const STEPS: { status: OrderStatus; label: string }[] = [
  { status: "pending", label: "Recibido" },
  { status: "confirmed", label: "Confirmado" },
  { status: "preparing", label: "En preparación" },
  { status: "ready", label: "Listo" },
  { status: "completed", label: "Entregado" },
];

const MANUAL_PAYMENT_TYPES = new Set(["yape", "plin", "transfer"]);

export function OrderTracking({
  order,
  basePath,
  businessName,
  currency,
  whatsapp,
  trackingUrl,
  token,
  onlinePaymentLabel,
}: {
  order: PublicWebOrder;
  basePath: string;
  businessName: string;
  currency: string;
  whatsapp: string | null;
  trackingUrl: string;
  token: string;
  /** "Mercado Pago" while the business can still take this payment online. */
  onlinePaymentLabel: string | null;
}) {
  const cancelled = order.status === "cancelled";
  const reached = STEPS.findIndex((step) => step.status === order.status);
  // An online payment on its way keeps the page refreshing even after the
  // kitchen finished: the customer is waiting to read "pagado".
  const awaitingPayment = order.payOnline && order.onlinePaymentStatus !== "approved";
  const finished = (cancelled || order.status === "completed") && !awaitingPayment;
  const balance = Math.max(0, order.totalCents - order.paidCents);

  const whatsappHref = whatsappUrl(
    whatsapp,
    orderWhatsappMessage({
      businessName,
      orderNumber: order.number,
      contactName: order.contactName,
      items: order.items.map((item) => ({
        name: item.name,
        detail: [item.variant, item.options].filter((part) => part !== null).join(" · "),
        quantity: item.quantity,
        total: formatCurrency(item.totalCents, currency),
      })),
      total: formatCurrency(order.totalCents, currency),
      fulfillment: order.fulfillment,
      zoneName: order.zoneName,
      paymentMethod: order.paymentMethod,
      trackingUrl,
    }),
  );

  const placed = new Intl.DateTimeFormat("es-PE", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "America/Lima",
  }).format(new Date(order.placedAt));

  return (
    <div
      className="mx-auto flex max-w-3xl flex-col gap-8"
      style={{ paddingBlock: "calc(var(--site-section-space) / 2)" }}
    >
      <AutoRefresh seconds={30} active={!finished} />

      <header className="flex flex-col items-center gap-4 text-center">
        <span
          className="flex size-14 items-center justify-center rounded-full"
          style={{
            background: cancelled ? "#fee2e2" : "#dcfce7",
            color: cancelled ? "#991b1b" : "#166534",
          }}
          aria-hidden
        >
          <IconCheck className="size-7" />
        </span>
        <span className="text-xs font-semibold" style={eyebrowStyle}>
          Pedido #{order.number}
        </span>
        <h1 className="text-[clamp(2rem,4.5vw,3.25rem)] text-balance" style={displayStyle}>
          {cancelled ? "Tu pedido fue cancelado" : `¡Gracias, ${order.contactName}!`}
        </h1>
        <p className="max-w-prose" style={mutedStyle}>
          {cancelled
            ? "Si crees que es un error, escríbenos por WhatsApp."
            : "Recibimos tu pedido. Esta página se actualiza sola: puedes dejarla abierta."}
        </p>
        <p className="text-xs" style={subtleStyle}>
          {placed}
        </p>
      </header>

      {!cancelled ? (
        <ol className="grid grid-cols-5 gap-2" aria-label="Estado del pedido">
          {STEPS.map((step, index) => {
            const done = index <= reached;
            return (
              <li key={step.status} className="flex flex-col items-center gap-2 text-center">
                <span
                  className="h-1.5 w-full rounded-full"
                  style={{ background: done ? "var(--site-primary)" : "var(--site-border-strong)" }}
                  aria-hidden
                />
                <span
                  className="text-[0.7rem] leading-tight sm:text-xs"
                  style={{
                    color: done ? "var(--site-foreground)" : "var(--site-subtle)",
                    fontWeight: index === reached ? 600 : 400,
                  }}
                  aria-current={index === reached ? "step" : undefined}
                >
                  {step.label}
                </span>
              </li>
            );
          })}
        </ol>
      ) : null}

      {!cancelled && order.payOnline && order.onlinePaymentStatus === "approved" ? (
        <p
          role="status"
          className="p-4 text-center text-sm font-medium"
          style={{
            background: "#dcfce7",
            color: "#166534",
            borderRadius: "var(--site-radius-chip)",
          }}
        >
          Pago confirmado. ¡Gracias!
        </p>
      ) : null}

      {!cancelled &&
      order.payOnline &&
      balance > 0 &&
      onlinePaymentLabel !== null &&
      (order.onlinePaymentStatus === "pending" || order.onlinePaymentStatus === "rejected") ? (
        <PayNow
          token={token}
          amountCents={balance}
          currency={currency}
          providerLabel={onlinePaymentLabel}
          status={order.onlinePaymentStatus}
        />
      ) : null}

      {!cancelled &&
      balance > 0 &&
      order.paymentType !== null &&
      MANUAL_PAYMENT_TYPES.has(order.paymentType) ? (
        <section
          className="flex flex-col gap-2 p-6"
          style={{
            ...panelStyle,
            background: "var(--site-primary-soft)",
            borderColor: "var(--site-primary-line)",
          }}
        >
          <h2 className="text-lg" style={displayStyle}>
            Paga con {order.paymentMethod}
          </h2>
          <p className="text-sm leading-relaxed" style={mutedStyle}>
            Envía{" "}
            <strong style={{ color: "var(--site-foreground)" }}>
              {formatCurrency(balance, currency)}
            </strong>
            {order.paymentReference !== null ? (
              <>
                {" "}
                a{" "}
                <strong style={{ color: "var(--site-foreground)" }}>
                  {order.paymentReference}
                </strong>
              </>
            ) : null}{" "}
            y mándanos la captura por WhatsApp con tu número de pedido.
          </p>
        </section>
      ) : null}

      <section className="flex flex-col gap-4 p-6" style={panelStyle}>
        <h2 className="text-lg" style={displayStyle}>
          Detalle
        </h2>
        <ul className="flex flex-col gap-3">
          {order.items.map((item, index) => (
            <li key={index} className="flex items-start justify-between gap-3 text-sm">
              <div>
                <p>
                  {item.quantity} x {item.name}
                </p>
                {item.variant !== null || item.options !== null ? (
                  <p className="text-xs" style={subtleStyle}>
                    {[item.variant, item.options].filter((part) => part !== null).join(" · ")}
                  </p>
                ) : null}
              </div>
              <span className="shrink-0 tabular-nums">
                {formatCurrency(item.totalCents, currency)}
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
            <dd className="tabular-nums">{formatCurrency(order.subtotalCents, currency)}</dd>
          </div>
          {order.discountCents > 0 ? (
            <div className="flex justify-between">
              <dt style={mutedStyle}>Descuento</dt>
              <dd className="tabular-nums">−{formatCurrency(order.discountCents, currency)}</dd>
            </div>
          ) : null}
          {order.fulfillment === "delivery" ? (
            <div className="flex justify-between">
              <dt style={mutedStyle}>
                Delivery{order.zoneName !== null ? ` · ${order.zoneName}` : ""}
              </dt>
              <dd className="tabular-nums">
                {order.shippingCents === 0
                  ? "Gratis"
                  : formatCurrency(order.shippingCents, currency)}
              </dd>
            </div>
          ) : (
            <div className="flex justify-between">
              <dt style={mutedStyle}>Entrega</dt>
              <dd>Recojo en tienda</dd>
            </div>
          )}
          <div className="flex items-baseline justify-between pt-2">
            <dt className="font-semibold">Total</dt>
            <dd
              className="text-2xl font-semibold tabular-nums"
              style={{ color: "var(--site-primary)" }}
            >
              {formatCurrency(order.totalCents, currency)}
            </dd>
          </div>
          {order.paymentMethod !== null ? (
            <div className="flex justify-between">
              <dt style={mutedStyle}>Pago</dt>
              <dd>
                {order.paymentMethod}
                {balance === 0 && order.paidCents > 0 ? " · Pagado" : ""}
              </dd>
            </div>
          ) : null}
        </dl>
      </section>

      <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
        {whatsappHref !== null ? (
          <a
            href={whatsappHref}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonClass}
            style={primaryButtonStyle}
          >
            <IconWhatsApp className="size-4" />
            Enviar pedido por WhatsApp
          </a>
        ) : null}
        <Link href={`${basePath}/carta`} className={buttonClass} style={outlineButtonStyle}>
          Volver a la carta
        </Link>
      </div>

      <p className="text-center text-xs" style={subtleStyle}>
        Guarda este enlace: es la única forma de ver tu pedido.
      </p>
    </div>
  );
}
