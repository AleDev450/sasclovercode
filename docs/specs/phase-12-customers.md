# SPEC — Phase 12 — Customers

## 1. Información general

```text
Phase:                12
Nombre:               Customers
Estado:               COMPLETED
Versión:              1.0.0
Fecha creación:       2026-08-27
Última actualización: 2026-08-27
Responsable:          alejandro.avendano@masuno.pe
```

Documento maestro: §7, §8, §10, §11, §12, §18, §21, §22, §30, §32, §33 (Fase 12), §45.
Fases previas: 00 a 11 — todas COMPLETED y auditadas.

---

## 2. Objetivo

### ¿Por qué existe esta fase?

Hasta ahora CloverCode sabe quién es el negocio (Fase 01), quién trabaja en él
(Fases 02–03), dónde opera (Fase 10) y qué vende (Fase 11). No sabe **a quién le
vende**.

Es la última pieza de datos maestros antes de lo operativo. La Fase 13 crea
pedidos, y un pedido en el Perú se le hace a alguien: aunque sea un consumidor
anónimo que paga en efectivo, el momento en que pide factura hay que tener un
RUC guardado y bien guardado.

### La frase que gobierna la fase

§33, Fase 12, textual:

> No almacenar más información personal de la necesaria.

Es la única fase cuyo instructivo maestro es una **restricción**, no una
capacidad. Todas las demás dicen qué construir; esta dice qué no guardar. El
diseño se lee entero desde ahí: cada columna de `customers` tuvo que justificar
su existencia contra una operación concreta que la necesita, y las que no
pudieron no están.

### ¿Qué debe ser posible al terminarla?

```text
Registrar un cliente con su documento peruano (DNI, RUC, CE) validado.
Registrar sus direcciones de entrega.
Buscarlo por documento, teléfono o nombre, con paginación.
Desactivarlo sin perderlo.
Que la Fase 13 pueda colgar un pedido de él.
Que la Fase 17 pueda emitir un comprobante a su documento.
```

---

## 3. Alcance

### Incluido

```text
Tabla customers con identidad fiscal peruana (DNI / RUC / CE).
Tabla customer_addresses.
Validación de documento en base de datos, incluido el dígito
  verificador del RUC.
RLS: lectura con customers.view, escritura con customers.manage.
Cero exposición pública. Ninguna política para anon.
Dashboard: listado con búsqueda y paginación, alta, edición,
  desactivación, y gestión de direcciones.
```

### Fuera de alcance

```text
Historial de compras          — no existen pedidos hasta la Fase 13.
Coordenadas de la dirección   — Fase 19 (Delivery) es quien geocodifica.
Zonas y tarifas de reparto    — Fase 19.
Puntos, niveles, cumpleaños   — Fase 20 (Loyalty).
Crédito y cuentas por cobrar  — Fase 14.
Notas libres sobre el cliente — ver §11, "Sensitive information".
Importación masiva            — no la pide §33 y multiplica el riesgo
                                de esta fase por el tamaño del archivo.
Portal de autoservicio        — un cliente no tiene login. No es un
                                usuario de CloverCode, es un dato del
                                negocio.
Borrado de clientes           — ver KL-1204.
```

### La decisión de alcance que más costó

`historial` aparece en §33 bajo **"Preparar:"**, no bajo "Crear:". Se leyó como
lo que dice: preparar el terreno, no construir la pantalla. El historial de un
cliente son sus pedidos, y no hay pedidos hasta la Fase 13.

Lo que esta fase sí hace para prepararlo:

```text
Un cliente tiene un id estable al que la Fase 13 puede apuntar.
Un cliente se desactiva, nunca se borra, así que el historial
  nunca queda colgando (KL-1204).
La unicidad de documento es por tenant, así que dos negocios
  pueden tener al mismo señor sin compartir su historial.
```

---

## 4. Dependencias

```text
Phase 00 — Foundation           errores, logger, validación, entorno
Phase 01 — Multi-Tenancy Core   tenants, resolución, requireActiveTenant
Phase 02 — Authentication       sesión en servidor
Phase 03 — Authorization + RLS  has_permission, customers.view/manage
Phase 05 — Tenant Dashboard     layout, navegación, guardas de página
```

**Nada nuevo en el catálogo de permisos.** `customers.view` y `customers.manage`
existen desde la Fase 03 (`20260825130000_create_authorization_catalog.sql`),
con sus grants ya repartidos. Esta fase los consume; no los inventa.

---

## 5. Casos de uso

