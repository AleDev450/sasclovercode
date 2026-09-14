import { type VariantProps, cva } from "class-variance-authority";
import type * as React from "react";
import { cn } from "@/lib/utils";

type DivProps = React.HTMLAttributes<HTMLDivElement>;

const cardVariants = cva("bg-card text-card-foreground rounded-xl border", {
  variants: {
    variant: {
      /** The default panel: resting on the page. */
      default: "shadow-e1",
      /** Lifted, for a card that is the focus of its screen. */
      elevated: "shadow-e2",
      /** No shadow. For cards packed edge to edge in a grid. */
      flat: "shadow-none",
      /**
       * A card that is a link or a button. Only use it when the WHOLE card is
       * clickable - a hover that leads nowhere is worse than no hover.
       */
      interactive:
        "shadow-e1 transition-[box-shadow,border-color,transform] duration-200 hover:shadow-e2 hover:border-primary/30 hover:-translate-y-0.5",
      /** Brand-tinted, for the one panel per screen that should stand out. */
      brand: "border-primary/25 bg-accent/40 shadow-e1",
    },
  },
  defaultVariants: {
    variant: "default",
  },
});

export interface CardProps extends DivProps, VariantProps<typeof cardVariants> {}

export function Card({ className, variant, ...props }: CardProps) {
  return <div className={cn(cardVariants({ variant }), className)} {...props} />;
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

export { cardVariants };
