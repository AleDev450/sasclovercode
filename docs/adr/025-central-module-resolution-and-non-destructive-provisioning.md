# ADR-025 — Resolución central de módulos, fail-closed, y un paywall que no quita nada

```text
Status: ACCEPTED
Date:   2026-08-30
Phase:  21 — SaaS Modules + Plans
```

## Context

Master section 33 (Fase 21) pide cinco tablas y da dos instrucciones que son en
realidad la misma:

> Features deben evaluarse centralmente.
> No llenar la aplicación de condiciones dispersas.
> Crear: `hasFeature()`, `requireFeature()` o equivalente.

Y section 45 añade la que decide cómo se implementa:

> La navegación no determina la autorización.
> Ocultar botón NO significa seguridad.
> Backend siempre valida permisos y módulo activo.

El problema no es modelar planes: es que **veinte fases han construido
capacidad con todo encendido para todos**, y esta fase enciende un paywall
encima. Las decisiones que hay que tomar:

1. **Dónde se responde "¿esto está disponible?"**, y en qué lenguaje.
2. **Qué gana cuando el plan dice una cosa y el tenant otra.**
3. **Qué estados de suscripción dan acceso**, que master no enumera.
4. **Qué pasa con los tenants que ya existen** el día que la migración corre.
5. **Qué significa `multi_location`**, que es el único módulo de la lista que
   no es una pantalla.

La 4 es la que puede romper el producto en silencio.

## Decision

### 1. Una función SQL, y una capa TypeScript que sólo la llama

```sql
create function public.has_module(p_tenant_id uuid, p_module text) returns boolean
create function public.my_modules(p_tenant_id uuid) returns table (module text)
```

```ts
hasFeature(tenantId, module); // -> has_module
requireFeature(tenantId, module); // -> lanza AuthorizationError
myModules(tenantId); // -> my_modules, cacheado por request
```

Es literalmente el par que la Fase 03 estableció para los permisos
(`has_permission` / `my_permissions`, ADR-010), y por las mismas tres razones:

- **La respuesta vive donde vive el dato.** Resolver el plan en TypeScript
  significaría traerse `subscriptions`, `plan_modules` y `tenant_modules` a la
  aplicación y reimplementar la precedencia — en cada sitio que preguntara.
- **`my_modules()` devuelve el conjunto entero** para que el layout dibuje el
  menú con una consulta en vez de una por entrada. El N+1 de autorización que
  la Fase 03 ya evitó.
- **La misma consulta responde a los dos llamadores.** Un trigger SQL (el de
  `multi_location`) y una página Next.js preguntan lo mismo y obtienen lo
  mismo, porque es la misma función. Si la lógica viviera en TypeScript, el
  trigger tendría que duplicarla.

Y master lo pide con estas palabras: _"no llenar la aplicación de condiciones
dispersas"_. Una condición dispersa es `if (plan === 'pro')` escrito en
cuarenta sitios; el antídoto es que exista un solo sitio donde esa pregunta
tiene respuesta.

**Ocultar sigue sin ser seguridad.** La navegación filtra por módulo, y además
cada página de módulo llama a `requireFeature()` por su cuenta y responde 404.
Section 45 es explícita y la Fase 05 ya sentó el precedente con los permisos:
el menú decide qué se DIBUJA, la página decide qué se SIRVE.

### 2. El override del tenant gana al plan, en las dos direcciones

```sql
-- 1. ¿hay override? devuelve su is_enabled, sea true o false. FIN.
-- 2. ¿la suscripción da acceso? ¿el plan incluye el módulo?
-- 3. false.
```

`tenant_modules.is_enabled` es `NOT NULL` y **sin valor por defecto**: una fila
ahí es una decisión explícita en una dirección o en la otra, nunca un "no sé"
que haya que interpretar.

Que gane en las dos direcciones es lo que hace la tabla útil. Si sólo pudiera
conceder, cada excepción a la baja obligaría a inventar un plan
(`professional_sin_inventario`), y el catálogo de planes se convertiría en un
catálogo de clientes. Si sólo pudiera retirar, no habría forma de decirle que
sí a un cliente sin cambiarle el plan.

### 3. `trialing`, `active` y `past_due` dan acceso; `suspended` y `cancelled` no

Master no enumera estados. Los cinco elegidos son los que un SaaS distingue de
verdad, y el reparto tiene una razón concreta en cada caso:

- **`past_due` sigue dando acceso.** Es la decisión menos obvia y la más
  importante: cortar el servicio en el momento en que una tarjeta falla es
  cortarle la caja a un restaurante en pleno servicio por un problema del
  banco. `past_due` es una señal para cobrar, no un interruptor. Quien apaga es
  una persona, moviendo el estado a `suspended`.
- **`trialing` da acceso** por definición.
- **`suspended` y `cancelled` no dan nada, y no borran nada.** Suspender apaga
  el producto y deja los datos intactos: un negocio que vuelve encuentra su
  catálogo, sus pedidos y su historial donde los dejó.

### 4. Fail-closed en la función; plan por defecto completo; backfill en la misma migración

Ésta es la decisión que evita romper el producto, y son tres piezas que sólo
funcionan juntas.

**La función no tiene rama permisiva.** No existe "si no hay suscripción,
devuelve true". Un tenant mal provisionado no tiene módulos, ruidosamente. La
alternativa —fail-open— convierte el paywall en decorativo: el primer fallo de
provisión lo desactiva sin que nadie se entere.

