import { describe, expect, it } from "vitest";
import type { TripRequirement } from "@/db/schema";
import type { ReadinessResult } from "./readiness";
import { buildDiverChecklist, nextDiverStep } from "./readiness-summary";

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

describe("buildDiverChecklist", () => {
  it("shows only the categories this trip requires", () => {
    const items = buildDiverChecklist(
      requirement({ minimumCertificationLevel: null, requiresPayment: false }),
      ready,
    );
    expect(items.map((item) => item.category)).toEqual(["waiver"]);
  });

  it("marks a fully ready diver's items done", () => {
    const items = buildDiverChecklist(requirement(), ready);
    expect(items.every((item) => item.state === "done")).toBe(true);
    expect(items.map((item) => item.category)).toEqual(["waiver", "certification", "payment"]);
  });

  it("routes a pending waiver to the diver as an action", () => {
    const items = buildDiverChecklist(requirement(), {
      status: "blocked",
      blockers: [{ code: "waiver_pending", message: "..." }],
    });
    const waiver = items.find((item) => item.category === "waiver");
    expect(waiver?.state).toBe("action");
    expect(waiver?.detail.toLowerCase()).toContain("sign your waiver");
  });

  it("routes a card pending verification to the shop as waiting, not a diver action", () => {
    const items = buildDiverChecklist(requirement(), {
      status: "blocked",
      blockers: [{ code: "certification_pending", message: "..." }],
    });
    const cert = items.find((item) => item.category === "certification");
    expect(cert?.state).toBe("waiting");
  });

  it("does not nag about a medical review the diver cannot clear", () => {
    const items = buildDiverChecklist(requirement(), {
      status: "blocked",
      blockers: [{ code: "medical_review", message: "..." }],
    });
    const waiver = items.find((item) => item.category === "waiver");
    expect(waiver?.state).toBe("waiting");
    expect(nextDiverStep(items)).toBeNull();
  });

  it("lets a diver action outrank a shop-waiting blocker in the same category", () => {
    const items = buildDiverChecklist(requirement({ requiresNitrox: true }), {
      status: "blocked",
      blockers: [
        { code: "certification_pending", message: "..." },
        { code: "nitrox_missing", message: "..." },
      ],
    });
    const cert = items.find((item) => item.category === "certification");
    expect(cert?.state).toBe("action");
  });

  it("collapses to a single reassuring line when the shop hasn't configured the trip", () => {
    const items = buildDiverChecklist(null, {
      status: "blocked",
      blockers: [{ code: "requirements_not_configured", message: "..." }],
    });
    expect(items).toHaveLength(1);
    expect(items[0]?.category).toBe("setup");
    expect(items[0]?.state).toBe("waiting");
  });
});

describe("nextDiverStep", () => {
  it("returns the first item that is on the diver", () => {
    const items = buildDiverChecklist(requirement(), {
      status: "blocked",
      blockers: [{ code: "payment_due", message: "..." }],
    });
    expect(nextDiverStep(items)?.category).toBe("payment");
  });

  it("returns null when everything is done or on the shop", () => {
    expect(nextDiverStep(buildDiverChecklist(requirement(), ready))).toBeNull();
  });
});
