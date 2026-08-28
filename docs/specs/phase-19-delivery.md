# SPEC — Phase 19 — Delivery

## 1. Información general

```text
Phase:                19
Nombre:               Delivery
Estado:               COMPLETED
Versión:              1.0.0
Fecha creación:       2026-08-28
Última actualización: 2026-08-28
Responsable:          alejandro.avendano@masuno.pe
```

Documento maestro: §33 (Fase 19).
Fases previas: 00 a 18 — todas COMPLETED y auditadas.
ADR: [023 — Zona/tarifa separadas, entrega desacoplada del pedido](../adr/023-delivery-zone-rate-split-and-decoupled-lifecycle.md).

---

## 2. Objetivo

### ¿Por qué existe esta fase?

Master §33, Fase 19, textual y completo:

> Crear: delivery_zones, delivery_rates, order_deliveries.
> Funciones: zonas; costos; dirección; coordenadas; repartidor; estados.
> No acoplar inicialmente a un proveedor específico.

Desde la Fase 13 la columna `orders.shipping_cents` existe y **siempre vale
cero**. Su comentario en la migración lo dice con todas sus letras: "The one
amount that is NOT derived from the lines: delivery is a decision made about
the order as a whole". Nadie la escribía porque nada en el sistema sabía qué
cuesta llevar un pedido a un sitio. Esta fase es lo que la llena.

Tres comentarios más, escritos en fases anteriores, apuntaban explícitamente
aquí y esta fase los cierra:

```text
orders (Fase 13)              "Phase 19 a courier"  - un segundo escritor de
                               los totales, razon por la que el total se
                               calcula en la base y no en la aplicacion
order_items (Fase 13)         idem, sobre recompute_order_totals()
customer_addresses (Fase 12)  "The Phase 13 order will copy the delivery
                               address onto itself rather than referencing
                               this row" - el snapshot que esta fase
                               finalmente escribe
```

### ¿Qué debe ser posible al terminarla?

```text
Definir las zonas a las que un negocio reparte, y cuanto cobra por llegar a
  cada una - con una tarifa por defecto y, cuando importa, una tarifa
  distinta desde cada sede.
Adjuntar una entrega a un pedido y que el costo entre en su total, una sola
  vez, calculado por la base de datos.
Guardar a donde va: direccion, referencia, distrito y coordenadas -
  copiadas, no referenciadas, de modo que borrar la direccion del cliente
  manana no cambie a donde se entrego ayer.
Registrar coordenadas en la libreta de direcciones del cliente, para que la
  entrega las herede en vez de pedirlas cada vez.
Asignar un repartidor y seguir la entrega por sus estados, con un historial
  de quien la movio y cuando.
Que anular el pedido anule su entrega, sin que nadie tenga que acordarse.
```

---

## 3. Alcance

### Incluido

```text
delivery_zones, delivery_rates, order_deliveries - las tres tablas exactas
  de §33.
delivery_transitions: la maquina de estados COMO DATO, cuarta tabla, el
  mismo precedente que order_transitions (Fase 13) y
  billing_document_transitions (Fase 17) ya sentaron.
delivery_status_history: el historial de la entrega, mismo patron que
  order_status_history.
Enum delivery_status: pending, assigned, in_transit, delivered, failed,
  cancelled.
customer_addresses extendida con latitude/longitude - "coordenadas" de §33
  necesita un sitio donde vivir antes de poder copiarse a una entrega.
Permisos nuevos: delivery_zones.view/manage, deliveries.view/manage.
Trigger que escribe orders.shipping_cents y recalcula orders.total_cents
  cuando se adjunta, se modifica o se retira una entrega.
Trigger que anula la entrega cuando se anula el pedido.
Pantallas /delivery (tablero operativo) y /configuracion/delivery (zonas y
  tarifas); tarjeta "Entrega" en el detalle del pedido.
```

### Fuera de alcance

```text
Una integracion con un proveedor de delivery (Rappi, PedidosYa, Uber
  Direct). §33 lo prohibe explicitamente para esta fase: "No acoplar
  inicialmente a un proveedor especifico". Cuando exista uno se escribe un
  adapter, igual que ADR-021 hizo con BillingProvider, y esta fase deja el
  dominio listo para recibirlo sin cambiar de forma.
Geocerca real (poligonos, PostGIS, "esta direccion cae en esta zona?").
  Una zona aqui es un area con nombre - el distrito -, que es como opera de
  hecho un negocio peruano. Un poligono exige PostGIS, que es exactamente
  la infraestructura no pedida contra la que advierte §47. Ver ADR-023
  decision 2.
Ruteo, optimizacion de rutas, tracking GPS en vivo del repartidor, ETA
  calculada. Nada de eso lo pide §33 y todo exige un servicio externo.
Que entregar un pedido lo complete. Los dos ciclos de vida quedan
  desacoplados a proposito: completar un pedido dispara el consumo de stock
  de la Fase 18, y una entrega no debe tener ese efecto lateral. Ver
  ADR-023 decision 4.
Cobro contra entrega como flujo propio. Un pago se registra con la capa de
  la Fase 14, que ya existe y no necesita nada nuevo aqui.
Restringir a un repartidor a ver solo SUS entregas. Ver seccion 24, KL-1902.
```

### La decisión de alcance que más costó

**Por qué `delivery_rates` es una tabla y no una columna `fee_cents` en
`delivery_zones`.**

Si una zona tuviera un solo precio, master habría pedido una tabla, no dos.
Que pida `delivery_zones` **y** `delivery_rates` significa que una zona tiene
más de una tarifa; lo que no dice es según qué eje varían.

