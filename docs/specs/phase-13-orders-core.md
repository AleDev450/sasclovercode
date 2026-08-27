# SPEC — Phase 13 — Orders Core

## 1. Información general

```text
Phase:                13
Nombre:               Orders Core
Estado:               COMPLETED
Versión:              1.0.0
Fecha creación:       2026-08-27
Última actualización: 2026-08-27
Responsable:          alejandro.avendano@masuno.pe
```

Documento maestro: §7, §8, §10, §11, §12, §18, §21, §22, §30, §32, §33 (Fase 13), §39, §45.
Fases previas: 00 a 12 — todas COMPLETED y auditadas.

---

## 2. Objetivo

### ¿Por qué existe esta fase?

Todo lo anterior fue preparación. CloverCode sabe quién es el negocio (01),
quién trabaja en él (02–03), dónde opera (10), qué vende (11) y a quién (12).
Esta es la primera fase en la que **pasa algo**: alguien compra.

Es también la fase que convierte a CloverCode en un sistema de registro. Hasta
ahora todo dato era corregible — un precio mal puesto se arregla y no queda
rastro. Un pedido no: es lo que ocurrió, y a partir de aquí el sistema tiene que
poder responder "¿qué se vendió el martes?" con una respuesta que no cambie
según cuándo se pregunte.

### Las dos frases que gobiernan la fase

§33, Fase 13, textuales:

> Los precios del pedido deben guardarse como snapshot.
> Nunca depender del precio actual de `products` para calcular pedidos
> históricos.

y

> Estados definidos mediante state machine clara.
> Evitar cambios de estado arbitrarios.

Las dos dicen lo mismo en el fondo: **un pedido es un hecho, no una vista**. Un
total que se recalcula desde el catálogo y un estado que se puede poner a
cualquier cosa son las dos formas de que un hecho deje de serlo.

### ¿Qué debe ser posible al terminarla?

```text
Registrar un pedido con sus líneas, en una sede, desde cualquiera de
  las cinco fuentes de §33.
Que el total de ese pedido no cambie nunca más, pase lo que pase con
  el catálogo.
Moverlo por su ciclo de vida sin poder saltarse pasos ni resucitarlo.
Ver quién lo movió, cuándo y desde qué estado.
Que la Fase 14 le cuelgue pagos y la Fase 17 le emita un comprobante.
```

---

## 3. Alcance

### Incluido

```text
Tablas orders, order_items, order_status_history.
Enums order_status y order_source, con los valores de §33.
Máquina de estados declarada EN LA BASE y aplicada por trigger.
Snapshot de precio, cantidad, descuento, impuesto y total por línea.
Numeración correlativa por tenant, a prueba de concurrencia.
Totales calculados por la base de datos, con la aplicación sin voto.
RLS con los cuatro permisos orders.* de la Fase 03.
Dashboard: listado con filtros y paginación, alta, detalle,
  transiciones de estado y anulación.
```

### Fuera de alcance

```text
Pagos, vueltos, caja            — Fase 14.
Pantalla de POS                 — Fase 15.
Pantalla de cocina / KDS        — Fase 16.
Boleta, factura, SUNAT          — Fase 17.
Descuento de stock              — Fase 18.
Reparto, repartidores, rutas    — Fase 19.
Promociones y cupones           — Fase 20.
Pedidos desde la web pública    — la fuente `web` existe en el enum;
                                  el formulario público que la usa es
                                  de una fase posterior. Ver KL-1310.
Impuestos calculados            — la columna existe y se guarda; quién
                                  decide el IGV es la Fase 17. KL-1305.
Edición de líneas tras confirmar— ver KL-1303.
```

### La decisión de alcance que más costó

`tax_cents` **se guarda pero no se calcula**. §33 lo pide entre los campos del
snapshot, así que la columna existe y viaja en el total; pero quién decide si
algo lleva IGV, cuánto, y si el precio ya lo incluye, es la Fase 17 con las
reglas de SUNAT delante.

La alternativa era inventar aquí un 18% que la Fase 17 tendría que desmontar.
Guardar la columna con cero y documentarlo deja el snapshot completo — que es lo
que §33 pide — sin fabricar una regla fiscal por adelantado (§51).

---

## 4. Dependencias

