/**
 * The catalogue of audited actions, mirrored from the database.
 *
 * These codes are written by the fifteen triggers in
 * `supabase/migrations/20260830160200_create_audit_triggers.sql` as
 * `TG_ARGV[0]`, and a database test fails if the two lists ever drift.
 *
 * Mirrored in TypeScript for the reason `PERMISSIONS` and `MODULES` are: a
 * union of literals makes a typo a compile error instead of a filter that
 * silently matches nothing - which would read as "nothing happened" and be very
 * hard to spot on an audit screen.
 *
 * The codes are semantic - `product.price_changed`, never `update`. A log that
 * records the SQL verb makes its reader reconstruct the intent from the
 * payload; a log that records the intent is one somebody can read.
 */

export const AUDIT_ACTIONS = [
  "product.created",
  "product.price_changed",
  "product.deleted",
  "order.cancelled",
  "member.added",
  "member.role_changed",
  "member.status_changed",
  "member.removed",
  "billing_config.changed",
  "cash_session.closed",
  "payment.voided",
  "billing_document.cancelled",
  "stock.returned",
  "settings.changed",
  "loyalty.adjusted",
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export function isAuditAction(value: string): value is AuditAction {
  return (AUDIT_ACTIONS as readonly string[]).includes(value);
}

/** What each action is called on screen. */
export const AUDIT_ACTION_LABELS: Readonly<Record<AuditAction, string>> = {
  "product.created": "Producto creado",
  "product.price_changed": "Precio modificado",
  "product.deleted": "Producto eliminado",
  "order.cancelled": "Pedido anulado",
  "member.added": "Usuario agregado",
  "member.role_changed": "Rol modificado",
  "member.status_changed": "Acceso modificado",
  "member.removed": "Usuario retirado",
  "billing_config.changed": "Configuracion de facturacion",
  "cash_session.closed": "Cierre de caja",
  "payment.voided": "Pago anulado",
  "billing_document.cancelled": "Comprobante anulado",
  "stock.returned": "Devolucion de stock",
  "settings.changed": "Datos del negocio",
  "loyalty.adjusted": "Ajuste de puntos",
};

/**
 * The tables an audit row can name, in words.
 *
 * A screen that says `billing_provider_configs` is a screen written for whoever
 * wrote the schema. Anything unmapped falls back to the raw name rather than
 * disappearing: an audit row nobody can label is still an audit row.
 */
export const AUDIT_ENTITY_LABELS: Readonly<Record<string, string>> = {
  products: "Producto",
  orders: "Pedido",
  tenant_members: "Miembro del equipo",
  billing_provider_configs: "Facturacion electronica",
  cash_sessions: "Caja",
  payments: "Pago",
  billing_documents: "Comprobante",
  stock_movements: "Movimiento de stock",
  tenant_settings: "Datos del negocio",
  loyalty_transactions: "Puntos",
};

export function auditEntityLabel(entityType: string): string {
  return AUDIT_ENTITY_LABELS[entityType] ?? entityType;
}

/**
 * The columns worth showing on a change, per table.
 *
 * An audit row holds the WHOLE row before and after, which is right for the
 * record and wrong for a screen: nobody reading "who changed this price" wants
 * eighteen unchanged columns. What the screen renders is the intersection of
 * "actually changed" and "means something to a reader", and this map is the
 * second half.
 *
 * An action with no entry falls back to every field that changed, minus the
 * bookkeeping ones below.
 */
export const AUDIT_HIGHLIGHT_FIELDS: Readonly<Partial<Record<AuditAction, readonly string[]>>> = {
  "product.created": ["name", "base_price_cents", "status"],
  "product.price_changed": ["base_price_cents"],
  "product.deleted": ["name", "base_price_cents"],
  "order.cancelled": ["number", "status", "cancel_reason", "total_cents"],
  "member.added": ["role", "status"],
  "member.role_changed": ["role"],
  "member.status_changed": ["status"],
  "member.removed": ["role", "status"],
  "cash_session.closed": ["closing_cents", "expected_cents", "difference_cents"],
  "payment.voided": ["amount_cents", "void_reason"],
  "billing_document.cancelled": ["series", "number", "status", "cancel_reason"],
  "stock.returned": ["quantity", "reason"],
  "loyalty.adjusted": ["points", "reason"],
};

/**
 * Columns never worth showing as a change.
 *
 * `updated_at` moves on every write by definition (the `set_updated_at` trigger
 * of Phase 01), so listing it as a change is noise on every single row.
 */
export const AUDIT_NOISE_FIELDS: readonly string[] = [
  "id",
  "tenant_id",
  "created_at",
  "updated_at",
];

export interface FieldChange {
  readonly field: string;
  readonly before: string | null;
  readonly after: string | null;
}

function renderValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

/**
 * What actually changed between the two payloads, filtered for a reader.
 *
 * Pure, and therefore unit-tested directly. Works for an INSERT (no `before`)
 * and a DELETE (no `after`) as well as an update, because those are two thirds
 * of the rows in this table.
 */
export function describeChanges(
  action: string,
  oldValues: Record<string, unknown> | null,
  newValues: Record<string, unknown> | null,
): readonly FieldChange[] {
  const highlight = isAuditAction(action) ? AUDIT_HIGHLIGHT_FIELDS[action] : undefined;

  const candidates =
    highlight ??
    [...new Set([...Object.keys(oldValues ?? {}), ...Object.keys(newValues ?? {})])].filter(
      (field) => !AUDIT_NOISE_FIELDS.includes(field),
    );

  const changes: FieldChange[] = [];

  for (const field of candidates) {
    const before = renderValue(oldValues?.[field]);
    const after = renderValue(newValues?.[field]);

    // An explicit highlight is shown even when it did not move - "the price is
    // 2490 and it did not change" is a meaningful thing for a chosen field to
    // say. Anything else only earns a line by actually changing.
    if (before === after && highlight === undefined) continue;
    if (before === null && after === null) continue;

    changes.push({ field, before, after });
  }

  return changes;
}
