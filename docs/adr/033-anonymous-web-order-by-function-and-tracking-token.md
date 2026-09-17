# ADR-033 — Pedido web anónimo por función, y token de seguimiento

```text
Status: ACCEPTED
Date:   2026-09-16
Phase:  29 — Tienda online
```

## Context

El dueño pidió que la web de cada restaurante venda "sin usuarios, con pedir
ahora", y que esos pedidos aparezcan en su panel. Es la primera escritura de
CloverCode que puede provocar un visitante **anónimo**. Hasta la Fase 28 ninguna
tabla de negocio tenía una política de INSERT para `anon`, y el barrido de
aislamiento de la Fase 25 (ADR-029) lo verifica tabla por tabla.

Había tres formas de hacerlo:

1. **Política de INSERT para `anon`** en `orders`, `order_items`,
   `order_deliveries` y `customers`. Cuatro superficies, cada una validando por
   separado que el resto de la fila sea del mismo negocio; y un pedido a medio
   escribir si la tercera inserción falla.
2. **Server Action con la llave `service_role`.** Salta RLS entero: un bug en la
   acción escribe en cualquier negocio.
3. **Una función `security definer`** que recibe el tenant como argumento y el
   pedido como JSON, valida todo contra ese tenant y escribe en una sola
   transacción.

## Decision

### 1. `place_web_order(p_tenant_id, p_order)` es la única puerta

- Ninguna tabla gana una política para `anon`. El barrido de la Fase 25 sigue
  igual: la función aparece en su lista revisada, con su razón.
- El tenant lo pone el servidor desde el **hostname** (`getSiteContext`), nunca
  el formulario.
- El JSON trae ids y cantidades. Precio de la línea, de cada extra y del delivery
  los calculan los triggers de las Fases 13, 19 y 29: un pedido web es
  exactamente tan inmune a manipular el precio como uno del POS.
- Tienda abierta, pedidos web encendidos, módulos `orders` / `delivery`,
  producto activo y disponible, variante obligatoria, zona con tarifa y pedido
  mínimo se validan dentro de la misma transacción. Un rechazo no deja nada.
- Los rechazos se lanzan con un **código estable como mensaje**
  (`STORE_CLOSED`, `PRODUCT_UNAVAILABLE`…) que `modules/storefront/errors.ts`
  traduce. Cualquier otro mensaje se muestra como error genérico y se registra.

### 2. El seguimiento es un token, no una cuenta

La función devuelve un token de 64 hex (dos UUID v4, 244 bits aleatorios). En la
base solo se guarda su SHA-256 (`web_orders.access_token_hash`).
`get_public_web_order` exige tenant **y** token, y no devuelve dirección,
teléfono ni id de cliente: un enlace filtrado muestra lo mínimo.

### 3. Horario decidido por la base

`storefront_is_open` compara `now()` en la zona horaria del negocio con los
turnos de la sede que recibe pedidos. El reloj del navegador no participa. Una
sede sin ningún turno cargado se considera abierta en modo `auto`, para que un
negocio nuevo no nazca cerrado.

### 4. Los extras entran al snapshot

`order_items.option_ids` es la entrada y `options_snapshot` la copia legible.
El precio de los extras se suma en `snapshot_order_item`, igual que el de la
variante. Nada vuelve a leer el catálogo después.

## Consequences

- Rate limit por IP (`storefront.order`, 6 cada 10 minutos) antes de llamar a la
  función. Es la única defensa contra pedidos falsos masivos, además de que el
  dueño confirma cada pedido.
- La confirmación de pago de Yape/Plin sigue siendo manual (Fase 14). El cobro
  por pasarela es la Fase 31.
- El realtime del panel lee dos campos del payload (`source`, `number`) para
  sonar un aviso: la única excepción a "Realtime solo refresca" (ADR-020),
  documentada en `new-order-alert.tsx`.