Los dos candidatos reales eran **por sede** y **por tramo de valor del
pedido**. Se eligió **por sede**, y la razón no es preferencia: la
multi-sede es un invariante documentado de este proyecto desde ADR-014, cada
tabla operativa nombra una `location`, y `orders.location_id` ya existe — así
que la tarifa correcta se puede resolver sin preguntar nada más. Llevar a
Miraflores desde la sede de Miraflores no cuesta lo mismo que desde San
Isidro, y eso es un hecho sobre el par (zona, sede), no sobre la zona.

El tramo por valor del pedido se resolvió sin una segunda fila: `min_order_free_cents`
es una columna **de la tarifa**, porque "gratis desde S/ 50" no es otra
tarifa, es una condición de esta. Ver ADR-023 decisión 1.

---

## 4. Dependencias

```text
Phase 10 — Locations             una tarifa puede depender de la sede;
                                  ADR-014 es la razon de que se pueda
Phase 12 — Customers              customer_addresses es de donde una entrega
                                  copia su direccion, y la tabla que esta
                                  fase extiende con coordenadas
Phase 13 — Orders Core            orders.shipping_cents lleva 6 fases
                                  esperando un escritor; order_transitions
                                  es el patron que delivery_transitions copia
Phase 14 — Payments               total_cents es contra lo que se compara
                                  paid_cents: por eso la tarifa se congela
                                  cuando el pedido deja `pending`
Phase 18 — Inventory              la razon de NO completar el pedido al
                                  entregar: completed dispara consumo de
                                  stock (ADR-022)
ADR-010 — RBAC                    se pide un permiso, nunca se compara un
                                  rol - de ahi KL-1902
ADR-015 — Money as minor units    fee_cents, min_order_free_cents
ADR-017 — Order snapshot/FSM      el patron que esta fase reutiliza dos
                                  veces: snapshot de la direccion y maquina
                                  de estados como dato
ADR-021 — BillingProvider         el precedente de declinar un proveedor
                                  externo hasta que exista uno real
```

---

## 5. Casos de uso

```text
UC-1901
Como Encargado
quiero definir las zonas a las que reparto y su costo
para que quien tome un pedido no tenga que inventar el precio del envio.

  Actor          manager / admin / owner (delivery_zones.manage)
  Precondiciones el tenant tiene al menos una sede
  Accion         crear zona "Miraflores"; crear tarifa por defecto S/ 8.00
  Resultado      la zona aparece disponible al adjuntar una entrega
  Errores        nombre duplicado -> ConflictError

UC-1902
Como Cajero
quiero adjuntar una entrega a un pedido
para que el costo del envio entre en el total que voy a cobrar.

  Actor          cashier (deliveries.manage) sobre un pedido `pending`
  Precondiciones el pedido existe y esta en `pending`; hay zonas activas
  Accion         elegir zona, escribir direccion, guardar
  Resultado      orders.shipping_cents = tarifa; total_cents recalculado
  Errores        pedido ya no `pending` -> se rechaza con mensaje
                 zona de otro negocio -> se rechaza (trigger)

UC-1903
Como Encargado
quiero asignar un repartidor a una entrega
para que alguien concreto se haga cargo.

  Actor          manager (deliveries.manage)
  Precondiciones la entrega esta en `pending`
  Accion         elegir un miembro del negocio y guardar
  Resultado      status pasa a `assigned`, assigned_at fijado, historial
  Errores        el usuario no es miembro del tenant -> se rechaza

UC-1904
Como Repartidor
quiero marcar que sali y que entregue
para que el negocio vea el estado sin llamarme.

  Actor          delivery (deliveries.manage)
  Precondiciones la entrega esta en `assigned` / `in_transit`
  Accion         avanzar el estado
  Resultado      in_transit -> delivered, delivered_at fijado, historial
  Errores        salto no declarado en delivery_transitions -> P0001

UC-1905
Como Repartidor
quiero registrar que no pude entregar
para que quede el motivo y se pueda reintentar.

  Actor          delivery (deliveries.manage)
  Precondiciones la entrega esta en `in_transit`
  Accion         marcar fallida con motivo
  Resultado      status `failed` con motivo; puede volver a `assigned`
  Errores        sin motivo -> se rechaza (23514)

UC-1906
Como Encargado
quiero que anular un pedido anule su entrega
para que nadie salga a repartir algo que ya no existe.

  Actor          cualquiera con orders.cancel
  Precondiciones el pedido tiene una entrega no terminal
  Accion         anular el pedido
  Resultado      la entrega pasa a `cancelled` sola, con motivo heredado
  Errores        ninguno: es un efecto de la base, no una accion
```

---

## 6. Requerimientos funcionales

