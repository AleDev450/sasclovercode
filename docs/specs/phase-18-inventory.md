# SPEC — Phase 18 — Inventory

## 1. Información general

```text
Phase:                18
Nombre:               Inventory
Estado:               COMPLETED
Versión:              1.0.0
Fecha creación:       2026-08-27
Última actualización: 2026-08-27
Responsable:          alejandro.avendano@masuno.pe
```

Documento maestro: §33 (Fase 18).
Fases previas: 00 a 17 — todas COMPLETED y auditadas.
ADR: [022 — Stock derivado y consumo disparado al completar el pedido](../adr/022-derived-stock-and-completion-triggered-consumption.md).

---

## 2. Objetivo

### ¿Por qué existe esta fase?

Master §33, Fase 18, textual y completo:

> Crear: inventory_items, units, stock_movements, suppliers, purchases,
> recipes, recipe_items.
> El stock deberá derivarse de movimientos. Evitar simplemente:
> `products.stock = stock - 1` sin trazabilidad.
> Tipos: purchase, sale, adjustment, waste, return, transfer.
> Preparar multi-location.

Hasta esta fase, `products` (Fase 11) es lo que un negocio VENDE. Nada en
el sistema sabía qué se necesitaba COMPRAR ni CONSUMIR para producirlo.
Esta fase agrega esa segunda mitad, y la conecta con la primera: una
receta (`recipes`/`recipe_items`) declara cuánto de cada insumo consume
una unidad vendida, y completar un pedido (Fase 13) descuenta ese stock
solo, sin que nadie tenga que registrarlo a mano cada vez.

### ¿Qué debe ser posible al terminarla?

```text
Registrar una compra a un proveedor y ver el costo total sumado
  automaticamente.
Ver cuanto stock hay de un insumo, en cada sede, en cualquier momento -
  siempre como la suma de lo que realmente paso, nunca un numero que
  alguien pudo dejar desactualizado.
Corregir el stock a mano (merma, ajuste, devolucion) con un motivo
  registrado.
Trasladar stock entre sedes sin que ninguna de las dos pierda
  trazabilidad.
Definir la receta de un producto y que, al completar un pedido con ese
  producto, el stock de sus ingredientes baje solo.
```

---

## 3. Alcance

### Incluido

```text
inventory_items, units, suppliers, purchases, stock_movements
  (enum stock_movement_type con los seis tipos de §33), recipes,
  recipe_items - las siete tablas exactas de §33.
inventory_stock_levels: una VIEW (no una tabla) que suma
  stock_movements por insumo y por sede - el stock nunca vive en una
  columna.
Permisos nuevos: inventory.view/manage, suppliers.view/manage,
  purchases.view/create.
create_tenant_defaults() extendido una cuarta vez: cada tenant recibe
  un set de unidades por defecto (kg, g, l, ml, unidad).
Un trigger sobre orders: al llegar a completed, si una linea vendio un
  producto con receta activa, se generan los movimientos de tipo sale
  que esa receta implica.
Tarjeta "Receta" en el detalle de producto (Fase 11); pantallas
  /inventario, /inventario/{itemId}, /inventario/proveedores,
  /inventario/compras y /inventario/compras/{purchaseId}.
```

### Fuera de alcance

```text
Una integracion real con SUNAT sobre las compras (eso es facturacion,
  Fase 17, sobre lo que se VENDE, no sobre lo que se compra).
Un flujo de orden de compra (borrador -> enviada -> recibida) -
  purchases es un recibo inmutable, escrito en el momento en que el
  stock llega. Ver ADR-022 decision 2.
Bloquear una venta por falta de stock - nada en esta fase impide
  completar un pedido aunque su receta deje un insumo en negativo.
  Ver ADR-022 decision 4.
Conversion entre unidades (kg <-> g, l <-> ml) - cada recipe_item usa
  siempre la unidad nativa de su inventory_item. Ver ADR-022 decision 5.
Alertas de stock bajo o punto de reorden - ninguna fase lo ha pedido
  todavia; el numero ya esta disponible via la vista para cuando se
  pida.
```

### La decisión de alcance que más costó

**Cuándo, exactamente, un pedido completado descuenta stock.**

Master exige el tipo de movimiento `sale` y las tablas `recipes`/
`recipe_items`, pero no dice en qué momento del ciclo de vida de un
pedido (Fase 13: `pending → confirmed → preparing → ready → completed`)
ese descuento debe ocurrir. Se le preguntó directamente al usuario, con
tres opciones reales: al confirmar (más realista, pero exige revertir el
descuento si el pedido se anula despues), al completar (el unico estado
terminal sin salida, nunca revertido), o dejarlo sin automatizar en esta
fase (recipes/recipe_items quedarían preparadas, sin un consumidor).