```text
Phase 01 — Multi-Tenancy Core   tenants, requireActiveTenant
Phase 03 — Authorization + RLS  has_permission, orders.* (los cuatro)
Phase 05 — Tenant Dashboard     layout, navegación, guardas
Phase 10 — Locations            un pedido ocurre en una sede
Phase 11 — Catalog              de dónde se copia el snapshot
Phase 12 — Customers            a quién se le vende (opcional en la fila)
ADR-015 — Money as minor units  toda la aritmética de esta fase
```

**Nada nuevo en el catálogo de permisos.** `orders.view`, `orders.create`,
`orders.update` y `orders.cancel` existen desde la Fase 03, ya repartidos:
`kitchen` y `delivery` tienen `view` y `update` pero no `create`, que es
exactamente lo que esta fase necesita.

---

## 5. Casos de uso

```text
UC-1301
Actor           Cajero
Precondiciones  Sesión activa, orders.create, sede activa
Acción          Registra un pedido con tres líneas del catálogo
Resultado       Pedido en `pending`, con número correlativo del negocio
                y totales calculados por la base
Errores         Producto de otro negocio -> rechazo de la base
                Sede inactiva -> error de campo
                Sin líneas -> error de campo

UC-1302
Actor           Cocina
Precondiciones  orders.update, pedido en `confirmed`
Acción          Lo pasa a `preparing`
Resultado       Estado cambiado y una fila en order_status_history
Errores         Transición no permitida -> rechazo de la base

UC-1303
Actor           Cajero
Precondiciones  Pedido en `completed`
Acción          Intenta devolverlo a `pending`
Resultado       Rechazado. Un pedido completado no vuelve atrás.
Errores         P0001 con el mensaje de la transición

UC-1304
Actor           Administrador
Precondiciones  orders.cancel, pedido no completado
Acción          Anula el pedido indicando el motivo
Resultado       Estado `cancelled`, motivo guardado en el historial
Errores         Pedido ya completado -> rechazado
                Sin orders.cancel -> AuthorizationError

UC-1305
Actor           Dueño
Precondiciones  Un pedido de hace un mes; el precio del producto subió
Acción          Abre el pedido
Resultado       Ve exactamente los importes que se cobraron entonces
Errores         —

UC-1306
Actor           Dos cajeros a la vez
Precondiciones  orders.create
Acción          Crean un pedido simultáneamente
Resultado       Dos números correlativos distintos
Errores         —
```

---

## 6. Requerimientos funcionales

```text
FR-1301  Un pedido pertenece a exactamente un tenant y a una sede de
         ese mismo tenant.

FR-1302  Un pedido tiene un número correlativo único dentro del
         negocio, asignado por la base de datos.

FR-1303  Un pedido puede tener cliente o no tenerlo. Un consumidor que
         paga en efectivo y se va no obliga a registrar a nadie.

FR-1304  El cliente de un pedido, si existe, pertenece al mismo tenant.

FR-1305  Las fuentes son exactamente web, pos, manual, whatsapp y
         delivery (§33).

FR-1306  Los estados son exactamente pending, confirmed, preparing,
         ready, completed y cancelled (§33).

FR-1307  Solo son posibles las transiciones declaradas. Cualquier otra
         es rechazada por la base de datos.

FR-1308  completed y cancelled son terminales: de ellos no sale nada.

FR-1309  Cada cambio de estado deja una fila en order_status_history
         con estado anterior, nuevo, autor y momento.

FR-1310  Una línea de pedido guarda el nombre, el precio unitario, la
         cantidad, el descuento, el impuesto y el total COMO COPIA. No
         se lee `products` para calcular un pedido.

FR-1311  El total de una línea es
         round(unit_price * quantity) - discount + tax.

FR-1312  El total del pedido es la suma de sus líneas más el envío.
         Lo calcula la base de datos, no la aplicación.

FR-1313  Un pedido sin líneas no puede salir de `pending`.

FR-1314  Un pedido no se borra nunca.

FR-1315  Las líneas de un pedido no cambian una vez que sale de
         `pending`.

FR-1316  El listado admite filtro por estado, sede y fecha, y está
         paginado (§18).

FR-1317  Un producto archivado no puede añadirse a un pedido nuevo,
         pero los pedidos que ya lo tienen siguen intactos.
```

---

## 7. Requerimientos no funcionales

