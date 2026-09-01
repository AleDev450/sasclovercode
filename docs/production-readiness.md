# Production readiness

`CLOVERCODE_MASTER.md` §33, Fase 28. Las quince líneas que pide, con su estado
**real**.

Un checklist cuyo autor marca `PASS` en algo que no comprobó es peor que no
tener checklist: convierte una duda en una afirmación falsa, y alguien despliega
confiando en ella. Aquí cada `PASS` cita cómo se comprueba, y lo que no está
comprobado dice `NO` o `PARCIAL`.

`src/tests/unit/production-checklist.test.ts` falla si este documento y el
repositorio dejan de coincidir.

---

## El checklist

| #   | Línea (§33)        | Estado      | Cómo se comprueba                                                                                                                                                |
| --- | ------------------ | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Security           | **PASS**    | Fase 25: CSP con nonce, rate limits en base de datos, barrido de aislamiento. `src/tests/unit/security-posture.test.ts`, `src/tests/database/rate-limit.test.ts` |
| 2   | RLS                | **PASS**    | 63 tablas con RLS, verificada tabla por tabla. `src/tests/database/isolation.test.ts`                                                                            |
| 3   | Cross-tenant tests | **PASS**    | Aislamiento ejecutado contra PostgreSQL real. `src/tests/database/cross-tenant.test.ts`, `src/tests/database/isolation.test.ts`                                  |
| 4   | Unit tests         | **PASS**    | `npm run test`, 46 archivos en `src/tests/unit/`                                                                                                                 |
| 5   | Integration tests  | **PASS**    | `npm run test`, `src/tests/integration/`                                                                                                                         |
| 6   | E2E                | **PARCIAL** | 6 pruebas reales ejecutadas con Playwright y Chromium (`npm run test:e2e`). Los flujos de negocio están escritos y **se saltan** sin Supabase. Ver abajo         |
| 7   | Lint               | **PASS**    | `npm run lint`, `--max-warnings=0`                                                                                                                               |
| 8   | TypeScript         | **PASS**    | `npm run typecheck`                                                                                                                                              |
| 9   | Build              | **PASS**    | `npm run build`                                                                                                                                                  |
| 10  | SEO                | **PASS**    | Fase 08: metadata por hostname, canonical, sitemap y robots por tenant. `src/tests/integration/seo-*.test.ts`                                                    |
| 11  | Accessibility      | **PARCIAL** | Fase 28: axe sobre primitivas y formularios, barrido de §19 en todo el repositorio. **El contraste no**: jsdom no calcula estilos. Ver abajo                     |
| 12  | Performance        | **PASS**    | Fase 26: presupuestos con test, planes de consulta medidos, cero consultas sin límite. `docs/performance-budgets.md`                                             |
| 13  | Backups            | **PARCIAL** | Fase 27: ensayo de restauración real en CI. **Falta verificar PITR** en el proyecto Supabase. `docs/disaster-recovery.md`                                        |
| 14  | Monitoring         | **PARCIAL** | Fases 24 y 25: auditoría, health checks, logging estructurado. **Sin proveedor de error tracking** contratado (ADR-028)                                          |
| 15  | Documentation      | **PASS**    | `docs/specs/` (29 SPECs), `docs/adr/` (32 ADRs), `docs/disaster-recovery.md`, `docs/performance-budgets.md`                                                      |

**11 PASS · 4 PARCIAL · 0 NO**

---

## Las cuatro que no son PASS, y qué falta exactamente

### 6 · E2E — PARCIAL

```text
Hecho      Arnés instalado y EJECUTADO: Playwright 1.62 + Chromium.
           6 pruebas reales pasando contra el servidor de producción:
           health, cabeceras de seguridad, 404, y un navegador de verdad.
Falta      Los flujos de negocio (login, dashboard, pedido, cobro) están
           escritos en e2e/stack.spec.ts y se saltan sin Supabase.
Para       supabase start  +  credenciales en .env.local
cerrarlo   npm run build && npm run test:e2e
Bloquea    Sí. Ningún flujo de negocio se ha ejecutado nunca de extremo a
           extremo, en ninguna fase.
```

### 11 · Accessibility — PARCIAL

```text
Hecho      21 pruebas con axe sobre las 10 primitivas y sobre formularios
           reales, con y sin errores. Barrido estático de §19 sobre 140
           componentes: labels, htmlFor, orden de tabulación, div clicables,
           anuncio de errores.
           Se encontraron y arreglaron dos defectos reales.
Falta      Contraste de color. jsdom no maquetá y no computa estilos, así que
           axe no puede evaluarlo. Se desactivó la regla explícitamente en vez
           de dejarla devolver cero y parecer un aprobado.
Para       La spec E2E de accesibilidad en un Chromium real ya está escrita;
cerrarlo   corre con el stack levantado.
Bloquea    No para desplegar. Sí para afirmar que se cumple §19 entero.
```

