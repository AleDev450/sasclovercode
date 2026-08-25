import { describe, expect, it } from "vitest";
import {
  emailSchema,
  newPasswordSchema,
  requestPasswordResetSchema,
  signInSchema,
  updatePasswordSchema,
} from "@/lib/auth/schemas";

describe("emailSchema", () => {
  it("normalises case and surrounding whitespace", () => {
    // Sign-in must not fail because a phone keyboard capitalised the address.
    expect(emailSchema.parse("  Ana@SuguRolls.COM  ")).toBe("ana@sugurolls.com");
  });

  it.each(["", "   ", "not-an-email", "ana@", "@sugurolls.com", "ana sugurolls.com"])(
    "rejects %j",
    (input) => {
      expect(emailSchema.safeParse(input).success).toBe(false);
    },
  );

  it("rejects an address beyond the maximum length", () => {
    expect(emailSchema.safeParse(`${"a".repeat(320)}@sugurolls.com`).success).toBe(false);
  });
});

describe("signInSchema", () => {
  it("accepts a valid pair", () => {
    const result = signInSchema.parse({ email: "Ana@Sugurolls.com", password: "hunter2!" });
    expect(result).toEqual({ email: "ana@sugurolls.com", password: "hunter2!" });
  });

  it("does NOT apply the new-password strength rules", () => {
    // An existing short password must still be able to sign in. Rejecting it
    // here would also tell an attacker which candidates are not worth trying.
    expect(signInSchema.safeParse({ email: "ana@sugurolls.com", password: "abc" }).success).toBe(
      true,
    );
  });

  it("requires a password to be present", () => {
    expect(signInSchema.safeParse({ email: "ana@sugurolls.com", password: "" }).success).toBe(
      false,
    );
  });

  it("bounds the password length, so a huge body cannot be forced through", () => {
    const result = signInSchema.safeParse({
      email: "ana@sugurolls.com",
      password: "a".repeat(129),
    });
    expect(result.success).toBe(false);
  });

  it("does not trim the password", () => {
    // A leading or trailing space is a legitimate part of a password.
    expect(signInSchema.parse({ email: "ana@sugurolls.com", password: " pass " }).password).toBe(
      " pass ",
    );
  });
});

describe("newPasswordSchema", () => {
  it("requires at least 8 characters", () => {
    expect(newPasswordSchema.safeParse("1234567").success).toBe(false);
    expect(newPasswordSchema.safeParse("12345678").success).toBe(true);
  });

  it("does not impose composition rules", () => {
    // Length is what correlates with strength; symbol rules push people towards
    // `Password1!`. This asserts the decision rather than merely reflecting it.
    expect(newPasswordSchema.safeParse("correct horse battery staple").success).toBe(true);
  });
});

describe("updatePasswordSchema", () => {
  it("accepts a matching pair", () => {
    const result = updatePasswordSchema.safeParse({
      password: "una-clave-larga",
      confirmPassword: "una-clave-larga",
    });
    expect(result.success).toBe(true);
  });

  it("reports a mismatch on the confirm field, where the user must fix it", () => {
    const result = updatePasswordSchema.safeParse({
      password: "una-clave-larga",
      confirmPassword: "otra-clave-larga",
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.map((issue) => issue.path.join("."))).toContain("confirmPassword");
  });

  it("applies the strength rule to the new password", () => {
    const result = updatePasswordSchema.safeParse({ password: "short", confirmPassword: "short" });
    expect(result.success).toBe(false);
  });
});

describe("requestPasswordResetSchema", () => {
  it("normalises the address the same way sign-in does", () => {
    expect(requestPasswordResetSchema.parse({ email: " Ana@Sugurolls.com " })).toEqual({
      email: "ana@sugurolls.com",
    });
  });
});
