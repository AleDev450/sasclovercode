# SPEC — Phase 17 — Electronic Billing / SUNAT

## 1. Información general

```text
Phase:                17
Nombre:               Electronic Billing / SUNAT
Estado:               COMPLETED
Versión:              1.0.0
Fecha creación:       2026-08-27
Última actualización: 2026-08-27
Responsable:          alejandro.avendano@masuno.pe
```

Documento maestro: §33 (Fase 17), §37 (idempotencia), §51 (prohibiciones).
Fases previas: 00 a 16 — todas COMPLETED y auditadas.
ADR: [021 — Abstracción de proveedor de facturación y credenciales en Vault](../adr/021-billing-provider-abstraction-and-vault-credentials.md).

---

## 2. Objetivo

### ¿Por qué existe esta fase?

Master §33, Fase 17, textual y completo:

> NO implementar antes de que Orders + Payments estén estables.
> Crear capa abstracta: BillingProvider. No acoplar dominio directamente
> a un proveedor.
> Preparar: billing_documents, billing_document_items, billing_events,
> billing_provider_configs.
> Tipos: boleta, factura, nota_credito, nota_debito.
> Implementar idempotencia. Nunca emitir dos documentos por retry
> accidental.
> Guardar estado: pending, sent, accepted, rejected, cancelled.
> Credenciales deben almacenarse de manera segura. No exponerlas al
> frontend.
> Consultar documentación SUNAT vigente antes de implementar.

Orders (13) y Payments (14) llevan verificadas contra Postgres real desde
esta misma sesión — la precondición del primer párrafo está cumplida. Esta
fase es la primera que declara ante SUNAT lo que un pedido ya cobró: hasta
aquí, un pedido y sus pagos eran hechos internos del negocio; esta fase es
la que los convierte en un documento tributario.

### ¿Qué debe ser posible al terminarla?

```text
Emitir una boleta o una factura para un pedido, con su serie y su
  correlativo asignados por el sistema, nunca por quien la pide.
Que un reintento accidental (doble clic, doble submit) jamas produzca
  dos documentos vigentes para el mismo pedido y tipo.
Corregir un documento ya emitido con una nota de credito o de debito,
  sin tocar el documento original.
Guardar la credencial de un proveedor de facturacion sin que ninguna
  pantalla, ninguna consulta y ningun log la vuelva a mostrar jamas.
Seguir el ciclo pendiente -> enviado -> aceptado/rechazado -> anulado
  exactamente como lo declara master, sin saltos.
```

---

## 3. Alcance

### Incluido

```text
BillingProvider: interfaz + ManualBillingProvider (unica implementacion
  que envia esta fase).
billing_documents, billing_document_transitions, billing_document_items,
  billing_events, billing_provider_configs.
Permiso nuevo: billing.manage (billing.view/create/cancel ya existian
  desde la Fase 03, sin usar hasta ahora).
Snapshot de emisor (RUC de tenant_settings), cliente y lineas al
  momento de emitir - nunca releido despues.
Split de IGV 18% (16% IGV + 2% IPM), calculado por resta para que
  subtotal + impuesto sume exacto al total, siempre.
Idempotencia via indice unico parcial: un documento vigente por
  (tenant, pedido, tipo).
Credenciales en Supabase Vault, referenciadas por id. Tres funciones
  SECURITY DEFINER: escribir, comprobar existencia, borrar. Ninguna
  para leer el valor.
Tarjeta "Comprobante" en el detalle de pedido, listado
  /dashboard/{slug}/facturacion, pantalla de configuracion
  /dashboard/{slug}/configuracion/facturacion.
```

### Fuera de alcance

```text
Integracion real con un PSE o con la API de SUNAT (SEE-SOL, un OSE, un
  PSE de pago) - no hay credenciales ni acceso de prueba en este
  entorno, y master §51 prohibe implementar SUNAT basandose solo en
  memoria. Ver ADR-021 seccion 1.
Facturacion parcial (una fraccion de un pedido) - un documento factura
  siempre el pedido entero. Nadie lo pidio; es alcance real no
  solicitado.
Un IGV configurable por tenant o por producto - el 18% es una
  constante nombrada, no una configuracion. ADR-021, seccion IGV.
Un test automatizado de PGlite para las funciones de Vault -
  `supabase_vault` no existe en el arnes (ADR-007); solo verificacion
  contra Supabase real.
```

### La decisión de alcance que más costó

Que `billing_document_transitions` sea una tabla completa, como
`order_transitions` (Fase 13), y no el par nullable que `payments` usa
(ADR-018) para anular.

`payments` tiene exactamente un borde: pagado -> anulado. Un documento de
facturación tiene cinco: `pending→sent`, `pending→cancelled`,
`sent→accepted`, `sent→rejected`, `accepted→cancelled`. La regla que este
proyecto ya seguía (ADR-018): una tabla cuando hay más de un borde real y
se necesita leerlo como dato; un par nullable cuando hay exactamente uno.
Cinco bordes es exactamente el caso que le dio a `orders` su propia tabla
en la Fase 13, así que esta fase repite esa forma en vez de inventar una
tercera.

---

## 4. Dependencias

