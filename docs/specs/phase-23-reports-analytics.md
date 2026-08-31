# SPEC — Phase 23 — Reports + Analytics

## 1. Información general

```text
Phase:                23
Nombre:               Reports + Analytics
Estado:               COMPLETED
Versión:              1.0.0
Fecha creación:       2026-08-30
Última actualización: 2026-08-30
Responsable:          alejandro.avendano@masuno.pe
```

Documento maestro: §33 (Fase 23), §18 (performance), §26 (medir antes de optimizar), §40 (timezone), §47 (infraestructura no pedida).
Fases previas: 00 a 22 — todas COMPLETED y auditadas.
ADR: [027 — Agregación en funciones SQL; ninguna vista materializada todavía](../adr/027-aggregate-functions-and-no-materialised-views-yet.md).

---

## 2. Objetivo

### ¿Por qué existe esta fase?

Master §33, Fase 23, textual y completo:

> Dashboard: ventas; ticket promedio; pedidos; productos; horarios; sucursales;
> clientes; medios de pago.
> Evitar consultas extremadamente costosas en cada request.
> Analizar: SQL views; materialized views; aggregations; caching; **solo cuando
> datos reales lo justifiquen**.

Veintidós fases han estado **escribiendo** datos. `orders` sabe qué se vendió,
`order_items` con qué, `payments` cómo se cobró, `locations` dónde y
`customers` a quién. Nadie ha **leído** nada de eso en conjunto.

Un negocio que usa CloverCode todos los días no puede responder "¿cuánto vendí
esta semana?" sin abrir la lista de pedidos y sumar a mano. Esta fase es la que
contesta.

La segunda mitad de la instrucción es tan importante como la primera y es una
advertencia: vistas materializadas y caché **sólo cuando datos reales lo
justifiquen**. §26 lo repite — "medir antes de optimizar" — y esta fase la
obedece literalmente: cero vistas materializadas, cero caché entre requests, y
un umbral escrito de cuándo eso debería cambiar.

### ¿Qué debe ser posible al terminarla?

```text
Ver, para un rango de fechas y una sede opcional: cuanto se vendio, cuantos
  pedidos, y cual fue el ticket promedio.
Ver la venta dia a dia, para saber si la semana fue mejor que la anterior.
Ver a que HORA vende el negocio - en SU zona horaria, no en UTC - para
  saber cuando reforzar el turno.
Ver que sede vende mas, cuando hay mas de una.
Ver que productos se venden y cuales no.
Ver que clientes vuelven y cuanto dejan.
Ver con que medios se cobra, para negociar comisiones o comprar mas
  sencillo.
Y que ninguna de esas ocho preguntas cueste mas de una consulta.
```

---

## 3. Alcance

### Incluido

```text
Siete funciones SQL de agregacion que cubren las ocho dimensiones de §33
  (ventas y ticket promedio salen juntas del resumen).
Todas SECURITY DEFINER con la puerta explicita en `reports.view` - el
  permiso existe desde la Fase 03 y esta fase es la primera que lo usa
  para algo.
Toda fecha agrupada en la ZONA HORARIA DEL TENANT (§40), no en UTC: la
  hora punta de un negocio limeno es a las 20:00, no a la 01:00.
Un indice nuevo sobre orders (tenant_id, status, placed_at) y la retirada
  del que ese reemplaza, para no sobreindexar (§8).
Modulo reports: helpers de rango puros, consultas de servidor y la
  pantalla /reportes.
Gateado por el modulo `reports` (Fase 21) y el permiso `reports.view`.
CERO tablas nuevas. Un reporte lee lo que ya existe.
CERO vistas materializadas, y el umbral escrito que las justificaria.
```

### Fuera de alcance

