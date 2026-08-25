# SPEC — Phase 05 — Tenant Dashboard

## 1. Información general

```text
Phase:                05
Nombre:               Tenant Dashboard
Estado:               COMPLETED
Versión:              1.2.0
Fecha creación:       2026-08-25
Última actualización: 2026-08-25 (auditoría de fase, §26)
Responsable:          alejandro.avendano@masuno.pe
```

Documento maestro: §11, §12, §13, §19, §20, §28, §33 (Fase 5), §34, §35, §42, §43, §45.
Fases previas: 00 · 01 · 02 · 03 · 04 — todas COMPLETED y auditadas.

---

## 2. Objetivo

### ¿Por qué existe esta fase?

La Fase 04 permite crear una empresa y asignarle un propietario. Ese propietario
puede iniciar sesión, y lo que encuentra es un marcador de posición. Esta fase
le da el lugar desde el que trabajará.

El problema real que resuelve no es visual, es de **contexto**: un usuario puede
pertenecer a varias empresas (§11), así que cada petición del panel necesita
saber _en cuál_ está trabajando, y esa respuesta no puede venir del hostname
—el panel vive en un solo dominio (§28)— ni de nada que el cliente pueda
falsificar sin verificación (§42).

### ¿Qué debe ser posible al terminarla?

```text
- Entrar y llegar directamente a la empresa si solo hay una.
- Elegir entre varias si el usuario pertenece a más de una.
- Cambiar de empresa sin cerrar sesión.
- Ver una navegación que refleja los permisos del rol en ESA empresa.
- Consultar el padrón de miembros solo si el rol lo permite.
- Editar el propio perfil.
- Cerrar sesión.
- Que entrar a una empresa ajena escribiendo su slug devuelva 404.
```

---

## 3. Alcance

### Incluido

```text
DS-01  Resolución de tenant activo por segmento de URL
DS-02  requireActiveTenant(): membresía verificada en servidor
DS-03  /dashboard: redirección directa, selector, o empty state
DS-04  Layout del panel con navegación y cambio de empresa
DS-05  Navegación derivada de permisos (§45: no es autorización)
DS-06  Página de inicio de la empresa
DS-07  Padrón de miembros, condicionado a members.view
DS-08  Perfil del usuario: ver y editar nombre
DS-09  Aviso cuando la empresa está suspendida
DS-10  Tests: aislamiento por URL, navegación por rol, perfil
```

### Fuera de alcance

```text
OUT-01  Invitar o crear cuentas de usuario         -> Fase 06+ (ver §11)
OUT-02  Cambiar roles o retirar miembros desde UI  -> requiere members.manage;
                                                      el backend existe, la UI no
OUT-03  tenant_settings, tema, logo                -> Fase 06
OUT-04  Módulos del negocio (catálogo, pedidos)    -> Fases 10+
OUT-05  Métricas y reportes                        -> Fase 23
OUT-06  Cambiar la contraseña desde el perfil      -> ya existe /reset-password
```

Nota sobre §33: «configuración básica» se interpreta como el perfil del usuario
y la visibilidad del estado de la empresa. La configuración **del negocio**
(nombre comercial, RUC, moneda, tema) es explícitamente la Fase 06, que crea
`tenant_settings`. No se adelanta.

---

## 4. Dependencias

```text
Phase 02  sesión SSR, getActiveMemberships(), proxy, SignOutButton
Phase 03  has_permission, my_permissions, get_tenant_members
Phase 04  provision_tenant (para que exista algo que administrar)
```

---

## 5. Casos de uso

### UC-501 — Un usuario con una sola empresa

```text
Actor:            Propietario de Sugu Rolls
Acción:           Entra a /dashboard
Resultado:        Redirección inmediata a /dashboard/sugurolls
Motivo:           Un selector de un solo elemento es un paso vacío.
```

### UC-502 — Un usuario con varias empresas

```text
Actor:            Contador de dos empresas
Acción:           Entra a /dashboard
Resultado:        Selector con ambas, indicando su rol en cada una
```

### UC-503 — Acceso a una empresa ajena por URL

```text
Actor:            Propietario de Sugu Rolls
Acción:           Escribe /dashboard/polleria-el-rey
Resultado:        404. No 403: un 403 confirmaría que esa empresa existe.
```

### UC-504 — Navegación según rol

```text
Actor:            Cajero de Sugu Rolls
Acción:           Abre el panel
Resultado:        No ve la entrada "Miembros": su rol carece de members.view
Y ademas:         Si escribe la URL directamente, recibe 404 igualmente
```

### UC-505 — Empresa suspendida

