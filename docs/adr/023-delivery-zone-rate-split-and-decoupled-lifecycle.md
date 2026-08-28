# ADR-023 — Zona y tarifa como tablas separadas; ciclo de vida de la entrega desacoplado del pedido

```text
Status: ACCEPTED
Date:   2026-08-28
Phase:  19 — Delivery
```

## Context

Master section 33 (Phase 19) es una de las entradas más cortas del documento
maestro:

> Crear: `delivery_zones`, `delivery_rates`, `order_deliveries`.
> Funciones: zonas; costos; dirección; coordenadas; repartidor; estados.
> No acoplar inicialmente a un proveedor específico.

Tres tablas nombradas, seis capacidades enumeradas, y una prohibición
explícita. Lo que no dice —y hay que decidir— es:

1. **Por qué son dos tablas** y no una zona con una columna de precio.
2. **Qué es una zona**: ¿un nombre, o una geometría?
3. **De dónde sale el dinero del envío** y quién lo escribe, dado que
   `orders.shipping_cents` existe desde la Fase 13 y lleva seis fases valiendo
   cero.
4. **Cómo se relacionan los dos ciclos de vida**: el del pedido
   (`pending → … → completed`, Fase 13) y el de la entrega.
5. **Cuáles son los estados** de una entrega, que master pide ("estados") sin
   enumerar — a diferencia de la Fase 13, donde sí los lista.

La decisión 4 es la que tiene consecuencias más allá de esta fase, porque
desde la Fase 18 `orders.status = 'completed'` dispara el consumo de stock
(ADR-022). Cualquier acoplamiento entre "entregado" y "completado" mueve
inventario como efecto lateral.

## Decision

### 1. `delivery_rates` existe porque una tarifa depende del par (zona, sede)

Una zona con un solo precio no necesita una segunda tabla: sería una columna.
Que master pida dos tablas significa que una zona tiene varias tarifas, y hubo
que elegir el eje.

Se eligió **la sede**:

```sql
create table public.delivery_rates (
  zone_id     uuid not null references public.delivery_zones (id) on delete cascade,
  location_id uuid          references public.locations (id)      on delete cascade,
  fee_cents   bigint not null,
  ...
);

-- Una tarifa por sede, y una sola tarifa por defecto.
create unique index delivery_rates_zone_location_key
  on public.delivery_rates (zone_id, location_id) where location_id is not null;
create unique index delivery_rates_zone_default_key
  on public.delivery_rates (zone_id) where location_id is null;
```

Tres razones, en orden de peso:

- **La multi-sede es un invariante documentado de este proyecto**, no una
  hipótesis. ADR-014 decidió que `locations` existiera antes que cualquier
  módulo operativo precisamente para que ningún hecho operativo tuviera que
  adivinar su sede después. Un costo de reparto es un hecho operativo: llegar
  a Miraflores desde la sede de Miraflores no cuesta lo que llegar desde San
  Isidro.
- **El dato para resolverla ya está.** `orders.location_id` es `NOT NULL`
  desde la Fase 13, así que la tarifa aplicable se resuelve sin preguntar
  nada al usuario.
- **`location_id` nullable convierte la tabla en "defecto + excepciones".**
  Un negocio de una sede escribe una fila por zona y no ve nunca la palabra
  "sede"; uno de cinco sedes sobreescribe sólo donde importa. La alternativa
  —`location_id NOT NULL`— obligaría a 5 × 10 = 50 filas para diez zonas.

El otro eje candidato, **el tramo por valor del pedido**, se resolvió sin
filas adicionales: `min_order_free_cents` es una columna _de la tarifa_,
porque "gratis desde S/ 50" no es otra tarifa sino una condición de ésta.
Modelarlo como segunda fila habría exigido un rango (`min`, `max`) y una
regla de desempate para rangos solapados — infraestructura para un caso que
nadie pidió.

### 2. Una zona es un área con nombre, no un polígono

```sql
create table public.delivery_zones (
  name      text not null,
  district  text,
  ...
);
```

No hay geometría, no hay PostGIS, y nada comprueba que la dirección escrita
caiga _de verdad_ dentro de la zona elegida: la elige quien adjunta la
entrega.