Se eligió **completar**. La razón no es solo simplicidad: al ser
`completed` el único estado del que `order_transitions` (Fase 13) no
declara ninguna salida, una anulación en cualquier punto anterior nunca
llegó a tocar inventario — por construcción, no por una comprobación
adicional. Ver ADR-022 sección 3 para el razonamiento completo.

---

## 4. Dependencias

```text
Phase 10 — Locations             cada movimiento y cada compra nombra
                                  una sede; el comentario de esa
                                  migracion ya anticipaba esta fase
Phase 11 — Catalog                products es lo que se vende; recipes
                                  es el puente hacia lo que se consume
Phase 13 — Orders Core            orders/order_items; el trigger de
                                  consumo se engancha a status='completed'
                                  sin tocar la maquina de estados
ADR-013 — Declinar integraciones  precedente de "declinar" un flujo no
           no verificables       pedido (aqui: una orden de compra con
                                  estados propios, ADR-022 decision 2)
ADR-015 — Money as minor units    unit_cost_cents / total_cost_cents,
                                  el mismo patron de siempre
ADR-017 — Order snapshot/FSM      el patron de tabla-ledger +
                                  columna-derivada que ADR-022 reutiliza
                                  (y donde decide NO reutilizarlo, para
                                  el stock en si)
ADR-018 — Payment void            el precedente de ledger firmado
                                  (signed) que stock_movements repite
ADR-022 — Esta fase               stock como VIEW, purchases sin
                                  workflow, consumo en completed, sin
                                  bloqueo por falta de stock
```

**Tres permisos nuevos** (`inventory.*`, `suppliers.*`, `purchases.*`),
el mismo reparto de tres que Fase 14 hizo entre `payments`/
`payment_methods`/`cash`.

---

## 5. Casos de uso

```text
UC-1801
Actor           Owner con purchases.create
Precondiciones  Un proveedor y al menos un insumo activos
Accion          Registra una compra de 20kg de salmon a S/5.00 el kilo
Resultado       purchases.total_cost_cents queda en 10000 (S/100.00),
                sumado por trigger; inventory_stock_levels muestra 20kg
                en la sede de llegada

UC-1802
Actor           Cocinero via el sistema (no una persona)
Precondiciones  Un producto "Maki" con receta: 0.2kg de salmon por
                unidad; un pedido de 5 makis
Accion          El pedido pasa a completed
Resultado       Se escribe un movimiento sale de -1.0kg de salmon;
                inventory_stock_levels baja de 20 a 19 de inmediato

UC-1803
Actor           Manager con inventory.manage
Precondiciones  Un conteo fisico distinto del sistema
Accion          Registra un ajuste de -0.5kg con motivo "conteo semanal"
Resultado       Un nuevo stock_movements, tipo adjustment; el stock
                anterior no se edita, se corrige con un movimiento nuevo

UC-1804
Actor           Manager
Precondiciones  Dos sedes activas, stock en la primera
Accion          Traslada 4kg de salmon de una sede a otra
Resultado       Dos movimientos tipo transfer, signos opuestos, mismo
                transfer_group_id; el stock baja en una sede y sube en
                la otra, exacto

UC-1805 (verificado contra Supabase real, no PGlite)
Actor           Cualquier sesion autenticada, incluso el owner
Precondiciones  Ninguna
Accion          Intenta insertar un stock_movements de tipo sale
                directamente, sin pasar por completar un pedido
Resultado       Row Level Security lo rechaza - sale es el unico tipo
                que ninguna politica permite insertar directamente,
                pase lo que pase con los permisos que tenga
```

---

## 6. Requerimientos funcionales