```text
Phase 03 — Authorization + RLS  billing.view/create/cancel preexistian
                                 sin usar; billing.manage es nuevo
Phase 06 — Tenant Settings      tenant_settings.tax_id, ya comentado
                                 desde esa fase como "la Fase 17 emite
                                 documentos con este campo"
Phase 12 — Customers            customers.doc_type/doc_number,
                                 is_valid_ruc() - la elegibilidad para
                                 factura ya existia, sin usar
Phase 13 — Orders Core          orders, order_items - lo que se
                                 factura; ADR-017 dejo tax_cents en
                                 cero explicitamente para esta fase
Phase 14 — Payments + Cash      precedente de Vault? no - primer uso;
                                 precedente de indice unico parcial
                                 para idempotencia (Fase 13/14)
ADR-011 — RLS-only              nunca service_role en codigo de
                                 aplicacion; esta fase usa funciones
                                 SECURITY DEFINER estrechas, no un
                                 bypass
ADR-013 — Declinar integraciones no verificables  precedente directo:
                                 igual que esa fase declino construir
                                 contra una API sin sandbox, esta fase
                                 declina construir contra un PSE sin
                                 credenciales
ADR-017 — Order snapshot/FSM    el patron de snapshot y de tabla de
                                 transiciones que esta fase repite
ADR-018 — Payment void          el criterio (cuantos bordes reales
                                 tiene el ciclo) que decidio NO usar
                                 esa forma aqui
ADR-021 — Esta fase             BillingProvider, transiciones, IGV,
                                 idempotencia, credenciales en Vault
```

**Un permiso nuevo.** `billing.view`/`create`/`cancel` ya existían
(catálogo de la Fase 03) y ya gobernaban documentos correctamente, sin que
nada los usara todavía. `billing.manage` es distinto: configurar el
proveedor y sus credenciales es una acción más sensible que nada de lo
anterior cubre — la misma razón que le dio a `locations`/`domains`/
`payment_methods` su propio `.manage`. Otorgado a `owner` (ya lo tenía por
el seed general de la Fase 03) y a `admin` explícitamente.

---

## 5. Casos de uso

```text
UC-1701
Actor           Cajero con billing.create
Precondiciones  Un pedido con al menos una linea, negocio con RUC
                configurado
Accion          Emite una boleta desde el detalle del pedido
Resultado       billing_documents nace en pending, con serie/numero
                asignados y las lineas copiadas de order_items

UC-1702
Actor           El mismo cajero
Precondiciones  Doble clic accidental en "Emitir"
Accion          Dos inserts casi simultaneos para el mismo pedido y
                tipo
Resultado       El segundo choca contra
                billing_documents_one_live_per_order_type; solo existe
                un documento vigente

UC-1703
Actor           Cajero
Precondiciones  Una boleta en estado sent
Accion          Marca "Rechazado" con un motivo
Resultado       status=rejected, terminal; el pedido se corrige con un
                documento NUEVO, no reabriendo el rechazado

UC-1704
Actor           Owner/admin con billing.manage
Precondiciones  Ninguna
Accion          Pega una credencial en el formulario y guarda
Resultado       set_billing_credentials() la escribe en Vault; ninguna
                consulta, columna ni pantalla la vuelve a mostrar
                despues - solo has_billing_credentials() reporta que
                existe

UC-1705
Actor           Cliente empresa con RUC
Precondiciones  Pedido con ese cliente asociado
Accion          Se emite una factura
Resultado       billing_documents_factura_needs_ruc_customer exige
                doc_type='ruc'; sin ese cliente, la insercion se
                rechaza

UC-1706 (verificado contra Supabase real, no PGlite)
Actor           Owner
Precondiciones  Ninguna credencial configurada todavia
Accion          Llama set_billing_credentials(), luego
                clear_billing_credentials()
Resultado       vault.create_secret()/DELETE FROM vault.secrets
                funcionan contra el Vault real; has_billing_credentials
                reporta true y luego false; ninguna columna
                seleccionable contiene el texto plano en ningun punto
```

---

## 6. Requerimientos funcionales

```text
FR-1701  Los tipos de documento son exactamente boleta, factura,
         nota_credito, nota_debito (§33).

FR-1702  Los estados son exactamente pending, sent, accepted, rejected,
         cancelled (§33), con las cinco transiciones de ADR-021.

FR-1703  La serie y el numero de un documento los asigna el trigger,
         nunca un cliente. El numero es un correlativo por
         (tenant, tipo, serie), empezando en 1.

FR-1704  Sin configuracion previa, un tenant puede emitir su primer
         documento: las series por defecto (B001/F001/BC01/BD01) no
         dependen de que nadie haya visitado la pantalla de
         configuracion.

FR-1705  Toda factura exige un cliente con doc_type='ruc'. Cualquier
         otro tipo puede o no llevar cliente.

FR-1706  Toda nota_credito/nota_debito exige un related_document_id de
         la MISMA empresa.

FR-1707  El emisor (RUC), el cliente y cada linea se copian al crear
         el documento y nunca se vuelven a leer de tenant_settings,
         customers u order_items despues.

FR-1708  El IGV se calcula por resta: subtotal = round(total / 1.18),
         impuesto = total - subtotal. subtotal + impuesto = total
         siempre, sin excepcion, para cualquier monto.

FR-1709  Como maximo un documento VIGENTE (pending/sent/accepted) por
         pedido y tipo. Un documento rechazado o anulado no bloquea un
         reintento.

FR-1710  Una credencial de proveedor se escribe, se rota o se borra
         solo a traves de tres funciones. Ninguna funcion, columna ni
         vista devuelve el valor en texto plano.

FR-1711  billing_events registra cada cambio de estado automaticamente,
         igual que order_status_history (Fase 13) - nunca depende de
         que quien escriba se acuerde de loguearlo.
```