```text
FR-1901  Un tenant podra crear zonas de reparto con nombre y distrito.
FR-1902  El nombre de una zona sera unico por tenant, sin distinguir
         mayusculas.
FR-1903  Una zona podra desactivarse; una zona inactiva no podra elegirse
         para una entrega nueva, pero las entregas ya hechas la conservan.
FR-1904  Una zona tendra a lo sumo una tarifa por defecto (sin sede) y a lo
         sumo una tarifa por cada sede.
FR-1905  Una tarifa guardara su costo en enteros de la unidad menor.
FR-1906  Una tarifa podra declarar un monto a partir del cual el envio es
         gratis, y un tiempo estimado en minutos.
FR-1907  La tarifa aplicable a un pedido sera la de su sede si existe, y la
         tarifa por defecto de la zona en caso contrario.
FR-1908  Un pedido tendra a lo sumo una entrega.
FR-1909  Una entrega solo podra crearse mientras el pedido este en
         `pending`.
FR-1910  Crear una entrega escribira orders.shipping_cents y recalculara
         orders.total_cents.
FR-1911  Cambiar el costo de una entrega solo sera posible mientras el
         pedido este en `pending`.
FR-1912  Retirar una entrega devolvera orders.shipping_cents a cero y
         recalculara el total.
FR-1913  La entrega guardara la direccion como copia: linea, distrito,
         ciudad, referencia y coordenadas.
FR-1914  La entrega guardara el nombre de la zona como copia, para que
         renombrarla o borrarla no reescriba el pasado.
FR-1915  Media coordenada sera rechazada: latitud y longitud van juntas o
         no van.
FR-1916  Una entrega podra nombrar un repartidor, que debera ser miembro
         del mismo tenant.
FR-1917  Los estados seran pending, assigned, in_transit, delivered,
         failed, cancelled.
FR-1918  Solo se admitiran los cambios de estado declarados en
         delivery_transitions.
FR-1919  Asignar un repartidor a una entrega en `pending` la movera a
         `assigned`.
FR-1920  Marcar fallida o anulada exigira un motivo.
FR-1921  Cada cambio de estado se registrara en delivery_status_history con
         quien lo hizo.
FR-1922  Anular el pedido anulara su entrega si no estaba en estado
         terminal.
FR-1923  customer_addresses aceptara latitude/longitude opcionales.
FR-1924  Adjuntar una entrega desde una direccion del cliente copiara sus
         coordenadas si las tiene.
```

---

## 7. Requerimientos no funcionales

```text
NFR-1901 Seguridad
         Ninguna tabla de esta fase es legible por `anon`. Una entrega
         nombra una direccion domiciliaria y un telefono: es el dato mas
         sensible de la fase, y le aplica ADR-016 al menos con la misma
         fuerza que a `customers`.
         tenant_id de order_deliveries se deriva por trigger del pedido;
         no es un campo de entrada.

NFR-1902 Integridad
         El costo del envio existe en un solo lugar - la entrega - y llega
         a orders.shipping_cents por trigger. La aplicacion nunca envia un
         total.

NFR-1903 Performance
         El tablero filtra por (tenant_id, status) y por
         (tenant_id, courier_user_id): ambos indexados. La resolucion de
         tarifa es una lectura por (zone_id, location_id), servida por los
         dos indices unicos parciales.

NFR-1904 Observabilidad
         Eventos delivery.* con tenantId y deliveryId, nunca la direccion
         ni el telefono (§16 y la regla de redaccion del logger).

NFR-1905 Accesibilidad
         Cada tabla del tablero lleva `caption`; cada formulario, labels
         asociados; los botones de estado son botones, no enlaces.

NFR-1906 Mantenibilidad
         La maquina de estados es una tabla, no un CASE. El mirror en
         TypeScript se compara fila a fila contra ella (TEST-1901), asi
         que no pueden divergir en silencio.
```

---

## 8. Modelo de datos

### Enum nuevo

```text
delivery_status
  pending | assigned | in_transit | delivered | failed | cancelled
```

### delivery_zones

```text
id            UUID PK
tenant_id     UUID NOT NULL -> tenants
name          TEXT NOT NULL           1..80
district      TEXT                    <=100
notes         TEXT                    <=300
is_active     BOOLEAN NOT NULL default true
created_at    TIMESTAMPTZ NOT NULL
updated_at    TIMESTAMPTZ NOT NULL

UNIQUE (tenant_id, lower(name))
INDEX (tenant_id, is_active)
```

### delivery_rates

```text
id                    UUID PK
tenant_id             UUID NOT NULL   derivado por trigger de la zona
zone_id               UUID NOT NULL -> delivery_zones ON DELETE CASCADE
location_id           UUID          -> locations ON DELETE CASCADE
                                       NULL = tarifa por defecto de la zona
fee_cents             BIGINT NOT NULL 0..10_000_000_000
min_order_free_cents  BIGINT          NULL = nunca gratis
estimated_minutes     SMALLINT        1..600
is_active             BOOLEAN NOT NULL default true
created_at            TIMESTAMPTZ NOT NULL
updated_at            TIMESTAMPTZ NOT NULL

UNIQUE (zone_id, location_id) WHERE location_id IS NOT NULL
UNIQUE (zone_id)              WHERE location_id IS NULL
INDEX  (tenant_id, zone_id)
```

### order_deliveries

```text
id                  UUID PK
tenant_id           UUID NOT NULL   derivado por trigger del pedido
order_id            UUID NOT NULL UNIQUE -> orders ON DELETE CASCADE
zone_id             UUID          -> delivery_zones ON DELETE SET NULL
zone_name_snapshot  TEXT NOT NULL   1..80

status              delivery_status NOT NULL default 'pending'
fee_cents           BIGINT NOT NULL 0..10_000_000_000

address_line        TEXT NOT NULL   1..300
district            TEXT            <=100
city                TEXT            <=100
reference           TEXT            <=200
latitude            NUMERIC(9,6)    -90..90
longitude           NUMERIC(9,6)    -180..180

recipient_name      TEXT            <=120
recipient_phone     TEXT            <=30
notes               TEXT            <=500

courier_user_id     UUID          -> auth.users ON DELETE SET NULL
assigned_at         TIMESTAMPTZ
dispatched_at       TIMESTAMPTZ
delivered_at        TIMESTAMPTZ
failed_at           TIMESTAMPTZ
cancelled_at        TIMESTAMPTZ
failure_reason      TEXT            1..300 cuando aplica

created_by          UUID          -> auth.users ON DELETE SET NULL
created_at          TIMESTAMPTZ NOT NULL
updated_at          TIMESTAMPTZ NOT NULL

INDEX (tenant_id, status)
INDEX (tenant_id, courier_user_id) WHERE courier_user_id IS NOT NULL
INDEX (tenant_id, created_at DESC)

CHECK coordenadas juntas o ninguna
CHECK (status='delivered')  = (delivered_at IS NOT NULL)
CHECK (status='cancelled')  = (cancelled_at IS NOT NULL)
CHECK (status='failed')     = (failed_at    IS NOT NULL)
CHECK status IN ('failed','cancelled') = (failure_reason IS NOT NULL)
CHECK courier_user_id IS NOT NULL cuando status IN
      ('assigned','in_transit','delivered')
```

