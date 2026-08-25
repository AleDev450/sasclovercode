import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui";
import { CreateTenantForm } from "@/modules/platform/components/create-tenant-form";

export const metadata = { title: "Crear empresa" };

export default function NewTenantPage() {
  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Crear empresa</h1>
        <p className="text-muted-foreground text-sm">
          Se creara la empresa, su dominio de sistema y su propietario en una sola operacion.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle as="h2">Datos de la empresa</CardTitle>
          <CardDescription>
            Si algo falla, no se crea nada: la operacion es atomica.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CreateTenantForm />
        </CardContent>
      </Card>
    </div>
  );
}
