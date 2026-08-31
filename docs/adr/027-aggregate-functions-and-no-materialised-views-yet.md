# ADR-027 — Agregación en funciones SQL con puerta de permiso; ninguna vista materializada todavía

```text
Status: ACCEPTED
Date:   2026-08-30
Phase:  23 — Reports + Analytics
```

## Context

Master section 33 (Fase 23) pide ocho dimensiones y añade dos instrucciones que
tiran en direcciones opuestas:

> Evitar consultas extremadamente costosas en cada request.
> Analizar: SQL views; materialized views; aggregations; caching; **solo cuando
> datos reales lo justifiquen**.

Y section 26 lo cierra: _"Medir antes de optimizar"_.

Es una tensión deliberada: haz que sea rápido, y no montes maquinaria para
hacerlo rápido antes de saber que es lento. Las decisiones que hay que tomar:

1. **Dónde vive la agregación** — en SQL, o trayendo filas a la aplicación.
2. **Vista materializada, vista, o función** — y cuándo cambiar de opinión.
3. **Qué cuenta como una venta**, que master no dice.
4. **Cómo se autoriza un reporte** que cruza cinco tablas con cinco permisos
   distintos.
5. **En qué zona horaria se agrupa el tiempo.**

La 5 parece un detalle y no lo es: decide si el reporte es verdadero.

## Decision

### 1. La agregación vive en SQL, en funciones con parámetros

Siete funciones, una por dimensión (las ocho de master salen de siete porque
ventas y ticket promedio comparten el resumen):

```sql
report_sales_summary(tenant, from, to, location?)
report_sales_by_day(tenant, from, to, location?)
report_sales_by_hour(tenant, from, to, location?)
report_sales_by_location(tenant, from, to)
report_top_products(tenant, from, to, location?, limit)
report_top_customers(tenant, from, to, limit)
report_sales_by_payment_method(tenant, from, to)
```

**En SQL y no en la aplicación**, porque la alternativa es traer los pedidos de
un mes a Node y sumarlos ahí — que es exactamente la "consulta extremadamente
costosa en cada request" contra la que advierte master, sólo que el coste se
paga en ancho de banda y memoria en vez de en CPU de base de datos.

**Funciones y no vistas**, porque una vista no toma parámetros y todo reporte
lleva un rango de fechas. Una vista sin rango obligaría a filtrar después de
materializar el conjunto entero, que es lo contrario de lo que se busca.

### 2. Ninguna vista materializada, y un umbral escrito para cuándo

Ésta es la decisión que master pide explícitamente, y la respuesta es **no**.

Una vista materializada aquí costaría:

- un refresco programado, que exige el **scheduler que sigue sin existir** —
  la misma infraestructura que ADR-026 declinó montar y que section 47 dice que
  no se decide por adelantado;
- números viejos: un reporte de ventas que se refresca cada hora miente sobre
  la última hora, que es justo la que un dueño mira a media tarde;
- una tabla física más que mantener, invalidar y respaldar.

A cambio de una latencia que **nadie ha medido como problema**, sobre datos que
todavía no existen.

Lo que sí se hizo es lo barato y reversible: un índice que responde al patrón
literal de estas consultas.

```sql
create index orders_tenant_status_placed_idx
  on public.orders (tenant_id, status, placed_at desc);

drop index public.orders_tenant_status_idx;
```

El `drop` es parte de la misma decisión y de la misma sección 8: el índice
nuevo es superconjunto por prefijo del viejo, así que sirve para todo lo que
aquél servía, y mantener los dos es peso en cada `INSERT` de pedido. _"Evitar
sobreindexar"_ está en el mismo párrafo que _"toda consulta importante deberá
analizar índices"_.

**El umbral, escrito para que la Fase 26 no tenga que inventarlo.** Se
considerará una vista materializada cuando, con datos de producción,
`report_sales_by_day` sobre 90 días tarde más de 500 ms, o un tenant supere
~500.000 pedidos completados — lo que ocurra antes. Hasta entonces esto es una
hipótesis, no un problema, y la Fase 26 es literalmente la fase de medirlo.

**Caché entre requests: tampoco.** Un reporte cacheado es un reporte que miente
sobre la hora a la que se miró. Se usa `cache` de React, que sólo evita repetir
la misma consulta dentro de un mismo render.

### 3. Una venta es un pedido `completed`, y nada más

`orders` tiene seis estados y sólo uno significa "esto se vendió". La tentación
era contar todo lo no anulado, porque así "las ventas de hoy" incluyen lo que
se está preparando y el número se parece más a lo que el dueño espera ver.

Se descartó por **coherencia con el resto del producto**: desde ADR-022 el
stock se descuenta al llegar a `completed`, y desde ADR-024 los puntos se
acreditan ahí. Si un reporte contara `ready`, la venta del reporte y el consumo
de inventario hablarían de conjuntos distintos de pedidos y no habría forma de
cuadrarlos.

Y porque es lo único demostrable: un pedido en `preparing` todavía puede
acabar anulado.

La consecuencia incómoda —un negocio que deja pedidos en `ready` toda la tarde
ve su venta subir de golpe al cerrarlos— se acepta y **se dice en la pantalla**,
en una línea visible y no en un pie de página. Un número que el lector
interpreta mal es peor que ningún número.

### 4. `SECURITY DEFINER` con una puerta explícita en `reports.view`

