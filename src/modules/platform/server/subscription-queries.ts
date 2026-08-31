import "server-only";

/**
 * Read side of plans and modules.
 *
 * Two audiences, and they are served by the same functions: a platform admin
 * governing any tenant, and a tenant's own owner reading what they contracted.
 * RLS is what tells them apart - `subscriptions` and `tenant_modules` are
 * readable by members of the tenant OR by a platform admin - so nothing here
 * needs to branch on who is asking.
 */

import { DatabaseError } from "@/lib/errors";
import type { Module } from "@/lib/features";
import { logger } from "@/lib/logger";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { PlanInterval, SubscriptionStatus } from "@/types/database";

export interface Plan {
  readonly code: string;
  readonly name: string;
  readonly description: string | null;
  readonly priceCents: number;
  readonly interval: PlanInterval;
  readonly currency: string;
  readonly isActive: boolean;
  readonly isDefault: boolean;
  /** Phase 22: the commercial terms, shown read-only. */
  readonly trialDays: number;
  readonly graceDays: number;
  readonly modules: readonly Module[];
}

/** The catalogue, with each plan's modules attached. */
export async function listPlans(): Promise<readonly Plan[]> {
  const client = await createSupabaseServerClient();

  const [{ data: plans, error }, { data: planModules, error: moduleError }] = await Promise.all([
    client
      .from("plans")
      .select(
        "code, name, description, price_cents, interval, is_active, is_default, trial_days, grace_days, currency",
      )
      .order("position"),
    client.from("plan_modules").select("plan_code, module_code"),
  ]);

  if (error !== null || moduleError !== null) {
    logger.error("platform.plans.list_failed", { error: error ?? moduleError });
    throw new DatabaseError("Plan listing failed.", { cause: error ?? moduleError });
  }

  return (plans ?? []).map((plan) => ({
    code: plan.code,
    name: plan.name,
    description: plan.description,
    priceCents: plan.price_cents,
    interval: plan.interval,
    currency: plan.currency,
    isActive: plan.is_active,
    isDefault: plan.is_default,
    trialDays: plan.trial_days,
    graceDays: plan.grace_days,
    modules: (planModules ?? [])
      .filter((row) => row.plan_code === plan.code)
      .map((row) => row.module_code),
  }));
}

export interface ModuleDefinition {
  readonly code: Module;
  readonly name: string;
  readonly description: string | null;
}

export async function listModules(): Promise<readonly ModuleDefinition[]> {
  const client = await createSupabaseServerClient();
  const { data, error } = await client
    .from("modules")
    .select("code, name, description")
    .order("position");

  if (error) {
    logger.error("platform.modules.list_failed", { error });
    throw new DatabaseError("Module listing failed.", { cause: error });
  }

  return (data ?? []).map((row) => ({
    code: row.code,
    name: row.name,
    description: row.description,
  }));
}

export interface TenantSubscription {
  readonly planCode: string;
  readonly planName: string;
  readonly priceCents: number;
  readonly interval: PlanInterval;
  readonly status: SubscriptionStatus;
  readonly trialEndsAt: string | null;
  readonly currentPeriodStart: string;
  readonly currentPeriodEnd: string | null;
  /** Phase 22: cancel when the paid period runs out, not now. */
  readonly cancelAtPeriodEnd: boolean;
  /** The plan's grace days, so a screen can say when suspension arrives. */
  readonly graceDays: number;
}

/**
 * What one tenant has contracted.
 *
 * `null` only when the caller cannot see it - RLS returns no rows rather than
 * an error. Every tenant has a subscription by construction (provisioning
 * creates one, and the Phase 21 migration backfilled the rest), so a null here
 * means "not yours to see", not "does not exist".
 */
export async function getTenantSubscription(tenantId: string): Promise<TenantSubscription | null> {
  const client = await createSupabaseServerClient();
  const { data, error } = await client
    .from("subscriptions")
    .select(
      "plan_code, status, trial_ends_at, current_period_start, current_period_end, cancel_at_period_end, plans(name, price_cents, interval, grace_days)",
    )
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (error) {
    logger.error("platform.subscription.get_failed", { tenantId, error });
    throw new DatabaseError("Subscription lookup failed.", { cause: error });
  }
  if (data === null) return null;

  const plan = data.plans as unknown as {
    name: string;
    price_cents: number;
    interval: PlanInterval;
    grace_days: number;
  } | null;

  return {
    planCode: data.plan_code,
    planName: plan?.name ?? data.plan_code,
    priceCents: plan?.price_cents ?? 0,
    interval: plan?.interval ?? "monthly",
    status: data.status,
    trialEndsAt: data.trial_ends_at,
    currentPeriodStart: data.current_period_start,
    currentPeriodEnd: data.current_period_end,
    cancelAtPeriodEnd: data.cancel_at_period_end,
    graceDays: plan?.grace_days ?? 7,
  };
}

export interface ModuleOverride {
  readonly moduleCode: Module;
  readonly isEnabled: boolean;
  readonly note: string | null;
}

export async function listTenantModuleOverrides(
  tenantId: string,
): Promise<readonly ModuleOverride[]> {
  const client = await createSupabaseServerClient();
  const { data, error } = await client
    .from("tenant_modules")
    .select("module_code, is_enabled, note")
    .eq("tenant_id", tenantId);

  if (error) {
    logger.error("platform.module_overrides.list_failed", { tenantId, error });
    throw new DatabaseError("Module override listing failed.", { cause: error });
  }

  return (data ?? []).map((row) => ({
    moduleCode: row.module_code,
    isEnabled: row.is_enabled,
    note: row.note,
  }));
}
