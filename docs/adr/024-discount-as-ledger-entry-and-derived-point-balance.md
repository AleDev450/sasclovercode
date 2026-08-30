# ADR-024 — El descuento es un asiento; el saldo de puntos es una columna derivada

```text
Status: ACCEPTED
Date:   2026-08-30
Phase:  20 — Loyalty + Promotions
```

## Context

Master section 33 (Fase 20) nombra cuatro tablas y da una sola regla de diseño,
pero la da dos veces:

> Los puntos deben utilizar ledger.
> No almacenar únicamente: `points = 500` sin historial.
> Registrar: `+100 order`, `-50 reward`, `+20 campaign`.

Las decisiones que hay que tomar y que master no toma:

1. **Dónde vive el descuento de un pedido**, dado que `orders.discount_cents`
   ya existe desde la Fase 13 y es la suma de los descuentos de **línea**,
   recalculada por `recompute_order_totals()` en cada cambio.
2. **Si el saldo de puntos se almacena o se deriva**, y cómo se reconcilia eso
   con ADR-022, que para el stock decidió justo lo contrario.
3. **Cuándo se acreditan los puntos**, que master tampoco dice.
4. **Cómo se canjean sin que el saldo y el descuento puedan discrepar.**
5. **Qué es una promoción**: ¿un descuento con condiciones, o un motor de
   reglas?

La decisión 1 es la de mayor alcance, porque `total_cents` ya se calcula en dos
funciones distintas desde la Fase 19 y esta fase añade un tercer escritor.

## Decision

### 1. Un descuento de pedido es una fila en `order_promotions`, no un número

```sql
create table public.order_promotions (
  order_id       uuid   not null references public.orders (id) on delete cascade,
  promotion_id   uuid            references public.promotions (id) on delete set null,
  coupon_id      uuid            references public.coupons (id)    on delete set null,
  source         text   not null,          -- promotion | coupon | loyalty
  label_snapshot text   not null,
  discount_cents bigint not null,
  ...
);
```

`orders.promotion_discount_cents` es la **suma** de esas filas, mantenida por
trigger. La columna nunca se escribe a mano.

Escribir el descuento directamente en `orders.discount_cents` era imposible sin
romper algo: esa columna la recalcula `recompute_order_totals()` desde
`order_items` en cada cambio de línea, así que el descuento de la promoción
habría desaparecido en la siguiente edición del pedido. Repartirlo entre las
líneas era la otra salida obvia y es peor: obliga a repartir céntimos con una
regla de redondeo que nunca cuadra exactamente, y además **miente** — deja
escrito que el maki costó S/ 21.60 cuando costó S/ 24.00 y hubo un 10% sobre
el pedido.

Pero la razón de fondo es la que master ya da para los puntos, aplicada al
dinero. "No almacenar únicamente un número sin historial" vale igual para un
descuento: `discount = 1200` sin decir de qué promoción, de qué cupón o de qué
canje vino es exactamente el número que nadie puede auditar tres meses
después, y el que hace imposible responder "¿cuánto nos costó la campaña de
mayo?". Un asiento por descuento responde las dos preguntas y hace que
`times_redeemed` sea un hecho contable en vez de un contador que alguien
recuerda incrementar.

`label_snapshot` sigue el patrón de ADR-017 y ADR-023: borrar la promoción
mañana no puede cambiar qué decía el ticket de ayer.

### 2. El saldo de puntos ES una columna, y el stock NO lo es

ADR-022 decidió, para la Fase 18, que el stock fuese una `VIEW` sobre
`stock_movements` y nunca una columna. Esta fase decide lo contrario:
`loyalty_accounts.points_balance` es una columna `integer` mantenida por
trigger desde `loyalty_transactions`.

No es una incoherencia, y la diferencia es exactamente la que ADR-022 usó como
argumento sin nombrarla:

> un stock es inherentemente un hecho sobre un par **(inventory_item,
> location)** — no un hecho sobre `inventory_items` solo

Un saldo de puntos **sí** es un hecho sobre una sola fila: la cuenta. Tiene
dónde vivir. Guardarlo no exige inventar una tabla ni un conjunto de columnas
por sede, que era el problema real que empujó al stock hacia la vista.

Y master lo permite explícitamente. La prohibición es literal y limitada:

> No almacenar **únicamente**: `points = 500` sin historial.

La palabra que decide es _únicamente_. Lo prohibido es el saldo **sin** ledger,
no el saldo **con** ledger. Aquí el ledger es la fuente de verdad —
append-only, sin política de `UPDATE` ni de `DELETE`, jamás — y la columna es
una caché que el trigger mantiene.

Lo que hace que la caché no pueda mentir no es la confianza, son tres cosas:

- el ledger no admite `UPDATE` ni `DELETE`, así que no hay forma de cambiar el
  pasado sin un asiento nuevo;
- el saldo sólo lo escribe el trigger, nunca la aplicación;
- **TEST-2030** recalcula el saldo desde cero sumando el ledger y lo compara
  contra la columna, para cada cuenta, después de una secuencia de altas y
  canjes.

El motivo para pagar ese precio en vez de usar una vista es de lectura: el
saldo se consulta en cada cobro, en el POS, mientras hay alguien esperando en
el mostrador. Un cliente con tres años de historial no puede costar más de
leer que uno nuevo, y una vista `sum()` sobre su ledger hace exactamente eso.

### 3. Los puntos se acreditan al completar el pedido

```sql
create trigger orders_earn_loyalty_points
  after update of status on public.orders
  for each row
  when (new.status = 'completed' and old.status is distinct from 'completed')
  execute function public.earn_loyalty_points_on_completion();
```