```text
FR-1801  Los tipos de movimiento son exactamente purchase, sale,
         adjustment, waste, return, transfer (§33).

FR-1802  El signo de un movimiento sigue su tipo donde el tipo lo
         determina: purchase siempre positivo, sale y waste siempre
         negativos. adjustment, return y transfer no tienen signo fijo
         - una correccion o un traslado puede ir en cualquier
         direccion.

FR-1803  El stock de un insumo en una sede es SIEMPRE la suma de sus
         movimientos en esa sede. No existe, en ningun punto del
         esquema, una columna que "sea" el stock.

FR-1804  Una compra siempre nombra un proveedor y una sede; cada linea
         comprada es un stock_movements de tipo purchase con su propio
         costo unitario. purchases.total_cost_cents se recalcula por
         trigger, nunca se envia desde el cliente.

FR-1805  Cada tenant recibe un set de unidades por defecto (kg, g, l,
         ml, unidad) sin necesidad de configurar nada antes de crear su
         primer insumo.

FR-1806  Una receta pertenece a exactamente un producto. Sus lineas
         expresan cuanto de un insumo consume UNA unidad vendida, en la
         unidad propia del insumo - nunca en una unidad distinta.

FR-1807  Al completar un pedido (y solo entonces), por cada linea cuyo
         producto tenga una receta activa, se escribe un movimiento
         sale por cada ingrediente de esa receta, multiplicado por la
         cantidad vendida.

FR-1808  Una linea sin producto, o un producto sin receta (o con una
         receta pausada), no genera ningun movimiento al completar el
         pedido - nunca un error.

FR-1809  Anular un pedido en cualquier punto ANTES de completed nunca
         genera ni revierte un movimiento de stock, porque nunca llego
         a generarlo.

FR-1810  Un traslado entre sedes es siempre exactamente dos movimientos
         de signo opuesto, insertados juntos, nunca uno sin el otro.

FR-1811  `sale` no puede insertarse directamente por ningun llamador,
         sin importar sus permisos - solo el trigger de finalizacion de
         pedido lo escribe.
```

---

## 7. Requerimientos no funcionales

```text
NFR-1801 Seguridad
  `inventory_stock_levels` se declara `security_invoker = true`
  explicitamente - sin eso, una VIEW corre con los permisos de su
  DUEÑO (el rol de migracion), no del usuario que consulta, y
  filtraria - o no - el RLS de stock_movements de forma incorrecta.
  Verificado contra Supabase real que la vista respeta el mismo
  aislamiento por tenant que la tabla que resume (UC-1805 y la
  verificacion en vivo, seccion 17).

NFR-1802 Integridad
  stock_movements_sign_by_type, stock_movements_purchase_fields,
  stock_movements_sale_fields y stock_movements_transfer_fields hacen
  imposible, por construccion, un movimiento con el tipo y los campos
  en desacuerdo - no una esperanza de la capa de aplicacion.

NFR-1803 Performance
  stock_movements_item_location_idx sirve exactamente el GROUP BY que
  la vista ejecuta. purchases_total_cost_cents evita un JOIN+SUM en
  cada fila de un listado de compras.

NFR-1804 Trazabilidad
  Ningun movimiento se edita ni se borra jamas (sin politica UPDATE ni
  DELETE en stock_movements, purchases ni billing... - la misma forma
  append-only de cash_movements y order_status_history). Corregir es
  siempre un movimiento nuevo.

NFR-1805 Observabilidad
  logger.info en cada Server Action (unit.created,
  inventory_item.created, purchase.recorded, stock_movement.recorded,
  stock_transfer.recorded, recipe.saved). El trigger de consumo
  automatico no loguea nada aparte - es datos, no una accion humana.

NFR-1806 Mantenibilidad
  populate el mismo patron ya usado por recompute_order_paid (Fase 14)
  y populate_billing_document_items (Fase 17): un trigger AFTER INSERT
  que recalcula un total desde sus propias filas, nunca confiado a que
  la aplicacion lo sume bien.
```

---

## 8. Modelo de datos

### Enum nuevo

```text
stock_movement_type = ('purchase','sale','adjustment','waste','return','transfer')
```

### units

```text
id, tenant_id, name, abbreviation, is_active, created_at, updated_at
UNIQUE (tenant_id, lower(abbreviation))
```

### inventory_items

```text
id, tenant_id, unit_id (FK units), name, sku, is_active,
created_at, updated_at
UNIQUE (tenant_id, lower(name))
```

### suppliers

```text
id, tenant_id, name, tax_id (11 digitos, opcional), contact_name,
phone, email, address, notes, is_active, created_at, updated_at
```

### purchases

```text
id, tenant_id, supplier_id (FK), location_id (FK), reference,
purchased_at, notes, total_cost_cents (trigger), created_by,
created_at, updated_at
```

### stock_movements

```text
id, tenant_id (derivado), inventory_item_id (FK), location_id (FK),
type, quantity (numeric(12,3), signo por tipo), unit_cost_cents
(solo purchase), purchase_id (solo purchase), order_id / order_item_id
(solo sale, escritos solo por el trigger), transfer_group_id
(solo transfer), reason, created_by, created_at
```

