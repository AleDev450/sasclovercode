# SPEC — Phase 21 — SaaS Modules + Plans

## 1. Información general

```text
Phase:                21
Nombre:               SaaS Modules + Plans
Estado:               COMPLETED
Versión:              1.0.0
Fecha creación:       2026-08-30
Última actualización: 2026-08-30
Responsable:          alejandro.avendano@masuno.pe
```

Documento maestro: §33 (Fase 21), §45 (feature flags), §29 (Super Admin).
Fases previas: 00 a 20 — todas COMPLETED y auditadas.
ADR: [025 — Resolución central de módulos y provisión no destructiva](../adr/025-central-module-resolution-and-non-destructive-provisioning.md).

---

## 2. Objetivo

### ¿Por qué existe esta fase?

Master §33, Fase 21, textual y completo:

> Implementar: modules, plans, plan_modules, tenant_modules, subscriptions.
> Ejemplos módulos: website, catalog, orders, pos, inventory, billing,
> delivery, loyalty, multi_location, reports.
> Features deben evaluarse centralmente.
> No llenar la aplicación de condiciones dispersas.
> Crear: `hasFeature()`, `requireFeature()` o equivalente.

Veinte fases han construido capacidades y **todas están encendidas para todos**.
Un negocio que solo quiere una web con su carta ve el POS, el inventario y la
facturación electrónica en su menú. CloverCode no puede vender planes porque no
sabe qué incluye un plan.

Esta fase es la que convierte veinte módulos en un producto vendible, y lo hace
con una sola regla: **la pregunta "¿esto está disponible?" se responde en un
solo sitio**.

### ¿Qué debe ser posible al terminarla?

```text
Declarar que planes existe CloverCode y que modulos incluye cada uno.
Suscribir un negocio a un plan, con su estado y su periodo.
Conceder o retirar un modulo suelto a un negocio concreto, por encima de lo
  que su plan diga, sin inventar un plan nuevo para una excepcion.
Preguntar has_module(tenant, 'pos') desde SQL y hasFeature() desde
  TypeScript, y que las dos respondan lo mismo porque son la misma consulta.
Que el menu no dibuje lo que el plan no incluye, y que la pagina lo
  rechace igualmente si alguien escribe la URL.
Que suspender una suscripcion apague el producto sin borrar un solo dato.
Que el Super Admin cambie el plan de un negocio y vea el efecto al momento.
```

---

## 3. Alcance

### Incluido

```text
modules, plans, plan_modules, tenant_modules, subscriptions - las cinco
  tablas exactas de §33, con los diez modulos que §33 enumera.
Enums plan_interval (monthly, yearly) y subscription_status (trialing,
  active, past_due, suspended, cancelled).
has_module(tenant_id, module) y my_modules(tenant_id) en SQL - el mismo
  par que has_permission/my_permissions establecio en la Fase 03.
src/lib/features: hasFeature(), requireFeature(), myModules() - la capa
  que §33 pide por su nombre.
Navegacion filtrada por modulo ADEMAS de por permiso.
Cada pagina de un modulo comprueba su propio modulo, porque ocultar no es
  seguridad (§45).
Un guard en `locations`: multi_location es lo que permite una SEGUNDA sede.
  El unico modulo de la lista que gobierna un dato y no una pantalla.
create_tenant_defaults() extendido por sexta vez: cada tenant nuevo recibe
  una suscripcion al plan por defecto.
Backfill de los tenants existentes en la propia migracion.
Super Admin: cambiar plan, cambiar estado, y conceder/retirar modulos
  sueltos de un tenant.
Pantalla /configuracion/plan para que el negocio vea que tiene contratado.
```

### Fuera de alcance

```text
Cobrar. Esta fase declara planes con un precio y no le cobra a nadie: eso
  es la Fase 22, que master separa explicitamente (§22: la facturacion del
  restaurante NO es la suscripcion que CloverCode cobra al restaurante).
  `plans.price_cents` existe para que la Fase 22 tenga de donde leerlo.
Cambiar de plan solo, prorrateos, o un ciclo de facturacion que avance con
  el calendario. Nada de eso lo pide §33 y todo necesita un scheduler que
  ninguna fase ha montado (§47). Ver seccion 24, KL-2103.
Suspender automaticamente por impago. `past_due` existe y sigue dando
  acceso a proposito; quien suspende es una persona. Ver ADR-025 decision 3.
Limites cuantitativos por plan (X productos, Y usuarios, Z sedes). §33
  habla de modulos, no de cupos. La unica excepcion es multi_location,
  porque ES un modulo de la lista y su significado es un limite.
Autoservicio de planes para el tenant. Cambiar de plan es una operacion de
  Super Admin (§29), no un boton en el dashboard del cliente.
```