```text
Vistas materializadas y caché entre requests. §33 dice "solo cuando datos
  reales lo justifiquen" y §26 dice "medir antes de optimizar"; no hay
  datos reales que medir todavia. Ver ADR-027 decision 2, y el umbral
  concreto en la seccion 19.
Exportar a CSV o Excel. No lo pide §33, y hacerlo bien (streaming, no
  cargar todo en memoria) es trabajo real que nadie ha pedido. Ver KL-2305.
Graficos. Las ocho dimensiones se sirven como tablas con numeros. Una
  libreria de charts es una dependencia nueva para un problema estetico.
  Ver KL-2304.
Comparativas automaticas contra el periodo anterior. Se puede pedir el
  rango anterior a mano; calcularlo solo es una feature que §33 no nombra.
Reportes de inventario, fidelizacion o cobranza SaaS. §33 enumera ocho
  dimensiones y las ocho son de VENTA. Las otras fases ya dejaron sus datos
  listos para cuando se pidan (KL-2306).
Reportes en tiempo real o con push. Un reporte se pide, se lee y se cierra.
```

### La decisión de alcance que más costó

**Qué cuenta como una venta.**

`orders` tiene seis estados y sólo uno de ellos es dinero cobrado. La
tentación era contar todo lo que no estuviera anulado, porque así "las ventas
de hoy" incluyen lo que se está preparando ahora mismo y el número se parece
más a lo que el dueño espera ver a media tarde.

Se descartó. **Un reporte cuenta `completed` y nada más**, por dos razones:

- Es lo que hace el resto del producto. Desde ADR-022 el stock se descuenta
  al llegar a `completed`, y desde ADR-024 los puntos se acreditan ahí. Si un
  reporte contara `ready`, las ventas del reporte y el consumo de inventario
  hablarían de conjuntos distintos de pedidos, y cuadrarlos sería imposible.
- Es lo único demostrable. Un pedido en `preparing` puede acabar anulado.

La pantalla lo dice en una línea, en vez de dejar que alguien lo descubra
cuadrando. Ver ADR-027 decisión 3.

---

## 4. Dependencias

```text
Phase 03 — Authorization   `reports.view` existe desde entonces y esta fase
                            es la primera que lo usa; el patron de funcion
                            SECURITY DEFINER con puerta lo sento
                            get_tenant_members
Phase 06 — Settings        tenant_settings.timezone, sin la cual "horarios"
                            seria un reporte en UTC y por tanto falso
Phase 10 — Locations       la dimension "sucursales"
Phase 11 — Catalog         "productos", via el snapshot de order_items
Phase 12 — Customers       "clientes"
Phase 13 — Orders          ventas, ticket promedio, pedidos y horarios
Phase 14 — Payments        "medios de pago"
Phase 21 — SaaS modules    el modulo `reports` ya estaba declarado; esta
                            fase solo tiene que respetarlo
ADR-015 — Money            todo importe entero, tambien los promedios
```

---

## 5. Casos de uso

```text
UC-2301
Como duena del negocio
quiero ver cuanto vendi esta semana
para saber si voy mejor que la anterior.

  Actor          owner / admin / manager / accountant (reports.view)
  Precondiciones el modulo `reports` esta en su plan
  Accion         abrir /reportes con el rango "ultimos 7 dias"
  Resultado      total vendido, numero de pedidos y ticket promedio
  Errores        sin permiso -> 404; sin modulo -> 404

UC-2302
Como Encargado
quiero ver a que hora vende mas el local
para reforzar el turno correcto.

  Actor          manager
  Accion         mirar el reporte por hora
  Resultado      24 filas, en la zona horaria del negocio
  Errores        ninguno

UC-2303
Como duena de dos locales
quiero comparar sus ventas
para saber cual necesita ayuda.

  Actor          owner
  Accion         mirar el reporte por sede
  Resultado      una fila por sede con su venta y su numero de pedidos
  Errores        ninguno

UC-2304
Como Contador
quiero ver con que medios se cobro
para cuadrar caja y comisiones.

  Actor          accountant (reports.view)
  Accion         mirar el reporte por medio de pago
  Resultado      una fila por metodo, sin contar pagos anulados
  Errores        ninguno

UC-2305
Como Encargado
quiero filtrar cualquier reporte por sede
para mirar solo el local que superviso.

  Actor          manager
  Accion         elegir una sede en el filtro
  Resultado      todos los reportes que dependen de sede se recalculan
  Errores        sede de otro negocio -> RLS no devuelve nada
```

---

## 6. Requerimientos funcionales

