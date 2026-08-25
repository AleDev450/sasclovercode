import type * as React from "react";
import { cn } from "@/lib/utils";

export interface EmptyStateProps {
  /** What is missing, stated plainly. */
  title: string;
  /** Why it matters and what to do about it. */
  description?: string;
  /** Primary call to action, e.g. a "Create product" button. */
  action?: React.ReactNode;
  icon?: React.ReactNode;
  className?: string;
}

/**
 * CLOVERCODE_MASTER.md section 35: never leave a table simply empty. Every
 * listing that can be empty must render this instead.
 */
export function EmptyState({ title, description, action, icon, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "border-border flex flex-col items-center justify-center rounded-lg border border-dashed px-6 py-12 text-center",
        className,
      )}
    >
      {icon ? <div className="text-muted-foreground mb-4">{icon}</div> : null}
      <h3 className="text-base font-semibold">{title}</h3>
      {description ? (
        <p className="text-muted-foreground mt-2 max-w-sm text-sm">{description}</p>
      ) : null}
      {action ? <div className="mt-6">{action}</div> : null}
    </div>
  );
}
