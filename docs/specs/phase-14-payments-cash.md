# SPEC — Phase 14 — Payments + Cash

## 1. Información general

```text
Phase:                14
Nombre:               Payments + Cash
Estado:               COMPLETED
Versión:              1.0.0
Fecha creación:       2026-08-27
Última actualización: 2026-08-27
Responsable:          alejandro.avendano@masuno.pe
```

Documento maestro: §12, §14 (Fase 14), §33 (Fase 14), §39.
Fases previas: 00 a 13 — todas COMPLETED y auditadas.
ADR: [018 — Payment voiding and the cash ledger](../adr/018-payment-void-and-cash-ledger.md).

---

## 2. Objetivo

### ¿Por qué existe esta fase?

La Fase 13 registró el primer hecho del sistema: alguien compró. Esta fase
registra el segundo: alguien pagó — y, si pagó en efectivo, que la caja al
final del turno cuadre con lo que el sistema dice que debería tener.

Es también la fase que obliga a separar tres cosas que hasta ahora podían
confundirse. Master §14, textual:

> Separar: Order / Payment / Invoice. No son la misma entidad.

Un pedido es lo que se vendió. Un pago es que se cobró. Un comprobante — SUNAT,
Fase 17 — es la declaración fiscal de que ambas cosas ocurrieron. Las tres
fechas pueden no coincidir: se puede cobrar antes de confirmar (prepago), se
puede entregar sin haber cobrado (cuenta corriente), y el comprobante siempre
llega después de las dos.

### ¿Qué debe ser posible al terminarla?

```text
Cobrar un pedido, completo o dividido entre varios metodos
  (parte efectivo, parte Yape).
Saber en todo momento cuanto de un pedido esta pagado y cuanto falta.
Abrir una caja con un monto inicial y cerrarla contando el efectivo,
  viendo la diferencia contra lo que el sistema esperaba.
Anular un pago mal ingresado sin borrar el rastro de que existio.
Que la Fase 15 (POS) y la Fase 17 (SUNAT) tengan, cada una, un dato
  estable sobre el que construir: cuanto se cobro y por que via.
```

---

## 3. Alcance

### Incluido

```text
Tablas payment_methods, cash_registers, cash_sessions, cash_movements,
  payments.
Enums payment_method_type y cash_movement_type, con los valores de §14.
orders.paid_cents, mantenido por trigger desde payments.
Tope de pago: nunca se puede pagar mas de lo que un pedido debe.
Pago dividido: un pedido puede tener muchos pagos, de metodos distintos.
Efectivo ligado a una sesion de caja abierta, en la misma sede del pedido.
Anulacion de un pago (voided_at/void_reason), no edicion.
Apertura y cierre de caja, con monto esperado y diferencia calculados
  por la base de datos.
Ledger de movimientos de caja, de solo escritura por trigger para las
  ventas y manual (payout/deposit/adjustment) para el resto.
Siete permisos nuevos: payments.*, payment_methods.*, cash.view,
  cash.manage. cash.open/cash.close ya existian desde la Fase 03.
RLS en las cinco tablas.
Dashboard: tarjeta de pagos en el detalle de pedido, pantalla de Caja,
  pantalla de Metodos de pago.
```

### Fuera de alcance

```text
Integracion con pasarelas de pago (webhooks de Yape/Plin/tarjeta)  —
                                  el valor existe en el enum, nada lo
                                  produce todavia. Mismo movimiento que
                                  la fuente `web` en la Fase 13.
Devoluciones de dinero al cliente — anular corrige un error de tipeo
                                  en la misma sesion, no es una nota de
                                  credito. Eso es Fase 17, tal como
                                  ADR-017 ya lo dejo dicho.
Pantalla de POS                 — Fase 15.
Pantalla de cocina / KDS        — Fase 16.
Boleta, factura, SUNAT          — Fase 17.
Numero correlativo de pago      — no es legalmente relevante hasta que
                                  exista una serie SUNAT (Fase 17). El
                                  UUID del pago y el numero del pedido
                                  alcanzan por ahora.
Descuento de stock               — Fase 18.
Notificaciones/recordatorios de saldo pendiente — ninguna fase lo pidio.
```

### La decisión de alcance que más costó

No hay `payment_transitions` como tabla, a pesar de que `order_transitions`
(Fase 13) fue exactamente ese patrón para el ciclo de vida de un pedido.

Un pago tiene una sola arista posible: `completado -> anulado`. Construir la
misma maquinaria que la Fase 13 — una tabla de pares, un trigger que la
consulta, un test que compara la tabla contra un mapa de TypeScript — habría
sido imitar la forma de una fase anterior en vez de resolver el problema de
esta. Un `voided_at`/`void_reason` nulable, igual al que `orders` ya usa para
`cancelled_at`/`cancel_reason`, dice exactamente lo mismo con un CHECK en vez
de una tabla. Ver ADR-018 §1.

Lo mismo aplica a `cash_sessions`: no hay `cash_session_status`, hay
`closed_at`/`closing_cents` nulables juntos.

---

## 4. Dependencias

```text
Phase 01 — Multi-Tenancy Core   tenants, requireActiveTenant
Phase 03 — Authorization + RLS  has_permission; cash.open/cash.close
                                 ya existian, payments.* y
                                 payment_methods.* son nuevos aqui
Phase 05 — Tenant Dashboard     layout, navegacion, guardas
Phase 10 — Locations            una caja pertenece a una sede
Phase 13 — Orders Core          total_cents, contra el que se reconcilia
ADR-015 — Money as minor units  toda la aritmetica de esta fase
ADR-017 — Order snapshot/FSM    el precedente que esta fase sigue y,
                                 en el caso del "voided", decide no repetir
ADR-018 — Esta fase             las cinco decisiones de esta fase
```