### delivery_transitions

```text
from_status  delivery_status NOT NULL
to_status    delivery_status NOT NULL
PK (from_status, to_status)
CHECK from_status <> to_status
```

Filas:

```text
pending    -> assigned      se asigno un repartidor
assigned   -> pending       el repartidor se cayo y no hay reemplazo aun
assigned   -> in_transit    salio
in_transit -> delivered     llego
in_transit -> failed        no pudo entregar
failed     -> assigned      segundo intento
pending    -> cancelled
assigned   -> cancelled
in_transit -> cancelled
failed     -> cancelled     el pedido se anulo tras un intento fallido
```

Diez filas. La última se descubrió implementando: sin ella, anular un pedido
cuya entrega ya había fallado hacía fallar la anulación entera, porque
`cancel_delivery_with_order()` alcanza toda entrega no terminal y `failed` lo
es. La cubre TEST-1933b.

`delivered` y `cancelled` son terminales: aparecen solo como destino. `failed`
no lo es — un segundo intento es un hecho operativo normal, y forzar una
entrega nueva obligaría a romper `UNIQUE(order_id)`.

### delivery_status_history

```text
id           UUID PK
delivery_id  UUID NOT NULL -> order_deliveries ON DELETE CASCADE
tenant_id    UUID NOT NULL
from_status  delivery_status          NULL en la creacion
to_status    delivery_status NOT NULL
reason       TEXT <=300
changed_by   UUID -> auth.users ON DELETE SET NULL
created_at   TIMESTAMPTZ NOT NULL

INDEX (delivery_id, created_at)
CHECK from_status IS NULL OR from_status <> to_status
```

### customer_addresses (extendida)

```text
+ latitude   NUMERIC(9,6)   -90..90
+ longitude  NUMERIC(9,6)   -180..180
+ CHECK coordenadas juntas o ninguna
```

---

## 9. Diagrama de relaciones

```text
tenants
   │
   ├──────────────► delivery_zones
   │                     │
   │                     ▼
   │                delivery_rates ──────► locations
   │                     (zona × sede, o zona × NULL)
   │
   └──────────────► orders
                        │  1:1
                        ▼
                   order_deliveries ──────► delivery_zones  (SET NULL)
                        │      │
                        │      └──────────► auth.users  (repartidor)
                        ▼
              delivery_status_history

              delivery_transitions   (global, sin tenant_id)
```

Flujo del costo:

```text
delivery_rates.fee_cents
        │  copiado al crear la entrega
        ▼
order_deliveries.fee_cents
        │  trigger
        ▼
orders.shipping_cents ──► orders.total_cents = Σ items + shipping
```

---

## 10. Tenant Isolation

```text
¿Como se determina el tenant?
  delivery_zones      columna propia, escrita por la aplicacion desde el
                      contexto servidor (requireActiveTenant)
  delivery_rates      derivado por trigger de la zona
  order_deliveries    derivado por trigger del pedido
  delivery_status_history  derivado por trigger de la entrega

¿Que tablas llevan tenant_id?
  Las cuatro. delivery_transitions no: es la maquina de estados del
  PRODUCTO, no de ningun negocio - un tenant no inventa un camino de
  `delivered` de vuelta a `pending`. Mismo argumento, misma forma, que
  order_transitions (Fase 13) y billing_document_transitions (Fase 17).

¿Como evita RLS el acceso cross-tenant?
  Toda politica se predica sobre has_permission(tenant_id, '...'), que
  resuelve contra tenant_members. Ninguna politica de esta fase usa
  `using (true)` salvo delivery_transitions, que entra en la allowlist ya
  existente de isolation.test.ts y es read-only.

¿Que consultas requieren validacion tenant?
  Ninguna consulta de la aplicacion filtra por tenant a mano ademas de RLS,
  pero todas lo hacen igualmente (.eq("tenant_id", ...)) - defensa en
  profundidad, la misma postura de las fases 11 a 18.

  Ademas, tres triggers cierran los huecos que RLS NO ve, porque el
  llamante tiene permiso sobre la fila que escribe:
    - la zona de una entrega pertenece al mismo tenant que el pedido
    - la sede de una tarifa pertenece al mismo tenant que la zona
    - el repartidor es miembro activo del mismo tenant

¿Existe algun recurso global?
  delivery_transitions. Sin datos de negocio.
```

---

## 11. Seguridad

