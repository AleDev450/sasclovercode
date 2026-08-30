# SPEC — Phase 20 — Loyalty + Promotions

## 1. Información general

```text
Phase:                20
Nombre:               Loyalty + Promotions
Estado:               COMPLETED
Versión:              1.0.0
Fecha creación:       2026-08-30
Última actualización: 2026-08-30
Responsable:          alejandro.avendano@masuno.pe
```

Documento maestro: §33 (Fase 20), §37 (idempotencia), §39 (dinero).
Fases previas: 00 a 19 — todas COMPLETED y auditadas.
ADR: [024 — Descuento como asiento, saldo de puntos como columna derivada](../adr/024-discount-as-ledger-entry-and-derived-point-balance.md).

---

## 2. Objetivo

### ¿Por qué existe esta fase?

Master §33, Fase 20, textual y completo:

> Crear módulos: promotions, coupons, loyalty_accounts, loyalty_transactions.
> Los puntos deben utilizar ledger.
> No almacenar únicamente: `points = 500` sin historial.
> Registrar: `+100 order`, `-50 reward`, `+20 campaign`.

Hasta aquí CloverCode sabe cobrar (Fase 14), emitir (Fase 17) y repartir
(Fase 19), pero no sabe **rebajar**. `orders.discount_cents` existe desde la
Fase 13 y se calcula sumando los descuentos de línea: no hay ningún sitio donde
vivan "10% de descuento en todo el pedido" ni "envío gratis con este cupón".

Y no sabe **premiar**: un cliente que compra cada semana desde la Fase 12 es
indistinguible de uno que vino una vez.

### ¿Qué debe ser posible al terminarla?

```text
Definir una promocion - porcentaje, monto fijo o envio gratis - con su
  vigencia, su pedido minimo y su tope de canjes.
Emitir cupones con codigo que desbloqueen esa promocion, cada uno con su
  propio tope y su propia caducidad.
Aplicar una promocion o un cupon a un pedido y que el descuento entre en su
  total, una sola vez, calculado por la base de datos.
Que un cliente acumule puntos solo, al completarse un pedido, segun la tasa
  que el negocio configuro.
Ver el historial completo de puntos de un cliente: de donde salio cada
  punto y en que se fue.
Canjear puntos como descuento de un pedido, en una sola operacion atomica
  que no puede dejar el saldo y el descuento en desacuerdo.
```

---

## 3. Alcance

### Incluido

```text
promotions, coupons, loyalty_accounts, loyalty_transactions - las cuatro
  tablas exactas de §33.
order_promotions: quinta tabla, el ASIENTO de un descuento sobre un pedido.
  Es lo que hace que un descuento sea trazable en vez de un numero que
  alguien escribio. Mismo precedente que order_transitions (Fase 13) y
  delivery_transitions (Fase 19): master nombra las tablas del dominio, no
  la lista cerrada de tablas de la fase.
Enums promotion_type (percentage, fixed_amount, free_delivery) y
  loyalty_transaction_type (earn, redeem, campaign, adjustment, expiry).
orders extendida con promotion_discount_cents, y las DOS funciones que
  calculan total_cents (Fase 13 y Fase 19) actualizadas a la vez para que
  no puedan discrepar.
tenant_settings extendida con la configuracion del programa de puntos:
  activo, puntos por sol, y valor de canje de un punto.
Trigger que acredita puntos al completarse un pedido - mismo enganche y
  mismo estado que el consumo de stock de la Fase 18.
RPC redeem_loyalty_points(): asiento negativo + descuento, atomico.
Permisos nuevos: promotions.view/manage, loyalty.view/manage.
Pantallas /promociones (promociones y cupones) y /fidelizacion (cuentas y
  ledger); tarjeta "Descuentos" en el detalle del pedido.
```

### Fuera de alcance

```text
Caducidad automatica de puntos. El tipo `expiry` existe en el enum y el
  ledger lo acepta, pero nada lo dispara solo: hacerlo necesita un job
  programado, que es infraestructura que ninguna fase ha montado todavia
  (§47). Un negocio puede registrar la caducidad como ajuste manual.
  Ver seccion 24, KL-2004.
Promociones automaticas ("2x1", "el tercero gratis", "combo"). §33 pide
  promotions y coupons, no un motor de reglas. Una promocion aqui es un
  descuento con condiciones de elegibilidad, aplicado por una persona o
  por un codigo. Ver ADR-024 decision 5.
Segmentacion de clientes y campanas dirigidas. El tipo `campaign` del
  ledger existe porque master lo nombra ("+20 campaign") y se acredita a
  mano; a quien dirigirla es un modulo de marketing que nadie pidio.
Niveles de fidelizacion (bronce/plata/oro). No lo pide §33.
Notificar al cliente sus puntos. Necesita MessagingProvider (§44), que no
  existe.
Aplicar promociones desde la web publica. La web publica no tiene
  checkout todavia; cuando lo tenga, la capa ya esta.
```

### La decisión de alcance que más costó

**Dónde vive el descuento de un pedido.**