---

## 7. Requerimientos no funcionales

```text
NFR-1701 Seguridad
  Toda escritura de credencial pasa por una funcion SECURITY DEFINER
  que primero comprueba billing.manage por su cuenta (no confía solo
  en RLS de la tabla que la invoca). Ninguna columna de
  billing_provider_configs expone el secreto; solo
  credentials_secret_id (un uuid que no es la credencial). Verificado
  contra Vault real (UC-1706): ninguna fila seleccionable, en ninguna
  tabla, contiene el texto plano despues de guardarlo.

NFR-1702 Integridad
  billing_documents_one_live_per_order_type (indice unico parcial) es
  la unica fuente de verdad de idempotencia - no una comprobacion en
  la Server Action que un segundo request concurrente podria esquivar.
  guard_billing_document_status_change() es la unica fuente de verdad
  de que transiciones existen.

NFR-1703 Performance
  billing_documents_tenant_status_idx y
  billing_documents_tenant_order_idx sirven el listado
  /facturacion y la tarjeta del detalle de pedido respectivamente.

NFR-1704 Consistencia contable
  subtotal_cents + tax_cents = total_cents es una CHECK, no una
  esperanza: billing_document_items_split_adds_up la hace imposible
  de violar por construccion (Fase 17), replicando el mismo principio
  que order_items_discount_within_gross (Fase 13).

NFR-1705 Observabilidad
  billing_events es un log de dominio ademas de un rastro de
  auditoria: cada fila nombra from_status/to_status y quien la causo.

NFR-1706 Mantenibilidad
  src/modules/billing/lifecycle.ts es un espejo de
  billing_document_transitions, pinneado por un test fila por fila
  (el mismo patron de TEST-1301 para orders). Un boton para una
  transicion que la base de datos rechaza es el fallo que ese test
  evita.
```

---

## 8. Modelo de datos

### Enums nuevos

```text
billing_document_type   = ('boleta','factura','nota_credito','nota_debito')
billing_document_status = ('pending','sent','accepted','rejected','cancelled')
```

### billing_documents

```text
id                            uuid PK
tenant_id                     uuid NOT NULL   (derivado del pedido, nunca del cliente)
order_id                      uuid NOT NULL FK -> orders (RESTRICT)
customer_id                   uuid FK -> customers (RESTRICT), nullable

type                           billing_document_type NOT NULL
status                         billing_document_status NOT NULL DEFAULT 'pending'

series                         text NOT NULL      (asignado por trigger)
number                         integer NOT NULL   (correlativo por tenant+tipo+serie)
idempotency_key                uuid NOT NULL DEFAULT gen_random_uuid()

issuer_ruc_snapshot            text NOT NULL          (de tenant_settings.tax_id)
customer_name_snapshot         text
customer_doc_type_snapshot     customer_doc_type
customer_doc_number_snapshot   text

subtotal_cents / tax_cents / total_cents   bigint NOT NULL DEFAULT 0
  (calculados por populate_billing_document_items(), nunca enviados)

related_document_id            uuid FK -> billing_documents (RESTRICT)
rejection_reason / cancel_reason   text
sent_at / accepted_at / rejected_at / cancelled_at   timestamptz

created_by                     uuid FK -> auth.users (SET NULL)
created_at / updated_at        timestamptz NOT NULL
```

Restricciones clave: `billing_documents_one_live_per_order_type` (índice
único parcial, la idempotencia); `billing_documents_series_number_key`
(único por tenant+tipo+serie+numero); `billing_documents_factura_needs_
ruc_customer`; `billing_documents_notes_need_related_document`;
`billing_documents_sent_fields`/`_accepted_fields`/`_rejected_fields`/
`_cancelled_fields` (cada timestamp existe cuando su estado fue alcanzado
— ver sección 23 sobre por qué estas cuatro CHECK no son todas "iff").

### billing_document_transitions

```text
from_status  billing_document_status
to_status    billing_document_status
PK (from_status, to_status)
```

Cinco filas exactas: `pending→sent`, `pending→cancelled`, `sent→accepted`,
`sent→rejected`, `accepted→cancelled`.

### billing_document_items

```text
id                    uuid PK
billing_document_id   uuid NOT NULL FK -> billing_documents (CASCADE)
tenant_id             uuid NOT NULL
order_item_id         uuid FK -> order_items (SET NULL)   -- puntero, no dependencia

description_snapshot  text NOT NULL
quantity               numeric(10,3) NOT NULL
unit_price_cents / discount_cents / total_cents   bigint NOT NULL
subtotal_cents / tax_cents                        bigint NOT NULL
  (subtotal_cents + tax_cents = total_cents, CHECK)

position               smallint NOT NULL DEFAULT 0
created_at             timestamptz NOT NULL
```

