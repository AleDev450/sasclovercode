import "server-only";

/**
 * Read side of locations.
 *
 * Two audiences with two different rules, so two sets of functions:
 *
 *   the dashboard  sees every branch, active or not, through `locations.view`
 *   the website    sees only the active branches of an active business
 *
 * Both filter by tenant in the query as well as relying on the policy. Neither
 * is redundant: the policy decides whether the caller may see any of it, and
 * the filter decides which business's screen this is.
 */

import { cache } from "react";
import { DatabaseError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Shift } from "../schedule";

export interface Location {
  readonly id: string;
  readonly name: string;
  readonly addressLine: string | null;
  readonly district: string | null;
  readonly city: string | null;
  readonly reference: string | null;
  readonly phone: string | null;
  readonly latitude: number | null;
  readonly longitude: number | null;
  readonly isActive: boolean;
}

export interface LocationShift extends Shift {
  readonly id: string;
  readonly locationId: string;
}

const LOCATION_COLUMNS =
  "id, name, address_line, district, city, reference, phone, latitude, longitude, is_active";

function toLocation(row: {
  id: string;
  name: string;
  address_line: string | null;
  district: string | null;
  city: string | null;
  reference: string | null;
  phone: string | null;
  latitude: number | null;
  longitude: number | null;
  is_active: boolean;
}): Location {
  return {
    id: row.id,
    name: row.name,
    addressLine: row.address_line,
    district: row.district,
    city: row.city,
    reference: row.reference,
    phone: row.phone,
    latitude: row.latitude,
    longitude: row.longitude,
    isActive: row.is_active,
  };
}

/** Every branch of a tenant, active first. For the dashboard. */
export async function listLocations(tenantId: string): Promise<Location[]> {
  const client = await createSupabaseServerClient();
  const { data, error } = await client
    .from("locations")
    .select(LOCATION_COLUMNS)
    .eq("tenant_id", tenantId)
    .order("is_active", { ascending: false })
    .order("name");

  if (error) {
    logger.error("locations.list_failed", { tenantId, error });
    throw new DatabaseError("Location listing failed.", { cause: error });
  }
  return (data ?? []).map(toLocation);
}

/** One branch of THIS tenant, or null. The tenant filter is not optional. */
export async function getLocation(tenantId: string, locationId: string): Promise<Location | null> {
  const client = await createSupabaseServerClient();
  const { data, error } = await client
    .from("locations")
    .select(LOCATION_COLUMNS)
    .eq("tenant_id", tenantId)
    .eq("id", locationId)
    .maybeSingle();

  if (error) {
    logger.error("locations.get_failed", { tenantId, locationId, error });
    throw new DatabaseError("Location lookup failed.", { cause: error });
  }
  return data === null ? null : toLocation(data);
}

/** The shifts of one branch. */
export async function listLocationHours(
  tenantId: string,
  locationId: string,
): Promise<LocationShift[]> {
  const client = await createSupabaseServerClient();
  const { data, error } = await client
    .from("location_hours")
    .select("id, location_id, day_of_week, opens_at, closes_at")
    .eq("tenant_id", tenantId)
    .eq("location_id", locationId)
    .order("day_of_week")
    .order("opens_at");

  if (error) {
    logger.error("locations.hours_failed", { tenantId, locationId, error });
    throw new DatabaseError("Location hours lookup failed.", { cause: error });
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    locationId: row.location_id,
    dayOfWeek: row.day_of_week,
    opensAt: row.opens_at,
    closesAt: row.closes_at,
  }));
}

export interface PublicLocation extends Location {
  readonly shifts: readonly Shift[];
}

/**
 * The branches a visitor may see, with their hours.
 *
 * Memoised per request: the site layout renders them and a future metadata
 * reader may want the address too, and Next.js would otherwise ask twice.
 *
 * Failure degrades to an empty list rather than throwing. This runs on the
 * public website, where a business should still be able to sell lunch if the
 * branch list momentarily fails to load - the page simply omits the block.
 */
export const listPublicLocations = cache(async (tenantId: string): Promise<PublicLocation[]> => {
  const client = await createSupabaseServerClient();

  const { data, error } = await client
    .from("locations")
    .select(`${LOCATION_COLUMNS}, location_hours(id, day_of_week, opens_at, closes_at)`)
    .eq("tenant_id", tenantId)
    // The policy already hides inactive branches from a visitor, but a MEMBER
    // reading their own public site matches the member policy instead, which
    // shows everything. Without this filter the site would render differently
    // depending on who was looking - the exact defect the Phase 07 audit
    // found in the navigation (A7-2).
    .eq("is_active", true)
    .order("name");

  if (error) {
    logger.error("locations.public_failed", { tenantId, error });
    return [];
  }

  return (data ?? []).map((row) => ({
    ...toLocation(row),
    shifts: (row.location_hours ?? [])
      .map((hour) => ({
        dayOfWeek: hour.day_of_week,
        opensAt: hour.opens_at,
        closesAt: hour.closes_at,
      }))
      .sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.opensAt.localeCompare(b.opensAt)),
  }));
});
