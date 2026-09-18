import { notFound } from "next/navigation";
import { EmptyState } from "@/components/ui";
import { getPublicPage } from "../server/public-queries";
import { loadSectionData } from "../server/section-data";
import { getSiteContext } from "../server/site-context";
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

  /*
   * The catalogue, the bestsellers and the business identity are read once,
   * here, and only when a section asks for them - see `loadSectionData`. Reading
   * them in ONE place also means every image is signed in the same batch: one
   * round trip to Storage instead of one per product.
   */
  const {
    assetUrls,
    catalog,
    site: siteForSections,
  } = await loadSectionData(site.tenant.id, site.tenant.name, page.sections);

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
        /*
         * `.reveal` is the entrance animation the landing page already uses:
         * pure CSS, driven by `animation-timeline: view()`, defined once in
         * `globals.css`. No client component, no observer, and an element that
         * stays visible in a browser that does not support it - which is the
         * whole reason it is not a script.
         *
         * Not on the block that opens the page: it is already on screen when
         * the page loads, so there is nothing to animate INTO, and the cover in
         * particular runs under the header and must not be given a transform.
         */
        page.sections.map((section, index) => (
          <div key={section.id} className={index === 0 ? undefined : "reveal"}>
            <SectionRenderer
              section={section}
              assetUrls={assetUrls}
              catalog={catalog}
              site={siteForSections}
              isFirst={index === 0}
            />
          </div>
        ))
      )}
    </article>
  );
}