```text
FR-2301  Un reporte contara unicamente pedidos en estado `completed`.
FR-2302  Todo reporte aceptara un rango de fechas [desde, hasta).
FR-2303  Los reportes que dependen de sede aceptaran un filtro de sede
         opcional.
FR-2304  El resumen dara: numero de pedidos, venta bruta, descuentos,
         envio, venta neta y ticket promedio.
FR-2305  El ticket promedio sera la venta neta entre el numero de pedidos,
         en enteros, y cero cuando no hay pedidos.
FR-2306  La venta por dia agrupara por dia en la zona horaria del negocio.
FR-2307  La venta por hora agrupara por hora en la zona horaria del
         negocio, y devolvera las 24 horas aunque alguna no tenga ventas.
FR-2308  La venta por sede listara todas las sedes activas, incluso las
         que no vendieron nada.
FR-2309  Los productos mas vendidos se ordenaran por venta neta, no por
         unidades.
FR-2310  Un producto borrado seguira apareciendo por su nombre
         snapshoteado.
FR-2311  Los clientes se ordenaran por venta neta y excluiran las ventas
         sin cliente.
FR-2312  Los medios de pago excluiran los pagos anulados.
FR-2313  Los medios de pago se agruparan por la fecha del PEDIDO, no del
         pago, para que cuadren con el resumen.
FR-2314  Toda funcion de reporte exigira `reports.view` en ese tenant.
FR-2315  Una funcion de reporte no devolvera ninguna fila a quien no tenga
         el permiso.
FR-2316  Ningun reporte cruzara datos de otro tenant.
FR-2317  La pantalla exigira el modulo `reports` ademas del permiso.
```

---

## 7. Requerimientos no funcionales

```text
NFR-2301 Performance (§33, §18)
         "Evitar consultas extremadamente costosas en cada request": cada
         dimension es UNA consulta agregada en la base, no una lista traida
         a la aplicacion para sumar en JavaScript. La pantalla completa son
         siete consultas, lanzadas en paralelo.

NFR-2302 Medir antes de optimizar (§26)
         Cero vistas materializadas y cero caché entre requests, con un
         umbral escrito (seccion 19) de cuando eso deberia cambiar. Ver
         ADR-027 decision 2.

NFR-2303 Indices (§8)
         Un indice nuevo que responde al patron real de estas consultas, y
         la retirada del que reemplaza - "evitar sobreindexar" es parte de
         la misma seccion.

NFR-2304 Correccion horaria (§40)
         Todo agrupamiento por tiempo ocurre en la zona horaria del
         negocio. Un reporte por hora en UTC es un reporte falso.

NFR-2305 Seguridad
         Las siete funciones son SECURITY DEFINER y comprueban
         `reports.view` explicitamente. Sin permiso: cero filas, no un
         error - el mismo comportamiento de get_tenant_members.

NFR-2306 Accesibilidad
         Cada tabla lleva `caption`; los numeros van en `tabular-nums`; el
         filtro es un formulario con labels asociados y navegable por
         teclado.
```

---

## 8. Modelo de datos

**Ninguna tabla nueva.** Es el resultado correcto: un reporte lee lo que otras
fases ya escribieron, y añadir una tabla para guardarlo sería exactamente la
vista materializada que §33 dice que no se añada todavía.

### Índices

```text
+ orders (tenant_id, status, placed_at DESC)
    El predicado literal de las siete consultas.

- orders (tenant_id, status)
    Retirado: el nuevo es un superconjunto por prefijo, asi que sirve para
    todo lo que servia el viejo. §8 pide evitar sobreindexar, y dos indices
    donde uno basta es peso en cada INSERT de pedido.
```

### Funciones

```text
report_sales_summary(tenant, from, to, location?)
  -> order_count, gross_cents, discount_cents, shipping_cents,
     net_cents, average_ticket_cents, item_count

report_sales_by_day(tenant, from, to, location?)
  -> day date, order_count, net_cents

report_sales_by_hour(tenant, from, to, location?)
  -> hour smallint (0..23), order_count, net_cents

report_sales_by_location(tenant, from, to)
  -> location_id, location_name, order_count, net_cents

report_top_products(tenant, from, to, location?, limit)
  -> product_id, name, quantity, net_cents, order_count

report_top_customers(tenant, from, to, limit)
  -> customer_id, name, order_count, net_cents

report_sales_by_payment_method(tenant, from, to)
  -> payment_method_id, name, type, payment_count, net_cents
```

