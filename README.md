# CloverCode

Plataforma SaaS multi-tenant para administrar negocios: sitio web público,
catálogo, pedidos, punto de venta, inventario y facturación electrónica — desde
una sola codebase y una sola base de datos.

> **Estado: Fase 01 — Multi-Tenancy Core (COMPLETED).**
> Existen los cimientos técnicos y el núcleo multi-tenant: `tenants`,
> `tenant_domains` y resolución `hostname → tenant`. Todavía **no** hay
> autenticación, autorización por usuario ni módulos de negocio. Ver
> [`docs/specs/`](docs/specs/) para el plan por fases.

La especificación maestra del proyecto es
[`CLOVERCODE_MASTER.md`](CLOVERCODE_MASTER.md). Ante cualquier discrepancia, el
SPEC aprobado de la fase manda (sección 57).

---

## 1. Arquitectura

Monolito modular sobre Next.js (App Router) y Supabase, desplegado en Vercel.
**Una codebase, una base de datos PostgreSQL, muchos tenants**, aislados por
`tenant_id` + Row Level Security.

```text
src/
├── app/          rutas, layouts y route handlers
├── components/   UI compartida (ui/ = primitivas del sistema de diseño)
├── modules/      dominios de negocio (vacío hasta Fase 04)
├── lib/          capas transversales
│   ├── errors/       jerarquía de errores + frontera de serialización
│   ├── logger/       logging estructurado + redacción + requestId
│   ├── validation/   Zod en el límite de entrada
│   ├── supabase/     clientes browser y server
│   ├── tenant/       resolución hostname → tenant
│   └── utils/        utilidades sin dominio (cn)
├── config/       entorno validado y constantes
├── types/        contratos de tipos (incluye database.ts)
└── tests/        unit / integration / components
```

Dirección de dependencias: `app -> modules -> lib -> config/types`.
`lib` nunca importa de `modules` ni de `app`.

Detalle: [`docs/architecture/overview.md`](docs/architecture/overview.md) ·
Decisiones: [`docs/adr/`](docs/adr/)

### Stack

| Capa       | Tecnología                           | Versión  |
| ---------- | ------------------------------------ | -------- |
| Framework  | Next.js (App Router, Turbopack)      | 16.3.2   |
| UI         | React                                | 19.2.8   |
| Lenguaje   | TypeScript (estricto reforzado)      | ^5.9.3   |
| Estilos    | Tailwind CSS                         | ^4.3.3   |
| Datos      | Supabase (PostgreSQL, Auth, Storage) | ^2.112.4 |
| Validación | Zod                                  | ^4.4.3   |
| Testing    | Vitest + Testing Library             | ^4.1.11  |
| Hosting    | Vercel                               | —        |

Las versiones no siguen `latest` a ciegas: ver
[ADR-002](docs/adr/002-toolchain-version-pinning.md).

---

## 2. Setup

Requisitos: **Node >= 20.9.0** y npm.

```bash
git clone <repo>
cd saas_clover_code
cp .env.example .env.local     # rellenar valores reales
npm install
npm run dev                    # http://localhost:3000
```

### Scripts

| Script                  | Qué hace                        |
| ----------------------- | ------------------------------- |
| `npm run dev`           | Servidor de desarrollo          |
| `npm run build`         | Build de producción             |
| `npm run start`         | Sirve el build de producción    |
| `npm run lint`          | ESLint (0 warnings permitidos)  |
| `npm run typecheck`     | `next typegen` + `tsc --noEmit` |
| `npm run test`          | Suite completa (Vitest)         |
| `npm run test:watch`    | Vitest en watch                 |
| `npm run test:coverage` | Cobertura                       |
| `npm run format`        | Prettier (escribe)              |
| `npm run format:check`  | Prettier (verifica)             |
| `npm run verify`        | lint + typecheck + test + build |

`npm run verify` es exactamente lo que ejecuta CI.

> Next.js 16 eliminó `next lint` y `next build` ya **no** ejecuta ESLint.
> `npm run lint` es lo único que aplica las reglas: no lo omitas.

---

## 3. Variables de entorno

Contrato completo en [`.env.example`](.env.example). Nunca se commitea un
archivo con credenciales reales: `.gitignore` ignora `.env*` salvo
`.env.example`.

