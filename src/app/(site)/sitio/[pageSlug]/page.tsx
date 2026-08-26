import type { Metadata } from "next";
import { PublicPageView } from "@/modules/cms/components/public-page-view";
import { buildPageMetadata } from "@/modules/seo/server/page-metadata";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ pageSlug: string }>;
}): Promise<Metadata> {
  const { pageSlug } = await params;
  return buildPageMetadata(pageSlug);
}

export default async function SitePage({ params }: { params: Promise<{ pageSlug: string }> }) {
  const { pageSlug } = await params;
  return <PublicPageView slug={pageSlug} />;
}