**Permisos nuevos**, a diferencia de la Fase 13 (que no necesito ninguno):
`payments.view`, `payments.create`, `payments.void`, `payment_methods.view`,
`payment_methods.manage`, `cash.view`, `cash.manage`. El catalogo de la Fase
03 solo habia pre-sembrado `cash.open` y `cash.close` (§12 los lista como
ejemplo); nada sobre pagos. Owner y admin no heredan permisos nuevos
automaticamente — cada uno se otorga explicitamente, igual que hizo la Fase
10 con `locations.*`.

---

## 5. Casos de uso

```text
UC-1401
Actor           Cajero
Precondiciones  payments.create, caja abierta en la sede del pedido
Acción          Registra un pago en efectivo por el saldo completo
Resultado       Pago completado, movimiento de caja "venta" escrito,
                orders.paid_cents al dia
Errores         Sin sesion abierta -> rechazo de la base

UC-1402
Actor           Cajero
Precondiciones  payments.create
Acción          Registra un pago con Yape (sin sesion de caja)
Resultado       Pago completado, SIN movimiento de caja
Errores         Enviar una sesion de caja con un metodo no efectivo
                -> rechazo de la base

UC-1403
Actor           Cajero
Precondiciones  Un pedido con saldo pendiente de 20
Acción          Intenta registrar un pago de 25
Resultado       Rechazado: dejaria el pedido sobrepagado
Errores         P0001

UC-1404
Actor           Encargado
Precondiciones  payments.void, un pago en efectivo vigente
Acción          Lo anula indicando el motivo
Resultado       voided_at escrito, movimiento de ajuste negativo en la
                caja, orders.paid_cents recalculado
Errores         Sin motivo -> rechazo; anular dos veces -> rechazo

UC-1405
Actor           Cajero
Precondiciones  cash.open
Acción          Abre una caja con un monto inicial
Resultado       Sesion creada; un segundo intento sobre la misma caja
                mientras la primera sigue abierta es rechazado
Errores         23505 (indice unico) en el segundo intento

UC-1406
Actor           Cajero
Precondiciones  cash.close, sesion abierta con ventas registradas
Acción          La cierra declarando el efectivo contado
Resultado       La base calcula lo esperado (apertura + movimientos) y
                la diferencia; ninguno de los dos lo manda el formulario
Errores         Cerrar una sesion ya cerrada -> rechazo

UC-1407
Actor           Encargado
Precondiciones  cash.manage
Acción          Registra una salida manual (vuelto para un mototaxi)
Resultado       Movimiento "payout", negativo, sin pago asociado
Errores         Intentar insertar un movimiento "sale" a mano -> RLS

UC-1408
Actor           Owner
Precondiciones  payment_methods.manage
Acción          Crea el metodo "Yape - Alejandro"
Resultado       Metodo disponible para cobrar
Errores         Nombre repetido en el mismo negocio -> rechazo

UC-1409
Actor           Owner
Precondiciones  payment_methods.manage
Acción          Desactiva un metodo que ya no se usa
Resultado       No aparece para pagos nuevos; los pagos ya hechos con el
                siguen intactos
Errores         —

UC-1410
Actor           Dos cajeros a la vez
Precondiciones  cash.open, misma caja
Acción          Ambos intentan abrir una sesion
Resultado       Uno la abre; el otro recibe el error del indice unico
Errores         23505
```

---

## 6. Requerimientos funcionales

```text
FR-1401  Un pago pertenece a exactamente un pedido y a un metodo de pago,
         ambos del mismo tenant.

FR-1402  Un pedido puede tener muchos pagos (pago dividido).

FR-1403  La suma de los pagos vigentes de un pedido nunca supera su
         total_cents. Lo impone la base de datos, no el formulario.

FR-1404  Un pago de tipo `cash` exige una sesion de caja ABIERTA en la
         MISMA sede del pedido. Cualquier otro tipo exige que no haya
         sesion.

FR-1405  Los tipos de metodo son exactamente cash, yape, plin, card,
         transfer y other (§14).

FR-1406  Un metodo de pago pertenece a un tenant, tiene un nombre que el
         negocio elige, y se puede desactivar sin borrarse.

FR-1407  Un pedido anulado no puede recibir pagos nuevos.

FR-1408  Anular un pago escribe voided_at/void_reason. La fila nunca se
         edita de otra forma ni se borra.

FR-1409  Anular un pago en efectivo escribe un movimiento de caja de
         compensacion, para que el ledger quede correcto.

FR-1410  Una caja pertenece a exactamente una sede del tenant.

FR-1411  Una caja tiene como maximo una sesion abierta a la vez.

FR-1412  Una sesion registra quien la abrio, cuando, y el monto inicial
         declarado.

FR-1413  Cerrar una sesion registra el monto contado; la base de datos
         calcula el monto esperado y la diferencia.

FR-1414  Un movimiento de caja pertenece a una sesion y lleva un monto
         con signo; el ledger es de solo insercion.

FR-1415  orders.paid_cents refleja la suma de los pagos vigentes y lo
         mantiene la base de datos.

FR-1416  El estado del pedido y el estado de sus pagos son ejes
         independientes: nada aqui mueve orders.status.
```

