import "server-only";

/**
 * Read side of the CMS admin screens.
 *
 * Unlike the public queries, these return drafts too: the whole point of the
 * editor is to work on what is not published yet. What keeps them safe is the
 * `content.view` policy, which the caller must satisfy in that tenant.
 */

import { DatabaseError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isSectionType, type SectionType } from "../sections";

export interface AdminPage {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
  readonly status: "draft" | "published";
  readonly sectionCount: number;
  readonly updatedAt: string;
  /** Phase 08. Null means the page inherits the site-wide value. */
  readonly seoTitle: string | null;
  readonly seoDescription: string | null;
  readonly ogImagePath: string | null;
}

export interface AdminSection {
  readonly id: string;
  readonly type: SectionType;
  readonly content: unknown;
  readonly position: number;
  readonly isVisible: boolean;
}

export interface AdminNavItem {
  readonly id: string;
  readonly label: string;
  readonly parentId: string | null;
  readonly linkType: "page" | "external";
  readonly target: string;
  readonly position: number;
  readonly isActive: boolean;
}

export async function listPages(tenantId: string): Promise<AdminPage[]> {
  const client = await createSupabaseServerClient();
  const { data, error } = await client
    .from("pages")
    .select(
      "id, slug, title, status, updated_at, seo_title, seo_description, og_image_path, page_sections(id)",
    )
    .eq("tenant_id", tenantId)
    .order("updated_at", { ascending: false });

  if (error) {
    logger.error("cms.pages.list_failed", { tenantId, error });
    throw new DatabaseError("Page listing failed.", { cause: error });
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    slug: row.slug,
    title: row.title,
    status: row.status,
    sectionCount: (row.page_sections ?? []).length,
    updatedAt: row.updated_at,
    seoTitle: row.seo_title,
    seoDescription: row.seo_description,
    ogImagePath: row.og_image_path,
  }));
}

export async function getPageWithSections(
  tenantId: string,
  pageId: string,
): Promise<{ page: AdminPage; sections: AdminSection[] } | null> {
  const client = await createSupabaseServerClient();
  const { data, error } = await client
    .from("pages")
    .select(
      // One literal, however long: PostgREST infers the row type from the
      // string itself, and a concatenation infers nothing.
      "id, slug, title, status, updated_at, seo_title, seo_description, og_image_path, page_sections(id, type, content, position, is_visible)",
    )
    .eq("tenant_id", tenantId)
    .eq("id", pageId)
    .maybeSingle();

  if (error) {
    logger.error("cms.page.get_failed", { tenantId, pageId, error });
    throw new DatabaseError("Page lookup failed.", { cause: error });
  }
  if (data === null) return null;

  const rows = data.page_sections ?? [];
  const sections = rows
    .filter((section) => isSectionType(section.type))
    .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))
    .map((section) => ({
      id: section.id,
      type: section.type as SectionType,
      content: section.content,
      position: section.position,
      isVisible: section.is_visible,
    }));

  return {
    page: {
      id: data.id,
      slug: data.slug,
      title: data.title,
      status: data.status,
      sectionCount: sections.length,
      updatedAt: data.updated_at,
      seoTitle: data.seo_title,
      seoDescription: data.seo_description,
      ogImagePath: data.og_image_path,
    },
    sections,
  };
}

export async function listNavItems(tenantId: string): Promise<AdminNavItem[]> {
  const client = await createSupabaseServerClient();
  const { data, error } = await client
    .from("navigation_items")
    .select(
      "id, label, parent_id, link_type, page_id, external_url, position, is_active, pages(slug)",
    )
    .eq("tenant_id", tenantId)
    .order("position");

  if (error) {
    logger.error("cms.nav.list_failed", { tenantId, error });
    throw new DatabaseError("Navigation listing failed.", { cause: error });
  }

  return (data ?? []).map((row) => {
    const page = row.pages as { slug: string } | null;
    return {
      id: row.id,
      label: row.label,
      parentId: row.parent_id,
      linkType: row.link_type,
      target: row.link_type === "external" ? (row.external_url ?? "") : `/${page?.slug ?? ""}`,
      position: row.position,
      isActive: row.is_active,
    };
  });
}
