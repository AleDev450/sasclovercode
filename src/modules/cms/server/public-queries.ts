import "server-only";

/**
 * Read side of the public website.
 *
 * Two guarantees, held by two different layers, and both are needed:
 *
 *   The DATABASE guarantees "this row is publishable": a published page of an
 *   active business. It cannot know which business the VISITOR should see,
 *   because a visitor belongs to none.
 *
 *   The APPLICATION guarantees "this is the right business": every query below
 *   filters by the tenant the Phase 01 hostname resolver returned.
 *
 * Neither is sufficient alone. Without the first, a bug here would serve
 * drafts; without the second, a bug here would serve the right content of the
 * wrong company.
 */

import { DatabaseError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isSectionType, type SectionType } from "../sections";

export interface PublicPage {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
  readonly sections: readonly { id: string; type: SectionType; content: unknown }[];
}

export interface PublicNavItem {
  readonly id: string;
  readonly label: string;
  readonly href: string;
  readonly children: readonly { id: string; label: string; href: string }[];
}

/** Resolves a page of THIS tenant by slug, or null. */
export async function getPublicPage(tenantId: string, slug: string): Promise<PublicPage | null> {
  const client = await createSupabaseServerClient();

  const { data, error } = await client
    .from("pages")
    .select("id, slug, title, page_sections(id, type, content, position, is_visible)")
    // The tenant filter is the application's half of the guarantee.
    .eq("tenant_id", tenantId)
    .eq("slug", slug)
    .eq("status", "published")
    .maybeSingle();

  if (error) {
    logger.error("site.page.query_failed", { tenantId, slug, error });
    throw new DatabaseError("Public page lookup failed.", { cause: error });
  }

  if (data === null) {
    logger.debug("site.page.miss", { tenantId, slug });
    return null;
  }

  const sections = (data.page_sections ?? [])
    .filter((section) => section.is_visible)
    .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))
    // A type the renderer does not know is dropped rather than rendered as a
    // blank. The enum makes this near-impossible, but the cast has to be
    // narrowed somewhere and silently skipping is the safe direction.
    .filter((section) => isSectionType(section.type))
    .map((section) => ({
      id: section.id,
      type: section.type as SectionType,
      content: section.content,
    }));

  return { id: data.id, slug: data.slug, title: data.title, sections };
}

/** The active navbar of THIS tenant, two levels deep. */
export async function getPublicNavigation(tenantId: string): Promise<PublicNavItem[]> {
  const client = await createSupabaseServerClient();

  const { data, error } = await client
    .from("navigation_items")
    .select("id, label, parent_id, link_type, external_url, position, pages(slug, status)")
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .order("position");

  if (error) {
    logger.error("site.navigation.query_failed", { tenantId, error });
    throw new DatabaseError("Public navigation lookup failed.", { cause: error });
  }

  const rows = data ?? [];

  /**
   * The target of an entry, or null when it must not be shown.
   *
   * The published check is done HERE and not left to the policy. The policy
   * hides draft-linked entries from `anon`, but a signed-in member reading
   * their own site matches the MEMBER policy instead, which shows everything -
   * so without this the public site rendered differently depending on who was
   * looking, and an owner could not trust it as a preview of what visitors see.
   */
  const href = (row: (typeof rows)[number]): string | null => {
    if (row.link_type === "external") return row.external_url;
    const page = row.pages as { slug: string; status: string } | null;
    if (page === null || page.status !== "published") return null;
    return `/sitio/${page.slug}`;
  };

  const tops = rows.filter((row) => row.parent_id === null);

  return tops.flatMap((row) => {
    const target = href(row);
    // A parent whose page vanished is dropped along with its children: the
    // policy already hides entries pointing at unpublished pages, and this
    // covers the rest.
    if (target === null) return [];

    const children = rows
      .filter((child) => child.parent_id === row.id)
      .flatMap((child) => {
        const childTarget = href(child);
        return childTarget === null
          ? []
          : [{ id: child.id, label: child.label, href: childTarget }];
      });

    return [{ id: row.id, label: row.label, href: target, children }];
  });
}
