"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { activeNavKey, navItemHref, type NavGroup } from "../navigation";
import { NAV_GLYPHS } from "./nav-glyphs";

function NavGlyph({ name, className }: { name: string; className?: string }) {
  const Glyph = NAV_GLYPHS[name];
  if (Glyph === undefined) {
    return <span aria-hidden className={cn("size-1.5 rounded-full bg-current", className)} />;
  }
  return <Glyph className={cn("size-4", className)} />;
}

/**
 * Renders the entries the server already decided this user may see.
 *
 * It receives the filtered, grouped list rather than filtering here: a client
 * component must never be where a permission decision is taken.
 *
 * TWO LAYOUTS, ONE SOURCE. On a phone the groups collapse into a single
 * horizontal strip - a heading every three entries would eat the width that the
 * entries themselves need, and the strip is short enough to scan. From `md` up
 * it becomes the labelled column, which is where the grouping earns its keep.
 */
export function DashboardNav({
  tenantSlug,
  groups,
}: {
  tenantSlug: string;
  groups: readonly NavGroup[];
}) {
  const pathname = usePathname();
  const current = activeNavKey(tenantSlug, pathname);

  return (
    <nav aria-label="Secciones" className="md:sticky md:top-6">
      {/* ------------------------------------------------- phone: one strip */}
      <ul className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-2 md:hidden">
        {groups.flatMap((group) =>
          group.items.map((item) => {
            const isCurrent = item.key === current;
            return (
              <li key={item.key}>
                <Link
                  href={navItemHref(tenantSlug, item)}
                  aria-current={isCurrent ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-2 rounded-lg px-3 py-2 text-sm whitespace-nowrap transition-colors",
                    isCurrent
                      ? "bg-primary text-primary-foreground font-medium"
                      : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                  )}
                >
                  <NavGlyph name={item.icon} />
                  {item.label}
                </Link>
              </li>
            );
          }),
        )}
      </ul>

      {/* ----------------------------------------------- desktop: a column */}
      <div className="hidden flex-col gap-6 md:flex">
        {groups.map((group) => (
          <div key={group.key} className="flex flex-col gap-1">
            {group.label.length > 0 ? (
              /*
                A real heading, not a styled div. The column is a list of lists,
                and a screen reader that cannot hear the grouping is back to the
                flat inventory this replaced.
              */
              <h2 className="text-muted-foreground/70 px-3 pb-1 text-[0.6875rem] font-semibold tracking-wider uppercase">
                {group.label}
              </h2>
            ) : null}

            <ul className="flex flex-col gap-0.5">
              {group.items.map((item) => {
                const isCurrent = item.key === current;
                return (
                  <li key={item.key}>
                    <Link
                      href={navItemHref(tenantSlug, item)}
                      aria-current={isCurrent ? "page" : undefined}
                      className={cn(
                        "group flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors",
                        isCurrent
                          ? "bg-accent text-accent-foreground font-medium"
                          : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                      )}
                    >
                      <NavGlyph
                        name={item.icon}
                        className={cn(
                          "transition-colors",
                          isCurrent ? "text-primary" : "text-muted-foreground/70",
                        )}
                      />
                      <span className="truncate">{item.label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </nav>
  );
}
