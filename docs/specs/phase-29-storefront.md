# SPEC — Phase 29 — Tienda online (estructura de sitio de restaurante)

## 1. Información general

```text
Phase:                29
Nombre:               Tienda online
Estado:               IN_PROGRESS
Versión:              1.0.0
Fecha creación:       2026-09-16
Última actualización: 2026-09-16
Responsable:          alejandro.avendano@masuno.pe
```

Fases previas: 00 a 28.
Referencia funcional: el sitio de Sugu Rolls (`D:\Proyectos\web_sugurolls`), que
es la estructura que el negocio pidió para TODOS los temas.
ADR: [033 — Pedido web anónimo por función y token de seguimiento](../adr/033-anonymous-web-order-by-function-and-tracking-token.md).

---

## 2. Objetivo

### ¿Por qué existe esta fase?

Hasta la Fase 28 el sitio público de un negocio era un CMS de secciones: se
podía LEER, pero no se podía COMPRAR. Los tres temas (Atelier, Brasa, Marea)
cambiaban tipografía, ritmo y color de un sitio que no tenía carrito, ni
horario de atención, ni forma de que un cliente sin cuenta hiciera un pedido que
llegara al panel del dueño.

El dueño pidió, literalmente, que todos sus temas tengan la estructura de su web
de Sugu Rolls:

> inicio, nuestra carta, los más pedidos, logo — sin catering, sin juegos —,
> zonas de delivery, política de privacidad, política de cookies, términos y
> condiciones, libro de reclamaciones, botón de WhatsApp, sin usuarios con
> pedir ahora, horario de apertura y cierre, redes sociales, y que se pueda
> administrar desde la web del admin; en la página del dueño ver los pedidos.

Esta fase entrega la parte de COMPRA y la ESTRUCTURA. Las páginas legales y el
Libro de Reclamaciones son la Fase 30; los pagos online por pasarela son la
Fase 31.

### ¿Qué debe ser posible al terminarla?

1. Un visitante entra a la web de un restaurante, ve la portada (slider con
   imágenes subidas por el dueño, accesos, los más pedidos), abre la carta,
   filtra por categoría, elige variante y extras, y llena un carrito.
2. Con el carrito lleno pulsa **Pedir ahora**, escribe nombre y teléfono, elige
   delivery (por zona, con su costo) o recojo, y un método de pago de los que el
   dueño publicó (Yape, Plin, efectivo…). No necesita cuenta.
3. El pedido entra a `orders` con `source = 'web'`, aparece en **Pedidos** del
   panel (con aviso sonoro), y el cliente recibe una página de seguimiento con
   un enlace secreto y un botón de WhatsApp con el resumen.
4. Si la tienda está cerrada (horario de la sede, o cerrada a mano), la web lo
   dice y la BASE rechaza el pedido aunque alguien fuerce el formulario.
5. El dueño administra todo desde **Mi web → Tienda online**: pedidos web
   encendidos/apagados, modo de atención, aviso de cerrado, delivery/recojo,
   pedido mínimo, sede que recibe los pedidos, botón y mensaje de WhatsApp.

---

## 3. Alcance

### Incluido

- Tabla `tenant_storefronts` (una fila por negocio, creada al aprovisionar).
- `payment_methods.show_on_website`.
- Opciones (extras) en las líneas de pedido: `order_items.option_ids` y
  `order_items.options_snapshot`, con el precio sumado por la base.
- Tres tipos de sección nuevos: `slider`, `shortcuts`, `bestsellers`.
- Funciones públicas: `storefront_is_open`, `get_public_storefront`,
  `list_public_social_links`, `list_public_delivery_zones`,
  `list_public_bestsellers`, `list_public_payment_methods`, `place_web_order`,
  `get_public_web_order`.
- Tabla `web_orders` (datos de contacto y token de seguimiento del pedido web).
- Rutas públicas: `/sitio/carta`, `/sitio/pedir`, `/sitio/pedido/[token]`,
  `/sitio/zonas-de-delivery`.
- Nuevo marco del sitio (`SiteChrome`): header con logo, menú, estado
  abierto/cerrado y Pedir ahora; footer con redes, enlaces de ayuda y
  políticas, contacto, horario y caja del Libro de Reclamaciones; botón flotante
  de WhatsApp; carrito lateral.
- Panel: **Mi web → Tienda online**, marca "mostrar en la web" en métodos de
  pago, contacto web en el detalle del pedido, aviso de pedido nuevo.

### Fuera de alcance

