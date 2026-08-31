# SPEC — Phase 24 — Audit + Observability

## 1. Información general

```text
Phase:                24
Nombre:               Audit + Observability
Estado:               COMPLETED
Versión:              1.0.0
Fecha creación:       2026-08-30
Última actualización: 2026-08-30
Responsable:          alejandro.avendano@masuno.pe
```

Documento maestro: §33 (Fase 24), §16 (logging), §17 (auditoría), §29 (Super Admin), §44 (adapters).
Fases previas: 00 a 23 — todas COMPLETED y auditadas.
ADR: [028 — Auditoría por trigger con contexto de petición reenviado](../adr/028-audit-by-trigger-with-forwarded-request-context.md).

---

## 2. Objetivo

### ¿Por qué existe esta fase?

Master §33, Fase 24, textual y completo:

> Completar observabilidad.
> Agregar: audit logs; error tracking; métricas; performance; request IDs;
> health checks; eventos críticos.
> Preparar herramientas de diagnóstico para Super Admin.

Y §17 da el modelo exacto de `audit_logs`, sus nueve acciones de ejemplo, y una
prohibición: _"Nunca guardar passwords, tokens o secretos en audit logs."_

La palabra que manda es **completar**. La Fase 00 dejó logging estructurado,
`request_id` y un health check que dice en su propio comentario:

> Dependency checks belong to Phase 24 (Observability), where a degraded
> dependency must also be expressible in the response.

Y varias fases dejaron historiales de dominio —`order_status_history`,
`billing_events`, `delivery_status_history`, `subscription_events`— que
responden _"¿qué le pasó a esta cosa?"_. Ninguno responde la otra pregunta:
**"¿quién cambió qué, y desde dónde?"**.

### ¿Qué debe ser posible al terminarla?

```text
Saber quien cambio un precio, cuando, desde que IP y con que navegador -
  y con el mismo request_id que aparece en el log de la aplicacion, para
  poder cruzarlos.
Lo mismo para las otras ocho acciones sensibles que §17 enumera.
Que ese registro NO dependa de que alguien se acuerde de escribirlo.
Que no guarde jamas una credencial, aunque manana alguien anada una
  columna que se llame `api_key`.
Que /api/health diga `degraded` -y por que- cuando la base de datos
  responde mal, en vez de decir `ok` porque el proceso sigue vivo.
Que un error de servidor quede registrado con su ruta, su tipo y su
  request_id, sin que nadie tenga que envolverlo en un try/catch.
Que el Super Admin tenga una pantalla de diagnostico con el estado del
  sistema y sus numeros.
Que un negocio pueda leer su propia auditoria, y solo la suya.
```

---

## 3. Alcance

### Incluido

```text
audit_logs con el modelo EXACTO de §17, mas `request_id` - la columna que
  hace que la auditoria y el log de la aplicacion se puedan cruzar, que es
  para lo que §33 pone "request IDs" al lado de "audit logs" - y
  `user_email`, para que la fila siga diciendo quien fue cuando ese usuario
  ya no exista (ADR-028 decision 5).
Un escritor generico y quince triggers que lo usan, cubriendo las nueve
  acciones de §17. Nadie escribe la tabla a mano: no hay politica INSERT.
Redaccion por PATRON, no por lista, y con la MISMA politica que el logger
  de la Fase 00: cualquier clave cuyo nombre normalizado contenga password,
  token, secret, apikey, credential, cookie y otras once, se sustituye por
  [REDACTED] antes de guardar. Sobrevive a columnas que todavia no existen,
  y hay un test que comprueba que SQL y TypeScript coinciden.
Reenvio del contexto de peticion: createSupabaseServerClient adjunta la IP,
  el user-agent y el request_id del visitante como cabeceras, y el trigger
  las lee de `request.headers`. Sin eso, §17 pediria tres columnas que
  PostgreSQL no puede llenar.
Permiso nuevo: audit.view. El primero desde la Fase 20.
src/instrumentation.ts con onRequestError: error tracking nativo de
  Next.js, sin envolver nada en try/catch.
/api/health extendido: comprueba la base de datos, mide su latencia y
  responde `degraded` con 503 cuando falla.
platform_diagnostics(): los numeros del sistema para el Super Admin.
Pantallas /super-admin/diagnostico y /dashboard/{slug}/auditoria.
```

### Fuera de alcance

