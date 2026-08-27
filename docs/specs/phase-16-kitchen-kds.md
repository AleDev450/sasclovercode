# SPEC — Phase 16 — Kitchen / KDS

## 1. Información general

```text
Phase:                16
Nombre:               Kitchen / KDS
Estado:               COMPLETED
Versión:              1.0.0
Fecha creación:       2026-08-27
Última actualización: 2026-08-27
Responsable:          alejandro.avendano@masuno.pe
```

Documento maestro: §33 (Fase 16).
Fases previas: 00 a 15 — todas COMPLETED y auditadas.
ADR: [020 — Station snapshot y Realtime como refetch](../adr/020-kds-station-snapshot-and-realtime-as-refetch.md).

---

## 2. Objetivo

### ¿Por qué existe esta fase?

Master §33, Fase 16, textual y completo:

> Crear Kitchen Display System. Pedidos en tiempo real. Estados: new,
> preparing, ready. Analizar uso de Supabase Realtime. Solo utilizar
> realtime donde aporte valor real. Preparar estaciones: kitchen, bar,
> sushi, desserts.

Las Fases 13 a 15 dieron al sistema un pedido, un cobro y una forma rápida de
crear ambos. Ninguna le dio a la cocina una pantalla propia: hasta esta
fase, "qué preparar ahora" solo se podía leer en `/pedidos`, una pantalla
pensada para administrar, no para un cocinero de pie frente a una plancha.
Esta fase no agrega un pedido nuevo — agrega la vista que una cocina
necesita del mismo pedido, y la hace viva.

### ¿Qué debe ser posible al terminarla?

```text
Ver, sin recargar la pagina, los pedidos que le corresponden a una
  estacion (cocina, barra, sushi, postres) en cuanto existen.
Que un pedido se mueva de "nuevo" a "preparando" a "listo" desde la
  misma pantalla, con un toque.
Que la pantalla de sushi no reciba ni un byte de lo que le
  corresponde a la barra.
Que dos negocios en la misma base de datos jamas compartan un evento
  en tiempo real, igual que jamas comparten una fila.
```

---

## 3. Alcance

### Incluido

```text
categories.kitchen_station y order_items.station (enum kitchen_station,
  cuatro valores exactos de §33).
snapshot_order_item() (Fase 13) extendido para copiar la estacion.
order_items y orders agregadas a la publicacion supabase_realtime.
listKitchenOrders: pedidos en (confirmed, preparing, ready), filtrados
  por sede y estacion.
Pantalla /dashboard/{slug}/cocina: tablero de tres columnas, selector
  de estacion por URL, selector de sede si hay mas de una.
Un campo nuevo en el formulario de categoria existente (Fase 11).
```

### Fuera de alcance

```text
Nuevos permisos, nuevas tablas de pedidos, nuevo estado del pedido —
  no hacian falta; ver seccion 4 y ADR-020.
Estado por linea (cada item de un pedido avanzando por separado) —
  el pedido sigue siendo una sola maquina de estados (Fase 13, ADR-017);
  dividir su ciclo de vida por estacion es una pregunta de producto
  que nadie ha hecho todavia.
Estaciones o roles configurables por tenant — las cuatro estaciones
  son las de §33, un enum cerrado, no una tabla editable.
Sonido, notificaciones push, impresion de comandas — ninguna fase lo
  pidio.
Broadcast o Presence de Supabase — el problema de esta fase es "la
  base de datos cambio, avisame", que es exactamente lo que
  postgres_changes resuelve; ninguno de los otros dos resuelve un
  problema que esta fase tenga.
```

### La decisión de alcance que más costó

Que `order_items.station` sea una copia tomada al insertar, y no una
consulta en vivo contra `categories`.

La respuesta obvia — un JOIN normal, como cualquier relación de este
esquema — es sencillamente incompatible con la razón por la que esta fase
usa Realtime. El filtro de `postgres_changes` solo compara columnas
literales de la tabla observada; no ejecuta un JOIN. Sin la copia, la
pantalla de sushi tendría que suscribirse a **todo** movimiento de
`order_items` del tenant y descartar en el navegador lo que no le
corresponde — exactamente lo contrario de "usar realtime donde aporte
valor real". Ver ADR-020 §1 para el razonamiento completo, incluida la
distinción explícita con ADR-017 (esto no es una snapshot financiera).

---

## 4. Dependencias

