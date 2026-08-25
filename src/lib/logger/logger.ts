/**
 * Structured logger.
 *
 * CLOVERCODE_MASTER.md section 16: every log line is a structured record, and
 * `console.log` is not used indiscriminately. ESLint enforces that rule; this
 * module is the single sanctioned exception.
 *
 * Deliberate design note: this module reads `process.env` directly instead of
 * going through `@/config/env`. The env layer reports its own failures through
 * the logger, so depending on it here would create a cycle in which a
 * misconfiguration could not be reported.
 */

import { redact } from "./redact";

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export type LogContext = Readonly<Record<string, unknown>>;

export interface LogRecord extends Record<string, unknown> {
  readonly level: LogLevel;
  readonly event: string;
  readonly timestamp: string;
}

/** Where a record ends up. Swapped in tests. */
export type LogTransport = (record: LogRecord) => void;

export interface Logger {
  debug(event: string, context?: LogContext): void;
  info(event: string, context?: LogContext): void;
  warn(event: string, context?: LogContext): void;
  error(event: string, context?: LogContext): void;
  /** Returns a logger that merges `context` into every record it emits. */
  child(context: LogContext): Logger;
}

export interface CreateLoggerOptions {
  /** Records below this level are dropped. */
  readonly level?: LogLevel;
  /** Context merged into every record. */
  readonly context?: LogContext;
  /** Defaults to the console transport. */
  readonly transport?: LogTransport;
  /** Human-readable output instead of one-line JSON. Defaults to non-production. */
  readonly pretty?: boolean;
}

function isLogLevel(value: string | undefined): value is LogLevel {
  return value === "debug" || value === "info" || value === "warn" || value === "error";
}

/** The slice of the environment this module reads. */
export interface LogEnv {
  readonly LOG_LEVEL?: string | undefined;
  readonly NODE_ENV?: string | undefined;
}

/** Resolves the minimum level from LOG_LEVEL, falling back by environment. */
export function resolveLogLevel(env: LogEnv = process.env): LogLevel {
  const configured = env.LOG_LEVEL?.trim().toLowerCase();
  if (isLogLevel(configured)) return configured;
  if (env.NODE_ENV === "test") return "warn";
  if (env.NODE_ENV === "production") return "info";
  return "debug";
}

function createConsoleTransport(pretty: boolean): LogTransport {
  return (record) => {
    let serialised: string;
    try {
      serialised = JSON.stringify(record);
    } catch {
      serialised = JSON.stringify({
        level: record.level,
        event: record.event,
        timestamp: record.timestamp,
        serialisationError: true,
      });
    }

    const line = pretty
      ? `${record.timestamp} ${record.level.toUpperCase().padEnd(5)} ${record.event} ${serialised}`
      : serialised;

    /* eslint-disable no-console */
    switch (record.level) {
      case "error":
        console.error(line);
        return;
      case "warn":
        console.warn(line);
        return;
      default:
        console.log(line);
    }
    /* eslint-enable no-console */
  };
}

export function createLogger(options: CreateLoggerOptions = {}): Logger {
  const minimumWeight = LEVEL_WEIGHT[options.level ?? resolveLogLevel()];
  const pretty = options.pretty ?? process.env.NODE_ENV !== "production";
  const transport = options.transport ?? createConsoleTransport(pretty);
  const baseContext = options.context ?? {};

  function emit(level: LogLevel, event: string, context?: LogContext): void {
    if (LEVEL_WEIGHT[level] < minimumWeight) return;

    try {
      const merged = { ...baseContext, ...(context ?? {}) };
      const redacted = redact(merged) as Record<string, unknown>;

      transport({
        level,
        event,
        timestamp: new Date().toISOString(),
        ...redacted,
      });
    } catch {
      // A logger must never break the request it is describing.
    }
  }

  return {
    debug: (event, context) => emit("debug", event, context),
    info: (event, context) => emit("info", event, context),
    warn: (event, context) => emit("warn", event, context),
    error: (event, context) => emit("error", event, context),
    child: (context) =>
      createLogger({
        ...options,
        context: { ...baseContext, ...context },
        transport,
        level: options.level ?? resolveLogLevel(),
      }),
  };
}

/** Shared application logger. Prefer `logger.child({ requestId })` per request. */
export const logger: Logger = createLogger();
