import type * as React from "react";
import { cn } from "@/lib/utils";

/**
 * The shared field styling.
 *
 * Exported so `Textarea` and `Select` are the same control at a different
 * height, rather than three components that drift apart one fix at a time.
 */
export const fieldClassName = [
  "border-input bg-background w-full rounded-lg border px-3 py-2 text-sm shadow-e1",
  "transition-[border-color,box-shadow] duration-150",
  "placeholder:text-muted-foreground",
  "hover:border-primary/40",
  "focus-visible:outline-ring focus-visible:outline-2 focus-visible:outline-offset-2",
  "disabled:cursor-not-allowed disabled:opacity-50",
  "aria-invalid:border-destructive aria-invalid:focus-visible:outline-destructive",
].join(" ");

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  /** Renders the invalid style and sets `aria-invalid` for assistive tech. */
  invalid?: boolean;
}

export function Input({ className, invalid, type = "text", ...props }: InputProps) {
  return (
    <input
      type={type}
      aria-invalid={invalid === true ? true : undefined}
      className={cn(fieldClassName, "h-10", className)}
      {...props}
    />
  );
}
