/**
 * Domain error hierarchy for CloverCode.
 *
 * CLOVERCODE_MASTER.md section 15: the user receives an understandable message,
 * the logs receive the technical detail, and internal detail is never returned
 * to the caller.
 *
 * Every error carries three separate things:
 *
 *   `message`        technical, for logs and for developers. May contain detail.
 *   `publicMessage`  safe to render to an end user. Never contains detail.
 *   `code`           stable machine-readable identifier, safe to expose.
 */

/** Stable, machine-readable error codes. Never renumber or reuse a code. */
export const ERROR_CODES = {
  VALIDATION_ERROR: "VALIDATION_ERROR",
  AUTHENTICATION_ERROR: "AUTHENTICATION_ERROR",
  AUTHORIZATION_ERROR: "AUTHORIZATION_ERROR",
  NOT_FOUND: "NOT_FOUND",
  CONFLICT: "CONFLICT",
  EXTERNAL_SERVICE_ERROR: "EXTERNAL_SERVICE_ERROR",
  DATABASE_ERROR: "DATABASE_ERROR",
  CONFIGURATION_ERROR: "CONFIGURATION_ERROR",
  INTERNAL_ERROR: "INTERNAL_ERROR",
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

/** Structured context attached to an error for logging purposes only. */
export type ErrorContext = Readonly<Record<string, unknown>>;

export interface AppErrorOptions {
  /** Safe to show to an end user. Falls back to a generic per-type message. */
  readonly publicMessage?: string;
  /** Logged, never serialised into an HTTP response. */
  readonly context?: ErrorContext;
  /** Original error being wrapped. Preserved for the log, never exposed. */
  readonly cause?: unknown;
}

/**
 * Base class for every expected error in the system.
 *
 * `isOperational = true` means "this is a known outcome, not a bug". Anything
 * that is not an operational AppError is treated as a defect: it is logged at
 * `error` level and reported to the caller as a generic 500.
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly httpStatus: number;
  readonly isOperational: boolean;
  readonly publicMessage: string;
  readonly context: ErrorContext | undefined;

  constructor(
    message: string,
    code: ErrorCode,
    httpStatus: number,
    options: AppErrorOptions = {},
    isOperational = true,
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });

    this.name = new.target.name;
    this.code = code;
    this.httpStatus = httpStatus;
    this.isOperational = isOperational;
    this.publicMessage = options.publicMessage ?? message;
    this.context = options.context;

    // Keep the subclass prototype chain intact when compiled down.
    Object.setPrototypeOf(this, new.target.prototype);

    // V8 only: drop this constructor from the captured stack.
    const captureStackTrace = (
      Error as unknown as {
        captureStackTrace?: (target: object, constructorOpt?: unknown) => void;
      }
    ).captureStackTrace;
    if (typeof captureStackTrace === "function") {
      captureStackTrace(this, new.target);
    }
  }
}

/** Input failed validation. Carries per-field detail, safe to return. */
export class ValidationError extends AppError {
  /** Field-level detail. This is the ONLY error detail exposed to the caller. */
  readonly fieldErrors: Readonly<Record<string, readonly string[]>>;

  constructor(
    message = "The submitted data is invalid.",
    fieldErrors: Readonly<Record<string, readonly string[]>> = {},
    options: AppErrorOptions = {},
  ) {
    super(message, ERROR_CODES.VALIDATION_ERROR, 422, {
      publicMessage: "The submitted data is invalid.",
      ...options,
    });
    this.fieldErrors = fieldErrors;
  }
}

/** No valid session, or the session could not be verified. */
export class AuthenticationError extends AppError {
  constructor(message = "Authentication required.", options: AppErrorOptions = {}) {
    super(message, ERROR_CODES.AUTHENTICATION_ERROR, 401, {
      publicMessage: "You need to sign in to continue.",
      ...options,
    });
  }
}

/** Valid session, insufficient permission. Never leaks what was protected. */
export class AuthorizationError extends AppError {
  constructor(message = "Permission denied.", options: AppErrorOptions = {}) {
    super(message, ERROR_CODES.AUTHORIZATION_ERROR, 403, {
      publicMessage: "You do not have permission to perform this action.",
      ...options,
    });
  }
}

/**
 * Resource does not exist, or the caller is not allowed to know that it does.
 *
 * Cross-tenant reads must surface as NotFound rather than Forbidden, so that a
 * tenant cannot probe for the existence of another tenant's records.
 */
export class NotFoundError extends AppError {
  constructor(resource = "Resource", identifier?: string, options: AppErrorOptions = {}) {
    const message =
      identifier === undefined ? `${resource} not found.` : `${resource} not found: ${identifier}`;
    super(message, ERROR_CODES.NOT_FOUND, 404, {
      publicMessage: `${resource} not found.`,
      ...options,
    });
  }
}

/** Uniqueness violation or an operation invalid for the current state. */
export class ConflictError extends AppError {
  constructor(
    message = "The request conflicts with the current state.",
    options: AppErrorOptions = {},
  ) {
    super(message, ERROR_CODES.CONFLICT, 409, {
      publicMessage: message,
      ...options,
    });
  }
}

/** A third-party dependency failed (payment gateway, SUNAT, email, ...). */
export class ExternalServiceError extends AppError {
  readonly service: string;

  constructor(
    service: string,
    message = `The ${service} service is unavailable.`,
    options: AppErrorOptions = {},
  ) {
    super(message, ERROR_CODES.EXTERNAL_SERVICE_ERROR, 502, {
      publicMessage: "An external service is temporarily unavailable. Please try again.",
      ...options,
    });
    this.service = service;
  }
}

/**
 * PostgreSQL or Supabase failed.
 *
 * The public message is deliberately generic: SQL text, column names and
 * constraint names must never reach the caller.
 */
export class DatabaseError extends AppError {
  constructor(message = "Database operation failed.", options: AppErrorOptions = {}) {
    super(message, ERROR_CODES.DATABASE_ERROR, 500, {
      publicMessage: "A data error occurred. Please try again.",
      ...options,
    });
  }
}

/**
 * The application is misconfigured (missing or invalid environment variable).
 *
 * Non-operational on purpose: this is a deployment defect, not a user outcome,
 * and must be loud in the logs.
 */
export class ConfigurationError extends AppError {
  constructor(message = "Invalid application configuration.", options: AppErrorOptions = {}) {
    super(
      message,
      ERROR_CODES.CONFIGURATION_ERROR,
      500,
      { publicMessage: "The application is not correctly configured.", ...options },
      false,
    );
  }
}

/** Narrowing helper. Safe against errors crossing realm boundaries. */
export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}