### La decisión de alcance que más costó

**Qué plan recibe un tenant nuevo, y qué pasa con los veinte que ya existen.**

Encender un paywall sobre un producto que lleva veinte fases con todo abierto
es la clase de cambio que rompe cosas en silencio. Si `has_module()` devuelve
`false` por defecto, todo tenant sin suscripción pierde el acceso a todo; si
devuelve `true` por defecto, el paywall es decorativo y el primer bug de
provisión se lo salta.

Se eligió: **fail-closed en la función, y provisión explícita para todos**. La
migración da de alta una suscripción al plan por defecto para cada tenant
existente, y `create_tenant_defaults()` la crea para cada tenant futuro. La
función no tiene rama "sin suscripción = permitido".

Y el plan por defecto **incluye los diez módulos**, porque CloverCode todavía
no cobra: reducir capacidad a un cliente que nunca aceptó un plan menor sería
una decisión comercial tomada por una migración. Cuando la Fase 22 empiece a
cobrar, cambiar el defecto es una fila. Ver ADR-025 decisión 4.

---

## 4. Dependencias

```text
Phase 03 — Authorization      has_permission/my_permissions es el patron que
                               has_module/my_modules copia exactamente
Phase 04 — Super Admin        quien cambia un plan; platform_admins ya existe
Phase 05 — Tenant Dashboard   la navegacion que ahora filtra por modulo
Phase 10 — Locations          multi_location gobierna la segunda sede
Phases 06-20                  los diez modulos que se declaran ya existen:
                               esta fase no construye capacidad, la gobierna
ADR-010 — RBAC                se pide una capacidad, nunca se compara un rol;
                               aqui igual: se pide un modulo
ADR-011 — Platform identity   el Super Admin no es un OWNER con mas permisos
```

---

## 5. Casos de uso

```text
UC-2101
Como Super Admin
quiero cambiar el plan de un negocio
para que su menu refleje lo que contrato.

  Actor          platform admin
  Precondiciones el tenant tiene suscripcion
  Accion         elegir otro plan y guardar
  Resultado      has_module cambia al instante para ese tenant
  Errores        plan inexistente o inactivo -> se rechaza

UC-2102
Como Super Admin
quiero conceder un modulo suelto
para atender una excepcion sin inventar un plan.

  Actor          platform admin
  Precondiciones ninguna
  Accion         activar 'inventory' para ese tenant
  Resultado      tenant_modules gana una fila; gana el modulo aunque su
                 plan no lo incluya
  Errores        modulo inexistente -> se rechaza

UC-2103
Como Super Admin
quiero suspender una suscripcion
para cortar el servicio sin borrar nada.

  Actor          platform admin
  Accion         cambiar el estado a `suspended`
  Resultado      has_module devuelve false para todo; los datos siguen ahi
  Errores        ninguno

UC-2104
Como duena del negocio
quiero ver que incluye mi plan
para saber que estoy pagando.

  Actor          owner (settings.manage)
  Accion         abrir /configuracion/plan
  Resultado      su plan, su estado y sus modulos, en solo lectura
  Errores        sin permiso -> 404

UC-2105
Como usuario de un tenant sin el modulo
quiero que el sistema no me ofrezca lo que no tengo
para no chocar con una puerta cerrada.

  Actor          cualquier miembro
  Accion         mirar el menu, o escribir /dashboard/x/pos a mano
  Resultado      la entrada no se dibuja; la URL responde 404
  Errores        ninguno: son los dos resultados correctos
```

---

## 6. Requerimientos funcionales

