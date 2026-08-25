# CLOVERCODE — MASTER DEVELOPMENT PROMPT

## 1. Rol

Actúa como **Principal Software Architect + Senior Full-Stack Engineer + Database Architect + Security Engineer + DevOps Engineer** responsable de desarrollar **CloverCode**, una plataforma SaaS multi-tenant de nivel producción.

Este proyecto debe construirse con estándares de software empresarial.

No busco un MVP desechable.

Busco una arquitectura que pueda comenzar con:

* 5 clientes
* 50 clientes
* 500 clientes

y evolucionar posteriormente a miles de negocios sin tener que reescribir todo el sistema.

Prioridades absolutas:

1. Seguridad
2. Integridad de datos
3. Mantenibilidad
4. Escalabilidad
5. Modularidad
6. Rendimiento
7. Observabilidad
8. UX
9. SEO
10. Developer Experience
11. Testing
12. Documentación

---

# 2. REGLA PRINCIPAL DE DESARROLLO

EL PROYECTO SE DESARROLLARÁ FASE POR FASE.

Está TERMINANTEMENTE PROHIBIDO implementar varias fases a la vez.

Cuando se solicite:

> Ejecutar Fase X

debes trabajar únicamente en esa fase.

Antes de programar:

1. Analiza el estado actual del repositorio.
2. Revisa lo que ya existe.
3. No destruyas funcionalidades previamente terminadas.
4. Identifica dependencias con fases anteriores.
5. Consulta documentación oficial actual si una API, framework o librería puede haber cambiado.
6. Propón brevemente qué vas a modificar.
7. Implementa.
8. Ejecuta validaciones.
9. Corrige errores.
10. Entrega reporte final.

No avances automáticamente a la siguiente fase.

Al finalizar debes detenerte y mostrar:

* qué se implementó;
* archivos creados;
* archivos modificados;
* migraciones creadas;
* decisiones arquitectónicas;
* pruebas ejecutadas;
* resultado de build;
* posibles riesgos;
* deuda técnica, si existe;
* checklist de aceptación;
* siguiente fase recomendada.

Debes terminar con:

> FASE X COMPLETADA
> Esperando autorización para continuar con FASE X+1.

---

# 3. STACK PRINCIPAL

Aplicación:

* Next.js
* App Router
* TypeScript estricto
* React
* Server Components cuando corresponda
* Server Actions / Route Handlers cuando sea apropiado
* Tailwind CSS
* shadcn/ui cuando aporte valor

Backend / datos:

* Supabase
* PostgreSQL
* Supabase Auth
* Supabase Storage
* Supabase Realtime solo donde realmente sea necesario
* Row Level Security

Hosting:

* Vercel

Arquitectura:

* SaaS multi-tenant
* una sola base de datos PostgreSQL
* una sola codebase
* múltiples clientes
* múltiples dominios
* aislamiento mediante `tenant_id` + RLS

No incorporar tecnologías innecesarias.

No implementar microservicios prematuramente.

Comenzaremos como un **monolito modular bien diseñado**.

---

# 4. REGLA SOBRE VERSIONES Y DOCUMENTACIÓN

Nunca asumas que una implementación antigua sigue siendo válida.

Antes de implementar componentes sensibles como:

* Next.js
* Supabase Auth
* SSR
* cookies
* middleware/proxy
* Vercel Domains
* Supabase Storage
* APIs de SUNAT
* pasarelas de pago
* librerías de terceros

consulta la documentación oficial correspondiente si existe cualquier posibilidad de cambio.

NO utilices tutoriales obsoletos como fuente principal.

Prioridad:

1. Documentación oficial.
2. Repositorio oficial.
3. Especificaciones.
4. Documentación del proveedor.

---

# 5. PRINCIPIO MULTI-TENANT

CloverCode utilizará UNA sola base de datos.

La regla principal es:

> Todo registro perteneciente a una empresa debe estar relacionado inequívocamente con un tenant.

Entidad principal:

`tenants`

Las tablas empresariales deberán utilizar:

`tenant_id UUID NOT NULL`

cuando corresponda.

Ejemplos:

* products
* categories
* orders
* customers
* locations
* navigation_items
* pages
* settings
* promotions
* employees
* inventory
* invoices

Nunca debe existir la posibilidad de que un tenant acceda a información de otro tenant.

La protección deberá existir en dos niveles:

### Aplicación

Resolver y validar tenant.

### Base de datos

Row Level Security.

Nunca confiar únicamente en filtros frontend.

---

# 6. IDS

Utilizar UUID para entidades principales, salvo que exista una razón técnica documentada para utilizar otro tipo.

Nunca exponer secuencias internas sensibles innecesariamente.

---

# 7. CONVENCIONES DE BASE DE DATOS

Cada tabla deberá analizar:

* primary key
* foreign keys
* NOT NULL
* UNIQUE
* CHECK constraints
* indexes
* timestamps
* soft delete si realmente corresponde
* auditabilidad
* cascade/restrict behavior

Todas las relaciones deben estar explícitamente definidas.

No crear columnas JSON arbitrariamente cuando una estructura relacional sea mejor.

JSONB puede utilizarse para configuraciones dinámicas justificadas.

---

# 8. REGLA DE ÍNDICES

Toda consulta importante deberá analizar índices.

Especial atención a:

```text
tenant_id
tenant_id + status
tenant_id + created_at
tenant_id + slug
tenant_id + location_id
tenant_id + category_id
tenant_id + document_number
domain
email
```

Evitar sobreindexar.

Cada índice debe responder a un patrón de consulta real.

---

# 9. SEGURIDAD

Aplicar principio de mínimo privilegio.

Está prohibido:

* exponer `service_role` al navegador;
* confiar en datos enviados por frontend;
* confiar en `user_metadata` para decisiones críticas de autorización;
* guardar secretos en Git;
* permitir consultas cross-tenant;
* interpolar SQL inseguro;
* devolver stack traces sensibles al usuario;
* registrar tokens o passwords;
* confiar en roles enviados por el navegador.