Las siete: `stable`, `security definer`, `set search_path = ''`, y la puerta
`has_permission(tenant, 'reports.view')` como primera línea.

### Qué significa cada importe

```text
gross_cents     suma de orders.subtotal_cents      lo que costaron los bienes
discount_cents  suma de discount + promotion       lo que se rebajo
shipping_cents  suma de orders.shipping_cents      lo que costo llevarlo
net_cents       suma de orders.total_cents         lo que se cobro
```

`net_cents` es el número que manda: es el que el cliente pagó, y el único que
`payments` puede cuadrar.

---

## 9. Diagrama de relaciones

```text
                       reports.view
                            │
                            ▼
        ┌───────── siete funciones SQL ─────────┐
        │                                        │
   orders (completed)                      tenant_settings
        │                                    (timezone)
        ├──► order_items ──► productos
        ├──► payments ─────► medios de pago
        ├──► locations ────► sucursales
        ├──► customers ────► clientes
        └──► placed_at ────► dias y horas
                                 │
                    en la zona horaria del negocio
```

Ninguna flecha escribe. Esta fase es la primera que sólo lee.

---

## 10. Tenant Isolation

```text
¿Como se determina el tenant?
  Es un parametro explicito de cada funcion, y cada funcion comprueba
  `has_permission(ese tenant, 'reports.view')` antes de leer nada. Pedir el
  reporte de otro tenant devuelve cero filas.

¿Que tablas llevan tenant_id?
  Ninguna nueva. Las siete funciones filtran por `o.tenant_id = p_tenant_id`
  ademas de la puerta de permiso: defensa en profundidad, la misma postura
  de todos los modulos desde la Fase 11.

¿Como evita RLS el acceso cross-tenant?
  Estas funciones son SECURITY DEFINER y por tanto NO pasan por RLS - lo
  cual es deliberado y es la razon de que la puerta de permiso sea
  obligatoria y este probada (TEST-2320, TEST-2321). El precedente es
  get_tenant_members (Fase 03) y get_tenant_couriers (Fase 19).

¿Existe algun recurso global?
  No.
```

---

## 11. Seguridad

```text
Authorization
  `reports.view`, que existe desde la Fase 03 y hasta hoy no gobernaba
  nada. Ningun permiso nuevo: la Fase 03 ya lo habia previsto.

Roles que lo tienen
  owner, admin, manager, accountant.
  cashier, waiter, kitchen y delivery NO: quien atiende no necesita ver el
  margen del negocio, y un reporte de ventas es informacion que un negocio
  no quiere en el movil de todo el mundo.

Por que SECURITY DEFINER y no INVOKER
  Un reporte cruza orders, order_items, payments, customers y locations. Con
  INVOKER haria falta que el llamante tuviera `orders.view`, `products.view`,
  `payments.view` y `customers.view` a la vez, y entonces `reports.view` no
  gobernaria nada. DEFINER + una puerta explicita hace que UN permiso
  signifique exactamente lo que dice.

  El precio es que la puerta es la unica defensa, y por eso esta probada
  desde los dos lados: quien no la tiene no obtiene filas (TEST-2320), y
  quien la tiene en OTRO tenant tampoco (TEST-2321).

Input validation
  Zod en el limite: el rango se parsea y se acota, y la sede se valida como
  uuid. Un rango invertido se corrige antes de llegar a la base.

Potential abuse cases
  Pedir el reporte de otro negocio        -> la puerta, por tenant
  Un cajero mirando margenes              -> no tiene reports.view
  Un rango de diez anos como DoS          -> ver KL-2303
  Leer datos de un pedido anulado         -> solo cuenta `completed`

Sensitive information
  El reporte de clientes nombra personas y cuanto gastan. No sale en logs.
```

---

## 12. API / Server Actions

