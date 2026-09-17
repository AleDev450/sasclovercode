# SPEC — Phase 30 — Textos legales y Libro de Reclamaciones

## 1. Información general

```text
Phase:                30
Nombre:               Textos legales y Libro de Reclamaciones
Estado:               IN_PROGRESS
Versión:              1.0.0
Fecha creación:       2026-09-16
Última actualización: 2026-09-16
Responsable:          alejandro.avendano@masuno.pe
```

Fases previas: 00 a 29.
Referencia funcional: `supabase/migraciones/003`, `017` y `/admin/reclamos` de
Sugu Rolls.

---

## 2. Objetivo

El dueño pidió que todas las webs tengan política de privacidad, política de
cookies, términos y condiciones y Libro de Reclamaciones. Los tres primeros son
textos que el negocio debe poder editar. El cuarto es una obligación legal en
Perú: Código de Protección y Defensa del Consumidor (Ley 29571) y su reglamento
(D.S. 011-2011-PCM, modificado por el D.S. 101-2022-PCM).

Verificado en fuentes vigentes al planificar (no de memoria): desde el D.S.
101-2022-PCM el proveedor responde en un plazo máximo de **15 días hábiles
improrrogables**, contados desde el día siguiente al registro, por el medio que
indique el consumidor.

---

## 3. Alcance

### Incluido

- `tenant_legal_documents` (términos, privacidad, cookies), con plantillas por
  defecto rellenadas con razón social, RUC, dirección y contacto del negocio.
- Marcado cerrado para esos textos: `### título`, `- lista`, `**negrita**`,
  convertido a elementos. Nunca HTML.
- `complaints`: hoja del Libro de Reclamaciones con correlativo por negocio,
  datos del proveedor copiados al registrar, vencimiento a 15 días hábiles, y
  una sola parte editable: la respuesta.
- Permisos `complaints.view` (owner, admin, manager, accountant) y
  `complaints.manage` (owner, admin, manager).
- Rutas públicas `/sitio/terminos`, `/sitio/privacidad`, `/sitio/cookies`,
  `/sitio/libro-de-reclamaciones`, con constancia imprimible.
- Panel: **Tienda online → Textos legales** y **Clientes → Libro de
  reclamaciones** (filtros, vencidas, respuesta).

### Fuera de alcance

- **Envío por correo** de la constancia y de la respuesta. La plataforma no
  tiene todavía un `EmailProvider`. La constancia se muestra completa y se puede
  imprimir o guardar en PDF; la respuesta la envía el negocio por el medio
  elegido. Ver §24.
- Feriados nacionales en el cálculo del vencimiento.

---

## 6. Requerimientos funcionales

- **FR3001** Cualquiera puede registrar una hoja, con o sin cuenta, solo por
  `submit_complaint`. No existe política de INSERT.
- **FR3002** El correlativo es por negocio (`unique (tenant_id, number)`).
- **FR3003** `due_on` = 15 días hábiles (lunes a viernes) desde el día siguiente
  al registro, en hora de Lima.
- **FR3004** Nada de lo que escribió el consumidor se puede modificar; el trigger
  `guard_complaint_update` lo rechaza incluso para el dueño.
- **FR3005** No existe DELETE sobre `complaints` para nadie vía API.
- **FR3006** Guardar la respuesta registra `responded_at` y `responded_by`;
  vaciarla devuelve la hoja a pendiente.
- **FR3007** Un texto legal sin fila muestra la plantilla; "Volver a la
  plantilla" borra la fila.

---

## 8. Modelo de datos

- Enums: `legal_document_kind` (`terms`, `privacy`, `cookies`),
  `complaint_type` (`reclamo`, `queja`), `complaint_status` (`pending`,
  `answered`).
- `tenant_legal_documents (tenant_id, kind) PK, body ≤ 30000, updated_by`.
- `complaints`: proveedor (copia), consumidor, menor y apoderado, bien
  contratado, monto, detalle, pedido, canal de respuesta, respuesta, `due_on`.

## 10. Tenant Isolation

- Ambas tablas tienen `tenant_id` y RLS; entran al barrido de la Fase 25.
- Lecturas públicas solo por `get_public_legal_document` y
  `get_public_legal_identity`, que exigen `is_tenant_public`.
- `get_public_legal_identity` publica razón social y RUC, que la hoja del Libro
  exige imprimir y que SUNAT ya publica. Sigue sin devolver `contact_email`.

## 11. Seguridad

- Rate limit `storefront.complaint`: 5 cada 30 minutos por IP.
- El log del registro guarda solo número y tipo: nunca documento ni dirección.

## 17. Testing Plan

- `src/tests/database/legal-complaints.test.ts` (10).
- `src/tests/unit/legal.test.ts` (7): marcado, plantillas, esquema.

## 22. Definition of Done

- [ ] Tests de base y unitarios en verde.
- [ ] `lint`, `typecheck`, `test`, `build`.

## 24. Known limitations

- **KL-3001 — Sin correo.** La norma pide entregar copia de la hoja al consumidor
  y responder por el medio que eligió. Hoy la constancia se muestra e imprime al
  registrar, y la respuesta se envía fuera del sistema. Cerrar esto requiere un
  `EmailProvider` (Resend, SES…), que es una decisión de contratación.
- **KL-3002 — Feriados.** El vencimiento no descuenta feriados nacionales: puede
  caer unos días antes del plazo real, que es la dirección segura.
