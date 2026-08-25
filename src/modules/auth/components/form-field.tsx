import type { ReactNode } from "react";
import { Input, Label, type InputProps } from "@/components/ui";

export interface FormFieldProps extends Omit<InputProps, "id" | "invalid"> {
  readonly id: string;
  readonly label: string;
  /** Messages for this field. The first is rendered; all are announced. */
  readonly errors?: readonly string[];
  readonly hint?: ReactNode;
}

/**
 * A labelled input with its error wired up for assistive technology.
 *
 * Master section 19: every input has a real `<label for>`, and an error is
 * associated through `aria-describedby` so a screen reader announces it when
 * focus reaches the field - not only visually next to it.
 */
export function FormField({ id, label, errors, hint, ...inputProps }: FormFieldProps) {
  const hasError = errors !== undefined && errors.length > 0;
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;

  const describedBy = [hasError ? errorId : null, hint === undefined ? null : hintId]
    .filter((value) => value !== null)
    .join(" ");

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        invalid={hasError}
        aria-describedby={describedBy.length > 0 ? describedBy : undefined}
        {...inputProps}
      />
      {hint === undefined ? null : (
        <p id={hintId} className="text-muted-foreground text-xs">
          {hint}
        </p>
      )}
      {hasError ? (
        <p id={errorId} className="text-destructive text-xs">
          {errors.join(" ")}
        </p>
      ) : null}
    </div>
  );
}
