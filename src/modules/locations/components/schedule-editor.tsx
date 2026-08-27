"use client";

import { useActionState } from "react";
import { Alert, AlertDescription, Button, Input, Label } from "@/components/ui";
import { IDLE_FORM_STATE } from "@/lib/forms/state";
import { addLocationHourAction, deleteLocationHourAction } from "../server/actions";
import { buildWeek, formatTime, WEEKDAY_NAMES } from "../schedule";
import type { LocationShift } from "../server/queries";

/**
 * The week, plus one form to add a shift.
 *
 * Every day is listed even when it is empty, because "Domingo — cerrado" and a
 * missing Sunday row are very different things to a customer standing outside a
 * shut door. `buildWeek` is what guarantees the seven entries.
 */
export function ScheduleEditor({
  tenantSlug,
  locationId,
  shifts,
}: {
  tenantSlug: string;
  locationId: string;
  shifts: readonly LocationShift[];
}) {
  const week = buildWeek(shifts);

  return (
    <div className="flex flex-col gap-6">
      <ul className="flex flex-col gap-2">
        {week.map((day) => (
          <li
            key={day.dayOfWeek}
            className="border-border flex flex-wrap items-center justify-between gap-3 border-b pb-2 last:border-0"
          >
            <span className="w-28 text-sm font-medium">{day.label}</span>

            {day.closed ? (
              <span className="text-muted-foreground grow text-sm">Cerrado</span>
            ) : (
              <ul className="flex grow flex-wrap items-center gap-3">
                {day.shifts.map((shift) => (
                  <li key={shift.id} className="flex items-center gap-2">
                    <span className="font-mono text-sm">
                      {formatTime(shift.opensAt)} - {formatTime(shift.closesAt)}
                    </span>
                    <DeleteHourForm tenantSlug={tenantSlug} hourId={shift.id} />
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>

      <AddHourForm tenantSlug={tenantSlug} locationId={locationId} />
    </div>
  );
}

function DeleteHourForm({ tenantSlug, hourId }: { tenantSlug: string; hourId: string }) {
  const [, formAction, isPending] = useActionState(deleteLocationHourAction, IDLE_FORM_STATE);

  return (
    <form action={formAction}>
      <input type="hidden" name="tenantSlug" value={tenantSlug} />
      <input type="hidden" name="hourId" value={hourId} />
      <Button type="submit" variant="ghost" size="sm" loading={isPending} loadingLabel="Quitando">
        Quitar
      </Button>
    </form>
  );
}

function AddHourForm({ tenantSlug, locationId }: { tenantSlug: string; locationId: string }) {
  const [state, formAction, isPending] = useActionState(addLocationHourAction, IDLE_FORM_STATE);
  const e = state.fieldErrors ?? {};

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="tenantSlug" value={tenantSlug} />
      <input type="hidden" name="locationId" value={locationId} />

      {state.message !== undefined ? (
        <Alert variant={state.status === "success" ? "success" : "warning"}>
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid items-end gap-4 sm:grid-cols-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="dayOfWeek">Dia</Label>
          <select
            id="dayOfWeek"
            name="dayOfWeek"
            defaultValue="1"
            className="border-input bg-background h-9 rounded-md border px-3 text-sm"
          >
            {/* Monday first, which is how the week is read here; the value is
                the storage convention, so nothing converts on the way in. */}
            {[1, 2, 3, 4, 5, 6, 0].map((day) => (
              <option key={day} value={day}>
                {WEEKDAY_NAMES[day]}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="opensAt">Abre</Label>
          <Input
            id="opensAt"
            name="opensAt"
            type="time"
            defaultValue="09:00"
            invalid={e.opensAt !== undefined}
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="closesAt">Cierra</Label>
          <Input
            id="closesAt"
            name="closesAt"
            type="time"
            defaultValue="18:00"
            invalid={e.closesAt !== undefined}
          />
        </div>

        <Button type="submit" loading={isPending} loadingLabel="Anadiendo">
          Anadir tramo
        </Button>
      </div>

      {e.opensAt !== undefined ? <p className="text-destructive text-sm">{e.opensAt[0]}</p> : null}
      {e.closesAt !== undefined ? (
        <p className="text-destructive text-sm">{e.closesAt[0]}</p>
      ) : null}

      <p className="text-muted-foreground text-xs">
        Para un turno partido, anade dos tramos el mismo dia. Si cierran despues de medianoche,
        anade el tramo hasta 24:00 y otro desde 00:00 el dia siguiente.
      </p>
    </form>
  );
}