```text
FR-2101  Existira un catalogo global de modulos con los diez codigos de §33.
FR-2102  Existira un catalogo global de planes.
FR-2103  Un plan declarara que modulos incluye.
FR-2104  Exactamente un plan sera el plan por defecto.
FR-2105  Un tenant tendra a lo sumo una suscripcion.
FR-2106  Una suscripcion nombrara un plan y tendra un estado.
FR-2107  Los estados seran trialing, active, past_due, suspended, cancelled.
FR-2108  trialing, active y past_due daran acceso; suspended y cancelled no.
FR-2109  Un tenant podra tener overrides por modulo, que ganan al plan en
         las dos direcciones: conceden lo que el plan no da, y retiran lo
         que el plan da.
FR-2110  has_module(tenant, modulo) resolvera override, luego plan, luego
         false. Nunca true por ausencia de suscripcion.
FR-2111  my_modules(tenant) devolvera todos los modulos habilitados.
FR-2112  hasFeature() y requireFeature() existiran en TypeScript y
         resolveran contra la misma funcion SQL.
FR-2113  requireFeature() lanzara AuthorizationError cuando el modulo no
         este disponible.
FR-2114  La navegacion no dibujara la entrada de un modulo no disponible.
FR-2115  Cada pagina de un modulo comprobara su modulo y respondera 404.
FR-2116  Un tenant sin multi_location no podra tener una segunda sede
         activa.
FR-2117  Cada tenant nuevo recibira una suscripcion al plan por defecto.
FR-2118  Los tenants existentes recibiran la misma suscripcion en la
         migracion, sin perder acceso a nada.
FR-2119  El catalogo de modulos y planes sera legible por cualquier miembro
         autenticado; no contiene datos de ningun negocio.
FR-2120  subscriptions y tenant_modules solo seran escribibles por un
         platform admin.
```

---

## 7. Requerimientos no funcionales

```text
NFR-2101 Seguridad
         Ocultar una entrada del menu NO es control de acceso (§45). Cada
         pagina comprueba su modulo por su cuenta, y responde 404 en vez de
         403 para no confirmar que la seccion existe.
         Ninguna escritura sobre subscriptions o tenant_modules es posible
         desde un tenant: solo platform admin.

NFR-2102 Fail-closed
         has_module() no tiene ninguna rama que devuelva true por falta de
         datos. Un tenant sin suscripcion no tiene modulos.

NFR-2103 Performance
         my_modules() devuelve el conjunto entero en una consulta, para que
         el layout no haga una comprobacion por entrada de menu - el mismo
         N+1 de autorizacion que my_permissions evito en la Fase 03.
         El resultado se cachea por request con React `cache`, igual que
         los permisos.

NFR-2104 No destructivo
         La migracion no quita capacidad a ningun tenant existente.

NFR-2105 Observabilidad
         Eventos subscription.* y tenant_module.* con tenantId y plan.

NFR-2106 Mantenibilidad
         La respuesta a "¿esta disponible?" vive en UNA funcion SQL y una
         capa TypeScript sobre ella. Master §33 lo pide con estas palabras:
         "No llenar la aplicacion de condiciones dispersas".
```

---

## 8. Modelo de datos

### Enums nuevos

```text
plan_interval        monthly | yearly
subscription_status  trialing | active | past_due | suspended | cancelled
```

### modules

```text
code        TEXT PK          ^[a-z_]+$
name        TEXT NOT NULL
description TEXT
position    SMALLINT NOT NULL default 0
created_at  TIMESTAMPTZ NOT NULL
```

Los diez de §33: `website`, `catalog`, `orders`, `pos`, `inventory`,
`billing`, `delivery`, `loyalty`, `multi_location`, `reports`.

### plans

```text
code        TEXT PK          ^[a-z_]+$
name        TEXT NOT NULL
description TEXT
price_cents BIGINT NOT NULL default 0     leido por la Fase 22
interval    plan_interval NOT NULL default 'monthly'
is_active   BOOLEAN NOT NULL default true
is_default  BOOLEAN NOT NULL default false
position    SMALLINT NOT NULL default 0
created_at  TIMESTAMPTZ NOT NULL

UNIQUE INDEX (is_default) WHERE is_default    exactamente uno
```

### plan_modules

```text
plan_code   TEXT NOT NULL -> plans ON DELETE CASCADE
module_code TEXT NOT NULL -> modules ON DELETE CASCADE
PK (plan_code, module_code)
INDEX (module_code)
```

### tenant_modules