```text
UC-1201
Actor           Cajero
Precondiciones  Sesión activa, membresía activa, customers.manage
Acción          Registra un cliente nuevo con su DNI
Resultado       Cliente creado y activo, buscable de inmediato
Errores         DNI mal formado -> mensaje de campo
                DNI ya registrado en este negocio -> conflicto de campo
                Sin permiso -> AuthorizationError

UC-1202
Actor           Cajero
Precondiciones  El cliente pide factura
Acción          Registra el cliente con RUC
Resultado       Cliente creado con doc_type = ruc
Errores         RUC de 11 dígitos con dígito verificador incorrecto
                  -> mensaje de campo, la base lo rechaza igual
                RUC con prefijo inválido -> mensaje de campo

UC-1203
Actor           Mozo
Precondiciones  Sesión activa, customers.view, SIN customers.manage
Acción          Abre /dashboard/{slug}/clientes
Resultado       Ve el listado, sin formularios ni acciones de escritura
Errores         Si fuerza el Server Action -> AuthorizationError

UC-1204
Actor           Administrador
Precondiciones  Un cliente dejó de comprar / pidió no ser contactado
Acción          Lo desactiva
Resultado       is_active = false; deja de aparecer por defecto en el
                listado; su historial futuro queda intacto
Errores         Sin permiso -> AuthorizationError

UC-1205
Actor           Cajero
Precondiciones  Cliente existente, customers.manage
Acción          Añade una dirección de entrega y la marca predeterminada
Resultado       Dirección creada; deja de ser predeterminada cualquier
                otra del mismo cliente
Errores         Dirección de un cliente de otro negocio -> rechazo de la
                base de datos, no del formulario

UC-1206
Actor           Visitante anónimo de la web pública
Precondiciones  Ninguna
Acción          Intenta leer customers por cualquier vía
Resultado       Cero filas. No hay política que se lo permita.
Errores         —
```

---

## 6. Requerimientos funcionales

```text
FR-1201  Un cliente pertenece a exactamente un tenant.

FR-1202  Un cliente tiene un nombre obligatorio, de 1 a 200 caracteres
         una vez recortado.

FR-1203  El documento es opcional: tipo y número, ambos o ninguno.
         Un negocio puede atender a alguien sin pedirle el DNI.

FR-1204  Los tipos de documento son exactamente dni, ruc y ce.

FR-1205  Un DNI tiene exactamente 8 dígitos.

FR-1206  Un CE tiene entre 8 y 12 caracteres alfanuméricos en mayúscula.

FR-1207  Un RUC tiene exactamente 11 dígitos, empieza en un prefijo
         válido (10, 15, 16, 17, 20) y su dígito verificador debe
         cuadrar con el algoritmo módulo 11 de SUNAT.

FR-1208  Dos clientes del MISMO negocio no pueden compartir tipo y
         número de documento. Dos clientes de negocios DISTINTOS sí.

FR-1209  El email, si se registra, debe tener forma de email y ser
         único por negocio, sin distinguir mayúsculas.

FR-1210  El teléfono, si se registra, se guarda normalizado a dígitos y
         un "+" inicial opcional.

FR-1211  Un cliente se desactiva, nunca se borra.

FR-1212  El listado admite búsqueda por nombre, documento, teléfono o
         email, y está paginado. §18: paginar siempre.

FR-1213  El listado muestra por defecto solo clientes activos.

FR-1214  Un cliente puede tener varias direcciones.

FR-1215  Una dirección pertenece al mismo tenant que su cliente, y ese
         tenant lo deriva la base de datos, no el cliente HTTP.

FR-1216  Como mucho una dirección predeterminada por cliente.

FR-1217  Ninguna lectura de customers ni customer_addresses está
         disponible para anon.
```

---

## 7. Requerimientos no funcionales

```text
NFR-1201 Seguridad
  Datos personales. El control es RLS, y la ausencia deliberada de
  política pública. Ninguna consulta de esta fase corre con
  service-role. Ver §11.

NFR-1202 Performance
  El listado se sirve con un índice por (tenant_id, is_active) y la
  búsqueda por (tenant_id, phone) y (tenant_id, lower(email)).
  Paginación por rango fijo de 20 filas.

NFR-1203 Escalabilidad
  Un restaurante con veinte mil clientes es normal. Ninguna consulta
  de esta fase trae la tabla entera: el listado pagina y el detalle
  trae un cliente.

NFR-1204 Observabilidad
  Se registran los eventos de §16. Ningún log incluye el número de
  documento, el email ni el teléfono: solo el id del cliente.

NFR-1205 Accesibilidad
  Formularios con label asociado, errores anunciados, tabla con
  caption. Igual que las Fases 10 y 11.

NFR-1206 Mantenibilidad
  La validación de documentos vive en un módulo puro y probado
  (documents.ts), no repartida entre formulario y acción.
```

---

## 8. Modelo de datos

### Enum nuevo

```text
customer_doc_type = ('dni', 'ruc', 'ce')
```

Exactamente los tres que nombra §33. No se añadió `pasaporte` pese a ser
frecuente en un hotel o un restaurante turístico: no está en el maestro y §51
prohíbe adelantar funcionalidad. Añadirlo después es `alter type ... add value`,
que no reescribe la tabla.