**Ninguna Server Action.** Esta fase no escribe nada, así que no tiene ninguna:
la pantalla es un Server Component que lee, y el filtro es un `GET` con
`searchParams`. Que un reporte no tenga acción es la señal de que efectivamente
no muta nada.

```text
GET /dashboard/{slug}/reportes?from=&to=&location=

  Permission: reports.view
  Module:     reports
  Params:     from, to  (fecha ISO; por defecto los ultimos 7 dias)
              location  (uuid opcional)
  Output:     las siete dimensiones, en paralelo
```

---

## 13. UI / UX

```text
/dashboard/{slug}/reportes
  Proposito     las ocho dimensiones de §33 en una pantalla
  Acciones      cambiar rango (atajos: hoy, 7 dias, 30 dias, este mes) y
                filtrar por sede
  Estados       empty ("No hubo ventas completadas en este rango."),
                sin sedes multiples -> el reporte por sede se omite
  Permissions   reports.view + modulo `reports`

  La pantalla dice, en una linea y no en un pie de pagina, que cuenta
  unicamente pedidos completados. Un numero que el lector interpreta mal
  es peor que ningun numero.
```

---

## 14. Flujos principales

```text
Pedir un reporte
  /reportes?from=...&to=...&location=...
      ↓
  requireActiveTenant + hasFeature('reports') + hasPermission('reports.view')
      ↓
  parseo del rango (Zod): se acota, se ordena, se rellena por defecto
      ↓
  siete llamadas RPC en paralelo
      ↓
  cada funcion: puerta de permiso → filtro por tenant → agregacion
      ↓
  siete tablas en pantalla
```

---

## 15. Manejo de errores

```text
Sin permiso                  -> cero filas de la base; 404 en la pagina
Sin el modulo `reports`      -> 404 en la pagina
Rango invertido              -> se ordena antes de consultar
Rango ausente                -> ultimos 7 dias
Rango absurdamente largo     -> se acota a 366 dias (KL-2303)
Sede inexistente             -> cero filas, sin error
Fallo de base                -> DatabaseError + log tecnico
```

---

## 16. Observabilidad

```text
reports.viewed   con tenantId, el rango pedido y si habia filtro de sede.
                 NUNCA los importes: un log no es un reporte.
```

Nada más. Esta fase no muta nada, así que no hay nada que auditar en el sentido
de §17 — lo que hay es una lectura, y lo único interesante de una lectura es
que ocurrió.

---

## 17. Testing Plan

### Unit

```text
TEST-2301  El rango por defecto son los ultimos 7 dias.
TEST-2302  Un rango invertido se ordena.
TEST-2303  Un rango de mas de 366 dias se acota.
TEST-2304  Los atajos (hoy, 7d, 30d, mes) producen los rangos correctos.
TEST-2305  averageTicket() divide en enteros y devuelve 0 sin pedidos.
TEST-2306  formatHour() nombra las 24 horas.
TEST-2307  El schema Zod rechaza una fecha invalida y una sede que no es
           uuid.
```

### Database (`src/tests/database/reports.test.ts`)

```text
TEST-2310  El resumen suma solo pedidos `completed`.
TEST-2311  Un pedido anulado no cuenta.
TEST-2312  Un pedido en curso no cuenta.
TEST-2313  El ticket promedio es la neta entre los pedidos.
TEST-2314  Con cero pedidos el resumen devuelve ceros, no nulos.
TEST-2315  El rango excluye lo anterior y lo posterior.
TEST-2316  El filtro de sede acota el resumen.
TEST-2317  La venta por dia agrupa en la zona horaria del negocio.
TEST-2318  La venta por hora agrupa en la zona horaria del negocio.
TEST-2319  La venta por hora devuelve las 24 horas.
TEST-2320  Sin `reports.view` no se devuelve ninguna fila.
TEST-2321  Con `reports.view` en OTRO tenant tampoco.
TEST-2322  La venta por sede incluye las sedes sin ventas.
TEST-2323  Los productos se ordenan por venta neta.
TEST-2324  Un producto borrado sigue apareciendo por su snapshot.
TEST-2325  Los clientes excluyen las ventas sin cliente.
TEST-2326  Los medios de pago excluyen los pagos anulados.
TEST-2327  Los medios de pago agrupan por fecha del pedido.
TEST-2328  Ningun reporte devuelve datos de otro tenant.
TEST-2329  El indice de reporting existe y el que reemplaza ya no.
TEST-2330  El resumen cuadra: neta = bruta - descuentos + envio.
```