```text
Authentication
  Todas las pantallas viven bajo /dashboard, ya protegido desde la Fase 02.

Authorization
  delivery_zones.view    ver zonas y tarifas
  delivery_zones.manage  crear/editar zonas y tarifas
  deliveries.view        ver el tablero de entregas
  deliveries.manage      adjuntar, asignar repartidor, avanzar estado

Roles involucrados
  owner, admin, manager  los cuatro permisos
  cashier                delivery_zones.view + deliveries.view/manage
                         (toma el pedido por telefono y adjunta la entrega)
  delivery               delivery_zones.view + deliveries.view/manage
                         (el repartidor avanza sus estados)
  accountant             delivery_zones.view + deliveries.view (solo lee)
  waiter, kitchen        nada: no reparten

RLS policies
  delivery_zones           SELECT delivery_zones.view
                           INSERT/UPDATE delivery_zones.manage
                           DELETE delivery_zones.manage
  delivery_rates           identicas, gobernadas por los permisos de la zona
  order_deliveries         SELECT deliveries.view
                           INSERT/UPDATE deliveries.manage
                           sin DELETE  (ver mas abajo)
  delivery_status_history  SELECT deliveries.view
                           sin INSERT/UPDATE/DELETE: solo el trigger escribe
  delivery_transitions     SELECT authenticated, read-only

Por que delivery_zones SI admite DELETE y order_deliveries NO
  Una zona es configuracion: borrar una zona que se creo por error es
  corregir un ajuste, y las entregas ya hechas conservan
  zone_name_snapshot, asi que no pierden nada. Una entrega es un hecho
  operativo asociado a un pedido: se anula, no se borra. El mismo criterio
  que separa `customer_addresses` (borrable) de `orders` (no).

Input validation
  Zod en el limite. Ningun schema acepta tenant_id, shipping_cents,
  total_cents, ni ninguna marca de tiempo de estado: todos son derivados.

Potential abuse cases
  Adjuntar una entrega con la zona de otro negocio  -> trigger
  Cobrar un envio sobre un pedido ya pagado         -> solo `pending`
  Asignar como repartidor a alguien de otro negocio -> trigger
  Reescribir el total desde el cliente              -> no hay campo

Sensitive information
  Direccion, referencia, coordenadas y telefono del destinatario. No se
  registran en logs; el logger redacta y los eventos llevan solo ids.

Secrets
  Ninguno. Esta fase no habla con ningun servicio externo (§33: "No acoplar
  inicialmente a un proveedor especifico").

Rate limits
  No aplican: no hay endpoint publico en esta fase.
```

---

## 12. API / Server Actions

```text
createDeliveryZoneAction        delivery_zones.manage
updateDeliveryZoneAction        delivery_zones.manage
setDeliveryZoneActiveAction     delivery_zones.manage
deleteDeliveryZoneAction        delivery_zones.manage
saveDeliveryRateAction          delivery_zones.manage   (upsert zona×sede)
deleteDeliveryRateAction        delivery_zones.manage

attachDeliveryAction            deliveries.manage
updateDeliveryAddressAction     deliveries.manage
assignCourierAction             deliveries.manage
advanceDeliveryStatusAction     deliveries.manage
failDeliveryAction              deliveries.manage
detachDeliveryAction            deliveries.manage
```

Todas reciben `FormData` con `tenantSlug`, resuelven el tenant por
`requireActiveTenant` y comprueban el permiso con `requirePermission` antes
de tocar la base. Ninguna acepta un `tenant_id` del cliente (§42).

Contrato representativo:

```text
attachDeliveryAction

Permission: deliveries.manage
Input:  { tenantSlug, orderId, zoneId, addressLine, district?, city?,
          reference?, latitude?, longitude?, recipientName?,
          recipientPhone?, notes?, customerAddressId? }
Efecto: INSERT order_deliveries con fee_cents resuelto en el servidor
        desde delivery_rates, tenant_id derivado por trigger,
        orders.shipping_cents y total_cents recalculados por trigger
Output: FormState
```

---

## 13. UI / UX

```text
/dashboard/{slug}/delivery
  Proposito     tablero operativo de entregas
  Acciones      filtrar por estado, asignar repartidor, avanzar, marcar
                fallida, anular
  Estados       loading (skeleton del layout), empty ("Aun no hay
                entregas..."), error (mensaje en el FormState)
  Permissions   deliveries.view para entrar; deliveries.manage para actuar

/dashboard/{slug}/configuracion/delivery
  Proposito     zonas y tarifas
  Acciones      crear/editar/activar/borrar zona; guardar/borrar tarifa
                por defecto y por sede
  Empty state   "Aun no tienes zonas de reparto." + accion
  Permissions   delivery_zones.view para entrar; .manage para escribir

/dashboard/{slug}/pedidos/{orderId}
  Cambio        tarjeta "Entrega": adjuntar mientras el pedido este
                `pending`; despues, ver estado, repartidor y direccion
  Permissions   deliveries.view / deliveries.manage
```

Empty states, confirmación en las acciones destructivas (borrar zona,
retirar entrega, anular) y feedback inmediato via `FormState`: §34, §35, §36.

---

## 14. Flujos principales

```text
Configurar
  Encargado -> /configuracion/delivery -> crea zona -> crea tarifa por
  defecto -> (opcional) tarifa por sede

Adjuntar
  Pedido `pending`
      ↓
  elegir zona + direccion (o heredar una del cliente)
      ↓
  el servidor resuelve la tarifa: (zona, sede del pedido) o (zona, NULL)
      ↓
  INSERT order_deliveries  [trigger: tenant_id, guardas de tenant]
      ↓
  trigger -> orders.shipping_cents = fee
      ↓
  trigger -> orders.total_cents = Σ order_items + shipping
      ↓
  trigger -> delivery_status_history (NULL -> pending)

Operar
  pending --asignar--> assigned --salir--> in_transit --llegar--> delivered
                                                     └--fallar--> failed
                                                                    │
                                                          reintentar│
                                                                    ▼
                                                                assigned

Anular el pedido
  orders.status -> cancelled
      ↓
  trigger -> la entrega no terminal pasa a cancelled con el motivo del
             pedido, y su historial lo registra
```

