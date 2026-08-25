"use client";

/**
 * Last-resort boundary: catches errors thrown by the root layout itself.
 *
 * It must render its own <html> and <body> because the failing layout never
 * produced them. It also cannot rely on the design tokens from globals.css,
 * since the failure may have happened before that stylesheet applied - hence
 * the inline styles.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="es">
      <body
        style={{
          fontFamily: "system-ui, sans-serif",
          display: "flex",
          minHeight: "100dvh",
          alignItems: "center",
          justifyContent: "center",
          margin: 0,
          padding: "1.5rem",
        }}
      >
        <main style={{ maxWidth: "32rem" }}>
          <h1 style={{ fontSize: "1.25rem", marginBottom: "0.5rem" }}>Error inesperado</h1>
          <p style={{ marginBottom: "1rem", lineHeight: 1.5 }}>
            La aplicacion no pudo iniciarse correctamente.
            {error.digest ? ` Codigo de referencia: ${error.digest}.` : ""}
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              padding: "0.5rem 1rem",
              borderRadius: "0.375rem",
              border: "1px solid currentColor",
              background: "transparent",
              cursor: "pointer",
            }}
          >
            Reintentar
          </button>
        </main>
      </body>
    </html>
  );
}
