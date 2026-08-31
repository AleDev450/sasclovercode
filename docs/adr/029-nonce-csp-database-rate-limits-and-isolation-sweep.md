# ADR-029 — CSP con nonce servida a todas las superficies, límite de tasa con estado en la base, y el aislamiento como barrido generado

```text
Status: ACCEPTED
Date:   2026-08-31
Phase:  25 — Security Hardening
```

## Context

Master section 33, Fase 25, pide _"realizar auditoría completa"_ sobre
diecisiete áreas y _"ejecutar específicamente pruebas de aislamiento
cross-tenant"_.

Una fase de auditoría tiene una trampa propia: es fácil terminarla con un
documento que dice PASS diecisiete veces y no haber cambiado nada. Y un
documento que dice PASS caduca con el siguiente commit, porque nada impide que
la Fase 26 añada una Server Action sin puerta.

Así que hay que decidir, además de qué se arregla, **en qué forma queda la
auditoría** para que siga valiendo cuando nadie la esté leyendo.

Las decisiones:

1. **Dónde vive la CSP**, dado que un nonce sólo se puede generar por petición.
2. **Si la CSP cubre `/sitio`**, que el proxy excluye deliberadamente desde la
   Fase 09.
3. **Dónde vive el estado de un límite de tasa** en un despliegue sin memoria
   compartida, **y qué pasa cuando ese estado falla**.
4. **Cómo se prueba el aislamiento** sobre cincuenta tablas.
5. **Qué forma toma un veredicto** para que no caduque.
6. **Qué hacer con KL-1902**, que llegó marcada como deuda de esta fase.

## Decision

### 1. La CSP se sirve desde el proxy, con un nonce por petición

`next.config.ts` puede emitir cabeceras estáticas, y una CSP estática necesita
`script-src 'unsafe-inline'` para que los scripts que Next.js inyecta funcionen.
`'unsafe-inline'` es precisamente lo que una CSP existe para prohibir: con él,
la política no para el ataque que dice parar.

La alternativa que Next.js documenta —y la única que sirve— es un **nonce por
petición**, generado en el proxy, escrito en la cabecera `Content-Security-Policy`
y en `x-nonce`. Next.js lo detecta y lo pega a cada script que emite.

```text
script-src 'self' 'nonce-{aleatorio}' 'strict-dynamic'
style-src  'self' 'nonce-{aleatorio}'
object-src 'none'
frame-ancestors 'none'
base-uri 'self'
form-action 'self'
```

`'unsafe-eval'` aparece **sólo en desarrollo**, donde React lo necesita para
reconstruir trazas de servidor en el navegador. La documentación de Next.js lo
dice explícitamente y el test TEST-2505 lo fija.

**El precio, y es real: nada puede quedar estático.** Una página prerenderizada
en el build no tiene nonce, y sus scripts en línea quedarían bloqueados. La
documentación de Next.js lo dice sin rodeos: _"When you use nonces in your CSP,
all pages must be dynamically rendered"_. Cuatro rutas lo eran —`/`,
`/_not-found`, `/forgot-password`, `/reset-password`— y las cuatro pasan a
dinámicas con `await connection()`. Las cuatro son triviales y ninguna está en
el camino caliente; todo el resto de la aplicación ya era dinámico.

### 2. El proxy pasa a cubrir `/sitio`, y sigue sin llamar a Auth para él

Ésta es la decisión que más código movió, y sale directamente de la auditoría.

El `matcher` de la Fase 09 excluye `/sitio` con un argumento correcto:

> Es el tenant public website: la superficie de más tráfico del producto,
> servida a visitantes que no tienen sesión y no la necesitan. Hacerla pasar
> por aquí añadiría una llamada a Supabase Auth por vista y —peor— acoplaría el
> sitio de cada negocio a la disponibilidad del servicio de autenticación.

Todo eso es cierto **de la llamada a Auth**. De ahí saltó a excluir la ruta del
**proxy entero**, que es una conclusión más amplia. Mientras el proxy sólo
refrescaba sesiones, la diferencia no importaba.

