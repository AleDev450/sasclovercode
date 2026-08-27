/**
 * Validation for the location forms.
 *
 * Mirrors the CHECK constraints in
 * `supabase/migrations/20260825200100_create_locations.sql` and
 * `20260825200200_create_location_hours.sql`. The database is the authority;
 * this layer exists so an operator sees "la latitud esta fuera de rango"
 * instead of `locations_latitude_range`.
 */

import { z } from "zod";
import { toMinutes } from "./schedule";

/** Blank means "not filled in", which is different from an empty string. */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Maximo ${max} caracteres.`)
    .transform((value) => (value.length === 0 ? null : value))
    .nullable();

/**
 * A coordinate, or null.
 *
 * Accepts a comma as the decimal separator: a Peruvian keyboard and a Peruvian
 * spreadsheet both produce `-12,046374`, and rejecting it would look like the
 * form dislikes the number rather than the punctuation.
 */
const coordinate = (max: number, label: string) =>
  z
    .string()
    .trim()
    .transform((value) => (value.length === 0 ? null : value.replace(",", ".")))
    .nullable()
    .refine(
      (value) => value === null || Number.isFinite(Number(value)),
      `${label} debe ser un numero.`,
    )
    .transform((value) => (value === null ? null : Number(value)))
    .refine(
      (value) => value === null || (value >= -max && value <= max),
      `${label} debe estar entre -${max} y ${max}.`,
    );

export const locationSchema = z
  .object({
    name: z.string().trim().min(1, "El nombre es obligatorio.").max(120),
    addressLine: optionalText(300),
    district: optionalText(100),
    city: optionalText(100),
    reference: optionalText(200),
    phone: optionalText(30),
    latitude: coordinate(90, "La latitud"),
    longitude: coordinate(180, "La longitud"),
  })
  // Half a coordinate is not a location, it is a pin in the Atlantic. The
  // database says the same with a CHECK; this says it with a field message.
  .refine((value) => (value.latitude === null) === (value.longitude === null), {
    message: "Escribe las dos coordenadas o ninguna.",
    path: ["latitude"],
  });

export type LocationInput = z.output<typeof locationSchema>;

/** `HH:MM` or `HH:MM:SS`, up to and including 24:00. */
const timeOfDay = z
  .string()
  .trim()
  .refine((value) => toMinutes(value) !== null, "Usa un horario como 09:30.")
  // Normalised to what PostgreSQL stores, so a value read back compares equal
  // to the value written.
  .transform((value) => {
    const minutes = toMinutes(value) ?? 0;
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return `${String(hours).padStart(2, "0")}:${String(rest).padStart(2, "0")}:00`;
  });

export const locationHourSchema = z
  .object({
    locationId: z.uuid(),
    dayOfWeek: z.coerce.number().int().min(0).max(6),
    opensAt: timeOfDay,
    closesAt: timeOfDay,
  })
  .refine((value) => (toMinutes(value.closesAt) ?? 0) > (toMinutes(value.opensAt) ?? 0), {
    message: "La hora de cierre debe ser posterior a la de apertura.",
    path: ["closesAt"],
  });

export type LocationHourInput = z.output<typeof locationHourSchema>;
