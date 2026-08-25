import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ValidationError, isAppError, serializeError } from "@/lib/errors";
import { parseOrThrow, toFieldErrors } from "@/lib/validation";

const tenantSchema = z.object({
  name: z.string().min(2, "Name must have at least 2 characters."),
  slug: z
    .string()
    .min(1, "Slug is required.")
    .regex(/^[a-z0-9-]+$/, "Slug may only contain lowercase letters, numbers and hyphens."),
  contact: z.object({
    email: z.email("Email is invalid."),
  }),
});

describe("parseOrThrow (TEST-006)", () => {
  it("returns the parsed, typed value for valid input", () => {
    const parsed = parseOrThrow(tenantSchema, {
      name: "Sugu Rolls",
      slug: "sugurolls",
      contact: { email: "owner@sugurolls.com" },
    });

    expect(parsed.slug).toBe("sugurolls");
    expect(parsed.contact.email).toBe("owner@sugurolls.com");
  });

  it("applies schema transforms and defaults", () => {
    const schema = z.object({ page: z.coerce.number().default(1) });
    expect(parseOrThrow(schema, {}).page).toBe(1);
    expect(parseOrThrow(schema, { page: "3" }).page).toBe(3);
  });
});

describe("parseOrThrow (TEST-007)", () => {
  it("throws a ValidationError carrying per-field detail", () => {
    let thrown: unknown;
    try {
      parseOrThrow(tenantSchema, { name: "S", slug: "Not Valid", contact: { email: "nope" } });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ValidationError);
    expect(isAppError(thrown)).toBe(true);

    const error = thrown as ValidationError;
    expect(error.httpStatus).toBe(422);
    expect(Object.keys(error.fieldErrors).sort()).toEqual(["contact.email", "name", "slug"]);
    expect(error.fieldErrors.slug).toContain(
      "Slug may only contain lowercase letters, numbers and hyphens.",
    );
  });

  it("does not attach the raw input, which may contain credentials", () => {
    let thrown: ValidationError | undefined;
    try {
      parseOrThrow(z.object({ email: z.email() }), {
        email: "bad",
        password: "hunter2",
      });
    } catch (error) {
      thrown = error as ValidationError;
    }

    expect(JSON.stringify(thrown?.context)).not.toContain("hunter2");
  });

  it("produces a response that exposes the field detail and nothing else", () => {
    let thrown: unknown;
    try {
      parseOrThrow(tenantSchema, {});
    } catch (error) {
      thrown = error;
    }

    const { status, body } = serializeError(thrown, "req-1");
    expect(status).toBe(422);
    expect(body.error.message).toBe("The submitted data is invalid.");
    expect(body.error.details).toBeDefined();
  });
});

describe("toFieldErrors", () => {
  it("joins nested paths with a dot", () => {
    const result = tenantSchema.safeParse({
      name: "Sugu Rolls",
      slug: "sugurolls",
      contact: { email: "nope" },
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(toFieldErrors(result.error)).toEqual({ "contact.email": ["Email is invalid."] });
  });

  it("groups path-less issues under _form", () => {
    const schema = z
      .object({ start: z.number(), end: z.number() })
      .refine((value) => value.end > value.start, { message: "End must be after start." });

    const result = schema.safeParse({ start: 5, end: 1 });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(toFieldErrors(result.error)._form).toEqual(["End must be after start."]);
  });

  it("collects several messages for the same field", () => {
    const schema = z.object({
      slug: z
        .string()
        .min(5, "Too short.")
        .regex(/^[a-z]+$/, "Lowercase letters only."),
    });

    const result = schema.safeParse({ slug: "A1" });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(toFieldErrors(result.error).slug).toEqual(["Too short.", "Lowercase letters only."]);
  });
});