`orders.discount_cents` ya existe, pero es la **suma de los descuentos de
línea** que `recompute_order_totals()` calcula desde `order_items`. Escribir
ahí el descuento de una promoción rompería esa función en la siguiente
recomputación: cualquier cambio en las líneas lo borraría.

Las tres salidas eran repartir el descuento entre las líneas (aritmética de
redondeo que no cuadra, y que además miente sobre el precio de cada producto),
añadir una columna suelta `promotion_discount_cents` que la aplicación
escribiera, o **hacer del descuento un asiento** en su propia tabla y derivar
la columna de la suma.

Se eligió el asiento. La razón es la misma que master da para los puntos —
"no almacenar únicamente un número sin historial" — aplicada al dinero: un
descuento de S/ 12 sin decir de qué promoción o de qué cupón vino es
exactamente el número que nadie puede auditar después. Ver ADR-024 decisión 1.

---

## 4. Dependencias

```text
Phase 12 — Customers          una cuenta de puntos pertenece a un cliente;
                               sin customers no hay a quien premiar
Phase 13 — Orders Core        orders.total_cents y las dos funciones que lo
                               calculan; el estado `completed` como enganche
Phase 14 — Payments           paid_cents se compara contra total_cents: por
                               eso un descuento solo entra mientras el
                               pedido siga `pending`
Phase 19 — Delivery           sync_order_shipping() calcula el mismo total;
                               esta fase actualiza las dos formulas a la vez
ADR-015 — Money as minor units todo importe en enteros
ADR-017 — Order snapshot/FSM  el snapshot del nombre de la promocion, y el
                               enganche a `completed` sin tocar la maquina
ADR-022 — Derived stock       el precedente que esta fase DELIBERADAMENTE no
                               sigue para el saldo de puntos, y explica por que
```

---

## 5. Casos de uso

```text
UC-2001
Como Encargado
quiero crear una promocion de 10% sobre pedidos desde S/ 50
para incentivar el ticket promedio.

  Actor          manager / admin / owner (promotions.manage)
  Precondiciones ninguna
  Accion         crear promocion tipo percentage, valor 10, minimo 5000
  Resultado      la promocion queda disponible para aplicarse
  Errores        nombre duplicado -> ConflictError
                 porcentaje fuera de 1..100 -> ValidationError

UC-2002
Como Cajero
quiero aplicar un cupon a un pedido
para darle al cliente el descuento que le prometieron.

  Actor          cashier (promotions.manage) sobre un pedido `pending`
  Precondiciones el cupon existe, esta vigente y no agoto sus canjes
  Accion         escribir el codigo y aplicar
  Resultado      order_promotions +1 fila; promotion_discount_cents y
                 total_cents recalculados por trigger
  Errores        cupon inexistente / caducado / agotado -> mensaje
                 pedido ya no `pending` -> se rechaza
                 promocion ya aplicada a ese pedido -> ConflictError

UC-2003
Como duena del negocio
quiero que mis clientes acumulen puntos automaticamente
para que vuelvan.

  Actor          nadie: es un efecto de completar el pedido
  Precondiciones el programa esta activo y el pedido tiene cliente
  Accion         el pedido llega a `completed`
  Resultado      un asiento `earn` con los puntos que la tasa implica, y el
                 saldo de la cuenta actualizado por trigger
  Errores        ninguno: un pedido sin cliente no acredita nada

UC-2004
Como Cajero
quiero canjear los puntos de un cliente como descuento
para cerrar la venta con el beneficio aplicado.

  Actor          cashier (loyalty.manage) sobre un pedido `pending`
  Precondiciones la cuenta tiene saldo suficiente
  Accion         indicar cuantos puntos canjear
  Resultado      un asiento `redeem` negativo y una fila order_promotions
                 con el descuento equivalente, en una sola transaccion
  Errores        saldo insuficiente -> mensaje, sin escribir nada
                 pedido ya no `pending` -> se rechaza

UC-2005
Como Encargado
quiero acreditar puntos de campana a un cliente
para compensar una incidencia o premiar algo puntual.

  Actor          manager (loyalty.manage)
  Precondiciones la cuenta existe
  Accion         registrar un ajuste con motivo
  Resultado      asiento `campaign` o `adjustment` con su motivo y su autor
  Errores        motivo vacio -> se rechaza
```

---

## 6. Requerimientos funcionales

