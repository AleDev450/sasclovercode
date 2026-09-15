import { EmptyState } from "@/components/ui";
import { signAssetPaths } from "@/lib/storage/sign";
import { listPublicProducts } from "@/modules/catalog/server/queries";
import { getPublicIdentity } from "@/modules/seo/server/queries";
import { getPreviewPage } from "../server/admin-queries";
import { collectAssetPaths } from "../sections";
import { SectionRenderer, type CatalogForSections } from "./section-renderer";

/**
 * One page of a tenant site, rendered for somebody who works there.
 *
 * It is the same renderer, the same sections and the same theme a visitor gets.
 * Two things differ, and both are the point of a preview:
 *
 *   A DRAFT page renders. `getPublicPage` filters on `status = 'published'`,
 *   which is correct for the internet and useless for the person deciding
 *   whether to publish.
 *
 *   A HIDDEN section renders, dimmed and labelled. Leaving it out would show a
 *   page that is right about today and silent about what is in it.
 */
export async function PreviewPageView({
  tenantId,
  tenantName,
  slug,
  basePath,
}: {
  tenantId: string;
  tenantName: string;
  slug: string;
  basePath: string;
}) {
  const page = await getPreviewPage(tenantId, slug);

  if (page === null) {
    return (
      <EmptyState
        className="my-16"
        titleAs="h1"
        title={slug === "inicio" ? "Este sitio aun no tiene portada" : "Esa pagina no existe"}
        description={
          slug === "inicio"
            ? `Crea una pagina con el enlace "inicio" y sera la portada de ${tenantName}.`
            : "Revisa el enlace, o creala desde Paginas."
        }
      />
    );
  }

  const wantsCatalog = page.sections.some((section) => section.type === "products");

  const [catalog, identity] = wantsCatalog
    ? await Promise.all([listPublicProducts(tenantId), getPublicIdentity(tenantId, tenantName)])
    : [[], null];

  const productImagePaths = catalog
    .map((product) => product.imagePath)
    .filter((path): path is string => path !== null);

  const assetUrls = await signAssetPaths([
    ...collectAssetPaths(page.sections),
    ...productImagePaths,
  ]);

  const catalogForSections: CatalogForSections | undefined =
    identity === null ? undefined : { products: catalog, currency: identity.currency };

  if (page.sections.length === 0) {
    return (
      <EmptyState
        className="my-16"
        titleAs="h1"
        title={page.title}
        description="Esta pagina todavia no tiene secciones. Anade una portada para empezar."
      />
    );
  }

  return (
    <article className="flex flex-col">
      {page.sections.map((section) =>
        section.isVisible ? (
          <SectionRenderer
            key={section.id}
            section={section}
            assetUrls={assetUrls}
            catalog={catalogForSections}
            basePath={basePath}
          />
        ) : (
          <div key={section.id} className="relative my-2 opacity-40">
            <span
              className="absolute top-2 right-0 z-10 rounded-full px-3 py-1 text-xs font-medium"
              style={{
                background: "var(--site-border)",
                color: "var(--site-foreground)",
              }}
            >
              Oculta para los clientes
            </span>
            <SectionRenderer
              section={section}
              assetUrls={assetUrls}
              catalog={catalogForSections}
              basePath={basePath}
            />
          </div>
        ),
      )}
    </article>
  );
}