---

## 7. Requerimientos no funcionales

```text
NFR-1401 Seguridad
  payments.void es un permiso distinto de payments.create — igual que
  orders.cancel de orders.update en la Fase 13 — asi que quien cobra no
  puede, por si solo, borrar la evidencia de haber cobrado mal.

NFR-1402 Integridad
  El tope de pago, la regla de efectivo/sesion y el ledger son
  responsabilidad de la base de datos, porque la aplicacion no sera la
  unica escritora: la Fase 15 trae un POS.

NFR-1403 Performance
  Indices por (tenant_id, order_id) en payments, (tenant_id,
  cash_session_id) en movimientos, y un indice unico parcial que
  arbitra "una sesion abierta por caja" sin necesidad de un lock.

NFR-1404 Escalabilidad
  Una caja de un negocio activo acumula cientos de movimientos por
  turno. Cerrarla es una suma indexada, no una reconstruccion completa.

NFR-1405 Observabilidad
  Eventos de §16. El ledger de movimientos ES la traza de auditoria de
  la caja, no un log paralelo — igual que order_status_history en la
  Fase 13.

NFR-1406 Mantenibilidad
  El voided/closed se declara una vez, como columnas nulables, y no se
  duplica en TypeScript porque no hay una maquina de estados que
  duplicar (ADR-018 §1).
```

---

## 8. Modelo de datos

### Enums nuevos

```text
payment_method_type = ('cash','yape','plin','card','transfer','other')
cash_movement_type   = ('sale','payout','deposit','adjustment')
```

### payment_methods

```text
id          UUID PK
tenant_id   UUID NOT NULL -> tenants(id) ON DELETE CASCADE
type        payment_method_type NOT NULL
name        TEXT NOT NULL          la etiqueta que el negocio elige
reference   TEXT NULL              telefono, cuenta, terminal — texto libre
is_active   BOOLEAN NOT NULL DEFAULT true
position    SMALLINT NOT NULL DEFAULT 0
created_at, updated_at

UNIQUE (tenant_id, lower(btrim(name)))
INDEX  (tenant_id) WHERE is_active
```

No se auto-provisiona por tenant. Comprobado antes de decidirlo: la Fase 10 sí
crea una sede por defecto (necesidad estructural — un pedido tiene que ocurrir
en algún sitio), pero la Fase 11 NO crea una categoría ni un producto por
defecto. Qué medios de pago acepta un negocio es esa misma clase de decisión
de catálogo, así que tampoco se siembra.

### cash_registers

```text
id          UUID PK
tenant_id   UUID NOT NULL -> tenants(id) ON DELETE CASCADE
location_id UUID NOT NULL -> locations(id) ON DELETE RESTRICT
name        TEXT NOT NULL
is_active   BOOLEAN NOT NULL DEFAULT true
created_at, updated_at

UNIQUE (tenant_id, location_id, lower(btrim(name)))
```

### cash_sessions

```text
id                UUID PK
tenant_id         UUID NOT NULL   derivado por trigger del register
cash_register_id  UUID NOT NULL -> cash_registers(id) ON DELETE RESTRICT
opened_by         UUID NULL -> auth.users(id) ON DELETE SET NULL
closed_by         UUID NULL -> auth.users(id) ON DELETE SET NULL
opening_cents     BIGINT NOT NULL DEFAULT 0
closing_cents     BIGINT NULL     solo existe si esta cerrada
expected_cents    BIGINT NULL     calculado al cerrar
difference_cents  BIGINT NULL     calculado al cerrar
notes             TEXT NULL
opened_at         TIMESTAMPTZ NOT NULL DEFAULT now()
closed_at         TIMESTAMPTZ NULL
updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()

CHECK  (closed_at IS NULL) = (closing_cents IS NULL)
       = (expected_cents IS NULL) = (difference_cents IS NULL)

UNIQUE INDEX (cash_register_id) WHERE closed_at IS NULL
  -- una sesion abierta por caja, a la vez
```

### payments

```text
id                 UUID PK
tenant_id          UUID NOT NULL   derivado por trigger del pedido
order_id           UUID NOT NULL -> orders(id) ON DELETE RESTRICT
payment_method_id  UUID NOT NULL -> payment_methods(id) ON DELETE RESTRICT
cash_session_id    UUID NULL     -> cash_sessions(id) ON DELETE RESTRICT
amount_cents       BIGINT NOT NULL
reference          TEXT NULL      codigo de operacion
notes              TEXT NULL
voided_at          TIMESTAMPTZ NULL
void_reason        TEXT NULL
created_by         UUID NULL
created_at, updated_at

CHECK  amount_cents > 0 y <= 10.000.000.000
CHECK  (voided_at IS NULL) = (void_reason IS NULL)

INDEX (tenant_id, order_id)
INDEX (tenant_id, cash_session_id) WHERE cash_session_id IS NOT NULL
```

### cash_movements

```text
id               UUID PK
tenant_id        UUID NOT NULL   derivado por trigger de la sesion
cash_session_id  UUID NOT NULL -> cash_sessions(id) ON DELETE RESTRICT
type             cash_movement_type NOT NULL
amount_cents     BIGINT NOT NULL   con signo: entra positivo, sale negativo
payment_id       UUID NULL      -> payments(id) ON DELETE RESTRICT
reason           TEXT NULL
created_by       UUID NULL
created_at       TIMESTAMPTZ NOT NULL DEFAULT now()

CHECK  amount_cents <> 0
CHECK  sale/deposit positivo, payout negativo, adjustment cualquier signo
CHECK  sale siempre tiene payment_id; payout/deposit nunca lo tienen

INDEX (cash_session_id, created_at)
INDEX (tenant_id, payment_id) WHERE payment_id IS NOT NULL
```

