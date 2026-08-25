import { describe, expect, it, vi } from "vitest";
import {
  AppError,
  AuthenticationError,
  AuthorizationError,
  ConfigurationError,
  ConflictError,
  DatabaseError,
  ERROR_CODES,
  ExternalServiceError,
  NotFoundError,
  ValidationError,
  isAppError,
  serializeError,
  toError,
  toErrorResponse,
} from "@/lib/errors";
import { createLogger, type LogRecord } from "@/lib/logger";

const REQUEST_ID = "req-test-0001";

describe("AppError (TEST-001)", () => {
  it("exposes code, httpStatus, isOperational and a public message", () => {
    const error = new AppError("technical detail", ERROR_CODES.INTERNAL_ERROR, 500, {
      publicMessage: "Something went wrong.",
    });

    expect(error).toBeInstanceOf(Error);
    expect(isAppError(error)).toBe(true);
    expect(error.code).toBe("INTERNAL_ERROR");
    expect(error.httpStatus).toBe(500);
    expect(error.isOperational).toBe(true);
    expect(error.message).toBe("technical detail");
    expect(error.publicMessage).toBe("Something went wrong.");
  });

  it("keeps the subclass name and prototype chain", () => {
    const error = new NotFoundError("Producto", "abc");
    expect(error.name).toBe("NotFoundError");
    expect(error).toBeInstanceOf(NotFoundError);
    expect(error).toBeInstanceOf(AppError);
  });

  it("preserves the wrapped cause", () => {
    const cause = new Error("pg: connection refused");
    const error = new DatabaseError("insert failed", { cause });
    expect(error.cause).toBe(cause);
  });
});

describe("error subclass status mapping (TEST-002)", () => {
  it.each([
    [new ValidationError(), 422, ERROR_CODES.VALIDATION_ERROR, true],
    [new AuthenticationError(), 401, ERROR_CODES.AUTHENTICATION_ERROR, true],
    [new AuthorizationError(), 403, ERROR_CODES.AUTHORIZATION_ERROR, true],
    [new NotFoundError(), 404, ERROR_CODES.NOT_FOUND, true],
    [new ConflictError(), 409, ERROR_CODES.CONFLICT, true],
    [new ExternalServiceError("SUNAT"), 502, ERROR_CODES.EXTERNAL_SERVICE_ERROR, true],
    [new DatabaseError(), 500, ERROR_CODES.DATABASE_ERROR, true],
    [new ConfigurationError(), 500, ERROR_CODES.CONFIGURATION_ERROR, false],
  ])("%s maps to the documented status", (error, status, code, operational) => {
    expect(error.httpStatus).toBe(status);
    expect(error.code).toBe(code);
    expect(error.isOperational).toBe(operational);
  });
});

describe("serializeError (TEST-003, TEST-004)", () => {
  it("never leaks stack, cause, message or context of an operational error", () => {
    const error = new DatabaseError(
      'duplicate key value violates unique constraint "tenants_slug_key"',
      { cause: new Error("PG 23505"), context: { table: "tenants", slug: "sugurolls" } },
    );

    const { status, body } = serializeError(error, REQUEST_ID);
    const serialised = JSON.stringify(body);

    expect(status).toBe(500);
    expect(body.error.message).toBe("A data error occurred. Please try again.");
    expect(serialised).not.toContain("tenants_slug_key");
    expect(serialised).not.toContain("sugurolls");
    expect(serialised).not.toContain("23505");
    expect(serialised).not.toContain("stack");
  });

  it("maps an unknown thrown value to a generic 500", () => {
    for (const thrown of ["boom", 42, null, undefined, { message: "leak me" }]) {
      const { status, body } = serializeError(thrown, REQUEST_ID);
      expect(status).toBe(500);
      expect(body.error.code).toBe(ERROR_CODES.INTERNAL_ERROR);
      expect(JSON.stringify(body)).not.toContain("leak me");
    }
  });

  it("does not expose a non-operational AppError's real status or message", () => {
    const error = new ConfigurationError("NEXT_PUBLIC_SUPABASE_URL is required.");
    const { status, body } = serializeError(error, REQUEST_ID);

    expect(status).toBe(500);
    expect(body.error.code).toBe(ERROR_CODES.INTERNAL_ERROR);
    expect(body.error.message).not.toContain("NEXT_PUBLIC_SUPABASE_URL");
  });

  it("echoes the request id for support correlation", () => {
    const { body } = serializeError(new NotFoundError("Pedido"), REQUEST_ID);
    expect(body.error.requestId).toBe(REQUEST_ID);
  });
});

describe("ValidationError detail (TEST-005)", () => {
  it("is the only error type that exposes field-level detail", () => {
    const error = new ValidationError("invalid", { slug: ["Slug is required."] });
    const { status, body } = serializeError(error, REQUEST_ID);

    expect(status).toBe(422);
    expect(body.error.details).toEqual({ slug: ["Slug is required."] });

    const notFound = serializeError(new NotFoundError("Pedido"), REQUEST_ID);
    expect(notFound.body.error.details).toBeUndefined();
  });
});

describe("toErrorResponse", () => {
  function collectingLogger() {
    const records: LogRecord[] = [];
    return {
      records,
      logger: createLogger({ level: "debug", transport: (record) => records.push(record) }),
    };
  }

  it("returns a JSON Response with no-store and the request id header", async () => {
    const { logger } = collectingLogger();
    const response = toErrorResponse(new NotFoundError("Producto"), {
      requestId: REQUEST_ID,
      logger,
    });

    expect(response.status).toBe(404);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("X-Request-Id")).toBe(REQUEST_ID);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: ERROR_CODES.NOT_FOUND, requestId: REQUEST_ID },
    });
  });

  it("logs an operational error at warn and a defect at error", () => {
    const { records, logger } = collectingLogger();

    toErrorResponse(new AuthorizationError(), { requestId: REQUEST_ID, logger });
    toErrorResponse(new TypeError("undefined is not a function"), {
      requestId: REQUEST_ID,
      logger,
    });

    expect(records[0]?.level).toBe("warn");
    expect(records[0]?.event).toBe("app.error.operational");
    expect(records[1]?.level).toBe("error");
    expect(records[1]?.event).toBe("app.error.unhandled");
  });

  it("keeps the technical detail in the log while hiding it from the response", async () => {
    const { records, logger } = collectingLogger();
    const response = toErrorResponse(
      new DatabaseError('violates unique constraint "tenants_slug_key"'),
      { requestId: REQUEST_ID, logger },
    );

    expect(JSON.stringify(records[0])).toContain("tenants_slug_key");
    expect(JSON.stringify(await response.json())).not.toContain("tenants_slug_key");
  });

  it("falls back to the shared logger when none is supplied", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = toErrorResponse(new Error("boom"), { requestId: REQUEST_ID });
    expect(response.status).toBe(500);
    spy.mockRestore();
  });
});

describe("toError (TEST-004 companion)", () => {
  it("passes an Error through unchanged", () => {
    const original = new RangeError("out of range");
    expect(toError(original)).toBe(original);
  });

  it("wraps a non-Error value while preserving it as cause", () => {
    const wrapped = toError({ weird: true });
    expect(wrapped).toBeInstanceOf(AppError);
    expect(wrapped.cause).toEqual({ weird: true });
  });
});
