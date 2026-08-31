# SPEC — Phase 25 — Security Hardening

## 1. Información general

```text
Phase:                25
Nombre:               Security Hardening
Estado:               COMPLETED
Versión:              1.0.0
Fecha creación:       2026-08-31
Última actualización: 2026-08-31
Responsable:          alejandro.avendano@masuno.pe
```

Documento maestro: §33 (Fase 25), §9 (seguridad), §10 (RLS), §32 (uploads), §45 (permisos).
Fases previas: 00 a 24 — todas COMPLETED y auditadas.
ADR: [029 — CSP con nonce, límite de tasa en la base, y el aislamiento como barrido](../adr/029-nonce-csp-database-rate-limits-and-isolation-sweep.md).

---

## 2. Objetivo

### ¿Por qué existe esta fase?

Master §33, Fase 25, textual y completo:

> Realizar auditoría completa.
> Revisar: RLS; storage policies; secrets; CORS; auth; cookies; headers; XSS;
> injection; CSRF; SSR cache; IDOR; rate limits; permisos; uploads; logs;
> webhooks.
> Ejecutar específicamente pruebas de aislamiento cross-tenant.

Es una fase de **auditoría**, y eso cambia lo que significa terminarla. Las
veinticuatro anteriores construyeron; ésta **revisa lo construido, arregla lo
que encuentra, y deja la revisión ejecutable** — porque una auditoría que sólo
existe como documento caduca con el siguiente commit.

Y llega con deuda asignada por nombre. Cuatro fases anteriores escribieron
"dueño: Fase 25" en una limitación conocida:

```text
Fase 00  OUT-08 / KL-009  Content-Security-Policy con nonces
Fase 02  KL-203           No hay rate limiting propio de la aplicacion
Fase 19  KL-1902          deliveries.manage alcanza CUALQUIER entrega
Fase 23  KL-2308          Borrar un producto vendido falla con un mensaje
                          que habla de pedidos
Fase 24  KL-2401          El reenvio de cabeceras no esta probado contra un
                          Supabase desplegado
Fase 21  (§25 futuro)     Comprobar que ninguna pagina de modulo se olvido
                          su requireFeature
```

Y `docs/architecture/README.md` lleva veinticinco fases diciendo que
`security.md` se escribe en la Fase 25.

### ¿Qué debe ser posible al terminarla?

```text
Que las diecisiete areas de §33 tengan un veredicto escrito, con la
  evidencia al lado - no una casilla marcada.
Que el aislamiento cross-tenant este probado sobre TODAS las tablas con
  tenant_id, no sobre las dos que la Fase 01 eligio.
Que ese barrido se genere del esquema, para que una tabla nueva entre en el
  a la fuerza y no por acordarse.
Que una Server Action nueva sin puerta de permiso rompa el build.
Que una pagina de modulo sin requireFeature rompa el build.
Que exista una CSP de verdad -con nonce, sin unsafe-inline- y que cubra el
  sitio publico, que es la superficie mas expuesta.
Que un atacante no pueda probar contrasenas a la velocidad de la red.
Que borrar un producto vendido funcione, en vez de fallar hablando de
  pedidos.
```

---

## 3. Alcance

### Incluido

```text
LA AUDITORIA
Las diecisiete areas de §33, una por una, con veredicto y evidencia.
Seccion 26 de este documento. Lo que encontro esta arreglado o registrado
  como KL con dueno.

LO QUE LA AUDITORIA OBLIGO A CAMBIAR
CSP con nonce por peticion, servida desde el proxy, sin unsafe-inline en
  script-src. Deuda de la Fase 00 (OUT-08).
El proxy pasa a cubrir /sitio - hoy excluido - SIN anadirle una llamada a
  Supabase Auth. Sin esto, la CSP no protegeria la unica superficie donde
  se renderiza contenido que escribe un tercero.
Cuatro rutas estaticas pasan a dinamicas, que es el precio documentado de
  un nonce (Next.js lo dice: "all pages must be dynamically rendered").
Rate limiting con estado en PostgreSQL, aplicado a la superficie sin
  sesion. Deuda de la Fase 02 (KL-203).
KL-2308: borrar un producto vendido ya no falla.

LO QUE LA AUDITORIA DEJA EJECUTABLE
Barrido de aislamiento cross-tenant GENERADO del esquema: cada tabla con
  tenant_id, cuatro verbos, dos negocios.
Un test que falla si una Server Action exportada no pasa por una puerta.
Un test que falla si una pagina de modulo se olvida su requireFeature.
Un test que falla si un rol operativo gana un permiso de control.

DOCUMENTACION
docs/architecture/security.md - el modelo de amenazas consolidado que el
  indice lleva veinticinco fases prometiendo.
```

### Fuera de alcance

