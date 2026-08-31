import Link from "next/link";
import { Card, CardContent } from "@/components/ui";
import {
  RANGE_PRESETS,
  RANGE_PRESET_LABELS,
  toDateInput,
  type DateRange,
  type RangePreset,
} from "../ranges";

export interface LocationOption {
  readonly id: string;
  readonly name: string;
}

/**
 * The range and branch filter.
 *
 * A plain `GET` form and a row of links - no client component and no Server
 * Action, because a report reads and nothing here mutates. The filter lives in
 * the URL, which means a range somebody found useful is a link they can send.
 */
export function ReportFilters({
  tenantSlug,
  range,
  locations,
  selectedLocation,
  activePreset,
}: {
  tenantSlug: string;
  range: DateRange;
  locations: readonly LocationOption[];
  selectedLocation: string | null;
  activePreset: RangePreset | null;
}) {
  const base = `/dashboard/${tenantSlug}/reportes`;
  const presetHref = (preset: RangePreset): string => {
    const params = new URLSearchParams({ preset });
    if (selectedLocation !== null) params.set("location", selectedLocation);
    return `${base}?${params.toString()}`;
  };

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 pt-6">
        <nav aria-label="Rangos rapidos" className="flex flex-wrap gap-2">
          {RANGE_PRESETS.map((preset) => (
            <Link
              key={preset}
              href={presetHref(preset)}
              aria-current={activePreset === preset ? "page" : undefined}
              className={
                activePreset === preset
                  ? "bg-primary text-primary-foreground rounded-md px-3 py-1.5 text-sm"
                  : "border-input hover:bg-accent rounded-md border px-3 py-1.5 text-sm"
              }
            >
              {RANGE_PRESET_LABELS[preset]}
            </Link>
          ))}
        </nav>

        <form method="get" action={base} className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-2">
            <label htmlFor="from" className="text-sm font-medium">
              Desde
            </label>
            <input
              id="from"
              name="from"
              type="date"
              defaultValue={toDateInput(range.from)}
              className="border-input bg-background h-9 rounded-md border px-2 text-sm"
            />
          </div>

          <div className="flex flex-col gap-2">
            <label htmlFor="to" className="text-sm font-medium">
              Hasta
            </label>
            <input
              id="to"
              name="to"
              type="date"
              defaultValue={toDateInput(range.to)}
              className="border-input bg-background h-9 rounded-md border px-2 text-sm"
            />
          </div>

          {locations.length > 1 ? (
            <div className="flex min-w-[10rem] flex-col gap-2">
              <label htmlFor="location" className="text-sm font-medium">
                Sede
              </label>
              <select
                id="location"
                name="location"
                defaultValue={selectedLocation ?? ""}
                className="border-input bg-background h-9 rounded-md border px-2 text-sm"
              >
                <option value="">Todas las sedes</option>
                {locations.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          <button
            type="submit"
            className="bg-secondary text-secondary-foreground hover:bg-secondary/80 h-9 rounded-md px-4 text-sm font-medium"
          >
            Aplicar
          </button>
        </form>
      </CardContent>
    </Card>
  );
}