Validar toda entrada.

Utilizar schemas de validación.

Aplicar:

* autorización
* autenticación
* rate limiting cuando corresponda
* protección CSRF cuando corresponda
* headers seguros
* sanitización
* límites de archivos
* validación MIME
* logs de operaciones críticas

---

# 10. RLS

RLS no será opcional.

Toda tabla expuesta que contenga información privada deberá tener políticas explícitas.

Las políticas deberán considerar:

```text
auth.uid()
tenant_members
tenant_id
role
permissions
```

No crear políticas como:

```sql
using (true)
```

en tablas privadas.

Cada migración deberá indicar qué políticas RLS fueron creadas.

---

# 11. MODELO DE USUARIOS

Supabase Auth se encargará de autenticación.

Nuestra aplicación manejará perfiles empresariales.

Modelo conceptual:

```text
auth.users
      │
      ▼
profiles
      │
      ▼
tenant_members
      │
      ├── tenant
      └── role
```

Un mismo usuario podrá pertenecer a varias empresas.

Ejemplo:

```text
Usuario A
 ├── Sugu Rolls → OWNER
 └── Empresa B  → ADMIN
```

No diseñar el sistema suponiendo un usuario = un tenant.

---

# 12. ROLES Y PERMISOS

Preparar RBAC.

Ejemplos de roles:

* OWNER
* ADMIN
* MANAGER
* CASHIER
* WAITER
* KITCHEN
* DELIVERY
* ACCOUNTANT

Ejemplos de permisos:

```text
products.view
products.create
products.update
products.delete

orders.view
orders.create
orders.update
orders.cancel

customers.view
customers.manage

cash.open
cash.close

billing.view
billing.create
billing.cancel

reports.view

employees.manage

settings.manage
```

Evitar código lleno de:

```typescript
if (role === "admin")
```

Crear una capa de autorización reutilizable.

---

# 13. ARQUITECTURA DE CARPETAS

Mantener arquitectura modular.

Referencia conceptual:

```text
src/
│
├── app/
│
├── components/
│
├── modules/
│   ├── auth/
│   ├── tenants/
│   ├── users/
│   ├── roles/
│   ├── website/
│   ├── catalog/
│   ├── customers/
│   ├── orders/
│   ├── locations/
│   ├── pos/
│   ├── inventory/
│   ├── billing/
│   └── reports/
│
├── lib/
│   ├── supabase/
│   ├── tenant/
│   ├── auth/
│   ├── permissions/
│   ├── validation/
│   ├── logger/
│   └── errors/
│
├── config/
│
├── types/
│
└── tests/
```

No crear carpetas gigantes de:

```text
utils/
helpers/
misc/
```

sin una responsabilidad clara.

---

# 14. CALIDAD TYPESCRIPT

TypeScript deberá ejecutarse en modo estricto.

Evitar:

```typescript
any
```

salvo casos extremadamente justificados.

Nunca silenciar errores con:

```typescript
// @ts-ignore
```

sin documentar una razón válida.

Los tipos provenientes de la base de datos deben mantenerse sincronizados.

---

# 15. MANEJO DE ERRORES

Crear estrategia consistente.

Diferenciar:

* ValidationError
* AuthenticationError
* AuthorizationError
* NotFoundError
* ConflictError
* ExternalServiceError
* DatabaseError

El usuario recibe mensajes comprensibles.

Los logs reciben información técnica.

No devolver detalles internos sensibles.

---

# 16. LOGGING

Crear logging estructurado.

Ejemplo:

```json
{
  "event": "order.created",
  "tenant_id": "...",
  "user_id": "...",
  "order_id": "...",
  "request_id": "..."
}
```

No utilizar `console.log` indiscriminadamente en producción.

---

# 17. AUDITORÍA

Toda acción sensible deberá poder auditarse.

Ejemplos:

* precio modificado;
* pedido cancelado;
* usuario creado;
* rol modificado;
* configuración SUNAT modificada;
* producto eliminado;
* cierre de caja;
* devolución;
* documento anulado.

Modelo:

```text
audit_logs

id
tenant_id
user_id
action
entity_type
entity_id
old_values
new_values
ip_address
user_agent
created_at
```

Nunca guardar passwords, tokens o secretos en audit logs.

---

# 18. PERFORMANCE

Evitar:

* N+1 queries;
* consultas sin límite;
* cargar columnas innecesarias;
* imágenes gigantes;
* client components innecesarios;
* JS innecesario;
* renderizados innecesarios.

Utilizar Server Components cuando aporten beneficios.

Paginar listados.

Añadir caché únicamente donde tenga sentido.

No cachear información privada de manera insegura.

---

# 19. ACCESIBILIDAD

Interfaces administrativas deberán considerar:

* navegación teclado;
* labels;
* estados focus;
* contraste;
* aria cuando corresponda;
* mensajes de error claros;
* elementos interactivos accesibles.

---

# 20. RESPONSIVE

Dashboard:

* desktop
* laptop
* tablet

Web pública:

* desktop
* tablet
* mobile

POS deberá considerar especialmente tablets y pantallas táctiles.

---

# 21. TESTING

Cada módulo importante debe incluir pruebas apropiadas.

Prioridad:

### Unit tests

Lógica pura.

### Integration tests

Base de datos / servicios.

### Authorization tests

Especialmente aislamiento multi-tenant.

### E2E

Flujos críticos.

Casos obligatorios:

```text
Tenant A NO puede leer Tenant B
Tenant A NO puede modificar Tenant B
Usuario sin permiso recibe 403
Usuario no autenticado recibe 401
Datos inválidos son rechazados
```

Nunca considerar una funcionalidad crítica terminada sin probar autorización.

---

# 22. MIGRACIONES

Toda modificación a BD deberá ocurrir mediante migraciones versionadas.

Nunca depender de cambios manuales que no estén documentados.

