/**
 * The policy texts a business gets until it writes its own.
 *
 * Written for what the product actually does, not copied from a generic
 * generator: web orders without accounts, a name and a phone collected for each
 * order, a cart in the browser's local storage, payment by the methods the
 * business publishes, WhatsApp for coordination. If the product starts doing
 * something else with personal data - analytics, an email list - these texts
 * have to change with it.
 *
 * Peruvian law named where it applies: Ley 29733 (datos personales), Ley 29571
 * (Codigo de Proteccion y Defensa del Consumidor) and its Libro de Reclamaciones.
 *
 * A TEMPLATE, NOT LEGAL ADVICE. The dashboard says so next to the editor: every
 * business should have these reviewed for its own case.
 */

import type { LegalDocumentKind } from "@/types/database";

export interface LegalIdentity {
  /** Trade name, always present. */
  readonly name: string;
  readonly legalName: string | null;
  readonly taxId: string | null;
  readonly address: string | null;
  readonly email: string | null;
  readonly phone: string | null;
}

export const LEGAL_TITLES: Record<LegalDocumentKind, string> = {
  terms: "Términos y condiciones",
  privacy: "Política de privacidad",
  cookies: "Política de cookies",
};

/** "INVERSIONES SUGU S.A.C. (RUC 20608920961)", or the trade name alone. */
function company(identity: LegalIdentity): string {
  const legal = identity.legalName ?? identity.name;
  return identity.taxId !== null ? `**${legal}** (RUC ${identity.taxId})` : `**${legal}**`;
}

function contactLine(identity: LegalIdentity): string {
  const channels = [
    identity.email !== null ? `al correo **${identity.email}**` : null,
    identity.phone !== null ? `al teléfono **${identity.phone}**` : null,
  ].filter((part): part is string => part !== null);
  return channels.length > 0
    ? `Puedes escribirnos ${channels.join(" o ")}.`
    : "Puedes escribirnos por los canales de contacto publicados en esta web.";
}

function terms(identity: LegalIdentity): string {
  return `### Quiénes somos

Esta web pertenece a ${company(identity)}, que opera la marca **${identity.name}**${
    identity.address !== null ? `, con domicilio en ${identity.address}` : ""
  }. Al hacer un pedido aceptas estos términos.

### Pedidos

- Puedes pedir sin crear una cuenta: solo te pedimos tu nombre, un teléfono de contacto y, si es delivery, la dirección de entrega.
- El pedido queda registrado cuando la web te muestra su número. Podemos contactarte por teléfono o WhatsApp para confirmarlo.
- Solo recibimos pedidos dentro de nuestro horario de atención. Fuera de él, la web no permite confirmar el pedido.
- Si un producto se agota después de hacer tu pedido, te avisaremos para reemplazarlo o descontarlo.

### Precios

- Los precios están en soles e incluyen los impuestos que correspondan.
- El total de tu pedido es el que muestra la web al confirmarlo. Si cambia un precio mientras armas tu carrito, se respeta el precio vigente al confirmar.
- El costo de delivery depende de la zona y se muestra antes de confirmar.

### Pagos

- Aceptamos los métodos de pago que aparecen al hacer el pedido.
- Si pagas con Yape, Plin o transferencia, envíanos el comprobante por WhatsApp. Podemos esperar la confirmación del pago antes de preparar tu pedido.

### Entrega y recojo

- Los tiempos de entrega son referenciales y pueden variar por demanda, clima o tránsito.
- Revisa tu pedido al recibirlo. Si algo no está bien, avísanos cuanto antes.

### Cancelaciones

Puedes cancelar tu pedido mientras no hayamos empezado a prepararlo, escribiéndonos por WhatsApp o llamándonos. Si ya lo pagaste, te devolvemos el importe por el mismo medio.

### Reclamos

Ponemos a tu disposición nuestro **Libro de Reclamaciones virtual**, conforme al Código de Protección y Defensa del Consumidor (Ley 29571). Responderemos en un plazo máximo de 15 días hábiles.

### Contacto

${contactLine(identity)}

### Ley aplicable

Estos términos se rigen por las leyes de la República del Perú.`;
}

function privacy(identity: LegalIdentity): string {
  return `### Responsable

El responsable de tus datos personales es ${company(identity)}${
    identity.address !== null ? `, con domicilio en ${identity.address}` : ""
  }. Tratamos tus datos conforme a la **Ley 29733, Ley de Protección de Datos Personales**, y su reglamento.

### Qué datos recogemos

- **Al hacer un pedido:** tu nombre, tu teléfono y, si pides delivery, la dirección de entrega y su referencia.
- **En el Libro de Reclamaciones:** los datos que la norma exige para registrar tu reclamo o queja (nombre, documento de identidad, domicilio, correo y teléfono).
- No te pedimos crear una cuenta ni contraseña.

### Para qué los usamos

- Preparar, entregar y cobrar tu pedido, y contactarte si hay algo que coordinar.
- Atender y responder los reclamos o quejas que registres.
- Cumplir obligaciones legales, tributarias y contables.

No usamos tus datos para publicidad ni los vendemos. Solo los compartimos con quienes nos ayudan a operar (por ejemplo, el repartidor de tu pedido o el proveedor de la plataforma de la web), y únicamente para esos fines.

### Cuánto tiempo los guardamos

Conservamos los datos de tus pedidos mientras sean necesarios para las finalidades descritas y por los plazos que exigen las normas tributarias. Los registros del Libro de Reclamaciones se conservan por el plazo que exige su reglamento.

### Tus derechos

Puedes ejercer tus derechos de acceso, rectificación, cancelación y oposición. ${contactLine(
    identity,
  )} Si consideras que no atendimos tu solicitud, puedes acudir a la Autoridad Nacional de Protección de Datos Personales.

### Cambios

Si cambiamos esta política, publicaremos la nueva versión en esta página.`;
}

function cookies(identity: LegalIdentity): string {
  return `### Qué son las cookies

Las cookies y tecnologías parecidas, como el almacenamiento local del navegador, permiten que una web recuerde información entre una visita y otra.

### Qué usamos en esta web

Solo usamos almacenamiento **técnico o necesario** para que la web funcione. **No usamos cookies de publicidad, de perfilado ni de analítica de terceros.**

- **Tu carrito.** Guardamos en tu navegador los productos que vas agregando, para que no se pierdan si recargas la página. No sale de tu dispositivo hasta que confirmas un pedido.
- **Seguridad.** Podemos usar identificadores técnicos para proteger la web contra abusos, como el envío masivo de pedidos falsos.

### Cuánto duran

El carrito se queda en tu navegador hasta que confirmas el pedido, lo vacías o borras los datos de navegación.

### Cómo desactivarlas

Puedes borrar o bloquear este almacenamiento desde la configuración de privacidad de tu navegador. Si lo haces, el carrito no recordará tus productos entre visitas.

### Contacto

${contactLine(identity)} Esta web pertenece a ${company(identity)}.`;
}

export function legalTemplate(kind: LegalDocumentKind, identity: LegalIdentity): string {
  switch (kind) {
    case "terms":
      return terms(identity);
    case "privacy":
      return privacy(identity);
    case "cookies":
      return cookies(identity);
  }
}
