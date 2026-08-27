# SPEC — Phase 15 — POS

## 1. Información general

```text
Phase:                15
Nombre:               POS
Estado:               COMPLETED
Versión:              1.0.0
Fecha creación:       2026-08-27
Última actualización: 2026-08-27
Responsable:          alejandro.avendano@masuno.pe
```

Documento maestro: §33 (Fase 15).
Fases previas: 00 a 14 — todas COMPLETED y auditadas.
ADR: [019 — POS actions as RPC, ephemeral cart](../adr/019-pos-actions-as-rpc-and-ephemeral-cart.md).

---

## 2. Objetivo

### ¿Por qué existe esta fase?

Master §33, Fase 15, textual y completo:

> Construir POS utilizando el mismo backend.
> Debe soportar: tablet, desktop, touch, búsqueda rápida, categorías,
> carrito, cliente, pago, impresión, caja.
> No duplicar lógica de pedidos.
> POS deberá utilizar `orders`.

Es la primera fase del proyecto que no añade una entidad nueva. Las Fases 11 a
14 construyeron, en orden, qué se vende, a quién, qué se compró y cómo se
cobra. Esta fase no agrega nada a esa lista — agrega una **forma más rápida**
de recorrerla, pensada para alguien de pie frente a un mostrador y no sentado
frente a un formulario.

### ¿Qué debe ser posible al terminarla?

```text
Buscar y tocar productos para armar un pedido, con categorías y
  busqueda instantanea, en una pantalla que funciona igual de bien
  con mouse que con el dedo.
Elegir un cliente existente o vender sin registrar a nadie.
Cobrar en el mismo momento, dividido entre varios metodos si hace
  falta, viendo el vuelto cuando el pago es en efectivo.
Imprimir un recibo interno de la venta.
Saber, desde la misma pantalla, si hay una caja abierta para cobrar
  en efectivo, y a cual sesion se esta aplicando el efectivo.
Que la fuente `pos` del enum de la Fase 13 — sin usar desde que se
  declaro — finalmente tenga quien la produzca.
```

---

## 3. Alcance

### Incluido

```text
Pantalla /pos: catalogo con busqueda y categorias, carrito, selector
  de cliente, cobro con multiples formas de pago, recibo imprimible.
createOrderForPos: mismo camino de insercion que createOrderAction
  (Fase 13), expuesto para ser llamado directamente en vez de a
  traves de un <form>.
searchCustomersForPos: envoltorio delgado sobre listCustomers
  (Fase 12) para busqueda en vivo desde el cliente.
listProductsWithVariants: una sola consulta con variantes incluidas,
  para que la grilla sepa de inmediato si un producto ofrece opciones.
Reimprimir: el mismo componente de recibo, reutilizado desde el
  detalle de pedido existente (Fase 13).
Selector de sede cuando el negocio tiene mas de una (Fase 10).
```

### Fuera de alcance

```text
Tablas nuevas, permisos nuevos, migraciones      — no hacian falta;
                                                    ver la seccion 4.
Impresion por hardware (ESC/POS, WebUSB/WebSerial) — no hay impresora
                                                    en este entorno
                                                    para probar contra
                                                    ella; misma logica
                                                    que ADR-013 aplico
                                                    a la API de Vercel.
Opciones de producto (add-ons) en el carrito     — order_items no
                                                    tiene columna para
                                                    ellas desde la
                                                    Fase 13; no es una
                                                    brecha nueva.
Crear un cliente desde el POS                    — se busca y se
                                                    adjunta uno
                                                    existente, o se
                                                    vende sin cliente
                                                    (FR-1303, Fase 13).
Atajos al estado del pedido (saltar a completado) — la maquina de
                                                    estados es la de
                                                    ADR-017, sin tocar.
Persistencia del carrito entre sesiones o pestañas — ver KL-1501.
```

### La decisión de alcance que más costó

Que un pedido de POS pueda quedar **creado y sin pagar**.

