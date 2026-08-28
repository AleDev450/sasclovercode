import "server-only";

/**
 * Read side of the customer book.
 *
 * One audience only: members of the business holding `customers.view`. There is
 * no public read anywhere in this module, and there is no public policy in the
 * schema either - unlike Phases 10 and 11, whose data exists to be seen.
 *
 * Every query filters by `tenant_id` as well as relying on the policy. The
 * policy decides whether the caller may see any of it; the filter decides which
 * business's customers these are.
 */

import { DatabaseError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { CustomerDocType } from "@/types/database";
import { escapeLikePattern, normalizeDocument, normalizePhone } from "../documents";
import { CUSTOMERS_PAGE_SIZE, type CustomerFilters } from "../schemas";

export interface Customer {
  readonly id: string;
  readonly name: string;
  readonly docType: CustomerDocType | null;
  readonly docNumber: string | null;
  readonly email: string | null;
  readonly phone: string | null;
  readonly isActive: boolean;
}

export interface CustomerAddress {
  readonly id: string;
  readonly label: string;
  readonly addressLine: string;
  readonly district: string | null;
  readonly city: string | null;
  readonly reference: string | null;
  /** Added in Phase 19 so a delivery can inherit them instead of retyping. */
  readonly latitude: number | null;
  readonly longitude: number | null;
  readonly isDefault: boolean;
}

export interface CustomerDetail extends Customer {
  readonly addresses: readonly CustomerAddress[];
}

/** One page of results, plus what the pager needs to draw itself. */
export interface CustomerPage {
  readonly customers: readonly Customer[];
  readonly total: number;
  readonly page: number;
  readonly pageCount: number;
}

const CUSTOMER_COLUMNS = "id, name, doc_type, doc_number, email, phone, is_active";

function toCustomer(row: {
  id: string;
  name: string;
  doc_type: CustomerDocType | null;
  doc_number: string | null;
  email: string | null;
  phone: string | null;
  is_active: boolean;
}): Customer {
  return {
    id: row.id,
    name: row.name,
    docType: row.doc_type,
    docNumber: row.doc_number,
    email: row.email,
    phone: row.phone,
    isActive: row.is_active,
  };
}

/**
 * Builds the `or` filter for the search box.
 *
 * A person at a till types one thing into one box and means any of four
 * columns. The term is normalised per column the same way it was normalised on
 * the way in - a document typed as "45.678.912" has to find the row stored as
 * "45678912" - and escaped, or a search for "%" would list the whole book.
 */
function buildSearchFilter(term: string): string {
  const like = `%${escapeLikePattern(term)}%`;
  const document = normalizeDocument(term);
  const phone = normalizePhone(term);

  const clauses = [`name.ilike.${like}`, `email.ilike.${like}`];

  if (document.length > 0) {
    clauses.push(`doc_number.ilike.%${escapeLikePattern(document)}%`);
  }
  if (phone.length > 0) {
    clauses.push(`phone.ilike.%${escapeLikePattern(phone)}%`);
  }

  return clauses.join(",");
}

/**
 * One page of the customers of a business.
 *
 * Paginated because master section 18 asks for it, and because this is the
 * table where it stops being theoretical: a restaurant open two years has tens
 * of thousands of customers, and the catalogue's twelve products do not.
 */
export async function listCustomers(
  tenantId: string,
  filters: CustomerFilters,
): Promise<CustomerPage> {
  const client = await createSupabaseServerClient();

  let query = client
    .from("customers")
    .select(CUSTOMER_COLUMNS, { count: "exact" })
    .eq("tenant_id", tenantId);

  if (!filters.includeInactive) {
    query = query.eq("is_active", true);
  }
  if (filters.search !== null) {
    query = query.or(buildSearchFilter(filters.search));
  }

  const from = (filters.page - 1) * CUSTOMERS_PAGE_SIZE;

  const { data, error, count } = await query
    .order("name")
    .range(from, from + CUSTOMERS_PAGE_SIZE - 1);

  if (error) {
    logger.error("customers.list_failed", { tenantId, error });
    throw new DatabaseError("Customer listing failed.", { cause: error });
  }

  const total = count ?? 0;

  return {
    customers: (data ?? []).map(toCustomer),
    total,
    page: filters.page,
    pageCount: Math.max(1, Math.ceil(total / CUSTOMERS_PAGE_SIZE)),
  };
}

/**
 * One customer of THIS tenant with their addresses, or null.
 *
 * A single query with an embed rather than two: the alternative is the N+1 that
 * shows up the moment a caller loops over customers.
 */
export async function getCustomerDetail(
  tenantId: string,
  customerId: string,
): Promise<CustomerDetail | null> {
  const client = await createSupabaseServerClient();

  const { data, error } = await client
    .from("customers")
    .select(
      `${CUSTOMER_COLUMNS}, customer_addresses(id, label, address_line, district, city, reference, latitude, longitude, is_default)`,
    )
    .eq("tenant_id", tenantId)
    .eq("id", customerId)
    .maybeSingle();

  if (error) {
    logger.error("customers.detail_failed", { tenantId, customerId, error });
    throw new DatabaseError("Customer lookup failed.", { cause: error });
  }
  if (data === null) return null;

  return {
    ...toCustomer(data),
    addresses: (data.customer_addresses ?? [])
      .map((row) => ({
        id: row.id,
        label: row.label,
        addressLine: row.address_line,
        district: row.district,
        city: row.city,
        reference: row.reference,
        latitude: row.latitude,
        longitude: row.longitude,
        isDefault: row.is_default,
      }))
      // The default first, then alphabetically: the one the rider needs is the
      // one at the top.
      .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.label.localeCompare(b.label)),
  };
}
