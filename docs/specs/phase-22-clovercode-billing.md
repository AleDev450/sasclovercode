# SPEC — Phase 22 — CloverCode Billing

## 1. Información general

```text
Phase:                22
Nombre:               CloverCode Billing
Estado:               COMPLETED
Versión:              1.0.0
Fecha creación:       2026-08-30
Última actualización: 2026-08-30
Responsable:          alejandro.avendano@masuno.pe
```

Documento maestro: §33 (Fase 22), §22 (separación), §37 (idempotencia), §39 (dinero).
Fases previas: 00 a 21 — todas COMPLETED y auditadas.
ADR: [026 — Cobro del SaaS: cargo y pago en una fila, ciclo idempotente](../adr/026-saas-charge-as-single-row-and-idempotent-billing-cycle.md).

---

## 2. Objetivo

### ¿Por qué existe esta fase?

Master §33, Fase 22, textual y completo:

> Facturación del propio SaaS.
> Separar completamente: facturación del restaurante / suscripción que
> CloverCode cobra al restaurante.
> Crear: subscriptions, subscription_events, saas_payments.
> Preparar trials, suspensión y grace periods.

La Fase 21 dejó `subscriptions` con un `plan_code`, un `status` y un precio en
`plans` **que nadie lee**. Un negocio puede estar suspendido y nadie sabe por
qué; un plan cuesta S/ 399 y no existe ninguna fila que diga que alguien lo
debe. KL-2101, KL-2102 y KL-2103 son exactamente esa deuda, y esta fase la
paga.

La instrucción que gobierna el diseño no es la lista de tablas: es la línea
sobre separar. CloverCode le cobra al restaurante; el restaurante le cobra a su
cliente. Son dos negocios distintos y **no comparten ni una tabla, ni una
clave, ni un permiso**.

### ¿Qué debe ser posible al terminarla?

```text
Declarar cuantos dias dura la prueba de un plan y cuantos dias de gracia
  hay tras un impago.
Que un periodo que empieza genere su cargo, una sola vez, con el precio del
  plan copiado.
Registrar que un negocio pago - transferencia, Yape, deposito - y que eso
  reactive su servicio si estaba cortado.
Que una prueba vencida se convierta en suscripcion activa y empiece a
  cobrar.
Que un impago pase la suscripcion a `past_due` y, agotada la gracia, a
  `suspended` - sin borrar un solo dato.
Ver, para cualquier negocio, todo lo que le ha pasado a su suscripcion y
  quien lo hizo.
Que el negocio vea lo que debe y lo que pago, sin poder tocarlo.
Correr el ciclo de cobranza dos veces seguidas y que la segunda no cobre
  nada de nuevo.
```

---

## 3. Alcance

### Incluido

```text
subscription_events y saas_payments - las dos tablas que §33 nombra y que
  no existian (subscriptions es de la Fase 21).
Enums saas_payment_status (pending, paid, failed, refunded, void) y
  subscription_event_type (7 tipos, todos escritos por trigger).
plans extendida: trial_days, grace_days, currency - los terminos
  comerciales viven con el precio, no repartidos.
subscriptions extendida: cancel_at_period_end - cancelar al terminar el
  periodo pagado, que es lo que un cliente pide de verdad.
run_subscription_billing(): el ciclo, idempotente, ejecutable por un
  platform admin. Cierra pruebas, avanza periodos, emite cargos y aplica
  la gracia.
record_saas_payment(): registra un pago y reactiva el servicio si procede,
  atomicamente.
Historial completo por trigger: nadie escribe subscription_events a mano.
Super Admin: tablero de cobranza y el detalle por negocio.
El negocio ve sus cargos en /configuracion/plan, en solo lectura.
```

### Fuera de alcance