Sin `updated_at`, igual que `order_status_history`: es un ledger, nada en el
se actualiza jamas.

### Extensión a orders (Fase 13)

```text
orders.paid_cents  BIGINT NOT NULL DEFAULT 0

CHECK (paid_cents BETWEEN 0 AND total_cents)
```

Mantenido por un trigger sobre `payments`, con la misma postura que
`total_cents` en la Fase 13: lo calcula la base, la aplicación no vota.

---

## 9. Diagrama de relaciones

```text
tenants ──┬──► payment_methods
          │
          ├──► locations ──► cash_registers ──► cash_sessions ──┬──► cash_movements
          │                                                     │         ▲
          └──► orders ──────────────────────► payments ─────────┴─────────┘
                (paid_cents,                  (order_id, payment_method_id,
                 total_cents)                  cash_session_id opcional)
```

Un `cash_movements.payment_id` apunta de vuelta a `payments`: la fila "venta"
y la fila de compensación de una anulación, ambas escritas por trigger, llevan
el pago que las originó. Un movimiento manual (payout/deposit/adjustment) no
lleva payment_id — no hay pago del que provenga.

---

## 10. Tenant Isolation

```text
Tenant Isolation Impact: TOTAL
```

**¿Cómo se determina el tenant?** `requireActiveTenant(tenantSlug)` (Fase 01).
Ningún Server Action acepta un `tenantId` del formulario.

**¿Qué tablas llevan tenant_id?** `payment_methods` y `cash_registers` lo
reciben directo y lo verifica RLS, igual que `locations` (Fase 10) —son
entidades de configuración propias del tenant. `cash_sessions` lo deriva de su
`cash_register_id`, `payments` lo deriva de su `order_id`, y `cash_movements`
lo deriva de su `cash_session_id` — la misma cadena de derivación que
`order_items`/`order_status_history` usan desde su `order_id` en la Fase 13.

**¿Cómo evita RLS acceso cross-tenant?** Toda política se apoya en
`has_permission(tenant_id, ...)`. Además, triggers comprueban que la sede de
una caja, el método de un pago y la sesión de un pago pertenezcan al mismo
tenant que el recurso padre — la misma clase de agujero que la Fase 11 cerró
entre producto y categoría, y la Fase 13 entre pedido y sede.

**¿Existe algún recurso global?** Ninguno. A diferencia de `order_transitions`
en la Fase 13 (una máquina de estados sin tenant, legible por todos), esta
fase no tiene ninguna tabla `using (true)`: no hay una máquina que compartir,
porque ADR-018 §1 decidió no construir una.

---

## 11. Seguridad

```text
Authentication requirements
  Sesion valida resuelta en servidor.

Authorization requirements
  payments.view            leer los pagos de un pedido
  payments.create          registrar un pago
  payments.void            anular un pago
  payment_methods.view     ver el catalogo de metodos
  payment_methods.manage   crear/editar metodos
  cash.view                ver cajas, sesiones y movimientos
  cash.manage              crear cajas, registrar movimientos manuales
  cash.open / cash.close   abrir/cerrar una sesion (Fase 03, sin cambios)

Roles involucrados
  owner, admin           los siete permisos nuevos
  manager                todo excepto payment_methods.manage — que
                          medios acepta el negocio es una decision de
                          empresa, igual que abrir una sede (Fase 10)
  cashier                view/create de payments y payment_methods,
                          cash.view, cash.open, cash.close — cobra y
                          abre/cierra caja, no anula ni configura
  accountant              view de los tres recursos, nada de escritura

RLS policies
  payment_methods_*      select por view, insert/update por manage
  cash_registers_*        select por view, insert/update por manage
  cash_sessions_*          select por view, insert por open, update por close
  payments_*                select por view, insert por create,
                            update (solo anular) por void
  cash_movements_*          select por view; insert manual por manage,
                            restringido a payout/deposit/adjustment sin
                            payment_id — la fila "sale" y la de
                            compensacion las escribe un trigger
                            SECURITY DEFINER, que no pasa por esta
                            politica (igual que el trigger de totales
                            de la Fase 13 escribe en orders sin que
                            orders necesite una politica para el)

  SIN politica publica en ninguna de las cinco tablas.
  SIN politica de DELETE en ninguna de las cinco tablas.
  SIN politica de UPDATE en cash_movements: el ledger es de solo
    insercion, igual que order_status_history.

Input validation
  Zod en el borde, CHECK y triggers en la base.

Potential abuse cases
  AB-1401  Pagar mas de lo que un pedido debe, para generar un saldo a
           favor inexistente.
           Mitigado: guard_payment() calcula paid_cents + amount_cents
           contra total_cents ANTES de aceptar la fila.
  AB-1402  Usar un metodo de pago de otro negocio.
           Mitigado: guard_payment() compara el tenant del metodo con
           el del pedido.
  AB-1403  Pagar en efectivo sin una sesion abierta, o con la sesion de
           otra sede.
           Mitigado: guard_payment() exige sesion abierta Y misma sede.
  AB-1404  Anular un pago sin el permiso payments.void, usando la
           misma via que crea pagos.
           Mitigado: es una politica UPDATE distinta, con su propio
           permiso — orders.cancel/orders.update ya establecio el
           patron en la Fase 13.
  AB-1405  Insertar un movimiento de caja de tipo "sale" a mano, para
           inflar el efectivo esperado sin haber cobrado nada.
           Mitigado: la politica de insert manual excluye "sale" por
           tipo y exige payment_id nulo.
  AB-1406  Abrir dos sesiones a la vez en la misma caja para duplicar
           el monto inicial declarado.
           Mitigado: indice unico parcial, no una comprobacion de la
           aplicacion.
```