```text
Actor:            Propietario de una empresa suspendida
Acción:           Abre el panel
Resultado:        Entra, y ve un aviso permanente del estado
```

### UC-506 — Editar el perfil

```text
Actor:            Cualquier usuario autenticado
Acción:           Cambia su nombre en /dashboard/perfil
Resultado:        Se guarda y se refleja en la cabecera
Errores posibles: Nombre vacío o excesivo -> error de campo
```

---

## 6. Requerimientos funcionales

```text
FR-501  El tenant activo se determinará por el segmento de URL, no por cookie.
FR-502  El slug de la URL es entrada NO confiable: se verifica la membresía en
        servidor en cada petición.
FR-503  Una empresa donde el usuario no es miembro activo dará 404.
FR-504  `/dashboard` con cero membresías mostrará un empty state explicativo.
FR-505  `/dashboard` con una membresía redirigirá a esa empresa.
FR-506  `/dashboard` con varias mostrará un selector con el rol de cada una.
FR-507  El layout mostrará la empresa activa y permitirá cambiarla.
FR-508  La navegación se construirá a partir de los permisos del usuario en la
        empresa activa.
FR-509  Ocultar una entrada NO será el control de acceso: la página también
        comprueba (§45).
FR-510  El padrón de miembros exigirá `members.view`.
FR-511  El padrón mostrará nombre, correo, rol y estado.
FR-512  Una empresa suspendida mostrará un aviso persistente.
FR-513  El perfil permitirá ver correo y editar el nombre.
FR-514  El correo no será editable: lo gobierna Supabase Auth.
FR-515  El formulario de perfil usará el contrato de FormState compartido.
FR-516  El cierre de sesión seguirá siendo POST (Fase 02).
FR-517  Toda pantalla tendrá empty, loading y error state.
```

---

## 7. Requerimientos no funcionales

```text
NFR-501 Seguridad
  - El slug de la URL nunca se usa sin verificar membresía.
  - 404 y no 403 ante una empresa ajena.
  - Cada página comprueba por su cuenta; el layout no es la única barrera.

NFR-502 Performance
  - La resolución del tenant activo y los permisos se memoizan por petición.
  - El padrón se obtiene con una sola llamada (get_tenant_members).

NFR-503 Accesibilidad
  - Navegación como <nav> con aria-current en la entrada activa.
  - Tabla del padrón con encabezados asociados.
  - Foco visible y orden lógico.

NFR-504 Responsive
  - §20: el panel debe funcionar en desktop, laptop y tablet.
```

---

## 8. Modelo de datos

```text
Tablas nuevas:      NINGUNA
Migraciones:        NINGUNA
Políticas nuevas:   NINGUNA
```

Esta fase es de interfaz y de contexto: consume exactamente lo que las fases 02,
03 y 04 dejaron. Que no necesite esquema nuevo es la señal de que aquellas fases
dejaron el modelo correcto.

Funciones consumidas: `get_my_memberships`, `my_permissions`, `has_permission`,
`get_tenant_members`. Tabla escrita: `profiles` (solo la fila propia, vía la
política `profiles_update_own` de la Fase 02).

---

## 9. Diagrama de relaciones

```text
/dashboard
    |
get_my_memberships()          -> 0 : empty state
    |                            1 : redirect
    |                            N : selector
    v
/dashboard/[tenantSlug]
    |
requireActiveTenant(slug)     verifica membresía ACTIVA en servidor
    |
    +-- my_permissions()      -> navegación visible
    +-- página                -> vuelve a comprobar el permiso que necesita
```

---

## 10. Tenant Isolation

```text
Tenant Isolation Impact: ALTO
```

```text
¿Cómo se determina el tenant?
  Por el segmento de URL, y SOLO después de verificar en servidor que el
  usuario tiene una membresía activa en él. El slug es entrada del cliente:
  se usa para buscar, nunca para autorizar.

¿Por qué la URL y no una cookie?
  Una cookie es estado oculto: se queda obsoleta, viaja a peticiones que no la
  necesitan y hace que dos pestañas se pisen. La URL es explícita, compartible
  y obliga a verificar en cada petición, que es justo lo que se quiere.

¿Qué evita el acceso cross-tenant?
  Tres capas. La membresía se comprueba en `requireActiveTenant`. Los datos se
  piden con funciones que ya filtran por `auth.uid()`. Y RLS sigue debajo: aun
  si esta fase tuviera un fallo, la base de datos no devuelve filas ajenas.

¿Existe algún recurso global?
  El perfil del usuario, que no pertenece a ninguna empresa.
```

---

## 11. Seguridad