```text
Una pasarela de pago real (Culqi, Izipay, Stripe). §44 pide adapters y
  ADR-021 ya sento el precedente: no se implementa un proveedor sin
  credenciales reales contra las que probar. `saas_payments` guarda metodo
  y referencia, que es lo que una pasarela rellenaria. Ver ADR-026
  decision 5.
Un scheduler que corra el ciclo solo. Sigue sin existir infraestructura de
  jobs (§47) y montarla para esto seria decidir por adelantado. El ciclo es
  una funcion idempotente: la llama una persona hoy y un cron manana, sin
  cambiar nada. Ver seccion 24, KL-2201.
Prorrateos al cambiar de plan a mitad de periodo. El cambio aplica desde el
  periodo siguiente; calcular un prorrateo exige decidir politica comercial
  que nadie ha decidido. Ver KL-2202.
Impuestos sobre la suscripcion (IGV de CloverCode al restaurante). Es
  facturacion electronica de CloverCode como emisor, que es un dominio
  entero y NO es lo que pide esta fase.
Dunning: recordatorios automaticos de impago. Necesita MessagingProvider
  (§44), que no existe.
Autoservicio de pago para el tenant. Cambiar plan y pagar son operaciones
  de Super Admin (§29) mientras no haya pasarela.
```

### La decisión de alcance que más costó

**Si un cargo y su pago son una fila o dos.**

La Fase 14 fue explícita sobre el negocio del restaurante: _"Separar: Order /
Payment / Invoice. No son la misma entidad."_ La tentación era repetirlo aquí y
crear `saas_invoices` además de `saas_payments`.

Se descartó, y la razón es que las formas no son análogas. Un pedido puede
recibir varios pagos y una factura puede cubrir varios pedidos: ahí la
separación existe porque las cardinalidades son de verdad N:M. Un periodo de
suscripción produce **un** cargo y ese cargo recibe **un** pago; forzar dos
tablas sería crear una relación 1:1 obligatoria, que es la definición de una
tabla de más.

Y master nombra `saas_payments`, en singular de concepto. Una fila es "lo que
se cobró por este periodo y qué pasó con ese cobro". Ver ADR-026 decisión 1.

---

## 4. Dependencias

```text
Phase 04 — Super Admin       quien cobra; platform_admins gobierna todo
                              lo escribible de esta fase
Phase 21 — SaaS modules      subscriptions y plans existen; esta fase les
                              da terminos comerciales y un ciclo
ADR-015 — Money minor units  amount_cents, price_cents
ADR-021 — BillingProvider    el precedente de NO implementar un proveedor
                              sin credenciales reales
ADR-024 — Ledger append-only subscription_events copia esa forma exacta
ADR-025 — has_module         suspender apaga los modulos sin tocar datos:
                              `suspended` ya no da acceso desde la Fase 21,
                              asi que esta fase no toca la resolucion
```

Y una dependencia **negativa**, que es la instrucción central de §22:

```text
Phase 14 — payments          NO se toca. Es el cliente pagandole al
                              restaurante.
Phase 17 — billing_documents NO se toca. Es el restaurante emitiendole al
                              cliente.
```

---

## 5. Casos de uso

```text
UC-2201
Como Super Admin
quiero correr el ciclo de cobranza
para emitir los cargos del periodo que empieza.

  Actor          platform admin
  Precondiciones hay suscripciones cuyo periodo vencio
  Accion         ejecutar el ciclo
  Resultado      pruebas cerradas, periodos avanzados, cargos emitidos,
                 impagos aplicados; un resumen de cuantos de cada
  Errores        ninguno: correrlo dos veces no cobra dos veces

UC-2202
Como Super Admin
quiero registrar que un negocio pago
para reactivar su servicio.

  Actor          platform admin
  Precondiciones existe un cargo pendiente
  Accion         marcarlo pagado con metodo y referencia
  Resultado      cargo `paid`; si no queda ningun vencido, la suscripcion
                 vuelve a `active`
  Errores        cargo ya pagado -> se rechaza
                 cargo de otro estado -> se rechaza

UC-2203
Como Super Admin
quiero anular un cargo emitido por error
para no cobrar lo que no corresponde.

  Actor          platform admin
  Accion         marcar el cargo `void` con un motivo
  Resultado      deja de contar como deuda; el historial lo conserva
  Errores        anular un cargo ya pagado -> se rechaza

UC-2204
Como duena del negocio
quiero ver lo que debo y lo que pague
para cuadrar mis cuentas con CloverCode.

  Actor          owner (settings.manage)
  Accion         abrir /configuracion/plan
  Resultado      sus cargos, su estado y sus fechas, en solo lectura
  Errores        sin permiso -> 404

UC-2205
Como Super Admin
quiero cancelar una suscripcion al terminar el periodo
para no cortar un servicio que ya esta pagado.

  Actor          platform admin
  Accion         marcar cancel_at_period_end
  Resultado      el servicio sigue hasta el fin del periodo; el ciclo la
                 cancela al vencer
  Errores        ninguno
```