| Variable                               | Requerida | Ámbito    | Descripción                                                |
| -------------------------------------- | --------- | --------- | ---------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`             | Sí        | navegador | URL del proyecto Supabase                                  |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Sí        | navegador | Publishable key (`sb_publishable_...`) o `anon` key        |
| `NEXT_PUBLIC_APP_URL`                  | No        | navegador | Origen canónico. Default `http://localhost:3000`           |
| `LOG_LEVEL`                            | No        | servidor  | `debug \| info \| warn \| error`                           |
| `DEV_TENANT_SLUG`                      | No        | servidor  | Tenant servido en `localhost` puro. Ignorado en producción |

Las dos primeras se exponen al navegador **a propósito**: en Supabase el control
de acceso lo da RLS, no el secreto de la clave. La clave `service_role` es otra
cosa y llega en la Fase 04, detrás de `server-only`.

La validación es **perezosa y memoizada**: `next build` funciona sin
credenciales, y una variable faltante falla en el primer uso indicando
exactamente qué claves fallaron —
[ADR-004](docs/adr/004-environment-validation.md).

---

## 4. Migraciones

Todo cambio de esquema es un archivo versionado en `supabase/migrations/`, que
se aplica en orden lexicográfico.

```bash
npm run db:start    # Supabase local (requiere Docker)
npm run db:reset    # reaplica todas las migraciones desde cero
npm run db:types    # regenera src/types/database.ts
```

Historial actual (Fase 01):

| Archivo                                       | Crea                                                |
| --------------------------------------------- | --------------------------------------------------- |
| `20260824120000_create_tenants.sql`           | `tenant_status`, `set_updated_at()`, `tenants`, RLS |
| `20260824120100_create_tenant_domains.sql`    | enums de dominio, `tenant_domains`, índices, RLS    |
| `20260824120200_create_tenant_resolution.sql` | `resolve_tenant_by_domain()` SECURITY DEFINER       |

Reglas (`CLOVERCODE_MASTER.md` §22):

- Una migración ya aplicada en producción **nunca** se edita: se crea otra.
- Cada migración documenta qué políticas RLS creó.
- Se ejecutan de forma idéntica en local, staging y producción.
- `src/types/database.ts` se mantiene sincronizado y un test de contrato lo
  verifica contra el esquema real.

Detalle: [`docs/architecture/database.md`](docs/architecture/database.md)

---

## 5. Testing

```bash
npm run test              # todo
npm run test -- --project node   # solo lógica
npm run test -- --project dom    # solo componentes
```

Dos proyectos de Vitest, porque el código de servidor debe demostrar que
funciona sin DOM:

| Proyecto | Entorno | Ubicación                                   |
| -------- | ------- | ------------------------------------------- |
| `node`   | node    | `src/tests/unit/`, `src/tests/integration/` |
| `dom`    | jsdom   | `src/tests/components/`                     |

Estado actual: **297 tests en 13 archivos, todos en verde**.

Pendiente por diseño y **obligatorio** en su fase:

- Políticas RLS por usuario con `tenant_members`. **Fase 03.** El aislamiento
  cross-tenant a nivel de base de datos ya se prueba desde la Fase 01 en
  `src/tests/database/isolation.test.ts` (TEST-140).
- E2E con Playwright — **Fase 05.**

Detalle: [ADR-005](docs/adr/005-testing-strategy.md)

---

## 6. Deployment

Objetivo: Vercel. Entornos previstos: `local`, `preview/staging`, `production`.

Estado real: **todavía no hay despliegue configurado.** La Fase 00 es local y
reversible con Git; no existe estado externo aprovisionado. La configuración de
entornos, dominios y release se define en las fases 09 y 28.

CI ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) ejecuta en cada push
y PR sobre `main`: `format:check`, `lint`, `typecheck`, `test` y `build`. El
build corre **sin** credenciales a propósito: si algún día las necesita, es una
regresión.

---

## 7. Tenant model

```text
Request → Host → normalizeHostname() → toLookupDomain() → resolve_tenant_by_domain() → tenant
```

- Cada tenant recibe `{slug}.clovercodeapp.com` y puede conectar dominios
  propios. **Un dominio pertenece a un solo tenant**, garantizado por
  `UNIQUE(domain)` en la base de datos.
- Solo resuelven los dominios con `verification_status = 'active'`: registrar un
  dominio no es poseerlo.
