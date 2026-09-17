"use client";

/**
 * The cart panel that slides in from the right.
 *
 * It shows what the visitor picked and sends them on to the checkout page. It
 * does not take the order itself - Sugu Rolls did, and a name, a phone, a zone,
 * an address and a payment method do not fit a 400px drawer on a phone without
 * becoming a form nobody finishes.
 *
 * The prices here are the labels stored with each line (see `cart.ts`). The
 * checkout re-prices against the live menu, which is why the button says
 * "Continuar" and not "Pagar S/ 57.00".
 */

import Link from "next/link";
import { useEffect, useRef } from "react";
import { IconCart, IconClose, IconMinus, IconPlus, IconTrash } from "@/components/ui/icons";
import { formatCurrency } from "@/lib/money";
import { useCart } from "./cart-provider";
import {
  buttonClass,
  displayStyle,
  outlineButtonStyle,
  primaryButtonStyle,
  subtleStyle,
} from "./site-styles";

export function CartDrawer({
  basePath,
  currency,
  canOrder,
  closedMessage,
}: {
  basePath: string;
  currency: string;
  canOrder: boolean;
  closedMessage: string;
}) {
  const cart = useCart();
  const closeRef = useRef<HTMLButtonElement>(null);
  const { isOpen, close } = cart;

  useEffect(() => {
    if (!isOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [isOpen, close]);

  if (!isOpen) return null;

  const empty = cart.lines.length === 0;

  return (
    <div className="fixed inset-0 z-[60]">
      <button
        type="button"
        aria-label="Cerrar carrito"
        className="absolute inset-0 h-full w-full cursor-default bg-black/60 backdrop-blur-[2px]"
        onClick={close}
        tabIndex={-1}
      />

      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="cart-title"
        className="absolute top-0 right-0 flex h-full w-full max-w-md flex-col shadow-2xl"
        style={{
          background: "var(--site-background)",
          color: "var(--site-foreground)",
          borderLeft: "1px solid var(--site-border)",
        }}
      >
        <header
          className="flex items-center justify-between px-5 py-4"
          style={{ borderBottom: "1px solid var(--site-border)" }}
        >
          <h2 id="cart-title" className="flex items-center gap-2.5 text-xl" style={displayStyle}>
            <IconCart className="size-5" style={{ color: "var(--site-primary)" }} />
            Tu pedido
          </h2>
          <button
            ref={closeRef}
            type="button"
            onClick={close}
            className="flex size-10 items-center justify-center"
            style={{
              border: "1px solid var(--site-border-strong)",
              borderRadius: "var(--site-radius-chip)",
            }}
            aria-label="Cerrar carrito"
          >
            <IconClose className="size-4" />
          </button>
        </header>

        {empty ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
            <IconCart className="size-12" style={subtleStyle} />
            <p style={{ color: "var(--site-muted)" }}>Tu carrito está vacío.</p>
            <Link
              href={`${basePath}/carta`}
              onClick={close}
              className={buttonClass}
              style={primaryButtonStyle}
            >
              Ver la carta
            </Link>
          </div>
        ) : (
          <>
            <ul className="flex-1 overflow-y-auto">
              {cart.lines.map((line) => (
                <li
                  key={line.key}
                  className="flex gap-4 px-5 py-4"
                  style={{ borderBottom: "1px solid var(--site-border)" }}
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{line.name}</p>
                    {line.detail.length > 0 ? (
                      <p className="mt-0.5 text-xs leading-snug" style={subtleStyle}>
                        {line.detail}
                      </p>
                    ) : null}
                    <p
                      className="mt-1 text-sm font-semibold"
                      style={{ color: "var(--site-primary)" }}
                    >
                      {formatCurrency(line.unitPriceCents * line.quantity, currency)}
                    </p>
                  </div>

                  <div className="flex shrink-0 flex-col items-end justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => cart.remove(line.key)}
                      className="transition-opacity hover:opacity-70"
                      style={subtleStyle}
                      aria-label={`Quitar ${line.name}`}
                    >
                      <IconTrash className="size-4" />
                    </button>
                    <QuantityStepper
                      label={line.name}
                      value={line.quantity}
                      onChange={(quantity) => cart.setQuantity(line.key, quantity)}
                    />
                  </div>
                </li>
              ))}
            </ul>

            <footer
              className="flex flex-col gap-3 p-5"
              style={{ borderTop: "1px solid var(--site-border)" }}
            >
              <div className="flex items-baseline justify-between">
                <span style={{ color: "var(--site-muted)" }}>Subtotal</span>
                <span
                  className="text-2xl font-semibold tabular-nums"
                  style={{ color: "var(--site-primary)" }}
                >
                  {formatCurrency(cart.subtotal, currency)}
                </span>
              </div>

              {canOrder ? (
                <Link
                  href={`${basePath}/pedir`}
                  onClick={close}
                  className={`${buttonClass} w-full`}
                  style={primaryButtonStyle}
                >
                  Continuar con el pedido
                </Link>
              ) : (
                <p
                  className="p-3 text-sm leading-relaxed"
                  style={{
                    background: "var(--site-surface-strong)",
                    borderRadius: "var(--site-radius-chip)",
                  }}
                >
                  {closedMessage}
                </p>
              )}

              <Link
                href={`${basePath}/carta`}
                onClick={close}
                className={`${buttonClass} w-full`}
                style={outlineButtonStyle}
              >
                Seguir viendo la carta
              </Link>

              <button
                type="button"
                onClick={cart.clear}
                className="py-1 text-xs transition-opacity hover:opacity-70"
                style={subtleStyle}
              >
                Vaciar carrito
              </button>
            </footer>
          </>
        )}
      </aside>
    </div>
  );
}

/** − 2 + , the control on every cart line and in the product dialog. */
export function QuantityStepper({
  label,
  value,
  onChange,
  min = 1,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
}) {
  return (
    <div
      className="inline-flex items-center"
      style={{
        border: "1px solid var(--site-border-strong)",
        borderRadius: "var(--site-radius-chip)",
      }}
    >
      <button
        type="button"
        onClick={() => onChange(value - 1)}
        disabled={value <= min}
        className="flex size-8 items-center justify-center transition-opacity hover:opacity-70 disabled:opacity-30"
        aria-label={`Una unidad menos de ${label}`}
      >
        <IconMinus className="size-3.5" />
      </button>
      <span className="min-w-7 text-center text-sm font-semibold tabular-nums" aria-live="polite">
        {value}
      </span>
      <button
        type="button"
        onClick={() => onChange(value + 1)}
        disabled={value >= 99}
        className="flex size-8 items-center justify-center transition-opacity hover:opacity-70 disabled:opacity-30"
        aria-label={`Una unidad más de ${label}`}
      >
        <IconPlus className="size-3.5" />
      </button>
    </div>
  );
}