```text
Pentest externo o escaneo automatizado (OWASP ZAP, Burp). Necesitan un
  entorno desplegado con datos, que no existe. Ver KL-2501.
Verificar KL-2401 (el reenvio de cabeceras) contra un Supabase real. La
  fase lo hereda y no puede cerrarlo por la misma razon: hace falta un
  despliegue. Se traslada con dueno explicito. Ver KL-2502.
WAF, DDoS, bot protection. Son infraestructura de la plataforma de
  despliegue, no de esta aplicacion (§47).
Rotacion de secretos y gestion de claves. Necesita el entorno desplegado y
  es tema de la Fase 27 junto con backups. Ver KL-2503.
2FA / MFA. No esta en la lista de §33 ni en ninguna fase del maestro;
  anadirlo aqui seria construir funcionalidad futura (§51).
Cambiar el modelo de permisos. La revision confirma el modelo; KL-1902 se
  revisa y se ACEPTA con argumento, no se "arregla". Ver seccion 26.14.
```

### La decisión de alcance que más costó

**Si la CSP debía cubrir `/sitio`.**

El proxy excluye `/sitio` desde la Fase 09, con una razón buena y escrita: es
la superficie de más tráfico del producto, sus visitantes no tienen sesión, y
hacerla pasar por el proxy añadiría una llamada a Supabase Auth por vista —
acoplando la carta de cada restaurante a la disponibilidad del servicio de
autenticación.

Pero la CSP se sirve **desde el proxy**, porque el nonce tiene que generarse
por petición. Y `/sitio` es exactamente donde una CSP más hace falta: es la
única superficie que renderiza contenido escrito por un tercero (el CMS de la
Fase 07).

Dejarla fuera era proteger el panel y no la tienda. Meterla dentro tal cual era
deshacer una decisión de disponibilidad correcta.

Se hizo lo tercero: **el proxy cubre `/sitio` y no llama a Auth para él**. La
propiedad que la Fase 09 protegía —una caída de Auth no tumba la carta de un
restaurante— se conserva entera, porque el camino de `/sitio` nunca toca Auth.
Lo que cambia es que ahora sale con su CSP. Ver ADR-029 decisión 2.

---

## 4. Dependencias

```text
Phase 00  las cabeceras de seguridad que esta fase completa con la CSP; el
          logger y su redaccion, que la auditoria verifica
Phase 01  hostname.ts: el Host es entrada no confiable, y ya lo trataba asi
Phase 02  el proxy, las cookies de sesion, y KL-203
Phase 03  has_permission y RLS - lo que el barrido cross-tenant prueba
Phase 06  las politicas de Storage y la validacion de subidas
Phase 21  requireFeature, cuya cobertura esta fase vuelve ejecutable
Phase 24  audit_logs: la auditoria de acciones sensibles ya existe, asi que
          esta fase la verifica en vez de construirla
ADR-010   prohibe comparar roles dentro de una politica: es lo que decide
          el veredicto de KL-1902
```

---

## 5. Casos de uso

```text
UC-2501
Como responsable tecnico
quiero un veredicto por area con su evidencia
para poder responder a una pregunta de seguridad sin volver a auditar.

  Actor          quien mantiene el sistema
  Accion         leer la seccion 26 y docs/architecture/security.md
  Resultado      diecisiete areas, cada una con estado y con el test o el
                 fichero que lo respalda
  Errores        ninguno

UC-2502
Como desarrollador que anade una tabla
quiero que el barrido de aislamiento la incluya sin que yo haga nada
para que no se me olvide justo en lo que mas importa.

  Actor          desarrollador
  Precondiciones una tabla nueva con tenant_id
  Accion         npm test
  Resultado      el barrido la descubre del catalogo y la prueba
  Errores        si no tiene RLS o filtra mal, el test falla nombrandola

UC-2503
Como desarrollador que anade una Server Action
quiero que el build me pare si me olvido la puerta
para que §45 no dependa de mi memoria.

  Actor          desarrollador
  Accion         npm test
  Resultado      falla nombrando la accion sin puerta
  Errores        ninguno

UC-2504
Como visitante de la carta de un restaurante
quiero que un script inyectado no se ejecute
para no salir de ahi con la sesion robada.

  Actor          cualquiera
  Precondiciones alguien logro meter <script> en contenido del CMS
  Accion         abrir /sitio
  Resultado      el navegador lo bloquea: no lleva nonce
  Errores        ninguno

UC-2505
Como atacante
quiero probar contrasenas a la velocidad de la red
para entrar en una cuenta.

  Actor          atacante
  Accion         repetir el inicio de sesion
  Resultado      a partir del limite, la aplicacion responde que espere -
                 sin decir si el correo existe
  Errores        ninguno
```

---

## 6. Requerimientos funcionales

```text
FR-2501  Toda respuesta HTML llevara Content-Security-Policy con un nonce
         distinto por peticion.
FR-2502  script-src no contendra 'unsafe-inline' en produccion.
FR-2503  La CSP cubrira tambien /sitio.
FR-2504  El proxy NO llamara a Supabase Auth para /sitio.
FR-2505  frame-ancestors sera 'none' y object-src sera 'none'.
FR-2506  El limitador de tasa mantendra su estado en PostgreSQL, no en
         memoria del proceso.
FR-2507  El limitador guardara un HASH del identificador, nunca la IP.
FR-2508  Superado el limite, la respuesta no revelara si la cuenta existe.
FR-2509  El limitador nunca impedira una operacion por estar caido: si la
         comprobacion falla, la peticion sigue (fail-open, razonado).
FR-2510  Existira un barrido cross-tenant sobre TODAS las tablas con
         tenant_id, derivado del catalogo del esquema.
FR-2511  El barrido probara SELECT, INSERT, UPDATE y DELETE cruzados.
FR-2512  Un test fallara si una Server Action exportada no alcanza una
         puerta de autorizacion.
FR-2513  Un test fallara si una entrada de navegacion con modulo apunta a
         una pagina que no comprueba ese modulo.
FR-2514  Un test fallara si un rol operativo recibe audit.view.
FR-2515  Borrar un producto vendido dejara la linea del pedido intacta y no
         fallara.
FR-2516  Ninguna otra edicion de una linea de un pedido cerrado se
         permitira.
```

