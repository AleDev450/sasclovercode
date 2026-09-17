"use server";

/**
 * Storefront Server Actions (Phase 29).
 *
 * Two very different kinds live here, and the difference is the whole security
 * model of the phase:
 *
 *   `placeWebOrderAction` has NO session and NO permission. It is called by a
 *   stranger on a restaurant's website. Its tenant comes from the HOSTNAME
 *   (`getSiteContext`), never from the payload, and everything it writes goes
 *   through `place_web_order`, which validates the order against that tenant.
 *
 *   The rest are dashboard actions with the usual three layers: tenant from the
 *   URL segment, permission, then a write RLS checks again.
 */

import { revalidatePath } from "next/cache";
import { DatabaseError } from "@/lib/errors";
import type { FormState } from "@/lib/forms/state";
import { logger } from "@/lib/logger";
import { PERMISSIONS } from "@/lib/permissions";
import { requirePermission } from "@/lib/permissions/check";
import {
  consumeRateLimitForCaller,
  RATE_LIMITED_MESSAGE,
  RATE_LIMITS,
} from "@/lib/security/rate-limit";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireActiveTenant } from "@/lib/tenant/active";
import { toFieldErrors } from "@/lib/validation";
import { getSiteContext } from "@/modules/cms/server/site-context";
import { SECTION_TEMPLATES } from "@/modules/cms/section-meta";
import { isKnownWebOrderError, webOrderErrorMessage } from "../errors";
import { checkoutSchema, storefrontSettingsSchema } from "../schemas";

function readText(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

/* -------------------------------------------------------------------------- */
/*  The public checkout                                                        */
/* -------------------------------------------------------------------------- */

export type PlaceWebOrderResult =
  | {
      readonly ok: true;
      readonly orderNumber: number;
      readonly token: string;
      readonly totalCents: number;
    }
  | {
      readonly ok: false;
      readonly message: string;
      readonly fieldErrors?: Readonly<Record<string, readonly string[]>>;
    };

export async function placeWebOrderAction(input: unknown): Promise<PlaceWebOrderResult> {
  const site = await getSiteContext();
  if (site === null || !site.isServing) {
    return { ok: false, message: webOrderErrorMessage("STORE_UNAVAILABLE") };
  }

  // Before validation, so a flood of malformed requests is limited too.
  if (!(await consumeRateLimitForCaller(RATE_LIMITS.STOREFRONT_ORDER))) {
    return { ok: false, message: RATE_LIMITED_MESSAGE };
  }

  const parsed = checkoutSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors = toFieldErrors(parsed.error);
    const first = Object.values(fieldErrors)[0]?.[0];
    return {
      ok: false,
      message: first ?? webOrderErrorMessage("INVALID_ORDER"),
      fieldErrors,
    };
  }

  const order = parsed.data;
  const client = await createSupabaseServerClient();

  // `acceptedTerms` is a precondition, not data: it does not travel.
  const { data, error } = await client.rpc("place_web_order", {
    p_tenant_id: site.tenant.id,
    p_order: {
      contact: order.contact,
      fulfillment: order.fulfillment,
      delivery: order.fulfillment === "delivery" ? order.delivery : undefined,
      paymentMethodId: order.paymentMethodId,
      payOnline: order.payOnline,
      note: order.note,
      items: order.items,
    },
  });

  if (error) {
    if (isKnownWebOrderError(error.message)) {
      logger.info("storefront.order_refused", { tenantId: site.tenant.id, reason: error.message });
    } else {
      logger.error("storefront.order_failed", { tenantId: site.tenant.id, error });
    }
    return { ok: false, message: webOrderErrorMessage(error.message) };
  }

  const row = data?.[0];
  if (row === undefined) {
    logger.error("storefront.order_no_row", { tenantId: site.tenant.id });
    return { ok: false, message: webOrderErrorMessage(null) };
  }

  logger.info("storefront.order_placed", {
    tenantId: site.tenant.id,
    orderNumber: row.order_number,
    fulfillment: order.fulfillment,
    lines: order.items.length,
  });

  return {
    ok: true,
    orderNumber: row.order_number,
    token: row.access_token,
    totalCents: Number(row.total_cents),
  };
}

/* -------------------------------------------------------------------------- */
/*  Dashboard                                                                  */
/* -------------------------------------------------------------------------- */