### customers

```text
id           UUID PK
tenant_id    UUID NOT NULL -> tenants(id) ON DELETE CASCADE
name         TEXT NOT NULL
doc_type     customer_doc_type NULL
doc_number   TEXT NULL
email        TEXT NULL
phone        TEXT NULL
is_active    BOOLEAN NOT NULL DEFAULT true
created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()

UNIQUE (tenant_id, doc_type, doc_number)   parcial, WHERE doc_number IS NOT NULL
UNIQUE (tenant_id, lower(email))           parcial, WHERE email IS NOT NULL

CHECK  customers_document_complete
       (doc_type IS NULL) = (doc_number IS NULL)
CHECK  customers_document_format
       valida el número según el tipo, RUC incluido dígito verificador
CHECK  customers_name_length      1..200 recortado
CHECK  customers_email_format     forma de email, <= 200
CHECK  customers_phone_format     ^\+?[0-9]{6,20}$

INDEX  customers_tenant_active_idx  (tenant_id, is_active)
INDEX  customers_tenant_phone_idx   (tenant_id, phone) WHERE phone IS NOT NULL
INDEX  customers_tenant_name_idx    (tenant_id, lower(name))
```

Lo que **no** tiene esta tabla, y por qué, está en §11.

### customer_addresses

```text
id           UUID PK
customer_id  UUID NOT NULL -> customers(id) ON DELETE CASCADE
tenant_id    UUID NOT NULL -> tenants(id) ON DELETE CASCADE
label        TEXT NOT NULL          "Casa", "Oficina"
address_line TEXT NOT NULL
district     TEXT NULL
city         TEXT NULL
reference    TEXT NULL              "frente al parque"
is_default   BOOLEAN NOT NULL DEFAULT false
created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()

UNIQUE INDEX customer_addresses_one_default_per_customer
       (customer_id) WHERE is_default

CHECK  longitudes de label (1..60), address_line (1..300),
       district (<=100), city (<=100), reference (<=200)

INDEX  customer_addresses_customer_idx (customer_id)
```

`tenant_id` está denormalizado y lo mantiene un trigger, igual que
`location_hours` (Fase 10) y los hijos de `products` (Fase 11): sin él cada
política tendría que unir con `customers` para saber de quién es la fila.

`ON DELETE CASCADE` desde `customers` es correcto aquí y solo aquí: una
dirección no tiene sentido sin su cliente, y como el cliente no se borra nunca
(KL-1204), la cascada no se dispara en la práctica.

### Función nueva

```text
public.is_valid_ruc(text) -> boolean   IMMUTABLE
```

Inmutable a propósito: un CHECK solo puede llamar funciones inmutables, y el
dígito verificador debe vivir en la base de datos. Ver §11.

---

## 9. Diagrama de relaciones

```text
tenants
   │
   ├──────────────► customers ──────────► customer_addresses
   │                    ▲                        │
   │                    │  tenant_id derivado    │
   └────────────────────┴────────────────────────┘

Fase 13 (futuro):
   orders.customer_id ──────► customers.id
   orders.address_id  ──────► customer_addresses.id
```

Un cliente **no** cuelga de `auth.users`. No es un usuario de CloverCode; es un
dato del negocio. Confundir las dos cosas obligaría a crear una cuenta a cada
persona que compra un menú.

---

## 10. Tenant Isolation

```text
Tenant Isolation Impact: TOTAL
```

**¿Cómo se determina el tenant?**
Como en toda página del dashboard: `requireActiveTenant(tenantSlug)` (Fase 01)
resuelve el slug de la URL contra la membresía activa del usuario. Ningún
Server Action acepta un `tenantId` del formulario.

**¿Qué tablas llevan tenant_id?**
Las dos. `customers` lo recibe de la aplicación y lo verifica RLS;
`customer_addresses` lo **deriva un trigger** desde su cliente y no se acepta
del cliente HTTP.

**¿Cómo evita RLS acceso cross-tenant?**
Toda política se apoya en `has_permission(tenant_id, ...)`, que resuelve contra
`tenant_members` del usuario de la sesión. Una fila de otro tenant no satisface
la condición, así que no existe para esa sesión — ni se lee, ni se actualiza.
En INSERT el `with check` se evalúa contra el `tenant_id` **de la fila escrita**,
no contra nada que el cliente afirme por separado.

**¿Qué consultas requieren validación tenant?**
Todas. Cada consulta del módulo filtra por `tenant_id` **además** de confiar en
la política, por la misma razón que la Fase 11: la política decide si el
llamante puede ver algo, el filtro decide de qué negocio es ese algo.

