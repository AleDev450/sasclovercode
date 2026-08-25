import type { ReactNode } from "react";
import Link from "next/link";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui";
import { getMyMemberships } from "@/lib/auth/membership";
import { getCurrentUser } from "@/lib/auth/session";
import { getMyPermissions } from "@/lib/permissions/check";
import { requireActiveTenant } from "@/lib/tenant/active";
import { SignOutButton } from "@/modules/auth";
import { DashboardNav } from "@/modules/dashboard/components/dashboard-nav";
import { TenantSwitcher } from "@/modules/dashboard/components/tenant-switcher";
import { visibleNavItems } from "@/modules/dashboard/navigation";

/**
 * The tenant-scoped shell.
 *
 * `requireActiveTenant` is what turns a URL segment into an authorised context:
 * it matches the slug against the caller's own memberships and 404s otherwise.
 * It is a guard, not the guard - every page below repeats the check it needs,
 * because the layout is not what a typed URL hits first in every case.
 */
export default async function TenantLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  const tenant = await requireActiveTenant(tenantSlug);

  const [user, memberships, permissions] = await Promise.all([
    getCurrentUser(),
    getMyMemberships(),
    getMyPermissions(tenant.id),
  ]);

  const navItems = visibleNavItems(permissions);

  return (
    <div className="min-h-dvh">
      <header className="border-border border-b">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-4">
          <div className="flex flex-col gap-1">
            <Link href={`/dashboard/${tenant.slug}`} className="text-sm font-semibold">
              {tenant.name}
            </Link>
            <TenantSwitcher memberships={memberships} activeSlug={tenant.slug} />
          </div>

          <div className="flex items-center gap-4">
            <Link
              href="/dashboard/perfil"
              className="text-muted-foreground hover:text-foreground text-sm"
            >
              {user?.fullName ?? user?.email ?? "Perfil"}
            </Link>
            <SignOutButton />
          </div>
        </div>
      </header>

      {tenant.status === "suspended" ? (
        <div className="mx-auto max-w-6xl px-6 pt-6">
          <Alert variant="warning">
            <AlertTitle>Empresa suspendida</AlertTitle>
            <AlertDescription>
              Esta empresa esta suspendida. Contacta con CloverCode para reactivarla.
            </AlertDescription>
          </Alert>
        </div>
      ) : null}

      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-6 md:flex-row md:gap-10">
        <aside className="md:w-48 md:shrink-0">
          <DashboardNav tenantSlug={tenant.slug} items={navItems} />
        </aside>
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