- Cuentas de cliente, puntos y favoritos (el dueño pidió "sin usuarios").
- Catering y juegos (pedido explícito).
- Textos legales y Libro de Reclamaciones → Fase 30.
- Cobro con tarjeta por pasarela → Fase 31.
- Subida de comprobante de Yape por el cliente: un visitante anónimo con
  permiso de escritura en Storage es una superficie de abuso que no compensa;
  el comprobante se manda por el WhatsApp que la propia web abre.
- Mapa y autocompletado de direcciones (Google Maps): requiere una clave de
  pago por negocio.

---

## 4. Dependencias

- Fase 07/08 (CMS, SEO, `SiteChrome`), Fase 10 (sedes y horarios), Fase 11
  (catálogo), Fase 12 (clientes), Fase 13 (pedidos y snapshot), Fase 14
  (métodos de pago), Fase 19 (zonas y tarifas), Fase 21 (módulos), Fase 25
  (CSP, rate limits, barrido de aislamiento).

---

## 5. Casos de uso

| ID     | Actor     | Caso                                                                 |
| ------ | --------- | -------------------------------------------------------------------- |
| UC2901 | Visitante | Navega la carta, filtra por categoría y agrega productos con extras. |
| UC2902 | Visitante | Hace un pedido de recojo sin cuenta y paga con Yape al recoger.      |
| UC2903 | Visitante | Hace un pedido de delivery a una zona y ve el costo antes de enviar. |
| UC2904 | Visitante | Intenta pedir fuera de horario y la web le muestra el aviso.         |
| UC2905 | Visitante | Abre su enlace de seguimiento y ve el estado del pedido.             |
| UC2906 | Dueño     | Sube imágenes al slider de la portada y edita los accesos.           |
| UC2907 | Dueño     | Cierra la tienda a mano un feriado con un aviso propio.              |
| UC2908 | Dueño     | Recibe un aviso sonoro al entrar un pedido web y lo confirma.        |
| UC2909 | Dueño     | Decide qué métodos de pago se ofrecen en la web.                     |

---

## 6. Requerimientos funcionales

- **FR2901** Un pedido web se crea SOLO con `place_web_order`. No existe
  política de INSERT para `anon` en ninguna tabla.
- **FR2902** El precio de cada línea, de cada extra y del delivery lo calcula la
  base. El cliente solo envía ids y cantidades.
- **FR2903** `place_web_order` rechaza el pedido si el negocio no está activo,
  no tiene los módulos `website` y `orders`, tiene los pedidos web apagados, o
  la tienda está cerrada.
- **FR2904** El modo `auto` abre la tienda dentro de los turnos de la sede que
  recibe pedidos, comparados en la zona horaria del negocio. `open` y `closed`
  mandan sobre el horario. Una sede sin ningún turno cargado se considera
  abierta en `auto`: un negocio recién creado no debe nacer cerrado para
  siempre.
- **FR2905** El delivery exige el módulo `delivery`, una zona activa con tarifa
  y una dirección. Es gratis si el subtotal alcanza `min_order_free_cents`.
- **FR2906** El pedido mínimo (`min_order_cents`) se compara con el subtotal.
- **FR2907** El cliente se busca por teléfono dentro del negocio; si no existe
  se crea. El nombre y teléfono del pedido quedan copiados en `web_orders`.
- **FR2908** El seguimiento usa un token de 64 caracteres hexadecimales. En la
  base solo se guarda su SHA-256.
- **FR2909** "Los más pedidos" cuenta unidades vendidas en pedidos no
  cancelados de los últimos `bestsellers_days` días; si no hay ventas, cae a los
  productos destacados.
- **FR2910** Una sección `slider` sin diapositivas es válida y se pinta como la
  portada de marca (nombre, eslogan y botones), igual que Sugu Rolls cuando no
  hay imágenes subidas.

---

## 7. Requerimientos no funcionales

- **NFR2901** `place_web_order` es atómica: o se crea el pedido entero (orden,
  líneas, entrega, contacto) o nada.
- **NFR2902** Rate limit por IP en la acción del servidor: 6 pedidos cada 10
  minutos.
- **NFR2903** El carrito vive en `localStorage` con una clave por negocio y
  tolera que el almacenamiento no exista (modo privado).
- **NFR2904** Ningún valor guardado se interpreta como HTML ni como CSS
  (master §33 Fase 07, cabecera de `theme.ts`).

---

## 8. Modelo de datos

### Enum nuevo

`storefront_mode`: `auto`, `open`, `closed`.

### tenant_storefronts