**¿Existe algún recurso global?**
No. Y en particular, **el documento de una persona no es global**: el mismo DNI
puede ser cliente de cien negocios distintos, y cada uno es una fila
independiente que no le dice nada a los otros. Un `UNIQUE(doc_number)` global
habría convertido a CloverCode en un padrón nacional de clientes compartido
entre competidores — que es exactamente lo que §11 prohíbe y lo que la Fase 11
tuvo que repetir para slugs.

---

## 11. Seguridad

```text
Authentication requirements
  Sesión válida resuelta en servidor. La ruta /dashboard ya está
  cerrada por defecto desde la Fase 02.

Authorization requirements
  customers.view    para leer
  customers.manage  para crear, editar y desactivar

Roles involucrados
  owner, admin, manager, cashier   view + manage
  waiter, delivery                 view
  kitchen, accountant              ninguno

Permissions involucrados
  Ninguno nuevo. Los dos existen desde la Fase 03.

RLS policies
  customers_select_member          customers.view
  customers_insert_manager         customers.manage
  customers_update_manager         customers.manage
  customer_addresses_select_member customers.view
  customer_addresses_insert_manager / update / delete  customers.manage

  SIN política para anon, en ninguna de las dos tablas.
  SIN política de DELETE sobre customers.

Input validation
  Zod en el borde, CHECK en la base. El documento se valida en los dos
  sitios y el dígito verificador del RUC también.

Rate limits
  No corresponden en esta fase: no hay endpoint anónimo.
```

### La decisión de seguridad de esta fase

**No hay política pública.** Ni `anon`, ni `authenticated` por la vía pública.

Merece decirse en voz alta porque las dos fases anteriores hicieron lo
contrario. `locations` y `products` tienen una `..._select_public` que expone
filas a `anon`, y con razón: un menú y una dirección de local existen para ser
vistos. Copiar ese patrón por inercia aquí habría publicado la agenda de
clientes de cada negocio.

Es el tipo de defecto que no falla ruidosamente: la web pública seguiría
renderizando bien y nadie lo notaría hasta que alguien consultara la tabla
directamente. Por eso TEST-1210 no comprueba que el listado público no los
muestre; comprueba que **no existe ninguna política que nombre a `anon`** sobre
estas dos tablas. Una ausencia hay que afirmarla, o vuelve.

### Sensitive information — qué NO se guarda

§33 dice "no almacenar más información personal de la necesaria". Estas columnas
se consideraron y se descartaron:

```text
notas / observaciones   Un campo libre sobre una persona termina
                        conteniendo datos de salud ("alérgico al maní"),
                        juicios de valor y cosas que nadie querría ver
                        impresas. Ninguna operación de esta fase lo
                        necesita.

fecha de nacimiento     Solo la querría el módulo de fidelización, que
                        es la Fase 20. Que la pida esa fase, y que
                        justifique entonces por qué.

género                  Ninguna operación lo usa.

dirección en customers  Está en customer_addresses, que es donde tiene
                        sentido: una persona tiene varias.
```

Los logs (§16) registran el id del cliente y nunca su documento, email ni
teléfono. Un log es el sitio donde los datos personales se escapan sin que nadie
lo haya decidido: se copian a otro sistema, se retienen más tiempo que la fila y
los lee gente que no tiene `customers.view`.

### El dígito verificador vive en la base de datos

Un RUC con el dígito verificador mal es un RUC que **no existe**. Si entra a la
tabla, la Fase 17 lo manda a SUNAT, SUNAT rechaza el comprobante, y el error
aparece a cinco fases de distancia del formulario que lo causó, con una factura
de por medio.

Podría validarse solo en Zod. No basta: el formulario no es el único escritor —
un operador de plataforma tiene políticas, la Fase 15 tendrá su propio POS y la
Fase 13 creará clientes al vuelo. Una invariante que depende de que todos se
acuerden no es una invariante. Es el mismo argumento que la Fase 10 usó para
`guard_last_active_location`.

La forma concreta es `is_valid_ruc(text)` marcada `immutable` y llamada desde el
CHECK. El algoritmo es el módulo 11 de SUNAT: pesos `5,4,3,2,7,6,5,4,3,2` sobre
los diez primeros dígitos, `11 - (suma mod 11)`, con 10 → 0 y 11 → 1.

---

## 12. API / Server Actions

Ningún endpoint REST. Server Actions, como todas las fases del dashboard.

