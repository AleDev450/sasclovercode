import { buildWeek, formatShifts } from "../schedule";
import type { PublicLocation } from "../server/queries";

/**
 * Where the business is and when it opens, on its own website.
 *
 * Master section 30 lists "dirección" and "horarios" among the things a tenant
 * website must show, and Phase 10 is where that data starts existing. This is
 * the minimal honest version: a block in the footer, rendered from the same
 * rows the dashboard edits.
 *
 * Deliberately NOT a CMS section type. Adding one to the Phase 07 enum would
 * mean a new schema, a new editor and a new renderer branch, which is a phase's
 * worth of work for a decision this phase does not need to make.
 */

function AddressLine({ location }: { location: PublicLocation }) {
  const parts = [location.addressLine, location.district, location.city].filter(
    (part): part is string => part !== null && part.length > 0,
  );
  if (parts.length === 0) return null;
  return <p className="text-sm">{parts.join(", ")}</p>;
}

export function PublicLocations({ locations }: { locations: readonly PublicLocation[] }) {
  if (locations.length === 0) return null;

  return (
    <section aria-labelledby="sedes-heading" className="flex flex-col gap-6">
      <h2 id="sedes-heading" className="text-sm font-semibold tracking-wide uppercase">
        {locations.length === 1 ? "Donde estamos" : "Nuestras sedes"}
      </h2>

      <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {locations.map((location) => {
          const week = buildWeek(location.shifts);
          const openDays = week.filter((day) => !day.closed);

          return (
            <li key={location.id} className="flex flex-col gap-2">
              <h3 className="text-sm font-medium" style={{ color: "var(--site-primary)" }}>
                {location.name}
              </h3>

              <AddressLine location={location} />

              {location.reference !== null ? (
                <p className="text-muted-foreground text-xs">{location.reference}</p>
              ) : null}

              {location.phone !== null ? (
                // `tel:` rather than plain text: on a phone this is the whole
                // point of publishing the number.
                <a
                  href={`tel:${location.phone.replace(/[^+0-9]/g, "")}`}
                  className="text-sm hover:underline"
                >
                  {location.phone}
                </a>
              ) : null}

              {openDays.length === 0 ? (
                // Never invent hours. "Consultar horario" is honest; a made-up
                // 9-to-6 sends somebody to a closed door.
                <p className="text-muted-foreground text-xs">Consultar horario</p>
              ) : (
                <dl className="mt-1 flex flex-col gap-0.5">
                  {week.map((day) => (
                    <div key={day.dayOfWeek} className="flex justify-between gap-3 text-xs">
                      <dt className="text-muted-foreground">{day.label}</dt>
                      <dd className={day.closed ? "text-muted-foreground" : "font-mono"}>
                        {day.closed ? "Cerrado" : formatShifts(day.shifts)}
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