```text
tenant_id   UUID NOT NULL -> tenants ON DELETE CASCADE
module_code TEXT NOT NULL -> modules ON DELETE CASCADE
is_enabled  BOOLEAN NOT NULL
note        TEXT               <=300
created_at  TIMESTAMPTZ NOT NULL
updated_at  TIMESTAMPTZ NOT NULL

PK (tenant_id, module_code)
```

`is_enabled` es `NOT NULL` y sin defecto a propósito: una fila aquí es una
decisión explícita en una dirección o en la otra, nunca "no sé".

### subscriptions

```text
id                   UUID PK
tenant_id            UUID NOT NULL UNIQUE -> tenants ON DELETE CASCADE
plan_code            TEXT NOT NULL -> plans ON DELETE RESTRICT
status               subscription_status NOT NULL default 'active'
trial_ends_at        TIMESTAMPTZ
current_period_start TIMESTAMPTZ NOT NULL default now()
current_period_end   TIMESTAMPTZ
cancelled_at         TIMESTAMPTZ
created_at           TIMESTAMPTZ NOT NULL
updated_at           TIMESTAMPTZ NOT NULL

INDEX (plan_code)
CHECK (status='cancelled') = (cancelled_at IS NOT NULL)
CHECK current_period_end IS NULL OR current_period_end > current_period_start
```

`ON DELETE RESTRICT` sobre el plan: borrar un plan que alguien tiene
contratado debe fallar ruidosamente, no dejar suscripciones huérfanas.

---

## 9. Diagrama de relaciones

```text
   modules ◄──────── plan_modules ────────► plans
      ▲                                       ▲
      │                                       │
      │                                  subscriptions
      │                                       │
 tenant_modules ──────────────────────────► tenants
   (override)                                 │
                                              │
                    has_module(tenant, code) ─┘
                              │
              ┌───────────────┴───────────────┐
              │                               │
        override existe?              plan lo incluye
        → su is_enabled               Y estado da acceso
                              │
                              ▼
                    my_modules() → nav + páginas
```

---

## 10. Tenant Isolation

```text
¿Como se determina el tenant?
  tenant_modules y subscriptions llevan tenant_id explicito, escrito
  unicamente por un platform admin.

¿Que tablas llevan tenant_id?
  tenant_modules y subscriptions. modules, plans y plan_modules NO: son el
  catalogo del PRODUCTO, no de ningun negocio - la misma naturaleza que
  roles/permissions/role_permissions (Fase 03) y las tablas de transiciones
  (Fases 13, 17, 19).

¿Como evita RLS el acceso cross-tenant?
  subscriptions y tenant_modules: SELECT para miembros del propio tenant
  (predicado sobre is_tenant_member) o para platform admins; escritura solo
  platform admin. Un tenant no puede darse un modulo a si mismo.

¿Existe algun recurso global?
  modules, plans y plan_modules, con `using (true)` para `authenticated` y
  read-only. Entran en la allowlist ya existente de isolation.test.ts.
```

---

## 11. Seguridad

```text
Authorization
  Ningun permiso nuevo. Deliberado: el gobierno de planes es del Super
  Admin (§29) y no de un rol de tenant, y la vista del propio plan cabe
  bajo `settings.manage`, que el owner ya tiene. Añadir permisos que solo
  el owner tendria seria vocabulario sin uso.

RLS policies
  modules, plans, plan_modules   SELECT authenticated, read-only
  subscriptions                  SELECT miembro del tenant o platform admin
                                 INSERT/UPDATE solo platform admin
                                 sin DELETE
  tenant_modules                 SELECT miembro del tenant o platform admin
                                 INSERT/UPDATE/DELETE solo platform admin

Por que un tenant puede LEER su suscripcion pero no tocarla
  Necesita saber que tiene contratado (UC-2104) y no debe poder ampliarlo.
  Es exactamente la asimetria que hace que un paywall sea un paywall.

Potential abuse cases
  Un owner se concede 'billing'          -> sin politica de escritura
  Un owner cambia su estado a 'active'   -> idem
  Un tenant lee el plan de otro          -> RLS por tenant
  Una URL escrita a mano                 -> requireFeature en la pagina
  Una suscripcion suspendida sigue
    operando por una pagina no gateada   -> TEST-2118 recorre las paginas
```

---

## 12. API / Server Actions

```text
setTenantPlanAction        platform admin
setSubscriptionStatusAction platform admin
setTenantModuleAction      platform admin   (conceder/retirar override)
clearTenantModuleAction    platform admin   (volver a lo que diga el plan)
```

