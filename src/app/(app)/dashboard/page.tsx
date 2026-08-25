import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge, Card, CardContent, CardHeader, CardTitle, EmptyState } from "@/components/ui";
import { getActiveMemberships } from "@/lib/auth/membership";
import { requireUser } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Mis empresas" };

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

/**
 * The entry point of the dashboard.
 *
 * Three outcomes, because a user can belong to zero, one or many businesses
 * (master section 11). With exactly one, showing a chooser of one item is a
 * step that asks the user to confirm something they have no choice about, so
 * this redirects instead.
 */
export default async function DashboardEntryPage() {
  await requireUser();
  const memberships = await getActiveMemberships();

  if (memberships.length === 0) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-2xl items-center px-6 py-12">
        <EmptyState
          className="w-full"
          titleAs="h1"
          title="Aun no perteneces a ninguna empresa"
          description="Cuando te asignen a una, aparecera aqui. Si esperabas tener acceso, contacta con quien administra tu negocio."
        />
      </main>
    );
  }

  if (memberships.length === 1) {
    redirect(`/dashboard/${memberships[0]!.tenantSlug}`);
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col gap-6 px-6 py-12">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Mis empresas</h1>
        <p className="text-muted-foreground text-sm">Elige con cual quieres trabajar.</p>
      </div>

      <ul className="flex flex-col gap-3">
        {memberships.map((membership) => (
          <li key={membership.tenantId}>
            <Link href={`/dashboard/${membership.tenantSlug}`} className="block">
              <Card className="hover:border-primary transition-colors">
                <CardHeader className="flex-row items-center justify-between gap-4 pb-6">
                  <div>
                    <CardTitle as="h2">{membership.tenantName}</CardTitle>
                    <p className="text-muted-foreground text-sm">{membership.tenantSlug}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {membership.tenantStatus === "suspended" ? (
                      <Badge variant="warning">Suspendida</Badge>
                    ) : null}
                    <Badge>{ROLE_LABEL[membership.role] ?? membership.role}</Badge>
                  </div>
                </CardHeader>
                <CardContent className="sr-only">Entrar a {membership.tenantName}</CardContent>
              </Card>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
