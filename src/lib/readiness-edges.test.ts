import { describe, expect, it } from "vitest";
import type { Certification } from "@/db/schema";
import { cardUndoRefusal, levelStanding, paymentGateIsUnclearable } from "./readiness";

/**
 * Edges of the boarding gate that the main suites reach only by accident:
 * each one is a branch a refactor could flip without any other test noticing.
 */

const verified = (level: Certification["level"]) =>
  ({ status: "verified", level }) as Certification;
const evidence = { specialtyCertifications: [], nitroxCertifications: [] };

describe("paymentGateIsUnclearable", () => {
  it("is unclearable only when payment is required and the price is missing or nothing", () => {
    expect(paymentGateIsUnclearable(false, null)).toBe(false);
    expect(paymentGateIsUnclearable(true, null)).toBe(true);
    expect(paymentGateIsUnclearable(true, 0)).toBe(true);
    expect(paymentGateIsUnclearable(true, -100)).toBe(true);
    expect(paymentGateIsUnclearable(true, 4500)).toBe(false);
  });
});

describe("cardUndoRefusal", () => {
  const reviewedAt = new Date("2026-11-03T12:00:00.000Z");

  it("refuses as stale with no review, or a review other than the one offered", () => {
    expect(cardUndoRefusal({ reviewedAt: null }, reviewedAt)).toBe("stale");
    expect(cardUndoRefusal({}, reviewedAt)).toBe("stale");
    expect(cardUndoRefusal({ reviewedAt: new Date("2026-11-03T12:00:01.000Z") }, reviewedAt)).toBe(
      "stale",
    );
  });

  it("never reverses an agency-checked review, except from the agency check's own Undo", () => {
    const card = { reviewedAt, agencyCheckedAt: reviewedAt };
    expect(cardUndoRefusal(card, reviewedAt)).toBe("agency_checked");
    expect(cardUndoRefusal(card, reviewedAt, { reversingAgencyCheck: true })).toBeNull();
    expect(cardUndoRefusal({ reviewedAt }, new Date(reviewedAt))).toBeNull();
  });
});

describe("levelStanding at the boarding threshold", () => {
  it("names the highest verified rung held, whatever order the cards come in", () => {
    for (const certifications of [
      [verified("advanced_open_water"), verified("open_water")],
      [verified("open_water"), verified("advanced_open_water")],
    ]) {
      expect(levelStanding("rescue", { ...evidence, certifications }, "verified")).toEqual({
        code: "certification_insufficient",
        params: { requiredLevel: "rescue", heldLevel: "advanced_open_water" },
      });
    }
  });

  it("keeps the highest submitted lower card blocked and unverified, whatever the card order", () => {
    const pending = (level: Certification["level"]) =>
      ({ status: "pending", level, identifier: `card-${level}` }) as Certification;
    for (const certifications of [
      [pending("advanced_open_water"), pending("open_water")],
      [pending("open_water"), pending("advanced_open_water")],
    ]) {
      expect(levelStanding("rescue", { ...evidence, certifications }, "verified")).toEqual({
        code: "certification_insufficient",
        params: {
          requiredLevel: "rescue",
          heldLevel: "advanced_open_water",
          heldUnverified: true,
        },
      });
    }
  });

  it("points a missing card at the latest ended course, whatever order they come in", () => {
    const earlier = {
      level: "open_water" as const,
      finishesAt: new Date("2026-10-01T00:00:00.000Z"),
      tripId: "trip-earlier",
    };
    const later = {
      ...earlier,
      finishesAt: new Date("2026-10-20T00:00:00.000Z"),
      tripId: "trip-later",
    };
    for (const coursesEnded of [
      [later, earlier],
      [earlier, later],
    ]) {
      const blocker = levelStanding(
        "open_water",
        {
          ...evidence,
          certifications: [],
          coursesEnded,
          now: new Date("2026-11-03T00:00:00.000Z"),
        },
        "verified",
      );
      expect(blocker).toEqual({
        code: "certification_missing",
        params: { endedCourseTripId: "trip-later" },
      });
    }
  });

  it("reads the clock when no instant is given", () => {
    expect(
      levelStanding(
        "open_water",
        { ...evidence, certifications: [verified("open_water")] },
        "verified",
      ),
    ).toBeNull();
  });
});