### La decisión de seguridad: el monto SÍ se acepta del cliente, el tope no

A diferencia de una línea de pedido (Fase 13), donde el precio nunca viaja
desde el formulario porque el catálogo ya lo conoce, un pago no tiene un
"precio correcto" que el sistema pueda copiar — cuánto se cobró es un hecho
que solo el cajero, mirando el efectivo o la pantalla de Yape, puede declarar.
Así que `amount_cents` sí llega desde el formulario.

Lo que no se acepta es que ese monto deje al pedido en un estado imposible.
`guard_payment()` calcula, en la base de datos, si `paid_cents + amount_cents`
superaría `total_cents`, y rechaza la fila si es así — el mismo movimiento que
Fase 13 hace con los totales de un pedido: la aplicación no es la única
escritora (la Fase 15 traerá un POS), así que el tope no puede vivir solo en
un `if` de un Server Action.

---

## 12. API / Server Actions

```text
recordPaymentAction(prev, formData) -> FormState
  Permission: payments.create
  Input: tenantSlug, orderId, paymentMethodId, cashSessionId?, amount,
         reference?, notes?

voidPaymentAction(prev, formData) -> FormState
  Permission: payments.void
  Input: tenantSlug, orderId, paymentId, reason

createPaymentMethodAction / updatePaymentMethodAction
  Permission: payment_methods.manage
  Input: tenantSlug, type (solo create), name, reference?

setPaymentMethodActiveAction(prev, formData) -> FormState
  Permission: payment_methods.manage
  Input: tenantSlug, paymentMethodId, isActive

createCashRegisterAction(prev, formData) -> FormState
  Permission: cash.manage
  Input: tenantSlug, locationId, name

setCashRegisterActiveAction(prev, formData) -> FormState
  Permission: cash.manage
  Input: tenantSlug, cashRegisterId, isActive

openCashSessionAction(prev, formData) -> FormState
  Permission: cash.open
  Input: tenantSlug, cashRegisterId, opening, notes?

closeCashSessionAction(prev, formData) -> FormState
  Permission: cash.close
  Input: tenantSlug, cashSessionId, closing
  El expected/difference NO viaja. Lo calcula la base.

recordCashMovementAction(prev, formData) -> FormState
  Permission: cash.manage
  Input: tenantSlug, cashSessionId, type (payout|deposit|adjustment),
         amount, reason
```

Consultas:

```text
listPaymentMethods(tenantId, { activeOnly? })
listCashRegisters(tenantId) -> con su sesion abierta, si tiene una
listOpenSessionsForLocation(tenantId, locationId)
getCashSessionDetail(tenantId, sessionId) -> sesion + ledger + vista previa
listCashSessions(tenantId, cashRegisterId, limit) -> historial de una caja
```

Y una extensión de la Fase 13: `getOrderDetail` ahora incluye `payments`,
`paidCents` y `balanceCents`.

---

## 13. UI / UX

```text
/dashboard/{slug}/pedidos/{orderId}   (extendida)
  Tarjeta "Pagos": saldo, lista de pagos, formulario para registrar uno.
  El selector de sesion de caja solo aparece si el metodo elegido es
  efectivo.
  Permissions   payments.view; create/void segun el boton

/dashboard/{slug}/caja
  Propósito     Ver el estado de cada caja, abrirla o cerrarla
  Acciones      Abrir sesion, ver movimientos, cerrar
  Permissions   cash.view; open/close/manage segun el boton

/dashboard/{slug}/caja/{sessionId}
  Propósito     El ledger de una sesion, y su cierre
  Acciones      Registrar movimiento manual, cerrar
  Permissions   cash.view; manage para movimientos, close para cerrar

/dashboard/{slug}/configuracion/pagos
  Propósito     Catalogo de metodos de pago del negocio
  Acciones      Crear, activar/desactivar
  Permissions   payment_methods.view; manage para el resto
  Entrada de navegacion propia, no un enlace dentro de Configuracion —
  misma razon que /configuracion/dominios en la Fase 09: admin tiene
  payment_methods.manage pero no settings.manage.
```

---

## 14. Flujos principales

```text
Cajero cobra en efectivo
   ↓
Elige metodo (efectivo), sesion de caja abierta de la sede, monto
   ↓
recordPaymentAction
   ↓
requireActiveTenant + requirePermission(payments.create)
   ↓
Zod: monto, ids
   ↓
insert payments        -> trigger deriva tenant_id del pedido
                        -> trigger valida metodo, sesion, tope
                        -> trigger fuerza voided_at/void_reason a NULL
   ↓                   -> trigger escribe movimiento "sale" en la caja
   ↓                   -> trigger recalcula orders.paid_cents
Pago registrado, saldo actualizado

Cajero cierra caja
   ↓
Declara el monto contado
   ↓
closeCashSessionAction -> requirePermission(cash.close)
   ↓
update cash_sessions SET closing_cents
   ↓
trigger suma opening_cents + Σ cash_movements
   ↓
expected_cents y difference_cents quedan escritos
```