### inventory_stock_levels (VIEW, no tabla)

```text
tenant_id, inventory_item_id, location_id, quantity_on_hand
  = sum(stock_movements.quantity) agrupado por los tres primeros
security_invoker = true
```

### recipes

```text
id, tenant_id (derivado), product_id (FK products, UNIQUE), notes,
is_active, created_at, updated_at
```

### recipe_items

```text
id, recipe_id (FK), tenant_id (derivado), inventory_item_id (FK),
quantity (numeric(12,3), en la unidad del insumo), position, created_at
UNIQUE (recipe_id, inventory_item_id)
```

Ninguna tabla nueva fuera de las siete de §33. Ninguna columna que sea
"el stock" en sí misma.

---

## 9. Diagrama de relaciones

```text
suppliers ──┬──► purchases ──(1:N via purchase_id)──► stock_movements
locations ──┘                                              │
                                                             │ SUM group by
                                                             ▼
inventory_items ──(unit_id)──► units          inventory_stock_levels (view)
      │
      │ (recipe_items.inventory_item_id)
      ▼
recipes ──(product_id, UNIQUE)──► products
   │
   └──► recipe_items
              │
              │ (al completar, multiplicado por order_items.quantity)
              ▼
orders (status=completed) ──► order_items ──► stock_movements (type=sale)
```

---

## 10. Tenant Isolation

```text
Tenant Isolation Impact: TOTAL
```

**¿Cómo se determina el tenant?** `stock_movements` lo deriva de
`inventory_item_id` y cruza que `location_id`/`purchase_id`/`order_id`
coincidan (el mismo patrón de dos-FK-que-podrían-discrepar de
`purchases`, `payments`, Fase 14). `recipes` lo deriva de `product_id`;
`recipe_items`, de `recipe_id`, cruzando `inventory_item_id`.

**¿Qué cambia respecto a fases anteriores?** La primera VIEW del
esquema. Sin `security_invoker = true` habría sido la primera fuga de
aislamiento por tenant vía un mecanismo nuevo — verificado explícitamente
en vivo (UC-1805, sección 17) que no lo es.

**¿Existe algún recurso global?** Ninguno. A diferencia de
`order_transitions`/`billing_document_transitions`, esta fase no
introduce una tabla de vocabulario del producto — `stock_movement_type`
es un enum, no una tabla, así que no hay una quinta excepción a
`using (true)`.

---

## 11. Seguridad

```text
Authorization requirements
  inventory.view     ver insumos, unidades, recetas, movimientos
  inventory.manage   crear insumos/unidades, definir recetas, registrar
                     ajuste/merma/devolucion/traslado
  suppliers.view/manage
  purchases.view/create   (sin "manage": una compra no se edita ni
                           se cancela, ADR-022 decision 2)

Roles involucrados
  owner/admin   las seis, explicitas para admin (no hereda)
  manager       las seis - "supervisa operaciones, catalogo, caja y
                reportes", inventario es exactamente eso
  accountant    inventory.view + purchases.view (costos, sin escritura)
  cashier/waiter/kitchen/delivery   ninguna, igual que con
                payment_methods.manage/cash.manage (Fase 14)

RLS policies
  stock_movements_insert_operator   una sola politica, partida por tipo:
    purchase   requiere purchases.create
    adjustment/waste/return/transfer   requieren inventory.manage
    sale   no coincide con ninguna rama - rechazado para TODO llamador
           directo, verificado en vivo (UC-1805)
  Ninguna politica UPDATE ni DELETE en stock_movements ni purchases,
  nunca.

Potential abuse cases
  AB-1801  Insertar un movimiento sale a mano para inflar ventas o
           esconder una anulacion.
           Mitigado: RLS lo rechaza sin importar el permiso que se
           tenga (UC-1805, verificado contra Supabase real).
  AB-1802  Enviar purchases.total_cost_cents propio al crear una
           compra.
           Mitigado: la columna no esta en el schema de insercion de
           Zod ni se acepta del cliente; el trigger la recalcula
           siempre desde sus propias lineas.
  AB-1803  Un traslado que solo mueva un lado (perdiendo stock en el
           aire).
           Mitigado: recordStockTransferAction inserta las dos filas en
           un unico statement; una las necesita a ambas por construccion
           (stock_movements_transfer_fields exige transfer_group_id).
  AB-1804  Una receta que apunte a un insumo de otro negocio, para leer
           o afectar su stock.
           Mitigado: derive_recipe_item_tenant() rechaza la insercion
           antes de que la fila exista.
```

