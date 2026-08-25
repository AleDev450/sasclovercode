import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui";
import { getMyPermissions } from "@/lib/permissions/check";
import { requireActiveTenant } from "@/lib/tenant/active";

export async function generateMetadata({ params }: { params: Promise<{ tenantSlug: string }> }) {
  const { tenantSlug } = await params;
  const tenant = await requireActiveTenant(tenantSlug);
  return { title: tenant.name };
}

const ROLE_LABEL: Record<string, string> = {
  owner: "Propietario",
  admin: "Administrador",
  manager: "Encargado",
  cashier: "Cajero",
  waiter: "Mesero",
  kitchen: "Cocina",
  delivery: "Repartidor",
  accountant: "Contador",
};

export default async function TenantHomePage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  // Repeated on purpose: the layout is not the only way into this page.
  const tenant = await requireActiveTenant(tenantSlug);
  const permissions = await getMyPermissions(tenant.id);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{tenant.name}</h1>
        <p className="text-muted-foreground text-sm">
          Tu rol aqui: {ROLE_LABEL[tenant.role] ?? tenant.role}
        </p>
      </div>

      <div className="grid gap-6 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle as="h2">Dominio</CardTitle>
            <CardDescription>Direccion publica de la empresa.</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="font-mono text-sm">{tenant.slug}.clovercodeapp.com</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle as="h2">Tus permisos</CardTitle>
            <CardDescription>Lo que tu rol te permite hacer aqui.</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold tabular-nums">{permissions.size}</p>
            <p className="text-muted-foreground text-sm">permisos concedidos</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle as="h2">Modulos del negocio</CardTitle>
          <CardDescription>
            Catalogo, pedidos, punto de venta e inventario llegan en las fases 10 en adelante.
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}