---

## 15. Manejo de errores

```text
Pedido anulado                    -> P0001, "cancelled order"
Pago sobrepasaria el saldo        -> P0001, "overpaid"
Pago anulado dos veces            -> P0001, "already voided"
Editar un pago mas alla de anular -> P0001, "Only voiding fields"
Sesion ya cerrada                 -> P0001/23514, "already closed"
Metodo de otro negocio            -> 23514, "different business"
Metodo desactivado                -> 23514, "not active"
Efectivo sin sesion abierta       -> 23514, "open cash session"
Sesion no efectivo                -> 23514, "Only a cash payment"
Anular sin motivo                 -> 23514, "requires a reason"
Dos sesiones abiertas a la vez    -> 23505, indice unico
Sin permiso                       -> AuthorizationError
```

---

## 16. Observabilidad

```text
payment.recorded
payment.voided
payment_method.created / .updated / .activated / .deactivated
cash_register.created / .activated / .deactivated
cash_session.opened / .closed
cash_movement.recorded
```

Con `tenantId` y, cuando aplica, `orderId`. El ledger de movimientos y el
historial de sesiones SON la traza de auditoría real; los logs son para
operar, igual que en la Fase 13.

---

## 17. Testing Plan

### Unit

```text
TEST-1401  recordPaymentSchema no tiene campo voidedAt ni tenantId.
TEST-1402  El monto se parsea a centavos enteros; cero o vacio se
           rechaza.
TEST-1403  El schema NO valida la regla efectivo/sesion — parsea bien
           una combinacion que la base rechazaria, porque esa regla
           vive una sola vez, en guard_payment().
TEST-1404  Anular exige un motivo no vacio.
TEST-1405  createPaymentMethodSchema acepta los seis tipos de §14 y
           rechaza cualquier otro.
TEST-1406  closeCashSessionSchema no tiene expectedCents ni
           differenceCents.
TEST-1407  Un monto de apertura o cierre de cero es valido.
TEST-1408  Un movimiento manual acepta un signo negativo con "-";
           rechaza el tipo "sale" y un monto cero.
```

### Database / Integridad

```text
TEST-1409  EL TEST DE LA FASE. La suma de pagos vigentes nunca supera
           total_cents; un pago que lo haria es rechazado y
           paid_cents no se mueve.
TEST-1410  Un pedido anulado rechaza pagos nuevos.
TEST-1411  Un metodo de otro tenant, o desactivado, es rechazado.
TEST-1412  Efectivo sin sesion, con sesion de otra sede, o con sesion
           cerrada: los tres rechazados.
TEST-1413  Un metodo no efectivo con cash_session_id es rechazado.
TEST-1414  Una caja no admite una segunda sesion abierta mientras la
           primera sigue abierta.
TEST-1415  Cerrar suma apertura + movimientos y calcula la
           diferencia contra lo declarado, correctamente en ambos
           sentidos (exacto y con faltante).
TEST-1416  Cerrar una sesion ya cerrada es rechazado.
TEST-1417  Anular un pago en efectivo neta paid_cents a cero y escribe
           un movimiento de compensacion; uno no efectivo neta
           paid_cents sin escribir ningun movimiento.
TEST-1418  Anular dos veces, o sin motivo, es rechazado.
TEST-1419  Un pago no se puede editar mas alla de sus campos de
           anulacion.
TEST-1420  Una caja cuya sede es de otro tenant es rechazada.
TEST-1421  El tenant de un pago se deriva del pedido, ignorando lo
           que se envie.
```

### RLS / Authorization

```text
TEST-1422  Ninguna politica de las cinco tablas concede a anon.
TEST-1423  Ninguna de las cinco tablas admite DELETE.
TEST-1424  cash_movements no admite UPDATE.
TEST-1425  Tenant A no ve pagos, sesiones ni cajas de tenant B.
TEST-1426  Un cajero registra un pago y no puede anularlo (la fila
           simplemente no es alcanzada por el UPDATE, sin error —
           comportamiento normal de RLS); un encargado si puede.
TEST-1427  Solo owner/admin pueden crear un metodo de pago; un
           cajero no.
TEST-1428  El contador lee pagos y no puede escribir uno.
TEST-1429  Un movimiento manual que se declara "sale" es rechazado
           por RLS; uno "payout" con motivo es aceptado.
```

### Regression

```text
TEST-1430  Contrato de tipos con las cinco tablas nuevas y con
           orders.paid_cents.
TEST-1431  Ninguna tabla fuera del contrato declarado.
TEST-1432  El catalogo de permisos de TypeScript coincide con el de
           la base (los siete nuevos incluidos).
```

---

## 18. Edge Cases

```text
Pago exacto al saldo               Deja el pedido en balanceCents = 0.
Pago que completa dos metodos      Cada uno es una fila; el saldo baja
                                    con cada insercion.
Apertura de caja en cero           Valida: algunos negocios no dejan
                                    nada en el cajon al empezar.
Cierre con diferencia negativa     Valido y visible: faltante en caja.
Cierre con diferencia positiva     Valido y visible: sobrante en caja.
Anular el unico pago de un pedido  El pedido vuelve a deber el total.
Metodo desactivado con historia    Los pagos ya hechos con el siguen
                                    intactos; no aparece para uno nuevo.
Dos cajeros abren la misma caja    Uno gana, el otro recibe el error
a la vez                           del indice.
Pedido con saldo cero              El formulario de registrar pago no
                                    se muestra: no hay nada que cobrar.
```

