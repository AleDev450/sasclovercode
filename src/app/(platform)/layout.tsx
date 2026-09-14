import type { ReactNode } from "react";
import Link from "next/link";
import { CloverMark } from "@/components/ui";
import { getCurrentUser } from "@/lib/auth/session";
import { requirePlatformAdmin } from "@/lib/platform/access";
import { APP_NAME } from "@/config/app";
import { SignOutButton } from "@/modules/auth";
import { getLeadCounts } from "@/modules/marketing/server/queries";
import { PlatformNav } from "@/modules/platform/components/platform-nav";

/**
 * The platform area gate, and its shell.
 *
 * `requirePlatformAdmin()` throws NotFoundError for anyone signed in who is not
 * an operator, so the area does not confirm its own existence. The proxy has
 * already required a session; this adds the second condition.
 *
 * It is a guard, not the only one: every Server Action re-checks, and every SQL
 * function checks a third time.
 *
 * WHY THE CONSOLE LOOKS DIFFERENT FROM THE TENANT DASHBOARD. It is deliberately
 * darker and carries the COMPANY mark rather than the product one. An operator
 * moves between this console and a tenant dashboard all day, and the two have
 * screens that look alike while meaning completely different things - "empresas"
 * here is every customer, "miembros" there is one customer's staff. The change
 * of surface is the reminder of which one you are in, and it is cheaper than
 * hoping somebody reads the breadcrumb.
 */
export default async function PlatformLayout({ children }: { children: ReactNode }) {
  await requirePlatformAdmin();

  /*
   * The lead counter is read HERE rather than inside the nav, so the sidebar
   * stays a client component with no data fetching of its own. It is one RPC
   * per navigation, against a table with an index on exactly this predicate.
   *
   * A failure must not take the console down: an operator who cannot see a
   * badge can still work, and an operator staring at an error page cannot. The
   * counter degrades to zero.
   */
  const [user, leadCounts] = await Promise.all([
    getCurrentUser(),
    getLeadCounts().catch(() => null),
  ]);

  return (
    <div className="bg-surface min-h-dvh">
      <header className="border-border bg-background/80 sticky top-0 z-40 border-b backdrop-blur-lg">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
          <Link href="/super-admin" className="flex items-center gap-2.5 rounded-lg">
            <CloverMark className="size-6" />
            <span className="text-sm font-semibold tracking-tight">
              {APP_NAME}
              <span className="text-muted-foreground font-normal"> · Plataforma</span>
            </span>
          </Link>

          <div className="flex items-center gap-3">
            <Link
              href="/super-admin/cuenta"
              className="text-muted-foreground hover:text-foreground hidden max-w-[16rem] truncate text-sm transition-colors sm:block"
            >
              {user?.fullName ?? user?.email ?? "Mi cuenta"}
            </Link>
            <SignOutButton />
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 md:flex-row md:gap-8">
        <aside className="md:w-52 md:shrink-0">
          {/*
            Sticky below the header on wide screens, so the console keeps its
            navigation while an operator reads a long list of charges.
          */}
          <div className="md:sticky md:top-20">
            <PlatformNav pendingLeads={leadCounts?.new ?? 0} />
          </div>
        </aside>

        <main className="min-w-0 flex-1 pb-12">{children}</main>
      </div>
    </div>
  );
}
