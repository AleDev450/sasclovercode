"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { IconBuilding, IconCard, IconChart, IconShield, IconUsers } from "@/components/ui/icons";
import { cn } from "@/lib/utils";

/**
 * The Super Admin console navigation.
 *
 * A client component for exactly one reason: `usePathname`. The active item has
 * to be derived from the URL, and a Server Component cannot know it without the
 * layout threading the path down by hand through every page.
 *
 * `exact` on the dashboard entry is what stops `/super-admin` from lighting up
 * on every screen underneath it, which is the default failure of prefix
 * matching and the reason it is a property of each item rather than a rule.
 */

const ITEMS = [
  { href: "/super-admin", label: "Resumen", icon: IconChart, exact: true },
  { href: "/super-admin/tenants", label: "Empresas", icon: IconBuilding, exact: false },
  { href: "/super-admin/prospectos", label: "Prospectos", icon: IconUsers, exact: false },
  { href: "/super-admin/facturacion", label: "Cobranza", icon: IconCard, exact: false },
  { href: "/super-admin/diagnostico", label: "Diagnostico", icon: IconShield, exact: false },
] as const;

export interface PlatformNavProps {
  /**
   * Unread leads. Rendered as a counter on the Prospectos item, because an
   * inbox whose backlog is only visible once you open it is an inbox that grows
   * quietly.
   */
  pendingLeads?: number;
}

export function PlatformNav({ pendingLeads = 0 }: PlatformNavProps) {
  const pathname = usePathname();

  return (
    <nav aria-label="Plataforma" className="flex flex-col gap-1">
      {ITEMS.map((item) => {
        const active = item.exact
          ? pathname === item.href
          : pathname === item.href || pathname.startsWith(`${item.href}/`);

        const showBadge = item.href === "/super-admin/prospectos" && pendingLeads > 0;

        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              active
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <item.icon className="size-4" />
            <span className="flex-1">{item.label}</span>
            {showBadge ? (
              <span className="bg-primary text-primary-foreground rounded-full px-1.5 py-0.5 text-[0.625rem] font-semibold tabular-nums">
                {pendingLeads > 99 ? "99+" : pendingLeads}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