```text
FR-2001  Una promocion tendra tipo percentage, fixed_amount o free_delivery.
FR-2002  Un porcentaje estara entre 1 y 100; un monto fijo sera mayor que
         cero; free_delivery no llevara valor.
FR-2003  Una promocion podra exigir un pedido minimo.
FR-2004  Una promocion podra tener vigencia (desde / hasta) y, si la tiene,
         el fin sera posterior al inicio.
FR-2005  Una promocion podra limitar su numero total de canjes.
FR-2006  El nombre de una promocion sera unico por tenant.
FR-2007  Un cupon pertenecera a exactamente una promocion.
FR-2008  El codigo de un cupon sera unico por tenant, sin distinguir
         mayusculas.
FR-2009  Un cupon podra tener su propio tope de canjes y su propia
         caducidad, independientes de los de la promocion.
FR-2010  Aplicar una promocion a un pedido escribira una fila en
         order_promotions con el descuento como copia.
FR-2011  Una promocion no podra aplicarse dos veces al mismo pedido.
FR-2012  orders.promotion_discount_cents sera la suma de los descuentos de
         order_promotions de ese pedido, mantenida por trigger.
FR-2013  total_cents sera items + envio - descuento de promociones, y nunca
         negativo.
FR-2014  Un descuento solo podra aplicarse o retirarse mientras el pedido
         este `pending`.
FR-2015  times_redeemed de la promocion y del cupon se mantendran por
         trigger desde order_promotions.
FR-2016  Aplicar una promocion que agoto su tope se rechazara.
FR-2017  Aplicar una promocion fuera de vigencia se rechazara.
FR-2018  Aplicar una promocion a un pedido de otro negocio se rechazara.
FR-2019  Cada cliente tendra a lo sumo una cuenta de puntos.
FR-2020  El saldo de puntos sera exactamente la suma de los asientos de esa
         cuenta, mantenido por trigger.
FR-2021  Los asientos seran de tipo earn, redeem, campaign, adjustment o
         expiry.
FR-2022  Un asiento earn llevara puntos positivos; uno redeem, negativos.
FR-2023  Un asiento no podra tener cero puntos.
FR-2024  Un asiento nunca podra modificarse ni borrarse.
FR-2025  El saldo de una cuenta nunca sera negativo.
FR-2026  Completar un pedido con cliente acreditara puntos si el programa
         esta activo, una sola vez.
FR-2027  Canjear puntos escribira el asiento negativo y el descuento en una
         sola transaccion.
FR-2028  Canjear mas puntos de los que hay se rechazara sin escribir nada.
FR-2029  El negocio configurara si el programa esta activo, cuantos puntos
         da por sol y cuanto vale un punto al canjearlo.
```

---

## 7. Requerimientos no funcionales

```text
NFR-2001 Seguridad
         Ninguna tabla de esta fase es legible por `anon`. Un ledger de
         puntos identifica a una persona y su historial de compra.
         tenant_id de coupons, order_promotions, loyalty_accounts y
         loyalty_transactions se deriva por trigger; no es un campo de
         entrada.

NFR-2002 Integridad
         El saldo y el ledger no pueden discrepar: el saldo lo escribe un
         trigger desde el ledger, el ledger no admite UPDATE ni DELETE, y
         un test recalcula el saldo desde cero y lo compara (TEST-2030).
         El descuento de un pedido y sus asientos tampoco: misma forma.

NFR-2003 Idempotencia (§37)
         UNIQUE(order_id, promotion_id) hace que reintentar la aplicacion
         de una promocion sea un error de clave, no un segundo descuento.

NFR-2004 Performance
         El ledger se lee por (tenant_id, account_id, created_at); el saldo
         NO se recalcula al leer, se lee de la columna. Los canjes de una
         promocion se cuentan por indice, no por count() en cada lectura.

NFR-2005 Observabilidad
         Eventos promotion.* y loyalty.* con tenantId e ids, nunca el
         nombre ni el documento del cliente.

NFR-2006 Accesibilidad
         Tablas con caption, formularios con labels asociados,
         confirmacion en las acciones destructivas.
```

---

## 8. Modelo de datos

### Enums nuevos

```text
promotion_type            percentage | fixed_amount | free_delivery
loyalty_transaction_type  earn | redeem | campaign | adjustment | expiry
```

### promotions

```text
id                UUID PK
tenant_id         UUID NOT NULL -> tenants
name              TEXT NOT NULL           1..120
description       TEXT                    <=300
type              promotion_type NOT NULL
percent_off       SMALLINT                1..100, solo type=percentage
amount_off_cents  BIGINT                  >0, solo type=fixed_amount
min_order_cents   BIGINT NOT NULL default 0
starts_at         TIMESTAMPTZ
ends_at           TIMESTAMPTZ
max_redemptions   INTEGER                 >0
times_redeemed    INTEGER NOT NULL default 0   mantenido por trigger
is_active         BOOLEAN NOT NULL default true
created_at        TIMESTAMPTZ NOT NULL
updated_at        TIMESTAMPTZ NOT NULL

UNIQUE (tenant_id, lower(name))
INDEX  (tenant_id, is_active)

CHECK type='percentage'   = (percent_off IS NOT NULL)
CHECK type='fixed_amount' = (amount_off_cents IS NOT NULL)
CHECK ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at
```

### coupons

```text
id               UUID PK
tenant_id        UUID NOT NULL   derivado por trigger de la promocion
promotion_id     UUID NOT NULL -> promotions ON DELETE CASCADE
code             TEXT NOT NULL   3..40
max_redemptions  INTEGER         >0
times_redeemed   INTEGER NOT NULL default 0   mantenido por trigger
expires_at       TIMESTAMPTZ
is_active        BOOLEAN NOT NULL default true
created_at       TIMESTAMPTZ NOT NULL
updated_at       TIMESTAMPTZ NOT NULL

UNIQUE (tenant_id, upper(code))
INDEX  (promotion_id)
```

