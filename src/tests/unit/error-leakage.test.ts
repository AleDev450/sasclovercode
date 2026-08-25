import { describe, expect, it } from "vitest";
import {
  AppError,
  AuthenticationError,
  AuthorizationError,
  ConfigurationError,
  ConflictError,
  DatabaseError,
  ERROR_CODES,
  ExternalServiceError,
  GENERIC_PUBLIC_MESSAGE,
  NotFoundError,
  ValidationError,
  serializeError,
} from "@/lib/errors";

/**
 * Regression suite for the leak found in the Phase 00 audit.
 *
 * `ConflictError` used to set `publicMessage` to its technical `message`, and
 * the `AppError` base defaulted `publicMessage` to `message`. Both returned
 * constraint names and connection details to the caller, contradicting
 * ADR-003, SPEC section 15 and FR-018.
 *
 * The original suite only checked `DatabaseError`, whose default happened to be
 * safe - which is exactly why the leak survived. This file checks EVERY error
 * type with the same hostile payload.
 */

/** Strings that must never reach a caller, whatever error carries them. */
const SECRETS = [
  "tenants_slug_key",
  "sugurolls",
  "db-prod-7",
  "password authentication failed",
  "SELECT * FROM tenants",
  "/var/app/src/lib/secret.ts",
];

const TECHNICAL_MESSAGE = SECRETS.join(" | ");

function assertNoLeak(error: unknown, label: string): void {
  const serialised = JSON.stringify(serializeError(error, "req-audit"));
  for (const secret of SECRETS) {
    expect(serialised, `${label} leaked "${secret}"`).not.toContain(secret);
  }
}

describe("no error type leaks its technical message", () => {
  it.each([
    [
      "AppError (operational, direct construction)",
      new AppError(TECHNICAL_MESSAGE, ERROR_CODES.INTERNAL_ERROR, 400),
    ],
    ["ValidationError", new ValidationError(TECHNICAL_MESSAGE)],
    ["AuthenticationError", new AuthenticationError(TECHNICAL_MESSAGE)],
    ["AuthorizationError", new AuthorizationError(TECHNICAL_MESSAGE)],
    ["NotFoundError", new NotFoundError("Tenant", TECHNICAL_MESSAGE)],
    ["ConflictError", new ConflictError(TECHNICAL_MESSAGE)],
    ["ExternalServiceError", new ExternalServiceError("SUNAT", TECHNICAL_MESSAGE)],
    ["DatabaseError", new DatabaseError(TECHNICAL_MESSAGE)],
    ["ConfigurationError", new ConfigurationError(TECHNICAL_MESSAGE)],
  ])("%s", (label, error) => {
    assertNoLeak(error, label);
  });

  it("does not leak a technical message hidden in the cause chain", () => {
    const error = new DatabaseError("insert failed", {
      cause: new Error(TECHNICAL_MESSAGE),
    });
    assertNoLeak(error, "cause chain");
  });

  it("does not leak error context", () => {
    const error = new ConflictError("slug taken", {
      context: { existingSlug: "sugurolls", constraint: "tenants_slug_key" },
    });
    assertNoLeak(error, "context");
  });
});

describe("publicMessage never defaults to the technical message", () => {
  it("falls back to the generic message when not provided", () => {
    const error = new AppError(TECHNICAL_MESSAGE, ERROR_CODES.INTERNAL_ERROR, 400);
    expect(error.publicMessage).toBe(GENERIC_PUBLIC_MESSAGE);
    expect(error.message).toBe(TECHNICAL_MESSAGE);
  });

  it("keeps the technical message available for the logs", () => {
    const error = new ConflictError(TECHNICAL_MESSAGE);
    expect(error.message).toBe(TECHNICAL_MESSAGE);
    expect(error.publicMessage).not.toContain("tenants_slug_key");
  });

  it("honours an explicit publicMessage", () => {
    const error = new ConflictError(TECHNICAL_MESSAGE, {
      publicMessage: "Ese slug ya esta en uso.",
    });
    expect(serializeError(error, "r").body.error.message).toBe("Ese slug ya esta en uso.");
  });
});

describe("cross-tenant probing", () => {
  it("reports a foreign resource as 404, never 403", () => {
    // A 403 would confirm the record exists. See ADR-003 decision 5.
    const { status, body } = serializeError(new NotFoundError("Producto"), "r");
    expect(status).toBe(404);
    expect(body.error.code).toBe(ERROR_CODES.NOT_FOUND);
  });
});