```text
Phase 03 — Authorization + RLS  orders.view/orders.update, sin cambios
Phase 10 — Locations            una cocina por sede, igual que el POS
Phase 11 — Catalog              categories, extendida con kitchen_station
Phase 13 — Orders Core          orders, order_items, el snapshot trigger,
                                 la maquina de estados (sin tocar)
Phase 15 — POS                  precedente del cliente Supabase en el
                                 navegador (createSupabaseBrowserClient),
                                 primer uso real en esta fase
ADR-017 — Order snapshot/FSM    por que esta fase NO reabre la maquina
                                 de estados
ADR-020 — Esta fase             snapshot de estacion, realtime como
                                 señal de refetch
```

**Cero permisos nuevos.** `orders.view` y `orders.update` — que el rol
`kitchen` ya tiene desde la Fase 03 — son exactamente lo que esta fase
necesita. Una estación es qué tablero se mira, no una autorización
distinta.

---

## 5. Casos de uso

```text
UC-1601
Actor           Cocinero de sushi
Precondiciones  orders.view
Acción          Abre /cocina?estacion=sushi
Resultado       Ve solo los pedidos con al menos una linea de sushi,
                y solo esas lineas de cada pedido

UC-1602
Actor           Cajero (POS, Fase 15)
Precondiciones  Cobra una venta con un roll y una gaseosa
Acción          El pedido se confirma
Resultado       La pantalla de sushi, ya abierta, muestra el roll SIN
                recargar; la de barra muestra la gaseosa, tambien sin
                recargar

UC-1603
Actor           Cocinero
Precondiciones  orders.update, un pedido "nuevo" en su estacion
Acción          Toca "Pasar a preparando"
Resultado       advanceOrderStatusAction (Fase 13) mueve el pedido;
                todas las pantallas abiertas se refrescan solas

UC-1604
Actor           Dueño
Precondiciones  products.update
Acción          Cambia la categoria "Bebidas" de estacion bar a kitchen
Resultado       Los pedidos NUEVOS con bebidas aparecen en cocina; los
                que ya existian con una linea de bebida siguen viendose
                en la pantalla de barra donde ya estaban

UC-1605 (verificado contra Supabase real, no PGlite)
Actor           Un atacante con sesion valida de OTRO negocio
Precondiciones  Ninguna - solo una sesion autenticada cualquiera
Acción          Se suscribe a postgres_changes con un filtro que nombra
                el tenant_id de la victima
Resultado       No recibe nada. Row Level Security se aplica tambien a
                Realtime, no solo a las consultas normales
```

---

## 6. Requerimientos funcionales

```text
FR-1601  Las estaciones son exactamente kitchen, bar, sushi y desserts
         (§33).

FR-1602  Toda categoria tiene una estacion; el valor por defecto es
         kitchen, para que una categoria de una fase anterior siga
         funcionando sin migracion de datos.

FR-1603  La estacion de una linea de pedido se copia de la categoria
         del producto AL CREARSE la linea. Cambiar la estacion de la
         categoria despues no mueve lineas ya existentes.

FR-1604  Una linea sin producto (texto libre) o de un producto sin
         categoria queda en la estacion por defecto (kitchen).

FR-1605  El tablero muestra pedidos en los estados confirmed,
         preparing y ready — ni antes (pending) ni despues (completed,
         cancelled).

FR-1606  Filtrar por estacion oculta, de cada pedido, las lineas que
         no son de esa estacion; un pedido sin ninguna linea de la
         estacion elegida no aparece en absoluto.

FR-1607  Sin filtro de estacion, el tablero muestra todas las lineas
         de todos los pedidos, marcando a que estacion pertenece cada
         una.

FR-1608  Avanzar un pedido desde el tablero usa la misma accion y el
         mismo permiso que `/pedidos` (orders.update); esta fase no
         crea una via de escritura alternativa.

FR-1609  Un cambio relevante (una linea nueva, un pedido que cambia de
         estado) actualiza el tablero sin que la persona recargue la
         pagina.

FR-1610  Con mas de una sede activa, el tablero exige elegir una,
         igual que el POS (Fase 15).
```

---

## 7. Requerimientos no funcionales