```text
Sentry, Datadog o cualquier proveedor externo de error tracking. §44 pide
  adapters y ADR-021 sento el precedente: no se implementa un proveedor sin
  credenciales reales contra las que probar. `onRequestError` es el punto
  unico donde ese adapter entrara, y hoy escribe al logger estructurado que
  la Fase 00 ya dejo. Ver KL-2404.
Metricas de series temporales (Prometheus, OpenTelemetry). Exportar
  metricas necesita un colector que nadie ha montado, y montarlo es la
  infraestructura que §47 dice no decidir por adelantado. Lo que si hay son
  los numeros que un humano mira en una pantalla. Ver KL-2405.
Alertas. Una alerta necesita a donde mandarla: MessagingProvider (§44) no
  existe. Ver KL-2406.
Retencion y purga de la auditoria. Una tabla append-only crece; decidir
  cuanto se guarda es politica legal y de negocio que nadie ha fijado.
  Ver KL-2402.
Auditar TODA escritura. Se auditan las acciones sensibles que §17 enumera,
  no cada UPDATE del sistema: un audit log que registra todo es un log que
  nadie lee. Ver ADR-028 decision 3.
Reemplazar los historiales de dominio. order_status_history, billing_events
  y los demas siguen siendo la respuesta a "¿que le paso a esta cosa?"; la
  auditoria responde "¿quien lo hizo y desde donde?". Ver ADR-028
  decision 3.
```

### La decisión de alcance que más costó

**Cómo llegan la IP y el user-agent a un trigger de PostgreSQL.**

§17 pide `ip_address` y `user_agent` en el modelo. PostgreSQL no los conoce:
son datos de la capa HTTP, y un trigger corre a metros de distancia de ella.

Las tres salidas eran: escribir la auditoría **desde la aplicación** —donde la
IP sí está— y aceptar que depende de que cada Server Action se acuerde;
escribirla **por trigger** y dejar las dos columnas siempre en `NULL`, que es
declarar un campo que nadie llena; o **hacer llegar el dato al trigger**.

Se eligió la tercera. `createSupabaseServerClient()` adjunta la IP, el
user-agent y el `request_id` del visitante como cabeceras en cada petición a
Supabase, y el trigger las lee de `request.headers` — el GUC que PostgREST ya
rellena. El resultado tiene las dos propiedades: es imposible de olvidar
porque lo escribe un trigger, y llega completo porque el contexto viaja con la
petición. Ver ADR-028 decisión 2.

---

## 4. Dependencias

```text
Phase 00 — Foundation      logger estructurado, request_id y el health check
                            que esta fase extiende - su propio comentario
                            decia que esto era trabajo de la Fase 24
Phase 02 — Auth            auth.uid() es el `user_id` de cada fila
Phase 03 — Authorization   el patron de permiso; audit.view se suma al
                            catalogo por primera vez desde la Fase 20
Phase 04 — Super Admin     §29 pone "logs" entre sus funciones
Phases 11-22               las tablas cuyas acciones sensibles se auditan
ADR-021 — BillingProvider  el precedente de NO implementar un proveedor sin
                            credenciales; aqui aplica a Sentry
ADR-026 — subscription_events  la forma "sin politica de escritura, solo
                            triggers" que audit_logs copia exactamente
```

---

## 5. Casos de uso

```text
UC-2401
Como duena del negocio
quiero saber quien cambio el precio de un producto
para entender por que vendimos con otro margen.

  Actor          owner / admin / accountant (audit.view)
  Precondiciones alguien cambio un precio
  Accion         abrir /auditoria y filtrar por accion
  Resultado      quien, cuando, el precio viejo y el nuevo, y desde que IP
  Errores        sin permiso -> 404

UC-2402
Como Super Admin
quiero ver si el sistema esta sano
para saber si un reporte de "va lento" es real.

  Actor          platform admin
  Accion         abrir /super-admin/diagnostico
  Resultado      estado de la base, su latencia, y los numeros del sistema
  Errores        base caida -> la pagina lo dice, no se rompe

UC-2403
Como operador
quiero que /api/health diga la verdad
para que el balanceador saque de rotacion una instancia enferma.

  Actor          cualquiera (endpoint publico)
  Accion         GET /api/health
  Resultado      200 con `ok`, o 503 con `degraded` y que dependencia fallo
  Errores        ninguno: el fallo ES la respuesta

UC-2404
Como quien recibe un reporte de error
quiero cruzar lo que vio el usuario con lo que paso en la base
para diagnosticar sin adivinar.

  Actor          desarrollador
  Precondiciones el usuario dio el request_id que vio en pantalla
  Accion         buscar ese request_id en el log y en audit_logs
  Resultado      las lineas de log y las filas de auditoria de esa peticion
  Errores        ninguno

UC-2405
Como auditor
quiero estar seguro de que la auditoria no guarda secretos
para poder entregarla sin revisarla fila a fila.

  Actor          cualquiera con audit.view
  Precondiciones se modifico la configuracion de facturacion
  Accion         mirar esa fila
  Resultado      el cambio, sin la referencia a la credencial
  Errores        ninguno
```

---

## 6. Requerimientos funcionales