---

## 15. Manejo de errores

```text
Zona duplicada                    -> ConflictError (23505)
Tarifa duplicada para zona+sede   -> ConflictError (23505)
Pedido ya no `pending`            -> P0001, mensaje accionable
Pedido ya tiene entrega           -> ConflictError (23505 sobre order_id)
Zona/sede de otro negocio         -> 23514, "no pertenece a este negocio"
Repartidor no miembro             -> 23514
Salto de estado no declarado      -> P0001, "no puede pasar de X a Y"
Fallida o anulada sin motivo      -> 23514
Media coordenada                  -> 23514
Sin permiso                       -> notFound() en la pagina,
                                     AuthorizationError en la accion
Fallo de base no previsto         -> DatabaseError, log tecnico, mensaje
                                     generico al usuario (§15)
```

---

## 16. Observabilidad

```text
delivery_zone.created
delivery_zone.updated
delivery_zone.activated / delivery_zone.deactivated
delivery_zone.deleted
delivery_rate.saved / delivery_rate.deleted
delivery.attached
delivery.detached
delivery.address_updated
delivery.courier_assigned
delivery.status_changed
delivery.failed
```

Cada evento lleva `tenantId` y el id del registro. **Nunca** dirección,
coordenadas ni teléfono.

El historial en base (`delivery_status_history`) es el registro auditable
de §17; los logs son para diagnóstico.

---

## 17. Testing Plan

### Unit

```text
TEST-1901  El mirror TypeScript de la maquina de estados declara
           exactamente las mismas filas que delivery_transitions.
TEST-1902  nextStatuses / canTransition / isTerminal sobre los seis
           estados.
TEST-1903  Los schemas Zod rechazan importe mal escrito, coordenada
           incompleta, motivo vacio, texto sobre el limite.
TEST-1904  resolveRate elige la tarifa de la sede sobre la tarifa por
           defecto, y devuelve null cuando no hay ninguna.
TEST-1905  El envio gratis se aplica cuando el subtotal alcanza
           min_order_free_cents.
```

### Database (`src/tests/database/delivery.test.ts`, 61 tests)

```text
TEST-1910  Las cuatro tablas nuevas tienen RLS activo.
TEST-1911  anon no obtiene nada de ninguna tabla de la fase.
TEST-1912  Tenant A no lee zonas, tarifas ni entregas de Tenant B.
TEST-1913  Tenant A no escribe en las de Tenant B.
TEST-1914  Nombre de zona duplicado por tenant se rechaza; el mismo
           nombre en otro tenant se acepta.
TEST-1915  Dos tarifas por defecto en la misma zona se rechazan.
TEST-1916  Dos tarifas para la misma zona y sede se rechazan.
TEST-1917  Una tarifa cuya sede es de otro tenant se rechaza.
TEST-1918  delivery_rates.tenant_id se deriva de la zona e ignora lo que
           envie el cliente.
TEST-1919  order_deliveries.tenant_id se deriva del pedido.
TEST-1920  Adjuntar una entrega escribe shipping_cents y recalcula
           total_cents.
TEST-1921  Retirar la entrega devuelve shipping_cents a cero y recalcula.
TEST-1922  Cambiar fee_cents recalcula el total.
TEST-1923  Un pedido que dejo `pending` no admite entrega nueva.
TEST-1924  Un pedido que dejo `pending` no admite cambio de fee_cents,
           pero si de estado y repartidor.
TEST-1925  Un pedido no admite dos entregas.
TEST-1926  Una zona de otro negocio se rechaza al adjuntar.
TEST-1927  Un repartidor que no es miembro del tenant se rechaza.
TEST-1928  Solo se admiten los saltos declarados en delivery_transitions.
TEST-1929  Marcar fallida sin motivo se rechaza.
TEST-1930  delivered_at / failed_at / cancelled_at los fija el trigger.
TEST-1931  Cada cambio de estado escribe una fila de historial con el
           usuario que lo hizo.
TEST-1932  La creacion escribe una fila de historial con from_status NULL.
TEST-1933  Anular el pedido anula la entrega no terminal.
TEST-1933b Anular el pedido anula tambien una entrega ya fallida - la
           transicion failed -> cancelled existe por esto.
TEST-1934  Anular el pedido NO toca una entrega ya `delivered`.
TEST-1935  Borrar la zona deja la entrega viva con su zone_name_snapshot.
TEST-1936  Media coordenada se rechaza en order_deliveries y en
           customer_addresses.
TEST-1937  delivery_status_history no admite INSERT directo.
TEST-1938  order_deliveries no tiene politica DELETE.
TEST-1939  Un miembro sin deliveries.view no lee entregas.
TEST-1940  Un miembro sin deliveries.manage no escribe entregas.
TEST-1941  waiter y kitchen no reciben ningun permiso de esta fase.
```

### RLS / Authorization

Cubierto por TEST-1910 a TEST-1913 y TEST-1939 a TEST-1941, más la
comprobación global de `isolation.test.ts` (RLS en toda tabla nueva) y
`authorization-schema.test.ts` (el catálogo TS y el SQL coinciden).

### Regression

```text
schema-contract.test.ts  las cuatro tablas nuevas y las dos columnas
                         nuevas de customer_addresses entran en
                         EXPECTED_COLUMNS y en la lista TEST-1225
isolation.test.ts        delivery_transitions entra en la allowlist de
                         catalogo read-only
dashboard-navigation     la entrada "Delivery" aparece solo con
                         deliveries.view
```

### E2E

