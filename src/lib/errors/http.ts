/**
 * Mapping from a thrown value to an HTTP response.
 *
 * This is the boundary that CLOVERCODE_MASTER.md section 9 protects: stack
 * traces, SQL, constraint names, environment values and wrapped causes must not
 * cross it. Only `code`, a safe `message`, optional field-level validation
 * detail, and the `requestId` are serialised.
 */

import { logger as defaultLogger, type Logger } from "@/lib/logger";
import { AppError, ERROR_CODES, ValidationError, isAppError } from "./app-error";

/** The single error shape returned by every CloverCode endpoint. */
export interface ErrorResponseBody {
  readonly error: {
    readonly code: string;
    readonly message: string;
    /** Present only for validation failures. */
    readonly details?: Readonly<Record<string, readonly string[]>>;
    readonly requestId: string;
  };
}

const GENERIC_MESSAGE = "An unexpected error occurred. Please try again.";

export interface SerializeErrorResult {
  readonly status: number;
  readonly body: ErrorResponseBody;
}

/**
 * Produces the public payload for an error. Pure: performs no logging and no
 * I/O, so it can be asserted on directly.
 */
export function serializeError(error: unknown, requestId: string): SerializeErrorResult {
  if (isAppError(error) && error.isOperational) {
    return {
      status: error.httpStatus,
      body: {
        error: {
          code: error.code,
          message: error.publicMessage,
          ...(error instanceof ValidationError ? { details: error.fieldErrors } : {}),
          requestId,
        },
      },
    };
  }

  // Non-operational AppErrors (configuration defects) and anything that is not
  // an AppError at all are bugs. The caller learns nothing beyond "500".
  return {
    status: 500,
    body: {
      error: {
        code: ERROR_CODES.INTERNAL_ERROR,
        message: GENERIC_MESSAGE,
        requestId,
      },
    },
  };
}

export interface ToErrorResponseOptions {
  readonly requestId: string;
  readonly logger?: Logger;
  /** Extra context for the log record only. Never serialised. */
  readonly context?: Readonly<Record<string, unknown>>;
}

/**
 * Logs the technical detail and returns the safe HTTP response.
 *
 * Operational errors are expected outcomes and log at `warn`; everything else
 * is a defect and logs at `error`.
 */
export function toErrorResponse(error: unknown, options: ToErrorResponseOptions): Response {
  const { requestId, context } = options;
  const log = options.logger ?? defaultLogger;
  const { status, body } = serializeError(error, requestId);

  const operational = isAppError(error) && error.isOperational;
  const logContext = {
    requestId,
    status,
    ...(context ?? {}),
    ...(isAppError(error) ? { code: error.code, ...(error.context ?? {}) } : {}),
    error,
  };

  if (operational) {
    log.warn("app.error.operational", logContext);
  } else {
    log.error("app.error.unhandled", logContext);
  }

  return Response.json(body, {
    status,
    headers: {
      // An error body is never a cacheable artefact.
      "Cache-Control": "no-store",
      "X-Request-Id": requestId,
    },
  });
}

/**
 * Normalises an unknown thrown value into an `Error`, preserving the original
 * as `cause`. Useful when catching from third-party code that may throw
 * strings or plain objects.
 */
export function toError(value: unknown): Error {
  if (value instanceof Error) return value;
  return new AppError(
    typeof value === "string" ? value : "Non-Error value was thrown.",
    ERROR_CODES.INTERNAL_ERROR,
    500,
    { cause: value },
    false,
  );
}