---

## 12. API / Server Actions

```text
src/modules/inventory/server/actions.ts
  createUnitAction / setUnitActiveAction                inventory.manage
  createInventoryItemAction / updateInventoryItemAction /
    setInventoryItemActiveAction                        inventory.manage
  createSupplierAction / updateSupplierAction /
    setSupplierActiveAction                             suppliers.manage
  recordPurchaseAction (header + N lineas)               purchases.create
  recordStockMovementAction (adjustment/waste/return)     inventory.manage
  recordStockTransferAction (par atomico)                 inventory.manage
  saveRecipeAction (upsert + reemplaza recipe_items)       inventory.manage

src/modules/inventory/server/queries.ts
  listUnits, listInventoryItems, getInventoryItemDetail
    (item + stock por sede desde la vista + movimientos recientes)
  listSuppliers
  listPurchases (paginado), getPurchaseDetail
  getRecipeForProduct(tenantId, productId) -> null si no existe (nunca
    un error)
```

---

## 13. UI / UX

```text
/dashboard/{slug}/inventario
  Unidades (lista + alta), Insumos (lista + alta + estado), acciones
  manuales (ajuste/merma/devolucion, traslado). Permission: inventory.view;
  inventory.manage para escribir.

/dashboard/{slug}/inventario/{itemId}
  Stock actual por sede (de la vista), datos editables, movimientos
  recientes.

/dashboard/{slug}/inventario/proveedores
  Lista + alta/edicion. Permission: suppliers.view/manage.

/dashboard/{slug}/inventario/compras
  Lista paginada + formulario de registro (lineas dinamicas, mismo
  patron que NewOrderForm, Fase 13). Permission: purchases.view/create.

/dashboard/{slug}/inventario/compras/{purchaseId}
  Detalle: lineas y total.

Catalogo -> Producto -> tarjeta "Receta"
  Ingredientes (lineas dinamicas), activo/pausado. Gated en
  inventory.view/manage, no en products.update - una receta es dato de
  inventario, aunque apunte a un producto.
```

Una sola entrada de navegacion nueva, `Inventario`, gated en
`inventory.view`. Proveedores y Compras se alcanzan como enlaces desde
adentro, la misma postura que `/pedidos/{id}` y `/caja/{sessionId}` ya
tenian.

---

## 14. Flujos principales

```text
Owner registra una compra
   ↓
recordPurchaseAction: INSERT purchases (header)
   ↓
INSERT stock_movements (una fila por linea, type=purchase)
   ↓
derive_stock_movement_tenant() (BEFORE INSERT): deriva tenant, valida
  sede/proveedor/insumo
   ↓
recompute_purchase_total() (AFTER INSERT): suma las lineas de ESA
  compra, actualiza purchases.total_cost_cents
   ↓
inventory_stock_levels ya refleja el nuevo stock, sin ningun paso
  adicional

Cocina marca un pedido como completed (Fase 13, sin cambios)
   ↓
consume_recipe_stock_on_completion() (AFTER UPDATE OF status, WHEN
  new.status='completed')
   ↓
Por cada order_items con producto y receta activa, INSERT
  stock_movements (type=sale, quantity negativa)
   ↓
El mismo derive_stock_movement_tenant() valida cada fila igual que si
  viniera de un humano
   ↓
inventory_stock_levels baja de inmediato
```

---

## 15. Manejo de errores

```text
Unidad/sede/proveedor de otro negocio      -> 23514 'different business'
Insumo o producto inexistente               -> P0002 'not found'
Movimiento con signo equivocado para su tipo -> 23514
                                               stock_movements_sign_by_type
Purchase sin unit_cost_cents, o con el
  campo equivocado para su tipo             -> 23514
                                               stock_movements_*_fields
Traslado sin transfer_group_id               -> 23514
                                               stock_movements_transfer_fields
Nombre de unidad/insumo/proveedor repetido   -> 23505 (unique, por tenant)
Mismo insumo dos veces en una receta         -> 23505
                                               recipe_items_recipe_item_key
Intento directo de insertar type=sale        -> row-level security
  (RLS, no un CHECK - rechazado para cualquier permiso)
```

---

## 16. Observabilidad

`logger.info`/`logger.error` en cada Server Action
(`unit.created/activated/deactivated`, `inventory_item.*`, `supplier.*`,
`purchase.recorded`, `stock_movement.recorded`, `stock_transfer.recorded`,
`recipe.saved`). El trigger de consumo automático no genera un log de
aplicación aparte — es un hecho de datos, verificable directamente en
`stock_movements`, no una acción de un Server Action.