No hay E2E en el proyecto (KL-506, dueño Fase 28). El sustituto verificable
de esta fase es el conjunto de tests de base sobre PGlite, que ejecuta las
migraciones reales y las políticas reales.

---

## 18. Edge Cases

```text
Zona sin ninguna tarifa            -> no se puede adjuntar; el formulario
                                      lo dice antes de enviar
Zona con tarifa por defecto y de
  sede, pedido de esa sede         -> gana la de la sede (FR-1907)
Tarifa desactivada                 -> no se ofrece; las entregas hechas la
                                      conservan por copia
Sede borrada                       -> CASCADE borra su tarifa; la zona y su
                                      tarifa por defecto siguen
Zona borrada                       -> SET NULL en la entrega; el nombre
                                      sobrevive en zone_name_snapshot
Repartidor retirado del negocio    -> la entrega conserva el id; la
                                      pantalla muestra "Sin asignar" si el
                                      usuario ya no aparece en el padron
Repartidor eliminado de auth       -> SET NULL, la entrega sobrevive
Entrega fallida y reintentada      -> failed -> assigned, historial con las
                                      dos filas
Pedido anulado con entrega ya
  entregada                        -> la entrega NO cambia (TEST-1934)
Envio gratis por monto             -> fee_cents = 0, la entrega existe
                                      igual: hubo reparto aunque no se
                                      cobrara
Direccion sin coordenadas          -> permitido; media coordenada no
Pedido sin cliente (mostrador)     -> permitido: la direccion se escribe a
                                      mano, no hace falta customer_id
```

---

## 19. Performance considerations

```text
Queries
  El tablero lee order_deliveries filtrando por (tenant_id, status) e
  incluye el pedido por join declarado; no hay N+1 - la lista de entregas y
  sus pedidos salen en una consulta.

Indexes
  (tenant_id, status)                    el filtro del tablero
  (tenant_id, courier_user_id) parcial   "mis entregas"
  (tenant_id, created_at desc)           el orden por defecto
  los dos unicos parciales de rates      resuelven la tarifa en un index
                                          scan

Pagination
  El tablero limita a las entregas no terminales mas las 50 ultimas
  cerradas. Sin limite, un negocio con dos anos de historia cargaria todo.

Caching
  Ninguno. Un tablero operativo cacheado es un tablero que miente.
  revalidatePath tras cada escritura, como el resto del dashboard.

N+1 / database calls
  attachDelivery hace dos lecturas (pedido, tarifa) y una escritura. La
  resolucion de tarifa NO se hace en la aplicacion iterando zonas.
```

---

## 20. Migraciones

```text
20260828120000_create_delivery_permissions.sql
  4 permisos + grants por rol

20260828120100_create_delivery_enums.sql
  enum delivery_status + delivery_transitions (tabla + 9 filas) + RLS

20260828120200_create_delivery_zones.sql
  delivery_zones + indices + RLS

20260828120300_create_delivery_rates.sql
  delivery_rates + trigger de tenant + guarda de sede + indices + RLS

20260828120400_extend_customer_address_coordinates.sql
  latitude/longitude en customer_addresses + CHECKs

20260828120500_create_order_deliveries.sql
  order_deliveries + delivery_status_history + los seis triggers + RLS
```

Ninguna es destructiva. La única que toca una tabla existente
(`customer_addresses`) sólo **añade** dos columnas anulables y dos CHECK que
toda fila existente satisface (ambas NULL).

---

## 21. Rollback

```text
Orden inverso, y es seguro porque nada anterior depende de esta fase:

  drop table public.delivery_status_history;
  drop table public.order_deliveries;      -- devuelve shipping a 0? NO:
                                           -- ver nota
  drop table public.delivery_rates;
  drop table public.delivery_zones;
  drop table public.delivery_transitions;
  drop type  public.delivery_status;
  alter table public.customer_addresses
    drop column latitude, drop column longitude;
  delete from public.role_permissions where permission like 'deliver%';
  delete from public.permissions      where code       like 'deliver%';

Nota importante
  Borrar order_deliveries NO devuelve orders.shipping_cents a cero: los
  totales ya cobrados quedan como estaban, que es lo correcto - un pedido
  historico se cobro con envio y su total debe seguir diciendolo. Si se
  quisiera revertir tambien el dinero, haria falta un UPDATE explicito, y
  esa es una decision de negocio, no de esquema.

Nada en las fases 00 a 18 lee ninguna tabla de esta fase, asi que el
rollback no deja referencias colgando.
```

---

## 22. Definition of Done

- [x] Enum `delivery_status` y `delivery_transitions` como dato
- [x] Las tres tablas de §33 implementadas
- [x] `delivery_status_history` con su trigger
- [x] `customer_addresses` extendida con coordenadas
- [x] Constraints: unicidad, rangos, coordenadas juntas, motivo obligatorio
- [x] Índices para cada patrón de consulta real
- [x] Triggers de tenant derivado (rates, deliveries, history)
- [x] Guardas cross-tenant: zona, sede, repartidor
- [x] `shipping_cents` / `total_cents` recalculados por la base
- [x] Cancelación del pedido propaga a la entrega
- [x] RLS en las cuatro tablas nuevas, sin `using (true)` en datos privados
- [x] 4 permisos nuevos, en SQL y en el mirror TypeScript
- [x] Server Actions con `requirePermission`
- [x] Pantallas `/delivery` y `/configuracion/delivery`
- [x] Tarjeta de entrega en el detalle del pedido
- [x] Unit tests PASS
- [x] Database tests PASS (aislamiento cross-tenant incluido)
- [x] `schema-contract` actualizado
- [x] Lint PASS
- [x] Typecheck PASS
- [x] Build PASS
- [x] SPEC actualizado
- [x] ADR-023 escrito
- [x] `docs/architecture/` actualizado

