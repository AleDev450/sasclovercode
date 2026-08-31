import type { ReactNode } from "react";
import Link from "next/link";
import { requirePlatformAdmin } from "@/lib/platform/access";
import { APP_NAME } from "@/config/app";

/**
 * The platform area gate.
 *
 * `requirePlatformAdmin()` throws NotFoundError for anyone signed in who is not
 * an operator, so the area does not confirm its own existence. The proxy has
 * already required a session; this adds the second condition.
 *
 * It is a guard, not the only one: every Server Action re-checks, and every SQL
 * function checks a third time.
 */
export default async function PlatformLayout({ children }: { children: ReactNode }) {
  await requirePlatformAdmin();

  return (
    <div className="min-h-dvh">
      <header className="border-border border-b">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-4">
          <Link href="/super-admin/tenants" className="text-sm font-semibold">
            {APP_NAME} <span className="text-muted-foreground">· Plataforma</span>
          </Link>
          <nav aria-label="Plataforma" className="flex items-center gap-4">
            <Link
              href="/super-admin/tenants"
              className="text-muted-foreground hover:text-foreground text-sm"
            >
              Empresas
            </Link>
            <Link
              href="/super-admin/facturacion"
              className="text-muted-foreground hover:text-foreground text-sm"
            >
              Cobranza
            </Link>
            <Link
              href="/super-admin/diagnostico"
              className="text-muted-foreground hover:text-foreground text-sm"
            >
              Diagnostico
            </Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
    </div>
  );
}