```text
createCustomerAction(prev, formData) -> FormState
  Permission: customers.manage
  Input:  tenantSlug, name, docType, docNumber, email, phone
  Output: FormState
  Errores: 23505 -> conflicto de documento o email
           23514 -> documento con formato o dígito verificador inválido

updateCustomerAction(prev, formData) -> FormState
  Permission: customers.manage
  Input:  tenantSlug, customerId, + los mismos campos
  Filtra por tenant_id además de por id.

setCustomerActiveAction(prev, formData) -> FormState
  Permission: customers.manage
  Input:  tenantSlug, customerId, isActive

addCustomerAddressAction(prev, formData) -> FormState
  Permission: customers.manage
  Input:  tenantSlug, customerId, label, addressLine, district,
          city, reference, isDefault
  NO envía tenant_id: lo deriva el trigger.

deleteCustomerAddressAction(prev, formData) -> FormState
  Permission: customers.manage
  Una dirección SÍ se borra. No es historial: es un dato de contacto
  actual, y una persona que se mudó no quiere que su casa anterior
  siga en la lista. El pedido de la Fase 13 guardará su propia copia
  de la dirección de entrega, así que borrarla no toca el historial.
```

Consultas:

```text
listCustomers(tenantId, { search, includeInactive, page }) -> Page<Customer>
getCustomerDetail(tenantId, customerId) -> CustomerDetail | null
```

---

## 13. UI / UX

```text
/dashboard/{slug}/clientes

  Propósito     Encontrar un cliente y registrar uno nuevo
  Acciones      Buscar, paginar, ver inactivos, crear
  Loading       Server Component; el layout del dashboard ya provee
                el marco
  Empty state   Sin clientes: explica que se registran al vender.
                Con búsqueda sin resultados: lo dice y ofrece limpiar.
  Error state   Error de base de datos -> DatabaseError, boundary
  Success       Mensaje del FormState en el formulario
  Permissions   customers.view para entrar
                customers.manage para ver el formulario de alta

/dashboard/{slug}/clientes/{customerId}

  Propósito     Editar un cliente y sus direcciones
  Acciones      Editar datos, activar/desactivar, añadir y quitar
                direcciones
  Empty state   Sin direcciones: "Aún no tiene direcciones."
  Error state   Cliente inexistente o de otro tenant -> notFound()
  Permissions   customers.view para entrar
                customers.manage para escribir
```

La búsqueda va en la URL (`?q=`, `?page=`, `?inactivos=1`), no en estado de
cliente: una búsqueda que se puede compartir y que sobrevive a recargar la
página, y un Server Component que la lee sin JavaScript.

Entrada de navegación nueva: **Clientes**, con `customers.view`, entre Catálogo
y Sedes. Ocultarla no es control de acceso (§45): la página vuelve a comprobar.

---

## 14. Flujos principales

```text
Cajero
   ↓
/dashboard/{slug}/clientes
   ↓
requireActiveTenant  -> tenant o notFound
   ↓
hasPermission(customers.view) -> o notFound
   ↓
listCustomers(tenant.id, filtros)  [RLS + filtro explícito]
   ↓
Formulario de alta (solo si customers.manage)
   ↓
createCustomerAction
   ↓
requireActiveTenant + requirePermission(customers.manage)
   ↓
Zod: nombre, documento (dígito verificador), email, teléfono
   ↓
insert customers  [RLS with check + CHECK de documento]
   ↓
23505 -> mensaje de campo   23514 -> documento inválido
   ↓
revalidatePath -> el listado se refresca
```

---

## 15. Manejo de errores

```text
Documento duplicado en el negocio  -> 23505 -> campo docNumber
Email duplicado en el negocio      -> 23505 -> campo email
Documento mal formado              -> Zod, y 23514 si llegara igual
RUC con dígito verificador malo    -> Zod, y 23514 si llegara igual
Cliente inexistente o de otro tenant -> notFound() / mensaje neutro
Dirección de otro cliente          -> la política no la alcanza
Sin permiso                        -> AuthorizationError
Error de base de datos             -> DatabaseError, sin detalle al cliente
```

Un cliente que no existe y uno que es de otro negocio dan **la misma**
respuesta. Distinguirlos permitiría descubrir por prueba y error qué ids existen
en otros negocios.

---

## 16. Observabilidad

```text
customer.created
customer.updated
customer.activated
customer.deactivated
customer.address.added
customer.address.removed
```

Cada uno lleva `tenantId` y `customerId`. **Ninguno lleva documento, email,
teléfono ni nombre.** Ver §11.

---

## 17. Testing Plan

### Unit

```text
TEST-1201  normalizeDocument recorta, sube a mayúsculas y quita
           separadores de un DNI/CE.
TEST-1202  Un DNI válido pasa; 7 y 9 dígitos no; con letras no.
TEST-1203  RUC válido conocido pasa (20131312955, 20100047218).
TEST-1204  RUC con el último dígito cambiado falla.
TEST-1205  RUC con prefijo inválido (12, 99) falla.
TEST-1206  CE alfanumérico de 9 pasa; de 7 no; con símbolos no.
TEST-1207  normalizePhone deja "+51987654321" y "987654321",
           y rechaza texto.
TEST-1208  El schema de cliente acepta documento ausente y rechaza
           tipo sin número y número sin tipo.
TEST-1209  La navegación muestra Clientes con customers.view y la
           oculta sin él.
```

