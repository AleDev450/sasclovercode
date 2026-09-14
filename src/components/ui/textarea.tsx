import type * as React from "react";
import { cn } from "@/lib/utils";
import { fieldClassName } from "./input";

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  /** Renders the invalid style and sets `aria-invalid` for assistive tech. */
  invalid?: boolean;
}

export function Textarea({ className, invalid, rows = 4, ...props }: TextareaProps) {
  return (
    <textarea
      rows={rows}
      aria-invalid={invalid === true ? true : undefined}
      className={cn(fieldClassName, "min-h-24 resize-y leading-relaxed", className)}
      {...props}
    />
  );
}