### order_promotions

```text
id                     UUID PK
tenant_id              UUID NOT NULL   derivado por trigger del pedido
order_id               UUID NOT NULL -> orders ON DELETE CASCADE
promotion_id           UUID          -> promotions ON DELETE SET NULL
coupon_id              UUID          -> coupons ON DELETE SET NULL
loyalty_transaction_id UUID          -> loyalty_transactions ON DELETE SET NULL
source                 TEXT NOT NULL   'promotion' | 'coupon' | 'loyalty'
label_snapshot         TEXT NOT NULL   1..120
discount_cents         BIGINT NOT NULL 0..10_000_000_000
created_by             UUID          -> auth.users ON DELETE SET NULL
created_at             TIMESTAMPTZ NOT NULL

UNIQUE (order_id, promotion_id)  WHERE promotion_id IS NOT NULL
INDEX  (tenant_id, order_id)
INDEX  (promotion_id) WHERE promotion_id IS NOT NULL
INDEX  (coupon_id)    WHERE coupon_id IS NOT NULL

CHECK source='promotion' -> promotion_id IS NOT NULL
CHECK source='coupon'    -> coupon_id IS NOT NULL
CHECK source='loyalty'   -> loyalty_transaction_id IS NOT NULL
```

### loyalty_accounts

```text
id             UUID PK
tenant_id      UUID NOT NULL   derivado por trigger del cliente
customer_id    UUID NOT NULL UNIQUE -> customers ON DELETE CASCADE
points_balance INTEGER NOT NULL default 0   mantenido por trigger, >= 0
enrolled_at    TIMESTAMPTZ NOT NULL default now()
created_at     TIMESTAMPTZ NOT NULL
updated_at     TIMESTAMPTZ NOT NULL

INDEX (tenant_id)
CHECK points_balance >= 0
```

### loyalty_transactions

```text
id          UUID PK
tenant_id   UUID NOT NULL   derivado por trigger de la cuenta
account_id  UUID NOT NULL -> loyalty_accounts ON DELETE CASCADE
type        loyalty_transaction_type NOT NULL
points      INTEGER NOT NULL   con signo, distinto de cero
order_id    UUID          -> orders ON DELETE SET NULL
reason      TEXT              <=300
created_by  UUID          -> auth.users ON DELETE SET NULL
created_at  TIMESTAMPTZ NOT NULL

INDEX (tenant_id, account_id, created_at DESC)
UNIQUE (order_id) WHERE type = 'earn'     idempotencia del devengo

CHECK points <> 0
CHECK type='earn'   -> points > 0
CHECK type='redeem' -> points < 0
CHECK type IN ('campaign','adjustment','expiry') -> reason IS NOT NULL
```

### orders (extendida)

```text
+ promotion_discount_cents BIGINT NOT NULL default 0
+ CHECK promotion_discount_cents BETWEEN 0 AND 10_000_000_000
```

### tenant_settings (extendida)

```text
+ loyalty_enabled            BOOLEAN NOT NULL default false
+ loyalty_points_per_sol     SMALLINT NOT NULL default 1    0..1000
+ loyalty_point_value_cents  SMALLINT NOT NULL default 10   1..10000
```

---

## 9. Diagrama de relaciones

```text
tenants
   ├──► promotions ──► coupons
   │        │             │
   │        └──────┬──────┘
   │               ▼
   └──► orders ──► order_promotions ◄── loyalty_transactions
                        │                        ▲
                        │  trigger               │
                        ▼                        │
        orders.promotion_discount_cents          │
                        │                  loyalty_accounts
                        ▼                        ▲
        total_cents = Σ items + envio            │
                      - descuento             customers
```

Flujo de los puntos:

```text
order -> completed
     │  trigger
     ▼
loyalty_transactions (+earn)
     │  trigger
     ▼
loyalty_accounts.points_balance
     │  RPC redeem_loyalty_points()
     ▼
loyalty_transactions (-redeem)  +  order_promotions (descuento)
```

---

## 10. Tenant Isolation

```text
¿Como se determina el tenant?
  promotions            columna propia, escrita desde contexto servidor
  coupons               derivado por trigger de la promocion
  order_promotions      derivado por trigger del pedido
  loyalty_accounts      derivado por trigger del cliente
  loyalty_transactions  derivado por trigger de la cuenta

¿Que tablas llevan tenant_id?
  Las cinco. Ninguna tabla global en esta fase: los enums son tipos, no
  tablas, asi que a diferencia de las fases 13, 17 y 19 no hay maquina de
  estados que compartir.

¿Como evita RLS el acceso cross-tenant?
  Toda politica se predica sobre has_permission(tenant_id, '...').
  Ninguna politica de esta fase usa `using (true)`.

¿Que consultas requieren validacion tenant?
  Ademas de RLS, tres triggers cierran los huecos que RLS no ve:
    - la promocion aplicada pertenece al mismo tenant que el pedido
    - el cupon aplicado pertenece a la promocion que dice
    - el pedido de un asiento de puntos pertenece al mismo tenant

¿Existe algun recurso global?
  No.
```