La tentación era exigir que el pago cubra el total antes de dejar cerrar la
venta — es lo que la mayoría de un POS de mostrador hace. Pero eso habría
significado inventar una regla que la Fase 14 nunca pidió: `orders` y
`payments` son entidades independientes (§14, "no son la misma entidad"), y
un pedido con saldo pendiente es un estado válido y ya soportado — es
exactamente lo que hace posible una cuenta por cobrar. Forzar el pago
completo aquí habría sido una regla de negocio de esta pantalla disfrazada de
regla del sistema.

Así que el botón principal dice "Cobrar" cuando hay algo cargado, y "Crear
pedido sin pago" cuando no — la misma operación siempre, `createOrderForPos`,
con o sin pagos detrás.

---

## 4. Dependencias

```text
Phase 10 — Locations            selector de sede si hay mas de una
Phase 11 — Catalog              listProducts/listCategories, y la
                                 nueva listProductsWithVariants
Phase 12 — Customers            listCustomers (busqueda ya existia)
Phase 13 — Orders Core          createOrderAction, la fuente `pos`
                                 del enum order_source, sin usar
                                 hasta ahora
Phase 14 — Payments + Cash      recordPaymentAction, listPaymentMethods,
                                 listOpenSessionsForLocation
ADR-013 — Domain verification   el precedente para declinar impresion
                                 por hardware sin poder probarla
ADR-017 — Order snapshot/FSM    por que esta fase no toca la maquina
                                 de estados
ADR-019 — Esta fase             RPC directo y carrito efimero
```

**Cero permisos nuevos.** `orders.create` gobierna construir la venta;
`payments.create` gobierna cobrarla — los dos ya existian desde la Fase 03 y
14 respectivamente. Ningun otro modulo tuvo que tocar su esquema de permisos.

---

## 5. Casos de uso

```text
UC-1501
Actor           Cajero
Precondiciones  orders.create, una sede activa
Acción          Busca dos productos, ajusta cantidades, no elige
                cliente
Resultado       El carrito muestra el total correcto en todo momento
Errores         —

UC-1502
Actor           Cajero
Precondiciones  payments.create, caja abierta
Acción          Cobra el total completo en efectivo, entregando mas
                de lo debido
Resultado       El pago registrado es igual al saldo, no a lo
                entregado; la pantalla muestra el vuelto
Errores         —

UC-1503
Actor           Cajero
Precondiciones  payments.create
Acción          Cobra parte en efectivo y el resto con Yape
Resultado       Dos pagos distintos contra el mismo pedido, la Fase
                14 los acepta como cualquier pago dividido
Errores         Si el segundo pago fallara, el primero ya existe: el
                pedido queda parcialmente pagado, no revertido
                (ADR-019)

UC-1504
Actor           Mesero
Precondiciones  orders.create, SIN payments.create
Acción          Arma un pedido y presiona "Crear pedido sin pago"
Resultado       El pedido se crea en pendiente, sin ningun pago; la
                seccion de cobro nunca aparecio en su pantalla
Errores         —

UC-1505
Actor           Cajero
Precondiciones  payments.create, SIN ninguna caja abierta en la sede
Acción          Intenta agregar un pago en efectivo
Resultado       Rechazado antes de llegar a la base: el selector de
                caja muestra "Ninguna abierta"
Errores         Mensaje que dirige a abrir una caja primero

UC-1506
Actor           Cajero
Precondiciones  Venta recien cobrada
Acción          Presiona "Imprimir"
Resultado       El navegador imprime el recibo; el resto de la
                pantalla no aparece en el papel
Errores         —

UC-1507
Actor           Encargado
Precondiciones  orders.view, un pedido de hace una semana
Acción          Abre el pedido y presiona "Imprimir" en la tarjeta
                Recibo
Resultado       El mismo componente de recibo, con los datos reales
                del pedido y sus pagos
Errores         —

UC-1508
Actor           Cajero de un negocio con dos sedes
Precondiciones  orders.create
Acción          Abre /pos
Resultado       Ve un selector de sede antes de vender; la URL queda
                con `?sede=` para esa sesion
Errores         —
```

---

## 6. Requerimientos funcionales