### 13 · Backups — PARCIAL

```text
Hecho      Ensayo de restauración real, en CI, en cada push. Encontró que
           restaurar con los triggers activos FALLA a media carga.
           Retención de audit_logs con suelo de 90 días.
Falta      Verificar que el proyecto Supabase tiene PITR. Sin PITR el RPO real
           es de 24 horas, no los 5 minutos declarados.
Para       Cinco minutos en el panel de Supabase.
cerrarlo
Bloquea    Sí. Es la comprobación más barata de esta lista y la que más duele
           si falta.
```

### 14 · Monitoring — PARCIAL

```text
Hecho      audit_logs con contexto de petición, /api/health con comprobación
           de dependencias, logging estructurado con redacción de secretos.
Falta      Un destino. Los logs van a stdout y nadie los mira; no hay Sentry
           ni equivalente contratado (ADR-028).
Para       Contratar uno. El sitio donde enchufarlo ya existe.
cerrarlo
Bloquea    No para el primer despliegue. Sí antes de tener clientes reales:
           un error que nadie ve es un error que nadie arregla.
```

---

## Antes del primer despliegue

Pasos que no puede hacer ningún test, en orden.

```text
1. Proyecto Supabase
   [ ] Crear el proyecto de producción
   [ ] Verificar que el plan incluye PITR  (checklist 13)
   [ ] supabase db push   — aplica las 95 migraciones
   [ ] Comprobar que RLS quedó activa:
         select relname from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
         where n.nspname='public' and c.relkind='r' and not c.relrowsecurity;
       Solo deben salir: roles, permissions, role_permissions, modules

2. Variables de entorno
   [ ] NEXT_PUBLIC_SUPABASE_URL
   [ ] NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
   [ ] NEXT_PUBLIC_APP_URL
   [ ] NO configurar ninguna service_role: este proyecto no usa ninguna
       (ADR-011, y las Fases 09 y 24 volvieron a declinarla)

3. Primer operador de plataforma
   [ ] Crear la cuenta por Supabase Auth
   [ ] Insertar su fila en platform_admins POR MIGRACIÓN o consola
       No hay política de escritura sobre esa tabla, y es a propósito:
       cierra el camino de que alguien con cuenta se dé autoridad a sí mismo

4. Dominios
   [ ] Apuntar *.clovercodeapp.com al hosting
   [ ] Registrar el dominio en el proveedor ANTES de marcarlo activo
       (Fase 09: insertar la fila no configura nada, ADR-013)

5. Después de desplegar
   [ ] /api/health responde 200, no degraded
   [ ] Crear un tenant de prueba y entrar
   [ ] Comprobar que su web pública resuelve por hostname
   [ ] Entrar con un segundo tenant y comprobar que no ve al primero
```

---

## Limitaciones conocidas que bloquean producción

De las ~195 KLs abiertas en 29 SPECs, estas son las que impiden decir que el
sistema está listo. El resto son decisiones diferidas a propósito, no olvidos.

```text
BLOQUEANTES

KL-2702  PITR sin verificar. RPO declarado de 5 min, real de 24 h sin él.
KL-2801  Ningún flujo de negocio ejecutado de extremo a extremo.
KL-2704  Nunca se ha probado contra Supabase real: todo el aislamiento se
         verifica en PGlite, que shimea auth y storage.

IMPORTANTES, NO BLOQUEANTES

KL-2701  Storage sin backup. Un restore devuelve rutas, no archivos.
KL-2501  Sin pentest ni escaneo de un entorno desplegado.
KL-2601  Latencia real de API y base de datos sin medir.
KL-2803  Contraste de color sin verificar.
Sin scheduler  La expiración de puntos y el ciclo de facturación existen y
               nadie los dispara (Fases 20 y 22).

NO BLOQUEANTES
  Todo lo demás: integraciones que esperan credenciales o contrato,
  funcionalidad diferida, y mejoras de UI anotadas fase a fase.
```

---

## Qué diría este documento si fuera honesto en una frase

El producto está construido, probado en profundidad contra PostgreSQL real, y
**nunca se ha ejecutado contra su propia infraestructura**. Lo que falta no es
código: es un proyecto Supabase, un despliegue, y ejecutar contra ellos las
pruebas que ya están escritas.