---

## 11. Seguridad

```text
Authorization
  promotions.view    ver promociones y cupones
  promotions.manage  crear/editar promociones y cupones, aplicar y retirar
                     descuentos de un pedido
  loyalty.view       ver cuentas y su historial de puntos
  loyalty.manage     acreditar, ajustar y canjear puntos

Roles involucrados
  owner, admin, manager  los cuatro
  cashier                promotions.view/manage + loyalty.view/manage
                         (aplica el cupon y canjea los puntos en el momento
                         de cobrar - es la razon de ser de la fase)
  waiter                 promotions.view + loyalty.view (informa, no aplica)
  accountant             promotions.view + loyalty.view (lee el impacto)
  kitchen, delivery      nada

RLS policies
  promotions            SELECT promotions.view; INSERT/UPDATE/DELETE
                        promotions.manage
  coupons               identicas, gobernadas por los permisos de la
                        promocion
  order_promotions      SELECT promotions.view o loyalty.view;
                        INSERT/DELETE promotions.manage o loyalty.manage;
                        sin UPDATE - un descuento se retira, no se edita
  loyalty_accounts      SELECT loyalty.view; INSERT/UPDATE loyalty.manage;
                        sin DELETE
  loyalty_transactions  SELECT loyalty.view; INSERT loyalty.manage;
                        sin UPDATE ni DELETE, jamas

Por que loyalty_transactions no admite UPDATE ni DELETE
  Es el ledger. Si un asiento pudiera editarse, el saldo dejaria de ser
  demostrable y la exigencia de master ("los puntos deben utilizar
  ledger") seria decorativa. Un error se corrige con un asiento
  `adjustment` de signo contrario, que deja las dos filas visibles.

Input validation
  Zod en el limite. Ningun schema acepta tenant_id, points_balance,
  times_redeemed, promotion_discount_cents ni total_cents.

Potential abuse cases
  Aplicar el mismo cupon dos veces        -> UNIQUE(order_id, promotion_id)
  Canjear mas puntos de los que hay       -> RPC lo comprueba y aborta
  Canjear puntos de otro negocio          -> trigger + RLS
  Descuento mayor que el pedido           -> trigger lo rechaza
  Editar un asiento para inflar el saldo  -> no hay politica UPDATE
  Descontar un pedido ya cobrado          -> solo `pending`

Sensitive information
  El ledger asocia a una persona con su historial de compra. No se registra
  en logs; los eventos llevan solo ids.
```

---

## 12. API / Server Actions

```text
createPromotionAction        promotions.manage
updatePromotionAction        promotions.manage
setPromotionActiveAction     promotions.manage
deletePromotionAction        promotions.manage
createCouponAction           promotions.manage
setCouponActiveAction        promotions.manage
deleteCouponAction           promotions.manage

applyPromotionAction         promotions.manage
applyCouponAction            promotions.manage
removeOrderPromotionAction   promotions.manage

enrollCustomerAction         loyalty.manage
recordLoyaltyAdjustmentAction loyalty.manage
redeemLoyaltyPointsAction    loyalty.manage   (via RPC)
updateLoyaltySettingsAction  settings.manage
```

Contrato representativo:

```text
redeemLoyaltyPointsAction

Permission: loyalty.manage
Input:  { tenantSlug, orderId, accountId, points }
Efecto: RPC redeem_loyalty_points() - un asiento `redeem` negativo y una
        fila order_promotions con points * loyalty_point_value_cents, en
        una sola transaccion. Si el saldo no alcanza, no escribe nada.
Output: FormState
```

---

## 13. UI / UX

```text
/dashboard/{slug}/promociones
  Proposito     promociones y sus cupones
  Acciones      crear/editar/activar/eliminar promocion; crear/activar/
                eliminar cupon
  Estados       empty ("Aun no tienes promociones."), error, success
  Permissions   promotions.view para entrar; .manage para escribir

/dashboard/{slug}/fidelizacion
  Proposito     cuentas de puntos y su historial
  Acciones      inscribir cliente, acreditar/ajustar puntos, ver ledger
  Empty state   "Aun no hay clientes inscritos."
  Permissions   loyalty.view para entrar; .manage para escribir

/dashboard/{slug}/configuracion  (extendida)
  Cambio        tarjeta "Programa de puntos": activo, puntos por sol,
                valor de canje
  Permissions   settings.manage

/dashboard/{slug}/pedidos/{orderId}  (extendida)
  Cambio        tarjeta "Descuentos": aplicar promocion o cupon, canjear
                puntos, retirar un descuento; lista de los aplicados
  Permissions   promotions.view / promotions.manage / loyalty.manage
```

---

## 14. Flujos principales

