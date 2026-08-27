import { notFound } from "next/navigation";
import { EmptyState } from "@/components/ui";
import { listPublicProducts } from "@/modules/catalog/server/queries";
import { getPublicIdentity } from "@/modules/seo/server/queries";
import { getPublicPage } from "../server/public-queries";
import { getSiteContext, signAssetPaths } from "../server/site-context";
import { collectAssetPaths } from "../sections";
import { SectionRenderer, type CatalogForSections } from "./section-renderer";

/**
 * Renders one published page of the tenant that owns this hostname.
 *
 * Shared by the home route and the slug route so both go through exactly the
 * same path: the tenant filter, the published filter and the asset signing
 * happen once, in one place, rather than being duplicated and drifting.
 */
export async function PublicPageView({ slug }: { slug: string }) {
  const site = await getSiteContext();
  // The layout already handled these, but a page is reachable on its own and
  // must not assume its layout ran the checks.
  if (site === null || !site.isServing) notFound();

  const page = await getPublicPage(site.tenant.id, slug);

  if (page === null) {
    if (slug === "inicio") {
      return (
        <EmptyState
          className="my-16"
          titleAs="h1"
          title="Este sitio aun no tiene portada"
          description="Crea una pagina con el enlace `inicio` y publicala para que aparezca aqui."
        />
      );
    }
    notFound();
  }

  /*
   * The catalogue is read once, here, and only when the page asks for it.
   *
   * A page with no `products` section pays nothing: a restaurant's "Nosotros"
   * page should not query the catalogue to render two paragraphs. And reading
   * it in ONE place means the product images can be signed in the same batch as
   * the section images - one round trip to Storage instead of one per product.
   */
  const wantsCatalog = page.sections.some((section) => section.type === "products");

  const [catalog, identity] = wantsCatalog
    ? await Promise.all([
        listPublicProducts(site.tenant.id),
        getPublicIdentity(site.tenant.id, site.tenant.name),
      ])
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

  return (
    <article className="flex flex-col">
      {page.sections.length === 0 ? (
        <EmptyState
          className="my-16"
          titleAs="h1"
          title={page.title}
          description="Esta pagina todavia no tiene contenido."
        />
      ) : (
        page.sections.map((section) => (
          <SectionRenderer
            key={section.id}
            section={section}
            assetUrls={assetUrls}
            catalog={catalogForSections}
          />
        ))
      )}
    </article>
  );
}
