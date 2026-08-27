import { formatCurrency } from "@/lib/money";

export interface ReceiptLine {
  readonly name: string;
  readonly variantName: string | null;
  readonly quantity: number;
  readonly unitPriceCents: number;
  readonly totalCents: number;
}

export interface ReceiptPayment {
  readonly methodName: string;
  readonly amountCents: number;
}

/**
 * A printable ticket, built with `@media print` rather than any printer
 * integration (ADR-013's reasoning, reapplied: no hardware exists in this
 * environment to write or verify an ESC/POS or WebUSB path against). The
 * cashier's browser print dialog sends this to whatever printer the terminal
 * has configured, thermal or otherwise.
 *
 * Explicitly not a SUNAT document - Phase 17 owns those. Said so on the
 * ticket itself so nobody mistakes one for the other.
 */
export function Receipt({
  orderNumber,
  locationName,
  customerName,
  lines,
  totalCents,
  currency,
  placedAt,
  payments,
}: {
  orderNumber: number;
  locationName: string;
  customerName: string | null;
  lines: readonly ReceiptLine[];
  totalCents: number;
  currency: string;
  placedAt?: string;
  payments?: readonly ReceiptPayment[];
}) {
  return (
    <div className="border-border rounded-lg border p-4 font-mono text-sm print:border-none print:p-0">
      <div className="mb-3 flex flex-col items-center gap-0.5 text-center">
        <p className="font-semibold">{locationName}</p>
        <p className="text-muted-foreground text-xs">Pedido #{orderNumber}</p>
        <p className="text-muted-foreground text-xs">
          {(placedAt !== undefined ? new Date(placedAt) : new Date()).toLocaleString("es-PE")}
        </p>
        {customerName !== null ? <p className="text-xs">Cliente: {customerName}</p> : null}
      </div>

      <div className="border-border border-t border-dashed py-2">
        {lines.map((line, index) => (
          <div key={index} className="flex justify-between gap-2">
            <span className="min-w-0 truncate">
              {line.quantity} × {line.name}
              {line.variantName !== null ? ` (${line.variantName})` : ""}
            </span>
            <span className="tabular-nums">{formatCurrency(line.totalCents, currency)}</span>
          </div>
        ))}
      </div>

      <div className="border-border flex justify-between border-t border-dashed pt-2 font-semibold">
        <span>Total</span>
        <span className="tabular-nums">{formatCurrency(totalCents, currency)}</span>
      </div>

      {payments !== undefined && payments.length > 0 ? (
        <div className="border-border mt-2 border-t border-dashed pt-2">
          {payments.map((payment, index) => (
            <div key={index} className="flex justify-between text-xs">
              <span>{payment.methodName}</span>
              <span className="tabular-nums">{formatCurrency(payment.amountCents, currency)}</span>
            </div>
          ))}
        </div>
      ) : null}

      <p className="text-muted-foreground mt-3 text-center text-[10px]">
        Documento interno — no es comprobante de pago.
      </p>
    </div>
  );
}
