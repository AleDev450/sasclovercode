import type * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Loading placeholder. Purely decorative, so it is hidden from the
 * accessibility tree - the surrounding region should expose the loading state.
 */
export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden="true"
      className={cn("bg-muted animate-pulse rounded-md", className)}
      {...props}
    />
  );
}