Es deliberado. Un polígono real exige la extensión PostGIS, un editor de mapas
en el dashboard y un geocoder que convierta "Av. Larco 123" en un punto antes
de poder preguntar si cae dentro. Eso es exactamente la infraestructura
costosa contra la que advierte master section 47 ("debe existir un problema
medido que lo justifique"), y ninguna de las seis capacidades que pide section
33 la necesita: "zonas" y "coordenadas" son cosas distintas, y las coordenadas
sí se guardan.

Además es como opera de hecho un negocio peruano de delivery: la carta dice
"repartimos a Miraflores, Barranco y Surco" con un precio por distrito, no un
polígono. Modelar la zona como el distrito es modelar el dominio real, no una
versión empobrecida de uno mejor.

Queda registrado como KL-1901 con dueño explícito: cuando exista una necesidad
medida.

### 3. El costo se copia a la entrega, y de ahí lo escribe un trigger al pedido

```text
delivery_rates.fee_cents
      │  la aplicacion resuelve y COPIA al adjuntar
      ▼
order_deliveries.fee_cents
      │  trigger sync_order_shipping()
      ▼
orders.shipping_cents  ──►  orders.total_cents = Σ order_items + shipping
```

Dos decisiones separadas dentro de una:

**El `fee_cents` de la entrega es una copia.** Mismo razonamiento que ADR-017
aplicó a `order_items.unit_price_cents`: subir el precio del envío mañana no
puede cambiar lo que se cobró ayer. Una referencia viva a `delivery_rates`
reescribiría totales históricos cada vez que alguien ajusta un precio.

**La copia la hace la aplicación, no un trigger** — y ésta es la única
desviación consciente respecto del patrón de esta fase, donde todo lo demás
lo deriva la base. La razón: _cuál_ tarifa aplica depende de dos entradas (la
sede del pedido, y el subtotal frente a `min_order_free_cents`), y eso es una
regla de negocio con alternativas. Enterrarla en un trigger la escondería
justo donde nadie la busca al preguntarse por qué un envío salió gratis. El
trigger sí valida lo que la aplicación no puede garantizar: que la zona
pertenezca al mismo negocio que el pedido.

**El total lo recalcula la base, siempre.** El comentario de
`recompute_order_totals()` (Fase 13) ya explicaba por qué: "the application is
not the only writer — Phase 15 brings a POS and Phase 19 a courier — and two
writers each computing a total independently is two totals that will
eventually differ by a cent nobody can explain". Esta fase es el escritor que
aquel comentario anticipaba, y se comporta como se le pidió: escribe
`fee_cents` en su propia tabla y deja que el trigger recalcule.

**El costo se congela cuando el pedido deja `pending`.** Es la misma regla que
`order_items` ya aplica a las líneas, y por la misma razón, agravada: desde la
Fase 14, `orders.paid_cents` se compara contra `total_cents`. Cambiar el envío
de un pedido ya cobrado dejaría un saldo que nadie pidió. El estado
operativo de la entrega (repartidor, estado, corrección de la dirección) sí se
puede cambiar después: eso no es dinero.

### 4. Los dos ciclos de vida quedan desacoplados

Entregar **no** completa el pedido. Completar el pedido **no** entrega.

```text
orders:           pending → confirmed → preparing → ready → completed
order_deliveries: pending → assigned  → in_transit → delivered
                                                   ↘ failed → assigned
```

Es la decisión con más consecuencias de la fase, y la alternativa era
tentadora: marcar "entregado" y que el pedido se cierre solo es lo que un
operador esperaría.

Se descartó por lo que ocurriría por debajo. Desde ADR-022, `orders.status =
'completed'` dispara el consumo de stock de la receta. Si la entrega
completara el pedido, marcar "entregado" en el móvil de un repartidor movería
inventario en cinco sedes como efecto lateral invisible, a través de dos
triggers encadenados y sin que nadie lo hubiera pedido. Un cambio de estado
que dispara otro cambio de estado que descuenta stock es exactamente la clase
de acoplamiento que hace imposible razonar sobre un sistema.

Hay un solo acoplamiento, y va en la dirección segura — del pedido a la
entrega, no al revés:

```sql
-- Anular el pedido anula su entrega, si no estaba ya en estado terminal.
create trigger orders_cancel_delivery
  after update of status on public.orders
  for each row execute function public.cancel_delivery_with_order();
```

Va en esa dirección porque es la que no tiene efectos laterales sorpresa:
anular una entrega no mueve dinero ni stock, y lo contrario —un repartidor
saliendo a entregar un pedido anulado— sí es un fallo operativo real. Una
entrega ya `delivered` no se toca: el hecho ocurrió.

### 5. Los estados son datos, y `failed` no es terminal

Master pide "estados" sin enumerarlos. Se eligieron seis, en una tabla y no
en un `CASE`:

```sql
create table public.delivery_transitions (
  from_status public.delivery_status not null,
  to_status   public.delivery_status not null,
  primary key (from_status, to_status)
);
```

El patrón no es nuevo: es literalmente el de `order_transitions` (Fase 13,
ADR-017 §4) y `billing_document_transitions` (Fase 17), por las tres razones
que aquel ADR ya dio — la tabla se puede _leer_ (el dashboard decide qué
botones dibujar contra las mismas filas que el trigger aplica, así que no
puede existir un botón que el backend rechace), se puede _testear_ como dato
contra su mirror en TypeScript, y añadir una transición es un `INSERT` en una
migración revisable en vez de una edición dentro de un procedimiento.

Es también la cuarta tabla de una fase que nombra tres, igual que la Fase 13
creó cuatro donde master nombraba tres. Un `delivery_transitions` sin
`tenant_id` no es una tabla de negocio: es el ciclo de vida del producto.

**`failed` es recuperable, no terminal.** `failed → assigned` está declarado.
Un intento fallido —nadie en casa, dirección equivocada— es normal, y el
segundo intento es la misma entrega, del mismo pedido, a la misma dirección.
Como `order_deliveries` tiene `UNIQUE(order_id)`, tratar el reintento como
fila nueva obligaría a levantar esa restricción, y entonces "¿cuál es la
entrega de este pedido?" dejaría de tener respuesta única. Con una sola fila y
un historial, la pregunta sigue teniendo respuesta y los dos intentos quedan
registrados.

`delivered` y `cancelled` sí son terminales, y —como en la Fase 13— eso se
declara por **ausencia**: no aparecen nunca en la columna `from_status`.

### 6. Ningún proveedor externo, y el hueco donde entrará

Master lo prohíbe explícitamente para esta fase ("No acoplar inicialmente a un
proveedor específico"), así que no hay adapter, no hay cliente HTTP y no hay
variable de entorno nueva.

El precedente de cómo entrará ya está escrito: ADR-021 declinó implementar un
`BillingProvider` real y dejó la interfaz definida. Cuando exista una
integración de reparto, `order_deliveries` gana `provider_reference` y
`provider_status` —las dos columnas que cualquier proveedor necesita— y el
dominio no cambia de forma. Se registra en la sección "Planned" del índice de
ADR, no como deuda de esta fase.

## Alternatives considered

**Una sola tabla `delivery_zones` con `fee_cents`.** Contradice a master, que
nombra dos tablas, y pierde el caso multi-sede que ADR-014 estableció como
invariante del proyecto. Descartada.

**`delivery_rates.location_id NOT NULL`.** Más simple de consultar (sin
resolución "sede o defecto"), pero obliga a N × M filas y hace que un negocio
de una sola sede tenga que entender el concepto. Descartada por coste de uso.

**Zonas como polígonos con PostGIS.** Más correcto en abstracto y
verificable automáticamente ("¿esta dirección cae en esta zona?"). Exige una
extensión, un editor de mapas y un geocoder externo. Master section 47 pide un
problema medido antes de infraestructura así. Descartada, registrada como
KL-1901.

**Entregar completa el pedido.** Lo que un operador esperaría, y lo que casi
se implementó. Descartada por el encadenamiento con ADR-022: dispararía
consumo de stock desde el móvil de un repartidor, a través de dos triggers,
invisible. La ergonomía se resuelve en la UI (el tablero enlaza al pedido),
no en el esquema.

**`failed` terminal, reintento como fila nueva.** Obligaría a levantar
`UNIQUE(order_id)` y a introducir un "número de intento", con lo que "la
entrega de este pedido" pasaría a ser una consulta con `order by attempt desc
limit 1`. Descartada: más complejidad para el mismo hecho.

**Estados en un `CASE` dentro del trigger.** Es lo que este proyecto ya
rechazó dos veces (ADR-017, Fase 17). Descartada por consistencia y por las
razones originales, que siguen siendo válidas.

**RLS que limite a un repartidor a sus propias entregas.** Deseable en
abstracto, pero exige comparar el rol dentro de una política, que ADR-010
prohíbe explícitamente ("nada en la aplicación compara un rol; pide un
permiso"). La Fase 16 ya aceptó la misma postura para `kitchen`, que puede
avanzar cualquier pedido. Registrada como KL-1902 con dueño Fase 25.

## Consequences

**Positivas**

- `orders.shipping_cents` deja de ser una columna muerta seis fases después
  de crearse, y lo hace exactamente como su propio comentario anticipaba.
- Un negocio de una sede configura una tarifa por zona y nunca ve la palabra
  "sede"; uno de cinco la sobreescribe sólo donde el costo difiere.
- La dirección de entrega es una copia, así que el histórico de reparto
  sobrevive a que el cliente borre su dirección o el negocio borre la zona.
- Los dos ciclos de vida se pueden razonar por separado. Nada de lo que haga
  un repartidor mueve inventario.
- El tablero no puede dibujar un botón que el backend rechace: lee las mismas
  filas que el trigger aplica.

**Negativas, aceptadas**

- Elegir la zona es responsabilidad de quien adjunta la entrega; el sistema no
  la verifica contra la dirección (KL-1901).
- El envío gratis se evalúa al adjuntar; añadir líneas después no lo
  recalcula solo (KL-1903).
- Cualquier `deliveries.manage` puede mover cualquier entrega (KL-1902).
- Entregar y completar son dos acciones. Un operador hará dos clics donde
  esperaba uno; es el precio de que ninguno de los dos tenga efectos
  laterales.

**Neutras**

- Cuatro tablas nuevas y dos columnas añadidas a `customer_addresses`. La
  extensión sólo añade columnas anulables: toda fila existente las satisface.
- Cuatro permisos nuevos. Como desde la Fase 03, `owner` y `admin` no los
  heredan automáticamente: se otorgan explícitamente en la migración.