```text
FR-2401  audit_logs tendra las columnas exactas de §17, mas request_id.
FR-2402  Nadie podra insertar, modificar ni borrar audit_logs: ni siquiera
         un platform admin.
FR-2403  Solo triggers escribiran audit_logs.
FR-2404  Cada fila registrara quien (auth.uid()), cuando, que accion, sobre
         que entidad y sobre que fila.
FR-2405  Cada fila guardara el estado anterior y el posterior como JSONB.
FR-2406  Un INSERT no tendra old_values; un DELETE no tendra new_values.
FR-2407  El valor de toda clave sensible sera sustituido por [REDACTED] en
         ambos payloads, dejando la clave visible.
FR-2408  La redaccion sera por patron y no por lista, para que cubra
         columnas que aun no existen, y usara la MISMA politica que
         src/lib/logger/redact.ts de la Fase 00.
FR-2409  Cada fila registrara la IP, el user-agent y el request_id del
         visitante cuando la peticion los traiga.
FR-2410  Una IP mal formada se guardara como NULL, sin romper la escritura.
FR-2411  Se auditaran las nueve acciones que §17 enumera.
FR-2412  Cada accion tendra un nombre semantico, no `update`.
FR-2413  audit.view permitira leer la auditoria del propio tenant.
FR-2414  Un platform admin podra leer la de cualquiera.
FR-2415  Un tenant no leera la auditoria de otro.
FR-2416  /api/health comprobara la base de datos y medira su latencia.
FR-2417  /api/health respondera 503 y `degraded` cuando una dependencia
         falle.
FR-2418  Un error de servidor no capturado se registrara con su ruta, su
         tipo de router y su request_id.
FR-2419  El Super Admin vera el estado del sistema y sus numeros.
FR-2420  platform_diagnostics() solo respondera a un platform admin.
```

---

## 7. Requerimientos no funcionales

```text
NFR-2401 Imposible de olvidar
         La auditoria la escriben triggers. Un invariante que depende de que
         cada escritor se acuerde no es un invariante - la frase que este
         proyecto lleva repitiendo desde la Fase 13.

NFR-2402 Ningun secreto, nunca (§17)
         La redaccion es por patron sobre el nombre de la clave, asi que una
         columna futura llamada `stripe_api_key` queda cubierta el dia que
         se cree, sin que nadie actualice una lista.

NFR-2403 Correlacionable
         El mismo request_id aparece en el log de la aplicacion y en la fila
         de auditoria. Es lo que convierte "algo fallo" en "esto fallo".

NFR-2404 El fallo es la respuesta
         Un health check que devuelve `ok` porque el proceso vive, mientras
         la base no responde, es peor que no tenerlo.

NFR-2405 Coste acotado
         Un trigger de auditoria corre en cada escritura auditada. Se
         auditan nueve acciones, no todas: ver ADR-028 decision 3.

NFR-2406 Seguridad
         audit_logs es legible por audit.view en el propio tenant o por un
         platform admin, y escribible por nadie.
```

---

## 8. Modelo de datos

### audit_logs

```text
id          UUID PK
tenant_id   UUID NOT NULL -> tenants ON DELETE CASCADE
user_id     UUID                SIN clave foranea, a proposito
user_email  TEXT                snapshot del actor      <=320
action      TEXT NOT NULL       ^[a-z_]+\.[a-z_]+$
entity_type TEXT NOT NULL       la tabla
entity_id   UUID                la fila
old_values  JSONB
new_values  JSONB
ip_address  INET
user_agent  TEXT                <=500
request_id  TEXT                <=200
created_at  TIMESTAMPTZ NOT NULL

INDEX (tenant_id, created_at DESC)
INDEX (tenant_id, action, created_at DESC)
INDEX (entity_type, entity_id)
INDEX (request_id) WHERE request_id IS NOT NULL

CHECK old_values IS NOT NULL OR new_values IS NOT NULL
```

`user_id` es nullable a propósito: un cambio hecho por una migración, por el
ciclo de cobranza o desde la consola SQL no tiene usuario, y registrarlo como
`NULL` es más honesto que atribuirlo a alguien.

**Y no tiene clave foránea.** `auth.users` cascadea a `profiles`, así que un
`references auth.users` sólo admitiría dos finales al borrar un usuario:
`cascade`, que borra la auditoría de lo que esa persona hizo, o `set null`, que
borra la prueba de quién lo hizo. Los dos destruyen aquello para lo que existe
la tabla. Por eso `user_email` guarda el correo copiado — disciplina de
snapshot (ADR-017) aplicada al actor. Ver ADR-028 decisión 5.

