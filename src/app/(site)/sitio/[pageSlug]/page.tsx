import { PublicPageView } from "@/modules/cms/components/public-page-view";

export default async function SitePage({ params }: { params: Promise<{ pageSlug: string }> }) {
  const { pageSlug } = await params;
  return <PublicPageView slug={pageSlug} />;
}