Desde que el proxy es también quien emite la CSP, importa mucho: **`/sitio` es
la única superficie del producto que renderiza contenido escrito por un
tercero** —el CMS de la Fase 07— y por tanto el único sitio donde una CSP tiene
un ataque real que detener. Dejarla fuera era proteger el panel de
administración y no la tienda.

La separación correcta no es "esta ruta pasa por el proxy o no", sino:

```text
¿necesita una sesion?    -> solo entonces se llama a Auth
¿necesita cabeceras?     -> siempre
```

```ts
if (isSessionFreePath(pathname)) {
  // La CSP, y nada mas. Supabase Auth no se toca.
  return withSecurityHeaders(NextResponse.next({ request }), nonce);
}
```

La propiedad que la Fase 09 defendía se conserva **entera**: una caída de Auth
no tumba la carta de ningún restaurante, porque el camino de `/sitio` no pasa
por Auth. Lo que cambia es que ahora sale con su CSP.

`/api/health` se queda fuera del matcher, por una razón distinta y no por
inercia: devuelve JSON, así que no hay nada que una CSP proteja ahí — y que la
sonda de liveness no comparta código con nada es en sí una propiedad que vale
la pena.

### 3. El límite de tasa guarda su estado en PostgreSQL, hashea el sujeto, cuenta por IP, y falla ABIERTO

La Fase 02 dejó KL-203 —_"no existe rate limiting propio; un limitador
necesita estado compartido"_— con dueño esta fase. Cuatro decisiones dentro de
una:

**En PostgreSQL, no en memoria.** El despliegue objetivo es serverless: cada
instancia tiene su propia memoria y su propio contador, así que un limitador en
memoria permite `N × límite` intentos con N instancias, y **no lo sabe**. Un
control que se cree efectivo y no lo es es peor que no tener ninguno, porque
nadie vuelve a mirarlo. La base de datos es el único estado compartido que este
proyecto ya tiene, y no hay Redis que montar (§47).

**Hasheado, no en claro.** La tabla guarda `sha256(subject)` en hexadecimal. El
limitador sólo necesita una clave opaca; guardar la IP la convertiría en un
segundo registro de direcciones, menos vigilado que `audit_logs` y sin la razón
que aquél tiene para guardarla (investigar un cambio concreto). Es
minimización de datos, ADR-016, aplicada a una tabla nueva.

Sin sal secreta, y hay que decirlo: quien pueda leer la tabla puede recorrer el
espacio IPv4 y revertir el hash. No es la amenaza contra la que existe. Existe
para que un volcado accidental no sea una lista de direcciones.

**Por IP y no por correo, en el login.** Contar por correo es más preciso y crea
un ataque nuevo: cualquiera bloquea la cuenta de otro mandando intentos con su
correo. Un limitador que se convierte en herramienta de denegación contra un
usuario concreto es peor que ninguno. Contando por IP, un atacante sólo se
bloquea a sí mismo; el precio es una oficina tras NAT compartiendo cuota
(KL-2509), que molesta pero no inutiliza nada.

**Falla abierto.** Si `consume_rate_limit` no responde, la petición sigue. Es la
decisión incómoda: un limitador que falla **cerrado** convierte cualquier
problema con su propia tabla en "nadie puede iniciar sesión". Esto es una
**segunda** línea —Supabase Auth ya trae la suya en `config.toml`, y no
desaparece si ésta falla—, así que su caída nos devuelve al estado de la Fase 24,
que fue aceptable durante veinticuatro fases. Fallar cerrado nos dejaría peor.

Es la postura **contraria** a `has_module()` (ADR-025 decisión 4), que falla
cerrado, y la diferencia es la que importa: allí, fallar abierto regala
funcionalidad de pago; aquí, fallar cerrado corta el acceso a todo el mundo.

**Sin ninguna política, para nadie.** `rate_limit_counters` tiene RLS activo y
cero políticas: sólo la función `SECURITY DEFINER` la toca. Un contador legible
sería un oráculo —_"¿cuántos intentos lleva este correo?"_— y uno escribible
sería una forma de bloquear a otro. Es la tercera tabla del proyecto con esa
forma, después de `subscription_events` (ADR-026) y `audit_logs` (ADR-028).

