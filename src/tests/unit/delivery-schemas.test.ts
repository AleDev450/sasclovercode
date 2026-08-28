import { describe, expect, it } from "vitest";
import {
  advanceDeliveryStatusSchema,
  attachDeliverySchema,
  closeDeliverySchema,
  createDeliveryZoneSchema,
  saveDeliveryRateSchema,
  updateDeliveryFeeSchema,
} from "@/modules/delivery/schemas";

const UUID = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

/** The fields the attach form always sends, so a case can override just one. */
function attachInput(overrides: Record<string, string> = {}) {
  return {
    orderId: UUID,
    zoneId: OTHER,
    addressLine: "Av. Larco 123",
    district: "",
    city: "",
    reference: "",
    recipientName: "",
    recipientPhone: "",
    notes: "",
    latitude: "",
    longitude: "",
    ...overrides,
  };
}

describe("delivery schemas (TEST-1903)", () => {
  describe("zones", () => {
    it("accepts a zone with only a name", () => {
      const parsed = createDeliveryZoneSchema.safeParse({
        name: "Miraflores",
        district: "",
        notes: "",
      });
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.name).toBe("Miraflores");
        // Blank optional text becomes NULL, not an empty string: the database
        // stores "unknown" once, not two ways.
        expect(parsed.data.district).toBeNull();
      }
    });

    it("rejects a blank name", () => {
      expect(
        createDeliveryZoneSchema.safeParse({ name: "   ", district: "", notes: "" }).success,
      ).toBe(false);
    });

    it("rejects a name over the column limit", () => {
      const parsed = createDeliveryZoneSchema.safeParse({
        name: "x".repeat(81),
        district: "",
        notes: "",
      });
      expect(parsed.success).toBe(false);
    });
  });

  describe("rates", () => {
    it("reads a typed amount as integer cents", () => {
      const parsed = saveDeliveryRateSchema.safeParse({
        zoneId: UUID,
        locationId: "",
        feeCents: "8.50",
        minOrderFreeCents: "",
        estimatedMinutes: "",
      });
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.feeCents).toBe(850);
        expect(parsed.data.locationId).toBeNull();
        expect(parsed.data.minOrderFreeCents).toBeNull();
        expect(parsed.data.estimatedMinutes).toBeNull();
      }
    });

    it("accepts a comma as the decimal separator", () => {
      const parsed = saveDeliveryRateSchema.safeParse({
        zoneId: UUID,
        locationId: "",
        feeCents: "8,50",
        minOrderFreeCents: "",
        estimatedMinutes: "",
      });
      expect(parsed.success && parsed.data.feeCents).toBe(850);
    });

    it("accepts a zero fee: a zone can always be free", () => {
      const parsed = saveDeliveryRateSchema.safeParse({
        zoneId: UUID,
        locationId: "",
        feeCents: "0",
        minOrderFreeCents: "",
        estimatedMinutes: "",
      });
      expect(parsed.success && parsed.data.feeCents).toBe(0);
    });

    it("rejects a malformed amount", () => {
      for (const fee of ["ocho", "8.505", "-8", "", "8.5.0"]) {
        const parsed = saveDeliveryRateSchema.safeParse({
          zoneId: UUID,
          locationId: "",
          feeCents: fee,
          minOrderFreeCents: "",
          estimatedMinutes: "",
        });
        expect(parsed.success, `fee ${JSON.stringify(fee)} should be rejected`).toBe(false);
      }
    });

    it("rejects an estimate outside the CHECK's range", () => {
      for (const minutes of ["0", "601", "-5", "40.5"]) {
        const parsed = saveDeliveryRateSchema.safeParse({
          zoneId: UUID,
          locationId: "",
          feeCents: "8.00",
          minOrderFreeCents: "",
          estimatedMinutes: minutes,
        });
        expect(parsed.success, `minutes ${minutes} should be rejected`).toBe(false);
      }
    });

    it("rejects a location that is not a uuid", () => {
      const parsed = saveDeliveryRateSchema.safeParse({
        zoneId: UUID,
        locationId: "not-a-uuid",
        feeCents: "8.00",
        minOrderFreeCents: "",
        estimatedMinutes: "",
      });
      expect(parsed.success).toBe(false);
    });
  });

  describe("attaching a delivery", () => {
    it("accepts an address with no coordinates", () => {
      const parsed = attachDeliverySchema.safeParse(attachInput());
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.latitude).toBeNull();
        expect(parsed.data.longitude).toBeNull();
      }
    });

    it("accepts a complete coordinate pair", () => {
      const parsed = attachDeliverySchema.safeParse(
        attachInput({ latitude: "-12.121500", longitude: "-77.029700" }),
      );
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.latitude).toBeCloseTo(-12.1215);
        expect(parsed.data.longitude).toBeCloseTo(-77.0297);
      }
    });

    it("rejects half a coordinate, in both directions", () => {
      const latOnly = attachDeliverySchema.safeParse(attachInput({ latitude: "-12.1215" }));
      expect(latOnly.success).toBe(false);
      if (!latOnly.success) {
        expect(latOnly.error.issues[0]?.path).toEqual(["longitude"]);
      }

      const lngOnly = attachDeliverySchema.safeParse(attachInput({ longitude: "-77.0297" }));
      expect(lngOnly.success).toBe(false);
      if (!lngOnly.success) {
        expect(lngOnly.error.issues[0]?.path).toEqual(["latitude"]);
      }
    });

    it("rejects a coordinate out of range", () => {
      expect(
        attachDeliverySchema.safeParse(attachInput({ latitude: "91", longitude: "0" })).success,
      ).toBe(false);
      expect(
        attachDeliverySchema.safeParse(attachInput({ latitude: "0", longitude: "181" })).success,
      ).toBe(false);
    });

    it("rejects a blank address", () => {
      expect(attachDeliverySchema.safeParse(attachInput({ addressLine: "  " })).success).toBe(
        false,
      );
    });

    it("has no field for the fee: the server resolves it", () => {
      const parsed = attachDeliverySchema.safeParse({
        ...attachInput(),
        feeCents: "0.01",
      });
      expect(parsed.success).toBe(true);
      // Whatever the browser sent under that name is simply not in the output.
      if (parsed.success) {
        expect(Object.keys(parsed.data)).not.toContain("feeCents");
      }
    });
  });

  describe("closing a delivery", () => {
    it("requires a reason", () => {
      const parsed = closeDeliverySchema.safeParse({
        deliveryId: UUID,
        status: "failed",
        failureReason: "   ",
      });
      expect(parsed.success).toBe(false);
    });

    it("accepts failed and cancelled only", () => {
      expect(
        closeDeliverySchema.safeParse({
          deliveryId: UUID,
          status: "delivered",
          failureReason: "x",
        }).success,
      ).toBe(false);

      for (const status of ["failed", "cancelled"]) {
        expect(
          closeDeliverySchema.safeParse({
            deliveryId: UUID,
            status,
            failureReason: "Nadie en casa",
          }).success,
        ).toBe(true);
      }
    });
  });

  describe("advancing and correcting", () => {
    it("rejects a status outside the enum", () => {
      expect(
        advanceDeliveryStatusSchema.safeParse({ deliveryId: UUID, status: "lost" }).success,
      ).toBe(false);
    });

    it("reads a corrected fee as cents", () => {
      const parsed = updateDeliveryFeeSchema.safeParse({ deliveryId: UUID, feeCents: "12" });
      expect(parsed.success && parsed.data.feeCents).toBe(1200);
    });
  });
});