```text
FR-1501  El catalogo del POS muestra solo productos `active`; uno
         `draft` o `archived` no aparece en la grilla.

FR-1502  Tocar un producto sin variantes lo agrega al carrito con
         cantidad 1. Tocar uno con variantes ofrece elegir cual antes
         de agregarlo.

FR-1503  Tocar un producto ya presente en el carrito incrementa su
         cantidad en vez de crear una segunda linea.

FR-1504  El carrito permite ajustar cantidad y quitar una linea antes
         de cobrar.

FR-1505  El cliente es opcional. Se busca por nombre, documento,
         correo o telefono entre los clientes existentes; el POS no
         ofrece crear uno nuevo.

FR-1506  Confirmar la venta llama a createOrderForPos con `source =
         'pos'` y exactamente los mismos campos que el formulario de
         `/pedidos` - el mismo camino de insercion, sin duplicarlo.

FR-1507  Sin payments.create, la seccion de cobro no se muestra; el
         boton principal crea el pedido sin ningun pago.

FR-1508  Con payments.create, se pueden agregar varios pagos antes de
         confirmar, cada uno con su propio metodo.

FR-1509  Un pago en efectivo exige elegir una sesion de caja abierta
         de la sede actual; sin ninguna, no se puede agregar.

FR-1510  El monto aplicado a un pago nunca excede el saldo pendiente
         en ese momento, sin importar cuanto se haya escrito. El
         excedente de un pago en efectivo se muestra como vuelto y
         nunca se envia a la base de datos.

FR-1511  Tras cobrar, la pantalla muestra un recibo imprimible con
         las lineas, el total y los pagos aplicados.

FR-1512  El detalle de un pedido (Fase 13) ofrece reimprimir el mismo
         recibo con los datos reales guardados.

FR-1513  Con mas de una sede activa, el POS exige elegir una antes de
         vender; con exactamente una, la usa sin preguntar.
```

---

## 7. Requerimientos no funcionales

```text
NFR-1501 Seguridad
  Los permisos son los que ya gobiernan orders.create y
  payments.create - esta pantalla no inventa una autorizacion propia
  ni un `pos.use` que pudiera desalinearse de los otros dos.

NFR-1502 Integridad
  Cada invariante que importa - el tope de pago, la regla de
  efectivo/sesion - la impone la base de datos desde la Fase 14. Este
  modulo no revalida ninguna: si lo hiciera y la regla cambiara en un
  solo lugar, serian dos lugares que revisar.

NFR-1503 Performance
  El catalogo y las categorias se cargan una vez, enteros, y la
  busqueda/filtro es en el navegador (Fase 11 ya razona esto para un
  catalogo tipico). La busqueda de clientes SI es una consulta por
  cada termino, con 250ms de espera, porque ese libro si crece
  (Fase 12).

NFR-1504 Escalabilidad
  listProductsWithVariants es una sola consulta con embed, sea cual
  sea el tamano del catalogo - el mismo argumento que
  getOrderDetail usa para sus lineas.

NFR-1505 Observabilidad
  Ningun evento nuevo: order.created y payment.recorded (Fases 13 y
  14) ya se emiten desde dentro de createOrderForPos y
  recordPaymentAction. No hay una segunda copia del log.

NFR-1506 Mantenibilidad
  Un solo camino de insercion de pedido (insertOrder, interno a
  orders/server/actions.ts) con dos salidas: FormState para el
  formulario, un resultado tipado para el POS. Arreglar un bug ahi lo
  arregla para los dos.
```

---

## 8. Modelo de datos

**Ninguna tabla nueva, ninguna migracion.** Esta fase es la primera del
proyecto en no necesitar una. Toda la escritura pasa por `orders`,
`order_items` y `payments`, exactamente como las dejaron las Fases 13 y 14.

Una consulta nueva, no una tabla: `listProductsWithVariants` (en
`catalog/server/queries.ts`, junto a `listProducts` y `listPublicProducts`,
Fase 11) trae `products` con `product_variants` en un solo embed, filtrado a
`status = 'active'`.

---

## 9. Diagrama de relaciones