---

## 7. Requerimientos no funcionales

```text
NFR-2501 La auditoria es ejecutable
         Cada veredicto de la seccion 26 apunta a un test o a un fichero.
         Una auditoria que solo existe como prosa caduca con el siguiente
         commit.

NFR-2502 El barrido se genera, no se escribe
         Se lee `information_schema` para descubrir las tablas. Una lista a
         mano es una lista que alguien olvidara ampliar, y olvidarla
         justamente aqui es el peor sitio donde olvidarla.

NFR-2503 Disponibilidad por encima del limitador
         El limitador falla ABIERTO. Un limitador que tumba el login cuando
         su propia tabla falla convierte una defensa en una interrupcion.
         El coste esta razonado en ADR-029 decision 3.

NFR-2504 Sin IPs en claro fuera de la auditoria
         El limitador guarda sha256 del identificador. audit_logs (Fase 24)
         guarda la IP porque investigar la necesita; el limitador solo
         necesita una clave opaca, y guardar la IP dos veces es duplicar el
         dato sensible sin motivo (ADR-016).

NFR-2505 Nada de esto puede romper lo anterior
         Las 74 suites y los 1917 tests de la Fase 24 siguen verdes.
```

---

## 8. Modelo de datos

Una tabla nueva.

### rate_limit_counters

```text
bucket        TEXT        NOT NULL     que se esta limitando
subject_hash  TEXT        NOT NULL     sha256 hex del identificador
window_start  TIMESTAMPTZ NOT NULL     inicio de la ventana fija
hits          INTEGER     NOT NULL     cuantas veces en esta ventana

PK (bucket, subject_hash, window_start)
INDEX (window_start)        para poder purgar

CHECK bucket ~ '^[a-z_.]+$'
CHECK char_length(subject_hash) = 64
CHECK hits > 0
```

**Sin `tenant_id`, y es correcto.** Un límite de tasa gobierna la superficie
**sin sesión** —quien lo está consumiendo todavía no ha demostrado pertenecer a
ningún negocio— así que no hay tenant al que atribuirlo. Es la segunda tabla
del esquema sin `tenant_id` que no es catálogo de producto, y por eso su
política es distinta de todas las demás: ver §10.

### Funciones

```text
consume_rate_limit(bucket, subject, limit, window_seconds) -> boolean
  true  = adelante, y queda anotado
  false = se paso del limite
  SECURITY DEFINER. Hashea el subject dentro; el que llama nunca decide
  como se guarda.

purge_rate_limits() -> integer
  Borra ventanas viejas. La llama consume_rate_limit de vez en cuando, sin
  necesitar un scheduler que sigue sin existir (§47).
```

---

## 9. Diagrama de relaciones

```text
   navegador
      |
      v
   proxy.ts ──── nonce por peticion ──> Content-Security-Policy
      |
      +-- /sitio ────────────────> render      (SIN pasar por Auth)
      |
      +-- resto ── supabase.auth.getUser() ──> render
                                                 |
   Server Action                                 |
      |                                          |
      +-- requireActiveTenant  (quien eres)      |
      +-- requirePermission    (§45)             |
      +-- requireFeature       (Fase 21)         |
      +-- consume_rate_limit   (sin sesion)      |
                    |                            |
                    v                            v
              PostgreSQL: RLS en cada tabla, has_permission(tenant, code)
                    |
                    v
              audit_logs (Fase 24): quien lo hizo, desde donde
```

---

## 10. Tenant Isolation

Ésta es **la** sección de esta fase, y la razón por la que master pide
_"ejecutar específicamente pruebas de aislamiento cross-tenant"_.

```text
¿Como se determina el tenant?
  Igual que en las veinticuatro fases anteriores: del servidor, nunca del
  cliente (§42). Esta fase no lo cambia; lo comprueba.

¿Que tablas lleva tenant_id?
  Todas menos: el catalogo RBAC (roles/permissions/role_permissions), las
  tablas de transiciones, el catalogo de modulos y planes, platform_admins,
  profiles, units... y rate_limit_counters, la unica nueva.

¿Como evita RLS el acceso cross-tenant?
  has_permission(tenant_id, code) en cada politica. El barrido lo prueba
  tabla por tabla en vez de confiarlo.

¿Existe algun recurso global?
  rate_limit_counters. Y por eso NO tiene ninguna politica: ni de lectura.
  Solo consume_rate_limit, que es SECURITY DEFINER, la toca. Un contador
  legible seria un oraculo -"¿cuantos intentos lleva este correo?"- y uno
  escribible seria una forma de bloquear a otro. Es la tercera tabla del
  proyecto sin politica de escritura para nadie, despues de
  subscription_events (Fase 22) y audit_logs (Fase 24).
```