```text
NFR-1601 Seguridad
  Verificado contra un Supabase real (no PGlite): postgres_changes
  respeta Row Level Security por suscriptor. Una sesion de otro tenant,
  suscrita con el tenant_id de la victima puesto a mano en el filtro,
  no recibe ningun evento (UC-1605). No es una politica nueva de esta
  fase - es la misma RLS de order_items/orders (Fase 13) confirmada
  bajo un mecanismo que ninguna fase anterior habia ejercitado.

NFR-1602 Integridad
  La maquina de estados sigue siendo la unica de la Fase 13. Esta fase
  no valida transiciones por su cuenta en ningun punto.

NFR-1603 Performance
  order_items_tenant_station_idx sirve la consulta que el tablero
  ejecuta en cada carga y en cada refetch. El filtro de Realtime por
  estacion (ademas de tenant) existe para que la pantalla de una
  estacion no reciba - ni siquiera para descartar - los eventos de las
  demas.

NFR-1604 Escalabilidad
  Un evento de Realtime dispara un router.refresh(), no una fusion de
  estado en el cliente. A los volumenes de pedidos de una cocina esto
  es barato y siempre tan correcto como la carga inicial de la pagina
  (ADR-020 §2).

NFR-1605 Observabilidad
  Ningun evento de log nuevo: order.created y order.status_changed
  (Fase 13) ya se emiten desde las acciones que este tablero reutiliza
  sin modificar.

NFR-1606 Mantenibilidad
  listKitchenOrders es la unica implementacion de "que pedidos van en
  este tablero". Realtime nunca reconstruye esa logica por su cuenta -
  solo dice cuando volver a preguntarsela.
```

---

## 8. Modelo de datos

### Enum nuevo

```text
kitchen_station = ('kitchen','bar','sushi','desserts')
```

### Extensión a categories (Fase 11)

```text
categories.kitchen_station  kitchen_station NOT NULL DEFAULT 'kitchen'
```

### Extensión a order_items (Fase 13)

```text
order_items.station  kitchen_station NOT NULL DEFAULT 'kitchen'
  copiado por snapshot_order_item() al insertar, desde la categoria
  del producto. NO se recalcula despues.

INDEX (tenant_id, station)
```

### Realtime

```text
supabase_realtime (publicacion)
  + public.order_items
  + public.orders
```

Ninguna tabla nueva. Ninguna columna de dinero. Ningún permiso.

---

## 9. Diagrama de relaciones

```text
categories.kitchen_station ──(copiado al insertar)──► order_items.station
                                                              │
                                                    (filtro de postgres_changes)
                                                              │
orders (confirmed|preparing|ready) ──┬──► order_items ───────┴──► tablero
                                      │
                          advanceOrderStatusAction (Fase 13, sin cambios)
```

---

## 10. Tenant Isolation

```text
Tenant Isolation Impact: TOTAL (heredado; verificado bajo un mecanismo nuevo)
```

**¿Cómo se determina el tenant?** `requireActiveTenant(tenantSlug)` (Fase
01), igual que cualquier otra pantalla.

**¿Qué cambia respecto a la Fase 13?** Nada en las políticas RLS de
`orders`/`order_items` — siguen siendo exactamente las de esa fase. Lo que
esta fase verifica por primera vez es que esas mismas políticas también
gobiernan quién recibe un evento de `postgres_changes`, no solo quién puede
hacer un SELECT. Confirmado corriendo (UC-1605), no solo leído en la
documentación de Supabase.

**¿Existe algún recurso global?** `kitchen_station`, el enum, no lleva
tenant — es vocabulario del producto, igual que `order_status`/`order_source`
(Fase 13). No es una tabla, no tiene fila que aislar.

---

## 11. Seguridad

```text
Authorization requirements
  orders.view     ver el tablero
  orders.update   avanzar un pedido desde el tablero
  products.update  cambiar la estacion de una categoria (Fase 11, sin
                    permiso nuevo)

Roles involucrados
  kitchen   ya tenia orders.view y orders.update desde la Fase 03;
            esta fase no le agrega ni le quita nada
  El resto de roles que ya veian pedidos (manager, cashier, waiter,
  owner, admin) puede abrir el tablero igual que antes podia abrir
  /pedidos

RLS policies
  Ninguna nueva. order_items_select_member y orders_select_member
  (Fase 13) siguen siendo las unicas.

Potential abuse cases
  AB-1601  Suscribirse a postgres_changes nombrando el tenant_id de
           otro negocio en el filtro, esperando que Realtime no
           revise RLS.
           Mitigado: confirmado que Realtime SI revisa RLS por
           suscriptor (UC-1605, NFR-1601).
  AB-1602  Intentar avanzar un pedido saltandose un estado desde el
           boton del tablero.
           Mitigado: el boton es AdvanceOrderForm (Fase 13) sin
           modificar; el trigger contra order_transitions rechaza
           cualquier salto igual que en /pedidos.
  AB-1603  Insertar una linea de pedido declarando una estacion que
           no es la de su categoria, para aparecer en un tablero
           equivocado.
           Mitigado: el cliente nunca envia `station` - el trigger lo
           calcula y lo sobreescribe, igual que hace con el precio
           desde la Fase 13.
```

