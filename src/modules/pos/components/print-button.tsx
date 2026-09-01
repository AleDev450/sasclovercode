"use client";

import { Button } from "@/components/ui";

export function PrintButton() {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="print:hidden"
      onClick={() => window.print()}
    >
      Imprimir
    </Button>
  );
}