**Por qué JSONB aquí sí.** §7 dice que no se creen columnas JSON
arbitrariamente cuando una estructura relacional sea mejor, y admite JSONB
para _"configuraciones dinámicas justificadas"_. El antes y el después de una
fila tienen la forma de la tabla que cambió: quince triggers escriben quince
formas distintas. Una estructura relacional aquí sería una tabla de pares
clave-valor, que es JSONB con más pasos.

### Funciones

```text
audit_is_sensitive_key(text) -> boolean
  El espejo SQL de isSensitiveKey() de la Fase 00: normaliza el nombre y lo
  compara con los mismos diecinueve patrones.

audit_redact(jsonb) -> jsonb
  Sustituye por [REDACTED] el valor de toda clave sensible, dejando la clave
  en su sitio. Recursiva sobre objetos anidados.

audit_request_header(text) -> text
  Lee una cabecera del GUC `request.headers` que PostgREST rellena.
  NULL cuando no hay peticion HTTP (una migracion, un test, la consola).

audit_client_ip() -> inet
  La IP del visitante, o NULL si no llega o esta mal formada.

audit_row_change() -> trigger
  El escritor. Toma el nombre de la accion de TG_ARGV[0].

platform_diagnostics() -> table(...)
  Los numeros del sistema. Solo para platform admin.
```

### Las nueve acciones de §17, y sus quince triggers

```text
§17                       accion                       tabla
precio modificado         product.price_changed        products
producto eliminado        product.deleted              products
pedido cancelado          order.cancelled              orders
usuario creado            member.added                 tenant_members
rol modificado            member.role_changed          tenant_members
configuracion SUNAT       billing_config.changed       billing_provider_configs
cierre de caja            cash_session.closed          cash_sessions
devolucion                payment.voided               payments
                          stock.returned               stock_movements
documento anulado         billing_document.cancelled   billing_documents

Y cinco mas de la misma naturaleza, que §17 no nombra sólo porque su lista
dice "ejemplos":
                          product.created              products
                          member.status_changed        tenant_members
                          member.removed               tenant_members
                          settings.changed             tenant_settings
                          loyalty.adjusted             loyalty_transactions

`member.status_changed` es el menos obvio y el mas necesario: suspender a
alguien y readmitirlo cambia quien puede entrar al sistema sin cambiar
ningun rol, asi que sin el la auditoria de accesos tendria un hueco.
```

---

## 9. Diagrama de relaciones

```text
   navegador
      │  ip, user-agent, x-request-id
      ▼
   Next.js  ──► createSupabaseServerClient()
                     │  reenvia como cabeceras propias
                     ▼
                 PostgREST ──► request.headers (GUC)
                                    │
   UPDATE products ──► trigger ──► audit_row_change()
                                    │
                                    ├─ auth.uid()          quien
                                    ├─ audit_client_ip()   desde donde
                                    ├─ audit_redact(...)   sin secretos
                                    ▼
                                audit_logs
                                    │
              ┌─────────────────────┴─────────────────────┐
              ▼                                           ▼
     /dashboard/{slug}/auditoria              /super-admin/diagnostico
        (audit.view, su tenant)                   (platform admin)
```

---

## 10. Tenant Isolation

```text
¿Como se determina el tenant?
  Del propio registro que cambio: el trigger lee `new.tenant_id` o
  `old.tenant_id`. Toda tabla auditada lo tiene.

¿Que tablas llevan tenant_id?
  audit_logs, la unica nueva.

¿Como evita RLS el acceso cross-tenant?
  SELECT predicado sobre has_permission(tenant_id, 'audit.view') o
  is_platform_admin(). Sin politica de escritura para nadie, asi que no hay
  camino por el que un tenant escriba en el registro de otro.

¿Existe algun recurso global?
  No. platform_diagnostics() devuelve numeros agregados de toda la
  plataforma y por eso exige platform admin.
```

---

## 11. Seguridad

```text
Authorization
  audit.view - permiso NUEVO, el primero desde la Fase 20.

  Se crea porque gobierna algo distinto de lo que gobierna cualquier
  permiso existente: leer quien hizo que es una capacidad que un dueno
  puede querer dar a su contador sin darle `settings.manage`. Es la misma
  prueba que ADR-025 aplico para NO crear permisos en las Fases 21-23, y
  aqui da el resultado contrario.

Roles que lo tienen
  owner, admin, accountant.
  manager, cashier, waiter, kitchen, delivery: no. Auditar es una funcion
  de control, y quien opera no controla su propia operacion.

RLS policies
  audit_logs   SELECT audit.view en su tenant, o platform admin
               sin INSERT, sin UPDATE, sin DELETE - para nadie

Por que ni siquiera un platform admin puede escribir
  Un registro que alguien puede escribir es un registro que alguien puede
  fabricar, y entonces deja de servir para lo unico que sirve. Es la misma
  postura, por la misma razon, que subscription_events (ADR-026 decision 4).

Secretos (§17)
  La redaccion es por PATRON sobre el nombre de la clave, no por lista.
  `credentials_secret_id` de billing_provider_configs cae por contener
  "credential"; una columna futura llamada `stripe_api_key` caeria el dia
  que exista, sin que nadie actualice nada. TEST-2412 lo prueba con una
  clave inventada que no existe en el esquema.

Potential abuse cases
  Fabricar una entrada de auditoria     -> no hay politica INSERT
  Borrar la prueba de lo que uno hizo   -> no hay politica DELETE
  Leer la auditoria de otro negocio     -> RLS por tenant
  Un cajero leyendo quien le audita     -> no tiene audit.view
  Sacar una credencial de la auditoria  -> redactada por patron
  Falsear la IP                         -> es una cabecera del cliente; ver
                                           KL-2403
```