Sin `updated_at`, sin política de UPDATE/DELETE: se puebla una sola vez,
por `populate_billing_document_items()` (trigger AFTER INSERT en
`billing_documents`).

### billing_events

```text
id / billing_document_id / tenant_id
from_status   billing_document_status   (NULL en la primera fila)
to_status     billing_document_status NOT NULL
message       text                       (motivo de rechazo/anulacion)
created_by    uuid
created_at    timestamptz NOT NULL
```

Espejo exacto de `order_status_history` (Fase 13). Sin política de UPDATE
ni DELETE, nunca.

### billing_provider_configs

```text
tenant_id                 uuid PK   (singleton, como tenant_settings)
provider_name              text NOT NULL DEFAULT 'manual'
is_active                  boolean NOT NULL DEFAULT true
series_boleta / series_factura / series_nota_credito / series_nota_debito
  text (NULL = usar el valor por defecto)
credentials_secret_id      uuid    (id de un secreto en Vault, nunca el valor)
credentials_updated_at     timestamptz
created_at / updated_at    timestamptz NOT NULL
```

Provisionado automáticamente para cada tenant, nuevo o existente, por
`create_tenant_defaults()` (extendida por tercera vez desde la Fase 06).

---

## 9. Diagrama de relaciones

```text
tenant_settings.tax_id ──(snapshot al insertar)──► billing_documents.issuer_ruc_snapshot
customers ──(snapshot al insertar)──► billing_documents.customer_*_snapshot
orders/order_items ──(copiado al insertar)──► billing_document_items
                                                     │
billing_provider_configs.series_* ──(coalesce)──► billing_documents.series
                                                     │
billing_documents ──1:N──► billing_document_items
billing_documents ──1:N──► billing_events
billing_documents ──0:1──► billing_documents  (related_document_id, notas)

vault.secrets ◄──(id opaco)── billing_provider_configs.credentials_secret_id
  (create_secret / update_secret / DELETE ... - nunca un SELECT del valor)
```

---

## 10. Tenant Isolation

```text
Tenant Isolation Impact: TOTAL
```

**¿Cómo se determina el tenant?** `assign_billing_document()` lo deriva del
`order_id` recibido (`orders.tenant_id`), exactamente como
`snapshot_order_item()` (Fase 13) deriva el suyo del pedido — nunca
aceptado directamente de un cliente.

**¿Qué verifica cruce entre negocios?** Un `customer_id` o un
`related_document_id` que pertenezca a otro tenant es rechazado
explícitamente dentro del mismo trigger (`'... belongs to a different
business'`), antes de que la fila llegue a existir.

**¿Existe algún recurso global?** `billing_document_transitions` — el
ciclo de vida del PRODUCTO, no de ningún tenant, la misma naturaleza que
`order_transitions` (Fase 13, ADR-017 §4): legible por cualquier
`authenticated`, escribible por nadie.

---

## 11. Seguridad

```text
Authorization requirements
  billing.view     ver documentos y su listado
  billing.create   emitir, marcar enviado, aceptar, rechazar
  billing.cancel   anular un documento
  billing.manage   configurar proveedor, series y credenciales

Roles involucrados (catalogo de la Fase 03, sin cambios salvo billing.manage)
  owner       las cuatro, por el seed general de rol
  admin       billing.manage (nuevo), heredaba las otras tres
  cashier     billing.view + billing.create
  accountant  billing.view + billing.create + billing.cancel
  manager     billing.view

RLS policies
  billing_documents_select_member       billing.view
  billing_documents_insert_creator      billing.create
  billing_documents_update_operator     billing.create OR billing.cancel
                                         (una sola politica UPDATE; el
                                         mismo razonamiento de
                                         orders_update_operator, Fase 13:
                                         USING no puede distinguir que
                                         columnas cambiaron)
  billing_document_items_select_member  billing.view; sin INSERT/UPDATE/
                                         DELETE para un caller directo
  billing_events_select_member          billing.view
  billing_events_insert_operator        billing.create OR billing.cancel
  billing_provider_configs_select/update_manager   billing.manage
  billing_document_transitions_select_authenticated  using (true)
                                         (dato de producto, como
                                         order_transitions)

Potential abuse cases
  AB-1701  Enviar `series`/`number`/`subtotal_cents` propios al emitir
           un documento.
           Mitigado: ninguno de los tres se acepta en el schema Zod ni
           existe columna que el cliente pueda fijar directamente -
           assign_billing_document()/populate_billing_document_items()
           los calculan siempre.
  AB-1702  Doble clic para intentar cobrar (facturar) dos veces el
           mismo pedido.
           Mitigado: billing_documents_one_live_per_order_type
           (UC-1702).
  AB-1703  Un cajero con billing.create intentando anular un documento
           directamente por SQL/PostgREST (no solo por la UI).
           Parcialmente mitigado: la politica UPDATE lo permite a
           nivel de fila (mismo diseño que orders_update_operator);
           quien lo bloquea de verdad es el permiso que cada Server
           Action exige (BILLING_CANCEL para cancelBillingDocumentAction).
           Documentado explicitamente, no un descuido - ver seccion 23.
  AB-1704  Leer el secreto de un proveedor via alguna vista o funcion.
           Mitigado: no existe ninguna. has_billing_credentials() solo
           devuelve boolean.
```