**El barrido, en concreto.** `src/tests/database/cross-tenant.test.ts` descubre
del catálogo cada tabla con `tenant_id`, crea dos negocios con un `owner` cada
uno, y para cada tabla, como dueño de A, comprueba las cuatro:

```text
SELECT  de una fila de B    -> cero filas
UPDATE  de una fila de B    -> cero filas afectadas
DELETE  de una fila de B    -> cero filas afectadas
INSERT  con tenant_id de B  -> rechazado, o filtrado
```

Se genera, no se escribe: una tabla que llegue en la Fase 26 entra en el
barrido por existir.

---

## 11. Seguridad

Toda la fase es esta sección; el detalle área por área está en la §26.

```text
Authorization
  Ningun permiso nuevo. La fase revisa el modelo, no lo amplia - y que la
  revision NO produzca permisos nuevos es parte del veredicto.

RLS policies
  rate_limit_counters: RLS activo, CERO politicas. Nadie lee, nadie
  escribe; solo la funcion SECURITY DEFINER.

Potential abuse cases
  Fuerza bruta sobre el login          -> consume_rate_limit
  Enumerar correos por el mensaje      -> misma respuesta en los dos casos
  Enumerar correos por el TIEMPO       -> ver KL-2504, aceptado y razonado
  XSS en contenido del CMS             -> CSP con nonce, ahora tambien en
                                          /sitio
  Clickjacking                         -> frame-ancestors 'none' + XFO
  Leer el contador de otro             -> no hay politica de lectura
  Bloquear a otro llenando su contador -> el subject de login es la IP, no
                                          el correo: ver ADR-029 decision 3
  IDOR por id en la URL                -> RLS, probado por el barrido
  Borrar la evidencia                  -> audit_logs no tiene DELETE
```

---

## 12. API / Server Actions

**Ninguna Server Action nueva.** Esta fase no añade superficie: endurece la que
hay.

```text
SQL
  consume_rate_limit(p_bucket text, p_subject text, p_limit int,
                     p_window_seconds int) -> boolean
    anon y authenticated pueden ejecutarla: limita la superficie SIN sesion,
    asi que exigir sesion para llamarla seria contradictorio.

  purge_rate_limits() -> integer
    Solo el propietario. La llama consume_rate_limit.

Modificadas
  signInAction, signUpAction, requestPasswordResetAction (Fase 02)
    consultan el limitador antes de hablar con Supabase Auth.

  proxy() (Fase 02)
    genera el nonce, escribe la CSP, y para /sitio no llama a Auth.
```

---

## 13. UI / UX

Ninguna pantalla nueva. Un mensaje nuevo:

```text
Al superar el limite
  "Demasiados intentos. Espera un momento y vuelve a probar."

  El mismo texto para un correo que existe y para uno que no, por la misma
  razon por la que el login ya daba el mismo error a los dos.
```

---

## 14. Flujos principales

```text
Una peticion cualquiera
  proxy genera un nonce
      v
  lo escribe en la cabecera de la peticion (x-nonce) y en la CSP
      v
  Next.js lo pone en cada script que emite
      v
  un script inyectado no lleva nonce -> el navegador lo bloquea

Un intento de inicio de sesion
  signInAction
      v
  consume_rate_limit('auth.sign_in', ip, 10, 300)
      v
  false -> "Demasiados intentos", sin tocar Supabase Auth
  true  -> sigue el flujo de la Fase 02
```

---

## 15. Manejo de errores

```text
El limitador no responde        -> se permite la peticion (FR-2509)
Sin IP (proceso interno)        -> se usa una clave fija de reserva
CSP viola algo en desarrollo    -> 'unsafe-eval' solo en desarrollo, que es
                                   lo que React necesita para depurar
Borrar un producto vendido      -> ahora funciona; la linea conserva su
                                   nombre y su precio
Editar la linea de un pedido
  cerrado                       -> sigue rechazado, sin cambios
```

---

## 16. Observabilidad

```text
security.rate_limited     bucket y si se supero (nunca el identificador)
auth.sign_in.throttled    un intento frenado

Y todo lo de la Fase 24 sigue: las acciones sensibles quedan en audit_logs
con su IP y su request_id.
```

---

## 17. Testing Plan

### Unit (`src/tests/unit/security-posture.test.ts`)

```text
TEST-2501  La CSP no contiene 'unsafe-inline' en script-src.
TEST-2502  La CSP incluye el nonce que se le pasa.
TEST-2503  Dos llamadas producen nonces distintos.
TEST-2504  frame-ancestors y object-src son 'none'.
TEST-2505  'unsafe-eval' aparece solo en desarrollo.
TEST-2506  El nonce es base64 y suficientemente largo.
TEST-2507  Toda Server Action exportada alcanza una puerta.
TEST-2508  Toda entrada de navegacion con modulo tiene una pagina que
           comprueba ESE modulo.
TEST-2509  Toda entrada de navegacion con permiso tiene una pagina que
           comprueba ESE permiso.
TEST-2511  Ningun fichero de cliente importa el cliente de servidor.
TEST-2512  Ninguna clave de servicio aparece en el codigo de aplicacion.

TEST-2510 (ningun rol operativo tiene audit.view) ya existe como TEST-2439
en src/tests/database/audit.test.ts, donde vive el permiso. Duplicarlo aqui
seria una segunda copia de la misma verdad que podria discrepar.
```

