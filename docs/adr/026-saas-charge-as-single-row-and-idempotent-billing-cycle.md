# ADR-026 — El cargo del SaaS es una fila; el ciclo es idempotente y lo dispara una persona

```text
Status: ACCEPTED
Date:   2026-08-30
Phase:  22 — CloverCode Billing
```

## Context

Master section 33 (Fase 22) pide tres tablas —una de las cuales ya existe desde
la Fase 21— y da la instrucción que gobierna la fase entera:

> Facturación del propio SaaS.
> Separar **completamente**: facturación del restaurante / suscripción que
> CloverCode cobra al restaurante.
> Crear: subscriptions, subscription_events, saas_payments.
> Preparar trials, suspensión y grace periods.

La Fase 21 dejó tres deudas explícitas —KL-2101 (nadie cobra), KL-2102 (el
periodo no avanza), KL-2103 (la prueba no vence)— y esta fase existe para
pagarlas.

Lo que hay que decidir:

1. **Si un cargo y su pago son una fila o dos**, dado que la Fase 14 fue
   explícita sobre separar Order / Payment / Invoice en el negocio del
   restaurante.
2. **Qué dispara el ciclo**, sin scheduler.
3. **Dónde viven los términos comerciales** (prueba, gracia, moneda).
4. **Quién escribe el historial**, y si alguien puede escribirlo a mano.
5. **Qué se hace sin pasarela de pago**, que no existe.

Y una restricción que atraviesa todas: la separación de §22 tiene que ser
demostrable, no una convención de nombres.

## Decision

### 1. Un cargo y su pago son UNA fila

```sql
create table public.saas_payments (
  subscription_id uuid   not null,
  period_start    timestamptz not null,
  period_end      timestamptz not null,
  amount_cents    bigint not null,
  status          public.saas_payment_status not null default 'pending',
  due_at          timestamptz not null,
  paid_at         timestamptz,
  method          text,
  reference       text,
  ...
  unique (subscription_id, period_start)
);
```

Una fila es _"lo que se cobró por este periodo, y qué pasó con ese cobro"_.

La tentación era repetir lo que la Fase 14 decidió para el restaurante —
_"Separar: Order / Payment / Invoice. No son la misma entidad"_ — y crear
`saas_invoices` junto a `saas_payments`. Se descartó porque **las formas no son
análogas**:

- Un pedido puede recibir varios pagos, y una factura puede cubrir varios
  pedidos. Ahí la separación existe porque las cardinalidades son N:M de
  verdad, y colapsarlas perdería información.
- Un periodo de suscripción produce **un** cargo, y ese cargo recibe **un**
  pago. Dos tablas serían una relación 1:1 obligatoria — la definición de una
  tabla de más.

Master además nombra `saas_payments` y no nombra ninguna tabla de facturas, lo
cual es coherente con esa lectura.

**`plan_code_snapshot` y no una FK.** El cargo dice qué plan se cobró. Borrar
el plan, renombrarlo o subirle el precio no puede reescribir lo que se facturó
en marzo — el mismo criterio de ADR-017 (precio de línea), ADR-023 (nombre de
zona) y ADR-024 (etiqueta de descuento). El precio y la moneda se copian por la
misma razón.

### 2. El ciclo es una función idempotente que hoy dispara una persona

```sql
create function public.run_subscription_billing()
returns table (subscriptions_advanced int, charges_issued int,
               marked_past_due int, suspended int, cancelled int)
```

No hay scheduler en este proyecto, y montar infraestructura de jobs para esta
fase sería exactamente lo que section 47 prohíbe decidir por adelantado. Pero
la alternativa —no automatizar nada y que un humano escriba cada cargo— dejaría
las tres KL de la Fase 21 sin pagar.

La salida es separar **la lógica** de **el disparador**: la lógica es una
función completa y probada; el disparador es hoy un botón en el Super Admin y
mañana un `cron` que llame a la misma función sin cambiarle una línea.

Lo que hace que eso sea seguro es la idempotencia, y es **estructural**:

```sql
unique (subscription_id, period_start)
```

