import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert, AlertDescription, AlertTitle, Badge } from "@/components/ui";
import { IconArrowRight, IconGlobe, IconPencil } from "@/components/ui/icons";
import { SYSTEM_DOMAIN } from "@/config/app";
import { MODULES } from "@/lib/features";
import { hasFeature } from "@/lib/features/check";
import { PERMISSIONS } from "@/lib/permissions";
import { hasPermission } from "@/lib/permissions/check";
import { requireActiveTenant } from "@/lib/tenant/active";
import { PreviewPageView } from "@/modules/cms/components/preview-page-view";
import { SiteChrome } from "@/modules/cms/components/site-chrome";
import { listPageSlugs } from "@/modules/cms/server/admin-queries";
import { getPreviewSiteContext } from "@/modules/cms/server/site-context";
import { ComplaintBookView, LegalDocumentView } from "@/modules/legal/components/views";
import { CheckoutView, DeliveryZonesView, MenuView } from "@/modules/storefront/components/views";

/**
 * "Ver mi web", from inside the product.
 *
 * THE PROBLEM IT SOLVES. A tenant website is served from the tenant's own
 * hostname - `mitienda.clovercodeapp.com` in production, `mitienda.localhost`
 * in development. That is the correct architecture and it leaves a real hole:
 * on a preview deployment the whole platform answers on ONE `*.vercel.app`
 * name, which belongs to no tenant, so `toLookupDomain` finds nothing and every
 * tenant site 404s. Somebody evaluating the product there could edit a website
 * they had no way to look at.
 *
 * This route renders that website on whatever hostname the dashboard is on. It
 * is not a second implementation: it is `SiteChrome` and `SectionRenderer`, the
 * same components a visitor gets, with the tenant resolved from the URL segment
 * against the caller's own memberships instead of from the Host header.
 *
 * IT IS NOT A PUBLIC BACK DOOR. `/vista` is absent from the public prefixes in
 * `lib/auth/route-access.ts`, so the proxy demands a session before this file
 * runs; `requireActiveTenant` then 404s anybody who is not a member of THIS
 * business; and every query underneath still runs as that person, under the
 * same policies as always. What it shows that the public site does not - drafts
 * and hidden sections - is exactly what a member can already read in the editor.
 */

export const metadata: Metadata = {
  title: "Vista previa",
  // A preview of a page that may be a draft, served from the platform's own
  // hostname. Indexing it would put a business's unfinished content under
  // CloverCode's domain, which is wrong twice over.
  robots: { index: false, follow: false, nocache: true },
};

export default async function SitePreviewPage({
  params,
}: {
  params: Promise<{ tenantSlug: string; slug?: string[] }>;
}) {
  const { tenantSlug, slug } = await params;

  // Membership first: everything below reads this business's content.
  const tenant = await requireActiveTenant(tenantSlug);

  if (!(await hasFeature(tenant.id, MODULES.WEBSITE))) notFound();
  if (!(await hasPermission(tenant.id, PERMISSIONS.CONTENT_MANAGE))) notFound();

  const site = await getPreviewSiteContext(tenantSlug);
  if (site === null) notFound();

  // By convention the home page is the one with slug `inicio`, the same
  // convention `/sitio` follows.
  const pageSlug = slug?.[0] ?? "inicio";
  const basePath = `/vista/${tenant.slug}`;

  const pages = await listPageSlugs(tenant.id);
  const current = pages.find((page) => page.slug === pageSlug);

  const publicUrl = `https://${tenant.slug}.${SYSTEM_DOMAIN}/sitio${
    pageSlug === "inicio" ? "" : `/${pageSlug}`
  }`;

  const banner = (
    <div className="bg-foreground text-background sticky top-0 z-50 print:hidden">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-4 gap-y-2 px-6 py-2.5 text-sm">
        <span className="inline-flex items-center gap-2 font-medium">
          <IconGlobe className="size-4" />
          Vista previa
        </span>

        <span className="opacity-70">{tenant.name}</span>

        {current !== undefined ? (
          <Badge variant={current.status === "published" ? "success" : "warning"} dot>
            {current.status === "published" ? "Publicada" : "Borrador"}
          </Badge>
        ) : null}

        {/*
          The page switcher.

          Plain links rather than a select: this route is reachable with no
          JavaScript, and a preview that needs a bundle to change page would be
          the one screen in the product that does.
        */}
        {pages.length > 1 ? (
          <nav aria-label="Paginas del sitio" className="flex flex-wrap items-center gap-1">
            {pages.map((page) => (
              <Link
                key={page.slug}
                href={`${basePath}${page.slug === "inicio" ? "" : `/${page.slug}`}`}
                aria-current={page.slug === pageSlug ? "page" : undefined}
                className={
                  page.slug === pageSlug
                    ? "bg-background/20 rounded-md px-2 py-1 text-xs font-medium"
                    : "rounded-md px-2 py-1 text-xs opacity-70 transition-opacity hover:opacity-100"
                }
              >
                {page.title}
              </Link>
            ))}
          </nav>
        ) : null}

        <div className="ml-auto flex items-center gap-3">
          <a
            href={publicUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs opacity-70 transition-opacity hover:opacity-100"
            title="Funciona cuando el dominio ya apunta a CloverCode"
          >
            {tenant.slug}.{SYSTEM_DOMAIN}
            <IconArrowRight className="size-3.5" />
          </a>
          <Link
            href={`/dashboard/${tenant.slug}/contenido`}
            className="bg-background text-foreground inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium"
          >
            <IconPencil className="size-3.5" />
            Volver al editor
          </Link>
        </div>
      </div>
    </div>
  );

  if (!site.isServing) {
    return (
      <div className="min-h-dvh">
        {banner}
        <main className="mx-auto flex max-w-xl items-center px-6 py-16">
          <Alert variant="warning">
            <AlertTitle>Esta empresa esta suspendida</AlertTitle>
            <AlertDescription>
              Mientras lo este, sus clientes no ven el sitio. Asi es como lo veran ellos.
            </AlertDescription>
          </Alert>
        </main>
      </div>
    );
  }

  /*
   * The fixed storefront pages (Phase 29) are not CMS pages, so the preview
   * renders their views directly - the same components `/sitio/carta` and its
   * siblings render. The checkout is shown with `preview` set: identical to what
   * a customer sees, and unable to place an order from the dashboard's hostname.
   */
  const view = { tenantId: tenant.id, tenantName: tenant.name, basePath };
  const content =
    pageSlug === "carta" ? (
      <MenuView {...view} />
    ) : pageSlug === "zonas-de-delivery" ? (
      <DeliveryZonesView {...view} />
    ) : pageSlug === "pedir" ? (
      <CheckoutView {...view} preview />
    ) : pageSlug === "terminos" ? (
      <LegalDocumentView {...view} kind="terms" />
    ) : pageSlug === "privacidad" ? (
      <LegalDocumentView {...view} kind="privacy" />
    ) : pageSlug === "cookies" ? (
      <LegalDocumentView {...view} kind="cookies" />
    ) : pageSlug === "libro-de-reclamaciones" ? (
      <ComplaintBookView {...view} preview />
    ) : (
      <PreviewPageView {...view} slug={pageSlug} />
    );

  return (
    <SiteChrome site={site} basePath={basePath} banner={banner}>
      {content}
    </SiteChrome>
  );
}
