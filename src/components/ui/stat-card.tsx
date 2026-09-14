import type * as React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";

export interface StatCardProps {
  /** What is being counted. Short - it is a label, not a sentence. */
  label: string;
  /** The number itself, already formatted for the locale. */
  value: string | number;
  /** One line of context: a comparison, a breakdown, a deadline. */
  hint?: string;
  /** A small glyph, top right. Decorative - it must repeat nothing. */
  icon?: React.ReactNode;
  /**
   * Colours the figure. `default` for a plain count; the others for a number
   * that is itself a judgement - money owed, businesses suspended.
   */
  tone?: "default" | "brand" | "success" | "warning" | "destructive";
  /** Turns the whole tile into a link to the screen that explains the number. */
  href?: string;
  className?: string;
}

const TONE_VALUE = {
  default: "text-foreground",
  brand: "text-primary",
  success: "text-success",
  warning: "text-warning",
  destructive: "text-destructive",
} as const;

const TONE_ICON = {
  default: "bg-muted text-muted-foreground",
  brand: "bg-accent text-accent-foreground",
  success: "bg-success/12 text-success",
  warning: "bg-warning/12 text-warning",
  destructive: "bg-destructive/12 text-destructive",
} as const;

/**
 * One number, with enough around it to be read without a legend.
 *
 * WHY THE FIGURE IS `tabular-nums`. A column of counters with proportional
 * digits shifts sideways every time one of them changes, which on a dashboard
 * that refreshes is genuinely distracting. Tabular figures are the fix and cost
 * nothing.
 *
 * WHY `tone` IS NOT AUTOMATIC. It would be easy to colour anything above zero
 * red, and wrong: five overdue invoices is a problem, five businesses is the
 * business working. The caller knows which number it is holding.
 */
export function StatCard({
  label,
  value,
  hint,
  icon,
  tone = "default",
  href,
  className,
}: StatCardProps) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <p className="text-muted-foreground text-sm font-medium">{label}</p>
        {icon ? (
          <span
            aria-hidden
            className={cn(
              "flex size-8 shrink-0 items-center justify-center rounded-lg [&_svg]:size-4",
              TONE_ICON[tone],
            )}
          >
            {icon}
          </span>
        ) : null}
      </div>
      <p
        className={cn("mt-3 text-3xl font-semibold tracking-tight tabular-nums", TONE_VALUE[tone])}
      >
        {value}
      </p>
      {hint ? <p className="text-muted-foreground mt-1.5 text-xs">{hint}</p> : null}
    </>
  );

  const shell = "bg-card text-card-foreground rounded-xl border p-5 shadow-e1";

  if (href !== undefined) {
    return (
      <Link
        href={href}
        className={cn(
          shell,
          "block transition-[box-shadow,border-color,transform] duration-200",
          "hover:border-primary/30 hover:shadow-e2 hover:-translate-y-0.5",
          className,
        )}
      >
        {body}
      </Link>
    );
  }

  return <div className={cn(shell, className)}>{body}</div>;
}

/**
 * The row a set of `StatCard`s sits in.
 *
 * One breakpoint ladder for every dashboard, so the tiles do not reflow
 * differently on two screens that show the same kind of thing.
 */
export function StatGrid({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("grid gap-4 sm:grid-cols-2 xl:grid-cols-4", className)} {...props} />;
}
