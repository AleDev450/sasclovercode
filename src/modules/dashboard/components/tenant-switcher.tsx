import Link from "next/link";
import { Badge } from "@/components/ui";
import type { Membership } from "@/lib/auth/types";
import { cn } from "@/lib/utils";

/**
 * Lets a user move between the businesses they belong to.
 *
 * A plain list of links, not a dropdown with state: it works without
 * JavaScript, it is keyboard navigable for free, and with the handful of
 * memberships a person realistically has it is also faster to use.
 */
export function TenantSwitcher({
  memberships,
  activeSlug,
}: {
  memberships: readonly Membership[];
  activeSlug: string;
}) {
  if (memberships.length <= 1) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-muted-foreground text-xs">Cambiar de empresa:</span>
      {memberships.map((membership) => {
        const isActive = membership.tenantSlug === activeSlug;
        return (
          <Link
            key={membership.tenantId}
            href={`/dashboard/${membership.tenantSlug}`}
            aria-current={isActive ? "true" : undefined}
            className={cn(
              "rounded-md border px-2.5 py-1 text-xs transition-colors",
              isActive
                ? "border-primary text-foreground font-medium"
                : "border-border text-muted-foreground hover:text-foreground",
            )}
          >
            {membership.tenantName}
            {membership.tenantStatus !== "active" ? (
              <Badge variant="warning" className="ml-2">
                {membership.tenantStatus === "suspended" ? "Suspendida" : "Archivada"}
              </Badge>
            ) : null}
          </Link>
        );
      })}
    </div>
  );
}
