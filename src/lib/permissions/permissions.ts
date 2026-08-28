/**
 * The permission catalogue, mirrored from the database.
 *
 * CLOVERCODE_MASTER.md section 12: build a reusable authorization layer and
 * avoid code littered with `if (role === "admin")`. Nothing in the application
 * ever compares a role; it asks for a permission.
 *
 * These constants must stay in step with
 * `supabase/migrations/20260825130000_create_authorization_catalog.sql`.
 * `src/tests/database/authorization-schema.test.ts` fails if they drift.
 */

export const PERMISSIONS = {
  PRODUCTS_VIEW: "products.view",
  PRODUCTS_CREATE: "products.create",
  PRODUCTS_UPDATE: "products.update",
  PRODUCTS_DELETE: "products.delete",

  ORDERS_VIEW: "orders.view",
  ORDERS_CREATE: "orders.create",
  ORDERS_UPDATE: "orders.update",
  ORDERS_CANCEL: "orders.cancel",

  CUSTOMERS_VIEW: "customers.view",
  CUSTOMERS_MANAGE: "customers.manage",

  CASH_OPEN: "cash.open",
  CASH_CLOSE: "cash.close",
  CASH_VIEW: "cash.view",
  CASH_MANAGE: "cash.manage",

  PAYMENTS_VIEW: "payments.view",
  PAYMENTS_CREATE: "payments.create",
  PAYMENTS_VOID: "payments.void",

  PAYMENT_METHODS_VIEW: "payment_methods.view",
  PAYMENT_METHODS_MANAGE: "payment_methods.manage",

  BILLING_VIEW: "billing.view",
  BILLING_CREATE: "billing.create",
  BILLING_CANCEL: "billing.cancel",
  BILLING_MANAGE: "billing.manage",

  REPORTS_VIEW: "reports.view",

  EMPLOYEES_MANAGE: "employees.manage",

  SETTINGS_MANAGE: "settings.manage",

  CONTENT_VIEW: "content.view",
  CONTENT_MANAGE: "content.manage",

  DOMAINS_VIEW: "domains.view",
  DOMAINS_MANAGE: "domains.manage",

  LOCATIONS_VIEW: "locations.view",
  LOCATIONS_MANAGE: "locations.manage",

  MEMBERS_VIEW: "members.view",
  MEMBERS_MANAGE: "members.manage",

  INVENTORY_VIEW: "inventory.view",
  INVENTORY_MANAGE: "inventory.manage",

  SUPPLIERS_VIEW: "suppliers.view",
  SUPPLIERS_MANAGE: "suppliers.manage",

  PURCHASES_VIEW: "purchases.view",
  PURCHASES_CREATE: "purchases.create",

  DELIVERY_ZONES_VIEW: "delivery_zones.view",
  DELIVERY_ZONES_MANAGE: "delivery_zones.manage",

  DELIVERIES_VIEW: "deliveries.view",
  DELIVERIES_MANAGE: "deliveries.manage",
} as const;

/**
 * Every valid permission code.
 *
 * Because this is a union of literals rather than `string`, a typo in a
 * permission name is a compile error instead of a silent `false` at runtime -
 * which would read as "access denied" and be very hard to spot.
 */
export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const ALL_PERMISSIONS: readonly Permission[] = Object.values(PERMISSIONS);

/** Roles, in the same order as `roles.rank`. */
export const ROLES = {
  OWNER: "owner",
  ADMIN: "admin",
  MANAGER: "manager",
  CASHIER: "cashier",
  WAITER: "waiter",
  KITCHEN: "kitchen",
  DELIVERY: "delivery",
  ACCOUNTANT: "accountant",
} as const;

export type Role = (typeof ROLES)[keyof typeof ROLES];

export const ALL_ROLES: readonly Role[] = Object.values(ROLES);

/** Narrowing helper for values arriving from outside TypeScript. */
export function isPermission(value: string): value is Permission {
  return (ALL_PERMISSIONS as readonly string[]).includes(value);
}
