"use client";

/**
 * Nuestra carta: every dish, filterable by category, addable to the cart.
 *
 * With "Todos" selected the menu reads as a printed carta - each category under
 * its own heading, in the owner's order. With a category selected it is just
 * that category. Either way, a product with nothing to choose goes straight into
 * the cart; one with presentations or extras opens the dialog.
 *
 * Sold out today is shown, dimmed, and cannot be added. Hiding it would tell a
 * regular that the restaurant stopped making their dish.
 */

import { useState } from "react";
import { IconCheck, IconPlus } from "@/components/ui/icons";
import { formatCurrency } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { MenuCategory, MenuProduct } from "../server/queries";
import { useCart } from "./cart-provider";
import { ProductDialog, type ProductChoice } from "./product-dialog";
import { displayStyle, eyebrowStyle, mutedStyle, subtleStyle } from "./site-styles";

export interface MenuProductView extends MenuProduct {
  readonly imageUrl: string | null;
}

const ALL = "__todos__";

export function MenuBrowser({
  categories,
  products,
  currency,
}: {
  categories: readonly MenuCategory[];
  products: readonly MenuProductView[];
  currency: string;
}) {
  const cart = useCart();
  const [filter, setFilter] = useState<string>(ALL);
  const [choosing, setChoosing] = useState<MenuProductView | null>(null);
  const [justAdded, setJustAdded] = useState<string | null>(null);

  // Only categories that have something in them; the uncategorised at the end.
  const groups = [
    ...categories.map((category) => ({
      id: category.id,
      name: category.name,
      description: category.description,
      products: products.filter((product) => product.categoryId === category.id),
    })),
    {
      id: "__otros__",
      name: "Otros",
      description: null,
      products: products.filter(
        (product) =>
          product.categoryId === null ||
          !categories.some((category) => category.id === product.categoryId),
      ),
    },
  ].filter((group) => group.products.length > 0);

  const visible = filter === ALL ? groups : groups.filter((group) => group.id === filter);

  const flash = (productId: string) => {
    setJustAdded(productId);
    window.setTimeout(
      () => setJustAdded((current) => (current === productId ? null : current)),
      1400,
    );
  };

  const addDirect = (product: MenuProductView) => {
    cart.add({
      productId: product.id,
      variantId: null,
      optionIds: [],
      name: product.name,
      detail: "",
      unitPriceCents: product.basePriceCents,
    });
    flash(product.id);
  };

  const addChosen = (product: MenuProductView, choice: ProductChoice) => {
    cart.add({
      productId: product.id,
      variantId: choice.variantId,
      optionIds: choice.optionIds,
      quantity: choice.quantity,
      name: product.name,
      detail: choice.detail,
      unitPriceCents: choice.unitPriceCents,
    });
    setChoosing(null);
    flash(product.id);
  };

  if (groups.length === 0) {
    return (
      <p className="py-16 text-center" style={mutedStyle}>
        Nuestra carta se está preparando. Vuelve pronto.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-12">
      {groups.length > 1 ? (
        <div
          role="toolbar"
          aria-label="Filtrar por categoría"
          className="sticky top-18 z-20 -mx-6 flex gap-2 overflow-x-auto px-6 py-3 sm:-mx-10 sm:flex-wrap sm:justify-center sm:px-10"
          style={{ background: "color-mix(in srgb, var(--site-background) 92%, transparent)" }}
        >
          {[{ id: ALL, name: "Todos" }, ...groups].map((group) => {
            const active = filter === group.id;
            return (
              <button
                key={group.id}
                type="button"
                onClick={() => setFilter(group.id)}
                aria-pressed={active}
                className="shrink-0 px-5 py-2.5 text-xs font-semibold whitespace-nowrap transition-colors"
                style={{
                  borderRadius: "var(--site-radius-chip)",
                  border: `1px solid ${active ? "var(--site-primary)" : "var(--site-border-strong)"}`,
                  background: active ? "var(--site-primary)" : "transparent",
                  color: active ? "var(--site-on-primary)" : "var(--site-foreground)",
                  letterSpacing: "var(--site-eyebrow-tracking)",
                  textTransform: "var(--site-eyebrow-transform)" as "uppercase",
                }}
              >
                {group.name}
              </button>
            );
          })}
        </div>
      ) : null}

      {visible.map((group) => (
        <section
          key={group.id}
          aria-labelledby={`categoria-${group.id}`}
          className="flex flex-col gap-8"
        >
          <div className="flex flex-col gap-2">
            <h2
              id={`categoria-${group.id}`}
              style={{ ...displayStyle, fontSize: "var(--site-display-size)" }}
            >
              {group.name}
            </h2>
            {group.description !== null ? (
              <p className="max-w-prose text-sm" style={mutedStyle}>
                {group.description}
              </p>
            ) : null}
          </div>

          <ul className="grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
            {group.products.map((product) => {
              const choosable = product.variants.length > 0 || product.options.length > 0;
              const fromPrice =
                product.variants.length > 0
                  ? Math.min(...product.variants.map((variant) => variant.priceCents))
                  : product.basePriceCents;
              const added = justAdded === product.id;

              return (
                <li
                  key={product.id}
                  id={`producto-${product.id}`}
                  className={cn(
                    "flex scroll-mt-40 flex-col gap-4",
                    !product.isAvailable && "opacity-60",
                  )}
                >
                  <div
                    className="relative overflow-hidden"
                    style={{
                      borderRadius: "var(--site-radius)",
                      boxShadow: "var(--site-shadow)",
                      border: "1px solid var(--site-border)",
                    }}
                  >
                    {product.imageUrl !== null ? (
                      /* eslint-disable-next-line @next/next/no-img-element -- signed Storage URL */
                      <img
                        src={product.imageUrl}
                        alt={product.name}
                        loading="lazy"
                        className="w-full object-cover"
                        style={{ aspectRatio: "var(--site-media-ratio)" }}
                      />
                    ) : (
                      <div
                        aria-hidden
                        className="w-full"
                        style={{
                          aspectRatio: "var(--site-media-ratio)",
                          background: "var(--site-accent-soft)",
                        }}
                      />
                    )}

                    {product.isFeatured ? (
                      <span
                        className="absolute top-3 left-3 px-3 py-1 text-[0.625rem] font-semibold"
                        style={{
                          ...eyebrowStyle,
                          background: "var(--site-accent)",
                          color: "var(--site-on-accent)",
                          borderRadius: "var(--site-radius-chip)",
                        }}
                      >
                        Recomendado
                      </span>
                    ) : null}
                    {!product.isAvailable ? (
                      <span
                        className="absolute top-3 right-3 px-3 py-1 text-[0.625rem] font-semibold"
                        style={{
                          ...eyebrowStyle,
                          background: "var(--site-background)",
                          color: "var(--site-muted)",
                          borderRadius: "var(--site-radius-chip)",
                        }}
                      >
                        Agotado hoy
                      </span>
                    ) : null}
                  </div>

                  <div className="flex flex-1 flex-col gap-2">
                    <h3 className="text-lg leading-snug" style={displayStyle}>
                      {product.name}
                    </h3>
                    {product.description !== null ? (
                      <p className="text-sm leading-relaxed" style={mutedStyle}>
                        {product.description}
                      </p>
                    ) : null}

                    <div className="mt-auto flex items-center justify-between gap-3 pt-3">
                      <span
                        className="text-lg font-semibold tabular-nums"
                        style={{ color: "var(--site-primary)" }}
                      >
                        {product.variants.length > 1 ? (
                          <span className="mr-1 text-xs font-normal" style={subtleStyle}>
                            Desde
                          </span>
                        ) : null}
                        {formatCurrency(fromPrice, currency)}
                      </span>

                      <button
                        type="button"
                        disabled={!product.isAvailable}
                        onClick={() => (choosable ? setChoosing(product) : addDirect(product))}
                        className="flex size-12 shrink-0 items-center justify-center rounded-full transition-transform hover:scale-110 disabled:pointer-events-none disabled:opacity-40"
                        style={{
                          background: added ? "#16a34a" : "var(--site-primary)",
                          color: added ? "#ffffff" : "var(--site-on-primary)",
                          boxShadow: "var(--site-shadow)",
                        }}
                        aria-label={
                          choosable
                            ? `Elegir opciones de ${product.name}`
                            : `Agregar ${product.name} al carrito`
                        }
                      >
                        {added ? <IconCheck className="size-5" /> : <IconPlus className="size-5" />}
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      <p aria-live="polite" className="sr-only">
        {justAdded !== null ? "Agregado al carrito." : ""}
      </p>

      {choosing !== null ? (
        <ProductDialog
          product={choosing}
          imageUrl={choosing.imageUrl}
          currency={currency}
          onClose={() => setChoosing(null)}
          onConfirm={(choice) => addChosen(choosing, choice)}
        />
      ) : null}
    </div>
  );
}
