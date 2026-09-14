/**
 * Shared constants of the contact form.
 *
 * Deliberately NOT inside the `"use server"` module next to the action. Such a
 * module may only export async functions - Next.js turns every export into a
 * callable server endpoint - so a plain constant there is a build error. The
 * same reason `FormState` lives in `lib/forms/state` rather than beside the
 * actions that return it.
 */

/**
 * The honeypot field name.
 *
 * A field hidden from sight and from assistive technology, never focusable, and
 * labelled for anyone who reaches it anyway. A person cannot fill it; a script
 * that fills every input does. A submission carrying a value here is dropped
 * and still reports success, because telling a bot it was detected is telling
 * whoever wrote it what to change.
 */
export const HONEYPOT_FIELD = "sitio_web";

/**
 * Where a submission came from, as the `source` column records it.
 *
 * Must match the `platform_leads_source_format` CHECK: lowercase, one dot.
 */
export const CONTACT_SOURCES = {
  /** The contact section at the foot of the landing page. */
  CONTACT: "landing.contact",
  /** A plan card in the pricing section. */
  PRICING: "landing.pricing",
  /** The header call to action. */
  HERO: "landing.hero",
} as const;

export type ContactSource = (typeof CONTACT_SOURCES)[keyof typeof CONTACT_SOURCES];

/** The kinds of business the form offers, and `Otro` for everything else. */
export const BUSINESS_TYPES = [
  "Restaurante",
  "Cafeteria o pasteleria",
  "Minimarket o bodega",
  "Tienda de ropa",
  "Farmacia o botica",
  "Licoreria",
  "Servicios",
  "Otro",
] as const;