### Regression

```text
schema.test        la migracion nueva entra en la lista
isolation          sin tablas nuevas, la comprobacion phase-agnostic sigue
                   pasando sin cambios - que es la prueba de que esta fase
                   no anadio superficie
```

---

## 18. Edge Cases

```text
Negocio sin ventas             -> ceros, y un empty state que lo dice
Negocio de una sede            -> el reporte por sede se omite en pantalla
Pedido sin cliente             -> cuenta en ventas, no en clientes
Pedido sin lineas              -> imposible: no puede llegar a `completed`
Producto borrado               -> aparece por name_snapshot
Sede desactivada con historia  -> aparece en el reporte por sede
Pago anulado                   -> no cuenta en medios de pago
Pago parcial                   -> cuenta lo cobrado, que puede no cuadrar
                                  con la neta; es correcto y es un dato
Rango de un solo dia           -> [00:00, 24:00) en hora del negocio
Timezone sin configurar        -> America/Lima, que es el default de la
                                  Fase 06
Descuento mayor que los bienes -> imposible desde la Fase 20
```

---

## 19. Performance considerations

Ésta es la sección que master pide explícitamente, y la respuesta corta es
**medir antes de optimizar** (§26).

```text
Lo que se hizo
  Un indice: orders (tenant_id, status, placed_at DESC), que es el predicado
  literal de las siete consultas. Y se retiro orders (tenant_id, status),
  del que el nuevo es superconjunto por prefijo - dos indices donde basta
  uno es peso en cada INSERT de pedido (§8).

  Cada dimension es UNA consulta agregada. La pantalla lanza las siete en
  paralelo. Nada se suma en JavaScript.

Lo que NO se hizo, y por que
  Vistas materializadas: §33 dice "solo cuando datos reales lo justifiquen"
  y no hay datos reales. Una matview aqui costaria un refresco programado
  -que exige el scheduler que sigue sin existir (§47)- y devolveria numeros
  viejos a cambio de una latencia que nadie ha medido como problema.

  Caché entre requests: un reporte cacheado es un reporte que miente sobre
  la hora a la que se miro. Se usa React `cache` por request, que solo
  evita repetir la misma consulta dentro de un render.

EL UMBRAL, escrito para que la Fase 26 no tenga que inventarlo
  Se considerara una vista materializada cuando, con datos de produccion:
    - report_sales_by_day sobre 90 dias tarde mas de 500 ms, o
    - un tenant supere ~500.000 pedidos completados,
  lo que ocurra antes. La Fase 26 es literalmente la fase de medir; hasta
  entonces, esto es una hipotesis, no un problema.
```

---

## 20. Migraciones

```text
20260830150000_create_report_functions.sql
  El indice de reporting, la retirada del que reemplaza, y las siete
  funciones de agregacion con su puerta de permiso.
```

Una sola migración, no destructiva salvo el `drop index`, que es seguro
porque el índice nuevo lo cubre por prefijo.

---

## 21. Rollback

```text
  drop function public.report_sales_by_payment_method(uuid, timestamptz, timestamptz);
  drop function public.report_top_customers(uuid, timestamptz, timestamptz, integer);
  drop function public.report_top_products(uuid, timestamptz, timestamptz, uuid, integer);
  drop function public.report_sales_by_location(uuid, timestamptz, timestamptz);
  drop function public.report_sales_by_hour(uuid, timestamptz, timestamptz, uuid);
  drop function public.report_sales_by_day(uuid, timestamptz, timestamptz, uuid);
  drop function public.report_sales_summary(uuid, timestamptz, timestamptz, uuid);

  create index orders_tenant_status_idx on public.orders (tenant_id, status);
  drop index public.orders_tenant_status_placed_idx;

El rollback mas barato de todo el proyecto: esta fase no creo ninguna tabla
ni escribio un solo dato, asi que quitarla no puede perder nada. Lo unico
con cuidado es reponer el indice antiguo ANTES de retirar el nuevo.
```