```text
AB-501  Entrar a otra empresa cambiando el slug en la URL.
        Mitigación: membresía verificada en servidor; 404 si no la hay.

AB-502  Deducir qué empresas existen probando slugs.
        Mitigación: 404 idéntico para "no existe" y "no es tuya".

AB-503  Usar una membresía `invited` o `suspended` para entrar.
        Mitigación: solo `active` concede acceso (Fase 02/03).

AB-504  Alcanzar una página cuya entrada de menú está oculta.
        Mitigación: la página comprueba el permiso por su cuenta. Ocultar es
        cosmético (§45).

AB-505  Editar el perfil de otro usuario.
        Mitigación: la política `profiles_update_own` lo impide en la base de
        datos; la acción ni siquiera acepta un id.

AB-506  Cambiar el correo desde el perfil para suplantar.
        Mitigación: el correo no es editable aquí. Lo gobierna Supabase Auth.
```

---

## 12. API / Server Actions

```text
updateProfileAction(prev, formData) -> FormState
  Input:  fullName
  No acepta userId: la identidad viene de la sesión.

Funciones de servidor:
  requireActiveTenant(slug)  -> ActiveTenant       (404 si no es miembro)
  getActiveTenant(slug)      -> ActiveTenant | null
  getDashboardNavigation(tenant) -> NavItem[]      (filtrada por permisos)
```

---

## 13. UI / UX

```text
/dashboard                        selector | redirect | empty state
/dashboard/perfil                 perfil del usuario
/dashboard/[tenantSlug]           inicio de la empresa
/dashboard/[tenantSlug]/miembros  padrón (requiere members.view)
```

Layout: cabecera con empresa activa y cambio de empresa, navegación lateral en
escritorio y superior en tablet, y el botón de cierre de sesión.

Estados en cada pantalla: loading (skeleton), empty, error, success.

---

## 14. Flujos principales

```text
ENTRADA
  /dashboard -> get_my_memberships()
      0 -> empty state "aún no perteneces a ninguna empresa"
      1 -> redirect /dashboard/{slug}
      N -> selector

DENTRO DE UNA EMPRESA
  /dashboard/{slug}
      |
  requireActiveTenant(slug)
      |-- sin membresía activa -> notFound()
      |
  my_permissions(tenantId) -> navegación
      |
  cada página vuelve a comprobar lo suyo
```

---

## 15. Manejo de errores

```text
Sin sesión                        -> proxy redirige a /login
Slug inexistente o ajeno          -> 404
Membresía invited o suspended     -> 404 (no es miembro activo)
Sin permiso para una página       -> 404
Nombre de perfil inválido         -> error de campo
Fallo de consulta                 -> DatabaseError 500
```

Decisión: **404 y no 403 en todo el panel.** Un 403 distingue «no existe» de
«no es tuyo», y esa distinción es un oráculo de enumeración de clientes.

---

## 16. Observabilidad

```text
dashboard.tenant.access_denied  warn  { slug, userId }
dashboard.profile.updated       info  { userId }
```

---

## 17. Testing Plan

```text
Unit
TEST-501  La navegación incluye solo las entradas cuyo permiso se posee.
TEST-502  La navegación marca como activa la ruta actual.
TEST-503  Una entrada sin permiso nunca aparece, en ningún rol.

Integration
TEST-504  requireActiveTenant devuelve la empresa a un miembro activo.
TEST-505  requireActiveTenant lanza NotFound con una empresa ajena.
TEST-506  requireActiveTenant lanza NotFound con membresía invited/suspended.
TEST-507  updateProfileAction valida y devuelve errores de campo.
TEST-508  updateProfileAction no acepta un userId del cliente.

Base de datos / aislamiento
TEST-509  get_tenant_members sigue exigiendo members.view.
TEST-510  Un miembro de A no obtiene el padrón de B por ninguna vía.
TEST-511  Un usuario solo puede actualizar su propio perfil.
```

---

## 18. Edge Cases

```text
EC-501  Usuario sin ninguna membresía -> empty state, no error.
EC-502  Usuario con membresía solo en una empresa archivada -> se comporta
        como cero membresías: get_my_memberships ya la omite.
EC-503  Slug con mayúsculas en la URL -> se normaliza antes de buscar.
EC-504  Empresa suspendida -> se entra, con aviso.
EC-505  Membresía revocada mientras la pestaña está abierta -> la siguiente
        navegación da 404.
EC-506  Perfil sin nombre -> se muestra el correo como identidad.
EC-507  Usuario que es a la vez operador de plataforma -> el panel no cambia;
        las dos áreas son independientes (§29).
```

---