---

## 6. Requerimientos funcionales

```text
FR-2201  Un plan declarara sus dias de prueba, sus dias de gracia y la
         moneda de su precio.
FR-2202  Un periodo que empieza generara exactamente un cargo.
FR-2203  Un cargo copiara el precio y la moneda del plan en ese momento.
FR-2204  Un cargo no podra emitirse dos veces para el mismo periodo de la
         misma suscripcion.
FR-2205  Los estados de un cargo seran pending, paid, failed, refunded y
         void.
FR-2206  Un cargo pagado registrara cuando, con que metodo y con que
         referencia.
FR-2207  Registrar un pago sobre un cargo que no esta pendiente se
         rechazara.
FR-2208  Anular un cargo ya pagado se rechazara.
FR-2209  Una suscripcion en prueba pasara a `active` cuando la prueba
         venza, y solo entonces empezara a generar cargos.
FR-2210  Una suscripcion con un cargo vencido e impago pasara a
         `past_due`.
FR-2211  Una suscripcion cuyo cargo lleve mas de `grace_days` vencido
         pasara a `suspended`.
FR-2212  Registrar el pago de todos los cargos vencidos devolvera la
         suscripcion a `active`.
FR-2213  El ciclo sera idempotente: dos ejecuciones seguidas no cambiaran
         nada la segunda vez.
FR-2214  Una suscripcion marcada `cancel_at_period_end` se cancelara al
         vencer su periodo, no antes.
FR-2215  Una suscripcion `cancelled` no generara mas cargos.
FR-2216  Cada cambio relevante escribira una fila en subscription_events.
FR-2217  subscription_events sera append-only: sin UPDATE ni DELETE.
FR-2218  Nadie escribira subscription_events a mano: solo triggers.
FR-2219  Un negocio podra LEER sus cargos y sus eventos, y nunca
         escribirlos.
FR-2220  Solo un platform admin podra escribir cargos y suscripciones.
FR-2221  Ninguna tabla de esta fase tendra clave foranea hacia payments
         (Fase 14) ni hacia billing_documents (Fase 17).
```

---

## 7. Requerimientos no funcionales

```text
NFR-2201 Separación (§22)
         Es el requisito que define la fase. Ninguna tabla de aqui
         referencia el cobro del restaurante a su cliente, ni al reves.
         TEST-2230 lo comprueba estructuralmente sobre pg_constraint, no
         por inspeccion.

NFR-2202 Idempotencia (§37)
         El ciclo se puede correr dos veces, o cien. La garantia es
         estructural: UNIQUE(subscription_id, period_start) hace que un
         segundo cargo sea una violacion de clave, no una deuda duplicada.

NFR-2203 Seguridad
         Escribir es exclusivo de platform admin, en las dos tablas. Un
         owner que pudiera marcar sus cargos como pagados no estaria
         suscrito a nada.

NFR-2204 No destructivo
         Suspender apaga el producto y no borra nada. Cancelar tampoco.
         Los datos de un negocio sobreviven a su relacion comercial.

NFR-2205 Observabilidad
         El historial es la tabla, no el log: subscription_events responde
         "por que esta suspendido este negocio" sin abrir un fichero.

NFR-2206 Dinero
         Enteros en la unidad menor (ADR-015), y la moneda vive en el plan
         junto al precio - nunca en tenant_settings, que es la moneda con
         la que el restaurante le cobra a SU cliente.
```

---

## 8. Modelo de datos

### Enums nuevos

```text
saas_payment_status      pending | paid | failed | refunded | void
subscription_event_type  created | plan_changed | status_changed
                         | period_advanced | charge_issued
                         | payment_recorded | payment_voided
```

### plans (extendida)

```text
+ trial_days  SMALLINT NOT NULL default 0     0..365
+ grace_days  SMALLINT NOT NULL default 7     0..365
+ currency    TEXT     NOT NULL default 'PEN' ^[A-Z]{3}$
```

### subscriptions (extendida)

```text
+ cancel_at_period_end BOOLEAN NOT NULL default false
+ CHECK NOT (cancel_at_period_end AND status = 'cancelled')
```

### saas_payments