---

## 19. Performance considerations

```text
Queries    El detalle de un pedido trae sus pagos con un embed, no una
           consulta aparte. El cierre de una sesion es una suma
           indexada sobre cash_movements, no una reconstruccion.

Indexes    (tenant_id, order_id) en payments — "los pagos de este
           pedido". (cash_session_id, created_at) en cash_movements —
           el ledger de una sesion, en orden. El indice unico parcial
           de cash_sessions resuelve la concurrencia sin un lock,
           igual que el correlativo de pedidos en la Fase 13.

Totales    paid_cents lo recalcula un trigger sobre payments, no una
           consulta agregada en cada lectura de un pedido.

N+1        listCashRegisters trae la sesion abierta de cada caja con
           un embed; no hay una consulta por caja.

Caching    Ninguno: son datos operativos que cambian por minuto.
```

---

## 20. Migraciones

```text
20260827140000_create_payment_permissions.sql
  Los siete permisos nuevos y sus otorgamientos por rol.

20260827140100_create_payment_methods.sql
  Tabla payment_methods, enum payment_method_type, RLS.

20260827140200_create_cash_registers.sql
  Tabla cash_registers, guarda de sede/tenant, RLS.

20260827140300_create_cash_sessions.sql
  Tabla cash_sessions, indice unico de sesion abierta, calculo de
  cierre, RLS.

20260827140400_create_payments_and_movements.sql
  Tablas payments y cash_movements (juntas: el trigger de pagos
  escribe en movimientos), enum cash_movement_type, todos los guards,
  RLS.

20260827140500_extend_orders_paid_cents.sql
  Columna orders.paid_cents y su CHECK contra total_cents.
```

---

## 21. Rollback

Aditivas. Revertir es soltarlas en orden inverso:

```sql
alter table public.orders drop column if exists paid_cents;
drop table if exists public.cash_movements;
drop table if exists public.payments;
drop table if exists public.cash_sessions;
drop table if exists public.cash_registers;
drop table if exists public.payment_methods;
drop type  if exists public.cash_movement_type;
drop type  if exists public.payment_method_type;
delete from public.role_permissions where permission like 'payments.%'
  or permission like 'payment_methods.%' or permission in ('cash.view','cash.manage');
delete from public.permissions where code like 'payments.%'
  or code like 'payment_methods.%' or code in ('cash.view','cash.manage');
```

Este sigue siendo un punto razonablemente barato para revertir: nada fuera de
esta fase depende todavía de `payments` o `cash_sessions`. Eso cambia en cuanto
la Fase 15 (POS) empiece a escribir contra ellas — a partir de ahí, soltar
estas tablas se lleva por delante cobros reales, igual que Fase 13 advirtió
sobre `orders` de cara a esta misma fase.

---

## 22. Definition of Done

- [x] Enums y las cinco tablas creadas con los valores de §14
- [x] `orders.paid_cents` añadido y mantenido por trigger
- [x] TEST-1409 en verde: el tope de pago se prueba, no se supone
- [x] Efectivo exige sesion abierta en la misma sede; otros metodos la
      rechazan
- [x] Una caja no admite dos sesiones abiertas a la vez
- [x] Cierre calculado por la base (expected/difference), no por el
      formulario
- [x] Anular es un UPDATE separado, con su propio permiso, y compensa el
      ledger cuando aplica
- [x] RLS en las cinco tablas
- [x] Cero politicas para `anon`, afirmado por test
- [x] Sin DELETE en ninguna tabla nueva; sin UPDATE en cash_movements
- [x] Guardas de tenant para metodo, sesion, caja y sede
- [x] Los siete permisos nuevos, otorgados explicitamente a owner/admin
- [x] Tarjeta de pagos en el detalle de pedido; pantallas de Caja y
      Metodos de pago
- [x] Entradas de navegacion con permiso propio
- [x] Tipos actualizados y contrato de schema verificando columnas
- [x] Unit tests PASS
- [x] Database tests PASS
- [x] Cross-tenant y RLS tests PASS
- [x] Typecheck PASS
- [x] Lint PASS
- [x] Build PASS
- [x] SPEC actualizado

---

## 23. Implementation notes

### La forma que tomó "anular"

La decisión que ordenó todo lo demás fue negarse a repetir la máquina de
estados de la Fase 13. Un pago vive o está anulado — un solo borde — y
`voided_at`/`void_reason` nulables dicen eso completo. Lo interesante es lo
que esa elección obligó a comprobar en `guard_payment_void()`: no basta con
permitir el UPDATE que anula, hay que **rechazar cualquier otro**. La función
compara cada columna que no sea de anulación contra su valor anterior y
rechaza la fila si algo cambió — porque una política RLS de UPDATE, por sí
sola, no distingue "cambiaste el motivo de anulación" de "cambiaste el
monto".

Y de ahí salió un agujero que no estaba en el plan original: nada impedía que
un INSERT llegara con `voided_at` ya puesto, saltándose por completo el
trigger de compensación (que solo dispara en UPDATE OF voided_at). Se cerró
forzando `new.voided_at := null` dentro de `guard_payment()` — un pago nace
vivo, siempre, y anular es exclusivamente el camino UPDATE. Ninguna prueba lo
hubiera detectado hasta que alguien insertara así deliberadamente; se corrigió
al escribir el trigger, no al descubrir el fallo en un test.

