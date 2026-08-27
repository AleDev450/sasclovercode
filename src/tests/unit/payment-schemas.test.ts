import { describe, expect, it } from "vitest";
import {
  closeCashSessionSchema,
  createPaymentMethodSchema,
  openCashSessionSchema,
  recordCashMovementSchema,
  recordPaymentSchema,
  voidPaymentSchema,
} from "@/modules/payments/schemas";

/**
 * Phase 14 - the form contract.
 *
 * The property worth stating first, same posture as `order-schemas.test.ts`:
 * a payment's amount IS accepted from the caller (there is no catalogue price
 * it could disagree with), but nothing a trigger computes has a matching
 * field here. There is no `voidedAt` on the record schema, and no
 * `expectedCents`/`differenceCents` on the close schema.
 */

const orderId = "11111111-1111-4111-8111-111111111111";
const methodId = "22222222-2222-4222-8222-222222222222";
const sessionId = "33333333-3333-4333-8333-333333333333";

describe("recording a payment carries no computed field", () => {
  const basePayment = {
    orderId,
    paymentMethodId: methodId,
    cashSessionId: "",
    amount: "10.00",
    reference: "",
    notes: "",
  };

  it("has exactly the fields a cashier fills in", () => {
    const result = recordPaymentSchema.parse({ ...basePayment, amount: "50.00" });
    expect(Object.keys(result).sort()).toEqual(
      ["orderId", "paymentMethodId", "cashSessionId", "amount", "reference", "notes"].sort(),
    );
    expect(result).not.toHaveProperty("voidedAt");
    expect(result).not.toHaveProperty("tenantId");
  });

  it("parses money into integer cents", () => {
    expect(recordPaymentSchema.parse({ ...basePayment, amount: "24.90" }).amount).toBe(2490);
  });

  it("refuses a zero or empty amount: a payment states that money moved", () => {
    for (const amount of ["", "0", "0.00"]) {
      expect(recordPaymentSchema.safeParse({ ...basePayment, amount }).success, amount).toBe(false);
    }
  });

  it("treats a blank cash session as absent, not as an error", () => {
    const result = recordPaymentSchema.parse(basePayment);
    expect(result.cashSessionId).toBeNull();
  });

  it("does not itself enforce the cash/session rule: that lives in guard_payment()", () => {
    // A non-cash method with a session, or cash with none, both PARSE fine.
    // Refusing them is the database's job (AB) - duplicating it here would be
    // a second copy that can drift from Phase 15's POS, which never touches
    // this schema.
    const result = recordPaymentSchema.safeParse({ ...basePayment, cashSessionId: sessionId });
    expect(result.success).toBe(true);
  });
});

describe("voiding a payment", () => {
  it("requires a reason", () => {
    expect(voidPaymentSchema.safeParse({ paymentId: orderId, reason: "" }).success).toBe(false);
    expect(voidPaymentSchema.safeParse({ paymentId: orderId, reason: "  " }).success).toBe(false);
    expect(
      voidPaymentSchema.safeParse({ paymentId: orderId, reason: "monto mal ingresado" }).success,
    ).toBe(true);
  });
});

describe("payment methods", () => {
  const baseMethod = { type: "cash", name: "Metodo", reference: "" };

  it("accepts one of the six types from master section 14", () => {
    for (const type of ["cash", "yape", "plin", "card", "transfer", "other"]) {
      expect(createPaymentMethodSchema.safeParse({ ...baseMethod, type }).success, type).toBe(true);
    }
  });

  it("refuses a type outside that list", () => {
    expect(
      createPaymentMethodSchema.safeParse({ ...baseMethod, type: "bitcoin", name: "Cripto" }).success,
    ).toBe(false);
  });

  it("requires a name", () => {
    expect(createPaymentMethodSchema.safeParse({ ...baseMethod, name: "" }).success).toBe(false);
  });
});

describe("opening a cash session", () => {
  const baseSession = { cashRegisterId: methodId, opening: "0", notes: "" };

  it("accepts an opening amount of zero: some businesses start with nothing in the drawer", () => {
    const result = openCashSessionSchema.parse(baseSession);
    expect(result.opening).toBe(0);
  });

  it("refuses a negative opening amount", () => {
    expect(openCashSessionSchema.safeParse({ ...baseSession, opening: "-10" }).success).toBe(false);
  });
});

describe("closing a cash session carries only what a cashier counts", () => {
  it("has no expected or difference field: those are computed by close_cash_session()", () => {
    const result = closeCashSessionSchema.parse({ cashSessionId: sessionId, closing: "150.00" });
    expect(Object.keys(result).sort()).toEqual(["cashSessionId", "closing"]);
    expect(result).not.toHaveProperty("expectedCents");
    expect(result).not.toHaveProperty("differenceCents");
  });

  it("accepts a closing count of zero", () => {
    expect(closeCashSessionSchema.parse({ cashSessionId: sessionId, closing: "0" }).closing).toBe(
      0,
    );
  });
});

describe("a manual cash movement", () => {
  it("accepts a leading minus sign for a downward adjustment", () => {
    const result = recordCashMovementSchema.parse({
      cashSessionId: sessionId,
      type: "adjustment",
      amount: "-15.00",
      reason: "conteo corregido",
    });
    expect(result.amount).toBe(-1500);
  });

  it("accepts a positive amount for a deposit", () => {
    const result = recordCashMovementSchema.parse({
      cashSessionId: sessionId,
      type: "deposit",
      amount: "100.00",
      reason: "refuerzo de caja",
    });
    expect(result.amount).toBe(10000);
  });

  it("refuses a zero amount: a movement that moves nothing is not a movement", () => {
    expect(
      recordCashMovementSchema.safeParse({
        cashSessionId: sessionId,
        type: "payout",
        amount: "0",
        reason: "x",
      }).success,
    ).toBe(false);
  });

  it("refuses `sale`: that type is written only by the trigger on payments", () => {
    expect(
      recordCashMovementSchema.safeParse({
        cashSessionId: sessionId,
        type: "sale",
        amount: "10.00",
        reason: "x",
      }).success,
    ).toBe(false);
  });

  it("requires a reason", () => {
    expect(
      recordCashMovementSchema.safeParse({
        cashSessionId: sessionId,
        type: "payout",
        amount: "10.00",
        reason: "",
      }).success,
    ).toBe(false);
  });
});