### Database (`src/tests/database/cross-tenant.test.ts`)

```text
TEST-2520  Toda tabla con tenant_id tiene RLS.
TEST-2521  El barrido descubre al menos 40 tablas (que no se vacie solo).
TEST-2522  SELECT cruzado: cero filas, tabla por tabla.
TEST-2523  UPDATE cruzado: cero filas afectadas, tabla por tabla.
TEST-2524  DELETE cruzado: cero filas afectadas, tabla por tabla.
TEST-2525  INSERT con el tenant de otro: rechazado, tabla por tabla.
TEST-2526  Un anonimo no lee ninguna tabla con tenant_id.
TEST-2527  Ninguna funcion SECURITY DEFINER se deja el search_path.
TEST-2528  Toda funcion SECURITY DEFINER que recibe un tenant comprueba un
           permiso o es de plataforma.
```

### Database (`src/tests/database/rate-limit.test.ts`)

```text
TEST-2530  Permite hasta el limite y niega el siguiente.
TEST-2531  Cuenta por bucket: dos buckets no se estorban.
TEST-2532  Cuenta por sujeto: dos IPs no se estorban.
TEST-2533  Una ventana nueva empieza de cero.
TEST-2534  Guarda un hash, nunca el identificador.
TEST-2535  El mismo sujeto da siempre el mismo hash.
TEST-2536  rate_limit_counters tiene RLS y CERO politicas.
TEST-2537  Un usuario autenticado no lee la tabla.
TEST-2538  purge_rate_limits borra lo viejo y respeta lo vigente.
TEST-2539  Un limite de cero niega siempre.
```

### Database (regresion, `src/tests/database/orders.test.ts`)

```text
TEST-2540  Borrar un producto vendido funciona (KL-2308 cerrado).
TEST-2541  La linea conserva nombre y precio despues de ese borrado.
TEST-2542  Editar la cantidad de una linea de un pedido cerrado sigue
           rechazado.
```

---

## 18. Edge Cases

```text
Peticion sin IP                     -> clave de reserva; se limita igual
x-forwarded-for con varias IPs      -> la primera, como en la Fase 24
Limitador con la tabla caida        -> se permite (FR-2509)
Dos peticiones a la vez             -> upsert atomico; no se pierde ninguna
Reloj en el limite de la ventana    -> ventana fija; el borde es un reinicio
                                       antes de tiempo, aceptado y explicado
Pagina estatica con CSP de nonce    -> se fuerza a dinamica; son cuatro
Ruta que el proxy no cubre          -> /api/health, que devuelve JSON y no
                                       necesita CSP
Producto vendido y borrado          -> la linea se queda con product_id NULL
Pedido cerrado, otra edicion        -> sigue rechazada
```

---

## 19. Performance considerations

```text
CSP
  El nonce cuesta un randomUUID por peticion. Lo caro no es eso: es que
  cuatro rutas estaticas pasan a dinamicas. Son la portada, el 404 y las
  dos pantallas de contrasena - las cuatro triviales y ninguna en el camino
  caliente. El resto de la aplicacion ya era dinamico entero.

Rate limit
  Un upsert sobre una PK por intento, y solo en la superficie SIN sesion.
  La purga es oportunista (1 de cada 100 llamadas), asi que no hace falta
  el scheduler que sigue sin existir.

El proxy sobre /sitio
  Cubrirlo anade el paso del proxy. NO anade la llamada a Auth, que era el
  coste que la Fase 09 evito - y ese sigue evitado (ADR-029 decision 2).

El barrido cross-tenant
  Es un test, no produccion. Descubre ~50 tablas y hace cuatro consultas
  por tabla sobre una base recien creada.
```

---

## 20. Migraciones

```text
20260831120000_create_rate_limits.sql
  rate_limit_counters, consume_rate_limit(), purge_rate_limits(), RLS sin
  ninguna politica

20260831120100_allow_product_detach_from_closed_order.sql
  KL-2308: la unica edicion que un pedido cerrado admite es que su linea
  pierda el producto que se borro
```

---

## 21. Rollback

```text
  -- La migracion de rate limiting:
  drop function public.consume_rate_limit(text, text, integer, integer);
  drop function public.purge_rate_limits();
  drop table public.rate_limit_counters;

  -- KL-2308: restaurar la version anterior de la funcion, que esta en
  -- 20260827130200_create_order_items.sql. Borrar un producto vendido
  -- vuelve a fallar.

La CSP y el proxy son codigo, no esquema: revertir el commit basta. Los
tests de auditoria tambien.

CRITICO
  Revertir la CSP no deja nada roto. Revertir el rate limiting deja el
  login sin limite propio -el de Supabase Auth sigue-, que es exactamente
  donde estaba la Fase 24.
```

---

## 22. Definition of Done

