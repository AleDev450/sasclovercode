import { type VariantProps, cva } from "class-variance-authority";
import type * as React from "react";
import { cn } from "@/lib/utils";
import { Spinner } from "./spinner";

/**
 * CLOVERCODE_MASTER.md section 34: consistent, reusable components with
 * explicit loading and disabled states.
 *
 * Every variant moves on press (`active:translate-y-px`) and every one of them
 * animates the same properties over the same duration. A button that responds
 * to the pointer is most of what separates an application from a form.
 */
const buttonVariants = cva(
  [
    "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg",
    "text-sm font-medium",
    "transition-[background-color,color,box-shadow,transform,border-color] duration-150",
    "active:translate-y-px",
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
    "disabled:pointer-events-none disabled:opacity-50 disabled:shadow-none",
    "[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  ].join(" "),
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground shadow-e1 hover:bg-primary/90",
        /**
         * The marketing call to action, and only that.
         *
         * It carries the brand glow, which is deliberately loud: on a dashboard
         * full of them it would be noise, so `default` stays the workhorse.
         */
        brand:
          "bg-primary text-primary-foreground shadow-brand hover:bg-primary/90 hover:shadow-e3",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/70",
        outline:
          "border border-input bg-background shadow-e1 hover:bg-accent hover:text-accent-foreground hover:border-primary/40",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        destructive: "bg-destructive text-destructive-foreground shadow-e1 hover:bg-destructive/90",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        sm: "h-8 rounded-md px-3 text-xs",
        md: "h-9 px-4 py-2",
        lg: "h-11 rounded-lg px-6",
        /** Hero-sized. Landing page only. */
        xl: "h-13 rounded-xl px-8 text-base",
        icon: "size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "md",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  /** Shows a spinner and blocks interaction. Prevents double submits. */
  loading?: boolean;
  /** Announced while `loading` is true. */
  loadingLabel?: string;
}

export function Button({
  className,
  variant,
  size,
  loading = false,
  loadingLabel = "Loading",
  disabled,
  children,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      // Buttons default to `submit` inside a form, which causes accidental
      // submissions. Opt in explicitly instead.
      type={type}
      className={cn(buttonVariants({ variant, size }), className)}
      disabled={disabled === true || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? <Spinner className="size-4" label={loadingLabel} /> : null}
      {children}
    </button>
  );
}

export { buttonVariants };