Emitir dos veces el cargo del mismo periodo es una violación de clave, no una
deuda duplicada (section 37). El ciclo la ignora a propósito: "ya estaba
emitido" es el resultado correcto de una segunda ejecución, no un error.

**El orden de los seis pasos está fijado y no es arbitrario.** Cerrar pruebas
antes de cobrar, o se cobra a quien sigue en prueba. Cancelar antes de avanzar,
o se avanza un periodo que nadie pagará. Avanzar antes de emitir, o se emite
otra vez el cargo del periodo viejo. Emitir antes de aplicar la mora, o se
marca `past_due` a quien todavía no tiene cargo. Y `past_due` antes de
`suspended`, porque suspender parte de ahí. TEST-2219 a TEST-2225 recorren la
secuencia entera sobre una misma suscripción para que un reordenamiento futuro
rompa un test en vez de una factura.

### 3. Los términos comerciales viven en el plan

```sql
alter table public.plans
  add column trial_days smallint not null default 0,
  add column grace_days smallint not null default 7,
  add column currency   text     not null default 'PEN';
```

Cuánto dura la prueba, cuántos días de gracia hay y en qué moneda está el
precio son propiedades del **producto que se vende**, no de cada contrato. Y
están junto al precio, que es lo que hace que un cambio comercial sea una fila
y no una migración.

La moneda es la decisión menos obvia. `tenant_settings.currency` ya existe
(Fase 06) y sería el sitio equivocado: **esa** es la moneda con la que el
restaurante le cobra a su cliente. La moneda de CloverbCode cobrándole al
restaurante es otra cosa y podría ser distinta. Ponerlas juntas habría sido
mezclar los dos negocios que §22 manda separar.

`subscriptions` sólo gana `cancel_at_period_end`, porque cancelar al terminar
el periodo pagado es lo que un cliente pide de verdad y no se puede derivar de
nada.

**La gracia no se almacena.** Cuándo se suspende una suscripción es
`min(due_at de los cargos pendientes) + grace_days`: derivable con un join, y
por tanto sin posibilidad de quedar desincronizada. Es la misma disciplina que
ADR-022 y ADR-024 vienen discutiendo — sólo que aquí, a diferencia del saldo de
puntos, no hay ninguna lectura caliente que justifique guardarlo.

### 4. Nadie escribe el historial: sólo triggers

`subscription_events` es la primera tabla del proyecto **sin ninguna política
de escritura** — ni siquiera para platform admin:

```sql
-- SELECT para el tenant o el platform admin. Y nada más.
-- Sin INSERT, sin UPDATE, sin DELETE.
```

La escriben cinco triggers `SECURITY DEFINER` colgados de `subscriptions` y de
`saas_payments`, que corren como el propietario y por tanto no pasan por RLS.

La diferencia con `loyalty_transactions` (Fase 20), que sí admite `INSERT`, es
que aquel ledger recibe asientos manuales legítimos —una campaña, un ajuste— y
éste no: **cada fila aquí es la consecuencia de un cambio en otra tabla**. Una
fila que nadie puede escribir es una fila que nadie puede fabricar, y este
historial es el que responde "¿por qué está suspendido este negocio?" cuando
alguien reclama.

### 5. Sin pasarela: se registra el pago, no se cobra

No hay integración con Culqi, Izipay ni Stripe. ADR-021 ya sentó el precedente
con `BillingProvider`: **no se implementa un proveedor sin credenciales reales
contra las que probar**, porque lo que sale de ahí es código que parece
funcionar y nadie ha ejecutado nunca.

Lo que sí existe es lo que un SaaS peruano que empieza usa de verdad:
transferencia, Yape, depósito. `record_saas_payment()` toma un método y una
referencia y marca el cargo pagado — y esas dos columnas son exactamente las
que una pasarela rellenaría el día que se contrate.

`failed` y `refunded` están en el enum aunque ninguna función los produzca
todavía. Se declararon ahora porque añadir un valor a un enum después obliga a
revisar cada fila histórica para decidir qué significaba su ausencia.

**Reactivar es parte del pago.** `record_saas_payment()` no sólo marca el
cargo: si no queda ningún otro vencido, devuelve la suscripción a `active`. Es
una operación de dos escrituras que no pueden separarse —igual que el canje de
puntos de ADR-024 decisión 4— así que va en una función, en una transacción.

