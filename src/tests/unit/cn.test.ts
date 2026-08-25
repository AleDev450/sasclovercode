import { describe, expect, it } from "vitest";
import { cn } from "@/lib/utils";

describe("cn (TEST-018)", () => {
  it("joins class names", () => {
    expect(cn("flex", "items-center")).toBe("flex items-center");
  });

  it("resolves conflicting Tailwind utilities in favour of the last one", () => {
    expect(cn("px-2", "px-4")).toBe("px-4");
    expect(cn("text-sm text-muted-foreground", "text-base")).toBe(
      "text-muted-foreground text-base",
    );
  });

  it("drops falsy values", () => {
    expect(cn("flex", false, null, undefined, "", "gap-2")).toBe("flex gap-2");
  });

  it("supports conditional object and array syntax", () => {
    expect(cn(["flex", { hidden: false, "gap-2": true }])).toBe("flex gap-2");
  });

  it("lets a caller-supplied class win over a component default", () => {
    const base = "rounded-md bg-primary";
    expect(cn(base, "bg-destructive")).toBe("rounded-md bg-destructive");
  });
});