---

## 12. API / Server Actions

**Ninguna Server Action escribe auditoría**, y eso es el diseño: la escriben
triggers.

```text
GET /api/health
  Publico. Comprueba proceso y base de datos.
  200 {status:"ok", checks:[...]}         todo bien
  503 {status:"degraded", checks:[...]}   una dependencia fallo

SQL
  platform_diagnostics() -> table(
    tenants, active_subscriptions, suspended_subscriptions,
    orders_last_24h, audit_rows_last_24h, oldest_pending_charge
  )
  Solo platform admin: cero filas para cualquier otro.

src/instrumentation.ts
  onRequestError(error, request, context) -> void
  El hook nativo de Next.js. Registra ruta, metodo, tipo de router, digest
  y request_id de todo error de servidor no capturado.
```

---

## 13. UI / UX

```text
/dashboard/{slug}/auditoria
  Proposito     quien cambio que en este negocio
  Acciones      filtrar por accion; ver el antes y el despues
  Estados       empty ("Todavia no hay nada que auditar.")
  Permissions   audit.view

/super-admin/diagnostico
  Proposito     el estado del sistema y sus numeros
  Acciones      ninguna: se mira
  Estados       la base caida se muestra como tal, la pagina no se rompe
  Permissions   platform admin
```

---

## 14. Flujos principales

```text
Auditar un cambio
  el navegador manda su peticion a Next.js
      ↓
  createSupabaseServerClient() adjunta ip, user-agent y request_id
      ↓
  UPDATE products SET base_price_cents = ...
      ↓
  trigger products_audit_price (WHEN el precio cambio de verdad)
      ↓
  audit_row_change('product.price_changed')
      ↓
  auth.uid() + audit_client_ip() + audit_redact(old) + audit_redact(new)
      ↓
  una fila en audit_logs

Un error de servidor
  algo lanza en un Server Component
      ↓
  Next.js llama a onRequestError
      ↓
  logger.error con ruta, router, digest y request_id
      ↓
  la misma peticion ya escribio ese request_id en sus filas de auditoria
```

---

## 15. Manejo de errores

```text
IP mal formada              -> NULL, sin romper la escritura
Sin peticion HTTP           -> ip, user-agent y request_id en NULL
User-agent larguisimo       -> se corta a 500
Base caida en /api/health   -> 503 con `degraded` y el detalle
Base caida en /diagnostico  -> la pagina lo dice, no se rompe
Sin audit.view              -> 404 en la pagina
platform_diagnostics sin
  ser admin                 -> cero filas
```

---

## 16. Observabilidad

Esta es la fase que **es** la observabilidad, así que aquí va lo que queda
después de ella:

```text
audit.viewed          quien miro la auditoria de quien
diagnostics.viewed    quien miro el diagnostico
app.request.failed    de onRequestError: ruta, router, digest, request_id
health.degraded       cuando una dependencia falla la comprobacion

Y todo lo anterior sigue: cada fase desde la 01 escribe sus eventos
estructurados con `tenantId`, y desde esta fase todos comparten el
request_id de su peticion.
```

---

## 17. Testing Plan

### Unit

```text
TEST-2401  El health check compone `ok` con todas las comprobaciones bien.
TEST-2402  Compone `degraded` cuando una falla, y elige 503.
TEST-2403  La accion de auditoria se etiqueta en espanol para la pantalla.
TEST-2404  El nombre de toda accion respeta el formato `dominio.accion`.
TEST-2405  Los filtros de la pantalla aceptan una accion conocida y
           descartan una inventada.
```

### Database (`src/tests/database/audit.test.ts`)