### 6. La separación de §22 se prueba, no se promete

```text
CloverCode ──cobra──► restaurante      saas_payments      (Fase 22)
restaurante ──cobra──► su cliente      payments           (Fase 14)
restaurante ──emite──► su cliente      billing_documents  (Fase 17)
```

Ninguna flecha cruza, y TEST-2230 lo comprueba **estructuralmente** sobre
`pg_constraint`: ninguna clave foránea de esta fase apunta a `payments`,
`payment_methods`, `billing_documents` ni `billing_document_items`, ni al
revés. No es una convención de nombres que alguien pueda romper sin darse
cuenta: es una aserción sobre el catálogo del sistema.

Los permisos también están separados: `billing.view` (Fase 17) no da acceso a
nada de aquí, y esta fase no crea ningún permiso de tenant.

## Alternatives considered

**`saas_invoices` + `saas_payments` separadas.** Coherente con la Fase 14 en la
forma, y una relación 1:1 obligatoria en el fondo. Descartada: la simetría con
otra fase no es un valor cuando las cardinalidades no coinciden.

**Un scheduler (pg_cron, un worker) para el ciclo.** Resuelve KL-2201 hoy y
añade infraestructura que ninguna fase ha justificado (§47). Descartada a favor
de una función idempotente que cualquier disparador futuro puede llamar.

**El ciclo como trigger sobre algo.** No hay evento que lo dispare: el paso del
tiempo no es un `INSERT`. Descartada por imposible, no por gusto.

**Guardar `grace_ends_at` en `subscriptions`.** Más cómodo para la UI y un dato
derivado más que puede desincronizarse. Descartada: se calcula con un join y no
hay lectura caliente que lo pida.

**La moneda en `tenant_settings`.** Habría mezclado la moneda con la que el
restaurante cobra con la moneda con la que se le cobra — exactamente lo que §22
prohíbe. Descartada.

**Permitir `INSERT` en `subscription_events` para platform admin.** Ninguna
necesidad real y una forma de fabricar historial. Descartada.

**Implementar una pasarela "de mentira" para tener el flujo completo.**
Descartada por lo mismo que ADR-021: un adapter que nadie ha ejecutado contra
un servicio real es peor que no tenerlo, porque parece terminado.

**Suspender borrando o desactivando datos del tenant.** Nunca se consideró en
serio y merece constar: suspender apaga los módulos (la Fase 21 ya hace eso con
`has_module`) y no toca una sola fila del negocio. Un cliente que vuelve
encuentra su catálogo, sus pedidos y su historial donde los dejó.

## Consequences

**Positivas**

- Las tres KL que la Fase 21 dejó abiertas quedan pagadas: hay cargos, los
  periodos avanzan y las pruebas vencen.
- El ciclo se puede correr cien veces sin cobrar de más, y la garantía es una
  restricción de la base, no disciplina.
- "¿Por qué está suspendido este negocio?" se responde con una consulta a
  `subscription_events`, no abriendo un log.
- Suspender es reversible sin restaurar nada: registrar el pago reactiva.
- La separación de los dos negocios es una aserción sobre `pg_constraint`, no
  una convención.

**Negativas, aceptadas**

- El ciclo no corre solo (KL-2201). Alguien tiene que pulsar el botón hasta que
  exista un scheduler.
- No hay pasarela: los pagos se registran a mano (KL-2204), y el tenant no
  puede pagar desde el dashboard (KL-2206).
- Cambiar de plan a mitad de periodo no prorratea (KL-2202).
- La concurrencia del ciclo no está probada en vivo: PGlite es monoproceso
  (ADR-007, KL-2203). El `UNIQUE` garantiza que no se duplica; lo no probado es
  la elegancia del error.
- `failed` y `refunded` existen sin productor (KL-2207).

**Neutras**

- Dos tablas, dos enums, cuatro columnas añadidas y tres funciones. Ninguna
  migración destructiva.
- Ningún permiso nuevo, por segunda fase consecutiva y por la misma razón
  (§29): cobrar es de CloverCode, no de un rol de tenant.