```text
Aplicar un cupon
  Pedido `pending`
      ↓
  escribir el codigo
      ↓
  el servidor busca el cupon, valida vigencia/topes y resuelve el descuento
      ↓
  INSERT order_promotions   [trigger: tenant_id, guardas, tope, vigencia]
      ↓
  trigger -> orders.promotion_discount_cents = Σ descuentos
      ↓
  trigger -> orders.total_cents = Σ items + envio - descuento
      ↓
  trigger -> promotions.times_redeemed += 1, coupons.times_redeemed += 1

Acumular puntos
  orders.status -> completed
      ↓
  trigger: ¿programa activo? ¿pedido con cliente?
      ↓
  cuenta creada si no existia
      ↓
  INSERT loyalty_transactions (earn, +puntos, order_id)
      ↓
  trigger -> loyalty_accounts.points_balance += puntos

Canjear puntos
  RPC redeem_loyalty_points(order_id, account_id, points)
      ↓
  valida saldo, tenant y estado del pedido
      ↓
  INSERT loyalty_transactions (redeem, -puntos)
      ↓
  INSERT order_promotions (source='loyalty', descuento equivalente)
      ↓
  los dos triggers de siempre actualizan saldo y total
```

---

## 15. Manejo de errores

```text
Nombre de promocion duplicado     -> ConflictError (23505)
Codigo de cupon duplicado         -> ConflictError (23505)
Promocion ya aplicada al pedido   -> ConflictError (23505)
Promocion agotada                 -> P0001, mensaje accionable
Promocion fuera de vigencia       -> P0001
Cupon caducado o agotado          -> P0001
Pedido minimo no alcanzado        -> P0001
Descuento mayor que el pedido     -> P0001
Pedido ya no `pending`            -> P0001
Promocion/cupon de otro negocio   -> 23514
Saldo de puntos insuficiente      -> P0001, sin escribir nada
Asiento con cero puntos           -> 23514
Sin permiso                       -> notFound() en la pagina
Fallo de base no previsto         -> DatabaseError + log tecnico
```

---

## 16. Observabilidad

```text
promotion.created / promotion.updated
promotion.activated / promotion.deactivated / promotion.deleted
coupon.created / coupon.deactivated / coupon.deleted
order.promotion_applied / order.promotion_removed
loyalty.account_enrolled
loyalty.points_earned
loyalty.points_redeemed
loyalty.points_adjusted
loyalty.settings_updated
```

Cada evento lleva `tenantId` y el id del registro. **Nunca** el nombre del
cliente ni su documento.

---

## 17. Testing Plan

### Unit

```text
TEST-2001  discountFor() calcula porcentaje, monto fijo y envio gratis.
TEST-2002  El descuento nunca excede la base sobre la que se aplica.
TEST-2003  isRedeemable() rechaza inactiva, fuera de vigencia, agotada y
           por debajo del pedido minimo.
TEST-2004  pointsForOrder() aplica la tasa y trunca hacia abajo.
TEST-2005  redemptionValue() convierte puntos a cents.
TEST-2006  Los schemas Zod rechazan porcentaje fuera de rango, importe mal
           escrito, codigo corto, puntos cero o negativos.
```

### Database (`src/tests/database/loyalty.test.ts`)

```text
TEST-2010  Las cinco tablas nuevas tienen RLS activo.
TEST-2011  anon no obtiene nada de ninguna.
TEST-2012  Tenant A no lee ni escribe promociones/cupones/cuentas de B.
TEST-2013  Nombre de promocion duplicado por tenant se rechaza.
TEST-2014  Codigo de cupon duplicado por tenant se rechaza, ignorando
           mayusculas.
TEST-2015  coupons.tenant_id se deriva de la promocion.
TEST-2016  Un tipo percentage sin percent_off se rechaza, y viceversa.
TEST-2017  ends_at anterior a starts_at se rechaza.
TEST-2018  Aplicar una promocion escribe promotion_discount_cents y
           recalcula total_cents.
TEST-2019  Retirar el descuento devuelve el total.
TEST-2020  La misma promocion no se aplica dos veces al mismo pedido.
TEST-2021  Una promocion agotada se rechaza.
TEST-2022  Una promocion fuera de vigencia se rechaza.
TEST-2023  Un pedido por debajo del minimo se rechaza.
TEST-2024  Una promocion de otro negocio se rechaza.
TEST-2025  Un descuento mayor que el pedido se rechaza.
TEST-2026  Un pedido que dejo `pending` no admite descuentos nuevos.
TEST-2027  times_redeemed sube al aplicar y baja al retirar.
TEST-2028  El total combina items, envio y descuento a la vez.
TEST-2029  Completar un pedido con cliente acredita puntos una sola vez.
TEST-2030  El saldo es siempre la suma exacta del ledger.
TEST-2031  Un pedido sin cliente no acredita nada.
TEST-2032  Con el programa apagado no se acredita nada.
TEST-2033  loyalty_transactions no admite UPDATE ni DELETE.
TEST-2034  Un asiento de cero puntos se rechaza.
TEST-2035  earn con puntos negativos, y redeem con positivos, se rechazan.
TEST-2036  El saldo nunca queda negativo.
TEST-2037  redeem_loyalty_points escribe asiento y descuento a la vez.
TEST-2038  redeem_loyalty_points con saldo insuficiente no escribe nada.
TEST-2039  Un cliente tiene a lo sumo una cuenta.
TEST-2040  Un miembro sin loyalty.view no lee el ledger.
TEST-2041  kitchen y delivery no reciben permisos de esta fase.
```

