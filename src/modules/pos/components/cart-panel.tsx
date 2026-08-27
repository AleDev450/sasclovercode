"use client";

import { Button } from "@/components/ui";
import { formatCurrency } from "@/lib/money";
import { cartLineKey, cartTotalCents, lineTotalCents, type CartLine } from "../cart";

export function CartPanel({
  lines,
  currency,
  onSetQuantity,
  onRemove,
}: {
  lines: readonly CartLine[];
  currency: string;
  onSetQuantity: (key: string, quantity: number) => void;
  onRemove: (key: string) => void;
}) {
  if (lines.length === 0) {
    return <p className="text-muted-foreground py-6 text-center text-sm">El carrito esta vacio.</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-2">
        {lines.map((line) => {
          const key = cartLineKey(line.productId, line.variantId);
          return (
            <li key={key} className="flex items-center justify-between gap-2 text-sm">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{line.name}</p>
                {line.variantName !== null ? (
                  <p className="text-muted-foreground truncate text-xs">{line.variantName}</p>
                ) : null}
              </div>

              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label={`Quitar una unidad de ${line.name}`}
                  onClick={() => onSetQuantity(key, line.quantity - 1)}
                >
                  −
                </Button>
                <span className="w-6 text-center tabular-nums">{line.quantity}</span>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label={`Anadir una unidad de ${line.name}`}
                  onClick={() => onSetQuantity(key, line.quantity + 1)}
                >
                  +
                </Button>
              </div>

              <span className="w-20 text-right tabular-nums">
                {formatCurrency(lineTotalCents(line), currency)}
              </span>

              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Quitar ${line.name} del carrito`}
                onClick={() => onRemove(key)}
              >
                ×
              </Button>
            </li>
          );
        })}
      </ul>

      <div className="flex items-center justify-between border-t pt-3 text-base font-semibold">
        <span>Total</span>
        <span className="tabular-nums">{formatCurrency(cartTotalCents(lines), currency)}</span>
      </div>
    </div>
  );
}