Todas viven en `modules/platform/server/actions.ts`, junto al resto de lo
que gobierna el Super Admin, y todas empiezan por `requirePlatformAdmin()`.

```text
SQL
  has_module(p_tenant_id uuid, p_module text) -> boolean
  my_modules(p_tenant_id uuid) -> table(module text)

TypeScript (src/lib/features)
  hasFeature(tenantId, module) -> Promise<boolean>
  requireFeature(tenantId, module) -> Promise<void>   lanza AuthorizationError
  myModules(tenantId) -> Promise<ReadonlySet<ModuleCode>>
```

---

## 13. UI / UX

```text
/super-admin/tenants/{id}   (extendida)
  Cambio      tarjeta "Plan y modulos": plan actual, estado, y un
              interruptor por modulo con tres posiciones efectivas
              (segun el plan / forzado si / forzado no)
  Permissions platform admin

/dashboard/{slug}/configuracion/plan
  Proposito   que ve el negocio de lo que tiene contratado
  Estados     solo lectura; empty imposible (siempre hay suscripcion)
  Permissions settings.manage

Navegacion  (extendida)
  Cambio      cada entrada puede declarar un modulo ademas de un permiso;
              se dibuja solo si el usuario tiene el permiso Y el tenant
              tiene el modulo
```

---

## 14. Flujos principales

```text
Resolver un modulo
  has_module(tenant, 'pos')
      ↓
  ¿hay fila en tenant_modules?  → si: devuelve su is_enabled. FIN.
      ↓ no
  ¿la suscripcion esta en trialing/active/past_due?  → no: false. FIN.
      ↓ si
  ¿plan_modules incluye 'pos'?  → devuelve eso.

Provisionar
  INSERT tenants
      ↓
  create_tenant_defaults()  [settings, theme, seo, location, billing,
                             units, y ahora subscription]
      ↓
  suscripcion al plan por defecto, estado `active`

Cambiar de plan
  Super Admin → UPDATE subscriptions.plan_code
      ↓
  has_module cambia al instante para ese tenant: no hay nada que
  recalcular, porque no hay nada almacenado
```

---

## 15. Manejo de errores

```text
Modulo no disponible (servidor)   -> AuthorizationError
Modulo no disponible (pagina)     -> notFound()
Plan inexistente                  -> 23503 (FK)
Plan inactivo                     -> P0001
Segunda sede sin multi_location   -> P0001, mensaje accionable
Borrar un plan contratado         -> 23503 (RESTRICT), ruidoso a proposito
Escritura por un no-admin         -> RLS devuelve cero filas
Dos planes por defecto            -> 23505 (indice unico parcial)
```

---

## 16. Observabilidad

```text
subscription.plan_changed
subscription.status_changed
tenant_module.enabled
tenant_module.disabled
tenant_module.cleared
feature.denied          cuando requireFeature rechaza
```

---

## 17. Testing Plan

### Unit

```text
TEST-2101  El espejo TypeScript declara exactamente los diez modulos de
           §33, y coincide con la tabla (comprobado en el test de base).
TEST-2102  La navegacion oculta una entrada cuyo modulo falta, aunque el
           permiso este.
TEST-2103  La navegacion oculta una entrada cuyo permiso falta, aunque el
           modulo este.
TEST-2104  Una entrada sin modulo declarado se dibuja siempre que el
           permiso este.
```

### Database (`src/tests/database/modules.test.ts`)