Es el mismo enganche, el mismo estado y la misma razón que ADR-022 decisión 3
eligió para el consumo de stock: `completed` es el único estado del que
`order_transitions` (Fase 13) no declara ninguna salida, así que una anulación
en cualquier punto anterior nunca llegó a acreditar nada — por construcción, no
por una comprobación adicional. No hay puntos que revertir porque no llegaron a
existir.

La idempotencia es estructural, no defensiva:

```sql
create unique index loyalty_transactions_earn_per_order
  on public.loyalty_transactions (order_id) where type = 'earn';
```

Un reintento del trigger viola el índice en vez de acreditar dos veces (§37).

### 4. Canjear es una RPC, porque son dos escrituras que no pueden separarse

Canjear puntos escribe un asiento negativo en el ledger **y** una fila de
descuento en `order_promotions`. Si una de las dos ocurre sin la otra, el
negocio regala dinero o el cliente pierde puntos.

Dos escrituras desde la aplicación no son atómicas: PostgREST las manda como
peticiones separadas. Así que van en una función:

```sql
create function public.redeem_loyalty_points(p_order_id uuid, p_account_id uuid, p_points integer)
```

Una transacción, una comprobación de saldo, dos inserciones o ninguna. Es el
mismo recurso que la Fase 17 usó para `set_billing_credentials()` cuando una
operación no podía partirse, y el que ADR-019 estableció para el POS.

Es también la única operación de esta fase que necesita una RPC: aplicar un
cupón es **una** inserción, y todo lo demás —el descuento del pedido, el total,
los contadores de canje— lo hacen triggers colgando de ella.

### 5. Una promoción es un descuento con condiciones, no un motor de reglas

`promotions` tiene tres tipos (`percentage`, `fixed_amount`, `free_delivery`),
un pedido mínimo, una vigencia y un tope. No tiene "compra 2 y llévate 3", ni
combos, ni condiciones sobre productos concretos, ni exclusiones mutuas entre
promociones.

Master pide `promotions` y `coupons`. Un motor de reglas —con su lenguaje de
condiciones, su orden de evaluación y su resolución de conflictos— es un
subsistema entero que nadie pidió, y es exactamente la complejidad que section
47 manda no añadir sin un problema medido. Los tres tipos cubren lo que un
negocio peruano pone en la carta y en el volante.

**Quién decide el importe.** Como en ADR-023 decisión 3, el cálculo del
descuento vive en la aplicación (`discountFor()`, TypeScript, testeado) y no en
un trigger: depende del tipo, del subtotal y del envío, y es una regla de
negocio que alguien va a querer leer cuando pregunte por qué un descuento salió
como salió. La base valida lo que la aplicación no puede garantizar —que la
promoción sea del mismo negocio, esté vigente, no haya agotado su tope y no
deje el total en negativo— y esas comprobaciones sí son triggers, porque el
dashboard no es el único escritor posible.

## Alternatives considered

**Escribir el descuento en `orders.discount_cents`.** Lo obvio, y roto:
`recompute_order_totals()` lo sobreescribe en el siguiente cambio de línea.
Descartada por incorrecta, no por estilo.

**Repartir el descuento entre las líneas.** Mantiene una sola columna, pero
exige una regla de redondeo que reparta céntimos y deja el precio de cada
línea diciendo algo falso. Descartada.

**`promotion_discount_cents` escrita por la aplicación.** Simple, y pierde
toda la trazabilidad: es el `points = 500` que master prohíbe, con otro
nombre. Descartada.

**Saldo de puntos como `VIEW`, por coherencia con ADR-022.** Coherente en la
forma y peor en el fondo: paga un `sum()` sobre todo el historial en cada
lectura, en la pantalla donde hay alguien esperando, para resolver un problema
—dónde vive el saldo— que aquí no existe. Descartada; la simetría con la Fase
18 no es un valor en sí mismo.

**Acreditar puntos al confirmar en vez de al completar.** Más cercano al
momento en que el cliente siente que compró, y obliga a revertir el asiento si
el pedido se anula después — con el ledger append-only, eso significa un
segundo asiento compensatorio y un saldo que sube y baja por algo que nunca
pasó. Descartada, igual que ADR-022 la descartó para el stock.

**Canje en dos Server Actions.** Descartada: no es atómico y el modo de fallo
es dinero.

## Consequences

**Positivas**

- Todo descuento es trazable hasta su promoción, su cupón o su canje, y
  sobrevive a que se borre cualquiera de los tres.
- `times_redeemed` se deriva de hechos, no de un contador que alguien
  incrementa.
- El saldo de puntos se lee en tiempo constante en la pantalla donde importa.
- El ledger es demostrablemente la verdad: un test lo recalcula entero.
- Las tres funciones que calculan `total_cents` usan la misma expresión,
  fijada por un test que combina líneas, envío y descuento a la vez.

**Negativas, aceptadas**

- Una tabla más de las que master nombra (`order_promotions`).
- Un descuento porcentual no se recalcula si después se añaden líneas
  (KL-2002), igual que el envío gratis de la Fase 19.
- `points_balance` es dato duplicado. Se acepta a cambio de la lectura, y se
  vigila con un test que compara contra el ledger.
- Nada impide acumular varias promociones en un pedido salvo el tope del
  total (KL-2003).

**Neutras**

- Cinco tablas, dos enums, tres columnas nuevas en `tenant_settings` y una en
  `orders`. Ninguna migración destructiva.
- Cuatro permisos nuevos, otorgados explícitamente: como desde la Fase 03,
  `owner` y `admin` no heredan.