| Columna           | Tipo            | Notas                                    |
| ----------------- | --------------- | ---------------------------------------- |
| tenant_id         | uuid PK/FK      | Singleton, como `tenant_settings`.       |
| ordering_enabled  | boolean         | Pedidos web encendidos. Default `true`.  |
| mode              | storefront_mode | Default `auto`.                          |
| closed_message    | text ≤ 300      | Aviso cuando está cerrada.               |
| accepts_delivery  | boolean         | Default `true`.                          |
| accepts_pickup    | boolean         | Default `true`. Al menos uno de los dos. |
| min_order_cents   | bigint          | 0..10^10.                                |
| order_location_id | uuid FK null    | Sede que recibe los pedidos web.         |
| whatsapp_button   | boolean         | Botón flotante. Default `true`.          |
| whatsapp_message  | text ≤ 300      | Saludo prellenado.                       |
| tagline           | text ≤ 200      | Eslogan de portada y pie.                |
| public_email      | text ≤ 200      | Correo que sí se publica.                |
| bestsellers_days  | smallint        | 7..365, default 30.                      |

### web_orders

| Columna           | Tipo         | Notas                                 |
| ----------------- | ------------ | ------------------------------------- |
| order_id          | uuid PK/FK   | Uno a uno con `orders`.               |
| tenant_id         | uuid FK      | Derivado del pedido por trigger.      |
| access_token_hash | text unique  | SHA-256 hex del token de seguimiento. |
| contact_name      | text 1..120  | Copia al momento del pedido.          |
| contact_phone     | text         | Normalizado, `^\+?[0-9]{6,20}$`.      |
| fulfillment       | text         | `delivery` o `pickup`.                |
| payment_method_id | uuid FK null | Método elegido en la web.             |
| customer_note     | text ≤ 300   |                                       |

### Columnas nuevas

- `payment_methods.show_on_website boolean not null default false`.
- `order_items.option_ids uuid[] not null default '{}'`.
- `order_items.options_snapshot text` (≤ 500), p. ej. `Salsa: Acevichada · Extra palta`.
- `section_type` suma `slider`, `shortcuts`, `bestsellers`.

---

## 10. Tenant Isolation

- `tenant_storefronts` y `web_orders` tienen `tenant_id` y RLS; entran solos al
  barrido de la Fase 25.
- Ninguna tabla nueva tiene política pública. Todo lo público sale por
  funciones `security definer` que filtran por `p_tenant_id` y exigen
  `is_tenant_public`.
- `place_web_order` recibe el tenant desde el servidor (resuelto por hostname),
  nunca desde el formulario, y valida que producto, variante, opción, zona,
  sede y método de pago sean de ese mismo negocio (además de los triggers de
  las Fases 13 y 19, que ya lo impiden).
- `get_public_web_order` exige tenant Y token: un token válido de otro negocio
  no devuelve nada.

---

## 11. Seguridad

- Precio nunca aceptado del cliente (AB-1301 de la Fase 13, extendido a extras).
- Token de seguimiento: 256 bits de `gen_random_uuid()` concatenados; solo el
  hash vive en la base.
- Rate limit por IP antes de llamar a la función.
- La tienda cerrada se decide con `now()` de la base, no con el reloj del
  navegador.
- Los enlaces de WhatsApp se construyen con `encodeURIComponent` y un número
  normalizado a dígitos.

---

## 12. API / Server Actions

- `placeWebOrderAction(formData)` — pública, sin sesión.
- `updateStorefrontAction(formData)` — `settings.manage`.
- `setPaymentMethodWebsiteAction(formData)` — `payment_methods.manage`.
- `applyStorefrontTemplateAction(formData)` — `content.manage`: crea la página
  `inicio` y el menú por defecto si no existen.

---

## 17. Testing Plan

- `src/tests/database/storefront.test.ts`: apertura por modo y horario,
  pedido de recojo, pedido de delivery con tarifa y envío gratis, extras con
  precio, rechazo por tienda cerrada / producto ajeno / módulo faltante /
  mínimo no alcanzado, token de seguimiento aislado por negocio.
- `src/tests/unit/storefront-cart.test.ts`: carrito puro.
- `src/tests/unit/cms-sections.test.ts`: esquemas nuevos.
- Barrido de aislamiento y contrato de tipos actualizados.

---

## 22. Definition of Done

- [ ] Migraciones aplicadas en PGlite y tests de base verdes.
- [ ] `npm run lint`, `npm run typecheck`, `npm run test`, `npm run build`.
- [ ] Pedido web de punta a punta visto en el panel.
- [ ] SPEC y ADR-033 actualizados.
