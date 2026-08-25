import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { assertEnvIsValid, getPublicEnv, getServerEnv, resetEnvCache } from "@/config/env";
import { ConfigurationError, isAppError } from "@/lib/errors";

const KEYS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "NEXT_PUBLIC_APP_URL",
  "LOG_LEVEL",
] as const;

const original: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of KEYS) original[key] = process.env[key];
  resetEnvCache();
});

afterEach(() => {
  for (const key of KEYS) {
    const value = original[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  resetEnvCache();
});

function setValidEnv(): void {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://abcdefghijklmnop.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_abc123";
  process.env.NEXT_PUBLIC_APP_URL = "https://app.clovercode.com";
}

describe("valid configuration (TEST-015)", () => {
  it("accepts a complete configuration", () => {
    setValidEnv();
    const env = getPublicEnv();

    expect(env.NEXT_PUBLIC_SUPABASE_URL).toBe("https://abcdefghijklmnop.supabase.co");
    expect(env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY).toBe("sb_publishable_abc123");
    expect(env.NEXT_PUBLIC_APP_URL).toBe("https://app.clovercode.com");
  });

  it("defaults NEXT_PUBLIC_APP_URL when absent", () => {
    setValidEnv();
    delete process.env.NEXT_PUBLIC_APP_URL;
    resetEnvCache();

    expect(getPublicEnv().NEXT_PUBLIC_APP_URL).toBe("http://localhost:3000");
  });

  it("memoises the result", () => {
    setValidEnv();
    expect(getPublicEnv()).toBe(getPublicEnv());
  });

  it("exposes server configuration alongside the public values", () => {
    setValidEnv();
    process.env.LOG_LEVEL = "warn";

    const env = getServerEnv();
    expect(env.LOG_LEVEL).toBe("warn");
    expect(env.NEXT_PUBLIC_SUPABASE_URL).toBe("https://abcdefghijklmnop.supabase.co");
  });
});

describe("invalid configuration (TEST-016)", () => {
  it("rejects a malformed Supabase URL", () => {
    setValidEnv();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "not-a-url";
    resetEnvCache();

    expect(() => getPublicEnv()).toThrow(ConfigurationError);
  });

  it("rejects a missing publishable key", () => {
    setValidEnv();
    delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    resetEnvCache();

    expect(() => getPublicEnv()).toThrow(ConfigurationError);
  });

  it("treats an empty or whitespace-only value as absent (EC-03)", () => {
    setValidEnv();
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "   ";
    resetEnvCache();

    expect(() => getPublicEnv()).toThrow(ConfigurationError);
  });

  it("rejects an unknown LOG_LEVEL", () => {
    setValidEnv();
    process.env.LOG_LEVEL = "chatty";
    resetEnvCache();

    expect(() => getServerEnv()).toThrow(ConfigurationError);
  });
});

describe("configuration error content (TEST-017)", () => {
  it("names the failing keys and never prints their values", () => {
    setValidEnv();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://";
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_super_secret_value";
    resetEnvCache();

    let thrown: unknown;
    try {
      getPublicEnv();
    } catch (error) {
      thrown = error;
    }

    expect(isAppError(thrown)).toBe(true);
    const error = thrown as ConfigurationError;

    expect(error.message).toContain("NEXT_PUBLIC_SUPABASE_URL");
    expect(error.message).not.toContain("sb_publishable_super_secret_value");
    expect(JSON.stringify(error.context)).not.toContain("sb_publishable_super_secret_value");
  });

  it("is non-operational, so it is never surfaced verbatim to a caller", () => {
    setValidEnv();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "nope";
    resetEnvCache();

    try {
      getPublicEnv();
      expect.unreachable("getPublicEnv should have thrown");
    } catch (error) {
      expect((error as ConfigurationError).isOperational).toBe(false);
      expect((error as ConfigurationError).httpStatus).toBe(500);
    }
  });
});

describe("lazy evaluation (EC-02)", () => {
  it("does not validate on import, so a build without credentials still works", async () => {
    for (const key of KEYS) delete process.env[key];
    resetEnvCache();

    // A fresh import with no configuration present must not throw.
    await expect(import("@/config/env")).resolves.toBeDefined();
  });
});

describe("assertEnvIsValid (audit: exported API was untested)", () => {
  it("returns without throwing on a complete configuration", () => {
    setValidEnv();
    resetEnvCache();
    expect(() => assertEnvIsValid()).not.toThrow();
  });

  it("throws a ConfigurationError when a required variable is missing", () => {
    setValidEnv();
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    resetEnvCache();
    expect(() => assertEnvIsValid()).toThrow(ConfigurationError);
  });

  it("validates the server scope as well as the public one", () => {
    setValidEnv();
    process.env.LOG_LEVEL = "verbose";
    resetEnvCache();
    expect(() => assertEnvIsValid()).toThrow(ConfigurationError);
  });
});
