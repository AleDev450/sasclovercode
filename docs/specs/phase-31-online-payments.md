# SPEC — Phase 31 — Pagos online por plan

## 1. Información general

```text
Phase:                31
Nombre:               Pagos online por plan
Estado:               IN_PROGRESS
Versión:              1.0.0
Fecha creación:       2026-09-18
Última actualización: 2026-09-18
Responsable:          alejandro.avendano@masuno.pe
```

Fases previas: 00 a 30.
ADR: [034 — Pasarela elegida por la plataforma; pago confirmado solo por el proveedor](../adr/034-platform-chosen-payment-gateway-and-provider-confirmed-payments.md).

---

## 2. Objetivo

Regla comercial del dueño del producto: el plan básico cobra solo Yape y Plin a
mano. Desde el plan siguiente, CloverCode integra una pasarela (Culqi, Izipay o
Mercado Pago) para el restaurante y la configura desde el super admin. Al
terminar la fase:

1. Un operador elige proveedor, modo y credenciales de un negocio y la activa.
2. En la web, el checkout ofrece **Pagar online ahora** (tarjeta o Yape).
3. Tras confirmar el pedido, la página de seguimiento abre la pasarela:
   redirección (Mercado Pago), formulario embebido (Izipay) o Checkout v4
   (Culqi).
4. El pago aprobado por el proveedor queda registrado en `payments` y el pedido
   figura como pagado en el panel y en el seguimiento.

## 3. Alcance

### Incluido

- Módulo `online_payments` (Professional, Enterprise).
- `tenant_payment_gateways` y las funciones `set_payment_gateway`,
  `clear_payment_gateway`, `online_payments_available`,
  `get_public_payment_gateway`, `get_payment_gateway_credentials`
  (service_role), `record_online_payment` (service_role) y
  `get_web_order_for_payment`.
- `web_orders.pay_online`, `online_payment_status`, `provider_reference`;
  `place_web_order` acepta `payOnline`.
- Adaptadores `providers/mercadopago.ts`, `izipay.ts`, `culqi.ts`.
- Webhooks `/api/pagos/mercadopago/{tenantId}` y `/api/pagos/izipay/{tenantId}`.
- CSP con los hosts de las pasarelas solo en `/sitio/pedido/{token}`.
- UI: tarjeta **Pagos online** en super admin, opción en el checkout, panel
  **Pagar ahora** en el seguimiento, estado en Tienda online y en el pedido.

### Fuera de alcance

- Devoluciones desde CloverCode (se hacen en el panel del proveedor).
- 3-D Secure de Culqi.
- Cuotas, PagoEfectivo, billeteras distintas de Yape.

## 6. Requerimientos funcionales

- **FR3101** Solo un platform admin escribe la pasarela de un negocio.
- **FR3102** El secreto solo lo lee `service_role`.
- **FR3103** La web ofrece pago online solo con módulo, pasarela activa,
  credenciales y método de pago activo.
- **FR3104** Un pago se registra solo con la respuesta del proveedor, una vez,
  topado al saldo.
- **FR3105** Con pago online disponible, el cliente debe elegir online o un
  método manual; `payOnline` sin pasarela se rechaza
  (`ONLINE_PAYMENT_UNAVAILABLE`).

## 10. Tenant Isolation

- La URL del webhook lleva el tenant; el pago se consulta y verifica con las
  credenciales de **ese** tenant, y `record_online_payment` exige que el pedido
  sea de ese tenant (`unknown_order` si no).
- `get_web_order_for_payment` exige tenant (del hostname) y token.

## 11. Seguridad

- Rate limit `storefront.payment`: 10 cada 15 minutos por IP.
- Los formularios del super admin nunca devuelven un secreto al navegador; los
  campos secretos cargan vacíos.
- Los logs registran proveedor, modo y referencia; nunca llaves.

## 17. Testing Plan

- `src/tests/database/online-payments.test.ts` (9): módulo por plan, escritura
  solo de plataforma, secreto solo para service_role, disponibilidad, pedido
  online, registro idempotente, rechazo, aislamiento.
- `src/tests/unit/online-payments.test.ts` (15): firma de Mercado Pago, lectura
  de pagos, hash e IPN de Izipay, cargos de Culqi, credenciales, CSP y el
  importador único del cliente service_role.

## 22. Definition of Done

- [ ] Tests, lint, typecheck y build en verde.
- [ ] Un cobro de prueba real con cada proveedor en modo `test` (requiere
      cuentas de comercio; ver §24).

## 24. Known limitations

- **KL-3101 — Sin verificación en sandbox.** No hay cuentas de prueba de Culqi,
  Izipay ni Mercado Pago en este entorno. Los adaptadores siguen la
  documentación oficial consultada al planificar, pero no se probaron contra
  los servicios reales.
- **KL-3102 — 3-D Secure (Culqi).** Una tarjeta que exige autenticación se
  rechaza con un mensaje claro.
- **KL-3103 — Monto del IPN de Izipay.** Se registra `orderTotalAmount`. Si un
  pedido cambia de total después de emitir el `formToken`, gana el menor entre
  lo pagado y el saldo, y la diferencia queda anotada en el pago.
