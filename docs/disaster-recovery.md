# Recuperación ante desastres

`CLOVERCODE_MASTER.md` §33, Fase 27. Documenta las siete cosas que pide —
estrategia de backup, restore, RPO, RTO, incident response, rollback, recovery —
y la línea que las gobierna:

> **Un backup que nunca se probó no puede considerarse estrategia de
> recuperación.**

La prueba existe y corre en cada push:
`src/tests/database/restore-drill.test.ts`.

---

## Lo primero, porque es lo que se descubrió al probar

**Restaurar esta base de datos con los triggers activos no degrada los datos:
falla.**

El esquema tiene 123 triggers. Uno de ellos, `create_tenant_defaults`, crea la
sede, los ajustes, el tema y la fila de SEO cuando se inserta un tenant. Durante
una restauración esas filas **ya vienen en el volcado**, así que el trigger
inventa una sede y la sede real choca después contra el índice único
`locations (tenant_id, lower(name))`.

```text
ERROR: duplicate key value violates unique constraint "locations_tenant_name_key"
```

La carga aborta a mitad, con parte de los datos dentro y parte fuera, durante un
incidente.

**Toda restauración se hace con los triggers desactivados:**

```sql
set session_replication_role = 'replica';
-- cargar
set session_replication_role = 'origin';
```

`pg_restore --disable-triggers` hace exactamente eso. Si se usa `pg_restore`, el
flag no es opcional.

Y lo que ese modo **no** desactiva: las políticas RLS. Comprobado en TEST-2712,
no supuesto — la seguridad del procedimiento entero depende de que sea verdad.

---

## Estrategia de backup

### Qué respalda quién

| Qué                | Mecanismo                        | Dueño      |
| ------------------ | -------------------------------- | ---------- |
| Datos (PostgreSQL) | Backups de Supabase + PITR       | Supabase   |
| Esquema            | `supabase/migrations/` en git    | CloverCode |
| Archivos de tenant | **Nada. Ver abajo**              | —          |
| Cuentas de usuario | Supabase Auth, junto a la base   | Supabase   |
| Secretos           | Variables de entorno del hosting | CloverCode |
| Código             | git                              | CloverCode |

### El esquema no se respalda: se reconstruye

§22 exige que todo cambio de base de datos vaya por migraciones versionadas, y
eso convierte el esquema en código. No hace falta un snapshot: se aplica
`supabase/migrations/` sobre una base vacía y sale el mismo esquema, siempre.

Comprobado en TEST-2701 y TEST-2702.

### Lo que el backup NO cubre

```text
Storage           Los archivos del bucket tenant-assets no entran en el backup
                  de la base. Un restore devuelve las RUTAS y no los archivos:
                  el catálogo tendría imágenes rotas. No hay mecanismo
                  equivalente contratado (KL-2701).

Secretos          Viven en el hosting, no en la base. Si se pierden, el proyecto
                  restaurado no arranca aunque los datos estén intactos.

Un solo tenant    No hay forma de restaurar una empresa sin restaurar todas.
                  Es una consecuencia de la decisión de ADR-001, una sola base
                  para todos, y el precio conocido de esa decisión.
```

---

## RPO y RTO

```text
RPO objetivo    5 minutos     Máximo de datos que se acepta perder
RTO objetivo    4 horas       Máximo hasta volver a dar servicio
```

### Qué hace falta para cumplirlos

**El RPO de 5 minutos exige PITR.** Un backup diario da un RPO de 24 horas: un
fallo a las 6 de la tarde pierde el día entero de pedidos de todos los negocios.
Para un sistema que emite comprobantes electrónicos eso no es aceptable — los
documentos ya están en SUNAT y dejarían de estar en CloverCode.

```text
Backup diario solamente   ->  RPO real = 24 h    NO cumple
PITR activo               ->  RPO real ≈ 2 min   cumple
```

**Acción pendiente y bloqueante para producción:** verificar que el proyecto
Supabase tiene PITR activo. En los planes sin PITR el RPO real es de 24 horas y
este documento estaría declarando algo falso (KL-2702).

**El RTO de 4 horas** asume: detectar (30 min) + decidir (30 min) + restaurar en
un proyecto nuevo (1-2 h según volumen) + verificar (30 min) + mover el tráfico
(30 min). No está medido con datos reales; es una estimación, y lo dice
(KL-2703).

---

## Runbook de recuperación

Pensado para seguirse a las 3 de la mañana. Los pasos van en orden y el orden
importa.

### 0. Antes de tocar nada

```text
[ ] Anotar la hora exacta en que empezó el problema
[ ] Anotar qué se sabe y qué se supone, por separado
[ ] Decidir si hace falta restaurar. Un restore es destructivo y lento;
    muchos incidentes se arreglan con el rollback de §Rollback
```

### 1. Confirmar el proyecto

```text
[ ] Escribir el identificador del proyecto Supabase y leerlo en voz alta
[ ] Confirmar que NO es el de staging
```

Restaurar staging sobre producción por confundir el proyecto es un error que se
comete con prisa y no tiene vuelta atrás.

### 2. Restaurar en un proyecto NUEVO

**Nunca sobre el proyecto roto.** Mientras se restaura en otro sitio, el
original sigue siendo evidencia: si la restauración sale mal, todavía queda algo
de donde sacar datos.

```text
[ ] Crear un proyecto Supabase nuevo
[ ] Aplicar las migraciones:  supabase db push
[ ] Verificar que el esquema está completo antes de cargar nada
```

### 3. Cargar los datos con los triggers apagados

