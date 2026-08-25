/**
 * Environment configuration.
 *
 * CLOVERCODE_MASTER.md section 24: sensitive variables live outside the
 * repository and `.env.example` documents the contract.
 *
 * Two deliberate design decisions, both recorded in
 * docs/adr/004-environment-validation.md:
 *
 * 1. Validation is LAZY and memoised. Validating at import time would make
 *    `next build` fail on any machine without credentials - including CI and
 *    Vercel preview builds, where the build step legitimately has no secrets.
 *    A missing variable therefore fails at first use, loudly, with the exact
 *    list of offending keys.
 *
 * 2. `NEXT_PUBLIC_*` variables are read through literal `process.env.X`
 *    references. Next.js substitutes those statically at build time; a dynamic
 *    lookup such as `process.env[name]` would silently resolve to `undefined`
 *    in the browser bundle.
 */

import { z } from "zod";
import { ConfigurationError } from "@/lib/errors";

/** Treats an empty or whitespace-only variable as absent rather than valid. */
const optionalText = z
  .string()
  .transform((value) => value.trim())
  .transform((value) => (value.length === 0 ? undefined : value));

const requiredText = (label: string) =>
  z.preprocess(
    (value) => (typeof value === "string" && value.trim().length === 0 ? undefined : value),
    z.string({ error: `${label} is required.` }).min(1, `${label} is required.`),
  );

const publicEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.preprocess(
    (value) => (typeof value === "string" && value.trim().length === 0 ? undefined : value),
    z.url({ error: "NEXT_PUBLIC_SUPABASE_URL must be a valid absolute URL." }),
  ),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: requiredText("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
  NEXT_PUBLIC_APP_URL: z
    .preprocess(
      (value) => (typeof value === "string" && value.trim().length === 0 ? undefined : value),
      z.url({ error: "NEXT_PUBLIC_APP_URL must be a valid absolute URL." }).optional(),
    )
    .transform((value) => value ?? "http://localhost:3000"),
});

const serverEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: optionalText.pipe(z.enum(["debug", "info", "warn", "error"]).optional()).optional(),

  /**
   * Tenant served when a developer browses plain `localhost`.
   *
   * Development convenience only: `toLookupDomain()` ignores it whenever
   * NODE_ENV is production, so it can never select a tenant in a deployed
   * environment (SPEC phase-01 AB-105).
   */
  DEV_TENANT_SLUG: optionalText
    .pipe(
      z
        .string()
        .regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/, "DEV_TENANT_SLUG must be a valid tenant slug.")
        .optional(),
    )
    .optional(),
});

export type PublicEnv = z.output<typeof publicEnvSchema>;
export type ServerEnv = z.output<typeof serverEnvSchema> & PublicEnv;

/**
 * Literal references only - see the header note. Every `NEXT_PUBLIC_*` variable
 * used anywhere in the application must appear here verbatim.
 */
function readPublicEnv(): Record<string, unknown> {
  return {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  };
}

function fail(scope: string, error: z.ZodError): never {
  // Only the KEYS are reported. Printing a value would move a secret into the
  // logs, which is exactly what section 9 forbids.
  const problems = error.issues
    .map((issue) => `${issue.path.map(String).join(".") || "(root)"}: ${issue.message}`)
    .sort();

  throw new ConfigurationError(
    `Invalid ${scope} environment configuration. ${problems.join(" | ")}`,
    { context: { scope, invalidKeys: problems } },
  );
}

let cachedPublicEnv: PublicEnv | undefined;
let cachedServerEnv: ServerEnv | undefined;

/** Validated variables that are safe in the browser bundle. */
export function getPublicEnv(): PublicEnv {
  if (cachedPublicEnv !== undefined) return cachedPublicEnv;

  const result = publicEnvSchema.safeParse(readPublicEnv());
  if (!result.success) fail("public", result.error);

  cachedPublicEnv = result.data;
  return cachedPublicEnv;
}

/**
 * Validated server configuration. Includes the public values, so server code
 * needs a single accessor.
 *
 * Throws if called from the browser: that would mean a server-only value had
 * been pulled into a client bundle.
 */
export function getServerEnv(): ServerEnv {
  if (typeof window !== "undefined") {
    throw new ConfigurationError("getServerEnv() must not be called in the browser.");
  }

  if (cachedServerEnv !== undefined) return cachedServerEnv;

  const result = serverEnvSchema.safeParse({
    NODE_ENV: process.env.NODE_ENV,
    LOG_LEVEL: process.env.LOG_LEVEL,
    DEV_TENANT_SLUG: process.env.DEV_TENANT_SLUG,
  });
  if (!result.success) fail("server", result.error);

  cachedServerEnv = { ...result.data, ...getPublicEnv() };
  return cachedServerEnv;
}

/** Clears the memoised values. Test-only. */
export function resetEnvCache(): void {
  cachedPublicEnv = undefined;
  cachedServerEnv = undefined;
}

/**
 * Validates the whole configuration eagerly. Intended for an explicit startup
 * or CI check, never for module import.
 */
export function assertEnvIsValid(): void {
  getServerEnv();
}