---

## 12. API / Server Actions

```text
src/modules/billing/server/actions.ts
  issueBillingDocumentAction        billing.create
  markBillingDocumentSentAction     billing.create (llama al
                                     BillingProvider.issue() antes de
                                     escribir el estado)
  acceptBillingDocumentAction       billing.create
  rejectBillingDocumentAction       billing.create
  cancelBillingDocumentAction       billing.cancel
  saveBillingProviderConfigAction   billing.manage
  setBillingActiveAction            billing.manage
  setBillingCredentialsAction       billing.manage (rpc set_billing_credentials)
  clearBillingCredentialsAction     billing.manage (rpc clear_billing_credentials)

src/modules/billing/server/queries.ts
  listBillingDocuments(tenantId, { status?, type?, page })
  listBillingDocumentsForOrder(tenantId, orderId)
  getBillingDocumentDetail(tenantId, documentId)
  getBillingProviderConfig(tenantId)   -- metadata + hasCredentials,
                                          nunca la credencial
```

---

## 13. UI / UX

```text
Detalle de pedido (/pedidos/{orderId})
  Tarjeta "Comprobante": lista de documentos del pedido con su badge de
  estado y sus acciones (marcar enviado / aceptar / rechazar / anular,
  segun el estado y el permiso); formulario para emitir uno nuevo con
  selector de tipo, buscador de cliente (boleta/factura) o selector de
  documento a corregir (notas).

/dashboard/{slug}/facturacion
  Listado de todos los documentos del tenant, filtrable por estado y
  tipo, con enlace de vuelta a cada pedido.

/dashboard/{slug}/configuracion/facturacion
  Gated por billing.manage. Activar/desactivar, series por tipo
  (placeholder con el valor por defecto), y un formulario de
  credenciales que NUNCA se precarga (no hay valor que precargar).
```

Reutilizado sin cambios: `CustomerPicker`/`searchCustomersForPos`
(Fase 15) para elegir cliente al emitir.

---

## 14. Flujos principales

```text
Cajero abre el detalle de un pedido cobrado
   ↓
Elige "Boleta", sin cliente (venta al paso)
   ↓
issueBillingDocumentAction -> INSERT billing_documents
   ↓
assign_billing_document() (BEFORE INSERT): deriva tenant, valida
  pedido no anulado, snapshotea RUC emisor, asigna serie+numero
   ↓
populate_billing_document_items() (AFTER INSERT): copia cada
  order_items, calcula IGV por linea, totaliza el documento
   ↓
Documento en pending
   ↓
Cajero marca "Marcar enviado"
   ↓
markBillingDocumentSentAction -> BillingProvider.issue() (manual:
  solo un mensaje instructivo) -> UPDATE status='sent'
   ↓
guard_billing_document_status_change() valida la transicion contra
  billing_document_transitions, escribe sent_at
   ↓
record_billing_event() (Fase 17, espejo de Fase 13) agrega la fila a
  billing_events
   ↓
Cajero presenta el documento el mismo dia por SEE-SOL/su PSE, y
  marca "Aceptado" cuando SUNAT responde
```

---

## 15. Manejo de errores

```text
Pedido anulado                          -> 23514 'cancelled order
                                            cannot be billed'
Pedido sin lineas                       -> P0001 'no lines cannot be
                                            billed'
Sin RUC configurado en tenant_settings  -> 23514 'no RUC configured'
Cliente/documento relacionado de otro
  negocio                               -> 23514 'different business'
Factura sin cliente con RUC             -> 23514
                                            billing_documents_factura_
                                            needs_ruc_customer
Nota sin documento relacionado          -> 23514
                                            billing_documents_notes_
                                            need_related_document
Transicion no declarada                 -> P0001 'cannot go from % to %'
Rechazar/anular sin motivo              -> 23514 'requires a reason'
Segundo documento vigente del mismo
  tipo para el mismo pedido             -> 23505
                                            billing_documents_one_live_
                                            per_order_type
```

Cada mensaje de trigger se traduce en `describeDatabaseError()`
(`billing/server/actions.ts`) al equivalente que un cajero entiende, el
mismo patrón que `orders`/`payments` ya seguían.

---

## 16. Observabilidad

`billing_events` es el registro de dominio: cada fila nombra
`from_status`/`to_status`, cuándo y quién. `logger.info`/`logger.error` en
cada Server Action, mismo formato que el resto del proyecto
(`billing_document.created`, `.sent`, `.accepted`, `.rejected`,
`.cancelled`, `billing_provider_config.*`).

---

## 17. Testing Plan

### Unit

```text
billing-lifecycle.test.ts   El mapa de TypeScript declara las mismas
                             cinco parejas que billing_document_
                             transitions; nunca salta un paso; rejected
                             y cancelled son terminales.
billing-schemas.test.ts     issueBillingDocumentSchema no lleva ningun
                             campo calculado (series/number/subtotal/
                             tax/total); reject/cancel exigen motivo;
                             billingProviderConfigSchema no lleva
                             `credentials`.
dashboard-navigation.test.ts  Las entradas "billing"/"billing-config"
                             dependen de billing.view/billing.manage,
                             independientes de settings.manage.
```

