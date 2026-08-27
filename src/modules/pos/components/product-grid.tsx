"use client";

import { useMemo, useState } from "react";
import { Input } from "@/components/ui";
import { formatCurrency } from "@/lib/money";
import type { CartLine } from "../cart";

export interface PosCategory {
  readonly id: string;
  readonly name: string;
}

export interface PosVariant {
  readonly id: string;
  readonly name: string;
  readonly priceCents: number;
}

export interface PosProduct {
  readonly id: string;
  readonly categoryId: string | null;
  readonly name: string;
  readonly basePriceCents: number;
  readonly isAvailable: boolean;
  readonly variants: readonly PosVariant[];
}

/**
 * Search and category filtering happen entirely client-side, over a
 * catalogue already fetched whole by the page (`listProductsWithVariants`).
 * Phase 11's own comment on `listProducts` is why: a business's catalogue is
 * small enough that a round trip per keystroke would be slower than the
 * browser just filtering the array it already has - unlike customer search
 * (Phase 12), which stays server-side because that table gets large.
 */
export function ProductGrid({
  categories,
  products,
  currency,
  onAdd,
}: {
  categories: readonly PosCategory[];
  products: readonly PosProduct[];
  currency: string;
  onAdd: (line: CartLine) => void;
}) {
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState<string | "all">("all");
  const [openVariantsFor, setOpenVariantsFor] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return products.filter((product) => {
      if (activeCategory !== "all" && product.categoryId !== activeCategory) return false;
      if (term.length === 0) return true;
      return product.name.toLowerCase().includes(term);
    });
  }, [products, search, activeCategory]);

  function addSimple(product: PosProduct) {
    onAdd({
      productId: product.id,
      variantId: null,
      name: product.name,
      variantName: null,
      unitPriceCents: product.basePriceCents,
      quantity: 1,
    });
  }

  function addVariant(product: PosProduct, variant: PosVariant) {
    onAdd({
      productId: product.id,
      variantId: variant.id,
      name: product.name,
      variantName: variant.name,
      unitPriceCents: variant.priceCents,
      quantity: 1,
    });
    setOpenVariantsFor(null);
  }

  return (
    <div className="flex h-full flex-col gap-3">
      <Input
        placeholder="Buscar producto…"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        className="h-11 text-base"
      />

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setActiveCategory("all")}
          className={`rounded-full border px-4 py-2 text-sm font-medium ${
            activeCategory === "all" ? "bg-primary text-primary-foreground" : "hover:bg-accent"
          }`}
        >
          Todo
        </button>
        {categories.map((category) => (
          <button
            key={category.id}
            type="button"
            onClick={() => setActiveCategory(category.id)}
            className={`rounded-full border px-4 py-2 text-sm font-medium ${
              activeCategory === category.id ? "bg-primary text-primary-foreground" : "hover:bg-accent"
            }`}
          >
            {category.name}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3 overflow-y-auto sm:grid-cols-3 lg:grid-cols-4">
        {filtered.map((product) => (
          <div key={product.id} className="relative">
            <button
              type="button"
              disabled={!product.isAvailable}
              onClick={() =>
                product.variants.length > 0
                  ? setOpenVariantsFor(openVariantsFor === product.id ? null : product.id)
                  : addSimple(product)
              }
              className="border-border bg-card hover:bg-accent flex min-h-24 w-full flex-col justify-between rounded-lg border p-3 text-left disabled:cursor-not-allowed disabled:opacity-40"
            >
              <span className="text-sm font-medium">{product.name}</span>
              <span className="tabular-nums text-sm">
                {product.variants.length > 0
                  ? "Elegir…"
                  : formatCurrency(product.basePriceCents, currency)}
              </span>
            </button>

            {openVariantsFor === product.id ? (
              <div className="bg-popover absolute top-full z-10 mt-1 w-full min-w-40 rounded-md border shadow-md">
                {product.variants.map((variant) => (
                  <button
                    key={variant.id}
                    type="button"
                    onClick={() => addVariant(product, variant)}
                    className="hover:bg-accent flex w-full items-center justify-between px-3 py-2 text-left text-sm"
                  >
                    <span>{variant.name}</span>
                    <span className="tabular-nums">{formatCurrency(variant.priceCents, currency)}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ))}

        {filtered.length === 0 ? (
          <p className="text-muted-foreground col-span-full py-8 text-center text-sm">
            Sin resultados.
          </p>
        ) : null}
      </div>
    </div>
  );
}
