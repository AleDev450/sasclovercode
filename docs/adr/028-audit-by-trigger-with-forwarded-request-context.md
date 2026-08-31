# ADR-028 — Auditoría escrita por trigger, con el contexto de la petición reenviado a la base de datos

```text
Status: ACCEPTED
Date:   2026-08-30
Phase:  24 — Audit + Observability
```

## Context

Master section 17 da el modelo de `audit_logs` columna por columna y termina con
una prohibición:

> `id, tenant_id, user_id, action, entity_type, entity_id, old_values,
new_values, ip_address, user_agent, created_at`
>
> Nunca guardar passwords, tokens o secretos en audit logs.

Y section 33 (Fase 24) pide _"completar observabilidad"_: audit logs, error
tracking, métricas, performance, request IDs, health checks, eventos críticos.

Ese modelo esconde una contradicción que hay que resolver antes de escribir una
línea. **`ip_address` y `user_agent` no existen en PostgreSQL.** Son datos de
la capa HTTP. Si la auditoría la escribe un trigger —que es lo que la hace
fiable— esas dos columnas quedan permanentemente en `NULL`, y declarar un campo
que nadie llena es peor que no declararlo. Si la escribe la aplicación —que es
donde el dato sí está— la auditoría depende de que veintitrés fases de Server
Actions se acuerden de llamarla.

Las decisiones:

1. **Quién escribe la auditoría.**
2. **Cómo llega el contexto HTTP a quien la escribe.**
3. **Qué se audita**, dado que ya existen cinco historiales de dominio.
4. **Cómo se garantiza que no entre un secreto**, hoy y dentro de diez fases.
5. **Qué pasa con `user_id` cuando el usuario se borra.**
6. **Qué se hace con "error tracking" y "métricas"** sin proveedor externo.

## Decision

### 1. Escriben triggers, y nadie más — no hay política de escritura

`audit_logs` tiene RLS activo y **una sola política, de `select`**. Ni `insert`,
ni `update`, ni `delete`, para ningún rol: tampoco para un platform admin.

Los quince triggers son `SECURITY DEFINER`, que es lo único que puede escribir
en una tabla sin política de escritura.

Dos razones, y la segunda es la importante:

**Porque no se puede olvidar.** Es la misma frase que este proyecto lleva
repitiendo desde la Fase 13: _un invariante que depende de que cada escritor se
acuerde no es un invariante_. Una auditoría que se escribe desde la Server
Action está completa el día que se escribe y tiene un agujero la primera vez que
alguien añade un camino nuevo — y un agujero en una auditoría no se nota, porque
lo que falta es precisamente lo que nadie miró.

**Porque un registro que alguien puede escribir es un registro que alguien puede
fabricar.** Si el `service_role` —o un admin, o una Server Action con un bug—
puede insertar en `audit_logs`, entonces la tabla deja de probar nada: cualquier
fila podría haberse puesto a mano. Y si alguien puede borrar, puede borrar
justo la que le incrimina. Es exactamente la postura, por exactamente la misma
razón, que `subscription_events` tomó en ADR-026 decisión 4.

El coste es real y se acepta: **la auditoría no se puede corregir**. Una fila
mal escrita se queda. Se prefiere a la alternativa.

### 2. El contexto de la petición viaja hasta el trigger

Ésta es la decisión que hace posible la número 1.

`createSupabaseServerClient()` adjunta tres cabeceras a cada petición que la
aplicación hace a Supabase:

```text
x-clovercode-ip:         la IP del visitante
x-clovercode-user-agent: su navegador
x-clovercode-request-id: el mismo id que va en cada línea de log
```

PostgREST expone **todas** las cabeceras de la petición en el GUC
`request.headers`, así que el trigger las lee:

```sql
current_setting('request.headers', true)::json ->> 'x-clovercode-ip'
```

Y con eso las dos columnas que section 17 pide se llenan de verdad, sin que la
escritura salga del trigger.

**Cabeceras propias y no las originales.** Se podría leer `x-forwarded-for`
directamente del GUC, porque el navegador no habla con PostgREST — habla con
Next.js, que habla con PostgREST. La cabecera original nunca llega. Reenviarla
bajo un nombre propio deja claro, en el nombre, que es un dato que esta
aplicación decidió pasar, y no algo que el cliente puso.