### Por qué `cash_movements` existe como tabla y no como una vista

La tentación obvia era calcular "lo que la caja debería tener" con un `sum()`
sobre `payments` en el momento de cerrar. Funciona exactamente hasta que un
negocio necesita registrar un vuelto para un mototaxi o un refuerzo de caja
desde la caja fuerte — movimientos que no son pagos y nunca lo serán. La lista
del propio master doc (`payments`, `payment_methods`, `cash_registers`,
`cash_sessions`, `cash_movements`) ya distinguía las cinco cosas; construir
la quinta como una vista derivada de la cuarta habría sido ignorar esa
distinción para ahorrarse una tabla.

### El monto sí viaja desde el formulario, y eso es correcto

A diferencia de todo lo que la Fase 13 protegió (el precio de una línea nunca
llega del cliente porque el catálogo ya lo sabe), un pago no tiene un valor de
referencia contra el cual el servidor pueda validar el monto: cuánto se
cobró es un hecho que solo observa quien tiene el efectivo o la pantalla de
Yape delante. La protección aquí no podía ser "no aceptar el campo" —tenía que
ser "acotar lo que ese campo puede hacer", que es exactamente lo que
`guard_payment()` calcula contra `paid_cents`/`total_cents` antes de aceptar
la fila.

### Qué se verificó y qué no

Verificado corriendo: el tope de pago rechaza exactamente en el centavo
límite y no antes; anular una venta en efectivo dejó `paid_cents` en cero y
escribió la fila de compensación con el signo correcto; una sesión no admite
un segundo abierto en la misma caja; cerrar con el monto exacto da diferencia
cero, y con un faltante da la diferencia negativa esperada; los siete permisos
nuevos están en el catálogo de TypeScript y coinciden con la migración;
`npm run typecheck`, `npm run lint`, `npm run build` y la suite completa de
tests (1255, incluidos los 52 nuevos de esta fase) pasan en verde.

No verificado corriendo: nadie ha abierto estas pantallas contra un Supabase
real ni contra un navegador — esta sesión no tenía Docker disponible para
levantar `supabase start`, así que la verificación es la que Phase 13 ya
advirtió que hace falta después: consultas ejercitadas como SQL y como tipos,
no contra PostgREST (ADR-007). La carrera de "una sesión abierta por caja"
está razonada y cubierta por el índice único, pero no ejercitada con dos
escritores concurrentes de verdad — PGlite es un proceso único, la misma
limitación que Fase 13 documentó para el correlativo de pedidos.

---

## 24. Known limitations

```text
KL-1401  El pago no tiene numero correlativo ni de recibo. No es
         legalmente relevante hasta que exista una serie SUNAT
         (Fase 17); el UUID del pago y el numero del pedido bastan
         por ahora.

KL-1402  No hay reintento automatico cuando dos cajeros chocan
         abriendo la misma caja. El Server Action devuelve el mensaje
         del indice; un reintento con backoff no se construyo sin
         haber visto chocar el caso real — misma decision que
         KL-1302 de la Fase 13 tomo para el correlativo de pedidos.

KL-1403  `opened_by`, `closed_by` y `created_by` se guardan pero no se
         muestran con el nombre de la persona: falta unirlos con
         `profiles`. Mismo limite que KL-1309 dejo en el historial de
         pedidos de la Fase 13.

KL-1404  El formulario de registrar pago no valida en el cliente que
         el monto no exceda el saldo — lo hace la base de datos, que
         es la fuente de verdad, pero un cajero que se equivoca solo
         se entera al enviar, no mientras escribe.

KL-1405  Un metodo de pago no se puede editar mas alla de nombre y
         referencia: el tipo es inmutable una vez creado, a proposito
         (los pagos existentes se validaron bajo ese tipo), pero
         tampoco existe una forma de "migrar" un metodo mal tipeado
         salvo desactivarlo y crear uno nuevo.

KL-1406  cash_movements no tiene quien lo cerro salvo por created_by;
         no hay una vista consolidada de "todas las cajas de todas
         las sedes en un solo lugar" - /caja lista todas las cajas
         del tenant, pero un negocio con muchas sedes no puede
         filtrar por sede desde la URL, a diferencia del listado de
         pedidos (Fase 13, FR-1316).

KL-1407  El saldo pendiente de un pedido no genera ninguna alerta ni
         recordatorio. Ningun requerimiento de esta fase lo pidio.
```

---

## 25. Future considerations

```text
- La Fase 15 (POS) traera un segundo escritor de payments y de
  cash_movements; el tope y las guardas ya estan en la base, que es
  la condicion para que un segundo escritor no invente su propia
  version de las reglas.
- La Fase 17 dara de baja los pagos "sueltos" en favor de comprobantes
  formales, y probablemente anadira el numero de serie que KL-1401
  deja pendiente.
- La Fase 17 tambien es donde una devolucion real de dinero (no una
  correccion de tipeo) tendria sentido, con una nota de credito detras.
- El historial de cierres por caja (cash_sessions) es consultable
  (listCashSessions) y ya se muestra de forma resumida en /caja; una
  pantalla dedicada con filtros por fecha es un paso natural cuando
  algun negocio lo pida.
- orders.paid_cents es exacto y esta listo para que un reporte de caja
  chica o de cuentas por cobrar (Fase 23) lo use sin recalcular nada.
```