---

## 22. Definition of Done

- [x] Las siete funciones cubren las ocho dimensiones de §33
- [x] Toda agrupación temporal en la zona horaria del negocio (§40)
- [x] Puerta `reports.view` en cada función, probada desde los dos lados
- [x] Sólo cuentan pedidos `completed`, y la pantalla lo dice
- [x] Índice nuevo añadido y el que reemplaza retirado (§8)
- [x] Cero tablas nuevas
- [x] Cero vistas materializadas, con el umbral escrito (§26, §33)
- [x] Pantalla `/reportes` con rango, atajos y filtro de sede
- [x] Gateada por el módulo `reports` y por `reports.view`
- [x] Unit tests PASS
- [x] Database tests PASS (aislamiento cross-tenant incluido)
- [x] Lint / Typecheck / Build PASS
- [x] SPEC actualizado
- [x] ADR-027 escrito
- [x] `docs/architecture/` actualizado

---

## 23. Implementation notes

### La zona horaria no es un detalle de presentación

`placed_at` es `timestamptz` y se guarda en UTC, como manda §40. Agrupar por
`date_trunc('day', placed_at)` habría dado un reporte correcto **en UTC**, y
por tanto falso para el negocio: en Lima (UTC-5) las ventas de las 19:00 a las
23:59 caen al día siguiente, y la hora punta de un restaurante aparecería de
madrugada.

Las tres funciones temporales convierten primero:

```sql
(o.placed_at at time zone v_timezone)::date
extract(hour from o.placed_at at time zone v_timezone)
```

`v_timezone` sale de `tenant_settings.timezone` (Fase 06), con `America/Lima`
de reserva — el mismo default que aquella fase eligió. TEST-2317 y TEST-2318
insertan un pedido a las 02:00 UTC y comprueban que el reporte lo pone el día
anterior a las 21:00, que es cuando ocurrió.

### Por qué el reporte por hora devuelve 24 filas siempre

Un `group by` sobre las ventas devuelve sólo las horas que vendieron, y una
tabla con siete filas salteadas no se lee como un perfil de día. Un
`generate_series(0, 23)` con `left join` devuelve las 24, con cero donde no
hubo nada — que es la información que el lector busca ("¿a qué hora no vendo?"
es tan útil como la contraria).

### `sum(bigint)` devuelve `numeric`, y eso redondeaba el ticket promedio

La primera versión calculaba el promedio así:

```sql
(coalesce(sum(o.total_cents), 0) / count(*))::bigint
```

y daba **1334** donde debía dar 1333. La causa: en PostgreSQL `sum(bigint)`
devuelve `numeric`, así que la división era exacta (1333.67) y el `::bigint`
del final **redondeaba**. Un negocio habría visto un céntimo que nunca cobró,
en cada ticket promedio con resto.

La corrección es mover el cast delante de la división, para que sea
`bigint / bigint` y trunque:

```sql
(coalesce(sum(o.total_cents), 0)::bigint / count(*)::bigint)
```

Lo encontró un test que esperaba 1333 sobre 4001 entre 3. Es exactamente el
tipo de error que ADR-015 existe para evitar, apareciendo en el sitio donde
ADR-015 no había mirado todavía: un promedio.

### Un producto ya vendido no se puede borrar (hallazgo de fases anteriores)

TEST-2324 iba a comprobar que un producto **borrado** seguía apareciendo por
su `name_snapshot`. Resultó imposible: `order_items.product_id` es
`ON DELETE SET NULL`, y ese UPDATE dispara la guarda de la Fase 13 que se
niega a tocar las líneas de un pedido que dejó `pending`.

Así que borrar un producto que se vendió alguna vez falla con
_"An order that is no longer pending cannot change its lines"_ — un mensaje
desconcertante para quien sólo quería limpiar su carta.

**Es una interacción preexistente entre las Fases 11 y 13, no algo que esta
fase introduzca, y no se tocó**: arreglarla es cambiar el comportamiento de
un módulo que no es el de esta fase, y §51 prohíbe justamente eso. El
resultado es correcto de fondo — el histórico no pierde su producto — y lo
que está mal es el mensaje. Queda anotado aquí para quien haga la Fase 25.

