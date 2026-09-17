import "server-only";

/**
 * Everything a page's sections need beyond their own content, read once.
 *
 * The public view and the dashboard preview render the same sections, and they
 * used to each repeat "read the catalogue if there is a products section, then
 * sign every image in one batch". Phase 29 added two more of those conditions
 * (bestsellers, the slider's brand cover), which is the point at which two
 * copies stop being a convenience and start being two places to forget one.
 *
 * Each read happens only when a section asks for it: a "Nosotros" page with two
 * paragraphs still costs no catalogue query.
 */

import { signAssetPaths } from "@/lib/storage/sign";
import { listPublicProducts } from "@/modules/catalog/server/queries";
import { getPublicIdentity } from "@/modules/seo/server/queries";
import { getPublicStorefront, listBestsellerIds } from "@/modules/storefront/server/queries";
import type {
  AssetUrls,
  CatalogForSections,
  SiteForSections,
} from "../components/section-renderer";
import { collectAssetPaths, type SectionType } from "../sections";

/** The most any `bestsellers` section may show (its schema's maximum). */
const BESTSELLERS_CAP = 12;

export interface SectionData {
  readonly assetUrls: AssetUrls;
  readonly catalog: CatalogForSections | undefined;
  readonly site: SiteForSections | undefined;
}

export async function loadSectionData(
  tenantId: string,
  tenantName: string,
  sections: readonly { type: SectionType; content: unknown }[],
): Promise<SectionData> {
  const has = (type: SectionType) => sections.some((section) => section.type === type);

  const wantsCatalog = has("products") || has("bestsellers");
  const wantsBestsellers = has("bestsellers");
  const wantsSite = has("slider");

  const [catalog, identity, bestsellerIds, storefront] = await Promise.all([
    wantsCatalog ? listPublicProducts(tenantId) : Promise.resolve([]),
    wantsCatalog || wantsSite ? getPublicIdentity(tenantId, tenantName) : Promise.resolve(null),
    wantsBestsellers ? listBestsellerIds(tenantId, BESTSELLERS_CAP) : Promise.resolve([]),
    wantsSite ? getPublicStorefront(tenantId) : Promise.resolve(null),
  ]);

  const productImagePaths = catalog
    .map((product) => product.imagePath)
    .filter((path): path is string => path !== null);

  const assetUrls = await signAssetPaths([...collectAssetPaths(sections), ...productImagePaths]);

  return {
    assetUrls,
    catalog:
      wantsCatalog && identity !== null
        ? { products: catalog, currency: identity.currency, bestsellerIds }
        : undefined,
    site:
      identity !== null ? { name: identity.name, tagline: storefront?.tagline ?? null } : undefined,
  };
}