---

## 12. API / Server Actions

Ninguna acción nueva. El tablero llama a `advanceOrderStatusAction`
(`orders/server/actions.ts`, Fase 13) exactamente como `/pedidos` ya lo
hace.

Consultas nuevas:

```text
listKitchenOrders(tenantId, { station?, locationId? }) -> KitchenTicket[]
  (src/modules/kitchen/server/queries.ts)
```

`categorySchema` (Fase 11) gana el campo `kitchenStation`;
`createCategoryAction`/`updateCategoryAction` lo pasan sin cambiar su forma.

---

## 13. UI / UX

```text
/dashboard/{slug}/cocina
  Propósito     Lo que hay que preparar ahora mismo, por estacion
  Layout        Tres columnas: Nuevo / Preparando / Listo
  Acciones      Elegir estacion (pestañas por URL), elegir sede si
                aplica, avanzar un pedido
  Permissions   orders.view; orders.update para el boton de avanzar
  Tiempo real   Un canal de Realtime por combinacion sede+estacion;
                cualquier evento relevante dispara un refresco de la
                pagina, no una actualizacion parcial (ADR-020)
```

Reutilizado sin cambios: `AdvanceOrderForm` (Fase 13), el patron de
selector de sede por `?sede=` (Fase 15).

---

## 14. Flujos principales

```text
Cocinero abre /cocina?estacion=sushi
   ↓
Server Component: requireActiveTenant + hasPermission(orders.view)
   ↓
listKitchenOrders(tenantId, { station: 'sushi', locationId })
   ↓
KdsBoard (cliente) se monta
   ↓
Se suscribe a postgres_changes:
  order_items INSERT   filter: tenant_id=eq.X,station=eq.sushi
  orders UPDATE         filter: tenant_id=eq.X,location_id=eq.Y
   ↓
Un pedido nuevo con sushi se crea en otra pestaña (POS, Fase 15)
   ↓
Evento INSERT llega por el canal
   ↓
router.refresh() -> Server Component vuelve a correr
  listKitchenOrders -> el tablero muestra el pedido nuevo
```

---

## 15. Manejo de errores

```text
Avanzar un pedido sin permiso        -> AuthorizationError (Fase 13)
Transicion invalida desde el tablero -> P0001 (Fase 13, sin cambios)
Suscripcion de Realtime cae          -> el canal se reintenta al
                                        desmontar/montar el componente;
                                        no hay reintento automatico
                                        dentro de la misma sesion (KL-1602)
```

---

## 16. Observabilidad

Ninguno nuevo. `order.status_changed` (Fase 13) ya cubre cada avance desde
el tablero.

---

## 17. Testing Plan

### Unit

```text
TEST-1601  KITCHEN_STATIONS es exactamente kitchen/bar/sushi/desserts.
TEST-1602  BOARD_STATUSES es exactamente confirmed/preparing/ready -
           ni pending, ni completed, ni cancelled.
TEST-1603  Cada estacion y cada estado del tablero tiene una etiqueta,
           y no hay etiquetas sobrantes.
TEST-1604  La entrada de navegacion "cocina" depende de orders.view.
```

### Database

```text
TEST-1605  Una linea copia la estacion de la categoria del producto
           al insertarse.
TEST-1606  EL TEST DE LA FASE. Cambiar la estacion de la categoria
           DESPUES de crear una linea no mueve la linea ya creada.
TEST-1607  Un producto sin categoria, o una linea sin producto, caen
           en kitchen por defecto.
TEST-1608  Las cuatro estaciones de §33 son validas; cualquier otra
           es rechazada por el enum.
```

### Verificado a mano contra Supabase real (PGlite no puede ejercitar Realtime, ADR-007)