El test se reescribió sobre el caso que **sí** es alcanzable y que es para lo
que el snapshot realmente sirve: **renombrar**. Un producto que hoy se llama
"Maki Acevichado" sale en el reporte de marzo como "Maki", que es lo que
decían los tickets de marzo.

### Lo que se verificó y lo que no

```text
Verificado con PGlite (PostgreSQL real, migraciones reales, politicas
reales), incluido el manejo de zonas horarias con nombre - que era la duda
razonable, porque exige la base de datos de zonas y no todos los builds
la traen. La trae.

NO verificado: el comportamiento con volumen de produccion. Los tests
usan decenas de pedidos, no cientos de miles. Es deliberado y es lo que la
seccion 19 dice: medir es la Fase 26, y hasta entonces el umbral de la
matview es una hipotesis escrita, no un resultado.
```

---

## 24. Known limitations

```text
KL-2301  El reporte no esta medido con volumen real. Los indices responden
         al patron de consulta y la aritmetica esta probada, pero nadie ha
         ejecutado esto contra 500.000 pedidos. Dueno: Fase 26, que es la
         fase de medir, con el umbral de la seccion 19 como entrada.

KL-2302  Solo cuenta pedidos `completed`. Un negocio que deja pedidos en
         `ready` toda la tarde vera su venta subir de golpe al cerrarlos.
         Es deliberado (ADR-027 decision 3) y la pantalla lo dice, pero es
         una sorpresa la primera vez. Dueno: ninguno; es la conducta
         correcta.

KL-2303  El rango se acota a 366 dias. Un rango de diez anos seria una
         consulta cara pedida desde la barra de direcciones, y el limite es
         mas barato que descubrirlo en produccion. Un negocio que necesite
         comparar cinco anos pide cinco rangos. Dueno: Fase 26 si se mide
         que el limite molesta.

KL-2304  No hay graficos: ocho tablas de numeros. Una libreria de charts es
         una dependencia nueva para un problema estetico, y §47 pide un
         problema medido antes de anadir peso. Dueno: cuando se pida.

KL-2305  No se puede exportar. Hacerlo bien exige streaming para no cargar
         un ano de pedidos en memoria, y §33 no lo pide. Dueno: cuando se
         pida.

KL-2306  Solo hay reportes de VENTA. Inventario (Fase 18), fidelizacion
         (Fase 20) y cobranza SaaS (Fase 22) tienen los datos listos y
         ninguna dimension pedida por §33. Dueno: cuando se pidan.

KL-2308  Borrar un producto que ya se vendio falla con un mensaje que habla
         de pedidos, no de productos: "An order that is no longer pending
         cannot change its lines". Es una interaccion preexistente entre las
         Fases 11 y 13 que esta fase descubrio al escribir TEST-2324, no
         algo que introduzca. El comportamiento de fondo es correcto (el
         historico conserva su producto); lo que falta es un mensaje que lo
         explique. Dueno: Fase 25, con el resto de la revision.

KL-2307  El reporte de medios de pago agrupa por fecha del PEDIDO, no del
         pago. Es lo que hace que cuadre con el resumen, y significa que un
         pedido de ayer cobrado hoy cuenta en ayer. Para conciliar caja
         -que es otra pregunta- la Fase 14 ya tiene sus propias pantallas.
         Dueno: ninguno; es la eleccion correcta para esta pregunta.
```

---

## 25. Future considerations

```text
Fase 24 (Audit)          `reports.viewed` es un evento de lectura y esa
                         fase decidira si un acceso a datos sensibles
                         merece audit log ademas de log.
Fase 26 (Performance)    la entrada esta escrita: el umbral de la seccion
                         19 y KL-2301. Esa fase mide y decide si toca una
                         matview.
Comparativas             "vs el periodo anterior" es una segunda llamada a
                         las mismas funciones con otro rango; el esquema no
                         cambia.
Reportes de otros modulos cada fase dejo sus datos agregables; anadir una
                         dimension es una funcion mas, sin tocar nada.
Export                   cuando se pida, se hace con streaming sobre las
                         mismas funciones.
```