```text
[ ] set session_replication_role = 'replica';
[ ] Cargar el volcado  (o pg_restore --disable-triggers)
[ ] set session_replication_role = 'origin';
```

Sin esto la carga falla. Ver la primera sección.

### 4. Verificar antes de abrir tráfico

```text
[ ] Conteos por tabla contra el origen, si se puede
[ ] RLS habilitada en todas las tablas:
      select relname from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname='public' and c.relkind='r' and not c.relrowsecurity;
    Solo deben salir: roles, permissions, role_permissions, modules
[ ] Entrar como un usuario de un tenant y comprobar que no ve otro
[ ] Comprobar que la resolución por hostname funciona
```

**Este paso no se salta.** Un restore que devuelve los datos y deja RLS
inefectiva devuelve los datos de todos a todos, y parecería un éxito.

### 5. Mover el tráfico

```text
[ ] Actualizar las variables de entorno al proyecto nuevo
[ ] Verificar los dominios de tenant (Fase 09) contra el proyecto nuevo
[ ] Desplegar
[ ] Comprobar /api/health
```

### 6. Después

```text
[ ] Post-mortem escrito: qué pasó, qué se hizo, qué faltó
[ ] Actualizar este documento con lo que resultó estar mal
```

---

## Incident response

### Severidades

```text
SEV-1  Fuga entre tenants, o pérdida de datos
       -> parar escrituras primero, investigar después
SEV-2  Servicio caído para todos
       -> runbook de recuperación
SEV-3  Un módulo caído, o un tenant afectado
       -> arreglar hacia adelante, no restaurar
SEV-4  Degradado
       -> horario normal
```

### La regla de la fuga entre tenants

Un SEV-1 de aislamiento **no se arregla restaurando**: los datos no se perdieron,
se mostraron a quien no debía. Restaurar borraría la evidencia de qué se expuso
y a quién.

```text
1. Cortar el acceso al camino afectado
2. Conservar audit_logs: es la única fuente de quién vio qué
3. Determinar el alcance antes de arreglar
4. Arreglar
5. Notificar según corresponda
```

`audit_logs` tiene retención de 365 días con un mínimo de 90 impuesto por la
función de purga, precisamente para que exista en este momento.

---

## Rollback

**Restaurar no es la primera respuesta.** En orden de preferencia:

```text
1. Revertir el despliegue     Minutos. El código anterior vuelve.
2. Revertir la migración      Cada SPEC tiene su §21 con el SQL de vuelta.
                              §22: nunca editar una migración ya usada;
                              se escribe una nueva.
3. Corregir hacia adelante    Un dato mal escrito se arregla con un UPDATE
                              acotado, no con un restore de todo.
4. Restaurar                  Solo cuando los datos se perdieron o se
                              corrompieron de forma amplia.
```

Cada opción es más lenta y más destructiva que la anterior. Bajar un escalón sin
haber descartado el anterior es lo que convierte un incidente de veinte minutos
en uno de cuatro horas.

---

## Secretos y su rotación

Cierra KL-2503, que ADR-029 dejó a esta fase.

### Inventario

| Secreto                                | Dónde vive                           | Si se filtra                                                                |
| -------------------------------------- | ------------------------------------ | --------------------------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`             | Entorno, y el navegador              | No es secreto; es público por diseño                                        |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Entorno, y el navegador              | No es secreto: sin sesión solo alcanza lo que RLS permita a `anon`          |
| `NEXT_PUBLIC_APP_URL`                  | Entorno, y el navegador              | No es secreto. Es la URL del propio producto                                |
| `LOG_LEVEL`                            | Entorno del servidor                 | No es secreto. Configuración de verbosidad                                  |
| `DEV_TENANT_SLUG`                      | Entorno local                        | No es secreto, y `toLookupDomain` lo ignora en producción (Fase 01, AB-105) |
| Credenciales de facturación por tenant | `billing_provider_configs`, cifradas | Rotar con el proveedor SUNAT; ADR-021                                       |
| Variables del hosting                  | Vercel                               | Rotar en Vercel y redesplegar                                               |

La tabla lista **todas** las variables de `.env.example`, incluidas las que no
son secretas, y un test lo comprueba. Un inventario que solo nombra lo peligroso
obliga a quien lo lee a decidir si una variable ausente es inofensiva o es un
olvido, que es exactamente la duda que un inventario existe para quitar.

**No hay `service_role` en este proyecto.** ADR-011 lo declinó y las Fases 09 y
24 volvieron a declinarlo. Es el secreto más peligroso que puede tener un
proyecto Supabase, y aquí no existe: nada que rotar, nada que filtrar.

### Procedimiento

```text
1. Generar el nuevo valor donde vive el secreto
2. Actualizarlo en el hosting
3. Redesplegar
4. Revocar el anterior
5. Anotar la fecha
```

El orden importa: revocar antes de desplegar deja el servicio caído entre los
dos pasos.

---

## Lo que esta fase probó, y lo que no

### Probado, en CI

```text
TEST-2701/2702  El esquema se reconstruye desde cero, igual siempre
TEST-2703/2704  El restore ingenuo falla, y falla como está documentado
TEST-2705/2709  El restore correcto devuelve los datos exactos
TEST-2708       Los valores que un trigger habría reescrito se conservan
TEST-2710/2712  RLS sigue en pie después, y replica no desactiva políticas
TEST-2713/2717  La purga de auditoría, con su suelo de 90 días
```

### No probado

```text
- Una restauración real desde un backup real de Supabase. Necesita el proyecto.
- El tiempo real de restauración: el RTO es una estimación (KL-2703).
- Recuperación de Storage: no hay mecanismo (KL-2701).
```