```text
TEST-2410  audit_logs tiene RLS y ninguna politica de escritura.
TEST-2411  Un INSERT directo se rechaza, incluso siendo platform admin.
TEST-2412  audit_redact tapa toda clave sensible - incluida `stripe_api_key`,
           que no existe en el esquema.
TEST-2413  audit_redact es recursiva sobre objetos anidados.
TEST-2414  audit_redact deja intacto lo que no es secreto, y conserva la
           clave tapada en su sitio.
TEST-2415  Cambiar un precio escribe product.price_changed con el antes y
           el despues.
TEST-2416  Cambiar otra columna del producto NO escribe price_changed.
TEST-2417  Borrar un producto escribe product.deleted sin new_values.
TEST-2418  Crear un producto escribe product.created sin old_values.
TEST-2419  Anular un pedido escribe order.cancelled.
TEST-2420  Avanzar un pedido sin anularlo no escribe nada.
TEST-2421  Anadir un miembro escribe member.added.
TEST-2422  Cambiar un rol escribe member.role_changed con los dos roles.
TEST-2423  Retirar un miembro escribe member.removed.
TEST-2424  Cerrar caja escribe cash_session.closed.
TEST-2425  Anular un pago escribe payment.voided.
TEST-2426  Anular un documento escribe billing_document.cancelled.
TEST-2427  Tocar la configuracion de facturacion escribe
           billing_config.changed SIN la referencia a la credencial.
TEST-2428  Un movimiento de devolucion escribe stock.returned.
TEST-2429  La fila registra el usuario que la provoco.
TEST-2430  Sin peticion HTTP, ip/user-agent/request_id quedan en NULL.
TEST-2431  Con cabeceras, la fila las guarda.
TEST-2432  Una IP mal formada no rompe la escritura y queda en NULL.
TEST-2433  Un user-agent larguisimo se corta.
TEST-2434  Sin audit.view no se lee nada.
TEST-2435  Un tenant no lee la auditoria de otro.
TEST-2436  Un platform admin lee la de cualquiera.
TEST-2437  platform_diagnostics devuelve cero filas a quien no es admin.
TEST-2438  platform_diagnostics cuenta lo que dice contar.
TEST-2439  waiter, kitchen, cashier, manager y delivery no reciben
           audit.view.
TEST-2440  audit_is_sensitive_key y isSensitiveKey (Fase 00) coinciden sobre
           la misma lista de nombres, sensibles e inocentes.
TEST-2441  Borrar un tenant no falla por su auditoria, y se la lleva.
TEST-2442  La fila guarda el correo del actor, y sobrevive a que ese
           usuario desaparezca.
```

### Regression

```text
schema/contract    audit_logs entra en las listas
isolation          RLS en toda tabla nueva, sin cambios en el test
Todas las fases    los quince triggers corren sobre tablas que ya tenian
                   tests; si alguno rompiera una escritura, caerian esos
```

---

## 18. Edge Cases

```text
Cambio hecho por una migracion    -> user_id NULL, y es lo honesto
Cambio hecho por el ciclo SaaS    -> idem
Tenant borrado                    -> CASCADE se lleva su auditoria
Usuario borrado                   -> SET NULL; la fila sobrevive
x-forwarded-for con varias IPs    -> se guarda la primera, que es el cliente
IP invalida ("unknown")           -> NULL
Sin user-agent                    -> NULL
Objeto anidado con un secreto     -> redactado tambien
UPDATE que no cambia nada         -> el WHEN del trigger lo descarta
Base caida durante /api/health    -> 503, y el proceso sigue vivo
```

---

## 19. Performance considerations

```text
Coste de escritura
  Un trigger AFTER por accion auditada. Quince triggers sobre once
  tablas, y cada uno con un WHEN que descarta la mayoria de los UPDATE
  antes de ejecutar nada. Un pedido que avanza de `preparing` a `ready` no
  paga ningun coste de auditoria.

Coste de lectura
  (tenant_id, created_at desc)          la pantalla
  (tenant_id, action, created_at desc)  filtrada por accion
  (entity_type, entity_id)              "que le paso a esta fila"
  (request_id) parcial                  cruzar con el log

Crecimiento
  audit_logs solo crece. No se purga (KL-2402), y con el volumen de estas
  nueve acciones el crecimiento es de decenas de filas por dia y negocio,
  no de miles. Medirlo es la Fase 26.
```

---

## 20. Migraciones

```text
20260830160000_create_audit_permissions.sql
  audit.view + grants por rol

20260830160100_create_audit_logs.sql
  audit_logs, audit_redact, audit_request_header, audit_client_ip,
  audit_row_change + RLS

20260830160200_create_audit_triggers.sql
  los quince triggers de las nueve acciones de §17

20260830160300_create_platform_diagnostics.sql
  platform_diagnostics()
```

---

## 21. Rollback

