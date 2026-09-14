import type * as React from "react";
import { cn } from "@/lib/utils";

export interface PageHeaderProps {
  /** The page name. Rendered as the one `h1` on the screen. */
  title: string;
  /** One line on what this screen is for. */
  description?: string;
  /** Buttons and links, right-aligned on wide screens. */
  actions?: React.ReactNode;
  /** A badge or breadcrumb above the title. */
  eyebrow?: React.ReactNode;
  className?: string;
}

/**
 * The top of every screen in the product.
 *
 * WHY THIS EXISTS. Before it, each of the forty-odd dashboard pages spelled out
 * its own `<div className="flex items-start justify-between">` with its own
 * heading sizes, and they had drifted - which is a large part of why the
 * product read as a stack of CRUD screens rather than one application. Section
 * 34 asks for uniform hierarchy and spacing; this is where that uniformity is
 * actually enforced, because a page cannot accidentally opt out of a component
 * it imports.
 *
 * It is deliberately NOT configurable beyond these four slots. The moment it
 * takes a `titleClassName`, the drift starts again.
 */
export function PageHeader({ title, description, actions, eyebrow, className }: PageHeaderProps) {
  return (
    <header
      className={cn(
        "flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between sm:gap-6",
        className,
      )}
    >
      <div className="flex min-w-0 flex-col gap-2">
        {eyebrow ? <div className="flex items-center gap-2">{eyebrow}</div> : null}
        <h1 className="text-2xl font-semibold tracking-tight text-balance">{title}</h1>
        {description ? (
          <p className="text-muted-foreground max-w-prose text-sm">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

/**
 * A titled block below the page header.
 *
 * The second level of the same hierarchy: `PageHeader` owns the `h1`, this owns
 * the `h2`, and a `CardTitle` inside it owns the `h3`. Following that chain is
 * what keeps the document outline correct without anyone thinking about it.
 */
export function SectionHeader({
  title,
  description,
  actions,
  className,
}: Omit<PageHeaderProps, "eyebrow">) {
  return (
    <div className={cn("flex flex-wrap items-end justify-between gap-3", className)}>
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold tracking-tight">{title}</h2>
        {description ? <p className="text-muted-foreground text-sm">{description}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}
