# ADR-034 — Pasarela elegida por la plataforma; pago confirmado solo por el proveedor

```text
Status: ACCEPTED
Date:   2026-09-18
Phase:  31 — Pagos online por plan
```

## Context

El dueño del producto fijó la regla comercial:

> El plan básico solo es Yape y Plin. El que le sigue escoge qué tipo de pago
> online quiere que le integremos — Culqi, Izipay o Mercado Pago — pero eso se
> modifica en el módulo de super admin.

Tres cosas se siguen de esa frase. La pasarela es un **módulo** de plan. La
elige y configura **la plataforma**, no el restaurante. Y cada restaurante cobra
en **su propia cuenta** del proveedor, así que CloverCode guarda credenciales
reales de terceros y **necesita leerlas** para cobrar. El ADR-021 pudo evitar
esto último (ninguna función devolvía el secreto); esta fase no.

## Decision

### 1. Módulo `online_payments` en Professional y Enterprise

Starter no lo incluye. Un override de `tenant_modules` puede darlo o quitarlo
por negocio, como cualquier módulo (ADR-025).

### 2. `tenant_payment_gateways`, escrita solo por la plataforma

Una fila por negocio: proveedor, modo (`test` / `live`), llave pública,
`credentials_secret_id` (Vault) y el `payment_method` bajo el que se registran
los cobros ("Pago online - Culqi"). Ninguna política de escritura:
`set_payment_gateway` y `clear_payment_gateway` exigen `is_platform_admin()`.
Un miembro puede ver qué pasarela tiene su negocio, pero no el secreto, que
tampoco está en la fila.

### 3. Un solo lector del secreto, y solo `service_role`

`get_payment_gateway_credentials` es la única función del esquema que devuelve
un secreto. Se revoca a `public`, `anon` y `authenticated` y se concede solo a
`service_role`: ni el dueño ni un operador de plataforma con sesión pueden
llamarla desde un navegador. El servidor la llama con `SUPABASE_SECRET_KEY` a
través de `lib/supabase/service.ts`, que un test restringe a un único
importador: `modules/online-payments/server/gateway.ts`.

### 4. El pago lo confirma el proveedor, nunca el navegador

`record_online_payment` también es solo `service_role`. Se llama después de:

- **Mercado Pago:** consultar `GET /v1/payments/{id}` con el token del negocio.
  La notificación solo indica qué consultar; la firma `x-signature` se valida
  además cuando hay clave de webhook.
- **Izipay:** verificar `kr-hash` del IPN con la **contraseña** de la tienda. Una
  firma de retorno del navegador (clave HMAC) no se acepta como IPN.
- **Culqi:** la respuesta del cargo creado por el servidor con la llave secreta.

Es idempotente (un pago aprobado dos veces es uno), va topado al saldo por el
trigger de la Fase 14, y si el pedido se canceló mientras se pagaba lo marca
para que una persona devuelva el dinero.

### 5. CSP abierta solo en la página de seguimiento

Culqi e Izipay capturan la tarjeta en **sus** iframes. `frame-src` admite sus
hosts exactos solo en `/sitio/pedido/{token}`; el resto del sitio mantiene
`frame-src 'none'`. Sus scripts se inyectan desde nuestro bundle con nonce y
entran por `'strict-dynamic'`, sin agregar hosts a `script-src`.

## Consequences

- Operar la plataforma exige `SUPABASE_SECRET_KEY` configurada. Sin ella, la web
  simplemente no ofrece pago online.
- **No verificado contra sandbox.** Los adaptadores siguen la documentación
  oficial vigente y tienen tests con respuestas simuladas, pero ningún cobro real
  ni de prueba pasó por ellos. Antes de activar un negocio en `live` hay que
  hacer un cobro de prueba con cada proveedor.
- 3-D Secure de Culqi no está implementado: se informa al cliente y se le ofrece
  otro medio.