---

## 17. Testing Plan

### Unit

```text
inventory-schemas.test.ts   Ningun campo calculado (totalCostCents, un
                             balance de stock) aceptado del cliente;
                             waste no fija su propio signo (lo hace el
                             Server Action); purchase/sale/transfer
                             rechazados por recordStockMovementSchema;
                             un insumo repetido en una receta se
                             rechaza antes de llegar a la base de datos.
dashboard-navigation.test.ts  La entrada "inventory" depende de
                             inventory.view.
```

### Database (`src/tests/database/inventory.test.ts`, 35 tests)

```text
- Cada tenant recibe kg/g/l/ml/unidad automaticamente.
- El signo de un movimiento sigue su tipo; cero siempre se rechaza.
- purchases.total_cost_cents suma sus propias lineas y no las de otra
  compra.
- inventory_stock_levels suma correctamente a traves de varios
  movimientos, y por sede de forma independiente.
- El stock puede ir a negativo sin que nada lo bloquee (ADR-022 decision 4).
- Un traslado es siempre dos filas que suman cero, y mueve el stock
  entre sedes exacto.
- EL TEST DE LA FASE: completar un pedido escribe exactamente los
  movimientos sale que su receta implica, una sola vez; no escribe
  nada para una linea sin producto, un producto sin receta, o una
  receta pausada; anular un pedido en cualquier punto ANTES de
  completed no escribe nada; completar dos veces no duplica (el WHEN
  del trigger es un no-op).
- Guardas cruzadas de tenant en cada FK: unit_id, supplier_id/
  location_id, inventory_item_id de un recipe_item.
- Unicidad: un insumo no se repite en una receta; un producto tiene a
  lo sumo una receta.
- RLS: nada para anon; ninguna politica UPDATE/DELETE en
  stock_movements ni purchases; un manager puede crear un insumo, un
  rol de solo lectura no puede; una compra exige purchases.create,
  distinto de inventory.manage; sale se rechaza para TODO llamador
  directo, incluso con inventory.manage; la vista respeta el mismo
  aislamiento que la tabla que resume.
```

### Verificado a mano contra Supabase real (12 comprobaciones, todas en verde)

```text
- Las ocho migraciones se aplican limpias contra Postgres 17 real.
- Registrar una compra via PostgREST: la linea se inserta, el total se
  recalcula por trigger (20kg x S/5.00 = S/100.00).
- inventory_stock_levels (la VIEW) es consultable via PostgREST y suma
  correctamente - `security_invoker = true` funciona como se espera.
- Avanzar un pedido real, paso a paso, hasta completed via PostgREST:
  se escribe exactamente un movimiento sale (5 unidades x 0.2kg = 1.0kg),
  y la vista lo refleja de inmediato (20 -> 19).
- Un intento directo de insertar type=sale, incluso como owner, es
  rechazado por RLS - no por un CHECK, por la politica misma.
- Toda fila que la vista devuelve para una sesion pertenece al tenant
  de esa sesion.
```

---

## 18. Edge Cases

```text
Insumo sin ningun movimiento todavia        Su stock es 0 en toda sede
                                             (ausente de la vista, no
                                             una fila con 0 explicito).
Producto sin receta                         Se vende normal; completar
                                             el pedido no toca inventario.
Receta pausada (is_active=false)            Conserva sus ingredientes;
                                             completar un pedido con ese
                                             producto no descuenta nada
                                             mientras siga pausada.
Pedido con una linea de texto libre
  (sin product_id)                          Esa linea nunca puede tener
                                             receta; no contribuye nada.
Compra con una sola linea vs varias         El trigger de recalculo es
                                             el mismo; suma lo que haya.
Traslado a la misma sede                    Rechazado en el schema
                                             (Zod), antes de tocar la
                                             base de datos.
Cantidad fraccionaria (0.75kg)               Soportada en todo el
                                             esquema (numeric(12,3)),
                                             igual que order_items
                                             (Fase 13).
Stock negativo tras una venta                Permitido; nada lo
                                             bloquea (ADR-022 decision 4).
```

---

## 19. Performance considerations