```text
  drop function public.platform_diagnostics();
  -- los triggers caen con la tabla que los soporta? NO: cuelgan de tablas
  -- de negocio, asi que hay que soltarlos uno a uno ANTES de la funcion:
  drop trigger products_audit_price on public.products;   -- ...y los otros trece
  drop function public.audit_row_change();
  drop function public.audit_client_ip();
  drop function public.audit_request_header(text);
  drop function public.audit_redact(jsonb);
  drop function public.audit_is_sensitive_key(text);
  drop table public.audit_logs;
  delete from public.role_permissions where permission = 'audit.view';
  delete from public.permissions where code = 'audit.view';

CRITICO
  Los quince triggers NO cuelgan de audit_logs sino de las tablas de
  negocio, asi que `drop table audit_logs` fallaria por dependencia. Hay
  que soltarlos primero, o usar CASCADE a sabiendas.

El resto del rollback es barato: la aplicacion vuelve a la observabilidad
de la Fase 00 (logging y un health check de proceso), y no se pierde ningun
dato de negocio - audit_logs no es la fuente de verdad de nada.
```

---

## 22. Definition of Done

- [x] `audit_logs` con el modelo exacto de §17, más `request_id`
- [x] Sin política de escritura: ni INSERT, ni UPDATE, ni DELETE, para nadie
- [x] Quince triggers cubriendo las nueve acciones de §17
- [x] Redacción por patrón, con la misma política que el logger de la Fase 00
- [x] Probada con una clave inexistente y contra `isSensitiveKey`
- [x] `user_id` sin clave foránea, con el correo del actor copiado en la fila
- [x] IP, user-agent y request_id reenviados desde la petición
- [x] `audit.view`, en SQL y en el espejo TypeScript
- [x] `src/instrumentation.ts` con `onRequestError`
- [x] `/api/health` comprueba la base y responde `degraded` con 503
- [x] `platform_diagnostics()` sólo para platform admin
- [x] Pantallas de auditoría y de diagnóstico
- [x] Unit tests PASS
- [x] Database tests PASS (aislamiento cross-tenant incluido)
- [x] `schema-contract` actualizado
- [x] Lint / Typecheck / Build PASS
- [x] SPEC actualizado
- [x] ADR-028 escrito
- [x] `docs/architecture/` actualizado

---

## 23. Implementation notes

### El `WHEN` del trigger es lo que hace barata la auditoría

Quince triggers sobre once tablas suena caro hasta que se mira dónde están:

```sql
create trigger products_audit_price
  after update of base_price_cents on public.products
  for each row when (old.base_price_cents is distinct from new.base_price_cents)
  execute function public.audit_row_change('product.price_changed');
```

`after update OF base_price_cents` ya descarta cualquier `UPDATE` que no toque
esa columna, y el `WHEN` descarta los que la tocan sin cambiarla. Un pedido
avanzando de `preparing` a `ready` —la escritura más frecuente del sistema— no
ejecuta una sola línea de código de auditoría.

Es la misma técnica que la Fase 18 usó para el consumo de stock, aplicada
quince veces.

### La redacción tenía que ser por patrón, y se probó con una columna inventada

§17 dice _"nunca guardar passwords, tokens o secretos"_. Una lista de columnas
prohibidas cumple eso **hoy** y falla el día que alguien añada una columna
nueva sin acordarse de la lista — que es exactamente el modo de fallo que este
proyecto lleva veintitrés fases evitando.

Así que `audit_redact()` decide por el **nombre** de la clave, normalizado
igual que en TypeScript —minúsculas, sin caracteres no alfanuméricos— y contra
los mismos diecinueve patrones que `src/lib/logger/redact.ts` aplica desde la
Fase 00:

```sql
regexp_replace(lower(key), '[^a-z0-9]', '', 'g') ~
  'pass(word|wd|phrase)?$|^pwd$|secret|token|apikey|authorization|^auth$|...'
```

Y **sustituye el valor por `[REDACTED]` en vez de borrar la clave**, el mismo
sentinela que el logger: borrarla haría indistinguible "este campo no cambió"
de "este campo cambió y no te lo enseño", y la segunda es información que un
auditor quiere.

Dos comprobaciones, y la segunda es la que de verdad importa:

- TEST-2412 lo prueba con un objeto que contiene `stripe_api_key` — una
  columna que no existe en ningún sitio del esquema — para demostrar que la
  regla cubre lo que todavía no se ha escrito.
- TEST-2440 importa `isSensitiveKey` de la Fase 00 y comprueba, sobre la misma
  lista de nombres, que SQL y TypeScript dan la misma respuesta. Dos copias de
  una política que nadie compara son dos políticas.

### El health check se tragaba la señal de Next.js, y el build lo dijo

`checkDatabase()` no puede lanzar —un health check que falla con una excepción
no informa nada justo cuando más falta hace— así que envuelve todo en un
`try/catch`. Y eso, la primera vez, capturó algo que no era un fallo.

