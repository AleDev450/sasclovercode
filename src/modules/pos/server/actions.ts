"use server";

/**
 * POS-only server calls that are not order or payment writes.
 *
 * Order creation and payment recording go through the Phase 13/14 actions
 * unmodified (`createOrderForPos` in `orders/server/actions.ts`,
 * `recordPaymentAction` in `payments/server/actions.ts`) - nothing here
 * duplicates either. This file exists for the one thing POS needs that
 * neither module exposes: customer search called live, from a client
 * component, without a `<form>` (ADR-019).
 */

import { requirePermission } from "@/lib/permissions/check";
import { PERMISSIONS } from "@/lib/permissions";
import { requireActiveTenant } from "@/lib/tenant/active";
import { listCustomers, type Customer } from "@/modules/customers/server/queries";

/**
 * Search-as-you-type for the POS customer picker.
 *
 * A thin wrapper, not a second search implementation: `listCustomers` (Phase
 * 12) already does the normalisation, the escaping and the multi-column
 * `or()` this needs. Capped at 8 and read-only - a picker, not the customer
 * list page, which already exists at `/clientes` for anything more.
 */
export async function searchCustomersForPos(
  tenantSlug: string,
  term: string,
): Promise<readonly Customer[]> {
  const tenant = await requireActiveTenant(tenantSlug);
  await requirePermission(tenant.id, PERMISSIONS.CUSTOMERS_VIEW);

  const trimmed = term.trim();
  if (trimmed.length === 0) return [];

  const page = await listCustomers(tenant.id, {
    search: trimmed,
    includeInactive: false,
    page: 1,
  });

  return page.customers.slice(0, 8);
}