### Regression

```text
schema-contract   las cinco tablas y las columnas nuevas de orders y
                  tenant_settings entran en EXPECTED_COLUMNS
isolation         RLS en toda tabla nueva (comprobacion phase-agnostic)
orders/payments   los totales de las fases 13, 14 y 19 siguen cuadrando
```

### E2E

No hay E2E en el proyecto (KL-506, dueño Fase 28). El sustituto verificable
es el conjunto de tests de base sobre PGlite.

---

## 18. Edge Cases

```text
Promocion sin vigencia            -> siempre vigente
Promocion sin tope                -> canjes ilimitados
Cupon cuya promocion se desactiva -> el cupon deja de aplicarse
Promocion borrada con descuentos
  ya aplicados                    -> SET NULL; label_snapshot conserva el
                                     nombre, el pedido no cambia de total
free_delivery sobre un pedido sin
  entrega                         -> descuento 0, se rechaza como inutil
Descuento igual al total          -> permitido; total queda en 0
Cliente borrado                   -> CASCADE borra cuenta y ledger; en la
                                     practica no ocurre (no hay DELETE en
                                     customers)
Pedido borrado                    -> CASCADE borra order_promotions
Puntos que no alcanzan para 1 cent-> se rechaza el canje
Tasa 0 puntos por sol             -> el programa no acredita nada
```

---

## 19. Performance considerations

```text
Queries
  El saldo NO se recalcula al leer: es una columna. Un cliente con miles de
  asientos se lee igual de rapido que uno con dos - la razon principal para
  no hacerlo VIEW como en la Fase 18 (ADR-024 decision 2).
  times_redeemed idem: contar canjes en cada validacion seria un count()
  por aplicacion de cupon.

Indexes
  (tenant_id, is_active)                promociones ofrecibles
  (tenant_id, upper(code))              busqueda del cupon al aplicarlo
  (tenant_id, account_id, created_at)   el ledger de un cliente
  (order_id) parcial en earn            idempotencia del devengo

N+1
  El detalle del pedido lee sus descuentos en una consulta con join
  declarado, no uno por fila.
```

---

## 20. Migraciones

```text
20260830120000_create_loyalty_permissions.sql
  4 permisos + grants por rol

20260830120100_create_promotion_enums.sql
  enums promotion_type y loyalty_transaction_type

20260830120200_create_promotions.sql
  promotions + indices + RLS

20260830120300_create_coupons.sql
  coupons + trigger de tenant + indices + RLS

20260830120400_create_loyalty_accounts.sql
  loyalty_accounts + loyalty_transactions + trigger de saldo + RLS

20260830120500_create_order_promotions.sql
  order_promotions + guardas + recalculo de totales + contadores + RLS
  (aqui se reescriben recompute_order_totals y sync_order_shipping)

20260830120600_create_loyalty_earning.sql
  tenant_settings extendida + trigger de devengo + RPC de canje
```

---

## 21. Rollback

```text
Orden inverso:

  drop function public.redeem_loyalty_points(uuid, uuid, integer);
  drop trigger orders_earn_loyalty_points on public.orders;
  drop function public.earn_loyalty_points_on_completion();
  alter table public.tenant_settings
    drop column loyalty_enabled, drop column loyalty_points_per_sol,
    drop column loyalty_point_value_cents;
  drop table public.order_promotions;
  drop table public.loyalty_transactions;
  drop table public.loyalty_accounts;
  drop table public.coupons;
  drop table public.promotions;
  drop type public.loyalty_transaction_type;
  drop type public.promotion_type;
  alter table public.orders drop column promotion_discount_cents;
  delete from public.role_permissions where permission like 'promotions.%'
     or permission like 'loyalty.%';
  delete from public.permissions where code like 'promotions.%'
     or code like 'loyalty.%';

CRITICO
  Borrar order_promotions NO devuelve orders.total_cents a su valor sin
  descuento, y ademas recompute_order_totals/sync_order_shipping quedarian
  referenciando una columna inexistente. Un rollback real DEBE reinstalar
  las versiones de esas dos funciones anteriores a esta fase - estan en
  20260827130200_create_order_items.sql y 20260828120500_create_order_deliveries.sql
  respectivamente - ANTES de eliminar la columna.
```

---

## 22. Definition of Done

- [x] Los dos enums implementados
- [x] Las cuatro tablas de §33 más `order_promotions`
- [x] Ledger de puntos append-only, sin UPDATE ni DELETE
- [x] Saldo mantenido por trigger y demostrablemente igual al ledger
- [x] `orders.promotion_discount_cents` y las DOS funciones de total
      actualizadas coherentemente