**Degradar a `NULL`, nunca fallar.** `audit_request_header()` devuelve `NULL`
cuando el GUC no existe — una migración, un test, la consola SQL, el ciclo de
cobranza — y `audit_client_ip()` devuelve `NULL` cuando el texto no es una IP
válida, capturando la excepción del cast. El peor caso de todo este camino es
**una fila de auditoría sin IP**. Nunca una escritura de negocio rota porque la
auditoría no pudo resolver una cabecera.

Y en la aplicación, la lectura de `headers()` va envuelta en `try/catch`,
porque `next/headers` lanza en contextos donde no hay petición. La regla de la
Fase 00 EC-02 se respeta intacta: **las cookies se leen antes que el entorno**,
y el reenvío se añade después de eso, sin tocar ese orden.

### 3. Se auditan las acciones sensibles de section 17, no todas las escrituras

Quince triggers sobre once tablas, cubriendo las nueve acciones que section 17
enumera. No una auditoría universal.

**Por qué no todo.** Un audit log que registra cada `UPDATE` registra sobre
todo pedidos avanzando de estado, que es la escritura más frecuente del
sistema y la menos interesante. El resultado es una tabla que crece rápido y
que nadie lee, y una auditoría que nadie lee no auditó nada. Section 17 no pide
"todo": pide _"toda acción sensible"_, y luego enumera nueve.

**Y por qué es barato.** Cada trigger lleva su puerta en la declaración:

```sql
after update of base_price_cents on public.products
for each row when (old.base_price_cents is distinct from new.base_price_cents)
```

`update OF` descarta cualquier sentencia que no toque esa columna, y el `WHEN`
descarta las que la tocan sin cambiarla. Un pedido que pasa de `preparing` a
`ready` no ejecuta una sola línea de código de auditoría.

**Y por qué no reemplaza a los historiales de dominio.** Ya existen
`order_status_history`, `billing_events`, `delivery_status_history`,
`subscription_events` y `loyalty_transactions`. Cuatro acciones se solapan con
ellos, deliberadamente, porque responden preguntas distintas:

```text
order_status_history   ¿que le paso a ESTE pedido?          -> el dominio
audit_logs             ¿que hizo ESTA persona, desde donde?  -> el control
```

Ninguna es derivable de la otra: el historial de dominio no tiene IP ni
user-agent ni cruza entidades, y la auditoría no tiene la máquina de estados. Y
la pregunta que sólo la auditoría contesta —_"enséñame todo lo que hizo este
usuario el martes"_— es la que se hace cuando algo ha ido mal. El coste del
solapamiento es una fila de más por acción (KL-2407).

### 4. La redacción es por patrón sobre el nombre de la clave, y comparte política con el logger

Section 17 dice _"nunca guardar passwords, tokens o secretos"_. Hay dos formas
de cumplirlo:

- **Una lista de columnas prohibidas.** Cumple hoy. Falla el día que alguien
  añada `stripe_api_key` a una tabla auditada sin acordarse de la lista — que
  es el mismo modo de fallo que la decisión 1 acaba de rechazar, una decisión
  antes.
- **Una regla sobre el nombre.** Cubre lo que todavía no se ha escrito.

Se eligió la segunda. `audit_redact()` normaliza el nombre de cada clave
(minúsculas, sin caracteres no alfanuméricos) y lo compara contra el mismo
conjunto de patrones que `src/lib/logger/redact.ts` usa desde la Fase 00:
`password`, `token`, `secret`, `apikey`, `credential`, `authorization`,
`cookie`, `servicerole`, `privatekey`, `signature`, `otp`, `pin`, `cvv`, `jwt`,
`bearer`.

**Se reemplaza el valor por `[REDACTED]`, no se borra la clave.** El mismo
sentinela que el logger. Borrarla haría indistinguible "este campo no cambió"
de "este campo cambió y no te lo enseño", y la segunda es información que un
auditor quiere.