```text
id               UUID PK
tenant_id        UUID NOT NULL -> tenants ON DELETE CASCADE
subscription_id  UUID NOT NULL -> subscriptions ON DELETE CASCADE

plan_code_snapshot TEXT NOT NULL      1..40
period_start     TIMESTAMPTZ NOT NULL
period_end       TIMESTAMPTZ NOT NULL

amount_cents     BIGINT NOT NULL      0..10_000_000_000
currency         TEXT NOT NULL        ^[A-Z]{3}$

status           saas_payment_status NOT NULL default 'pending'
due_at           TIMESTAMPTZ NOT NULL
paid_at          TIMESTAMPTZ
method           TEXT                 <=40
reference        TEXT                 <=120
notes            TEXT                 <=300

created_by       UUID -> auth.users ON DELETE SET NULL
created_at       TIMESTAMPTZ NOT NULL
updated_at       TIMESTAMPTZ NOT NULL

UNIQUE (subscription_id, period_start)     idempotencia del ciclo
INDEX  (tenant_id, created_at DESC)
INDEX  (status, due_at) WHERE status = 'pending'

CHECK (status='paid') = (paid_at IS NOT NULL)
CHECK period_end > period_start
```

`plan_code_snapshot` y no una FK: el cargo dice qué plan se cobró, y borrar o
renombrar un plan no puede reescribir lo que se facturó — el mismo criterio de
ADR-017 y ADR-023.

### subscription_events

```text
id              UUID PK
tenant_id       UUID NOT NULL -> tenants ON DELETE CASCADE
subscription_id UUID NOT NULL -> subscriptions ON DELETE CASCADE

type            subscription_event_type NOT NULL
from_status     subscription_status
to_status       subscription_status
from_plan       TEXT   <=40
to_plan         TEXT   <=40
saas_payment_id UUID -> saas_payments ON DELETE SET NULL
detail          TEXT   <=300

actor_id        UUID -> auth.users ON DELETE SET NULL
created_at      TIMESTAMPTZ NOT NULL

INDEX (subscription_id, created_at DESC)
INDEX (tenant_id, created_at DESC)
```

Sin `UPDATE` ni `DELETE`, y sin `INSERT` para nadie: **sólo triggers escriben
aquí**. Es la misma postura que `delivery_status_history` (Fase 19) y
`loyalty_transactions` (Fase 20).

---

## 9. Diagrama de relaciones

```text
              plans  (precio, moneda, trial_days, grace_days)
                │
                ▼
tenants ──► subscriptions ──► saas_payments
                │                   │
                └───────┬───────────┘
                        ▼
                subscription_events     (append-only, sólo triggers)


   LA SEPARACIÓN DE §22, dibujada:

   CloverCode ──cobra──► restaurante      saas_payments      (Fase 22)
   restaurante ──cobra──► su cliente      payments           (Fase 14)
   restaurante ──emite──► su cliente      billing_documents  (Fase 17)

   Ninguna flecha cruza. Ninguna FK cruza. TEST-2230.
```

Ciclo de vida:

```text
trialing ──trial vence──► active ──impago──► past_due ──gracia agotada──► suspended
                            ▲                    │                            │
                            └────────pago────────┴────────────────────────────┘

                     cancel_at_period_end + periodo vence
                            └──────────► cancelled  (terminal)
```

---

## 10. Tenant Isolation

```text
¿Como se determina el tenant?
  saas_payments        columna propia, escrita por el ciclo desde la
                       suscripcion
  subscription_events  derivado por trigger de la suscripcion

¿Que tablas llevan tenant_id?
  Las dos. Ninguna tabla global nueva en esta fase.

¿Como evita RLS el acceso cross-tenant?
  SELECT predicado sobre is_tenant_member(tenant_id) OR is_platform_admin(),
  igual que subscriptions en la Fase 21. Escritura: solo platform admin.

¿Que consultas requieren validacion tenant?
  El ciclo corre como platform admin sobre todas las suscripciones a la vez;
  cada cargo hereda su tenant_id de la suscripcion, nunca de un parametro.

¿Existe algun recurso global?
  No. plans ya era global desde la Fase 21.
```

---

## 11. Seguridad