- [x] Contadores de canje mantenidos por trigger
- [x] Guardas cross-tenant: promoción, cupón, pedido, cuenta
- [x] RPC de canje atómica
- [x] Devengo automático al completar, idempotente
- [x] RLS en las cinco tablas, sin `using (true)`
- [x] 4 permisos nuevos, en SQL y en el espejo TypeScript
- [x] Server Actions con `requirePermission`
- [x] Pantallas `/promociones` y `/fidelizacion`
- [x] Tarjeta de descuentos en el detalle del pedido
- [x] Configuración del programa en `/configuracion`
- [x] Unit tests PASS
- [x] Database tests PASS (aislamiento cross-tenant incluido)
- [x] `schema-contract` actualizado
- [x] Lint / Typecheck / Build PASS
- [x] SPEC actualizado
- [x] ADR-024 escrito
- [x] `docs/architecture/` actualizado

---

## 23. Implementation notes

### Las dos funciones de total, reescritas a la vez

La parte más delicada de la fase no fue ninguna tabla nueva: fue que
`total_cents` se calcula en **dos** sitios desde la Fase 19 —
`recompute_order_totals()` (Fase 13, sobre cambios en las líneas) y
`sync_order_shipping()` (Fase 19, sobre cambios en la entrega) — y esta fase
añade un tercero, `sync_order_promotions()`.

Las tres usan ahora exactamente la misma expresión:

```sql
total_cents = Σ order_items.total_cents
            + orders.shipping_cents
            - orders.promotion_discount_cents
```

Se reescribieron las dos anteriores en la misma migración, no en una
posterior: dejarlas desincronizadas aunque fuera por una migración habría
significado que el total dependía de cuál de los tres triggers corrió último.
TEST-2028 combina líneas, envío y descuento en un mismo pedido precisamente
para fijar eso.

### Por qué el saldo es una columna y el stock una vista

ADR-022 (Fase 18) decidió que el stock fuera una `VIEW` y no una columna, y
esta fase decide lo contrario para los puntos. No es una incoherencia: un
saldo de stock es un hecho sobre el par **(insumo, sede)**, que no tiene fila
propia donde vivir; un saldo de puntos es un hecho sobre **una cuenta**, que
sí la tiene. La diferencia está argumentada en ADR-024 decisión 2, junto con
el test que hace que la columna no pueda mentir.

### Lo que se verificó y lo que no

```text
Verificado con PGlite (PostgreSQL real, migraciones reales, politicas
reales), sobre el que corren los tests de loyalty.test.ts.

NO verificado contra un Supabase desplegado: esta fase no usa Vault,
Storage ni Realtime. La unica dependencia de plataforma es auth.uid(), que
el helper de tests reproduce leyendo request.jwt.claims igual que Supabase.
```

---

## 24. Known limitations

```text
KL-2001  Una promocion se aplica A MANO (o con un codigo). No hay motor de
         reglas que la aplique sola al cumplirse una condicion. §33 pide
         promotions y coupons, no un motor. Dueno: cuando se pida.

KL-2002  El descuento se calcula al APLICARLO, con el subtotal de ese
         momento. Si despues se agregan lineas (posible mientras el pedido
         siga `pending`), un descuento porcentual no se recalcula solo. Es
         exactamente la misma limitacion que KL-1903 acepto para el envio
         gratis, y por la misma razon: recalcularlo obligaria al trigger de
         order_items a conocer las promociones. Dueno: Fase 26.

KL-2003  Solo una promocion por pedido puede acumularse con otras sin
         ninguna regla de compatibilidad: nada impide aplicar tres
         promociones distintas al mismo pedido salvo el tope del total. Un
         sistema de exclusiones mutuas no lo pide §33. Dueno: cuando se
         pida.

KL-2004  Los puntos no caducan solos. El tipo `expiry` existe y el ledger
         lo acepta, pero dispararlo necesita un job programado, que es
         infraestructura que ninguna fase ha montado (§47). Dueno: cuando
         exista un scheduler.

KL-2005  La tasa de puntos es unica por negocio: no hay multiplicadores por
         producto, categoria ni dia. Dueno: cuando se pida.

KL-2006  Un cliente sin `customer_id` en el pedido (venta de mostrador) no
         acumula. Es deliberado - ADR-016 no quiere pedir datos personales
         para una venta que no los necesita - pero significa que el POS
         debe asociar el cliente ANTES de completar si se quiere acreditar.
```

---

## 25. Future considerations

```text
Fase 21 (SaaS modules)  `loyalty` es uno de los modulos que §33 enumera;
                        hasFeature('loyalty') gobernara estas pantallas.
Fase 22 (CloverCode
  billing)              nada de esta fase se factura: son descuentos del
                        restaurante a SU cliente, no de CloverCode al
                        restaurante. La separacion que exige §22 se
                        mantiene intacta.
Fase 23 (Reports)       promociones mas canjeadas, impacto en el ticket,
                        puntos emitidos vs canjeados: todo sale de
                        order_promotions y del ledger, sin columnas nuevas.
Checkout publico        cuando la web tenga carrito, aplicar un cupon sera
                        la misma insercion en order_promotions con un
                        `anon` que hoy no existe.
```