export async function updateStorefrontAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const tenant = await requireActiveTenant(readText(formData, "tenantSlug"));
  await requirePermission(tenant.id, PERMISSIONS.SETTINGS_MANAGE);

  const parsed = storefrontSettingsSchema.safeParse({
    orderingEnabled: readText(formData, "orderingEnabled"),
    mode: readText(formData, "mode"),
    closedMessage: readText(formData, "closedMessage"),
    acceptsDelivery: readText(formData, "acceptsDelivery"),
    acceptsPickup: readText(formData, "acceptsPickup"),
    minOrder: readText(formData, "minOrder"),
    orderLocationId: readText(formData, "orderLocationId"),
    whatsappButton: readText(formData, "whatsappButton"),
    whatsappMessage: readText(formData, "whatsappMessage"),
    tagline: readText(formData, "tagline"),
    publicEmail: readText(formData, "publicEmail"),
    bestsellersDays: readText(formData, "bestsellersDays") || 30,
  });

  if (!parsed.success) {
    return { status: "error", fieldErrors: toFieldErrors(parsed.error) };
  }

  const input = parsed.data;
  const client = await createSupabaseServerClient();

  const { error } = await client
    .from("tenant_storefronts")
    .update({
      ordering_enabled: input.orderingEnabled,
      mode: input.mode,
      closed_message: input.closedMessage,
      accepts_delivery: input.acceptsDelivery,
      accepts_pickup: input.acceptsPickup,
      min_order_cents: input.minOrder,
      order_location_id: input.orderLocationId,
      whatsapp_button: input.whatsappButton,
      whatsapp_message: input.whatsappMessage,
      tagline: input.tagline,
      public_email: input.publicEmail,
      bestsellers_days: input.bestsellersDays,
    })
    .eq("tenant_id", tenant.id);

  if (error) {
    // The branch guard: a location id of another business, typed by hand.
    if (error.code === "23514") {
      return {
        status: "error",
        fieldErrors: { orderLocationId: ["Esa sede no es de esta empresa."] },
      };
    }
    logger.error("storefront.settings_update_failed", { tenantId: tenant.id, error });
    throw new DatabaseError("Storefront update failed.", { cause: error });
  }

  logger.info("storefront.settings_updated", { tenantId: tenant.id, mode: input.mode });
  revalidatePath(`/dashboard/${tenant.slug}/tienda`);
  revalidatePath("/sitio", "layout");
  return { status: "success", message: "Tienda online guardada." };
}

/** Shows or hides one payment method on the website checkout. */
export async function setPaymentMethodWebsiteAction(formData: FormData): Promise<void> {
  const tenant = await requireActiveTenant(readText(formData, "tenantSlug"));
  await requirePermission(tenant.id, PERMISSIONS.PAYMENT_METHODS_MANAGE);

  const methodId = readText(formData, "methodId");
  const show = readText(formData, "showOnWebsite") === "true";

  const client = await createSupabaseServerClient();
  const { error } = await client
    .from("payment_methods")
    .update({ show_on_website: show })
    .eq("id", methodId)
    .eq("tenant_id", tenant.id);

  if (error) {
    logger.error("storefront.payment_method_toggle_failed", { tenantId: tenant.id, error });
    throw new DatabaseError("Payment method update failed.", { cause: error });
  }

  logger.info("storefront.payment_method_toggled", { tenantId: tenant.id, methodId, show });
  revalidatePath(`/dashboard/${tenant.slug}/configuracion/pagos`);
  revalidatePath(`/dashboard/${tenant.slug}/tienda`);
  revalidatePath("/sitio", "layout");
}

/**
 * Gives a business the restaurant home page in one click.
 *
 * Creates the `inicio` page, published, with the slider, the shortcuts and the
 * bestsellers - the structure of Sugu Rolls. An existing `inicio` is never
 * overwritten: if it has sections it is left alone, and if it is empty it gets
 * the three. Somebody who built their own home page did it on purpose.
 */
export async function applyStorefrontTemplateAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const tenant = await requireActiveTenant(readText(formData, "tenantSlug"));
  await requirePermission(tenant.id, PERMISSIONS.CONTENT_MANAGE);

  const client = await createSupabaseServerClient();

  const { data: existing, error: lookupError } = await client
    .from("pages")
    .select("id, page_sections(id)")
    .eq("tenant_id", tenant.id)
    .eq("slug", "inicio")
    .maybeSingle();

  if (lookupError) {
    logger.error("storefront.template_lookup_failed", { tenantId: tenant.id, error: lookupError });
    throw new DatabaseError("Home page lookup failed.", { cause: lookupError });
  }

  if (existing !== null && (existing.page_sections ?? []).length > 0) {
    return {
      status: "error",
      message:
        "Tu portada ya tiene secciones. Editala desde Paginas para no perder lo que hiciste.",
    };
  }

  let pageId = existing?.id ?? null;

  if (pageId === null) {
    const { data: created, error } = await client
      .from("pages")
      .insert({ tenant_id: tenant.id, slug: "inicio", title: "Inicio", status: "published" })
      .select("id")
      .single();

    if (error) {
      logger.error("storefront.template_page_failed", { tenantId: tenant.id, error });
      throw new DatabaseError("Home page creation failed.", { cause: error });
    }
    pageId = created.id;
  }

  const sections = (["slider", "shortcuts", "bestsellers"] as const).map((type, position) => ({
    page_id: pageId,
    tenant_id: tenant.id,
    type,
    content: SECTION_TEMPLATES[type] as never,
    position,
  }));

  const { error: sectionsError } = await client.from("page_sections").insert(sections);
  if (sectionsError) {
    logger.error("storefront.template_sections_failed", {
      tenantId: tenant.id,
      error: sectionsError,
    });
    throw new DatabaseError("Home page sections failed.", { cause: sectionsError });
  }

  // Published even when it existed as a draft: the button says "use this as my
  // home page", and a draft home page is no home page.
  await client
    .from("pages")
    .update({ status: "published" })
    .eq("id", pageId)
    .eq("tenant_id", tenant.id);

  logger.info("storefront.template_applied", { tenantId: tenant.id });
  revalidatePath(`/dashboard/${tenant.slug}/contenido`);
  revalidatePath("/sitio", "layout");
  return { status: "success", message: "Portada creada. Sube las fotos del slider desde Paginas." };
}