### 4. El barrido de aislamiento se GENERA del catálogo

Master pide _"pruebas de aislamiento cross-tenant"_ específicamente. Hay dos
formas de escribirlas.

A mano, tabla por tabla: cincuenta bloques que prueban lo que su autor recordó
incluir. La tabla cincuenta y uno —la que traiga la Fase 26— no está, y nadie
se entera.

O generado:

```sql
select table_name from information_schema.columns
where table_schema = 'public' and column_name = 'tenant_id'
```

Descubierto del esquema, el barrido cubre **lo que existe**, no lo que alguien
listó. Para cada tabla, como dueño del negocio A, prueba las cuatro operaciones
contra una fila del negocio B: `SELECT` da cero filas, `UPDATE` y `DELETE`
afectan a cero, e `INSERT` con el `tenant_id` de B se rechaza.

Es la misma técnica que `isolation.test.ts` (Fase 01) usa para exigir RLS en
toda tabla, llevada de la postura al dato.

**Y el barrido se comprueba a sí mismo.** TEST-2521 exige que descubra al menos
cuarenta tablas: un descubrimiento roto devolvería cero, y cero tablas
recorridas es un test verde que no probó nada. Es el modo de fallo específico
de los tests generados, y no ponerle una guarda sería regalar la propiedad que
los hace valer.

### 5. Un veredicto es un test, no una casilla

Las diecisiete áreas quedan escritas en la sección 26 del SPEC, cada una con su
evidencia. Pero las que se pueden ejecutar, se ejecutan:

```text
Toda Server Action exportada alcanza una puerta          TEST-2507
Toda pagina con modulo comprueba ESE modulo              TEST-2508
Toda pagina con permiso comprueba ESE permiso            TEST-2509
Ningun rol operativo tiene audit.view                    TEST-2510
Ninguna funcion SECURITY DEFINER se deja el search_path  TEST-2527
Ningun fichero de cliente importa el cliente de servidor TEST-2511
`service_role` no aparece en el codigo                   TEST-2512
```

Son tests **estructurales**: leen el código fuente y afirman una propiedad sobre
él. Cuestan poco y hacen que la conclusión de esta auditoría siga siendo cierta
en la Fase 28, que es cuando alguien volverá a preguntarla. La alternativa —
confiar en que nadie olvide— es exactamente lo que este proyecto lleva
veinticinco fases rechazando en la base de datos, aplicado ahora a la
aplicación.

Es también la respuesta concreta a lo que la Fase 21 pidió a ésta: _"comprobar
que ninguna página de módulo se olvidó su `requireFeature`"_. Comprobado una
vez, y desde ahora comprobado siempre.

### 6. KL-1902 se revisa y se ACEPTA; KL-2308 se arregla

Llegaron dos deudas a nombre de esta fase, y terminan distinto — que es lo que
una auditoría debe poder hacer.

**KL-1902 se acepta.** Cualquier miembro con `deliveries.manage` alcanza
cualquier entrega del negocio. Estrecharlo a "las mías" exigiría comparar el rol
dentro de una política RLS —lo que **ADR-010 prohíbe explícitamente**— o añadir
una columna de asignación que la Fase 19 decidió no tener. Y el alcance es
**dentro** de un negocio: no es un fallo de aislamiento, es un modelo de
permisos plano dentro del equipo, la misma postura que la Fase 16 ya aceptó
para `kitchen`. Deja de ser deuda y pasa a ser comportamiento decidido
(KL-2508).

**KL-2308 se arregla.** `order_items.product_id` está declarada `on delete set
null` desde la Fase 13, así que borrar un producto vendido **debía** funcionar.
Fallaba: ese `SET NULL` es un `UPDATE` sobre `order_items`, y chocaba con el
guardián que impide editar las líneas de un pedido cerrado — con un mensaje que
hablaba de pedidos a quien sólo quería limpiar su carta.

El arreglo admite **una sola** edición sobre un pedido cerrado: que
`product_id` pase de no nulo a nulo, sin tocar nada más. Cualquier otra sigue
rechazada, y hay un test que lo prueba. No se pierde nada, porque el nombre y el
precio son snapshots desde la Fase 13: el ticket histórico sigue diciendo lo
que decía.