## 19. Performance considerations

```text
Por petición: una llamada para la membresía activa y otra para los permisos,
ambas memoizadas con cache() de React. El padrón es una sola llamada.

Riesgo: el selector de empresa carga las membresías en cada navegación. Con
unas pocas empresas por usuario es irrelevante; si alguien perteneciera a
cientos habría que paginarlo.
```

---

## 20. Migraciones

```text
NINGUNA.
```

---

## 21. Rollback

```text
git revert del rango de la fase. No hay estado en base de datos que revertir:
esta fase no escribe nada que no existiera ya (solo `profiles.full_name`, que
el usuario puede volver a cambiar).
```

Riesgo: **BAJO**.

---

## 22. Definition of Done

```text
- [ ] Tenant activo por URL, con membresía verificada en servidor
- [ ] 404 (no 403) ante empresa ajena
- [ ] /dashboard: redirect, selector y empty state
- [ ] Layout con cambio de empresa y cierre de sesión
- [ ] Navegación derivada de permisos
- [ ] Cada página comprueba su propio permiso
- [ ] Padrón de miembros condicionado a members.view
- [ ] Perfil editable con FormState compartido
- [ ] Aviso de empresa suspendida
- [ ] Tests de navegación, acceso y aislamiento
- [ ] Typecheck / Lint / Format / Build PASS
- [ ] SPEC actualizado con el resultado real
```

---

## 23. Implementation notes

### 23.1 Resultado

```text
Format PASS · Lint PASS (0/0) · Types PASS · Tests 566/566 (25 archivos) · Build PASS
```

```text
   9  unit/dashboard-navigation.test.ts   <- añadidos
  13  integration/active-tenant.test.ts   <- añadidos
 544  heredados
 566  total
```

### 23.2 La decisión de esta fase: URL, no cookie

El panel vive en un solo dominio (§28), así que el resolver por hostname de la
Fase 01 no puede decir en qué empresa se está trabajando. Las dos opciones eran
un segmento de URL o una cookie de empresa activa.

Se eligió la **URL**:

```text
Cookie                              Segmento de URL
- estado oculto                     - explícito y compartible
- se queda obsoleta                 - se verifica en cada petición
- dos pestañas se pisan             - cada pestaña es independiente
- viaja a peticiones que no la usan - solo donde importa
```

El slug es entrada del cliente, y eso es aceptable porque **se usa para buscar,
nunca para autorizar**: `requireActiveTenant` lo contrasta con las membresías
que la base de datos resolvió desde `auth.uid()`. Un slug ajeno simplemente no
encuentra nada.

Debajo siguen intactas las capas anteriores: aunque esta fase tuviera un fallo,
RLS no devuelve filas de otra empresa.

### 23.3 Cambio en una fase anterior

`get_my_memberships` ya devolvía `tenant_status`, pero el mapeo a TypeScript de
la Fase 02 lo descartaba. Sin él no se puede avisar dentro de una empresa
suspendida (UC-505), así que se añadió a `Membership`. Un test de la Fase 02 que
fijaba la forma exacta del objeto se actualizó en consecuencia.

Que el dato ya viajara y se tirara es la clase de detalle que solo se ve cuando
alguien lo necesita.

### 23.4 Desviaciones

| #   | Diseño                                 | Implementación                                    | Motivo                                                                                                          |
| --- | -------------------------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| 1   | Selector de empresa como desplegable   | Lista de enlaces                                  | Funciona sin JavaScript, es navegable por teclado sin trabajo extra y con pocas empresas es más rápida de usar. |
| 2   | El perfil dentro del layout de empresa | `/dashboard/perfil`, fuera del segmento de tenant | El perfil no pertenece a ninguna empresa: ponerlo bajo una sería mentir sobre su alcance.                       |

### 23.5 Pitfall encontrado al escribir los tests

`vi.resetModules()` crea un registro de módulos nuevo, así que la clase
`NotFoundError` importada arriba del archivo **no es la misma** que lanza el
módulo recargado, y `instanceof` falla sobre un error perfectamente correcto.
Se resolvió trayendo la clase del mismo registro. Queda documentado porque
volverá a aparecer en cuanto otra fase aísle módulos así.

---

## 24. Known limitations

