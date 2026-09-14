import type * as React from "react";
import { cn } from "@/lib/utils";
import { fieldClassName } from "./input";

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  /** Renders the invalid style and sets `aria-invalid` for assistive tech. */
  invalid?: boolean;
  /** Applied to the wrapper, not the control. Use it for width and margin. */
  wrapperClassName?: string;
}

/**
 * A native `<select>`, styled.
 *
 * Native on purpose: it works without JavaScript, it is correct with a screen
 * reader and a keyboard for free, and on a phone it opens the platform picker -
 * which is what somebody taking an order at a counter actually wants. A custom
 * listbox would be a component to maintain and a set of ARIA bugs to discover
 * later.
 *
 * The chevron is a sibling element rather than a `background-image` on the
 * control, because a `style` attribute would be blocked by the
 * Content-Security-Policy of Phase 25 (`style-src` carries no `unsafe-inline`).
 */
export function Select({ className, wrapperClassName, invalid, children, ...props }: SelectProps) {
  return (
    <div className={cn("relative", wrapperClassName)}>
      <select
        aria-invalid={invalid === true ? true : undefined}
        className={cn(fieldClassName, "h-10 appearance-none pr-9", className)}
        {...props}
      >
        {children}
      </select>
      <svg
        aria-hidden
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="text-muted-foreground pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2"
      >
        <path d="m6 9 6 6 6-6" />
      </svg>
    </div>
  );
}
