import { cn } from "@/lib/utils";

export interface SpinnerProps {
  className?: string;
  /**
   * Announced by screen readers. Section 19: a loading state must be
   * perceivable without seeing the animation.
   */
  label?: string;
}

export function Spinner({ className, label = "Loading" }: SpinnerProps) {
  return (
    <span role="status" className={cn("inline-flex", className)}>
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        className={cn("size-full animate-spin")}
      >
        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="4" />
        <path
          d="M22 12a10 10 0 0 0-10-10"
          stroke="currentColor"
          strokeWidth="4"
          strokeLinecap="round"
        />
      </svg>
      <span className="sr-only">{label}</span>
    </span>
  );
}
