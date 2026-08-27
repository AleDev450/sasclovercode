"use client";

import Link from "next/link";
import { useState } from "react";
import { Button, Card } from "@/components/ui";
import { addToCart, lineTotalCents, removeFromCart, setCartQuantity, type CartLine } from "../cart";
import { CartPanel } from "./cart-panel";
import { type CompletedSale, CheckoutPanel, type PosOpenSession, type PosPaymentMethod } from "./checkout-panel";
import { CustomerPicker, type PickedCustomer } from "./customer-picker";
import { ProductGrid, type PosCategory, type PosProduct } from "./product-grid";
import { PrintButton } from "./print-button";
import { Receipt } from "./receipt";

export interface PosLocationOption {
  readonly id: string;
  readonly name: string;
}

/**
 * The whole POS screen: product browser on the left, cart + checkout on the
 * right. Cart state is `useState` only - nothing is written until checkout
 * actually succeeds (ADR-019). A refresh loses an in-progress sale; see the
 * SPEC's Known Limitations.
 */
export function PosScreen({
  tenantSlug,
  locationId,
  locationName,
  showLocationSwitcher,
  locations,
  categories,
  products,
  currency,
  canCheckout,
  paymentMethods,
  openSessions,
}: {
  tenantSlug: string;
  locationId: string;
  locationName: string;
  showLocationSwitcher: boolean;
  locations: readonly PosLocationOption[];
  categories: readonly PosCategory[];
  products: readonly PosProduct[];
  currency: string;
  canCheckout: boolean;
  paymentMethods: readonly PosPaymentMethod[];
  openSessions: readonly PosOpenSession[];
}) {
  const [cart, setCart] = useState<readonly CartLine[]>([]);
  const [customer, setCustomer] = useState<PickedCustomer | null>(null);
  const [completedSale, setCompletedSale] = useState<CompletedSale | null>(null);

  const totalCents = cart.reduce((sum, line) => sum + Math.round(line.unitPriceCents * line.quantity), 0);

  function reset() {
    setCart([]);
    setCustomer(null);
    setCompletedSale(null);
  }

  if (completedSale !== null) {
    return (
      <div className="mx-auto flex max-w-md flex-col gap-4">
        <Receipt
          orderNumber={completedSale.orderNumber}
          locationName={locationName}
          customerName={customer?.name ?? null}
          lines={cart.map((line) => ({
            name: line.name,
            variantName: line.variantName,
            quantity: line.quantity,
            unitPriceCents: line.unitPriceCents,
            totalCents: lineTotalCents(line),
          }))}
          totalCents={totalCents}
          currency={currency}
        />
        {completedSale.paymentErrors.length > 0 ? (
          <div className="border-destructive text-destructive rounded-md border p-3 text-sm">
            {completedSale.paymentErrors.map((message, index) => (
              <p key={index}>{message}</p>
            ))}
          </div>
        ) : null}
        <div className="flex gap-2 print:hidden">
          <PrintButton />
          <Button type="button" onClick={reset}>
            Nueva venta
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-8rem)] flex-col gap-4">
      {showLocationSwitcher ? (
        <div className="flex flex-wrap items-center gap-2 print:hidden">
          <span className="text-muted-foreground text-sm">Sede:</span>
          {locations.map((location) => (
            <Link
              key={location.id}
              href={`/dashboard/${tenantSlug}/pos?sede=${location.id}`}
              className={`rounded-full border px-3 py-1 text-sm ${
                location.id === locationId ? "bg-primary text-primary-foreground" : "hover:bg-accent"
              }`}
            >
              {location.name}
            </Link>
          ))}
        </div>
      ) : null}

      <div className="grid flex-1 grid-cols-1 gap-4 overflow-hidden lg:grid-cols-[1fr_22rem]">
        <div className="min-h-0 overflow-y-auto">
          <ProductGrid
            categories={categories}
            products={products}
            currency={currency}
            onAdd={(line) => setCart((current) => addToCart(current, line))}
          />
        </div>

        <Card className="flex min-h-0 flex-col gap-4 overflow-y-auto p-4">
          <CustomerPicker
            tenantSlug={tenantSlug}
            selected={customer}
            onSelect={setCustomer}
            onClear={() => setCustomer(null)}
          />

          <CartPanel
            lines={cart}
            currency={currency}
            onSetQuantity={(key, quantity) => setCart((current) => setCartQuantity(current, key, quantity))}
            onRemove={(key) => setCart((current) => removeFromCart(current, key))}
          />

          <CheckoutPanel
            tenantSlug={tenantSlug}
            locationId={locationId}
            cart={cart}
            customerId={customer?.id ?? null}
            totalCents={totalCents}
            currency={currency}
            canCheckout={canCheckout}
            paymentMethods={paymentMethods}
            openSessions={openSessions}
            onComplete={setCompletedSale}
          />
        </Card>
      </div>
    </div>
  );
}