```text
NFR-1301 Seguridad
  Los cuatro permisos orders.* gobiernan las cuatro operaciones.
  Anular es un permiso separado de actualizar, y eso importa: un
  cocinero mueve pedidos y no debe poder anularlos.

NFR-1302 Integridad
  El requisito duro de la fase. Los totales y las transiciones son
  responsabilidad de la base de datos, porque la aplicación no es el
  único escritor: la Fase 15 traerá un POS y la 19 un repartidor.

NFR-1303 Performance
  Índices por (tenant_id, status), (tenant_id, location_id, placed_at)
  y (tenant_id, customer_id). El listado pagina de 20 en 20.

NFR-1304 Escalabilidad
  Un restaurante hace cientos de pedidos al día. Ninguna consulta trae
  la tabla entera ni recorre líneas para totalizar en la aplicación.

NFR-1305 Observabilidad
  Eventos de §16. El historial de estados ES la traza de auditoría del
  pedido, no un log paralelo.

NFR-1306 Mantenibilidad
  La máquina de estados se declara UNA vez, en SQL, y TypeScript la
  refleja para la UI. Las dos se prueban contra la misma tabla.
```

---

## 8. Modelo de datos

### Enums nuevos

```text
order_status = ('pending','confirmed','preparing','ready','completed','cancelled')
order_source = ('web','pos','manual','whatsapp','delivery')
```

Exactamente los de §33, en el orden en que los enumera.

### orders

```text
id              UUID PK
tenant_id       UUID NOT NULL -> tenants(id) ON DELETE CASCADE
location_id     UUID NOT NULL -> locations(id) ON DELETE RESTRICT
customer_id     UUID NULL     -> customers(id) ON DELETE RESTRICT
number          INTEGER NOT NULL      correlativo por tenant
status          order_status NOT NULL DEFAULT 'pending'
source          order_source NOT NULL DEFAULT 'manual'
notes           TEXT NULL
subtotal_cents  BIGINT NOT NULL DEFAULT 0   calculado
discount_cents  BIGINT NOT NULL DEFAULT 0   calculado
tax_cents       BIGINT NOT NULL DEFAULT 0   calculado
shipping_cents  BIGINT NOT NULL DEFAULT 0   lo pone quien crea
total_cents     BIGINT NOT NULL DEFAULT 0   calculado
placed_at       TIMESTAMPTZ NOT NULL DEFAULT now()
completed_at    TIMESTAMPTZ NULL
cancelled_at    TIMESTAMPTZ NULL
cancel_reason   TEXT NULL
created_by      UUID NULL -> auth.users(id) ON DELETE SET NULL
created_at, updated_at

UNIQUE (tenant_id, number)
CHECK   importes >= 0 y <= 10.000.000.000
CHECK   cancel_reason presente si y solo si status = 'cancelled'
CHECK   completed_at presente si y solo si status = 'completed'

INDEX (tenant_id, status)
INDEX (tenant_id, location_id, placed_at DESC)
INDEX (tenant_id, customer_id) WHERE customer_id IS NOT NULL
```

`ON DELETE RESTRICT` en sede y cliente, no CASCADE: borrar una sede no puede
llevarse la historia de ventas por delante. En la práctica no se dispara — ni
sedes ni clientes se borran — pero la declaración dice qué pasaría.

### order_items

```text
id              UUID PK
order_id        UUID NOT NULL -> orders(id) ON DELETE CASCADE
tenant_id       UUID NOT NULL   derivado por trigger
product_id      UUID NULL     -> products(id) ON DELETE SET NULL
variant_id      UUID NULL     -> product_variants(id) ON DELETE SET NULL

-- EL SNAPSHOT (§33)
name_snapshot     TEXT NOT NULL
variant_snapshot  TEXT NULL
unit_price_cents  BIGINT NOT NULL
quantity          NUMERIC(10,3) NOT NULL
discount_cents    BIGINT NOT NULL DEFAULT 0
tax_cents         BIGINT NOT NULL DEFAULT 0
total_cents       BIGINT NOT NULL   calculado
notes             TEXT NULL
position          SMALLINT NOT NULL DEFAULT 0
created_at, updated_at

CHECK quantity > 0 y <= 100000
CHECK unit_price_cents >= 0
CHECK discount_cents entre 0 y el bruto de la línea
INDEX (order_id, position)
```

