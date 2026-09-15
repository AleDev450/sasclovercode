import { cn } from "@/lib/utils";

/**
 * The Peruvian flag, drawn rather than typed.
 *
 * WHY NOT THE EMOJI. `🇵🇪` is a pair of regional-indicator characters that a
 * platform is free to render as a flag or as the letters "P" and "E" - and
 * Windows ships no flag font at all, so on Chrome for Windows it renders as
 * two boxed capitals. The audience for this page is restaurant owners in Peru,
 * a large share of whom are on Windows desktops, and "Hecho para restaurantes
 * peruanos PE" is worse than saying nothing.
 *
 * Three rectangles solve it everywhere, at any size, with no font dependency.
 * It is `aria-hidden` because the sentence beside it already says Peru; a
 * screen reader announcing "flag of Peru" after the word "peruanos" is the same
 * fact twice.
 */
export function PeruFlag({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 9 6"
      aria-hidden
      className={cn("h-3 w-auto shrink-0 rounded-[1px]", className)}
    >
      <rect width="9" height="6" fill="#fff" />
      <rect width="3" height="6" fill="#D91023" />
      <rect x="6" width="3" height="6" fill="#D91023" />
    </svg>
  );
}