```text
- order_items y orders quedan en la publicacion supabase_realtime tras
  aplicar las migraciones.
- El snapshot de estacion funciona igual contra Postgres real que
  contra PGlite.
- Una suscripcion filtrada a station=sushi recibe una insercion de
  sushi y NUNCA recibe una insercion de bar hecha mientras la
  suscripcion estaba activa.
- UC-1605: una sesion de un tenant DISTINTO, suscrita con el tenant_id
  de la victima puesto a mano en el filtro, no recibe ningun evento.
  Row Level Security se aplica a postgres_changes, no solo a las
  consultas normales.
```

---

## 18. Edge Cases

```text
Categoria sin estacion asignada       Cae en kitchen (el default de
                                       la columna).
Producto sin categoria                Su linea cae en kitchen.
Linea de texto libre (sin producto)   Cae en kitchen.
Estacion cambiada despues de vender   Pedidos viejos no se mueven de
                                       tablero; los nuevos si.
Pedido con lineas de dos estaciones   Aparece en ambos tableros,
                                       mostrando solo su propia linea
                                       en cada uno.
Tablero "todas las estaciones"        Muestra cada linea con una
                                       etiqueta de a que estacion
                                       pertenece.
Pedido sin ninguna linea de la
  estacion elegida                    No aparece en ese tablero
                                       (FR-1606).
Reconexion de Realtime tras perder
  la red                              El canal se resuscribe al
                                       remontar el componente; no hay
                                       una reconexion en caliente
                                       dentro del mismo montaje
                                       (KL-1602).
```

---

## 19. Performance considerations

```text
Queries    listKitchenOrders es una sola consulta con embed,
           independientemente de cuantas lineas tenga cada pedido -
           el mismo argumento que getOrderDetail (Fase 13) y
           listProductsWithVariants (Fase 15).

Indexes    (tenant_id, station) en order_items sirve exactamente el
           filtro que este tablero ejecuta.

Realtime   Filtrado por tenant_id y estacion en el propio canal, no
           solo en el cliente: la pantalla de una estacion nunca
           recibe, ni para descartar, los eventos de otra.

Refetch    Un router.refresh() por evento relevante. A los volumenes
           de una cocina (unos pocos pedidos por minuto) esto es mas
           barato que mantener una cache normalizada en el cliente
           (ADR-020 §2).
```

---

## 20. Migraciones

```text
20260827160000_extend_categories_kitchen_station.sql
  Enum kitchen_station; categories.kitchen_station.

20260827160100_extend_order_items_station.sql
  order_items.station; snapshot_order_item() (Fase 13) extendido.

20260827160200_enable_kds_realtime.sql
  order_items y orders agregadas a la publicacion supabase_realtime.
  Crea la publicacion si no existe (el arnes de PGlite, ADR-007, no
  la tiene; un Supabase real si).
```

---

## 21. Rollback

Aditivas. Revertir es soltarlas en orden inverso:

```sql
alter publication supabase_realtime drop table public.order_items;
alter publication supabase_realtime drop table public.orders;
alter table public.order_items drop column if exists station;
alter table public.categories drop column if exists kitchen_station;
drop type if exists public.kitchen_station;
```

Ningún dato deja de tener sentido sin estas columnas: un pedido y sus líneas
siguen siendo válidos exactamente como los dejó la Fase 13. Lo único que se
pierde es a qué pantalla de cocina pertenecía cada línea — información
operativa, no un hecho de venta.

---

## 22. Definition of Done

- [x] Enum `kitchen_station` con los cuatro valores exactos de §33
- [x] `categories.kitchen_station`, por defecto `kitchen`
- [x] `order_items.station`, copiado al insertar, nunca recalculado
- [x] TEST-1606 en verde: cambiar la categoria no mueve una linea ya
      creada
- [x] `order_items`/`orders` en la publicacion `supabase_realtime`,
      confirmado contra Supabase real
- [x] El tablero muestra exactamente confirmed/preparing/ready
- [x] Avanzar un pedido reutiliza `advanceOrderStatusAction` sin
      modificarlo
- [x] Filtrar por estacion oculta lineas Y pedidos sin ninguna linea
      de esa estacion
- [x] Realtime dispara un refetch, nunca reconstruye datos del payload
- [x] Verificado a mano: RLS se aplica a `postgres_changes` (UC-1605)
- [x] Cero permisos nuevos, cero tablas nuevas
- [x] Unit e integration tests PASS
- [x] Suite completa (Fases 00-16) sigue en verde
- [x] Typecheck PASS
- [x] Lint PASS
- [x] Build PASS
- [x] SPEC actualizado

