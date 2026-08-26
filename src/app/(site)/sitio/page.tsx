import type { Metadata } from "next";
import { PublicPageView } from "@/modules/cms/components/public-page-view";
import { buildPageMetadata } from "@/modules/seo/server/page-metadata";

/**
 * The tenant home page.
 *
 * By convention the page with slug `inicio`. A business without one sees an
 * explicit notice rather than a 404: the site exists, it simply has no home
 * page yet, and telling them that is more useful than pretending it is missing.
 */
export async function generateMetadata(): Promise<Metadata> {
  return buildPageMetadata("inicio");
}

export default async function SiteHomePage() {
  return <PublicPageView slug="inicio" />;
}
