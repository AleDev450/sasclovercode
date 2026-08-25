import type * as React from "react";
import { cn } from "@/lib/utils";

type DivProps = React.HTMLAttributes<HTMLDivElement>;

export function Card({ className, ...props }: DivProps) {
  return (
    <div
      className={cn("bg-card text-card-foreground rounded-xl border shadow-sm", className)}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: DivProps) {
  return <div className={cn("flex flex-col gap-1.5 p-6", className)} {...props} />;
}

export type HeadingLevel = "h1" | "h2" | "h3" | "h4";

export interface CardTitleProps extends React.HTMLAttributes<HTMLHeadingElement> {
  /**
   * Heading level. Defaults to `h3`, which is right for a card nested inside a
   * section that already has an `h2`. Set it explicitly so the page keeps a
   * hierarchy without skipped levels (WCAG 1.3.1).
   */
  as?: HeadingLevel;
}

export function CardTitle({ className, as: Heading = "h3", ...props }: CardTitleProps) {
  return (
    <Heading className={cn("leading-none font-semibold tracking-tight", className)} {...props} />
  );
}

export function CardDescription({
  className,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("text-muted-foreground text-sm", className)} {...props} />;
}

export function CardContent({ className, ...props }: DivProps) {
  return <div className={cn("p-6 pt-0", className)} {...props} />;
}

export function CardFooter({ className, ...props }: DivProps) {
  return <div className={cn("flex items-center gap-2 p-6 pt-0", className)} {...props} />;
}
