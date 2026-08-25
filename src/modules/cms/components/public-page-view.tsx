import { notFound } from "next/navigation";
import { EmptyState } from "@/components/ui";
import { getPublicPage } from "../server/public-queries";
import { getSiteContext, signAssetPaths } from "../server/site-context";
import { collectAssetPaths } from "../sections";
import { SectionRenderer } from "./section-renderer";

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

  const assetUrls = await signAssetPaths(collectAssetPaths(page.sections));

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
          <SectionRenderer key={section.id} section={section} assetUrls={assetUrls} />
        ))
      )}
    </article>
  );
}
