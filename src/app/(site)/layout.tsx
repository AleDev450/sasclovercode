import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui";
import { getPublicNavigation } from "@/modules/cms/server/public-queries";
import { getSiteContext } from "@/modules/cms/server/site-context";

/**
 * The public website of a tenant.
 *
 * A route group of its own: this is not the dashboard. It shares no header, no
 * session and no navigation with it - a visitor here is anonymous, and the
 * layout must not accidentally imply otherwise.
 *
 * The tenant comes from the hostname (Phase 01). If no business owns the
 * hostname there is nothing to render, so the request is a 404: the platform
 * does not have a generic homepage to fall back to.
 */
export default async function SiteLayout({ children }: { children: ReactNode }) {
  const site = await getSiteContext();
  if (site === null) notFound();

  // A suspended business resolves - so its owner sees WHY rather than a bare
  // 404 - but serves no content. The navbar is not even fetched.
  if (!site.isServing) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-xl items-center px-6 py-16">
        <Alert variant="warning">
          <AlertTitle>Sitio no disponible</AlertTitle>
          <AlertDescription>
            {site.tenant.name} no esta disponible en este momento.
          </AlertDescription>
        </Alert>
      </main>
    );
  }

  const navigation = await getPublicNavigation(site.tenant.id);

  return (
    <div className="min-h-dvh">
      <header className="border-border border-b">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4 px-6 py-4">
          <Link href="/sitio" className="text-base font-semibold">
            {site.tenant.name}
          </Link>

          {navigation.length > 0 ? (
            <nav aria-label="Principal">
              <ul className="flex flex-wrap items-center gap-5">
                {navigation.map((item) => (
                  <li key={item.id} className="relative">
                    <Link href={item.href} className="text-sm hover:underline">
                      {item.label}
                    </Link>
                    {item.children.length > 0 ? (
                      <ul className="mt-1 flex flex-col gap-1">
                        {item.children.map((child) => (
                          <li key={child.id}>
                            <Link
                              href={child.href}
                              className="text-muted-foreground text-xs hover:underline"
                            >
                              {child.label}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </li>
                ))}
              </ul>
            </nav>
          ) : null}
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6">{children}</main>

      <footer className="border-border mt-16 border-t">
        <div className="text-muted-foreground mx-auto max-w-5xl px-6 py-8 text-xs">
          {site.tenant.name}
        </div>
      </footer>
    </div>
  );
}
