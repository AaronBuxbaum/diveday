import { describe, expect, it } from "vitest";
import type { TripRequirement } from "@/db/schema";
import { buildCheckInChecks } from "./check-in";
import type { ReadinessResult } from "./readiness";

function requirement(overrides: Partial<TripRequirement> = {}): TripRequirement {
  return {
    shopId: "shop",
    tripId: "trip",
    requiresWaiver: true,
    minimumCertificationLevel: "open_water",
    requiredSpecialties: [],
    requiresNitrox: false,
    requiresPayment: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as TripRequirement;
}

const ready: ReadinessResult = { status: "ready", blockers: [] };

describe("buildCheckInChecks", () => {
  it("ticks every gated category for a ready diver", () => {
    const checks = buildCheckInChecks(requirement(), ready);
    expect(checks.map((c) => c.category)).toEqual(["waiver", "certification", "payment"]);
    expect(checks.every((c) => c.ok)).toBe(true);
  });

  it("only shows the categories the trip gates on", () => {
    const checks = buildCheckInChecks(
      requirement({ minimumCertificationLevel: null, requiresPayment: false }),
      ready,
    );
    expect(checks.map((c) => c.category)).toEqual(["waiver"]);
  });

  it("carries the staff blocker reason on a failed check", () => {
    const checks = buildCheckInChecks(requirement(), {
      status: "blocked",
      blockers: [
        { code: "waiver_pending", message: "Waiver is waiting for the diver’s signature." },
      ],
    });
    const waiver = checks.find((c) => c.category === "waiver");
    expect(waiver?.ok).toBe(false);
    expect(waiver?.detail).toContain("waiting for the diver");
    // Other gated categories stay clear.
    expect(checks.find((c) => c.category === "payment")?.ok).toBe(true);
  });

  it("returns nothing when the trip has no requirement configured", () => {
    expect(buildCheckInChecks(null, ready)).toEqual([]);
  });
});