### RLS / Authorization

```text
TEST-1210  NINGUNA política de customers ni customer_addresses
           concede a anon. Se afirma sobre pg_policies, no sobre una
           consulta. (La decisión de §11.)
TEST-1211  Un miembro con customers.view lee los clientes de su
           negocio.
TEST-1212  Un miembro del tenant A no ve ni un cliente del tenant B.
TEST-1213  kitchen (sin customers.view) no lee ninguno.
TEST-1214  waiter (view, sin manage) lee pero no inserta.
TEST-1215  Un insert que declara el tenant_id de otro negocio es
           rechazado por el with check.
TEST-1216  No existe política de DELETE sobre customers.
TEST-1217  El tenant_id de una dirección lo pone el trigger, e ignora
           el que mande el cliente.
```

### Integration / Database

```text
TEST-1218  El mismo DNI en dos tenants distintos convive. El mismo
           DNI dos veces en un tenant, no. (§11.)
TEST-1219  Dos clientes sin documento conviven: el índice es parcial.
TEST-1220  Un RUC con dígito verificador inválido es rechazado por la
           BASE, no solo por Zod.
TEST-1221  Email duplicado por tenant sin distinguir mayúsculas.
TEST-1222  Como mucho una dirección predeterminada por cliente.
TEST-1223  Borrar un tenant se lleva sus clientes y direcciones.
```

### Regression

```text
TEST-1224  El contrato de tipos incluye customers y customer_addresses
           (schema-contract).
TEST-1225  Ninguna tabla fuera del contrato declarado.
```

---

## 18. Edge Cases

```text
Cliente sin documento               Válido. Es el caso normal de un
                                    consumidor que paga en efectivo.

Dos clientes sin documento          Conviven: el índice único es
                                    parcial.

El mismo DNI en dos negocios        Conviven. Filas independientes.

DNI con puntos o espacios           Se normaliza antes de validar.

RUC de 11 dígitos bien formado
pero inexistente en SUNAT           Entra. Verificar existencia real
                                    es consultar a SUNAT, y eso es la
                                    Fase 17.

CE con letras minúsculas            Se normaliza a mayúscula.

Cliente desactivado                 No aparece por defecto; sigue
                                    siendo legible y editable.

Cliente con 50 direcciones          Ninguna consulta pagina las
                                    direcciones. Ver KL-1203.

Teléfono con prefijo país           Se acepta con "+" inicial.

Búsqueda con % o _                  Se escapan antes del ILIKE, o
                                    "%" listaría todo.

Página fuera de rango               Devuelve vacío, no error.
```

---

## 19. Performance considerations

```text
Queries      El listado pagina por rango de 20. El detalle trae un
             cliente y sus direcciones en una consulta con embed, no
             en dos (evita el N+1 que tendría el listado si mostrara
             direcciones).

Indexes      (tenant_id, is_active) sirve al listado por defecto.
             (tenant_id, phone) parcial sirve a la búsqueda por
             teléfono, que es la del POS.
             (tenant_id, lower(name)) sirve al orden alfabético.

Pagination   Por offset. Con 20 mil clientes y páginas de 20, el
             offset profundo es lento, pero nadie navega a la página
             800: se busca. Ver KL-1202.

Caching      Ninguno. Son datos personales que cambian y que no deben
             quedar en cachés compartidas.

N+1          El detalle usa un embed. El listado no muestra
             direcciones a propósito.

Rendering    Todo Server Component salvo los formularios.
```

---

## 20. Migraciones

```text
20260827120000_create_customer_documents.sql
  enum customer_doc_type
  función is_valid_ruc(text) IMMUTABLE

20260827120100_create_customers.sql
  tabla customers, constraints, índices, updated_at, RLS

20260827120200_create_customer_addresses.sql
  tabla customer_addresses, trigger de tenant_id, RLS
```

Ninguna migración de permisos: los dos que hacen falta existen desde la Fase 03.

---

## 21. Rollback

Las tres migraciones son aditivas: crean objetos nuevos y no tocan ninguna tabla
existente. Revertir es soltarlas en orden inverso.

```sql
drop table if exists public.customer_addresses;
drop table if exists public.customers;
drop function if exists public.sync_customer_address_tenant();
drop function if exists public.is_valid_ruc(text);
drop type if exists public.customer_doc_type;
```

Ninguna fase anterior lee de estas tablas, así que revertir no rompe nada
existente. **A partir de la Fase 13 deja de ser cierto**: `orders.customer_id`
apuntará aquí y soltar `customers` se llevaría por delante los pedidos. El
momento barato de revertir esta fase es antes de que empiece la 13.

---

## 22. Definition of Done