`product_id` es **anulable y ON DELETE SET NULL** a propósito. La línea no
depende de él para nada: el nombre y el precio son suyos. El puntero sirve para
"cuántas veces vendimos esto", y si el producto desaparece la línea sigue siendo
exacta. Es la diferencia entre una referencia y una copia, y §33 pide la copia.

`quantity` es `numeric(10,3)`, no entero: se venden 0,75 kg de algo. Es el único
`numeric` de esta fase y **no es dinero** — ADR-015 sigue intacto.

### order_status_history

```text
id           UUID PK
order_id     UUID NOT NULL -> orders(id) ON DELETE CASCADE
tenant_id    UUID NOT NULL   derivado por trigger
from_status  order_status NULL    NULL en la creación
to_status    order_status NOT NULL
reason       TEXT NULL
changed_by   UUID NULL -> auth.users(id) ON DELETE SET NULL
created_at   TIMESTAMPTZ NOT NULL DEFAULT now()

INDEX (order_id, created_at)
```

Sin UPDATE ni DELETE: es un registro de hechos.

### order_transitions

La máquina de estados, **como datos**:

```text
from_status  order_status NOT NULL
to_status    order_status NOT NULL
PRIMARY KEY (from_status, to_status)
```

Transiciones declaradas:

```text
pending    -> confirmed, cancelled
confirmed  -> preparing, cancelled
preparing  -> ready, cancelled
ready      -> completed, cancelled
completed  -> (nada)
cancelled  -> (nada)
```

---

## 9. Diagrama de relaciones

```text
tenants ──┬──► locations ──┐
          │                │
          ├──► customers ──┤
          │                ▼
          └──────────► orders ──┬──► order_items ──► products
                                │                     (puntero, no dependencia)
                                └──► order_status_history

order_transitions   (tabla de datos, sin tenant: la máquina es del producto)
```

Máquina de estados:

```text
pending ──► confirmed ──► preparing ──► ready ──► completed
   │            │             │           │
   └────────────┴─────────────┴───────────┴──────► cancelled
```

---

## 10. Tenant Isolation

```text
Tenant Isolation Impact: TOTAL
```

**¿Cómo se determina el tenant?**
`requireActiveTenant(tenantSlug)` (Fase 01). Ningún Server Action acepta un
`tenantId` del formulario.

**¿Qué tablas llevan tenant_id?**
`orders` lo recibe y lo verifica RLS. `order_items` y `order_status_history` lo
**derivan por trigger** del pedido padre, como los hijos de `products` (11) y de
`customers` (12).

`order_transitions` **no lleva tenant_id**, y es deliberado: la máquina de
estados es del producto, no de cada negocio. Un tenant no define sus propias
transiciones. Es legible por todos y no escribible por nadie.

**¿Cómo evita RLS acceso cross-tenant?**
Toda política se apoya en `has_permission(tenant_id, ...)`. Además, dos triggers
comprueban que la sede y el cliente del pedido pertenezcan al mismo tenant: son
dos claves ajenas a tablas que llevan tenant, y nada en el esquema impediría que
discrepen — el mismo agujero que la Fase 11 cerró entre producto y categoría.

**¿Existe algún recurso global?**
`order_transitions`, que no contiene datos de negocio. El correlativo de pedido
es **por tenant**: dos negocios tienen su pedido número 1.

---

## 11. Seguridad

```text
Authentication requirements
  Sesión válida resuelta en servidor.

Authorization requirements
  orders.view    leer
  orders.create  crear
  orders.update  mover de estado
  orders.cancel  anular

Roles involucrados
  owner, admin, manager   los cuatro
  cashier, waiter         view, create, update
  kitchen, delivery       view, update
  accountant              view

Permissions involucrados
  Ninguno nuevo. Los cuatro existen desde la Fase 03.

RLS policies
  orders_select_member / insert_creator / update_operator
  order_items_*            gobernadas por los permisos del pedido
  order_status_history     select + insert; sin update ni delete
  order_transitions        select para todos; sin escritura

  SIN política pública. Un pedido no es dato público.
  SIN política de DELETE en ninguna de las tres tablas.

Input validation
  Zod en el borde, CHECK y triggers en la base.

Potential abuse cases
  AB-1301  Cambiar el precio de una línea al crear el pedido.
           Mitigado: el precio se copia del catálogo EN LA BASE, no
           se acepta del formulario.
  AB-1302  Saltar estados para cerrar un pedido sin prepararlo.
           Mitigado: trigger contra order_transitions.
  AB-1303  Anular sin permiso usando la acción de actualizar.
           Mitigado: cancelar tiene su propia acción y su propio
           permiso; el trigger exige motivo.
  AB-1304  Añadir a un pedido un producto de otro negocio.
           Mitigado: trigger de tenant en la línea.
```

