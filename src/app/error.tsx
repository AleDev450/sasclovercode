"use client";

import { useEffect } from "react";
import { Alert, AlertDescription, AlertTitle, Button } from "@/components/ui";

/**
 * Route-level error boundary.
 *
 * Next.js already strips the original message in production builds and gives
 * the client only a `digest`. We surface that digest so a user can quote it to
 * support, and it correlates with the server log line.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Phase 24 wires this to the error tracker. Until then the browser console
    // is the only sink available on the client.
    console.error("app.error.boundary", { digest: error.digest });
  }, [error]);

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col items-start justify-center gap-6 px-6 py-16">
      <Alert variant="destructive">
        <AlertTitle>Algo salio mal</AlertTitle>
        <AlertDescription>
          No pudimos completar la operacion. Intentalo nuevamente en unos segundos.
          {error.digest ? (
            <>
              {" "}
              Codigo de referencia: <code className="font-mono text-xs">{error.digest}</code>
            </>
          ) : null}
        </AlertDescription>
      </Alert>
      <Button onClick={reset}>Reintentar</Button>
    </main>
  );
}