Un reporte cruza `orders`, `order_items`, `payments`, `customers` y
`locations`. Con `SECURITY INVOKER`, RLS exigiría que el llamante tuviera
`orders.view` **y** `products.view` **y** `payments.view` **y**
`customers.view` a la vez — y entonces `reports.view` no gobernaría nada:
sería un permiso decorativo junto a otros cuatro que hacen el trabajo.

Así que las siete son `SECURITY DEFINER` y su primera línea es la puerta:

```sql
if not public.has_permission(p_tenant_id, 'reports.view') then
  return;
end if;
```

Un permiso significa exactamente lo que dice. Es el patrón que
`get_tenant_members` (Fase 03) estableció y `get_tenant_couriers` (Fase 19)
repitió, por la misma razón: exponer justo lo que una pantalla necesita en vez
de abrir cinco tablas.

**El precio es que la puerta es la única defensa**, porque `DEFINER` no pasa
por RLS. Por eso está probada desde los dos lados: quien no tiene el permiso no
obtiene filas (TEST-2320), y quien lo tiene en **otro** tenant tampoco
(TEST-2321). Y cada función filtra además por `tenant_id` explícitamente:
defensa en profundidad, la misma postura de todos los módulos desde la Fase 11.

Ningún permiso nuevo. `reports.view` existe desde la Fase 03 y esta fase es la
primera que lo usa para algo — que es lo que aquella fase estaba previendo.

### 5. El tiempo se agrupa en la zona horaria del negocio

`placed_at` es `timestamptz` guardado en UTC, como manda section 40. Agrupar
por `date_trunc('day', placed_at)` habría dado un reporte correcto **en UTC** y
por tanto **falso** para el negocio: en Lima (UTC−5) las ventas de 19:00 a
23:59 caen al día siguiente, y la hora punta de un restaurante aparecería de
madrugada.

```sql
(o.placed_at at time zone v_timezone)::date
extract(hour from o.placed_at at time zone v_timezone)
```

`v_timezone` sale de `tenant_settings.timezone` (Fase 06), con `America/Lima`
de reserva — el mismo default que aquella fase eligió. Section 40 lo dice
entero: _"Guardar timestamps en UTC... Mostrar según timezone del tenant. No
dispersar conversiones manuales por la aplicación."_ Aquí la conversión ocurre
en un sitio, dentro de la agregación, y no se dispersa.

**El reporte por hora devuelve las 24 horas siempre**, con cero donde no hubo
ventas: un `group by` devuelve sólo las horas que vendieron, y una tabla de
siete filas salteadas no se lee como un perfil de día. "¿A qué hora no vendo?"
es tan útil como la pregunta contraria.

### 6. Cero tablas, y cero Server Actions

Esta fase no crea ninguna tabla y no tiene ninguna Server Action. No es una
omisión: es la señal de que efectivamente no muta nada. Un reporte lee lo que
otras veintidós fases escribieron, y añadir una tabla para guardar el resultado
sería exactamente la vista materializada que la decisión 2 declinó.

## Alternatives considered

**Agregar en la aplicación.** Traer los pedidos del rango y sumarlos en Node.
Simple de escribir, y es literalmente la consulta cara por request contra la
que advierte master — sólo que pagada en memoria. Descartada.

**Vistas materializadas desde el principio.** Rápidas, y exigen un scheduler
que no existe, devuelven datos viejos, y optimizan un problema que nadie ha
medido. Descartada, con un umbral escrito de cuándo reconsiderarlo.

**Vistas normales (no materializadas).** No toman parámetros, así que el rango
tendría que filtrarse después. Descartadas a favor de funciones.

**`SECURITY INVOKER` y confiar en RLS.** Más conservador en apariencia y deja
`reports.view` sin gobernar nada, porque el acceso real lo decidirían otros
cuatro permisos. Descartada; la puerta explícita es más honesta y está probada.

**Contar todo lo no anulado como venta.** Números más grandes y más parecidos a
la intuición a media tarde, y un reporte que no cuadra con el inventario ni con
los puntos. Descartada.

**Agrupar en UTC.** Un reporte técnicamente correcto y comercialmente falso.
Descartada sin dudarlo.

**Caché de 5 minutos entre requests.** Barata y hace que el reporte mienta
sobre la última venta. Descartada.

## Consequences

**Positivas**

- Las ocho dimensiones cuestan siete consultas agregadas, lanzadas en paralelo;
  nada se suma en JavaScript.
- Un solo permiso, `reports.view`, gobierna el acceso entero — y por primera
  vez desde la Fase 03 significa algo.
- Los reportes temporales son verdaderos para el negocio, no para UTC.
- La fase no añade ninguna tabla ni ninguna escritura: la superficie de ataque
  y la de mantenimiento no crecen.
- El índice quedó más limpio que antes: uno nuevo, uno retirado.
- La Fase 26 hereda un umbral escrito en vez de una discusión abierta.

**Negativas, aceptadas**

- Nada está medido con volumen de producción (KL-2301).
- Un negocio que tarda en cerrar pedidos ve la venta a saltos (KL-2302).
- El rango se acota a 366 días (KL-2303).
- Sin gráficos y sin exportar (KL-2304, KL-2305).
- `SECURITY DEFINER` significa que la puerta es la única defensa; se acepta a
  cambio de que el permiso signifique lo que dice, y se prueba por eso.

**Neutras**

- Una migración, siete funciones, un índice creado y uno retirado.
- Ningún permiso nuevo, por tercera fase consecutiva.