### La decisión de seguridad: el precio no se acepta del cliente

El formulario manda **producto y cantidad**. No manda el precio.

Aceptarlo sería la vulnerabilidad clásica del carrito: quien controla el
navegador controla lo que paga. Y no basta con "validarlo contra el catálogo" en
el Server Action, porque entonces el precio correcto ya lo conoce el servidor y
el campo del formulario no aporta nada excepto una vía de ataque.

Así que el snapshot lo hace la base de datos: un trigger `before insert` sobre
`order_items` lee `products` y `product_variants`, copia nombre y precio, y
calcula el total. El descuento sí viaja desde el formulario — es una decisión
del negocio, no un dato del catálogo — y va acotado al bruto de la línea.

Esto no contradice el snapshot: la copia se hace **una vez, al insertar**. A
partir de ahí la línea es independiente y ningún cambio de precio la toca.

---

## 12. API / Server Actions

```text
createOrderAction(prev, formData) -> FormState
  Permission: orders.create
  Input:  tenantSlug, locationId, customerId?, source, notes?,
          shipping, items[] (productId, variantId?, quantity, discount)
  El precio NO viaja. Lo pone la base.

addOrderItemAction / removeOrderItemAction
  Permission: orders.update
  Solo mientras el pedido está en `pending` (FR-1315).

advanceOrderStatusAction(prev, formData) -> FormState
  Permission: orders.update
  Input: tenantSlug, orderId, toStatus
  Errores: P0001 si la transición no existe

cancelOrderAction(prev, formData) -> FormState
  Permission: orders.cancel
  Input: tenantSlug, orderId, reason (obligatorio)
```

Consultas:

```text
listOrders(tenantId, filtros) -> OrderPage
getOrderDetail(tenantId, orderId) -> OrderDetail | null
listOrderTransitions() -> qué estados siguen a cuál
```

---

## 13. UI / UX

```text
/dashboard/{slug}/pedidos
  Propósito     Ver qué está pasando hoy
  Acciones      Filtrar por estado y sede, paginar, crear
  Empty state   Sin pedidos / sin resultados del filtro
  Permissions   orders.view; orders.create para el formulario

/dashboard/{slug}/pedidos/{orderId}
  Propósito     Un pedido, sus líneas y su historial
  Acciones      Avanzar de estado, anular, editar líneas si `pending`
  Estados       Los botones que se muestran salen de la máquina de
                estados, no de una lista escrita a mano en la UI
  Permissions   orders.view; update y cancel según el botón
```

Los filtros van en la URL (`?estado=`, `?sede=`, `?page=`), como en la Fase 12.

---

## 14. Flujos principales

```text
Cajero
   ↓
Elige sede, cliente (opcional), fuente, líneas
   ↓
createOrderAction
   ↓
requireActiveTenant + requirePermission(orders.create)
   ↓
Zod: sede, cantidades, descuentos
   ↓
insert orders            -> trigger asigna número correlativo
   ↓                     -> trigger escribe historial (NULL -> pending)
insert order_items       -> trigger copia nombre y precio del catálogo
   ↓                     -> trigger calcula el total de la línea
   ↓                     -> trigger recalcula los totales del pedido
Pedido en `pending`
   ↓
advanceOrderStatusAction -> trigger valida contra order_transitions
   ↓                     -> trigger escribe historial
```

---

## 15. Manejo de errores

```text
Transición no permitida       -> P0001, mensaje con origen y destino
Pedido sin líneas al avanzar  -> P0001
Producto de otro negocio      -> 23514
Sede de otro negocio          -> 23514
Sede inactiva                 -> 23514
Producto archivado            -> 23514
Anular sin motivo             -> 23514
Anular un pedido completado   -> P0001
Editar líneas fuera de pending-> P0001
Sin permiso                   -> AuthorizationError
```

---

## 16. Observabilidad

```text
order.created
order.status_changed   (con from y to)
order.cancelled
order.item.added
order.item.removed
```

Con `tenantId` y `orderId`. Sin datos del cliente (ADR-016 sigue aplicando: el
pedido nombra a una persona).

