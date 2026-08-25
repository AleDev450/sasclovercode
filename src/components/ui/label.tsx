import type * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Always pass `htmlFor`. An input without an associated label is unusable with
 * a screen reader (section 19).
 */
export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn(
        "text-sm leading-none font-medium peer-disabled:cursor-not-allowed peer-disabled:opacity-70",
        className,
      )}
      {...props}
    />
  );
}
