import { describe, expect, it } from "vitest";
import type { TripRequirement } from "../../db/schema/index";
import { NO_REQUIREMENT } from "../../lib/requirement";
import { coursePrepItems } from "./rules";

describe("course preparation categories", () => {
  it("keeps medical follow-up category-only and separate from learning materials", () => {
    expect(
      coursePrepItems({
        requirement: {
          ...NO_REQUIREMENT,
          requiresWaiver: false,
          requiresPayment: false,
        } as TripRequirement,
        readiness: { status: "blocked", blockers: [{ code: "medical_review" }] },
        participantType: "diver",
        materialsAsked: true,
        materialsDone: false,
      }),
    ).toEqual(["staff", "materials"]);
  });
  it("reuses the existing form, card and payment categories", () => {
    expect(
      coursePrepItems({
        requirement: {
          ...NO_REQUIREMENT,
          requiresWaiver: false,
          requiresPayment: false,
        } as TripRequirement,
        readiness: {
          status: "blocked",
          blockers: [
            { code: "waiver_pending" },
            { code: "certification_missing" },
            { code: "payment_due" },
          ],
        },
        participantType: "diver",
        materialsAsked: false,
        materialsDone: false,
      }),
    ).toEqual(["forms", "card", "payment"]);
  });
  it("requires a materials record only when the course asks for materials", () => {
    const base = {
      requirement: {
        ...NO_REQUIREMENT,
        requiresWaiver: false,
        requiresPayment: false,
      } as TripRequirement,
      readiness: { status: "ready" as const, blockers: [] },
      participantType: "diver" as const,
    };
    expect(coursePrepItems({ ...base, materialsAsked: true, materialsDone: false })).toEqual([
      "materials",
    ]);
    expect(coursePrepItems({ ...base, materialsAsked: true, materialsDone: true })).toEqual([]);
    expect(coursePrepItems({ ...base, materialsAsked: false, materialsDone: false })).toEqual([]);
  });
});