---

## 23. Implementation notes

### Por qué la tarifa se resuelve en el servidor y se copia, en vez de leerse por join

`order_deliveries.fee_cents` es una **copia**, no una referencia a
`delivery_rates`. Es el mismo razonamiento que ADR-017 aplicó a
`order_items.unit_price_cents`: subir el precio del envío mañana no puede
cambiar lo que se cobró ayer. La diferencia con los items es que aquí la
copia la hace la aplicación y no un trigger, porque **cuál** tarifa aplica
depende de la sede del pedido y del subtotal (envío gratis), y eso es una
decisión de negocio con dos entradas — expresarla en un trigger la
escondería justo donde nadie la busca. El trigger sí valida lo que la
aplicación no puede: que la zona sea del mismo negocio.

### El trigger que faltaba desde la Fase 13

`recompute_order_totals()` (Fase 13) sólo corre sobre cambios en
`order_items`, y calcula `total = Σ items + o.shipping_cents` leyendo un
`shipping_cents` que nadie escribía. Esta fase añade el trigger simétrico:
cuando cambia la entrega, se escribe `shipping_cents` y se recalcula
`total_cents` con la misma fórmula, leyendo la suma de items.

Las dos fórmulas son idénticas a propósito y se comprueba que lo sigan
siendo: TEST-1920 y TEST-1922 verifican el total después de tocar la entrega,
y los tests de la Fase 13 lo verifican después de tocar los items.

### Por qué `failed` no es terminal

Un intento fallido es normal (nadie en casa, dirección equivocada) y el
segundo intento es la misma entrega, del mismo pedido, a la misma dirección.
Como `order_deliveries` tiene `UNIQUE(order_id)`, un "reintento" que fuese
una fila nueva obligaría a levantar esa restricción — y entonces "¿cuál es la
entrega de este pedido?" dejaría de tener una respuesta. `failed → assigned`
mantiene una fila, un pedido, y un historial que cuenta los dos intentos.

### Lo que se verificó y lo que no

```text
Verificado con PGlite (PostgreSQL real, migraciones reales, politicas
reales), sobre el que corren los 61 tests de delivery.test.ts.

NO verificado contra un Supabase desplegado: esta fase no usa Vault,
Storage, Realtime ni ninguna extension que PGlite no tenga, asi que no hay
diferencia conocida entre los dos entornos para lo que aqui se implementa.
La unica dependencia de plataforma es auth.uid(), que el helper de tests
reproduce leyendo request.jwt.claims igual que Supabase.
```

---

## 24. Known limitations

```text
KL-1901  Una zona es un area con NOMBRE, no un poligono. Nada comprueba
         que la direccion escrita caiga de verdad en la zona elegida:
         quien adjunta la entrega la elige. Un poligono real exige PostGIS
         (§47). Dueno: cuando exista una necesidad medida.

KL-1902  Cualquier miembro con deliveries.manage puede avanzar CUALQUIER
         entrega del negocio, no solo las suyas. Restringirlo a "las mias"
         exigiria comparar el rol dentro de una politica RLS, que ADR-010
         prohibe explicitamente. Es exactamente la misma postura que la
         Fase 16 ya acepto para el rol `kitchen`, que puede avanzar
         cualquier pedido. Dueno: Fase 25, junto con el resto de la
         revision de permisos.

KL-1903  El envio gratis se evalua al ADJUNTAR la entrega, con el subtotal
         de ese momento. Si despues se agregan lineas al pedido (posible
         mientras siga `pending`), el envio no se recalcula solo. Se puede
         corregir editando la entrega. Automatizarlo exigiria que el
         trigger de order_items conociera las tarifas, acoplando dos
         modulos que hoy no se conocen. Dueno: Fase 26 si se mide que
         ocurre.

KL-1904  No hay notificacion al cliente ni al repartidor: ni SMS, ni
         WhatsApp, ni push. §44 pide adapters (MessagingProvider) que
         ninguna fase ha creado todavia. Dueno: cuando exista el proveedor.

KL-1905  El tiempo estimado (estimated_minutes) es un dato declarado por
         el negocio, no una ETA calculada. No se compara con el tiempo
         real ni alimenta ninguna metrica. Dueno: Fase 23 (Reports).

KL-1906  El tablero carga las entregas abiertas mas las ultimas 50
         cerradas, sin paginacion navegable. Es suficiente para un tablero
         operativo y consistente con /pedidos, que hace lo mismo. Dueno:
         Fase 23.
```

---

## 25. Future considerations

```text
Fase 20 (Loyalty + Promotions)  un cupon de "envio gratis" es una promocion
                                que escribe fee_cents = 0: el campo ya
                                existe y no hace falta cambiar el esquema.
Fase 21 (SaaS modules)          `delivery` es uno de los modulos que §33
                                enumera; hasFeature('delivery') gobernara
                                la visibilidad de estas pantallas.
Fase 23 (Reports)               entregas por zona, tiempo real vs
                                estimado, tasa de fallidas por repartidor:
                                todo sale de order_deliveries y su
                                historial, sin columnas nuevas.
Un DeliveryProvider real        cuando se integre Rappi/PedidosYa/Uber
                                Direct, el adapter se escribe como
                                BillingProvider (ADR-021): order_deliveries
                                gana un provider_reference y un
                                provider_status, y el dominio no cambia.
Geocoding                       convertir "Av. Larco 123" en coordenadas
                                exige un servicio externo con clave; hoy
                                las coordenadas se escriben a mano o se
                                heredan de la libreta del cliente.
```
