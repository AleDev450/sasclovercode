import type * as React from "react";
import { cn } from "@/lib/utils";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  /** Renders the invalid style and sets `aria-invalid` for assistive tech. */
  invalid?: boolean;
}

export function Input({ className, invalid, type = "text", ...props }: InputProps) {
  return (
    <input
      type={type}
      aria-invalid={invalid === true ? true : undefined}
      className={cn(
        "border-input bg-background flex h-9 w-full rounded-md border px-3 py-1 text-sm shadow-xs transition-colors",
        "placeholder:text-muted-foreground",
        "focus-visible:outline-ring focus-visible:outline-2 focus-visible:outline-offset-2",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "aria-invalid:border-destructive aria-invalid:focus-visible:outline-destructive",
        className,
      )}
      {...props}
    />
  );
}