### Database (`src/tests/database/billing.test.ts`, 33 tests)

```text
- La tabla de transiciones SQL coincide, fila por fila, con
  lifecycle.ts.
- Serie/correlativo por defecto y su incremento por (tenant, tipo,
  serie).
- Snapshot del RUC emisor: un cambio posterior en tenant_settings no
  reescribe un documento ya creado.
- Rechaza sin RUC configurado, con pedido anulado, sin lineas.
- Factura exige cliente con RUC; nota exige documento relacionado de
  la misma empresa.
- Copia cada linea del pedido y totaliza el documento desde ellas.
- EL TEST DE LA FASE: cambiar order_items DESPUES de emitir el
  documento no mueve billing_document_items (el mismo argumento de
  TEST-1307, aplicado a un documento ya declarado).
- IGV: subtotal + impuesto = total, exacto, para una bateria de
  montos; el caso de texto (2490 -> 2110 + 380).
- Idempotencia: un segundo intento vigente choca; un reintento tras
  rechazo o anulacion tiene exito; tipos distintos no colisionan
  entre si.
- La maquina de estados rechaza saltos, exige motivo para
  rechazar/anular, y trata rejected/cancelled como terminales.
- billing_events registra la creacion y cada cambio de estado.
- RLS: nada para anon, ninguna politica DELETE en ninguna de las
  cinco tablas, ninguna UPDATE en events/items/transitions; un
  cashier puede emitir, un manager (solo view) no puede ni emitir ni
  actualizar; un accountant puede emitir Y anular; el estado se lee
  por cualquiera y no lo escribe nadie; billing_provider_configs solo
  para quien tiene billing.manage.
```

### Verificado a mano contra Supabase real (PGlite no puede ejercitar Vault, ADR-007)

```text
- Las cinco migraciones se aplican limpias contra Postgres 17 real.
- Emitir una boleta via PostgREST asigna serie B001/numero 1, snapshotea
  el RUC del emisor, y - en una consulta POSTERIOR al insert, no en el
  mismo RETURNING - calcula el split de IGV exacto (2490 -> 2110 + 380).
- set_billing_credentials()/has_billing_credentials()/
  clear_billing_credentials() funcionan de punta a punta contra un
  Vault real: escribe, reporta presencia, rota, borra, y ninguna
  columna seleccionable via PostgREST contiene jamas el texto plano.
- El ciclo pending -> sent -> accepted vía PostgREST deja en
  billing_events exactamente las tres filas esperadas.
- Se encontraron y corrigieron DOS defectos que PGlite no podia
  exponer - ver seccion 23.
```

---

## 18. Edge Cases

```text
Pedido sin cliente asociado          Puede facturarse con boleta; con
                                      factura, rechazado sin excepcion.
Cliente con RUC invalido             No llega a existir (is_valid_ruc(),
                                      Fase 12) - imposible como insumo
                                      de esta fase.
Documento rechazado                  Terminal. La correccion es un
                                      documento nuevo, nunca reabrirlo.
Documento aceptado que hay que
  anular                             accepted -> cancelled es la unica
                                      transicion que salta directamente
                                      un paso "hacia atras" - declarada
                                      explicitamente, no un accidente.
Monto de un centavo (total_cents=1)  igv_subtotal_from_total(1) redondea
                                      a 1, tax=0 - la suma sigue siendo
                                      exacta.
Tenant sin RUC configurado           No puede emitir nada hasta
                                      configurar tenant_settings.tax_id
                                      (Fase 06) - mensaje explicito, no
                                      un error generico.
Rotar una credencial ya existente    set_billing_credentials() detecta
                                      el secreto previo y lo actualiza
                                      (vault.update_secret), no crea uno
                                      huerfano.
Borrar una credencial inexistente    clear_billing_credentials() es un
                                      no-op seguro: nada que borrar,
                                      nada que fallar.
```

---

## 19. Performance considerations

```text
Queries    listBillingDocuments pagina con count exacto, igual que
           listOrders (Fase 13). getBillingDocumentDetail trae items y
           eventos en un solo round trip via embeds de PostgREST.

Indexes    billing_documents_tenant_status_idx y
           billing_documents_tenant_order_idx sirven el listado y la
           tarjeta de pedido respectivamente.

Vault      Cada llamada a set_billing_credentials/has_billing_
           credentials/clear_billing_credentials es una operacion
           puntual por tenant, no un bucle - el volumen esperado (una
           configuracion por negocio, rara vez cambiada) no exige mas.
```

---

## 20. Migraciones