**Y las dos implementaciones se prueban la una contra la otra.** El test de base
de datos importa `isSensitiveKey` de la Fase 00 y comprueba, sobre la misma
lista de nombres, que TypeScript y SQL dan la misma respuesta. Dos copias de una
política que nadie compara son dos políticas.

El caso concreto que motiva todo esto es real y ya está en el esquema:
`billing_provider_configs.credentials_secret_id` (ADR-021). No es la credencial
—vive en Vault— pero es la referencia a ella, y cae por contener "credential".

### 5. `user_id` no tiene clave foránea, y se guarda el correo junto a él

`auth.users` tiene `on delete cascade` hacia `profiles`. Si `audit_logs.user_id`
apuntara a `auth.users`, sólo hay dos finales posibles al borrar un usuario:
`cascade`, que **borra la auditoría de lo que esa persona hizo**, o `set null`,
que **borra la única prueba de quién lo hizo**. Los dos destruyen exactamente
aquello para lo que existe la tabla.

Así que no hay clave foránea, y el correo se copia en la fila:

```sql
user_id     uuid   -- sin FK, a proposito
user_email  text   -- snapshot
```

Es disciplina de snapshot (ADR-017), aplicada al actor por la misma razón por la
que se aplica a un precio: **un registro histórico que se resuelve por
referencia cambia cuando cambia la referencia**, y entonces deja de ser
histórico. Y sin él, la pantalla enseñaría un UUID que ya no resuelve contra
nada.

`tenant_id` **sí** tiene su clave foránea con `on delete cascade`: la auditoría
de un negocio es dato de ese negocio y se va con él. Eso obliga a una guarda de
tres líneas en el escritor — si el tenant ya no existe, no se escribe — porque
al borrar un tenant PostgreSQL borra primero el padre y luego cascadea a los
hijos, y el trigger del hijo intentaría insertar apuntando a un tenant que ya no
está. Sin esa guarda, borrar un tenant fallaría por la auditoría, que es
justamente el tipo de fallo que la decisión 2 promete que no puede ocurrir.

### 6. Sin proveedor externo: `onRequestError` al logger, y números en pantalla

**Error tracking.** `src/instrumentation.ts` exporta `onRequestError`, el hook
nativo de Next.js: recibe todo error de servidor no capturado —Server
Components, Route Handlers, Server Actions y el proxy— con su ruta, su método,
su `routeType` y su digest. No se envuelve nada en `try/catch`, y no hay ningún
sitio del que un error pueda escaparse por olvido.

Escribe al logger estructurado de la Fase 00. **No se integra Sentry**, por el
precedente que ADR-021 sentó con `BillingProvider` y que section 44 respalda: no
se implementa un proveedor sin credenciales reales contra las que probarlo, o lo
que queda es un adapter que nadie ha ejecutado. `onRequestError` es el punto
único donde entra el día que se contrate uno (KL-2404).

**Métricas.** `platform_diagnostics()` devuelve los números que una persona mira
en una pantalla: tenants, suscripciones activas y suspendidas, pedidos de las
últimas 24 horas, filas de auditoría, y el cobro pendiente más antiguo. Es lo
que section 33 pide para el Super Admin.

Lo que no hay son series temporales. Exportar a Prometheus u OpenTelemetry
necesita un colector que nadie ha montado, y montarlo es infraestructura que
section 47 dice explícitamente que no se decide por adelantado. Section 26 lo
cierra: _"medir antes de optimizar"_ — y esta pantalla es el primer sitio del
proyecto donde hay algo que medir (KL-2405).

**Health check.** `/api/health` deja de mentir. La Fase 00 dejó escrito en el
propio fichero que esto era trabajo de esta fase, y aquí está: comprueba la base
de datos, mide su latencia, y responde `degraded` con **503** cuando falla, con
el detalle de qué dependencia y por qué. Un balanceador que recibe `200` de una
instancia cuya base no responde deja el tráfico donde está.

### 7. `audit.view`, el primer permiso nuevo desde la Fase 20

Las Fases 21, 22 y 23 no crearon ninguno, y ADR-025 escribió la prueba: un
permiso nuevo sólo se justifica si gobierna algo que ningún permiso existente
gobierna.