**El plan por defecto incluye los diez módulos.** Es una decisión comercial y
es la única honesta hoy: CloverCode todavía no cobra (eso es la Fase 22), así
que reducirle capacidad a un cliente que nunca aceptó un plan menor sería una
decisión de negocio tomada por una migración. Cuando la Fase 22 empiece a
cobrar, mover `is_default` a `starter` es una fila.

**El backfill corre en la misma migración que crea la tabla.** No hay un
instante —ni un despliegue— en el que un tenant exista sin suscripción y por
tanto sin módulos:

```sql
insert into public.subscriptions (tenant_id, plan_code)
select t.id, (select code from public.plans where is_default)
from public.tenants as t
on conflict (tenant_id) do nothing;
```

La prueba de que las tres piezas encajan es negativa y es fuerte: las 66 suites
de las fases anteriores siguen en verde **sin tocar ninguna**. Si el gateo
hubiera cambiado el comportamiento por defecto, habrían caído en bloque.

### 5. `multi_location` gobierna un dato, no una pantalla

Nueve de los diez módulos encienden o apagan pantallas. `multi_location` no
puede: desde ADR-014 **todo** tenant tiene al menos una sede, creada por la
provisión, y la pantalla de sedes tiene que seguir siendo accesible o un
negocio de un local no podría editar su dirección.

Así que el módulo significa **poder tener más de una**, y eso se enforce donde
se enforce cualquier invariante de datos en este proyecto — en un trigger:

```sql
create trigger locations_guard_multi_location
  before insert or update of is_active on public.locations
```

Se cuenta sobre las sedes **activas**, no sobre todas: un negocio que cierra un
local y abre otro no debería tener que llamar a soporte.

**Lo que el trigger NO hace** es desactivar sedes cuando se retira el módulo a
un tenant que ya tiene tres. Destruir configuración por un cambio comercial es
malo, y _cuál_ de las tres sobrevive no es una decisión que un trigger pueda
tomar. Queda como KL-2104, con dueño en la Fase 22.

### 6. Ningún permiso nuevo

El gobierno de planes es del Super Admin (section 29), no de un rol de tenant.
La lectura del propio plan cabe bajo `settings.manage`, que el owner ya tiene
desde la Fase 03.

Añadir `subscription.view` / `subscription.manage` habría sido vocabulario sin
usuarios: `manage` no lo tendría nadie —porque escribir es de platform admin— y
`view` sería un sinónimo de `settings.manage` con otro nombre. La Fase 03 ya
estableció que un permiso se crea cuando hay algo que gobernar; aquí no lo hay.

## Alternatives considered

**Resolver el plan en TypeScript.** Más "moderno" y peor: obliga a
reimplementar la precedencia override→plan→false en cada llamador, y deja al
trigger de `multi_location` sin forma de preguntar. Descartada.

**Cachear los módulos del tenant en una columna.** Una `text[]` en `tenants`
sería más rápida de leer y crearía el problema que ADR-022 y ADR-024 llevan dos
fases discutiendo: un dato derivado que puede quedar desincronizado. Aquí ni
siquiera compra nada — son tres tablas pequeñas y la resolución es un par de
lookups por índice. Descartada.

**Fail-open cuando no hay suscripción.** Cero riesgo de romper nada el día del
despliegue, y un paywall que el primer bug de provisión desactiva en silencio.
Descartada a favor de fail-closed + backfill, que da la misma seguridad de
despliegue sin la puerta trasera.

**Plan por defecto = `starter`.** Comercialmente lo correcto y hoy sería
quitarle el POS y la facturación a clientes que los usan, sin que nadie se lo
haya vendido ni cobrado. Descartada hasta la Fase 22.

**`past_due` corta el acceso.** Simple y hostil: le cierra la caja a un
restaurante por un pago rechazado. Descartada.

**Suspender borra datos.** Nunca se consideró en serio, y merece estar aquí por
lo mismo que ADR-022 dijo del stock: un estado terminal no debería destruir el
historial de nadie.

**`multi_location` como guard de la página de sedes.** Dejaría a un negocio de
un local sin poder editar su propia dirección. Descartada.

## Consequences

**Positivas**

- La pregunta "¿esto está disponible?" tiene exactamente una respuesta, y la
  dan por igual SQL y TypeScript porque es la misma función.
- Cambiar un plan tiene efecto inmediato: no hay nada almacenado que
  recalcular.
- Una excepción comercial es una fila, no un plan nuevo.
- Suspender es reversible sin restaurar nada.
- El despliegue no le quita capacidad a ningún tenant existente.

**Negativas, aceptadas**

- Cada página de módulo tiene que acordarse de llamar a `requireFeature()`. Es
  la misma disciplina que los permisos ya exigen desde la Fase 05, y la Fase 25
  la auditará (KL de esa fase).
- El plan por defecto regala todo hasta la Fase 22 (KL-2101).
- Nada avanza el periodo ni caduca una prueba (KL-2102, KL-2103).
- Bajar de plan no desactiva sedes existentes (KL-2104).

**Neutras**

- Cinco tablas, dos enums, dos funciones y un trigger. Tres de las tablas son
  catálogo global sin `tenant_id`, como `roles`/`permissions` (Fase 03).
- Ningún permiso nuevo, por primera vez desde la Fase 09.