```text
20260827170000_create_billing_permissions.sql
  billing.manage; otorgado a owner y admin.

20260827170100_create_billing_documents.sql
  Enums; billing_documents; billing_document_transitions (las cinco
  filas); guard_billing_document_status_change();
  default_billing_series(); assign_billing_document(); RLS.

20260827170200_create_billing_document_items.sql
  billing_document_items; igv_rate()/igv_subtotal_from_total()/
  igv_tax_from_total(); populate_billing_document_items(); RLS.

20260827170300_create_billing_events.sql
  billing_events; record_billing_event(); RLS.

20260827170400_create_billing_provider_configs.sql
  billing_provider_configs; provisionamiento automatico;
  set_billing_credentials()/has_billing_credentials()/
  clear_billing_credentials(); RLS.
```

---

## 21. Rollback

Aditivas. Revertir es soltarlas en orden inverso:

```sql
drop function if exists public.clear_billing_credentials(uuid);
drop function if exists public.has_billing_credentials(uuid);
drop function if exists public.set_billing_credentials(uuid, text);
drop table if exists public.billing_provider_configs;
drop table if exists public.billing_events;
drop function if exists public.populate_billing_document_items();
drop function if exists public.igv_tax_from_total(bigint);
drop function if exists public.igv_subtotal_from_total(bigint);
drop function if exists public.igv_rate();
drop table if exists public.billing_document_items;
drop function if exists public.assign_billing_document();
drop function if exists public.default_billing_series(public.billing_document_type);
drop function if exists public.guard_billing_document_status_change();
drop table if exists public.billing_document_transitions;
drop table if exists public.billing_documents;
drop type if exists public.billing_document_status;
drop type if exists public.billing_document_type;
delete from public.role_permissions where permission = 'billing.manage';
delete from public.permissions where code = 'billing.manage';
```

Cada secreto que quedó en `vault.secrets` referenciado por un
`credentials_secret_id` ya eliminado queda huérfano tras este rollback —
un `DELETE FROM vault.secrets WHERE ...` explícito, fuera de esta
migración, es responsabilidad de quien decida revertir en producción.

---

## 22. Definition of Done

- [x] `BillingProvider` (interfaz) + `ManualBillingProvider` (única
      implementación que envía esta fase)
- [x] `billing_documents`/`billing_document_items`/`billing_events`/
      `billing_provider_configs`/`billing_document_transitions`
- [x] Cuatro tipos, cinco estados, exactamente los de §33
- [x] Idempotencia por índice único parcial, verificada con doble
      intento (UC-1702) y con reintento tras rechazo/anulación
- [x] Snapshot de emisor/cliente/líneas al crear, nunca releído después
- [x] IGV 18%, split exacto por resta, verificado en PGlite y en vivo
- [x] Credenciales en Vault, tres funciones (`set_`/`has_`/`clear_`),
      cero funciones de lectura del valor — verificado contra un Vault
      real
- [x] `billing.manage`, otorgado a owner/admin
- [x] Tarjeta de pedido, listado, pantalla de configuración
- [x] Dos entradas de navegación (`billing`, `billing-config`),
      independientes de `settings.manage`
- [x] 33 tests de base de datos, 30 tests unitarios, todos en verde
- [x] Verificación en vivo contra Supabase real: emisión, IGV, ciclo de
      estados, y las tres funciones de Vault de punta a punta
- [x] Dos defectos reales encontrados por la verificación en vivo,
      corregidos (sección 23)
- [x] Suite completa (Fases 00-17): 1359 tests en verde
- [x] Typecheck PASS
- [x] Lint PASS
- [x] Build PASS
- [x] SPEC actualizado

---

## 23. Implementation notes

### Dos defectos reales que solo la verificación en vivo pudo exponer

**`vault.delete_secret()` no existe en esta versión de Supabase Vault.**
`clear_billing_credentials()` llamaba `perform vault.delete_secret(v_secret_id)`,
copiando el nombre que la documentación de Vault sugiere. Contra un
Supabase real, `\df vault.*` mostró solo `create_secret` y `update_secret`
— ningún `delete_secret`. PGlite no tiene el esquema `vault` en absoluto
(ADR-007), así que ningún test automatizado podía haberlo revelado: la
función se habría "compilado" igual (PL/pgSQL no valida referencias a
objetos dentro del cuerpo hasta la primera ejecución) y habría fallado en
producción, en el primer intento real de borrar una credencial. Corregido
borrando la fila directamente de `vault.secrets` (una tabla común, con
`DELETE` otorgado al rol que aplica las migraciones) en vez de una función
que no existe.