```text
Queries    inventory_stock_levels es una vista agregada, no una tabla
           materializada - a los volumenes de un solo restaurante
           (decenas de insumos, unos pocos cientos de movimientos al
           dia) esto no es un problema medido; si alguna vez lo fuera,
           la solucion es un indice, no un cambio de esquema (ADR-022).

Indexes    stock_movements_item_location_idx sirve exactamente el
           GROUP BY de la vista. purchases_tenant_supplier_idx /
           _tenant_location_idx / _tenant_purchased_idx sirven el
           listado de compras.

Purchases  total_cost_cents evita sumar lineas en cada fila de un
           listado - la misma razon que orders.total_cents (Fase 13).
```

---

## 20. Migraciones

```text
20260827180000_create_inventory_permissions.sql
  inventory.*, suppliers.*, purchases.*; otorgados a owner/admin/manager,
  parcialmente a accountant.

20260827180100_create_units.sql
  units; create_tenant_defaults() extendido (kg/g/l/ml/unidad).

20260827180200_create_inventory_items.sql
  inventory_items; guarda de tenant sobre unit_id.

20260827180300_create_suppliers.sql
  suppliers.

20260827180400_create_purchases.sql
  purchases (header); guarda de tenant sobre supplier_id/location_id.

20260827180500_create_stock_movements.sql
  stock_movement_type; stock_movements; derive_stock_movement_tenant();
  recompute_purchase_total(); la vista inventory_stock_levels; RLS.

20260827180600_create_recipes.sql
  recipes; recipe_items; guardas de tenant.

20260827180700_extend_orders_stock_consumption.sql
  consume_recipe_stock_on_completion() sobre orders, disparado solo al
  llegar a completed.
```

---

## 21. Rollback

Aditivas. Revertir es soltarlas en orden inverso:

```sql
drop trigger if exists orders_consume_recipe_stock on public.orders;
drop function if exists public.consume_recipe_stock_on_completion();
drop table if exists public.recipe_items;
drop table if exists public.recipes;
drop view if exists public.inventory_stock_levels;
drop table if exists public.stock_movements;
drop type if exists public.stock_movement_type;
drop table if exists public.purchases;
drop table if exists public.suppliers;
drop table if exists public.inventory_items;
drop table if exists public.units;
delete from public.role_permissions where permission like 'inventory.%'
  or permission like 'suppliers.%' or permission like 'purchases.%';
delete from public.permissions where resource in ('inventory', 'suppliers', 'purchases');
```

Ningún pedido ni pago deja de tener sentido sin estas tablas: la Fase 13
sigue siendo válida exactamente como la dejó. Lo único que se pierde es
de dónde salió cada insumo y qué se consumió para cada venta —
información operativa nueva, no un hecho de venta ya existente.

---

## 22. Definition of Done

- [x] Las siete tablas exactas de §33, ninguna de más
- [x] `inventory_stock_levels`: una VIEW, `security_invoker = true`,
      nunca una columna guardada
- [x] Los seis tipos de movimiento de §33, con el signo correcto
      forzado por CHECK
- [x] `purchases.total_cost_cents` sumado por trigger, nunca enviado
      por un cliente
- [x] `sale` rechazado para todo llamador directo, verificado contra
      Supabase real (no solo contra un CHECK)
- [x] Completar un pedido descuenta stock exactamente una vez, solo
      para lineas con receta activa
- [x] Anular un pedido antes de `completed` nunca requiere revertir
      inventario, por construcción
- [x] Un traslado es siempre un par atómico
- [x] Tres permisos nuevos, otorgados explícitamente a owner/admin
- [x] `create_tenant_defaults()` extendido para sembrar unidades
- [x] Tarjeta "Receta" en el detalle de producto; cinco pantallas de
      inventario; una entrada de navegación
- [x] 35 tests de base de datos, 24 tests unitarios, todos en verde
- [x] Verificación en vivo contra Supabase real: 12 comprobaciones,
      incluida la vista, el trigger de consumo y el rechazo RLS de `sale`
- [x] Suite completa (Fases 00-18): 1428 tests en verde
- [x] Typecheck PASS
- [x] Lint PASS
- [x] Build PASS
- [x] SPEC actualizado

---

## 23. Implementation notes

### Por qué una VIEW y no una columna, incluso rompiendo el patrón de
### `paid_cents`/`total_cents`

