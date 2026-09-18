import { cn } from "@/lib/utils";
import { ThemePreview } from "@/modules/settings/components/theme-preview";
import type { ThemePreset } from "@/modules/settings/theme-presets";

export interface ThemePickerProps {
  /** The field this posts under. Both callers read it back on the server. */
  name?: string;
  presets: readonly ThemePreset[];
  /** The preset that starts selected. */
  defaultValue: string;
  /** The name printed in each miniature's header. */
  businessName: string;
  /** Rendered as the group's legend. */
  legend: string;
  description?: string;
}

/**
 * Choosing a theme, as a radio group that looks like the thing being chosen.
 *
 * WHY THIS IS IN THE SUPER-ADMIN AT ALL. A business is sold, configured and
 * demonstrated before its owner ever signs in. If the theme is left to them,
 * the demo happens on whatever the column defaults are and the owner's first
 * look at their own website is a page nobody chose - which is the worst moment
 * in the product to look generic.
 *
 * WHY RADIOS AND NOT A DROPDOWN. The whole value of this decision is visual. A
 * list of three words asks an operator to remember what those words look like;
 * three miniatures ask them to point at one. The native radio underneath is
 * what keeps it keyboard-navigable and announced as a group, which a grid of
 * clickable divs would not be.
 *
 * WHY IT SHIPS NO JAVASCRIPT. The selected card is drawn by `has-[:checked]`,
 * which reads the state of the radio inside the label - so the highlight comes
 * from the form's own state instead of a React copy of it, and this stays a
 * Server Component that renders three previews for free. Both screens that use
 * it are client components, so they receive it as a node rather than importing
 * it.
 */
export function ThemePicker({
  name = "presetId",
  presets,
  defaultValue,
  businessName,
  legend,
  description,
}: ThemePickerProps) {
  return (
    <fieldset className="flex flex-col gap-4">
      <legend className="flex flex-col gap-1">
        <span className="text-sm font-medium">{legend}</span>
        {description !== undefined ? (
          <span className="text-muted-foreground text-xs">{description}</span>
        ) : null}
      </legend>

      {/* Three across while there are three to choose between; one card takes
          the row rather than sitting in a third of an empty one. */}
      <div className={cn("grid gap-4", presets.length > 1 && "sm:grid-cols-3")}>
        {presets.map((preset) => (
          <label
            key={preset.id}
            className={cn(
              "border-border bg-card relative flex cursor-pointer flex-col overflow-hidden rounded-xl border",
              "transition-[border-color,box-shadow]",
              "has-[:checked]:border-primary has-[:checked]:ring-primary/20 has-[:checked]:ring-2",
              "has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-offset-2",
            )}
          >
            <input
              type="radio"
              name={name}
              value={preset.id}
              defaultChecked={preset.id === defaultValue}
              className="sr-only"
            />

            {/* Edge to edge, so the tile reads as the website rather than as an
                illustration of one. */}
            <div className="[&>div]:rounded-none [&>div]:border-x-0 [&>div]:border-t-0">
              <ThemePreview theme={preset} businessName={businessName} />
            </div>

            <div className="flex flex-1 flex-col gap-1.5 p-4">
              <div className="flex items-baseline gap-2">
                <span className="font-semibold tracking-tight">{preset.name}</span>
                <span className="text-muted-foreground text-xs">{preset.tagline}</span>
              </div>
              <p className="text-muted-foreground text-xs leading-relaxed">{preset.description}</p>
            </div>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