```text
Authorization
  Ningun permiso nuevo, por segunda fase consecutiva y por la misma razon
  (§29, ADR-025 decision 6): cobrar es de CloverCode, no de un rol de
  tenant. Leer los propios cargos cabe bajo `settings.manage`.

RLS policies
  saas_payments        SELECT miembro del tenant o platform admin
                       INSERT/UPDATE solo platform admin
                       sin DELETE
  subscription_events  SELECT miembro del tenant o platform admin
                       sin INSERT, sin UPDATE, sin DELETE - jamas

Por que saas_payments no admite DELETE
  Es el registro de lo que se cobro. Un cargo emitido por error se anula
  (`void`), que deja la fila y su motivo donde cualquiera puede verlos.

Por que subscription_events no admite NI INSERT
  Un historial que un llamante puede escribir es un historial que se puede
  fabricar. Solo lo escriben triggers SECURITY DEFINER, que corren como el
  propietario y no pasan por la politica.

Potential abuse cases
  Un owner marca su cargo como pagado    -> sin politica de escritura
  Un owner se quita el past_due          -> subscriptions ya era admin-only
  Un tenant lee la cobranza de otro      -> RLS por tenant
  Correr el ciclo dos veces cobra doble  -> UNIQUE(subscription, periodo)
  Anular un cargo cobrado                -> la RPC lo rechaza
  Fabricar historial                     -> no hay politica INSERT
```

---

## 12. API / Server Actions

```text
runSubscriptionBillingAction   platform admin   (via RPC)
recordSaasPaymentAction        platform admin   (via RPC)
voidSaasPaymentAction          platform admin   (via RPC)
setCancelAtPeriodEndAction     platform admin
```

```text
SQL
  run_subscription_billing()
    -> table(subscriptions_advanced int, charges_issued int,
             marked_past_due int, suspended int, cancelled int)

  record_saas_payment(p_payment_id uuid, p_method text,
                      p_reference text, p_paid_at timestamptz) -> void
  void_saas_payment(p_payment_id uuid, p_reason text) -> void
```

Contrato representativo:

```text
run_subscription_billing()

Permission: platform admin (comprobado dentro de la funcion)
Efecto:     en este orden - cierra pruebas vencidas, cancela las marcadas
            cuyo periodo vencio, avanza periodos, emite el cargo del
            periodo corriente, y aplica past_due/suspended segun la gracia.
Idempotente: si, por UNIQUE(subscription_id, period_start) y porque cada
            transicion comprueba su estado de origen.
Output:     un resumen de cuantas filas toco cada paso.
```

---

No existe accion para editar los terminos de un plan. `plans` es catalogo del
producto y es read-only desde la Fase 21 — sin politica de escritura para
nadie, platform admin incluido. Una accion que lo intentara **no fallaria**:
PostgREST filtraria la fila bajo RLS y reportaria exito sin cambiar nada, que
es peor que no tener el boton. Los terminos cambian en una migracion, como el
precio y los modulos; la pantalla los muestra en solo lectura y lo dice.

---

## 13. UI / UX

```text
/super-admin/facturacion
  Proposito     el tablero de cobranza de CloverCode
  Acciones      correr el ciclo; registrar pago; anular cargo
  Estados       empty ("Todavia no hay cargos emitidos."), success con el
                resumen del ciclo, error
  Permissions   platform admin

/super-admin/tenants/{id}   (extendida)
  Cambio        tarjeta "Cobranza": cargos de ese negocio, su historial de
                eventos, y el interruptor de cancelar al fin del periodo
  Permissions   platform admin

/dashboard/{slug}/configuracion/plan   (extendida)
  Cambio        tabla de cargos del negocio, en solo lectura, con su
                estado y sus fechas
  Permissions   settings.manage
```

---

## 14. Flujos principales

```text
El ciclo
  run_subscription_billing()
      ↓
  1. trialing con trial_ends_at <= now   → active, periodo desde ahi
      ↓
  2. cancel_at_period_end y periodo vencido → cancelled
      ↓
  3. active/past_due con periodo vencido → avanza el periodo
      ↓
  4. active/past_due sin cargo del periodo corriente → emite cargo
      ↓
  5. cargo pendiente vencido            → past_due
      ↓
  6. cargo pendiente vencido + gracia   → suspended
      ↓
  cada paso escribe su evento por trigger

Un pago
  record_saas_payment(cargo, metodo, referencia)
      ↓
  cargo → paid   [trigger: evento payment_recorded]
      ↓
  ¿queda algun cargo vencido e impago?
      ↓ no
  suscripcion → active   [trigger: evento status_changed]
```

---

## 15. Manejo de errores