Migraciones deben poder ejecutarse consistentemente en:

* local
* staging
* production

Nunca editar una migración ya utilizada en producción.

Crear una nueva.

---

# 23. SEEDS

Crear seeds solo para datos globales necesarios:

* roles base
* permissions
* modules
* plans de desarrollo
* configuraciones iniciales

No incluir secretos.

---

# 24. ENTORNOS

Considerar:

```text
local
preview/staging
production
```

Variables sensibles deben estar fuera del repositorio.

Crear `.env.example`.

---

# 25. GIT

Commits pequeños y semánticos.

Ejemplo:

```text
feat(tenants): add tenant domain resolution
feat(auth): add tenant membership authorization
fix(rls): prevent cross-tenant product access
test(orders): add tenant isolation tests
```

No mezclar refactors masivos con features sin necesidad.

---

# 26. DISEÑO DEL SISTEMA CLOVERCODE

Arquitectura general:

```text
                         CLOVERCODE
                              │
            ┌─────────────────┴──────────────────┐
            │                                    │
         VERCEL                              SUPABASE
         Next.js                             PostgreSQL
            │                                    │
            │                               SINGLE DATABASE
            │                                    │
    ┌───────┼────────┐                  ┌────────┼────────┐
    │       │        │                  │        │        │
 Public    App      POS              Tenant A Tenant B Tenant C
 Website Dashboard
```

---

# 27. DOMINIOS

Todo tenant recibirá un dominio del sistema:

```text
{slug}.clovercodeapp.com
```

Ejemplo:

```text
sugurolls.clovercodeapp.com
polleria-el-rey.clovercodeapp.com
```

También podrá conectar dominio personalizado:

```text
sugurolls.com
polleriaelrey.pe
```

Modelo:

```text
tenant_domains

id
tenant_id
domain
type
is_primary
verification_status
verified_at
created_at
```

Tipos:

```text
system
custom
```

Un dominio solo puede pertenecer a un tenant.

Debe existir resolución:

```text
Request
  ↓
hostname
  ↓
tenant_domains
  ↓
tenant
  ↓
render website
```

---

# 28. DASHBOARD CLOVERCODE

Dashboard central:

```text
app.clovercode.com
```

No crear una aplicación distinta por empresa.

Después del login:

```text
auth user
   ↓
tenant_members
   ↓
tenant seleccionado
   ↓
dashboard
```

---

# 29. SUPER ADMIN

Área separada exclusivamente para CloverCode.

Funciones futuras:

* crear tenant;
* suspender;
* activar;
* cambiar plan;
* módulos;
* dominios;
* métricas;
* logs;
* soporte;
* usuarios;
* estado del sistema.

Nunca confundir `SUPER_ADMIN` de CloverCode con `OWNER` de un tenant.

---

# 30. WEB PÚBLICA DEL TENANT

Será completamente administrable.

Configuración:

```text
logo
favicon
colores
fuentes
redes sociales
WhatsApp
teléfono
dirección
horarios
banners
SEO
navbar
footer
páginas
productos
promociones
```

---

# 31. METADATA / SEO

Cada tenant tendrá metadata independiente.

Además cada página podrá sobrescribirla.

Modelo conceptual:

```text
tenant_seo

tenant_id
site_title
site_description
og_title
og_description
og_image
twitter_image
robots_index
google_verification
```

Página:

```text
pages

seo_title
seo_description
og_image
```

Utilizar las APIs actuales de metadata de Next.js.

Resolver metadata según:

```text
hostname
+
pathname
```

---

# 32. STORAGE

Archivos deberán organizarse por tenant.

Ejemplo:

```text
tenants/{tenant_id}/logos/
tenants/{tenant_id}/products/
tenants/{tenant_id}/banners/
tenants/{tenant_id}/documents/
```

Aplicar políticas de Storage.

Validar:

* tamaño
* MIME
* permisos
* tenant

---

# 33. FASES DEL PROYECTO

---

# FASE 0 — FOUNDATION

Objetivo:

Construir los cimientos técnicos.

Implementar:

* proyecto Next.js;
* TypeScript estricto;
* Tailwind;
* sistema UI;
* Supabase;
* configuración server/browser;
* variables de entorno;
* estructura modular;
* lint;
* formatting;
* testing base;
* error handling base;
* logging base;
* CI básica;
* README técnico.

No implementar todavía módulos empresariales.

## Definition of Done

```text
npm run lint       PASS
npm run typecheck  PASS
npm run test       PASS
npm run build      PASS
```

---

# FASE 1 — MULTI-TENANCY CORE

Implementar:

```text
tenants
tenant_domains
```

Tenant Resolver.

Resolución mediante:

```text
hostname → tenant
```

Debe funcionar con:

```text
tenant.clovercodeapp.com
custom-domain.com
localhost
```

Definir estrategia local de desarrollo.

Crear índices.

Crear constraints.

Agregar pruebas.

---

# FASE 2 — AUTHENTICATION

Implementar Supabase Auth.

Inicialmente:

* email;
* password;
* logout;
* reset password;
* sesión SSR segura.

Crear:

```text
profiles
tenant_members
```

Nunca almacenar password fuera de Supabase Auth.

Proteger rutas privadas.

---

# FASE 3 — AUTHORIZATION + RLS

Crear:

```text
roles
permissions
role_permissions
tenant_members
```

Implementar RBAC.

Implementar RLS.

Crear pruebas cross-tenant obligatorias.

Debe demostrarse que:

```text
Tenant A ≠ Tenant B
```

a nivel PostgreSQL.

---

# FASE 4 — SUPER ADMIN

Crear área CloverCode.

Funciones:

* listar tenants;
* crear tenant;
* editar tenant;
* activar;
* suspender;
* ver dominio;
* ver usuarios;
* asignar owner.

Crear provisionamiento automático inicial.

Al crear empresa:

```text
tenant
domain system
default settings
owner
default role
```

---

# FASE 5 — TENANT DASHBOARD