- Un tenant `suspended` **sí** resuelve, con su estado, para poder mostrar un
  aviso. Uno `archived` no resuelve.
- El slug es una etiqueta DNS válida y no puede ser un nombre reservado
  (`www`, `api`, `admin`, …). Ambas reglas las aplica la base de datos.
- Las restricciones de negocio serán tenant-aware: `UNIQUE(tenant_id, slug)`,
  nunca `UNIQUE(slug)`. Las dos excepciones globales deliberadas son
  `tenants.slug` y `tenant_domains.domain`.
- Un usuario podrá pertenecer a **varios** tenants con distinto rol (Fase 02/03):

  ```text
  auth.users → profiles → tenant_members → tenants + roles
  ```

- `SUPER_ADMIN` (CloverCode) **no** es lo mismo que `OWNER` (de un tenant).

Uso desde código de servidor:

```ts
import { getCurrentTenant, requireCurrentTenant } from "@/lib/tenant/context";
```

Nunca se acepta un `tenant_id` enviado por el cliente (§42), ni se vuelve a
parsear el hostname en cada sitio (§43).

### Desarrollo local

Abre `http://{slug}.localhost:3000` — funciona en Chrome y Firefox sin
configurar nada, y ejerce exactamente la misma consulta que producción. Para
herramientas que no pueden usar subdominios, `DEV_TENANT_SLUG` sirve un tenant
en `localhost` a secas. Ambos mecanismos se ignoran si `NODE_ENV=production`.

Decisiones: [ADR-001](docs/adr/001-single-database-multitenancy.md) ·
[ADR-006](docs/adr/006-tenant-resolution.md) ·
[`docs/architecture/multitenancy.md`](docs/architecture/multitenancy.md)

---

## 8. Security model

Dos niveles de defensa, siempre: **la aplicación resuelve y valida el tenant, y
la base de datos lo impone con RLS.** Nunca se confía solo en el frontend.

### Activo hoy

| Control                                | Dónde                                         |
| -------------------------------------- | --------------------------------------------- |
| Cabeceras de seguridad en toda ruta    | `next.config.ts`                              |
| `X-Powered-By` desactivado             | `next.config.ts`                              |
| Sin secretos en el repositorio         | `.gitignore` (`.env*` salvo `.env.example`)   |
| Sin fuga de detalle interno en errores | `src/lib/errors/http.ts` (`serializeError`)   |
| Sin credenciales en logs               | `src/lib/logger/redact.ts`                    |
| Validación de toda entrada con Zod     | `src/lib/validation/`                         |
| Módulos de servidor no bundleables     | `server-only` en `src/lib/supabase/server.ts` |
| `any` y `@ts-ignore` prohibidos        | `eslint.config.mjs`                           |

Cabeceras aplicadas: `Strict-Transport-Security`, `X-Content-Type-Options`,
`X-Frame-Options: DENY`, `Referrer-Policy`, `X-DNS-Prefetch-Control`,
`Permissions-Policy`.

### Pendiente, por fase

| Control                            | Fase    |
| ---------------------------------- | ------- |
| Autenticación (Supabase Auth SSR)  | 02      |
| RBAC + políticas RLS               | 03      |
| Cliente `service_role` protegido   | 04      |
| Políticas de Storage por tenant    | 06      |
| Content Security Policy con nonces | 25      |
| Rate limiting, CSRF, auditoría     | 24 / 25 |

### Reglas no negociables

- Nunca exponer `service_role` al navegador.
- Nunca confiar en un `tenant_id` enviado por el cliente sin verificar pertenencia.
- Nunca confiar en `user_metadata` para decisiones de autorización.
- Nunca crear políticas `using (true)` en tablas privadas.
- Ocultar un botón **no** es seguridad: el backend siempre valida.

---

## 9. Contribuir

1. Una fase a la vez. No se implementan funcionalidades de fases futuras.
2. El SPEC va **antes** del código y se actualiza al terminar (secciones 56-58).
3. Commits pequeños y semánticos:

   ```text
   feat(tenants): add tenant domain resolution
   fix(rls): prevent cross-tenant product access
   test(orders): add tenant isolation tests
   ```

4. Una fase no está terminada si `lint`, `typecheck`, `test` o `build` fallan, o
   si su SPEC quedó desactualizado.