```text
                    createOrderForPos            recordPaymentAction
                    (mismo insertOrder            (sin cambios,
POS (client) ─────► que createOrderAction) ─────► Fase 14)
                    de orders/server/actions.ts

listProductsWithVariants ──► products + product_variants (Fase 11, solo select)
searchCustomersForPos    ──► listCustomers (Fase 12, solo select)
listOpenSessionsForLocation, listPaymentMethods ──► Fase 14, solo select
```

No hay una tabla "carrito" ni "venta POS": el pedido no existe hasta que
`createOrderForPos` responde con éxito.

---

## 10. Tenant Isolation

```text
Tenant Isolation Impact: NONE (ninguna tabla ni politica nueva)
```

Toda lectura y escritura de esta fase pasa por funciones que ya resuelven el
tenant desde `requireActiveTenant` (Fase 01) y filtran por
`has_permission`/`tenant_id` en la capa que ya existia (`insertOrder`,
`recordPaymentAction`, `listCustomers`, `listProductsWithVariants`). Esta
fase no agrega ninguna via nueva de lectura o escritura a la base de datos —
solo nuevas formas de llamar a las que ya estaban probadas.

---

## 11. Seguridad

```text
Authorization requirements
  orders.create     construir y confirmar la venta
  payments.create   ver y usar la seccion de cobro
  customers.view    buscar un cliente para adjuntar (searchCustomersForPos)

Ningun permiso nuevo. Ninguna politica RLS nueva.

Potential abuse cases
  AB-1501  Cobrar mas de lo que un pedido debe, usando el POS en vez
           del formulario de pedidos, para ver si el limite era solo
           de ese formulario.
           Mitigado: el limite es de guard_payment() en la base de
           datos (Fase 14); createOrderForPos y recordPaymentAction
           pasan por el mismo trigger que cualquier otro llamador.
  AB-1502  Registrar un pago en efectivo sin sesion abierta,
           inventando un cash_session_id.
           Mitigado: el selector solo ofrece sesiones reales,
           devueltas por listOpenSessionsForLocation con el mismo
           filtro que la pantalla de Caja; y aunque se falsificara,
           guard_payment() lo rechaza igual.
  AB-1503  Usar searchCustomersForPos para exfiltrar el libro de
           clientes completo con terminos de busqueda amplios.
           Mitigado: requiere customers.view, esta capado a 8
           resultados, y usa exactamente el mismo filtro escapado que
           /clientes ya usa (Fase 12) - no es una segunda superficie.
```

### La decisión de seguridad: el vuelto nunca llega a la base de datos

Un cajero puede escribir "S/ 50" para un pedido que debe S/ 23. El monto que
`recordPaymentAction` recibe no es 50: el POS lo acota a 23 antes de construir
el `FormData`, y calcula el vuelto (27) como un numero puramente de pantalla.
No existe una columna de "vuelto" en `payments` ni la necesita — inventar una
habria significado que la Fase 14 tuviera que modelar algo que nunca es un
hecho financiero del negocio, solo una operacion aritmetica de la caja en ese
instante.

---

## 12. API / Server Actions

```text
createOrderForPos(formData) -> PosOrderResult
  Permission: orders.create
  Mismo insertOrder que createOrderAction (Fase 13).
  Llamado directamente, no via <form> (ADR-019).
  Devuelve { status, orderId?, orderNumber?, message?, fieldErrors? } -
  una forma nueva porque FormState no lleva id y no debe llevarlo.

searchCustomersForPos(tenantSlug, term) -> Customer[]
  Permission: customers.view
  Envoltorio sobre listCustomers (Fase 12). Maximo 8 resultados.
```

Sin cambios en `recordPaymentAction` (Fase 14): el POS la llama con los
mismos campos que el formulario de pagos del detalle de pedido ya envia.

Consultas nuevas:

```text
listProductsWithVariants(tenantId) -> ProductWithVariants[]
  (en catalog/server/queries.ts, Fase 11)
```

---

## 13. UI / UX

