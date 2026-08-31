-- Phase 24 - Audit + Observability
-- The fifteen triggers that cover master section 17's nine sensitive actions.
--
-- SPEC: docs/specs/phase-24-audit-observability.md section 8.
-- ADR-028 decision 3: the sensitive actions, not every write.
--
-- Section 17 lists nine things that must be auditable:
--
--   precio modificado          -> product.price_changed
--   producto eliminado         -> product.deleted
--   pedido cancelado           -> order.cancelled
--   usuario creado             -> member.added
--   rol modificado             -> member.role_changed
--   configuracion SUNAT        -> billing_config.changed
--   cierre de caja             -> cash_session.closed
--   devolucion                 -> payment.voided, stock.returned
--   documento anulado          -> billing_document.cancelled
--
-- Plus five of the same nature that its list of examples does not name.
--
-- WHY THIS IS CHEAP. Every trigger carries its gate in the declaration:
-- `update OF <column>` discards any statement that does not touch that column,
-- and the `WHEN` discards the ones that touch it without changing it. An order
-- moving from `preparing` to `ready` - the most frequent write in the system -
-- runs no audit code at all. It is the same technique Phase 18 used for stock
-- consumption, applied fifteen times.

-- ---------------------------------------------------------------------------
-- products
-- ---------------------------------------------------------------------------

create trigger products_audit_created
  after insert on public.products
  for each row execute function public.audit_row_change('product.created');

-- Section 17's first example. Both gates matter: `update OF` skips the far more
-- common availability and position writes, and the WHEN skips a form that
-- re-submits the same price.
create trigger products_audit_price
  after update of base_price_cents on public.products
  for each row
  when (old.base_price_cents is distinct from new.base_price_cents)
  execute function public.audit_row_change('product.price_changed');

create trigger products_audit_deleted
  after delete on public.products
  for each row execute function public.audit_row_change('product.deleted');

-- ---------------------------------------------------------------------------
-- orders
-- ---------------------------------------------------------------------------

-- Only the cancellation. Every other transition already lives in
-- `order_status_history` (Phase 13), and this row adds what that table cannot:
-- who, and from where.
create trigger orders_audit_cancelled
  after update of status on public.orders
  for each row
  when (new.status = 'cancelled'::public.order_status
        and old.status is distinct from new.status)
  execute function public.audit_row_change('order.cancelled');

-- ---------------------------------------------------------------------------
-- tenant_members  (who can get in, and as what)
-- ---------------------------------------------------------------------------

create trigger tenant_members_audit_added
  after insert on public.tenant_members
  for each row execute function public.audit_row_change('member.added');

create trigger tenant_members_audit_role
  after update of role on public.tenant_members
  for each row
  when (old.role is distinct from new.role)
  execute function public.audit_row_change('member.role_changed');

-- Not in section 17's list, and the gap would be real without it: suspending
-- somebody and letting them back in changes who can enter the system without
-- changing a single role.
create trigger tenant_members_audit_status
  after update of status on public.tenant_members
  for each row
  when (old.status is distinct from new.status)
  execute function public.audit_row_change('member.status_changed');

create trigger tenant_members_audit_removed
  after delete on public.tenant_members
  for each row execute function public.audit_row_change('member.removed');

-- ---------------------------------------------------------------------------
-- billing_provider_configs  (section 17: "configuracion SUNAT modificada")
-- ---------------------------------------------------------------------------

-- `credentials_secret_id` is listed deliberately: rotating a credential through
-- set_billing_credentials() (Phase 17) is exactly the kind of change this is
-- for. The value itself never reaches the log - `audit_redact` catches the
-- column because its name contains "credential", which is the whole argument
-- for redacting by pattern instead of by list (ADR-028 decision 4).
--
-- `updated_at` is NOT listed, so the `set_updated_at` trigger alone can never
-- make this fire.
create trigger billing_provider_configs_audit_changed
  after update of provider_name, is_active, series_boleta, series_factura,
                  series_nota_credito, series_nota_debito, credentials_secret_id
  on public.billing_provider_configs
  for each row execute function public.audit_row_change('billing_config.changed');

-- ---------------------------------------------------------------------------
-- cash_sessions  (section 17: "cierre de caja")
-- ---------------------------------------------------------------------------

-- The closing, not the opening: closing is where a difference against the
-- expected amount is declared, and where somebody would want to know who
-- declared it.
create trigger cash_sessions_audit_closed
  after update of closed_at on public.cash_sessions
  for each row
  when (old.closed_at is null and new.closed_at is not null)
  execute function public.audit_row_change('cash_session.closed');

-- ---------------------------------------------------------------------------
-- payments  (section 17: "devolucion")
-- ---------------------------------------------------------------------------

create trigger payments_audit_voided
  after update of voided_at on public.payments
  for each row
  when (old.voided_at is null and new.voided_at is not null)
  execute function public.audit_row_change('payment.voided');

-- ---------------------------------------------------------------------------
-- billing_documents  (section 17: "documento anulado")
-- ---------------------------------------------------------------------------

create trigger billing_documents_audit_cancelled
  after update of status on public.billing_documents
  for each row
  when (new.status = 'cancelled'::public.billing_document_status
        and old.status is distinct from new.status)
  execute function public.audit_row_change('billing_document.cancelled');

-- ---------------------------------------------------------------------------
-- stock_movements  (the inventory half of "devolucion")
-- ---------------------------------------------------------------------------

-- Only returns. `sale` movements are written by the order pipeline on every
-- completed order (Phase 18) and auditing those would bury everything else.
create trigger stock_movements_audit_return
  after insert on public.stock_movements
  for each row
  when (new.type = 'return'::public.stock_movement_type)
  execute function public.audit_row_change('stock.returned');

-- ---------------------------------------------------------------------------
-- tenant_settings
-- ---------------------------------------------------------------------------

-- The tax id, the legal name and the currency are what a document is issued
-- against; changing one changes what every future invoice says about the
-- business. `updated_at` is again not listed.
create trigger tenant_settings_audit_changed
  after update of legal_name, trade_name, tax_id, contact_email, phone,
                  whatsapp, address_line, district, city, currency, timezone
  on public.tenant_settings
  for each row execute function public.audit_row_change('settings.changed');

-- ---------------------------------------------------------------------------
-- loyalty_transactions
-- ---------------------------------------------------------------------------

-- Only manual adjustments. `earn` and `redeem` are the ordinary operation of
-- Phase 20 and are already a ledger; an `adjustment` is somebody deciding, by
-- hand, that a balance should be different - which is the definition of a
-- sensitive action.
create trigger loyalty_transactions_audit_adjustment
  after insert on public.loyalty_transactions
  for each row
  when (new.type = 'adjustment'::public.loyalty_transaction_type)
  execute function public.audit_row_change('loyalty.adjusted');
