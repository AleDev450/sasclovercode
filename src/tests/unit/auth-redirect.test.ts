import { describe, expect, it } from "vitest";
import {
  DEFAULT_SIGNED_IN_PATH,
  SIGN_IN_PATH,
  safeRedirectPath,
  signInPathWithReturnTo,
} from "@/lib/auth/redirect";

/**
 * TEST-201 - open redirect prevention.
 *
 * `next` arrives in a query string, so every value here is something an
 * attacker can put in a link. A single accepted absolute URL turns the sign-in
 * page into a credible phishing hop.
 */
describe("safeRedirectPath: rejects anything that is not a local path", () => {
  it.each([
    ["an absolute https URL", "https://evil.example/steal"],
    ["an absolute http URL", "http://evil.example"],
    ["a protocol-relative URL", "//evil.example"],
    ["a backslash authority", "/\\evil.example"],
    ["a backslash pair", "\\\\evil.example"],
    ["a javascript scheme", "javascript:alert(1)"],
    ["a data scheme", "data:text/html,<script>alert(1)</script>"],
    ["a relative path", "dashboard"],
    ["a parent-relative path", "../admin"],
    ["an empty string", ""],
    ["whitespace only", "   "],
    ["null", null],
    ["undefined", undefined],
  ])("falls back for %s", (_label, input) => {
    expect(safeRedirectPath(input)).toBe(DEFAULT_SIGNED_IN_PATH);
  });

  it("rejects percent-encoding that hides a protocol-relative URL", () => {
    // `/%2f%2fevil.example` passes a naive "starts with a single slash" check
    // and is then decoded by the browser into `//evil.example`.
    expect(safeRedirectPath("/%2f%2fevil.example")).toBe(DEFAULT_SIGNED_IN_PATH);
    expect(safeRedirectPath("/%2F%2Fevil.example")).toBe(DEFAULT_SIGNED_IN_PATH);
    expect(safeRedirectPath("/%5Cevil.example")).toBe(DEFAULT_SIGNED_IN_PATH);
  });

  it("rejects malformed percent-encoding rather than guessing", () => {
    expect(safeRedirectPath("/%E0%A4%A")).toBe(DEFAULT_SIGNED_IN_PATH);
  });

  it("rejects a control character that could split a Location header", () => {
    expect(safeRedirectPath("/dashboard\r\nSet-Cookie: a=b")).toBe(DEFAULT_SIGNED_IN_PATH);
    expect(safeRedirectPath("/dashboard\nX: 1")).toBe(DEFAULT_SIGNED_IN_PATH);
  });
});

describe("safeRedirectPath: accepts genuine local paths", () => {
  it.each(["/dashboard", "/dashboard/orders", "/dashboard?tab=today", "/dashboard#section", "/"])(
    "keeps %j",
    (input) => {
      expect(safeRedirectPath(input)).toBe(input);
    },
  );

  it("uses the supplied fallback rather than the default", () => {
    expect(safeRedirectPath("https://evil.example", "/somewhere")).toBe("/somewhere");
  });
});

describe("signInPathWithReturnTo", () => {
  it("encodes the target so it survives as one parameter", () => {
    expect(signInPathWithReturnTo("/dashboard/orders", "?status=open")).toBe(
      "/login?next=%2Fdashboard%2Forders%3Fstatus%3Dopen",
    );
  });

  it("does not point the sign-in page back at itself", () => {
    expect(signInPathWithReturnTo(SIGN_IN_PATH)).toBe(SIGN_IN_PATH);
    expect(signInPathWithReturnTo(SIGN_IN_PATH, "?next=%2Fx")).toBe(SIGN_IN_PATH);
  });

  it("round-trips through safeRedirectPath", () => {
    const url = new URL(signInPathWithReturnTo("/dashboard/orders"), "https://app.example");
    expect(safeRedirectPath(url.searchParams.get("next"))).toBe("/dashboard/orders");
  });
});
