"use client";

/**
 * Choosing how you want it: presentation, extras, how many.
 *
 * Opened only for a product that HAS something to choose. A maki with one price
 * and no extras goes straight into the cart from its card - a dialog asking
 * "how many?" for every item is the slowest menu on the internet.
 *
 * A presentation is required when the product has any: the database refuses a
 * line without one (`VARIANT_REQUIRED`), so the button stays disabled until one
 * is picked instead of failing at checkout. The first is preselected - the
 * smallest, the natural entry point - which is the choice Sugu Rolls made.
 */

import { useEffect, useId, useRef, useState } from "react";
import { IconClose } from "@/components/ui/icons";
import { formatCurrency } from "@/lib/money";
import type { MenuProduct } from "../server/queries";
import { QuantityStepper } from "./cart-drawer";
import {
  buttonClass,
  displayStyle,
  mutedStyle,
  primaryButtonStyle,
  subtleStyle,
} from "./site-styles";

export interface ProductChoice {
  readonly variantId: string | null;
  readonly optionIds: readonly string[];
  readonly quantity: number;
  readonly unitPriceCents: number;
  readonly detail: string;
}

export function ProductDialog({
  product,
  imageUrl,
  currency,
  onClose,
  onConfirm,
}: {
  product: MenuProduct;
  imageUrl: string | null;
  currency: string;
  onClose: () => void;
  onConfirm: (choice: ProductChoice) => void;
}) {
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const [variantId, setVariantId] = useState<string | null>(product.variants[0]?.id ?? null);
  const [optionIds, setOptionIds] = useState<readonly string[]>([]);
  const [quantity, setQuantity] = useState(1);

  // The latest `onClose`, without making the effect below depend on it: callers
  // pass an inline arrow, and re-running the effect on every render would pull
  // focus back to the close button each time an extra is ticked.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCloseRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  const variant = product.variants.find((candidate) => candidate.id === variantId) ?? null;
  const chosenOptions = product.options.filter((option) => optionIds.includes(option.id));
  const unitPrice = Math.max(
    0,
    (variant?.priceCents ?? product.basePriceCents) +
      chosenOptions.reduce((total, option) => total + option.priceDeltaCents, 0),
  );

  // Extras grouped by their label, in the order the owner arranged them.
  const groups = new Map<string, typeof product.options>();
  for (const option of product.options) {
    groups.set(option.groupLabel, [...(groups.get(option.groupLabel) ?? []), option]);
  }

  const needsVariant = product.variants.length > 0 && variant === null;

  const confirm = () => {
    if (needsVariant) return;
    const detail = [
      variant?.name,
      ...chosenOptions.map((option) => `${option.groupLabel}: ${option.name}`),
    ]
      .filter((part): part is string => part !== undefined && part.length > 0)
      .join(" · ");

    onConfirm({
      variantId: variant?.id ?? null,
      optionIds,
      quantity,
      unitPriceCents: unitPrice,
      detail,
    });
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center sm:p-6">
      <button
        type="button"
        aria-label="Cerrar"
        tabIndex={-1}
        className="absolute inset-0 h-full w-full cursor-default bg-black/60 backdrop-blur-[2px]"
        onClick={onClose}
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative flex max-h-[92svh] w-full max-w-lg flex-col overflow-hidden shadow-2xl"
        style={{
          background: "var(--site-background)",
          color: "var(--site-foreground)",
          borderRadius: "var(--site-radius)",
          border: "1px solid var(--site-border)",
        }}
      >
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          className="absolute top-3 right-3 z-10 flex size-10 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur"
          aria-label="Cerrar"
        >
          <IconClose className="size-4" />
        </button>

        <div className="overflow-y-auto">
          {imageUrl !== null ? (
            /* eslint-disable-next-line @next/next/no-img-element -- signed Storage URL */
            <img src={imageUrl} alt={product.name} className="aspect-[16/10] w-full object-cover" />
          ) : null}

          <div className="flex flex-col gap-6 p-6">
            <div className="flex flex-col gap-2 pr-8">
              <h2 id={titleId} className="text-2xl" style={displayStyle}>
                {product.name}
              </h2>
              {product.description !== null ? (
                <p className="text-sm leading-relaxed" style={mutedStyle}>
                  {product.description}
                </p>
              ) : null}
            </div>

            {product.variants.length > 0 ? (
              <fieldset className="flex flex-col gap-3">
                <legend className="mb-3 text-sm font-semibold">
                  Presentación <span style={subtleStyle}>(obligatorio)</span>
                </legend>
                {product.variants.map((option) => (
                  <label
                    key={option.id}
                    className="flex cursor-pointer items-center justify-between gap-3 px-4 py-3 text-sm"
                    style={{
                      border: `1px solid ${
                        option.id === variantId
                          ? "var(--site-primary)"
                          : "var(--site-border-strong)"
                      }`,
                      borderRadius: "var(--site-radius-chip)",
                      background:
                        option.id === variantId ? "var(--site-primary-soft)" : "transparent",
                    }}
                  >
                    <span className="flex items-center gap-3">
                      <input
                        type="radio"
                        name={`variant-${product.id}`}
                        checked={option.id === variantId}
                        onChange={() => setVariantId(option.id)}
                        className="size-4"
                        style={{ accentColor: "var(--site-primary)" }}
                      />
                      {option.name}
                    </span>
                    <span className="font-semibold tabular-nums">
                      {formatCurrency(option.priceCents, currency)}
                    </span>
                  </label>
                ))}
              </fieldset>
            ) : null}

            {[...groups.entries()].map(([group, options]) => (
              <fieldset key={group} className="flex flex-col gap-2">
                <legend className="mb-3 text-sm font-semibold">{group}</legend>
                {options.map((option) => {
                  const checked = optionIds.includes(option.id);
                  return (
                    <label
                      key={option.id}
                      className="flex cursor-pointer items-center justify-between gap-3 px-4 py-3 text-sm"
                      style={{
                        border: `1px solid ${checked ? "var(--site-primary)" : "var(--site-border)"}`,
                        borderRadius: "var(--site-radius-chip)",
                      }}
                    >
                      <span className="flex items-center gap-3">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() =>
                            setOptionIds((current) =>
                              checked
                                ? current.filter((id) => id !== option.id)
                                : [...current, option.id],
                            )
                          }
                          className="size-4"
                          style={{ accentColor: "var(--site-primary)" }}
                        />
                        {option.name}
                      </span>
                      {option.priceDeltaCents !== 0 ? (
                        <span className="tabular-nums" style={mutedStyle}>
                          {option.priceDeltaCents > 0 ? "+" : "−"}
                          {formatCurrency(Math.abs(option.priceDeltaCents), currency)}
                        </span>
                      ) : null}
                    </label>
                  );
                })}
              </fieldset>
            ))}
          </div>
        </div>

        <div
          className="flex items-center gap-4 p-4"
          style={{ borderTop: "1px solid var(--site-border)" }}
        >
          <QuantityStepper label={product.name} value={quantity} onChange={setQuantity} />
          <button
            type="button"
            onClick={confirm}
            disabled={needsVariant}
            className={`${buttonClass} flex-1`}
            style={primaryButtonStyle}
          >
            Agregar · {formatCurrency(unitPrice * quantity, currency)}
          </button>
        </div>
      </div>
    </div>
  );
}