**Dos `CHECK` que asumían "iff" donde el ciclo de vida permite historia
acumulada.** `billing_documents_sent_fields` exigía `sent_at IS NULL`
exactamente cuando `status='pending'`, y `billing_documents_accepted_
fields` exigía `accepted_at IS NOT NULL` exactamente cuando
`status='accepted'`. Ambas se rompen en cuanto se ejercita una transición
real: `pending -> cancelled` (directa, sin pasar por `sent`) dejaba
`sent_at` en NULL con `status='cancelled'`, lo cual la primera CHECK
rechazaba; `accepted -> cancelled` dejaba `accepted_at` con un valor
mientras `status` ya no era `'accepted'`, lo cual la segunda rechazaba. La
prueba de base de datos (`billing.test.ts`) encontró esto de inmediato al
ejercitar exactamente las transiciones que `billing_document_transitions`
declara — el fallo no fue de infraestructura sino del propio diseño de
las CHECK, escritas asumiendo (incorrectamente) que cada estado es
mutuamente excluyente con su propio timestamp en vez de que los
timestamps son historia acumulada que el trigger nunca limpia. Corregido
debilitando ambas a una sola dirección ("este campo existe cuando su
estado fue alcanzado", no "y en ningún otro momento") — `rejected` y
`cancelled`, al ser terminales de verdad (ninguna fila en
`billing_document_transitions` sale de ellos), sí pueden seguir usando la
forma `iff` completa sin este problema.

Un tercer error, de columna (`ts.ruc` en vez de `ts.tax_id`), se detectó
por inspección antes de ejecutar nada (grep contra los tests de otras
fases) y no llegó a fallar ningún test — se documenta en el ADR, no aquí,
porque nunca llegó a ser un comportamiento observable.

### Por qué `markBillingDocumentSentAction` es un paso separado de emitir

El master describe el ciclo como `pending -> sent -> accepted/rejected`,
no como "nace ya enviado". Se decidió modelar la creación
(`issueBillingDocumentAction`) y el envío
(`markBillingDocumentSentAction`) como dos acciones distintas — la
primera solo registra el documento (y sus líneas) en el sistema; la
segunda es el punto donde `BillingProvider.issue()` se invoca de verdad.
Para el proveedor manual esto es una diferencia casi cosmética (`issue()`
no llama a ninguna API), pero es la forma correcta para cuando exista un
proveedor real: "creado en nuestro sistema" y "efectivamente entregado al
proveedor" son dos hechos distintos, y colapsarlos en una sola acción
habría hecho im posible reintentar un envío que falló sin re-crear el
documento entero (lo cual rompería el correlativo).

### Qué se verificó y qué no

Verificado corriendo, contra un Supabase real levantado en esta misma
sesión (no PGlite): las cinco migraciones se aplican limpias; emitir un
documento vía PostgREST asigna serie/correlativo y calcula el IGV
correctamente (visible en una consulta posterior, no en el mismo
`RETURNING` del insert — ver por qué en el propio script de verificación,
comentado inline); las tres funciones de Vault funcionan de punta a
punta, incluida la rotación de una credencial existente; ningún valor
plano quedó expuesto en ninguna columna consultada; el ciclo
`pending -> sent -> accepted` vía PostgREST deja exactamente las tres
filas esperadas en `billing_events`. `npm run typecheck`, `npm run lint`,
`npm run build` y la suite completa (1359 tests) en verde.

No verificado: nadie ha abierto `/facturacion` ni la tarjeta "Comprobante"
en un navegador — esta sesión no tiene una herramienta de navegador
interactivo. Tampoco se probó una integración real con SUNAT/un PSE, por
diseño (ADR-021): no hay credenciales de prueba en este entorno, y
construir contra una API sin poder verificarla habría sido exactamente lo
que master §51 prohíbe.

---

## 24. Known limitations

```text
KL-1701  ManualBillingProvider es la unica implementacion. Un
         proveedor real (Nubefact, Efact, la API de SUNAT) es una
         fase futura con credenciales reales, no una promesa vacia en
         esta.

KL-1702  Un documento siempre factura el pedido COMPLETO. Facturacion
         parcial (algunas lineas, un split distinto) no fue pedida por
         ningun documento leido en esta sesion.

KL-1703  El IGV es una constante del 18%, no configurable por tenant
         ni por categoria de producto. Una categoria exonerada de IGV
         (si CloverCode alguna vez la necesita) es trabajo futuro
         explicito, no un descuido.

KL-1704  saveBillingProviderConfigAction fija providerName a 'manual'
         desde un input oculto - la UI no ofrece elegir otro proveedor
         porque no existe otro que elegir. Cuando exista uno real, la
         UI necesita un selector real, no solo cambiar el hidden.

KL-1705  El listado /facturacion no tiene busqueda por numero de serie
         ni por cliente, solo filtros de estado y tipo - el mismo
         alcance que /pedidos (Fase 13) tenia al nacer.
```

---

## 25. Future considerations

```text
- Un BillingProvider real (Nubefact, Efact, la API directa de SUNAT)
  implementa la misma interfaz de src/modules/billing/provider.ts sin
  tocar el resto del modulo - es exactamente el punto de extension que
  esta fase existe para dejar preparado.
- Facturacion parcial, si alguna vez se pide, necesitaria una forma de
  elegir que lineas de un pedido entran en cada documento -
  billing_document_items ya soporta un order_item_id nullable
  pensando en eso, pero populate_billing_document_items() tendria que
  dejar de copiar TODAS las lineas automaticamente.
- Un IGV exonerado por categoria (bebidas para llevar, alimentos
  basicos, lo que SUNAT distinga) es una extension de
  igv_subtotal_from_total()/igv_tax_from_total() que no rompe nada
  existente, si master alguna vez lo pide con las reglas exactas
  delante (nunca de memoria, por la misma razon que esta fase entera).
- El patron credenciales-en-Vault-referenciadas-por-id es reutilizable
  por cualquier fase futura que necesite guardar un secreto externo -
  la Fase 18 (Inventario) no lo necesita, pero una futura integracion
  de pagos en linea (Fase 21, pasarelas web) probablemente si.
```
