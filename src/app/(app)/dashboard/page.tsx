import type { Metadata } from "next";
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
} from "@/components/ui";
import { getActiveMemberships } from "@/lib/auth/membership";
import { requireUser } from "@/lib/auth/session";
import { SignOutButton } from "@/modules/auth";

export const metadata: Metadata = {
  title: "Panel",
};

/**
 * Placeholder authenticated area for Phase 02.
 *
 * Its purpose is to prove the phase end to end: a session exists, it is
 * verified on the server, and the memberships it grants are readable. The real
 * dashboard - navigation, tenant switcher, modules - is Phase 05.
 *
 * `requireUser()` runs even though `src/proxy.ts` already redirected anonymous
 * traffic. The proxy is a matcher over paths; this is the check that holds if
 * the matcher is ever changed.
 */
export default async function DashboardPage() {
  const user = await requireUser();
  const memberships = await getActiveMemberships();

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col gap-8 px-6 py-12">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">{user.fullName ?? "Bienvenido"}</h1>
          <p className="text-muted-foreground text-sm">{user.email}</p>
        </div>
        <SignOutButton />
      </header>

      <Card>
        <CardHeader>
          <CardTitle as="h2">Tus negocios</CardTitle>
          <CardDescription>Empresas en las que tienes acceso activo.</CardDescription>
        </CardHeader>
        <CardContent>
          {memberships.length === 0 ? (
            // Master section 35: never an empty area with no explanation.
            <EmptyState
              title="Aun no perteneces a ningun negocio"
              description="Cuando el administrador de una empresa te agregue como miembro, aparecera aqui."
            />
          ) : (
            <ul className="flex flex-col gap-3">
              {memberships.map((membership) => (
                <li
                  key={membership.id}
                  className="border-input flex items-center justify-between gap-4 rounded-md border px-4 py-3"
                >
                  <div className="flex flex-col gap-0.5">
                    <span className="text-sm font-medium">{membership.tenantName}</span>
                    <span className="text-muted-foreground text-xs">{membership.tenantSlug}</span>
                  </div>
                  <Badge variant="neutral">{membership.role}</Badge>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <p className="text-muted-foreground text-sm">
        El panel completo (navegacion, selector de negocio y modulos) se implementa en la Fase 05.
      </p>
    </main>
  );
}