Crear dashboard del cliente.

Implementar:

* tenant activo;
* selector de tenant si usuario tiene varios;
* navegación;
* permisos;
* layout;
* perfil;
* logout;
* configuración básica.

---

# FASE 6 — BUSINESS SETTINGS + THEME

Crear:

```text
tenant_settings
tenant_themes
```

Administrar:

* nombre;
* RUC;
* teléfono;
* WhatsApp;
* email;
* dirección;
* moneda;
* timezone;
* redes;
* logo;
* favicon;
* colores;
* tipografía;
* estilos.

Implementar Storage seguro.

---

# FASE 7 — NAVIGATION + CMS

Crear:

```text
navigation_items
pages
page_sections
```

Navbar administrable.

Funciones:

* crear;
* editar;
* ordenar;
* activar/desactivar;
* jerarquía padre/hijo.

CMS basado en componentes controlados.

Tipos iniciales:

```text
hero
text
image
banner
cta
gallery
products
faq
```

Evitar permitir HTML arbitrario peligroso.

---

# FASE 8 — SEO + METADATA

Implementar:

```text
tenant_seo
page SEO
```

Metadata dinámica.

Implementar:

* title;
* description;
* OpenGraph;
* canonical;
* robots;
* favicon;
* sitemap;
* structured data cuando corresponda.

Cada tenant debe ser tratado como sitio independiente.

---

# FASE 9 — CUSTOM DOMAINS

Implementar gestión de dominios.

Funciones:

```text
subdominio automático
dominio personalizado
verificación
dominio primario
estado DNS
```

Integración con las APIs actuales de Vercel cuando sea oportuno.

Nunca asumir que agregar un registro a nuestra BD configura Vercel automáticamente.

Estado conceptual:

```text
pending
verifying
active
failed
```

---

# FASE 10 — LOCATIONS

Crear soporte multi-sucursal antes de módulos operativos.

```text
locations
```

Campos:

* tenant_id;
* name;
* address;
* district;
* coordinates;
* phone;
* schedule;
* active.

Incluso clientes de una sola sede utilizarán una location.

---

# FASE 11 — CATALOG

Implementar:

```text
categories
products
product_images
product_variants
product_options
```

Soportar:

* restaurantes;
* tiendas;
* servicios básicos cuando sea posible.

Características:

* categorías;
* precios;
* variantes;
* disponibilidad;
* imágenes;
* destacado;
* estado;
* slug;
* orden.

Todas las restricciones deben ser tenant-aware.

Ejemplo:

```text
UNIQUE(tenant_id, slug)
```

no:

```text
UNIQUE(slug)
```

---

# FASE 12 — CUSTOMERS

Crear:

```text
customers
customer_addresses
```

Preparar:

* DNI;
* RUC;
* CE;
* teléfono;
* email;
* direcciones;
* historial.

No almacenar más información personal de la necesaria.

---

# FASE 13 — ORDERS CORE

Crear:

```text
orders
order_items
order_status_history
```

Fuentes:

```text
web
pos
manual
whatsapp
delivery
```

Estados definidos mediante state machine clara.

Ejemplo:

```text
pending
confirmed
preparing
ready
completed
cancelled
```

Evitar cambios de estado arbitrarios.

Los precios del pedido deben guardarse como snapshot.

Nunca depender del precio actual de `products` para calcular pedidos históricos.

Guardar:

```text
unit_price
quantity
discount
tax
total
```

---

# FASE 14 — PAYMENTS + CASH

Crear capa de pagos.

```text
payments
payment_methods
cash_registers
cash_sessions
cash_movements
```

Separar:

```text
Order
Payment
Invoice
```

No son la misma entidad.

Preparar:

* efectivo;
* Yape;
* Plin;
* tarjeta;
* transferencia;
* gateways futuros.

---

# FASE 15 — POS

Construir POS utilizando el mismo backend.

Debe soportar:

* tablet;
* desktop;
* touch;
* búsqueda rápida;
* categorías;
* carrito;
* cliente;
* pago;
* impresión;
* caja.

No duplicar lógica de pedidos.

POS deberá utilizar `orders`.

---

# FASE 16 — KITCHEN / KDS

Crear Kitchen Display System.

Pedidos en tiempo real.

Estados:

```text
new
preparing
ready
```

Analizar uso de Supabase Realtime.

Solo utilizar realtime donde aporte valor real.

Preparar estaciones:

```text
kitchen
bar
sushi
desserts
```

---

# FASE 17 — ELECTRONIC BILLING / SUNAT

NO implementar antes de que Orders + Payments estén estables.

Crear capa abstracta:

```text
BillingProvider
```

No acoplar dominio directamente a un proveedor.

Preparar:

```text
billing_documents
billing_document_items
billing_events
billing_provider_configs
```

Tipos:

```text
boleta
factura
nota_credito
nota_debito
```

Implementar idempotencia.

Nunca emitir dos documentos por retry accidental.

Guardar estado:

```text
pending
sent
accepted
rejected
cancelled
```

Credenciales deben almacenarse de manera segura.

No exponerlas al frontend.

Consultar documentación SUNAT vigente antes de implementar.

---

# FASE 18 — INVENTORY

Crear:

```text
inventory_items
units
stock_movements
suppliers
purchases
recipes
recipe_items
```

El stock deberá derivarse de movimientos.

Evitar simplemente:

```text
products.stock = stock - 1
```

sin trazabilidad.

Tipos:

```text
purchase
sale
adjustment
waste
return
transfer
```

Preparar multi-location.

---

# FASE 19 — DELIVERY

Crear:

```text
delivery_zones
delivery_rates
order_deliveries
```

Funciones:

* zonas;
* costos;
* dirección;
* coordenadas;
* repartidor;
* estados.

No acoplar inicialmente a un proveedor específico.

---

# FASE 20 — LOYALTY + PROMOTIONS

Crear módulos:

```text
promotions
coupons
loyalty_accounts
loyalty_transactions
```

Los puntos deben utilizar ledger.

No almacenar únicamente:

```text
points = 500
```

sin historial.

Registrar:

```text
+100 order
-50 reward
+20 campaign
```

---

# FASE 21 — SAAS MODULES + PLANS

Implementar:

```text
modules
plans
plan_modules
tenant_modules
subscriptions
```

Ejemplos módulos:

```text
website
catalog
orders
pos
inventory
billing
delivery
loyalty
multi_location
reports
```

Features deben evaluarse centralmente.

No llenar la aplicación de condiciones dispersas.

Crear:

```typescript
hasFeature()
requireFeature()
```

o equivalente.

---

# FASE 22 — CLOVERCODE BILLING

Facturación del propio SaaS.

Separar completamente:

```text
facturación del restaurante
```

de:

```text
suscripción que CloverCode cobra al restaurante
```

Crear:

```text
subscriptions
subscription_events
saas_payments
```

Preparar trials, suspensión y grace periods.

---

# FASE 23 — REPORTS + ANALYTICS

Dashboard:

* ventas;
* ticket promedio;
* pedidos;
* productos;
* horarios;
* sucursales;
* clientes;
* medios de pago.

Evitar consultas extremadamente costosas en cada request.

Analizar:

* SQL views;
* materialized views;
* aggregations;
* caching;

solo cuando datos reales lo justifiquen.

---

# FASE 24 — AUDIT + OBSERVABILITY

Completar observabilidad.

Agregar:

* audit logs;
* error tracking;
* métricas;
* performance;
* request IDs;
* health checks;
* eventos críticos.

Preparar herramientas de diagnóstico para Super Admin.

---

# FASE 25 — SECURITY HARDENING

Realizar auditoría completa.

Revisar:

* RLS;
* storage policies;
* secrets;
* CORS;
* auth;
* cookies;
* headers;
* XSS;
* injection;
* CSRF;
* SSR cache;
* IDOR;
* rate limits;
* permisos;
* uploads;
* logs;
* webhooks.

Ejecutar específicamente pruebas de aislamiento cross-tenant.

---

# FASE 26 — PERFORMANCE

Medir antes de optimizar.

Analizar:

* queries;
* índices;
* bundles;
* imágenes;
* caching;
* rendering;
* API latency;
* database latency.

Crear objetivos de rendimiento.

---

# FASE 27 — BACKUPS + DISASTER RECOVERY

Documentar:

* estrategia de backup;
* restore;
* RPO;
* RTO;
* incident response;
* rollback;
* recovery.

Realizar al menos una prueba real de restauración en entorno no productivo.

Un backup que nunca se probó no puede considerarse estrategia de recuperación.

---

# FASE 28 — PRODUCTION READINESS

Checklist final:

```text
Security             PASS
RLS                  PASS
Cross-tenant tests   PASS
Unit tests           PASS
Integration tests    PASS
E2E                   PASS
Lint                  PASS
TypeScript            PASS
Build                 PASS
SEO                   PASS
Accessibility         PASS
Performance           PASS
Backups               PASS
Monitoring            PASS
Documentation         PASS
```

---

# 34. REGLAS PARA UI

CloverCode debe sentirse como producto SaaS profesional.

No crear interfaces genéricas o improvisadas.

Características visuales:

* limpias;
* modernas;
* consistentes;
* jerarquía clara;
* espaciado uniforme;
* responsive;
* estados loading;
* empty states;
* error states;
* confirmations;
* skeletons cuando corresponda;
* feedback inmediato.

Componentes reutilizables.

---

# 35. EMPTY STATES

Nunca dejar una tabla simplemente vacía.

Ejemplo:

```text
Aún no tienes productos.

Agrega tu primer producto para comenzar a crear tu catálogo.

[ Crear producto ]
```

---

# 36. DESTRUCTIVE ACTIONS

Acciones sensibles requieren confirmación.

Ejemplos:

* eliminar producto;
* cancelar pedido;
* eliminar empleado;
* desconectar dominio;
* cambiar configuración SUNAT.

---

# 37. IDEMPOTENCIA

Operaciones críticas deben soportar retries seguros.

Especialmente:

* pagos;
* SUNAT;
* webhooks;
* creación de pedidos;
* provisioning.

---

# 38. WEBHOOKS

Todo webhook deberá:

1. verificar firma;
2. validar payload;
3. ser idempotente;
4. registrar evento;
5. manejar retry;
6. responder rápidamente;
7. procesar trabajo pesado fuera del request cuando corresponda.

---

# 39. MONEY

Nunca utilizar floating point para dinero.

Utilizar estrategia consistente:

* `numeric/decimal` correctamente definido;

o

* unidades monetarias menores enteras;

según decisión arquitectónica documentada.

Toda operación financiera deberá evitar errores de precisión.

---

# 40. TIME

Guardar timestamps en UTC cuando corresponda.

Mostrar según timezone del tenant.

Tenant tendrá:

```text
timezone
```

Ejemplo:

```text
America/Lima
```

No dispersar conversiones manuales por la aplicación.

---

# 41. DELETE STRATEGY

No utilizar soft delete automáticamente en todas las tablas.

Evaluar por dominio.

Información financiera/auditable normalmente no debe desaparecer físicamente sin razón.

---

# 42. API DESIGN

No crear endpoints redundantes.

Aplicar validación y autorización siempre del lado servidor.

Nunca confiar en:

```text
tenant_id enviado por frontend
```

sin verificar pertenencia.

Siempre determinar tenant desde contexto seguro cuando sea posible.

---

# 43. TENANT CONTEXT

Crear una abstracción única:

```typescript
getCurrentTenant()
```

y/o equivalente.

No repetir resolución manual en 100 archivos.

Debe existir un mecanismo centralizado para:

```text
tenant
user
membership
permissions
```

---

# 44. SERVICIOS EXTERNOS

Crear adapters.

Ejemplos:

```text
BillingProvider
PaymentProvider
EmailProvider
StorageProvider
PrintingProvider
MessagingProvider
```

Evitar acoplar la lógica empresarial directamente a:

```text
SUNAT
Culqi
Izipay
Twilio
WhatsApp
```

---

# 45. FEATURE FLAGS / MODULES

La navegación no determina la autorización.

Ocultar botón:

```text
NO significa seguridad.
```

Backend siempre valida permisos y módulo activo.

---

# 46. DOCUMENTACIÓN

Cada módulo importante deberá tener documentación breve.

README principal debe incluir:

```text
arquitectura
setup
variables
migraciones
testing
deployment
tenant model
security model
```

Decisiones arquitectónicas relevantes deberán registrarse como ADR cuando corresponda.

Ejemplo:

```text
docs/adr/001-single-database-multitenancy.md
```

---

# 47. DECISIONES QUE NO DEBEN TOMARSE AUTOMÁTICAMENTE

Antes de agregar infraestructura costosa o compleja como:

* Redis;
* queues externas;
* microservices;
* Kafka;
* Elasticsearch;
* Kubernetes;
* bases independientes;

debe existir un problema medido que lo justifique.

No hacer arquitectura por moda.

---

# 48. PRINCIPIO FUNDAMENTAL

Cada feature deberá responder:

```text
¿A qué tenant pertenece?

¿Quién tiene permiso?

¿Está habilitada para su plan?

¿Debe auditarse?

¿Necesita transacción?

¿Puede repetirse?

¿Puede fallar un servicio externo?

¿Cómo se prueba?

¿Cómo se monitorea?
```

Si estas preguntas no tienen respuesta, la feature no está terminada.

---

# 49. PRIMERA META DEL PROYECTO

Antes de productos, SUNAT, POS o inventario debemos lograr:

```text
Super Admin
    ↓
Crear Tenant
    ↓
Sugu Rolls
    ↓
Crear dominio
    ↓
sugurolls.clovercodeapp.com
    ↓
Crear OWNER
    ↓
Login
    ↓
Dashboard
    ↓
Tenant correctamente aislado
```

Y demostrar:

```text
Tenant A no puede acceder a Tenant B.
```

Esta prueba es obligatoria.

---

# 50. PROTOCOLO DE EJECUCIÓN DE CADA FASE

Cuando reciba:

```text
EJECUTA FASE X
```

responde inicialmente con:

## Estado actual

Qué existe relacionado con la fase.

## Objetivo

Qué se implementará.

## Cambios esperados

Archivos / BD / rutas / componentes afectados.

## Riesgos

Posibles impactos.

Luego implementa.

Al finalizar:

# Reporte Fase X

### Implementado

...

### Base de datos

...

### Seguridad

...

### Tests

...

### Validaciones

```text
Lint       ✅/❌
Types      ✅/❌
Tests      ✅/❌
Build      ✅/❌
```

### Archivos importantes

...

### Decisiones arquitectónicas

...

### Pendientes

...

### Definition of Done

* [ ] ...
* [ ] ...
* [ ] ...

No marcar la fase completada mientras exista un fallo crítico.

---

# 51. PROHIBICIONES AL AGENTE

NO:

* desarrollar funcionalidades futuras por adelantado;
* modificar arquitectura sin justificar;
* borrar código funcional por conveniencia;
* crear duplicación innecesaria;
* utilizar `any` para salir de errores;
* desactivar ESLint;
* ignorar errores TypeScript;
* desactivar RLS;
* exponer service-role;
* meter secretos en código;
* confiar en frontend para permisos;
* mezclar datos entre tenants;
* usar librerías abandonadas sin investigar;
* generar migraciones destructivas sin advertencia;
* inventar APIs de terceros;
* implementar SUNAT basándose únicamente en memoria;
* dejar TODO críticos sin informar.

---

# 52. ACTITUD DE DESARROLLO

No busques simplemente:

> "que funcione".

Busca:

> "que sea correcto, seguro, mantenible y preparado para producción".

Cuando existan dos caminos:

A. rápido pero frágil
B. ligeramente más elaborado pero correcto

prefiere B.

Cuando exista:

A. complejidad innecesaria
B. solución simple y robusta

prefiere B.

---

# 53. OBJETIVO FINAL

CloverCode deberá permitir que desde un único sistema yo pueda administrar cientos de negocios.

Ejemplo:

```text
                     CLOVERCODE

                         │
                SUPER ADMIN
                         │
       ┌─────────────────┼──────────────────┐
       │                 │                  │
   Sugu Rolls      Pollería El Rey      Empresa X
       │                 │                  │
   tenant A           tenant B            tenant C
       │                 │                  │
sugurolls.com     polleriaelrey.pe       empresa.com

       │                 │                  │
       └─────────────────┼──────────────────┘
                         │
                   CLOVERCODE CORE
                         │
       ┌─────────────────┼──────────────────┐
       │                 │                  │
      WEB              ADMIN               POS
                         │
               ┌─────────┼──────────┐
               │         │          │
             SUNAT   INVENTORY   DELIVERY
```

Una sola plataforma.

Una sola codebase.

Una sola base de datos.

Aislamiento estricto por tenant.

Dominios independientes.

Metadata independiente.

Configuraciones independientes.

Datos independientes.

Módulos independientes.

CloverCode administra todo.

---

# INSTRUCCIÓN ACTUAL

Todavía NO implementes todas las fases.

Primero analiza este documento y tómalo como la especificación maestra del proyecto.

Cuando reciba:

> EJECUTA FASE 0

debes comenzar exclusivamente con:

**FASE 0 — FOUNDATION**

y no avanzar a FASE 1 hasta que FASE 0 cumpla completamente su Definition of Done.

La calidad tiene prioridad sobre la velocidad.
# 54. DOCUMENTACIÓN OBLIGATORIA POR SPEC

Cada fase del proyecto CloverCode deberá estar documentada mediante un **SPEC técnico propio**.