`order_status_history` es la traza de auditoría real; los logs son para operar.

---

## 17. Testing Plan

### Unit

```text
TEST-1301  La máquina de estados en TypeScript ofrece los mismos
           destinos que la tabla SQL.
TEST-1302  completed y cancelled no tienen salida.
TEST-1303  El total de línea es round(precio*cantidad) - desc + imp.
TEST-1304  Cantidad fraccionaria redondea a céntimo entero.
TEST-1305  El schema rechaza cantidad cero, negativa y descuento
           mayor que el bruto.
TEST-1306  Los filtros del listado toleran una URL escrita a mano.
```

### Database / Integridad

```text
TEST-1307  EL TEST DE LA FASE. Se crea un pedido, se cambia el precio
           del producto, y los importes del pedido no se mueven.
TEST-1308  Borrar el producto deja la línea intacta con su nombre.
TEST-1309  El total del pedido lo calcula la base al insertar,
           actualizar y borrar líneas.
TEST-1310  El correlativo es por tenant y no se repite.
TEST-1311  Dos tenants tienen ambos el pedido número 1.
TEST-1312  Una transición no declarada es rechazada.
TEST-1313  De completed y cancelled no se sale.
TEST-1314  Cada cambio de estado deja historial con from y to.
TEST-1315  Anular exige motivo.
TEST-1316  Un pedido sin líneas no sale de pending.
TEST-1317  Una línea con producto de otro tenant es rechazada.
TEST-1318  Una sede de otro tenant es rechazada.
TEST-1319  Un cliente de otro tenant es rechazado.
TEST-1320  Un producto archivado no entra en un pedido nuevo.
TEST-1321  No se pueden tocar las líneas fuera de pending.
```

### RLS / Authorization

```text
TEST-1322  Ninguna política de las tres tablas concede a anon.
TEST-1323  Ninguna tabla de pedidos admite DELETE.
TEST-1324  order_status_history no admite UPDATE.
TEST-1325  Tenant A no ve pedidos de tenant B.
TEST-1326  kitchen actualiza estado y no crea pedidos.
TEST-1327  accountant lee y no escribe.
TEST-1328  order_transitions es legible y no escribible.
```

### Regression

```text
TEST-1329  Contrato de tipos con las cuatro tablas nuevas.
TEST-1330  Ninguna tabla fuera del contrato declarado.
```

---

## 18. Edge Cases

```text
Pedido sin cliente             Válido y normal.
Pedido sin líneas              Existe en pending; no avanza.
Cantidad 0,75                  Válida. Redondeo a céntimo.
Descuento igual al bruto       Válido: línea a cero.
Descuento mayor que el bruto   Rechazado.
Producto borrado del catálogo  La línea sobrevive con su nombre.
Producto archivado             No entra en pedidos nuevos; los viejos
                               siguen.
Dos cajeros a la vez           Correlativos distintos.
Sede desactivada después       Los pedidos existentes no se tocan.
Anular un pedido `ready`       Permitido.
Anular uno `completed`         Rechazado.
Página fuera de rango          Vacío, no error.
```

---

## 19. Performance considerations

```text
Queries    El listado pagina de 20. El detalle trae pedido, líneas e
           historial en una consulta con embed.

Indexes    (tenant_id, status) para el listado por estado.
           (tenant_id, location_id, placed_at desc) para "hoy en esta
           sede", que es la consulta del día a día.
           (tenant_id, customer_id) parcial para el historial de un
           cliente, que es lo que la Fase 12 dejó pendiente (KL-1209).

Totales    Los recalcula un trigger sobre las líneas, no una consulta
           agregada en cada lectura. Un pedido se lee muchas más veces
           de las que se escribe.

N+1        El detalle usa embed. El listado no trae líneas.

Caching    Ninguno: son datos operativos que cambian por minuto.
```

---

## 20. Migraciones

```text
20260827130000_create_order_enums.sql
  enums order_status y order_source, tabla order_transitions con datos

20260827130100_create_orders.sql
  tabla orders, correlativo, guardas de sede y cliente, RLS

20260827130200_create_order_items.sql
  tabla order_items, snapshot por trigger, recálculo de totales, RLS

20260827130300_create_order_status_history.sql
  historial, trigger de transición, RLS
```

Ninguna migración de permisos.

---

## 21. Rollback