La diferencia entre las dos: KL-1902 describe un modelo que sigue siendo el
correcto; KL-2308 describía una promesa del esquema que el esquema mismo
impedía cumplir.

## Alternatives considered

**CSP estática en `next.config.ts`.** Una línea, cubre todo, y necesita
`'unsafe-inline'` — con lo que no para el ataque que existe para parar.
Descartada.

**SRI en vez de nonce** (`experimental.sri`). Conserva el renderizado estático y
el caché de CDN, y es experimental y sólo cubre scripts de build. Con la
aplicación ya dinámica al 100 % menos cuatro rutas triviales, el beneficio era
casi nulo. Descartada, anotada por si la Fase 26 mide que importa.

**Dos CSP: una estricta en el proxy y otra permisiva en `next.config`.** El
navegador aplicaría las dos y ganaría la más restrictiva, así que las páginas
estáticas seguirían rotas. Descartada por no funcionar.

**Dejar `/sitio` fuera de la CSP.** Conserva el matcher tal cual, y deja sin
proteger la única superficie que renderiza contenido de terceros. Descartada
(decisión 2).

**Meter `/sitio` en el proxy tal cual.** Le habría añadido la llamada a Auth que
la Fase 09 evitó a propósito, acoplando la carta de cada restaurante a la
disponibilidad del login. Descartada a favor del cortocircuito.

**Rate limiting en memoria.** Cero infraestructura, y en serverless cuenta por
instancia: permite N veces el límite sin enterarse. Descartada.

**Rate limiting en Redis / Upstash.** Es la herramienta correcta para esto, y
exige contratar y configurar un servicio que no existe — el mismo argumento de
§47 que ADR-026 usó para no montar un scheduler. La base de datos ya está ahí.
Descartada por ahora.

**Contar el login por correo.** Más preciso contra un atacante, y convierte el
limitador en una herramienta para bloquear la cuenta de cualquiera. Descartada
(decisión 3).

**Fallar cerrado.** Más estricto sobre el papel, y convierte un problema de una
tabla auxiliar en una caída del login. Descartada, con el razonamiento escrito
para que no parezca un descuido.

**Escribir el barrido a mano.** Más legible fila a fila, y prueba lo que su
autor recordó. Descartada (decisión 4).

**Un pentest o un escaneo automatizado.** Es lo que de verdad cerraría varias de
estas áreas, y necesita un entorno desplegado con datos que no existe.
Trasladado a la Fase 28 (KL-2501), no simulado aquí.

## Consequences

**Positivas**

- Hay una CSP real, sin `unsafe-inline`, y cubre la superficie pública — que era
  la que más falta le hacía y la que se habría quedado fuera.
- La propiedad de disponibilidad de la Fase 09 sobrevive intacta: `/sitio` sigue
  sin depender de Supabase Auth.
- El login tiene un límite propio con estado compartido de verdad.
- El aislamiento cross-tenant está probado sobre todas las tablas, y una tabla
  futura entra en el barrido por existir.
- Siete propiedades de seguridad pasaron de "revisado una vez" a "comprobado en
  cada `npm test`".
- Dos deudas heredadas terminan resueltas: una arreglada, otra decidida.
- `docs/architecture/security.md` deja de ser una promesa de veinticinco fases.

**Negativas, aceptadas**

- Cuatro rutas dejan de ser estáticas. Son las cuatro triviales.
- El limitador falla abierto (KL-2507).
- Una oficina tras NAT comparte cuota de intentos (KL-2509).
- Ventana fija, no deslizante: el borde permite el doble en un instante
  (KL-2506).
- El hash del sujeto no lleva sal: protege de un volcado, no de quien ya lee la
  tabla.
- Nada está verificado contra un entorno desplegado ni contra un navegador real
  (KL-2501, KL-2502, KL-2505).

**Neutras**

- Dos migraciones, una tabla, dos funciones.
- Ningún permiso nuevo — y que una auditoría de permisos no produzca ninguno es
  parte del resultado.
- El proxy crece: emite cabeceras además de refrescar sesiones.
