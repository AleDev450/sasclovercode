import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui";
import { APP_DESCRIPTION, APP_NAME } from "@/config/app";

/**
 * Phase 00 landing page.
 *
 * Deliberately minimal: no business functionality exists yet. Phase 05 replaces
 * this route with the authenticated dashboard shell, and the public tenant
 * website is served from the hostname-resolved routes added in Phase 01.
 */
export default function HomePage() {
  const foundations = [
    { name: "TypeScript estricto", detail: "strict + noUncheckedIndexedAccess" },
    { name: "Errores de dominio", detail: "9 tipos, mensaje publico seguro" },
    { name: "Logging estructurado", detail: "JSON + redaccion de secretos" },
    { name: "Validacion", detail: "Zod en el limite de entrada" },
    { name: "Supabase", detail: "clientes browser y server tipados" },
    { name: "Sistema UI", detail: "primitivas accesibles + estados" },
  ];

  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col justify-center gap-8 px-6 py-16">
      <header className="flex flex-col gap-3">
        <Badge variant="success" className="self-start">
          Fase 00 &middot; Foundation
        </Badge>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{APP_NAME}</h1>
        <p className="text-muted-foreground max-w-prose text-base">{APP_DESCRIPTION}</p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Cimientos tecnicos activos</CardTitle>
          <CardDescription>
            Capas transversales disponibles para todas las fases siguientes.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-4 sm:grid-cols-2">
            {foundations.map((item) => (
              <div key={item.name} className="flex flex-col gap-0.5">
                <dt className="text-sm font-medium">{item.name}</dt>
                <dd className="text-muted-foreground text-sm">{item.detail}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>

      <p className="text-muted-foreground text-sm">
        Multi-tenancy, autenticacion y autorizacion se implementan en las fases 01 a 03.
      </p>
    </main>
  );
}