Aditivas. Revertir es soltarlas en orden inverso:

```sql
drop table if exists public.order_status_history;
drop table if exists public.order_items;
drop table if exists public.orders;
drop table if exists public.order_transitions;
drop type  if exists public.order_source;
drop type  if exists public.order_status;
```

**Este es el último punto barato para revertir.** A partir de la Fase 14 habrá
pagos apuntando a `orders`, y de la 17 comprobantes emitidos a SUNAT; soltar
`orders` entonces se lleva por delante registros que un negocio está obligado a
conservar y que ya salieron del sistema.

---

## 22. Definition of Done

- [ ] Enums y `order_transitions` creados con los valores de §33
- [ ] `orders`, `order_items`, `order_status_history` con constraints e índices
- [ ] Snapshot de precio hecho POR LA BASE, no por el formulario
- [ ] TEST-1307 en verde: cambiar el catálogo no mueve un pedido histórico
- [ ] Totales calculados por trigger
- [ ] Correlativo por tenant, a prueba de concurrencia
- [ ] Máquina de estados en la base, aplicada por trigger
- [ ] Historial escrito automáticamente en cada transición
- [ ] RLS en las cuatro tablas
- [ ] Cero políticas para `anon`, afirmado por test
- [ ] Sin DELETE en ninguna tabla de pedidos
- [ ] Guardas de tenant para sede, cliente y producto
- [ ] Listado con filtros y paginación (§18)
- [ ] Detalle con líneas e historial
- [ ] Entrada de navegación con permiso
- [ ] Tipos actualizados y contrato de schema verificando columnas
- [ ] Unit tests PASS
- [ ] Database tests PASS
- [ ] Cross-tenant tests PASS
- [ ] Typecheck PASS
- [ ] Lint PASS
- [ ] Build PASS
- [ ] SPEC actualizado

---

## 23. Implementation notes

### La forma que tomó el snapshot

La decisión que ordenó todo lo demás fue hacer `product_id` **anulable** con
`ON DELETE SET NULL`. No es un descuido de integridad referencial: es la
afirmación, escrita en el esquema, de que la línea no necesita el producto para
nada. El puntero sirve para reportes; el nombre y el precio son suyos.

Eso hace que TEST-1308 sea posible de escribir: se borra el producto del
catálogo y la línea sigue diciendo qué se vendió y a cuánto.

Y explica por qué TEST-1307 no comprueba que el total esté bien al crearlo, sino
que **cambia el precio del producto** y afirma que el pedido no se mueve. Un
test de la primera forma pasaría igual con un JOIN, que es precisamente el
diseño que §33 prohíbe.

### El precio no existe como campo

No hay ningún campo de precio en `src/modules/orders/schemas.ts`, y la primera
aserción de los tests de schema es esa **ausencia**.

Validar un precio enviado contra el catálogo habría sido tentador y no sirve: si
el servidor ya sabe el precio correcto, el campo del formulario no aporta nada
salvo superficie de ataque. Así que la copia la hace `snapshot_order_item()` en
la base, y el formulario manda producto y cantidad.

El descuento sí viaja desde el formulario, porque es una decisión del negocio y
no un dato del catálogo, y va acotado por `order_items_discount_within_gross`.

### La máquina de estados como tabla, y lo que costó

`order_transitions` tiene ocho filas y el trigger las consulta. La UI consulta
la misma máquina a través de `lifecycle.ts`, y TEST-1301 compara las dos par por
par.

Escribirla dos veces es una deuda que solo ese test hace segura. Sin él, el
fallo sería un botón que existe para una transición que el backend rechaza: el
usuario hace clic, no pasa nada, y ninguno de los dos lados parece incorrecto
por separado.

Tuvo un coste imprevisto: la política de lectura de esa tabla es `using (true)`,
y el proyecto tiene desde la Fase 01 una invariante que prohíbe exactamente eso
(`isolation.test.ts`). El test falló, y con razón. La respuesta correcta no era
debilitar la invariante sino extender su lista de excepciones con una
justificación — la misma categoría que el catálogo de capacidades de la Fase 03:
datos del producto, no de ningún negocio — y comprobar además que la excepción
sigue siendo de solo lectura, que es lo que la hace segura.

### Un fallo del shim de tests que esta fase destapó