```text
KL-501  No se pueden invitar ni crear cuentas. El padrón es de solo lectura
        aunque `members.manage` exista en el backend desde la Fase 03.

KL-502  No se pueden cambiar roles ni retirar miembros desde la interfaz. Las
        políticas lo permiten; falta la UI.

KL-503  El selector carga todas las membresías en cada navegación. Irrelevante
        con unas pocas; habría que paginar con cientos.

KL-504  El inicio de la empresa es informativo. Los módulos reales llegan en
        las Fases 10+.

KL-505  Sin tests E2E: la navegación y los guards se prueban por unidad e
        integración, no en un navegador. Heredado; owner Fase 28.

KL-506  `getMyPermissions` se llama en el layout y otra vez en cada página que
        comprueba. Está memoizado por petición, así que es una sola consulta,
        pero la duplicación es deliberada y no accidental (§45).

KL-507  Los cambios de esta fase están sin commitear.

KL-508  No se verificó de forma empírica qué status devolvía el guard ANTES de
        la corrección de A5-1. Se corrigió por diseño, no por medición. Una
        prueba E2E real cerraría esa duda. Owner: Fase 28.
```

---

## 25. Future considerations

```text
- Fase 06 añade tenant_settings; el layout ya tiene el sitio donde colgar el
  logo y el nombre comercial.
- Cuando exista la UI de gestión de miembros, debe usar `members.manage` y
  respetar la guarda anti-escalada de la Fase 03: la interfaz no puede ofrecer
  lo que la base de datos rechazará.
- Cada módulo de negocio (Fases 10+) añade su entrada a NAV_ITEMS con su
  permiso, y su página vuelve a comprobarlo. El patrón ya está establecido.
- Si el número de empresas por usuario creciera, el selector necesita búsqueda
  y paginación.
```

---

## 26. Auditoría de la fase

Dos hallazgos, ambos corregidos. Y una hipótesis mía que resultó falsa y que
conviene dejar escrita.

### A5-1 — El guard confiaba en que Next interpretara una clase propia (corregido)

`requireActiveTenant` y `requirePlatformAdmin` lanzaban **nuestro**
`NotFoundError` y daban por hecho que Next.js lo convertiría en un 404. Next
documenta exactamente una forma de producir un 404 desde un Server Component:
llamar a `notFound()`.

Intenté medir el comportamiento real levantando el build y sondeando rutas.
**El sondeo falló y no logré establecerlo**: primero medí sin credenciales (todo
daba 500 por el proxy), después coloqué la sonda en `src/app/_probe404/` sin
recordar que en Next una carpeta con guion bajo es privada y no genera ruta —de
modo que los cuatro 404 que obtuve eran simplemente «esa ruta no existe» y la
página nunca llegó a ejecutarse—, y el tercer intento devolvió 200 en todos los
casos. Detuve la investigación ahí.

Que no pudiera medirlo **es el argumento**, no una excusa: depender de que un
framework infiera semántica HTTP del nombre de una clase es apoyarse en algo que
nadie prometió, y que puede dejar de funcionar en cualquier versión menor.

Corregido: ambos guards llaman a `notFound()`. `NotFoundError` sigue siendo lo
correcto en Route Handlers y Server Actions, donde `toErrorResponse()` sí lo
traduce a un status. Los tests ahora afirman sobre el centinela real
(`digest === "NEXT_HTTP_ERROR_FALLBACK;404"`), es decir prueban que se produce
un 404, no que se pretendía uno.

### A5-2 — Una ruta del panel eclipsaba un slug de tenant (corregido)

`/dashboard/{slug}` resuelve la empresa desde un segmento, y Next resuelve un
segmento **estático** antes que uno dinámico. `/dashboard/perfil` es estático,
así que una empresa con slug `perfil` habría sido inalcanzable para siempre — y
habría parecido un fallo de enrutado, no un choque de nombres.

`perfil` no estaba en la lista de slugs reservados de la Fase 01.

Corregido con la migración `20260825150000_reserve_dashboard_segments.sql`
(nueva, no una edición: la de la Fase 01 ya está commiteada, §22).

Lo importante no es la palabra añadida sino el test que la acompaña:
`reserved-slugs.test.ts` **lee las carpetas del disco** y falla si algún
segmento estático vecino de `[tenantSlug]` sigue siendo un slug permitido. No
depende de que alguien recuerde la regla al añadir la siguiente ruta.

### Revisado sin hallazgos

```text
- El slug de la URL nunca autoriza: se contrasta con las membresías que la base
  de datos resolvió desde auth.uid(). Probado con membresías ajenas,
  invited y suspended.
- Foreign tenant y tenant inexistente dan respuesta idéntica: sin oráculo.
- La navegación oculta lo que no corresponde Y la página lo vuelve a comprobar.
- El perfil no acepta un id de usuario; la política de la Fase 02 lo impone.
```

### Resultado

```text
Format PASS · Lint PASS · Types PASS · Tests 570/570 · Build PASS
```