Aquí la prueba da el resultado contrario. _"Ver quién cambió qué"_ es una
capacidad que un dueño puede querer dar a su contador sin darle
`settings.manage`, y que quiere **negar** a quien opera aunque le dé
`orders.update`.

```text
owner, admin, accountant       si
manager, cashier, waiter,
kitchen, delivery              no
```

`manager` queda fuera y es la decisión menos obvia: un encargado tiene
`products.update` y `orders.cancel`, así que es de los principales **sujetos**
de esta auditoría. Auditar es una función de control, y quien opera no controla
su propia operación.

## Alternatives considered

**Escribir la auditoría desde las Server Actions.** Tiene la IP a mano sin
reenviar nada, y admite un texto explicativo por acción. Y depende de que
veintitrés fases de código y todas las futuras se acuerden, y deja `audit_logs`
escribible — con lo que deja de probar nada. Descartada por las dos razones de
la decisión 1.

**Trigger, con `ip_address` y `user_agent` siempre en `NULL`.** Honesto sobre lo
que PostgreSQL sabe, e incumple el modelo de section 17 declarando dos columnas
muertas. Descartada; el reenvío de cabeceras cuesta diez líneas.

**Leer `x-forwarded-for` del GUC directamente.** Una cabecera menos que
inventar, y confunde en el nombre lo que el cliente mandó con lo que esta
aplicación decidió pasar. Descartada a favor de un prefijo propio.

**Auditar cada `UPDATE` de cada tabla.** Cobertura total, y una tabla que crece
con ruido y que nadie lee. Descartada (decisión 3).

**Una lista de columnas sensibles.** Explícita y auditable de un vistazo, y
falla en silencio la primera vez que alguien añade una columna. Descartada
(decisión 4).

**`user_id` con `on delete set null`.** La convención del resto del esquema, y
aquí borra la única prueba de quién hizo qué. Descartada (decisión 5).

**Guardar la fila entera sin redactar y filtrar al leerla.** Conserva más, y
significa que el secreto **está** en la base de datos: un volcado, un backup o
un `service_role` lo saca. Section 17 dice "nunca guardar". Descartada.

**Integrar Sentry ya.** Es lo que se usará, y sin credenciales sería un adapter
no ejecutado — el error que ADR-021 ya declinó cometer una vez. Descartada, con
el punto de entrada preparado.

**Vistas materializadas para el diagnóstico.** Mismo argumento que ADR-027
decisión 2, y aquí menos aún: son seis contadores que mira una persona.
Descartada.

## Consequences

**Positivas**

- La auditoría no se puede olvidar, no se puede fabricar y no se puede borrar.
- Las once columnas de section 17 se llenan de verdad, IP y user-agent
  incluidas.
- El `request_id` es el mismo en el log de la aplicación y en la fila de
  auditoría, así que _"algo falló"_ se convierte en _"esto falló"_.
- Ningún secreto puede entrar, incluidos los de columnas que aún no existen — y
  la regla es la misma que el logger ya aplicaba, probada contra ella.
- Un usuario borrado no se lleva la prueba de lo que hizo.
- `/api/health` deja de decir `ok` con la base caída.
- Todo error de servidor queda registrado sin envolver nada.
- Añadir una acción auditada son tres líneas: el escritor genérico ya existe.

**Negativas, aceptadas**

- La auditoría es incorregible: una fila mal escrita se queda para siempre.
- El reenvío de cabeceras no está probado contra un Supabase desplegado
  (KL-2401); degrada a `NULL`, nunca a una escritura rota.
- La IP viene de una cabecera y un cliente puede mentirla (KL-2403). El
  `user_id` sale de `auth.uid()` y no.
- `audit_logs` sólo crece; la retención es de la Fase 27 (KL-2402).
- Cuatro acciones quedan registradas dos veces (KL-2407).
- Sin proveedor de errores, sin series temporales y sin alertas
  (KL-2404/05/06).
- Un permiso nuevo, con lo que la matriz de roles crece por primera vez desde
  la Fase 20.

**Neutras**

- Cuatro migraciones, una tabla, cinco funciones y quince triggers.
- `createSupabaseServerClient()` cambia por primera vez desde la Fase 00, y
  sólo para añadir cabeceras después de leer las cookies.