```text
TEST-2110  Las cinco tablas nuevas tienen RLS activo.
TEST-2111  El catalogo (modules, plans, plan_modules) es read-only.
TEST-2112  La tabla modules contiene exactamente los diez codigos de §33.
TEST-2113  Hay exactamente un plan por defecto, y un segundo se rechaza.
TEST-2114  Cada tenant nuevo recibe suscripcion al plan por defecto.
TEST-2115  has_module devuelve true para un modulo del plan.
TEST-2116  has_module devuelve false para un modulo fuera del plan.
TEST-2117  Un override concede un modulo que el plan no da.
TEST-2118  Un override retira un modulo que el plan si da.
TEST-2119  Un estado suspended apaga todos los modulos.
TEST-2120  Un estado cancelled apaga todos los modulos.
TEST-2121  trialing y past_due siguen dando acceso.
TEST-2122  Un tenant sin suscripcion no tiene ningun modulo (fail-closed).
TEST-2123  my_modules devuelve el conjunto completo y coincide con
           has_module fila a fila.
TEST-2124  Un tenant no puede escribir su propia suscripcion.
TEST-2125  Un tenant no puede darse un modulo a si mismo.
TEST-2126  Un tenant no lee la suscripcion de otro.
TEST-2127  Un platform admin si puede escribir ambas.
TEST-2128  Un tenant sin multi_location no puede crear una segunda sede.
TEST-2129  Con multi_location puede.
TEST-2130  El cupo de sedes y el minimo de la Fase 10 interactuan como se
           espera: una sede cerrada no libera cupo en starter, y nunca se
           puede quedar sin ninguna activa.
TEST-2131  Borrar un plan contratado se rechaza.
TEST-2132  Un tenant no puede tener dos suscripciones.
```

### Regression

```text
schema-contract   las cinco tablas nuevas entran en EXPECTED_COLUMNS
isolation         modules/plans/plan_modules entran en la allowlist de
                  catalogo read-only
Todas las fases   el plan por defecto incluye los diez modulos, asi que
                  ninguna prueba anterior pierde acceso
```

---

## 18. Edge Cases

```text
Tenant sin suscripcion            -> sin modulos (fail-closed, TEST-2122)
Override que coincide con el plan -> redundante pero valido; gana igual
Modulo retirado del plan mientras
  un tenant lo usa                -> pierde acceso; los datos siguen
Plan desactivado con suscriptores -> siguen teniendo su plan; solo deja de
                                     ofrecerse para nuevas altas
Suspender y reactivar             -> nada que restaurar: no hay estado
                                     derivado que reconstruir
Segunda sede ya existente y luego
  se retira multi_location        -> la sede sigue; lo que se impide es
                                     crear otra (ver KL-2104)
```

---

## 19. Performance considerations

```text
Queries
  my_modules() en UNA consulta para el layout; hasFeature() puntual para
  una pagina. Ambas cacheadas por request con React `cache`, igual que
  has_permission desde la Fase 03.

Indexes
  plan_modules (module_code)   "que planes incluyen esto"
  subscriptions (plan_code)    "quien tiene este plan"
  Las PK cubren las lecturas por tenant.

Nada almacenado
  has_module no lee ninguna columna derivada: resuelve contra tres tablas
  pequenas. Por eso cambiar de plan no necesita recalcular nada.
```

---

## 20. Migraciones

```text
20260830130000_create_module_catalog.sql
  enums, modules, plans, plan_modules + datos + RLS read-only

20260830130100_create_subscriptions.sql
  subscriptions + tenant_modules + RLS + backfill de tenants existentes

20260830130200_create_module_resolution.sql
  has_module(), my_modules(), create_tenant_defaults() extendido,
  y el guard de multi_location sobre locations
```

---

## 21. Rollback

```text
  drop trigger locations_guard_multi_location on public.locations;
  drop function public.guard_multi_location();
  drop function public.my_modules(uuid);
  drop function public.has_module(uuid, text);
  -- reinstalar create_tenant_defaults() de 20260827180100_create_units.sql
  drop table public.tenant_modules;
  drop table public.subscriptions;
  drop table public.plan_modules;
  drop table public.plans;
  drop table public.modules;
  drop type public.subscription_status;
  drop type public.plan_interval;

Seguro: nada anterior a la Fase 21 lee estas tablas, y quitar el gateo
devuelve el producto al estado "todo encendido" que tenia en la Fase 20.
```

---

## 22. Definition of Done

- [x] Los dos enums implementados
- [x] Las cinco tablas de §33
- [x] Los diez módulos de §33 cargados por migración
- [x] Tres planes con sus módulos, y exactamente un plan por defecto
- [x] `has_module()` y `my_modules()` en SQL, fail-closed
- [x] `hasFeature()` / `requireFeature()` / `myModules()` en TypeScript
- [x] Navegación filtrada por módulo además de por permiso
- [x] Cada página de módulo comprueba su módulo
- [x] Guard de `multi_location` sobre `locations`
- [x] Provisión extendida y backfill no destructivo
- [x] RLS: el catálogo read-only, la suscripción sólo escribible por platform admin
- [x] UI de Super Admin para plan, estado y overrides
- [x] Pantalla del plan para el tenant
- [x] Unit tests PASS
- [x] Database tests PASS
- [x] `schema-contract` actualizado
- [x] Lint / Typecheck / Build PASS
- [x] SPEC actualizado
- [x] ADR-025 escrito
- [x] `docs/architecture/` actualizado