- [x] Las diecisiete áreas de §33 auditadas, con veredicto y evidencia (§26)
- [x] Barrido cross-tenant sobre toda tabla con `tenant_id`, generado del esquema
- [x] CSP con nonce por petición, sin `unsafe-inline` en `script-src`
- [x] La CSP cubre `/sitio`, y `/sitio` sigue sin llamar a Auth
- [x] Rate limiting con estado en PostgreSQL, hash del identificador
- [x] `rate_limit_counters` sin ninguna política, para nadie
- [x] KL-2308 cerrado: borrar un producto vendido funciona
- [x] Test que falla si una Server Action pierde su puerta
- [x] Test que falla si una página de módulo pierde su `requireFeature`
- [x] `docs/architecture/security.md` escrito
- [x] Unit tests PASS
- [x] Database tests PASS
- [x] Lint / Typecheck / Build PASS
- [x] SPEC actualizado
- [x] ADR-029 escrito

---

## 23. Implementation notes

### El proxy no podía seguir excluyendo la tienda

Es el hallazgo del que sale más código. El `matcher` de la Fase 09 dice, con
razón:

> `/sitio` … es el tenant public website: la superficie de más tráfico del
> producto … Un fallo de auth no debería tumbar la carta de un restaurante.

Correcto sobre **la llamada a Auth**, y de ahí saltó a una conclusión más
amplia de la necesaria: excluir la ruta del proxy **entero**. Mientras el proxy
sólo refrescaba sesiones daba igual. Desde el momento en que el proxy es
también quien emite la CSP, deja de dar igual: `/sitio` es la única superficie
que renderiza contenido escrito por un tercero, es decir, el único sitio donde
una CSP tiene un ataque real que parar.

La separación correcta es entre **"esta ruta necesita una sesión"** y **"esta
ruta necesita cabeceras"**. La segunda es siempre que sí.

```ts
// Sin sesion: se le pone la CSP y se devuelve, sin tocar Supabase Auth.
if (isSessionFreePath(pathname)) {
  return withSecurityHeaders(NextResponse.next(), nonce);
}
```

`/api/health` se queda fuera del matcher, y por una razón distinta: devuelve
JSON, no HTML, así que no tiene nada que una CSP proteja — y mantener la sonda
de liveness sin pasar por ningún código compartido es en sí una propiedad.

### El limitador falla abierto, y hay que decirlo en voz alta

`consume_rate_limit` devuelve `true` cuando algo va mal. Es la decisión
incómoda de esta fase: un limitador que falla **cerrado** convierte cualquier
problema con su propia tabla en "nadie puede iniciar sesión".

El razonamiento: esto es una **segunda** línea. Supabase Auth ya trae la suya
(`[auth.rate_limit]` en `config.toml`), y no desaparece si ésta falla. Un
limitador propio caído nos devuelve al estado de la Fase 24 — que era
aceptable, porque así estuvo veinticuatro fases. Un limitador propio que falla
cerrado nos deja peor de lo que estábamos.

Es exactamente la postura contraria a la de `has_module()` (ADR-025), que falla
**cerrado**, y la diferencia importa: allí el fallo abierto regala funcionalidad
de pago; aquí el fallo cerrado corta el acceso a todo el mundo.

### El sujeto del límite de login es la IP, no el correo

Contar por correo es más preciso: limita al atacante sin molestar a nadie más.
Y crea un ataque nuevo — cualquiera puede bloquear la cuenta de otro
enviando intentos con su correo. Un limitador que se convierte en una
herramienta de denegación contra un usuario concreto es peor que ninguno.

Contando por IP, un atacante sólo se bloquea a sí mismo. El precio es una
oficina con NAT compartiendo cuota, que es un límite molesto y no una cuenta
inutilizable.

### El barrido se genera, y eso es lo que lo hace valer

Escribir a mano `expect(select from products as A).toHaveLength(0)` cincuenta
veces produce un test largo que prueba lo que su autor recordó incluir. La
tabla número cincuenta y uno no está.

```sql
select table_name from information_schema.columns
where table_schema = 'public' and column_name = 'tenant_id'
```

Descubierto del catálogo, el barrido cubre lo que existe, no lo que alguien
listó. Es la misma técnica que `isolation.test.ts` (Fase 01) usa para exigir
RLS en toda tabla, llevada de la postura al dato.

Y TEST-2521 comprueba que el barrido encuentra al menos cuarenta tablas — un
descubrimiento roto devolvería cero, y cero tablas que fallan es un test verde
que no probó nada.

### KL-2308: un `ON DELETE SET NULL` que la propia base impedía

`order_items.product_id` está declarada `on delete set null` desde la Fase 13.
Borrar un producto vendido debía funcionar. Fallaba, porque ese `SET NULL` es
un `UPDATE` sobre `order_items` y chocaba con el guardián que impide editar las
líneas de un pedido cerrado — con un mensaje que hablaba de pedidos a quien
sólo quería limpiar su carta.

El arreglo es de tres líneas y es estrecho a propósito: se admite **una sola**
edición sobre un pedido cerrado, la que va de `product_id` no nulo a nulo, sin
tocar nada más. Cualquier otra sigue rechazada, y TEST-2542 lo prueba.

No pierde nada: el nombre y el precio son snapshots desde la Fase 13, así que
el ticket histórico sigue diciendo lo mismo que decía.

### Lo que se verificó y lo que no