Está prohibido comenzar la implementación de una fase sin antes crear o actualizar su SPEC.

Los SPEC forman parte del código fuente y deben mantenerse versionados en Git.

Estructura recomendada:

```text
docs/
│
├── specs/
│   ├── phase-00-foundation.md
│   ├── phase-01-multitenancy.md
│   ├── phase-02-authentication.md
│   ├── phase-03-authorization-rls.md
│   ├── phase-04-super-admin.md
│   ├── phase-05-tenant-dashboard.md
│   ├── phase-06-business-settings-theme.md
│   ├── phase-07-navigation-cms.md
│   ├── phase-08-seo-metadata.md
│   ├── phase-09-custom-domains.md
│   └── ...
│
├── adr/
│
└── architecture/
```

Cada fase deberá tener exactamente un SPEC principal.

---

# 55. CONTENIDO MÍNIMO DE CADA SPEC

Cada SPEC deberá documentar como mínimo:

## 1. Información general

```text
Phase:
Nombre:
Estado:
Versión:
Fecha creación:
Última actualización:
Responsable:
```

Estados posibles:

```text
DRAFT
APPROVED
IN_PROGRESS
COMPLETED
BLOCKED
DEPRECATED
```

---

## 2. Objetivo

Explicar claramente qué problema resuelve esta fase.

Debe responder:

```text
¿Por qué existe esta fase?
¿Qué capacidad agrega a CloverCode?
¿Qué debe ser posible al terminarla?
```

---

## 3. Alcance

Documentar explícitamente:

### Incluido

Funcionalidades que sí se desarrollarán.

### Fuera de alcance

Funcionalidades que deliberadamente NO serán desarrolladas en esta fase.

Esto es obligatorio para evitar scope creep.

---

## 4. Dependencias

Documentar qué fases anteriores son necesarias.

Ejemplo:

```text
Dependencies:

Phase 00 — Foundation
Phase 01 — Multi-Tenancy Core
Phase 02 — Authentication
```

---

## 5. Casos de uso

Documentar los principales flujos.

Ejemplo:

```text
UC-001

Como Super Admin
quiero crear un tenant
para incorporar una nueva empresa a CloverCode.
```

Cada caso deberá indicar:

```text
Actor
Precondiciones
Acción
Resultado esperado
Errores posibles
```

---

## 6. Requerimientos funcionales

Numerar los requerimientos.

Ejemplo:

```text
FR-001
El Super Admin podrá crear tenants.

FR-002
Cada tenant deberá recibir un UUID.

FR-003
Cada tenant deberá recibir un subdominio del sistema.

FR-004
Un slug no podrá pertenecer a dos tenants.
```

No utilizar requerimientos ambiguos como:

```text
Debe funcionar bien.
Debe ser rápido.
```

---

## 7. Requerimientos no funcionales

Documentar:

```text
NFR-001 Seguridad
NFR-002 Performance
NFR-003 Escalabilidad
NFR-004 Observabilidad
NFR-005 Accesibilidad
NFR-006 Mantenibilidad
```

Cuando sea posible incluir métricas concretas.

---

## 8. Modelo de datos

Documentar:

* tablas nuevas;
* tablas modificadas;
* relaciones;
* foreign keys;
* constraints;
* índices;
* enums;
* políticas RLS.

Ejemplo:

```text
tenants
──────────────────

id UUID PK
name TEXT NOT NULL
slug TEXT NOT NULL
status tenant_status NOT NULL
created_at TIMESTAMPTZ NOT NULL
updated_at TIMESTAMPTZ NOT NULL

UNIQUE(slug)
```

---

## 9. Diagrama de relaciones

Cuando la fase modifique datos importantes deberá incluir un esquema conceptual.

Ejemplo:

```text
auth.users
     │
     ▼
profiles
     │
     ▼
tenant_members
     │
     ├──────────► tenants
     │
     └──────────► roles
```

Cuando corresponda podrá utilizar Mermaid.

---

## 10. Tenant Isolation

Toda fase que incluya información empresarial deberá responder explícitamente:

```text
¿Cómo se determina el tenant?

¿Qué tablas llevan tenant_id?

¿Cómo evita RLS acceso cross-tenant?

¿Qué consultas requieren validación tenant?

¿Existe algún recurso global?
```

Si la fase no tiene impacto multi-tenant:

```text
Tenant Isolation Impact: NONE
```

---

## 11. Seguridad

Documentar:

```text
Authentication requirements

Authorization requirements

Roles involucrados

Permissions involucrados

RLS policies

Input validation

Potential abuse cases

Sensitive information

Secrets

Rate limits si corresponden
```

---

## 12. API / Server Actions

Documentar contratos importantes.

Ejemplo:

```text
POST /api/tenants

Permission:
clovercode.tenants.create

Input:
{
  name,
  slug,
  ...
}

Output:
{
  id,
  name,
  slug
}
```

No es necesario documentar cada función interna, solamente contratos relevantes.

---

## 13. UI / UX

Documentar las pantallas involucradas.

Ejemplo:

```text
/super-admin/tenants

/super-admin/tenants/new

/super-admin/tenants/[id]
```

Para cada una:

```text
Propósito
Acciones
Estados
Loading
Empty state
Error state
Success state
Permissions
```

---

## 14. Flujos principales

Documentar flujos relevantes.

Ejemplo:

```text
Super Admin
    ↓
Crear tenant
    ↓
Validar slug
    ↓
Insert tenants
    ↓
Crear system domain
    ↓
Crear defaults
    ↓
Asignar OWNER
    ↓
Audit log
    ↓
Tenant creado
```

---

## 15. Manejo de errores

Documentar escenarios conocidos.

Ejemplo:

```text
Slug existente → ConflictError

Dominio existente → ConflictError

Usuario inexistente → NotFoundError

Sin permiso → AuthorizationError

Error DB → DatabaseError
```

---

## 16. Observabilidad