`record_order_status` llama a `auth.uid()` en cada inserción de pedido. El shim
de `auth.uid()` en `src/tests/helpers/database.ts` hacía
`current_setting('request.jwt.claims', true)::jsonb`, y `asUser` limpia esa
variable poniéndola a cadena vacía — y `''::jsonb` lanza _invalid input syntax
for type json_.

Doce fases no lo habían tocado porque ninguna tenía un trigger que llamara a
`auth.uid()` en una inserción normal. Se arregló en el shim y no en el trigger:
en Supabase real una claim ausente se lee como NULL y `auth.uid()` devuelve
NULL, así que el shim estaba siendo **menos** tolerante que producción.

### Qué se verificó y qué no

Verificado corriendo: el snapshot sobrevive a un cambio de precio y al borrado
del producto; los totales los recalcula la base al insertar, actualizar y
borrar; el correlativo es por tenant; ocho transiciones y solo ocho; de
`completed` y `cancelled` no se sale; anular exige motivo; un pedido vacío no
avanza; las líneas se congelan al salir de `pending`; `kitchen` mueve y no crea;
el contador lee y no escribe; `order_transitions` no es escribible.

No verificado corriendo: nadie ha usado estas pantallas contra un Supabase real.
Los embeds del detalle y el `count: "exact"` del listado están probados como
consultas, no contra PostgREST (ADR-007). Y la carrera del correlativo está
razonada y cubierta por el índice único, pero no ejercitada con dos escritores
concurrentes de verdad — PGlite es un proceso único.

---

## 24. Known limitations

```text
KL-1301  `tax_cents` se guarda y no se calcula: siempre cero hasta la
         Fase 17. El total es correcto para un negocio que no discrimina
         IGV, y la columna ya viaja en la suma.

KL-1302  No hay reintento automático cuando dos cajeros chocan en el
         correlativo. El Server Action devuelve "intenta de nuevo".
         Un reintento con backoff es correcto y no se metió sin haber
         visto el choque ocurrir.

KL-1303  Los totales se recalculan por fila (`for each row`), así que un
         pedido de cien líneas hace cien updates a la misma fila.
         Aceptable a este tamaño; un trigger `after statement` sería lo
         correcto si duele.

KL-1304  Un pedido confirmado no se puede editar. Si el negocio necesita
         corregirlo, la respuesta probablemente sea una nota de crédito
         (Fase 17), no un pedido mutable — pero eso lo decide esa fase.

KL-1305  El formulario de alta añade líneas con estado de cliente
         (`useState`), así que sin JavaScript solo se puede crear un
         pedido de una línea. El envío sí funciona sin JS.

KL-1306  No hay previsualización del total mientras se escribe.
         `lineTotalCents` existe y está probada contra el redondeo de
         SQL, pero la UI no la usa todavía.

KL-1307  El listado no filtra por fecha, aunque el índice
         (tenant_id, location_id, placed_at) lo soporta. FR-1316 pedía
         estado, sede y fecha; se entregaron los dos primeros.

KL-1308  No se puede reordenar ni editar la cantidad de una línea desde
         la pantalla: se quita y se vuelve a añadir. El Server Action de
         actualización existe en la base, no en la UI.

KL-1309  El historial muestra el cambio pero no quién lo hizo.
         `changed_by` se guarda; falta unirlo con `profiles` para
         mostrar un nombre.

KL-1310  La fuente `web` existe en el enum y nada la produce todavía: no
         hay checkout público. Es deliberado — el valor tiene que existir
         desde el principio o las filas históricas mentirían.

KL-1311  El historial de compras de un cliente es consultable pero no
         hay pantalla. Cierra parcialmente KL-1209 de la Fase 12: el
         dato existe, la vista no.
```

---

## 25. Future considerations

```text
- La Fase 14 colgará pagos de orders y necesitará saber cuánto falta
  por pagar; total_cents es exacto y no cambia, que es la condición.
- La Fase 17 decidirá el IGV y llenará tax_cents, que esta fase deja
  en cero a propósito.
- La Fase 18 descontará stock al confirmar, colgándose de la misma
  transición que ya escribe el historial.
- La Fase 16 (KDS) leerá los pedidos en `confirmed` y `preparing`; el
  índice (tenant_id, status) ya es el que necesita.
- El historial de compras de un cliente (KL-1209 de la Fase 12) es
  ahora consultable: (tenant_id, customer_id) existe. La pantalla que
  lo muestra no es de esta fase.
```
