import { EmptyState } from "@/components/ui";
import { getPreviewPage } from "../server/admin-queries";
import { loadSectionData } from "../server/section-data";
import { SectionRenderer } from "./section-renderer";

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
            ? `Crea una pagina con el enlace "inicio" y sera la portada de ${tenantName}. Desde Tienda online puedes crearla con un clic.`
            : "Revisa el enlace, o creala desde Paginas."
        }
      />
    );
  }

  // The same data the public view reads, through the same helper.
  const { assetUrls, catalog, site } = await loadSectionData(tenantId, tenantName, page.sections);

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
      {page.sections.map((section, index) =>
        section.isVisible ? (
          // `.reveal` es la misma entrada CSS que usa la landing (globals.css):
          // nunca en la primera seccion, que ya esta en pantalla y ademas corre
          // por debajo del header.
          <div key={section.id} className={index === 0 ? undefined : "reveal"}>
            <SectionRenderer
              section={section}
              assetUrls={assetUrls}
              catalog={catalog}
              site={site}
              basePath={basePath}
              isFirst={index === 0}
            />
          </div>
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
              catalog={catalog}
              site={site}
              basePath={basePath}
            />
          </div>
        ),
      )}
    </article>
  );
}