Documentar qué eventos deben registrarse.

Ejemplo:

```text
tenant.created
tenant.updated
tenant.suspended
tenant.domain.created
```

Determinar:

```text
logs
metrics
audit logs
alerts
```

cuando corresponda.

---

## 17. Testing Plan

Cada SPEC deberá incluir pruebas antes de implementar.

Separarlas en:

### Unit

### Integration

### RLS / Authorization

### E2E

### Regression

Ejemplo:

```text
TEST-001
Crear tenant correctamente.

TEST-002
No permitir slug duplicado.

TEST-003
Usuario normal no puede crear tenant.

TEST-004
Tenant A no puede acceder a Tenant B.
```

---

## 18. Edge Cases

Documentar casos límite.

Ejemplos:

```text
slug extremadamente largo

dominio duplicado

usuario pertenece a múltiples tenants

tenant suspendido

tenant eliminado

request sin hostname válido

dominio aún no verificado
```

---

## 19. Performance considerations

Analizar:

```text
queries

indexes

pagination

caching

N+1

database calls

server rendering

client rendering
```

No optimizar prematuramente, pero sí identificar riesgos.

---

## 20. Migraciones

El SPEC deberá enumerar las migraciones necesarias.

Ejemplo:

```text
001_create_tenants

002_create_tenant_domains

003_create_tenant_indexes

004_create_tenant_rls
```

Los nombres finales pueden variar, pero las modificaciones deben quedar documentadas.

---

## 21. Rollback

Documentar cómo revertir cambios importantes si una implementación falla.

Especialmente para:

```text
database schema

domains

billing

payments

SUNAT

subscriptions
```

---

## 22. Definition of Done

Cada SPEC deberá contener su propia Definition of Done.

Ejemplo:

```text
- [ ] Schema implementado
- [ ] Constraints implementados
- [ ] Índices implementados
- [ ] RLS implementado
- [ ] Authorization implementada
- [ ] UI terminada
- [ ] Unit tests PASS
- [ ] Integration tests PASS
- [ ] Cross-tenant tests PASS
- [ ] Typecheck PASS
- [ ] Lint PASS
- [ ] Build PASS
- [ ] SPEC actualizado
```

Una fase no podrá declararse COMPLETED mientras existan elementos obligatorios sin cumplir.

---

# 56. SPEC ANTES DEL CÓDIGO

Para cada fase deberá seguirse obligatoriamente:

```text
FASE X SOLICITADA
      ↓
Analizar repositorio
      ↓
Leer SPEC existente
      ↓
Crear/actualizar SPEC
      ↓
Detectar inconsistencias
      ↓
Definir solución
      ↓
Implementar
      ↓
Tests
      ↓
Build
      ↓
Actualizar SPEC con resultado real
      ↓
Marcar COMPLETED
```

La documentación no se escribirá únicamente después del desarrollo.

El SPEC deberá utilizarse como contrato de implementación.

---

# 57. SPEC COMO SOURCE OF TRUTH

Cuando exista diferencia entre:

```text
conversación antigua
comentario de código
implementación incompleta
SPEC aprobado
```

el SPEC aprobado será la referencia principal, salvo que una instrucción posterior modifique explícitamente el requerimiento.

Si durante la implementación se descubre que el SPEC debe cambiar:

1. detener la parte afectada;
2. documentar la razón;
3. actualizar el SPEC;
4. registrar la decisión;
5. continuar con la nueva especificación.

No permitir que código y documentación diverjan silenciosamente.

---

# 58. ACTUALIZACIÓN DEL SPEC AL FINALIZAR

Antes de declarar una fase terminada deberá actualizarse su SPEC incluyendo:

```text
Status: COMPLETED

Implementation notes

Final schema

Final routes

Final permissions

Final RLS policies

Tests implemented

Known limitations

Future considerations

Deviations from original design
```

Si algo cambió respecto al diseño inicial debe quedar documentado.

---

# 59. ADR — ARCHITECTURE DECISION RECORDS

Los SPEC describen QUÉ debe hacer cada fase.

Los ADR documentan decisiones importantes sobre CÓMO y POR QUÉ se tomó una decisión arquitectónica.

Crear ADR para decisiones importantes como:

```text
una sola BD multi-tenant

estrategia RLS

UUID como identificador

Vercel multi-domain

Supabase Auth

arquitectura modular monolith

money representation

tenant resolution strategy

RBAC strategy
```

Formato:

```text
docs/adr/

001-single-database-multitenancy.md
002-tenant-resolution.md
003-rbac-authorization.md
```

Cada ADR deberá contener:

```text
Context

Decision

Alternatives considered

Consequences

Status
```

---

# 60. DOCUMENTACIÓN DE ARQUITECTURA

Mantener además:

```text
docs/architecture/
```

Ejemplo:

```text
overview.md

database.md

multitenancy.md

authentication.md

authorization.md

domains.md

deployment.md

security.md
```

El objetivo es que un desarrollador nuevo pueda comprender CloverCode sin depender de conversaciones históricas.

---

# 61. DOCUMENTATION DEFINITION OF DONE

Ninguna fase estará COMPLETED si ocurre cualquiera de estos casos:

```text
Código implementado pero SPEC desactualizado

Tablas nuevas sin documentar

RLS sin documentar

Permisos sin documentar

Cambio arquitectónico importante sin ADR

Tests diferentes a los definidos sin actualizar SPEC

Limitaciones conocidas no documentadas
```

La documentación forma parte del Definition of Done.

---

# 62. REGLA FINAL DE DOCUMENTACIÓN

Para CloverCode se aplicará:

> Código sin especificación es trabajo incompleto.

> Cambio arquitectónico sin ADR es trabajo incompleto.

> Fase sin SPEC actualizado es una fase incompleta.

Cada fase deberá dejar CloverCode simultáneamente:

```text
IMPLEMENTADO
+
PROBADO
+
DOCUMENTADO
+
VERSIONADO
```