```text
/dashboard/{slug}/pos
  Propósito     Vender rapido: buscar, armar carrito, cobrar, imprimir
  Layout        Grilla de productos a la izquierda, carrito y cobro a
                la derecha (una columna en pantallas angostas)
  Acciones      Buscar, filtrar por categoria, ajustar cantidad,
                elegir cliente, agregar pago(s), confirmar, imprimir
  Permissions   orders.create para la pantalla; payments.create para
                que aparezca la seccion de cobro
  Empty state   Sin productos que coincidan con la busqueda/categoria
```

Reutilizado desde `/dashboard/{slug}/pedidos/{orderId}`: la tarjeta "Recibo"
con el mismo componente y un boton "Imprimir".

---

## 14. Flujos principales

```text
Cajero
   ↓
Toca productos -> carrito (useState, en memoria, Fase 15)
   ↓
Elige cliente (opcional) -> searchCustomersForPos
   ↓
Agrega uno o mas pagos (opcional) -> tenders (useState, en memoria)
   ↓
Presiona "Cobrar" / "Crear pedido sin pago"
   ↓
createOrderForPos(formData)      -> mismo insertOrder de Fase 13
   ↓ (si tuvo exito)
recordPaymentAction × N tenders  -> mismo guard_payment() de Fase 14
   ↓
Recibo en pantalla, listo para imprimir
```

---

## 15. Manejo de errores

```text
Sin sesion de caja para efectivo    -> mensaje antes de llamar a la
                                        base (el selector no ofrece
                                        ninguna)
createOrderForPos falla             -> mensaje visible, ningun pago
                                        se intenta
Un tender individual falla          -> el pedido y los tenders
                                        anteriores YA EXISTEN; se
                                        muestra que ese pago
                                        especifico no se registro
                                        (ADR-019)
Carrito vacio                       -> el boton de confirmar esta
                                        deshabilitado
Sin permiso                         -> AuthorizationError, la misma
                                        que cualquier otra pantalla
```

---

## 16. Observabilidad

Ninguno nuevo. `order.created`, `payment.recorded` (y `payment.voided` si
aplica luego) ya se registran dentro de las funciones que el POS llama sin
modificarlas.

---

## 17. Testing Plan

### Unit

```text
TEST-1501  lineTotalCents redondea igual que el trigger de la Fase 13
           (round(precio*cantidad)).
TEST-1502  cartTotalCents suma todas las lineas; vacio da cero.
TEST-1503  addToCart incrementa cantidad si el producto+variante ya
           esta en el carrito; crea una linea nueva si la variante es
           distinta.
TEST-1504  setCartQuantity a cero o menos quita la linea.
TEST-1505  removeFromCart quita exactamente la linea pedida.
TEST-1506  tenderedTotalCents suma los tenders cargados.
TEST-1507  remainingBalanceCents nunca es negativo.
TEST-1508  changeDueCents calcula el vuelto y nunca es negativo para
           un pago insuficiente.
TEST-1509  La entrada "pos" de navegacion aparece con orders.create y
           es independiente de payments.create.
```

### Regression

```text
Ninguna prueba de base de datos ni de contrato de schema nueva: no
hay tabla, columna, enum ni permiso que verificar - confirmado
corriendo la suite completa despues de esta fase sin cambios en
schema.test.ts, schema-contract.test.ts, authorization-schema.test.ts
ni authorization.test.ts.
```

**Deliberadamente no probado con un test propio:** ningún archivo del
proyecto llama a una Server Action (`"use server"`) directamente — se
verificó `src/tests/integration/authorization-layer.test.ts` antes de
escribir esta fase, y confirma que la capa de autorización se prueba con un
cliente Supabase simulado, no la Server Action completa, porque esta última
depende del contexto de `cookies()` de Next.js, que ninguna prueba de este
proyecto simula. `createOrderForPos` y `searchCustomersForPos` quedan en la
misma categoría que `createOrderAction` y `recordPaymentAction` ya estaban:
verificados por `typecheck`/`lint`/`build` y por las pruebas de base de datos
que cubren lo que de verdad importa — los triggers que reciben la escritura,
sea cual sea el llamador.

---

## 18. Edge Cases

