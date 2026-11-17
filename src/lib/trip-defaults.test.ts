import { describe, expect, it } from "vitest";
import { applyTripDefaults, remainingTripDefaults, type TripDefaults } from "./trip-defaults";

const defaults: TripDefaults = {
  depositCents: 5000,
  cancellationWindowHours: 24,
  minimumBookings: 4,
  snorkelerPriceCents: 0,
  riderPriceCents: null,
  lensId: "tag",
};

describe("trip defaults", () => {
  it("copies defaults while preserving an explicit zero or clear", () => {
    expect(applyTripDefaults(defaults, { depositCents: 0, lensId: null })).toEqual({
      values: { ...defaults, depositCents: 0, lensId: null },
      inherited: ["cancellationWindowHours", "minimumBookings", "snorkelerPriceCents"],
    });
  });

  it("drops only fields actually changed by an edit", () => {
    expect(
      remainingTripDefaults(["depositCents", "minimumBookings", "snorkelerPriceCents"], defaults, {
        depositCents: 5000,
        minimumBookings: null,
      }),
    ).toEqual(["depositCents", "snorkelerPriceCents"]);
  });
});
