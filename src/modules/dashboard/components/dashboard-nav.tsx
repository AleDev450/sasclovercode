"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { activeNavKey, navItemHref, type NavItem } from "../navigation";

/**
 * Renders the entries the server already decided this user may see.
 *
 * It receives the filtered list rather than filtering here: a client component
 * must never be where a permission decision is taken.
 */
export function DashboardNav({
  tenantSlug,
  items,
}: {
  tenantSlug: string;
  items: readonly NavItem[];
}) {
  const pathname = usePathname();
  const current = activeNavKey(tenantSlug, pathname);

  return (
    <nav aria-label="Secciones" className="flex gap-1 overflow-x-auto md:flex-col">
      {items.map((item) => {
        const isCurrent = item.key === current;
        return (
          <Link
            key={item.key}
            href={navItemHref(tenantSlug, item)}
            aria-current={isCurrent ? "page" : undefined}
            className={cn(
              "rounded-md px-3 py-2 text-sm whitespace-nowrap transition-colors",
              isCurrent
                ? "bg-accent text-accent-foreground font-medium"
                : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