---

## 23. Implementation notes

### El paywall que no rompió nada

El riesgo real de esta fase no era técnico sino de alcance: encender un gateo
sobre veinte fases de capacidad abierta. Tres decisiones lo contuvieron, y
están en ADR-025:

- La función es **fail-closed**, así que no hay un camino silencioso por el que
  un tenant mal provisionado conserve acceso.
- El plan por defecto **incluye todo**, así que la migración no le quita nada a
  nadie.
- El backfill corre **en la misma migración** que crea la tabla, así que no
  existe un instante en el que un tenant esté sin suscripción.

La prueba de que funcionó es que las 66 suites anteriores siguen en verde sin
tocar ninguna: si el gateo hubiera cambiado el comportamiento por defecto,
habrían caído en bloque.

### `multi_location` es el único módulo que gobierna un dato

Nueve de los diez módulos encienden o apagan pantallas. `multi_location` no:
todo tenant tiene una sede desde la Fase 10 (ADR-014 la hizo obligatoria), así
que el módulo no puede significar "ver sedes" sin dejar sin sede a quien no lo
tenga. Significa **poder tener más de una**, y eso es un trigger sobre
`locations`, no un guard de página.

Se comprueba sobre las sedes **activas**, no sobre todas: desactivar una sede
libera el cupo, que es lo que un negocio que cierra un local espera.

---

## 24. Known limitations

```text
KL-2101  No hay cobro. Los planes tienen precio y nadie lo cobra: es la
         Fase 22 y master lo separa explicitamente (§22). Dueno: Fase 22.

KL-2102  El periodo de la suscripcion no avanza solo. current_period_end
         se escribe a mano y nada lo renueva al vencer, porque renovar
         necesita un scheduler que ninguna fase ha montado (§47). Dueno:
         Fase 22.

KL-2103  `trial_ends_at` no dispara nada. Una prueba vencida sigue en
         `trialing` y sigue dando acceso hasta que una persona la cambia.
         Misma causa que KL-2102. Dueno: Fase 22.

KL-2104  Retirar `multi_location` a un tenant que ya tiene tres sedes no
         desactiva ninguna: solo impide crear la cuarta. Desactivar sedes
         automaticamente al bajar de plan destruiria configuracion por un
         cambio comercial, y cual sobrevive no es una decision que un
         trigger deba tomar. Dueno: Fase 22, con la UI que lo pregunte.

KL-2105  Los limites por plan son binarios salvo multi_location: no hay
         "hasta 100 productos". §33 habla de modulos. Dueno: cuando se pida.

KL-2106  El tenant no puede cambiar de plan por si mismo. Es deliberado
         (§29) y significa que contratar mas requiere hablar con
         CloverCode. Dueno: Fase 22 si se decide autoservicio.

KL-2107  Un negocio de UNA sede en un plan sin multi_location no puede
         mudarse desactivando su sede y creando otra: la Fase 10 exige al
         menos una sede activa y el modulo permite como maximo una, asi
         que las dos guardas juntas lo dejan sin margen. Se muda editando
         la direccion de la sede que tiene, que es la operacion correcta
         de todos modos. Se descubrio escribiendo TEST-2130 y se dejo asi
         a proposito: relajar cualquiera de las dos guardas seria peor que
         la molestia que evita. Dueno: ninguno; es la conducta deseada.
```

---

## 25. Future considerations

```text
Fase 22 (CloverCode billing)  lee plans.price_cents y subscriptions para
                              emitir y cobrar; subscription_events y
                              saas_payments cuelgan de aqui sin cambiar
                              este esquema.
Fase 23 (Reports)             `reports` ya es un modulo declarado: la fase
                              solo tendra que respetarlo.
Fase 25 (Security hardening)  la revision de permisos incluira comprobar
                              que ninguna pagina de modulo se olvido su
                              requireFeature.
Web publica                   `website` gobierna hoy el CMS del dashboard;
                              cuando el sitio publico tenga checkout, el
                              mismo modulo decidira si se sirve.
```