```text
Cargo duplicado del periodo      -> 23505, y el ciclo lo ignora a proposito
Pagar un cargo no pendiente      -> P0001, mensaje accionable
Anular un cargo pagado           -> P0001
Anular sin motivo                -> 23514
Cargo inexistente                -> P0002
Sin ser platform admin           -> 42501 desde la RPC; RLS devuelve cero
                                    filas desde una consulta directa
Periodo invertido                -> 23514
Fallo de base no previsto        -> DatabaseError + log tecnico
```

---

## 16. Observabilidad

```text
saas.billing_cycle_run        con el resumen de cada paso
saas.payment_recorded
saas.payment_voided
saas.subscription_cancelled_at_period_end
saas.plan_terms_updated
```

El historial auditable de §17 es `subscription_events`, en base. Los logs son
para diagnóstico.

---

## 17. Testing Plan

### Unit

```text
TEST-2201  El espejo TypeScript declara los cinco estados de cargo y los
           siete tipos de evento.
TEST-2202  isOverdue() y graceEndsAt() calculan vencimiento y gracia.
TEST-2203  nextPeriodEnd() avanza un mes y un ano correctamente, incluido
           el 31 de enero.
TEST-2204  Los schemas Zod rechazan metodo vacio, referencia larga, motivo
           vacio, y dias fuera de rango.
TEST-2205  summariseCycle() describe un resumen vacio y uno con trabajo.
```

### Database (`src/tests/database/saas-billing.test.ts`)

```text
TEST-2210  Las dos tablas nuevas tienen RLS activo.
TEST-2211  subscription_events no admite INSERT, UPDATE ni DELETE.
TEST-2212  saas_payments no admite DELETE.
TEST-2213  anon no obtiene nada de ninguna.
TEST-2214  Crear una suscripcion escribe el evento `created`.
TEST-2215  Cambiar el plan escribe `plan_changed` con origen y destino.
TEST-2216  Cambiar el estado escribe `status_changed`.
TEST-2217  Emitir un cargo escribe `charge_issued`.
TEST-2218  Pagar escribe `payment_recorded`; anular, `payment_voided`.
TEST-2219  El ciclo cierra una prueba vencida y la pasa a active.
TEST-2220  El ciclo NO cobra durante la prueba.
TEST-2221  El ciclo emite un cargo por periodo con el precio del plan.
TEST-2222  Correr el ciclo dos veces no emite el cargo dos veces.
TEST-2223  El ciclo avanza el periodo cuando vence.
TEST-2224  Un cargo vencido impago pasa la suscripcion a past_due.
TEST-2225  Agotada la gracia, pasa a suspended.
TEST-2226  Pagar el cargo devuelve la suscripcion a active.
TEST-2227  Pagar un cargo no pendiente se rechaza.
TEST-2228  Anular un cargo pagado se rechaza.
TEST-2229  cancel_at_period_end cancela al vencer, no antes.
TEST-2230  Ninguna FK cruza entre esta fase y payments/billing_documents.
TEST-2231  Un tenant lee sus cargos y no puede escribirlos.
TEST-2232  Un tenant no lee los cargos de otro.
TEST-2233  Un platform admin escribe ambos.
TEST-2234  Una suscripcion cancelada no genera mas cargos.
TEST-2235  Suspender no borra ningun dato del negocio.
TEST-2236  El cargo copia el plan y la moneda, y sobrevive a que el plan
           cambie de precio despues.
```

### Regression

```text
schema-contract   las dos tablas nuevas y las columnas nuevas de plans y
                  subscriptions entran en EXPECTED_COLUMNS
modules.test      la Fase 21 sigue en verde: `suspended` ya apagaba los
                  modulos y esta fase no toca esa resolucion
```

---

## 18. Edge Cases

```text
Plan con trial_days = 0           -> se cobra desde el primer periodo
Plan con grace_days = 0           -> vencer y suspender el mismo dia
Precio 0 (plan de cortesia)       -> emite un cargo de 0, que nace `paid`
                                     porque no hay nada que cobrar
Periodo anual                     -> nextPeriodEnd suma un ano
31 de enero + 1 mes               -> 28/29 de febrero, no el 3 de marzo
Cambio de plan a mitad de periodo -> el cargo emitido no cambia; el
                                     siguiente usa el plan nuevo (KL-2202)
Cargo anulado y periodo vencido   -> no cuenta como deuda; no suspende
Suscripcion cancelada             -> el ciclo la ignora por completo
Tenant borrado                    -> CASCADE se lleva cargos y eventos
Plan borrado                      -> RESTRICT desde subscriptions (Fase 21);
                                     el snapshot del cargo sobrevive igual
Dos ejecuciones simultaneas       -> la segunda choca con el UNIQUE y no
                                     duplica; ver KL-2203
```

