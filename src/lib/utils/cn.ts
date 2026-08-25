import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merges class names and resolves conflicting Tailwind utilities so that a
 * caller-supplied class always wins over a component default.
 *
 * `cn("px-2", "px-4")` -> `"px-4"`
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