---

## 23. Implementation notes

### El hallazgo que no estaba en el plan: Realtime SÍ respeta RLS

La pregunta más importante de esta fase no era de diseño sino empírica:
¿`postgres_changes` de Supabase Realtime aplica Row Level Security por
cada suscriptor, o transmite cada fila a cualquiera con un token válido,
dejando el filtrado como una cortesía del lado del cliente? La
documentación lo afirma, pero esta fase lo puso a prueba de verdad: una
sesión de un tenant B, suscrita con un filtro que nombraba a mano el
`tenant_id` del tenant A, no recibió ni un evento. Es la misma garantía
que `order_items_select_member` (Fase 13) ya daba para una consulta común,
confirmada bajo un mecanismo que ninguna fase anterior había ejercitado.
Sin Docker disponible esta sesión no habría sido una suposición razonable:
habría sido una suposición, sin más.

### Por qué `order_items.station` no es "otra snapshot más"

Fue tentador escribir la justificación de esta columna copiando la de
ADR-017 casi literalmente — total, el mecanismo (un trigger que copia un
valor al insertar) es idéntico. Se resistió esa tentación a propósito: la
razón de ADR-017 es que un precio pasado no puede depender de un precio
presente. La razón de esta columna es que un filtro de Postgres no puede
comparar contra una tabla que no está mirando. Son dos problemas distintos
que llegaron a la misma solución por caminos distintos, y ADR-020 lo dice
explícitamente en vez de dejar que el lector asuma que es la misma
decisión repetida.

### Qué se verificó y qué no

Verificado corriendo, contra un Supabase real levantado en esta misma
sesión (no PGlite): las tres migraciones se aplican limpias; el snapshot
de estación funciona igual que en PGlite; una suscripción a `station=sushi`
recibe una inserción de sushi y jamás una de barra hecha mientras estaba
activa; una sesión de otro tenant no recibe nada aunque nombre el
`tenant_id` de la víctima a mano. `npm run typecheck`, `npm run lint`,
`npm run build` y la suite completa en verde.

No verificado: nadie ha abierto `/cocina` en un navegador ni ha visto el
tablero refrescarse solo frente a sus ojos — esta sesión no tiene una
herramienta de navegador interactivo. Lo que sí se verificó es que el
mecanismo que haría eso posible (el canal, el filtro, el evento, RLS)
funciona de punta a punta contra infraestructura real; lo que falta es
literalmente la pantalla actualizándose, que es la única pieza que
requiere ojos humanos.

---

## 24. Known limitations

```text
KL-1601  Sin sonido ni notificacion visual mas alla del contador que
         cambia. Master no lo pidio.

KL-1602  Si el canal de Realtime se cae (perdida de red), no hay
         reintento automatico dentro del mismo montaje del componente
         - se resuscribe cuando el componente se vuelve a montar
         (cambio de estacion, recarga de pagina). Ningun caso de
         prueba en produccion lo ha mostrado como un problema real
         todavia.

KL-1603  El tablero no distingue "pedido nuevo hace 30 segundos" de
         "pedido nuevo hace 20 minutos" con una alerta visual - solo
         muestra la hora exacta (no un contador relativo, por la
         regla de pureza de React: un contador que depende del reloj
         necesitaria estado y un intervalo, y nadie lo ha pedido).

KL-1604  Cambiar la estacion de una categoria no ofrece "mover" las
         lineas ya creadas a la estacion nueva, ni siquiera como
         accion manual. Es la consecuencia directa y deliberada de
         FR-1603/ADR-020, no un descuido.

KL-1605  No hay una vista de "todas las sedes a la vez" para un
         negocio con varias cocinas - cada pantalla es de una sede, la
         misma restriccion que el POS (Fase 15) ya tiene.
```

---

## 25. Future considerations

```text
- La Fase 17 (SUNAT) no toca esta pantalla: nada de lo que factura
  cambia si una linea aparecio en cocina o en barra.
- Un contador relativo en vivo ("hace 5 min") es posible sin romper la
  regla de pureza usando un intervalo del lado del cliente que
  actualice un estado local - no se construyo porque nadie lo pidio,
  no porque no se pueda.
- El patron de esta fase (Realtime como señal de refetch, filtrado por
  una columna snapshotted especificamente para eso) es reutilizable
  por cualquier pantalla futura que necesite actualizarse sola sin
  pagar el costo de una cache normalizada en el cliente.
```