`cookies()` **lanza a propósito** durante el prerenderizado estático: así es
como Next.js se entera de que una ruta es dinámica. El `catch` la atrapaba, la
registraba como `health.dependency_failed` con `failure: "unreachable"`, y —lo
peor— impedía que Next.js viera la señal. El build lo dejó por escrito:

```text
{"event":"health.dependency_failed","failure":"unreachable",
 "error":{"message":"Dynamic server usage: Route /super-admin/diagnostico
           couldn't be rendered statically because it used `cookies`"}}
```

Una base de datos perfectamente sana, reportada como caída, en el build.

La solución es `unstable_rethrow(error)` como **primera línea** del `catch`:
relanza lo que pertenece al framework —el aviso de ruta dinámica, `redirect()`,
`notFound()`— y deja pasar sólo los errores de verdad. Está aplicado en los dos
sitios donde esta fase captura de forma amplia: `checkDatabase()` y
`getRequestContext()`. La prueba es el build: la línea de arriba desapareció.

### Lo que se verificó y lo que no

```text
Verificado con PGlite (PostgreSQL real, migraciones reales, politicas
reales), incluido el camino de las cabeceras: los tests fijan
`request.headers` con set_config, que es exactamente lo que PostgREST hace
en produccion, y comprueban que la fila sale con su IP y su user-agent.

NO verificado contra un Supabase desplegado: que supabase-js reenvie de
verdad las cabeceras `global.headers` en cada peticion, y que PostgREST las
ponga en `request.headers`, es comportamiento documentado de ambos pero no
esta ejecutado aqui. Es la unica parte de esta fase que depende de la
plataforma, y esta aislada en una funcion (`audit_request_header`) que
devuelve NULL si el GUC no esta - asi que su peor caso es una auditoria sin
IP, nunca una escritura rota. Ver KL-2401.
```

---

## 24. Known limitations

```text
KL-2401  El reenvio de cabeceras no esta probado contra un Supabase real.
         Que supabase-js mande `global.headers` y que PostgREST las exponga
         en `request.headers` es comportamiento documentado de ambos, y el
         diseno degrada a NULL si algo falla - una auditoria sin IP, nunca
         una escritura rota. Dueno: Fase 25, con la primera revision contra
         un entorno desplegado.

KL-2402  audit_logs no se purga nunca. Cuanto tiempo debe guardarse un
         registro de auditoria es politica legal y de negocio que nadie ha
         fijado, y borrar por defecto seria peor que crecer. Dueno: Fase 27,
         que es la de retencion y backups.

KL-2403  La IP viene de una cabecera del cliente (`x-forwarded-for`), asi
         que un cliente puede mentirla. Es igual de cierto en cualquier
         sistema detras de un proxy, y en produccion Vercel la reescribe.
         El user_id, que es lo que de verdad importa, sale de auth.uid() y
         NO se puede falsear. Dueno: ninguno; es la naturaleza del dato.

KL-2404  No hay proveedor de error tracking. `onRequestError` escribe al
         logger estructurado, y es el punto unico donde un adapter de Sentry
         entrara sin tocar nada mas (§44, precedente de ADR-021). Dueno:
         cuando se contrate uno.

KL-2405  No hay metricas de series temporales. Hay numeros que un humano
         mira en una pantalla, que es lo que §33 pide para el Super Admin.
         Exportar a Prometheus necesita un colector que nadie ha montado
         (§47). Dueno: Fase 26 si se mide que hace falta.

KL-2406  No hay alertas. Una alerta necesita a donde mandarla, y
         MessagingProvider (§44) no existe. Dueno: cuando exista.

KL-2407  Los historiales de dominio y la auditoria se solapan en cuatro
         acciones (pedido anulado, documento anulado, pago anulado, ajuste
         de puntos). Es deliberado: responden preguntas distintas
         (ADR-028 decision 3) y ninguna es derivable de la otra sin perder
         algo. El coste es una fila de mas por accion. Dueno: ninguno.
```

---

## 25. Future considerations

```text
Fase 25 (Security hardening)  la auditoria es una de las cosas que esa fase
                              revisara, y KL-2401 es una entrada directa
                              para ella.
Fase 26 (Performance)         platform_diagnostics ya da los numeros de
                              partida; KL-2405 dice que medir antes de
                              exportar metricas.
Fase 27 (Backups)             audit_logs es dato que no se puede regenerar:
                              su politica de retencion y de respaldo es de
                              esa fase (KL-2402).
Un adapter de Sentry          entra en onRequestError, en un sitio, sin
                              tocar ninguna llamada.
Mas acciones auditadas        anadir una es un trigger de tres lineas con
                              su WHEN; el escritor generico ya existe.
```