```text
Verificado
  El barrido cross-tenant corre contra PostgreSQL real con las migraciones
  reales y las politicas reales.
  El limitador se prueba contra la misma base, ventanas incluidas.
  La CSP se comprueba como cadena, y el build confirma que ninguna ruta
  quedo estatica.

NO verificado
  Que un navegador real bloquee un script sin nonce. Es comportamiento
  estandar y no hay navegador en este arnes. Ver KL-2505.
  Nada contra un entorno desplegado: sin pentest, sin escaneo, y KL-2401
  (Fase 24) sigue abierto por lo mismo. Ver KL-2501 y KL-2502.
```

---

## 24. Known limitations

```text
KL-2501  No hay pentest ni escaneo automatizado. Necesitan un entorno
         desplegado con datos, que no existe en este proyecto. Dueno:
         Fase 28, que es la de production readiness.

KL-2502  KL-2401 (Fase 24) sigue abierto: que supabase-js reenvie
         `global.headers` y que PostgREST las exponga en `request.headers`
         no esta probado contra un Supabase desplegado. Esta fase no puede
         cerrarlo por la misma razon que KL-2501. Dueno: Fase 28.

KL-2503  Sin rotacion de secretos ni gestion de claves. Necesita el entorno
         desplegado y encaja con backups. Dueno: Fase 27.

KL-2504  El login sigue distinguible por TIEMPO: un correo que existe pasa
         por la comprobacion de contrasena y uno que no, no. Igualarlo
         exige un hash falso de duracion constante dentro de Supabase Auth,
         que no es nuestro. El mensaje SI es identico. Dueno: ninguno; es
         un limite del proveedor.

KL-2505  Que un navegador real bloquee un script sin nonce no esta
         ejecutado aqui: no hay navegador en el arnes. La CSP se verifica
         como cadena. Dueno: Fase 28, con la primera revision en un entorno
         desplegado.

KL-2506  El limitador cuenta por ventana fija, no deslizante. En el borde
         de una ventana se puede gastar el doble del limite en un instante.
         Una ventana deslizante exige guardar cada intento en vez de un
         contador, y para frenar fuerza bruta la diferencia no cambia el
         resultado. Dueno: ninguno; es la eleccion correcta al coste.

KL-2507  El limitador FALLA ABIERTO (FR-2509). Razonado en la seccion 23;
         el limite de Supabase Auth sigue debajo. Dueno: ninguno; es la
         decision.

KL-2508  KL-1902 se revisa y se ACEPTA: cualquier miembro con
         deliveries.manage alcanza cualquier entrega del negocio.
         Restringirlo a "las mias" exige comparar el rol dentro de una
         politica RLS, que ADR-010 prohibe explicitamente, o anadir una
         columna de asignacion que la Fase 19 decidio no tener. El alcance
         es DENTRO de un negocio -no es un fallo de aislamiento- y es la
         misma postura que la Fase 16 acepto para `kitchen`. Dueno:
         ninguno; queda como comportamiento decidido, no como deuda.

KL-2509  Una oficina detras de NAT comparte cuota de intentos de login,
         porque el limite cuenta por IP. Es el precio de no dejar que
         cualquiera bloquee la cuenta de otro (seccion 23). Dueno: ninguno.
```

---

## 25. Future considerations

```text
Fase 26 (Performance)   heredara cuatro rutas dinamicas que antes eran
                        estaticas, y el numero de tablas del barrido como
                        medida del tamano del esquema.
Fase 27 (Backups)       KL-2503 (secretos) y la retencion de audit_logs
                        (KL-2402) son suyas.
Fase 28 (Production)    KL-2501, KL-2502 y KL-2505 esperan un entorno
                        desplegado, que es lo que esa fase trae.
Un WAF                  es infraestructura de la plataforma, no de esta
                        aplicacion.
Mas buckets de limite   consume_rate_limit ya es generica: anadir uno es
                        una llamada, no una migracion.
```

---

## 26. La auditoría

Las diecisiete áreas de §33, en su orden. Cada una con veredicto y con dónde
mirar.

### 26.1 RLS

**PASA.** Activo en toda tabla con datos privados. `isolation.test.ts` lo exige
tabla por tabla desde la Fase 01; `cross-tenant.test.ts` (esta fase) añade el
barrido de los cuatro verbos sobre las ~50 tablas con `tenant_id`.

`using (true)` está prohibido sobre datos de negocio y hay un test que lo
comprueba. Las excepciones son ocho catálogos de producto —RBAC, transiciones,
módulos, planes— todos de sólo lectura y sin datos de nadie.

Tres tablas no tienen **ninguna** política de escritura, para nadie:
`subscription_events` (22), `audit_logs` (24) y `rate_limit_counters` (25).

### 26.2 Storage policies

**PASA.** Las políticas del bucket `tenant-assets` leen el tenant del propio
path del objeto (`storage.foldername`), así que un path fabricado apunta al
tenant que lo escribió. El path lo construye el servidor desde un `tenant_id`
que ya resolvió, nunca desde nada que mande el cliente
(`src/lib/storage/assets.ts`).

### 26.3 Secrets

**PASA.** `service_role` **no aparece en ninguna parte del código** — verificado
por grep y por TEST-2512. Las credenciales del proveedor de facturación viven
en Supabase Vault y ninguna función las lee de vuelta (ADR-021). `.env*` está
ignorado salvo `.env.example`.

