"use client";

import { useEffect, useState, useTransition } from "react";
import { Button, Input } from "@/components/ui";
import type { Customer } from "@/modules/customers/server/queries";
import { searchCustomersForPos } from "../server/actions";

export interface PickedCustomer {
  readonly id: string;
  readonly name: string;
}

/**
 * Optional customer attachment. A walk-in cash sale needs nobody registered
 * (Phase 13, FR-1303) - this is a search over the existing customer book
 * (Phase 12), never a place to create one. Creating a customer stays on
 * `/clientes`.
 */
export function CustomerPicker({
  tenantSlug,
  selected,
  onSelect,
  onClear,
}: {
  tenantSlug: string;
  selected: PickedCustomer | null;
  onSelect: (customer: PickedCustomer) => void;
  onClear: () => void;
}) {
  const [term, setTerm] = useState("");
  const [results, setResults] = useState<readonly Customer[]>([]);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    // Nothing to fetch for a blank box - the dropdown itself only renders
    // once `term` is non-empty, so stale `results` sitting unused in state
    // is harmless until the next real search overwrites them.
    if (term.trim().length === 0) return;

    const timeout = setTimeout(() => {
      startTransition(async () => {
        const found = await searchCustomersForPos(tenantSlug, term);
        setResults(found);
      });
    }, 250);

    return () => clearTimeout(timeout);
  }, [term, tenantSlug]);

  if (selected !== null) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm">
        <span className="font-medium">{selected.name}</span>
        <Button type="button" variant="ghost" size="sm" onClick={onClear}>
          Quitar
        </Button>
      </div>
    );
  }

  return (
    <div className="relative flex flex-col gap-1">
      <Input
        placeholder="Buscar cliente (opcional)"
        value={term}
        onChange={(event) => setTerm(event.target.value)}
      />
      {term.trim().length > 0 ? (
        <div className="bg-popover absolute top-full z-10 mt-1 w-full rounded-md border shadow-md">
          {isPending ? (
            <p className="text-muted-foreground p-3 text-sm">Buscando…</p>
          ) : results.length === 0 ? (
            <p className="text-muted-foreground p-3 text-sm">Sin resultados.</p>
          ) : (
            <ul>
              {results.map((customer) => (
                <li key={customer.id}>
                  <button
                    type="button"
                    className="hover:bg-accent w-full px-3 py-2 text-left text-sm"
                    onClick={() => {
                      onSelect({ id: customer.id, name: customer.name });
                      setTerm("");
                      setResults([]);
                    }}
                  >
                    {customer.name}
                    {customer.docNumber !== null ? (
                      <span className="text-muted-foreground"> · {customer.docNumber}</span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