---

## 19. Performance considerations

```text
Queries
  El ciclo recorre `subscriptions` una vez por paso, con predicados sobre
  status y fechas. Con miles de tenants sigue siendo un scan de una tabla
  pequena; no hay N+1 porque no itera cargos por suscripcion en la
  aplicacion.

Indexes
  (subscription_id, period_start) unico   idempotencia Y la busqueda del
                                           cargo del periodo
  (status, due_at) parcial en pending      "que esta vencido", el predicado
                                           de los pasos 5 y 6
  (tenant_id, created_at desc)             la tabla que ve el negocio
  (subscription_id, created_at desc)       el historial

Nada derivado almacenado
  La deuda de una suscripcion es una consulta sobre sus cargos pendientes,
  no una columna. No hay saldo que pueda quedar desincronizado.
```

---

## 20. Migraciones

```text
20260830140000_create_saas_billing_enums.sql
  saas_payment_status, subscription_event_type; plans y subscriptions
  extendidas con sus terminos comerciales

20260830140100_create_saas_payments.sql
  saas_payments + indices + RLS

20260830140200_create_subscription_events.sql
  subscription_events + los cinco triggers que la escriben + RLS

20260830140300_create_billing_cycle.sql
  run_subscription_billing(), record_saas_payment(), void_saas_payment()
```

Ninguna es destructiva: sólo añade columnas con valor por defecto y tablas
nuevas.

---

## 21. Rollback

```text
  drop function public.void_saas_payment(uuid, text);
  drop function public.record_saas_payment(uuid, text, text, timestamptz);
  drop function public.run_subscription_billing();
  drop table public.subscription_events;   -- se lleva sus triggers
  drop table public.saas_payments;
  drop type public.subscription_event_type;
  drop type public.saas_payment_status;
  alter table public.subscriptions drop column cancel_at_period_end;
  alter table public.plans
    drop column trial_days, drop column grace_days, drop column currency;

Seguro: nada anterior a la Fase 22 lee estas tablas, y quitar el ciclo
devuelve el producto al estado de la Fase 21 - planes declarados que nadie
cobra. Ningun dato de negocio se pierde, porque esta fase no escribe en
ninguna tabla del restaurante.
```

---

## 22. Definition of Done

- [x] Los dos enums implementados
- [x] `saas_payments` y `subscription_events` — las dos tablas de §33 que faltaban
- [x] `plans` y `subscriptions` extendidas con sus términos comerciales
- [x] Historial escrito **sólo** por trigger, sin política de INSERT
- [x] `run_subscription_billing()` idempotente y probado como tal
- [x] `record_saas_payment()` y `void_saas_payment()` atómicas
- [x] Trials, `past_due`, gracia y suspensión funcionando de punta a punta
- [x] Cancelación al fin del periodo
- [x] Separación de §22 probada estructuralmente (TEST-2230)
- [x] RLS: lectura del propio tenant, escritura sólo platform admin
- [x] Tablero de cobranza en Super Admin
- [x] Cargos visibles para el negocio, en sólo lectura
- [x] Unit tests PASS
- [x] Database tests PASS
- [x] `schema-contract` actualizado
- [x] Lint / Typecheck / Build PASS
- [x] SPEC actualizado
- [x] ADR-026 escrito
- [x] `docs/architecture/` actualizado

---

## 23. Implementation notes

### El orden de los pasos del ciclo importa, y por eso está fijado

`run_subscription_billing()` hace seis cosas en una secuencia que no es
arbitraria:

```text
1. cerrar pruebas      antes de cobrar, o se cobraría a quien sigue en prueba
2. cancelar las marcadas  antes de avanzar, o se avanzaría un periodo que
                          nadie va a pagar
3. avanzar periodos    antes de emitir, o se emitiría el cargo del periodo
                       viejo otra vez
4. emitir cargos       antes de aplicar la mora, o se marcaría past_due a
                       quien todavía no tiene cargo
5. marcar past_due     antes de suspender, porque suspender parte de ahí
6. suspender
```

