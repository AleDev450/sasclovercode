import type * as React from "react";
import { cn } from "@/lib/utils";

/**
 * The listing table.
 *
 * Every screen in this product that lists rows had written its own `<table>`
 * with its own padding and its own divider classes. They had drifted, and a
 * listing that looks slightly different on every page is exactly what makes an
 * application feel like a pile of CRUD forms (section 34).
 *
 * The primitives below are thin - they hold the spacing scale and nothing else
 * - so a page keeps full control of its columns while losing the ability to
 * invent its own row height.
 *
 * ACCESSIBILITY. `<Table>` requires a `caption`: a table without one is a grid
 * of numbers to a screen reader user. It is visually hidden by default, which
 * is the right trade - sighted users have the page heading for context and
 * everyone else gets it announced.
 */

export interface TableProps extends React.TableHTMLAttributes<HTMLTableElement> {
  /** Announced to assistive tech. Hidden visually unless `showCaption`. */
  caption: string;
  showCaption?: boolean;
  /** Applied to the scroll container, not the table. */
  wrapperClassName?: string;
  /**
   * Below this width the table scrolls sideways instead of crushing its
   * columns. Pass a Tailwind `min-w-*` class matched to the column count.
   */
  minWidthClassName?: string;
}

export function Table({
  caption,
  showCaption = false,
  className,
  wrapperClassName,
  minWidthClassName = "min-w-[40rem]",
  children,
  ...props
}: TableProps) {
  return (
    <div className={cn("w-full overflow-x-auto", wrapperClassName)}>
      <table
        className={cn("w-full border-collapse text-sm", minWidthClassName, className)}
        {...props}
      >
        <caption
          className={cn(
            showCaption ? "text-muted-foreground px-4 py-3 text-left text-sm" : "sr-only",
          )}
        >
          {caption}
        </caption>
        {children}
      </table>
    </div>
  );
}

export function TableHead({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <thead
      className={cn(
        "text-muted-foreground bg-muted/50 [&_th]:border-border [&_th]:border-b",
        "[&_th]:px-4 [&_th]:py-2.5 [&_th]:text-left [&_th]:text-xs [&_th]:font-medium",
        "[&_th]:tracking-wide [&_th]:whitespace-nowrap",
        className,
      )}
      {...props}
    />
  );
}

export function TableBody({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <tbody
      className={cn(
        "[&_tr]:border-border [&_tr]:border-b [&_tr:last-child]:border-0",
        "[&_tr:hover]:bg-muted/40 [&_tr]:transition-colors",
        "[&_td]:px-4 [&_td]:py-3 [&_th]:px-4 [&_th]:py-3",
        className,
      )}
      {...props}
    />
  );
}

/**
 * A numeric cell.
 *
 * Right-aligned and tabular, because a column of money that is not aligned on
 * its decimal point cannot be compared by eye - which is the only reason to put
 * numbers in a column at all.
 */
export function TableNumber({ className, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn("text-right tabular-nums", className)} {...props} />;
}