### 26.4 CORS

**PASA, por ausencia.** No se configura CORS en ninguna parte, que es la postura
correcta: sin `Access-Control-Allow-Origin`, el navegador aplica la política del
mismo origen y ningún sitio de terceros puede leer una respuesta. Los dos únicos
Route Handlers (`/api/health`, `/auth/confirm`) no devuelven datos de ningún
negocio.

### 26.5 Auth

**PASA.** El proxy usa `getUser()` y no `getSession()` — la segunda lee la
cookie sin verificarla, y la cookie viene del cliente. `/auth/confirm` valida
`type` contra una lista blanca antes de dárselo a `verifyOtp`, filtra `next`
con `safeRedirectPath`, y da el mismo error para caducado, usado y falsificado.

### 26.6 Cookies

**PASA.** Las escribe `@supabase/ssr` con `httpOnly`, `secure` y `sameSite`. La
aplicación no fija ninguna cookie propia. El refresco ocurre en el proxy, que
es el único sitio que puede escribir la respuesta.

### 26.7 Headers

**ARREGLADO EN ESTA FASE.** Estaban HSTS, `nosniff`, `X-Frame-Options: DENY`,
`Referrer-Policy` y `Permissions-Policy` desde la Fase 00. Faltaba la CSP, que
era el hueco que la Fase 00 dejó por escrito (OUT-08). Ahora hay una con nonce
por petición, y cubre también `/sitio`.

### 26.8 XSS

**PASA, y ahora con defensa en profundidad.** React escapa por defecto. El único
`dangerouslySetInnerHTML` del proyecto está en `structured-data.tsx`, escribe
JSON-LD serializado —la única forma de emitir un `<script type="application/ld+json">`—
y hay un test que prohíbe que aparezca otro en el renderizador del CMS. Un SVG
no es un tipo permitido en subidas, precisamente porque puede llevar script. La
CSP de esta fase es la segunda barrera.

### 26.9 Injection

**PASA.** Ninguna consulta se construye concatenando: todo va por PostgREST
parametrizado o por funciones SQL con parámetros. Toda función `SECURITY
DEFINER` fija `search_path = ''` y cualifica cada nombre, y hay un test que lo
exige para todas (TEST-2527).

### 26.10 CSRF

**PASA.** Las Server Actions de Next.js llevan comprobación de origen incorporada
y no son invocables desde otro sitio. `sameSite` en las cookies de sesión es la
segunda barrera. No hay ningún endpoint que mute por `GET`.

### 26.11 SSR cache

**PASA.** Ninguna página cachea datos de un negocio: no hay `revalidate`, ni
`unstable_cache`, ni `force-static` en ninguna ruta con datos. `React.cache` se
usa para deduplicar dentro de **un** render, que no cruza peticiones. Los tres
`force-dynamic` explícitos son health, robots y sitemap. Desde esta fase, además,
no queda ninguna ruta estática.

### 26.12 IDOR

**PASA.** Ninguna página confía en un id de la URL para decidir el acceso: RLS lo
decide, y el barrido de esta fase lo prueba en las cuatro operaciones sobre
todas las tablas. Un id de otro negocio no da 403 sino 404, que además no
confirma que exista.

### 26.13 Rate limits

**ARREGLADO EN ESTA FASE.** No había ninguno propio (KL-203, dueño Fase 25).
Ahora hay uno con estado en PostgreSQL sobre la superficie sin sesión. Falla
abierto, a propósito y razonado (KL-2507).

### 26.14 Permisos

**PASA, y ahora es ejecutable.** Ningún sitio compara un rol: se pide un permiso
(§12). Toda Server Action pasa por una puerta, y TEST-2507 falla si una nueva no
lo hace. Toda página con módulo comprueba su módulo, y TEST-2508 lo exige — que
es lo que la Fase 21 pidió a ésta.

**KL-1902 revisado y aceptado**, no arreglado: ver KL-2508. El alcance es dentro
de un negocio, no entre negocios, y estrecharlo exigiría comparar roles dentro de
una política — lo que ADR-010 prohíbe.

### 26.15 Uploads

**PASA.** Lista blanca de MIME por carpeta, techo de tamaño por carpeta, y la
extensión sale del **MIME validado**, nunca del nombre del fichero que subieron —
que es la forma habitual de que un `.php` acabe en un bucket. `image/svg+xml`
está deliberadamente fuera.

### 26.16 Logs

**PASA.** Redacción central por patrón sobre el nombre de la clave
(`src/lib/logger/redact.ts`), y desde la Fase 24 la misma política vive también
en SQL, con un test que comprueba que las dos coinciden. §17 —"nunca guardar
passwords, tokens o secretos"— se cumple en los dos lados.

### 26.17 Webhooks

**NO APLICA.** No hay ninguno. Los dos únicos Route Handlers son la sonda de
salud y la confirmación de enlaces por correo, y ninguno recibe una llamada de
un tercero. Cuando exista uno —una pasarela de pago (ADR-026) o un proveedor de
facturación (ADR-021)— necesitará verificación de firma e idempotencia, y eso
es de la fase que lo traiga.