- [ ] Enum `customer_doc_type` creado
- [ ] `is_valid_ruc` creada, inmutable y usada por el CHECK
- [ ] Tabla `customers` con sus constraints e índices
- [ ] Tabla `customer_addresses` con su trigger de `tenant_id`
- [ ] Unicidad de documento por tenant, nunca global (§11)
- [ ] RLS en ambas tablas
- [ ] **Cero políticas para `anon`**, afirmado por un test
- [ ] Sin política de DELETE sobre `customers`
- [ ] Módulo de documentos peruanos con tests
- [ ] Server Actions con `requirePermission` explícito
- [ ] Listado con búsqueda y paginación (§18)
- [ ] Detalle con direcciones
- [ ] Entrada de navegación con permiso
- [ ] Tipos actualizados y contrato de schema verde
- [ ] Ningún log con datos personales
- [ ] Unit tests PASS
- [ ] Database / RLS tests PASS
- [ ] Cross-tenant tests PASS
- [ ] Typecheck PASS
- [ ] Lint PASS
- [ ] Build PASS
- [ ] SPEC actualizado con lo realmente implementado

---

## 23. Implementation notes

### Lo que no hizo falta construir

El catálogo de permisos de la Fase 03 ya traía `customers.view` y
`customers.manage`, con sus grants repartidos a siete roles. Esta fase no añadió
ni un permiso: los consumió. Vale decirlo porque la expectativa al empezar era
escribir una migración de permisos como la Fase 09 y la Fase 10, y no hacerlo es
la señal de que la Fase 03 hizo bien su trabajo.

### El dígito verificador, dos veces

`public.is_valid_ruc(text)` en SQL y `isValidRuc` en TypeScript son el mismo
algoritmo escrito dos veces. No es duplicación por descuido: corren en momentos
distintos y con propósitos distintos. El de SQL es la garantía — lo atraviesan
todos los escritores, incluidos los que aún no existen. El de TypeScript existe
para que alguien lea "Ese RUC no existe: revisa el ultimo digito" en vez de
`customers_document_format`.

Los dos se prueban contra los mismos RUCs reales (20131312955 de la SUNAT,
20100047218 del BCP), así que una divergencia entre ambos rompe la suite. Un
algoritmo de dígito verificador probado solo con números que el propio test
genera demuestra que la función está de acuerdo consigo misma; dos RUCs que
cualquiera puede verificar demuestran que está de acuerdo con la SUNAT.

### La búsqueda escapa lo que recibe

`escapeLikePattern` no es una precaución teórica. Sin ella, escribir `%` en el
buscador lista el padrón entero de clientes del negocio, que es exactamente la
consulta que esta fase existe para hacer difícil. `_` es más silencioso: hace
que la búsqueda ignore un carácter sin decírselo a nadie.

Y el término se normaliza por columna igual que se normalizó al entrar: buscar
"45.678.912" tiene que encontrar la fila guardada como "45678912", o el
normalizado del alta convierte el buscador en inútil.

### Los filtros viven en la URL

`?q=`, `?inactivos=1`, `?page=`, leídos por un Server Component con un
formulario `method="get"`. Una búsqueda que se puede compartir, que sobrevive a
recargar y que funciona sin JavaScript. `customerFiltersSchema` tolera cualquier
cosa porque una URL se escribe a mano: `page=abc` es la página 1, no un error.

### La ausencia de política se afirma, no se supone

TEST-1210 lee `pg_policies` y falla si alguna política de las dos tablas nombra
a `anon`. La alternativa — consultar la tabla como anónimo y esperar cero filas
— demuestra la situación de hoy; leer el catálogo demuestra la regla.

Importa porque este defecto no falla ruidosamente. Las Fases 10 y 11 terminan
sus migraciones con una `..._select_public`, y con razón; copiar esa forma aquí
por analogía publicaría la agenda de clientes de cada negocio y la web pública
se vería exactamente igual.

### El contrato de tipos, y por qué no bastaba añadirlo a la lista

`src/types/database.ts` se mantiene a mano (ADR-007: generarlo necesita Docker),
y esta fase le escribió 76 líneas a mano. El fichero que impide que eso derive
es `schema-contract.test.ts`, con dos mitades que se encuentran en el medio:

```text
schema real       <-> EXPECTED_COLUMNS   en tiempo de ejecución, contra PostgreSQL
EXPECTED_COLUMNS  <-> Database           en compilación, por tsc
```

El primer intento de esta fase añadió `customers` y `customer_addresses` a
`catalogueTables`, que es la lista de tablas **exentas** de la comprobación
columna a columna — con lo que el test pasaba en verde sin verificar nada de lo
que esta fase había escrito a mano. Las Fases 03 a 11 tienen sus tablas ahí, así
que el error era seguir el precedente sin mirar qué hacía la lista.

Corregido: las dos tablas están en `EXPECTED_COLUMNS` con sus dos mitades. Se
comprobó que el mecanismo falla de verdad, no que pasa:

```text
columna `notes` añadida a la migración   -> el test de runtime falla
columna renombrada en Database           -> tsc falla en _CustomerKeys
```

`_CustomerHasNoSurplusPersonalData` va más allá y afirma que `notes`,
`birth_date`, `gender` y `address` NO existen en la fila. Es ADR-016 convertido
en algo que falla solo: la decisión de minimizar datos personales es de las que
se erosionan una columna a la vez, y el sitio donde se erosionaría es
exactamente este tipo.

Lo que estas dos mitades **no** cubren: la nulabilidad declarada en `Database`
no está atada a la de `EXPECTED_COLUMNS`. Cambiar `phone: string | null` a
`phone: string` en los tipos no rompe el contrato; en esta fase lo detectó `tsc`
porque una acción consumía el campo, que es suerte, no diseño. Es una limitación
del test desde la Fase 00 y afecta a todas las tablas por igual (KL-1211).

### Qué se verificó y qué no

Lo verificado corriendo: las tres migraciones aplican, el dígito verificador
rechaza en la BASE (no solo en Zod), un tenant no ve clientes de otro, `kitchen`
no ve ninguno, `waiter` lee y no escribe, el trigger ignora el `tenant_id` que
manda el cliente, y no hay política de DELETE sobre `customers`.

Lo NO verificado corriendo: nadie ha usado estas pantallas contra un Supabase
real. La suite corre PostgreSQL en WebAssembly (ADR-007), que no incluye
PostgREST — así que el `or(...)` de la búsqueda y el embed del detalle están
probados como consultas, no contra el serializador real. Es la misma limitación
de las Fases 07 a 11 y la misma que se cierra con `supabase start`.

---

## 24. Known limitations

```text
KL-1201  La búsqueda usa ILIKE con comodín a ambos lados, que no puede
         usar un índice B-tree. Con veinte mil clientes es un scan.
         Cuando duela, la respuesta es pg_trgm o tsvector, no un
         índice más sobre las mismas columnas.

KL-1202  La paginación es por offset. La página 800 es lenta; nadie
         navega hasta la 800 porque busca. Si algún día un reporte
         recorre el padrón entero, será por keyset.

KL-1203  Las direcciones de un cliente no se paginan. Un cliente con
         cincuenta direcciones las trae todas. No es realista hoy y
         sería un cambio local si lo fuera.

KL-1204  No se puede borrar un cliente, ni siquiera uno creado por
         error hace un minuto, porque la Fase 13 apuntará pedidos
         aquí. Un cliente sin pedidos podría borrarse sin riesgo, pero
         "sin pedidos" no es una condición que esta fase pueda
         evaluar: la tabla orders no existe. Owner: Fase 13, que es la
         primera que puede preguntarlo.

KL-1205  No hay anonimización a petición del titular. Necesita que
         existan pedidos para saber qué se conserva al anonimizar.

KL-1206  El documento se guarda en texto plano. Ver ADR-016,
         alternativas consideradas.

KL-1207  No hay importación masiva de clientes. §33 no la pide, y
         multiplicaría el riesgo de esta fase por el tamaño del
         archivo.

KL-1208  Sin tipo `pasaporte`, que un hotel o un restaurante turístico
         pedirán. No está en §33 y §51 prohíbe adelantarlo. Añadirlo
         es `alter type ... add value`.

KL-1209  El listado no muestra cuántos pedidos lleva cada cliente,
         porque no hay pedidos. Es el "historial" de §33, y su owner
         es la Fase 13.

KL-1210  Las direcciones no tienen coordenadas. La Fase 19 las
         necesitará para repartir; son columnas nuevas anulables, no
         un cambio de forma.

KL-1211  El contrato de tipos no ata la NULABILIDAD declarada en
         `Database` con la de `EXPECTED_COLUMNS`: solo compara nombres
         de columna. Un `string | null` que pase a `string` en los
         tipos no rompe el contrato. Viene de la Fase 00 y afecta a
         todas las tablas; arreglarlo es derivar un tipo de
         `EXPECTED_COLUMNS` en vez de escribir la lista de claves.
```

---

## 25. Future considerations

```text
- La Fase 13 añadirá orders.customer_id y copiará la dirección de
  entrega al pedido, en vez de referenciarla: una dirección que se
  edita no debe cambiar a dónde se entregó algo el mes pasado.
- La Fase 17 consultará a SUNAT si un RUC existe de verdad. Esta fase
  solo garantiza que está bien formado.
- La Fase 19 necesitará coordenadas y zona de reparto en
  customer_addresses. Son columnas nuevas anulables, no un cambio de
  forma.
- La Fase 20 colgará puntos y fidelización del cliente, con la fecha
  de nacimiento que esta fase deliberadamente no guarda.
- Anonimizar un cliente a petición suya, conservando sus pedidos,
  necesita que existan pedidos. Fase 13 o posterior.
```