```text
Producto sin variantes                 Se agrega directo, cantidad 1.
Producto con variantes                 Pide elegir antes de agregar.
Tocar el mismo producto varias veces   Suma cantidad, no duplica linea.
Pago en efectivo mayor al saldo        Aplica el saldo, muestra vuelto.
Pago no efectivo mayor al saldo        Se acota al saldo; no hay
                                        concepto de vuelto en un
                                        rail que no es fisico.
Cero pagos agregados                   El pedido se crea igual, sin
                                        pagos (FR-1507).
Segundo tender falla tras el primero   El pedido y el primer pago
                                        quedan; se informa cual
                                        tender fallo (ADR-019).
Una sola sede activa                   Nunca se muestra el selector.
Ninguna sede activa                    La pantalla pide crear una
                                        antes de vender.
Recargar la pagina a mitad de venta    El carrito se pierde (KL-1501).
```

---

## 19. Performance considerations

```text
Queries    Catalogo y categorias: una consulta cada uno, al cargar la
           pagina. Clientes: una consulta por termino de busqueda,
           con 250ms de espera para no disparar una por tecla.

N+1        listProductsWithVariants trae variantes con un embed; cero
           consultas adicionales sin importar cuantos productos
           tenga el catalogo.

Escritura  createOrderForPos hace las mismas dos inserciones que
           createOrderAction. recordPaymentAction, una por tender -
           secuencial, no en paralelo, porque cada una depende del
           saldo que la anterior dejo.

Caching    Ninguno: son datos operativos que cambian por minuto,
           igual que en las Fases 13 y 14.
```

---

## 20. Migraciones

Ninguna. Primera fase del proyecto sin una.

---

## 21. Rollback

No hay esquema que revertir. Revertir esta fase es remover la ruta `/pos`,
sus componentes, `createOrderForPos`, `searchCustomersForPos` y
`listProductsWithVariants` — ningun dato queda en un estado que dependa de
que estas funciones existan, porque todo lo que escriben son filas de
`orders`/`order_items`/`payments` indistinguibles de las que el formulario
normal produce.

---

## 22. Definition of Done

- [x] `/pos` construye un pedido usando el mismo `insertOrder` que
      `createOrderAction` (Fase 13) - sin logica de pedidos duplicada
- [x] Cobro usa `recordPaymentAction` (Fase 14) sin modificarlo
- [x] El tope de pago y la regla de efectivo/sesion los sigue
      imponiendo la base de datos, no esta pantalla
- [x] Busqueda de productos y categorias, instantanea, en el cliente
- [x] Busqueda de clientes contra el libro real (Fase 12), opcional
- [x] Recibo imprimible, reutilizado como "Reimprimir" en el detalle
      de pedido existente
- [x] Selector de sede solo cuando hace falta
- [x] Cero tablas, cero migraciones, cero permisos nuevos
- [x] Unit tests del carrito y del calculo de vuelto PASS
- [x] Test de navegacion para la entrada nueva PASS
- [x] Suite completa (incluidas Fases 00-14) sigue en verde
- [x] Typecheck PASS
- [x] Lint PASS
- [x] Build PASS
- [x] SPEC actualizado

---

## 23. Implementation notes

### Por que `createOrderAction` se partió en dos

La señal de que el diseño estaba bien fue que partirlo no cambió nada visible
para `/pedidos`: `createOrderAction` sigue devolviendo exactamente el mismo
`FormState`, con el mismo comportamiento, porque toda su lógica real se movió
a una función interna (`insertOrder`) sin exportar. `createOrderForPos` es
la segunda llamadora de esa misma función, no una reimplementación. La prueba
de que esto es lo correcto y no una complicación innecesaria: si un bug
apareciera en la inserción de líneas, un solo cambio en `insertOrder` lo
arregla para las dos pantallas, no una y luego la otra si alguien se acuerda.

### El vuelto como la única cosa nueva que esta fase calcula