TEST-2219 a TEST-2225 recorren la secuencia entera sobre una misma
suscripción, moviendo el reloj con fechas explícitas, precisamente para que un
reordenamiento futuro rompa un test en vez de una factura.

### Por qué el historial no tiene política de INSERT

`subscription_events` es la única tabla del proyecto sin **ninguna** política
de escritura — ni siquiera para platform admin. Las escriben cinco triggers
`SECURITY DEFINER`, que corren como el propietario y por tanto no pasan por
RLS.

La diferencia con `loyalty_transactions` (Fase 20), que sí admite INSERT, es
que aquel ledger recibe asientos manuales legítimos —una campaña, un ajuste— y
éste no: cada fila aquí es la consecuencia de un cambio en otra tabla. Una fila
que nadie puede escribir es una fila que nadie puede fabricar.

### Lo que se verificó y lo que no

```text
Verificado con PGlite (PostgreSQL real, migraciones reales, politicas
reales), moviendo las fechas explicitamente en vez de esperar: los tests
insertan periodos ya vencidos en lugar de dormir.

NO verificado: el comportamiento bajo dos ejecuciones CONCURRENTES del
ciclo. PGlite es de un solo proceso (ADR-007 ya registro esa limitacion).
El UNIQUE hace que la segunda falle en vez de duplicar, que es la
propiedad que importa, pero el manejo del error concurrente no esta
probado en vivo. Ver KL-2203.
```

---

## 24. Known limitations

```text
KL-2201  El ciclo no corre solo. Es una funcion idempotente que hoy llama
         una persona desde el Super Admin. Montar un scheduler es
         infraestructura que ninguna fase ha justificado (§47), y la
         funcion esta escrita para que un cron la llame manana sin
         cambiarle nada. Dueno: cuando exista un scheduler.

KL-2202  Cambiar de plan a mitad de periodo no prorratea. El cargo ya
         emitido no cambia y el siguiente usa el plan nuevo. Prorratear
         exige politica comercial que nadie ha decidido. Dueno: cuando se
         decida.

KL-2203  Dos ejecuciones simultaneas del ciclo no estan probadas en vivo:
         PGlite es monoproceso (ADR-007). El UNIQUE garantiza que no se
         duplica el cargo; lo no probado es que el error concurrente se
         maneje con elegancia. Dueno: Fase 26, con la primera prueba de
         carga real.

KL-2204  No hay pasarela de pago. Un pago se registra a mano, que es como
         cobra de hecho un SaaS peruano que empieza (transferencia, Yape,
         deposito). `method` y `reference` son las columnas que una
         pasarela rellenaria. Dueno: cuando se contrate una.

KL-2205  CloverCode no le emite comprobante electronico al restaurante.
         Seria facturacion electronica con CloverCode como emisor - un
         dominio entero, y no lo que pide §33 para esta fase. Dueno:
         cuando CloverCode lo necesite legalmente.

KL-2206  El tenant no puede pagar desde el dashboard: ve lo que debe y
         paga por fuera. Consecuencia directa de KL-2204. Dueno: la misma.

KL-2207  `failed` y `refunded` existen en el enum y ninguna funcion los
         produce todavia: `failed` lo escribira una pasarela y `refunded`
         una devolucion, que es una decision contable que nadie ha
         tomado. Se declararon ahora porque anadir un valor a un enum
         despues obliga a revisar cada fila historica. Dueno: KL-2204.
```

---

## 25. Future considerations

```text
Fase 23 (Reports)        MRR, churn, cobranza vencida: todo sale de
                         saas_payments y subscription_events sin columnas
                         nuevas.
Fase 24 (Audit)          subscription_events ya es un audit log; la fase
                         solo tendra que incluirlo en su vista unificada.
Fase 27 (Backups)        saas_payments es dato financiero de CloverCode,
                         no de un tenant: su politica de retencion es
                         distinta y esa fase debera decirlo.
Una pasarela real        se escribe como adapter (§44, ADR-021):
                         saas_payments gana provider_reference y
                         provider_status, y el ciclo no cambia.
Prorrateo                cuando exista politica, es una funcion que emite
                         un cargo parcial; el esquema ya lo admite porque
                         period_start/period_end son libres.
```
