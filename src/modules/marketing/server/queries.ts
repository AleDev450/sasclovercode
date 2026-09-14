import "server-only";

/**
 * The operator side of the landing page.
 *
 * Nothing here branches on who is asking, because RLS already has: the only
 * select policy on `platform_leads` requires `is_platform_admin()`, so a caller
 * without platform authority reads an empty table rather than an error. The
 * same pattern as `listPlatformTenants` (Phase 04).
 */

import { DatabaseError } from "@/lib/errors";
import { LIST_CAP } from "@/config/app";
import { logger } from "@/lib/logger";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { LeadStatus } from "@/types/database";

export interface Lead {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly phone: string | null;
  readonly businessName: string | null;
  readonly businessType: string | null;
  readonly message: string | null;
  readonly source: string;
  readonly status: LeadStatus;
  readonly internalNote: string | null;
  readonly contactedAt: string | null;
  readonly createdAt: string;
}

const LEAD_COLUMNS =
  "id, name, email, phone, business_name, business_type, message, source, status, internal_note, contacted_at, created_at";

interface LeadRow {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  business_name: string | null;
  business_type: string | null;
  message: string | null;
  source: string;
  status: LeadStatus;
  internal_note: string | null;
  contacted_at: string | null;
  created_at: string;
}

function toLead(row: LeadRow): Lead {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    businessName: row.business_name,
    businessType: row.business_type,
    message: row.message,
    source: row.source,
    status: row.status,
    internalNote: row.internal_note,
    contactedAt: row.contacted_at,
    createdAt: row.created_at,
  };
}

/**
 * The inbox, newest first.
 *
 * @param status only this stage of the funnel; omitted means all of them.
 */
export async function listLeads(status?: LeadStatus, limit = LIST_CAP): Promise<readonly Lead[]> {
  const client = await createSupabaseServerClient();

  let query = client
    .from("platform_leads")
    .select(LEAD_COLUMNS)
    .order("created_at", { ascending: false })
    // Section 18 forbids an unbounded read, even over a table nobody expects to
    // grow. A landing page that works is exactly a table that grows.
    .limit(Math.min(limit, LIST_CAP));

  if (status !== undefined) {
    query = query.eq("status", status);
  }

  const { data, error } = await query;

  if (error) {
    logger.error("marketing.leads.list_failed", { error });
    throw new DatabaseError("Lead listing failed.", { cause: error });
  }

  return (data ?? []).map((row) => toLead(row as unknown as LeadRow));
}

export interface LeadCounts {
  readonly total: number;
  readonly new: number;
  readonly contacted: number;
  readonly qualified: number;
  readonly won: number;
  readonly lost: number;
  readonly last7Days: number;
}

/** What a caller without platform authority sees, and a brand new install. */
export const EMPTY_LEAD_COUNTS: LeadCounts = {
  total: 0,
  new: 0,
  contacted: 0,
  qualified: 0,
  won: 0,
  lost: 0,
  last7Days: 0,
};

/** The funnel, in one round trip. Mirrors `getPlatformDiagnostics` (Phase 24). */
export async function getLeadCounts(): Promise<LeadCounts> {
  const client = await createSupabaseServerClient();
  const { data, error } = await client.rpc("platform_lead_counts");

  if (error) {
    logger.error("marketing.leads.counts_failed", { error });
    throw new DatabaseError("Lead counters failed.", { cause: error });
  }

  const row = data?.[0];
  if (row === undefined) return EMPTY_LEAD_COUNTS;

  return {
    total: Number(row.leads_total),
    new: Number(row.leads_new),
    contacted: Number(row.leads_contacted),
    qualified: Number(row.leads_qualified),
    won: Number(row.leads_won),
    lost: Number(row.leads_lost),
    last7Days: Number(row.leads_last_7d),
  };
}