Todo lo demás en esta fase es orquestación de lo que ya existía. El único
cálculo genuinamente nuevo es `changeDueCents`, y la decisión que lo rodea
—que el monto aplicado a un pago se acota al saldo antes de construir el
`FormData`, y el excedente nunca se envía— es lo que mantiene esta fase
fiel a "no duplicar lógica de pedidos": no había que enseñarle a
`guard_payment()` (Fase 14) nada sobre vueltos, porque el vuelto nunca llega
a ser un dato que la base de datos necesite conocer.

### `listProductsWithVariants`: la única consulta nueva

Se consideró evitarla — reusar `listProducts` (sin variantes) y pedir
`getProductDetail` por producto al tocarlo. Se descartó apenas se escribió la
razón: eso reintroduce exactamente el N+1 que `getOrderDetail` (Fase 13) ya
evita con su propio embed. Una consulta con `product_variants` embebido,
puesta junto a `listProducts` y `listPublicProducts` en el mismo archivo, es
la misma forma que el módulo de catálogo ya usa para cada necesidad de
lectura distinta.

### Qué se verificó y qué no

Verificado: la aritmética del carrito y del vuelto, con casos de redondeo y
de pago insuficiente; que la entrada de navegación depende de
`orders.create` y no de `payments.create`; que ningún test de esquema,
contrato o autorización cambió de resultado; `npm run typecheck`, `npm run
lint`, `npm run build` y la suite completa (1269 tests, 14 nuevos de esta
fase) en verde.

No verificado: como en la Fase 14, esta sesión no tuvo Docker disponible
para levantar Supabase local, así que nadie ha tocado esta pantalla en un
navegador real ni en una tablet. La búsqueda de clientes, el flujo de cobro
completo contra una base de datos real, y la impresión efectiva desde un
navegador quedan sin ejercitar más allá de la lectura del código y la
verificación de tipos.

---

## 24. Known limitations

```text
KL-1501  El carrito vive en useState y no sobrevive un refresco de
         pagina ni se comparte entre pestañas. Ninguna fase lo pidio;
         aceptado con la misma reserva que KL-1305 (Fase 13) y
         KL-1404 (Fase 14) mostraron hacia sus propios huecos de UI.

KL-1502  Si el segundo o tercer tender de una venta dividida falla,
         la pantalla lo informa pero no ofrece un boton de "reintentar
         solo este pago" - el cajero tiene que ir al detalle del
         pedido (Fase 13/14) para completarlo.

KL-1503  El recibo no distingue variantes con el mismo nombre de
         producto pero precios distintos mas alla de mostrar el
         nombre de la variante en una linea aparte; no hay un
         subtotal por categoria.

KL-1504  La impresion depende enteramente de window.print() del
         navegador. No hay integracion con impresoras termicas
         (ESC/POS) ni acceso a hardware via WebUSB/WebSerial -
         declinado deliberadamente, no una brecha a cerrar despues sin
         una razon nueva (ver ADR-013, misma logica).

KL-1505  El selector de cliente no permite crear uno nuevo sin salir
         de la pantalla. Es una decision de alcance (seccion 3), no
         un olvido.

KL-1506  No hay atajo de teclado para buscar, cobrar ni confirmar -
         el foco es completamente touch/mouse. Master pide soporte
         touch explicitamente; soporte de teclado no fue pedido y no
         se construyo.
```

---

## 25. Future considerations

```text
- KL-1501 se resolveria con el mismo tipo de mecanismo que
  cualquier borrador necesitaria; ninguna fase lo ha pedido todavia.
- La Fase 16 (KDS) leera los mismos pedidos que este POS crea -
  ninguna columna ni relacion nueva hace falta para eso, `source =
  'pos'` ya los distingue si algun reporte quisiera separarlos.
- Cuando la Fase 17 (SUNAT) exista, el recibo interno de esta fase
  seguira siendo lo que es - un documento interno - y el comprobante
  real sera una pantalla nueva, no una version "mejorada" de este
  recibo.
- El patron de llamar una Server Action directamente, sin <form>
  (ADR-019), queda precedentado para cualquier fase futura que
  necesite una pantalla en vivo sin recargas - la Fase 16 es la
  candidata mas cercana.
```