Todas las fases anteriores que necesitaron un total derivado
(`orders.total_cents`, `orders.paid_cents`, `cash_sessions.expected_
cents`, `billing_documents.total_cents`) lo guardaron en una columna,
mantenida por un trigger. Esta fase rompe ese patrón a propósito para el
stock, y lo mantiene para `purchases.total_cost_cents` — la diferencia no
es estética. Un total de pedido/pago/documento es un hecho sobre UNA
fila con UN padre. Un balance de stock es un hecho sobre un **par**
(insumo, sede) que no tiene una fila propia en ninguna de las siete
tablas que master pidió — guardarlo habría exigido inventar una octava
tabla solo para sostener un número, exactamente lo que master pide
evitar con la frase "el stock deberá derivarse de movimientos". Una
`VIEW` con `security_invoker = true` es la forma más literal de esa
frase: no hay ningún momento en que el stock "sea" algo aparte de la
suma que se acaba de calcular.

### El hallazgo que confirmó por qué `security_invoker` no es opcional

Antes de escribir la migración se investigó (no se asumió) que
PostgreSQL, por defecto, ejecuta una vista con los privilegios de su
**dueño** — en este proyecto, el rol que aplica las migraciones — y no
con los del usuario que la consulta. Sin `security_invoker = true`, la
primera vista de este esquema habría sido, silenciosamente, el primer
agujero de aislamiento por tenant: cualquier sesión autenticada habría
visto el stock de TODOS los negocios, porque el dueño de la vista
bypassa RLS. La verificación en vivo (sección 17) confirmó explícitamente
que, con el flag puesto, la vista respeta el mismo aislamiento que
`stock_movements` — no se dio por sentado que la documentación de
PostgreSQL bastaba.

### Qué se verificó y qué no

Verificado corriendo, contra un Supabase real levantado en esta misma
sesión (no PGlite): las ocho migraciones se aplican limpias; una compra
registrada vía PostgREST recalcula su total correctamente; la vista es
consultable vía PostgREST y refleja un movimiento nuevo de inmediato; un
pedido avanzado paso a paso hasta `completed` vía PostgREST dispara el
trigger de consumo exactamente una vez, con la cantidad correcta; un
intento directo de escribir `sale`, incluso como owner, es rechazado por
RLS. `npm run typecheck`, `npm run lint`, `npm run build` y la suite
completa (1428 tests) en verde.

No verificado: nadie ha abierto `/inventario` en un navegador — esta
sesión no tiene una herramienta de navegador interactivo. Tampoco se
verificó el comportamiento de la vista a gran volumen (miles de
movimientos): a la escala de un negocio real esto no es una preocupación
medida, y si lo fuera, la solución documentada (un índice) no cambia el
diseño.

---

## 24. Known limitations

```text
KL-1801  El stock nunca bloquea una venta. Un negocio puede completar
         un pedido cuyo insumo ya esta en cero o negativo - la senal
         queda en la vista, no en un error. Decision deliberada
         (ADR-022 decision 4), no un descuido.

KL-1802  Sin alertas de stock bajo ni punto de reorden. El numero ya
         esta disponible (inventory_stock_levels); construir la
         alerta es trabajo de una fase futura que lo pida.

KL-1803  purchases no tiene flujo de aprobacion ni estados propios -
         es un recibo, escrito una vez. Una orden de compra formal
         (si algun negocio la necesita) es una fase futura explicita,
         no una que esta subestimo.

KL-1804  Sin conversion de unidades. Un insumo definido en "kg" no
         puede recibir una compra en "g" sin que la persona haga la
         conversion ella misma antes de escribir el numero.

KL-1805  El descuento automatico por receta ocurre solo al completar
         un pedido, nunca antes - un stock "en vivo" durante la
         preparacion (cuanto queda MIENTRAS se cocina, no despues de
         servir) no es lo que este numero muestra. Documentado en
         ADR-022 como el costo aceptado de evitar la complejidad de
         revertir un descuento si el pedido se anula despues.
```

---

## 25. Future considerations

```text
- Un reporte de stock bajo / punto de reorden es una extension aditiva
  sobre inventory_stock_levels - no requiere cambiar como se escribe
  un movimiento, solo como se lee.
- products.is_available (Fase 11, "agotado hoy") podria, en una fase
  futura, apagarse automaticamente cuando la receta de un producto se
  queda sin stock - no se conecto en esta fase porque nadie lo pidio
  todavia, y el acoplamiento (que catalogo dependa de inventario)
  merece su propia decision explicita, no un efecto secundario callado.
- Conversion de unidades, si algun negocio real la necesita con reglas
  concretas delante (no de memoria).
- Un flujo de orden de compra formal, si el volumen de un negocio real
  lo justifica algun dia - purchases ya tiene la forma minima que ese
  flujo extenderia, no la que reemplazaria.
```
