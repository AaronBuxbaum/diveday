import { describe, expect, it } from "vitest";
import {
  EASYGOING_LENS_SLUG,
  type FirstBoatCandidate,
  firstBoatAfterwards,
} from "./first-boat-pick";

const SESSION_ENDS = new Date("2026-12-05T17:00:00Z");

function boat(overrides: Partial<FirstBoatCandidate> & { tripId: string }): FirstBoatCandidate {
  return {
    title: overrides.tripId,
    startsAt: new Date("2026-12-06T13:00:00Z"),
    seatsOpen: 4,
    courseId: null,
    lensSlug: EASYGOING_LENS_SLUG,
    plannedSiteDifficulties: [],
    ...overrides,
  };
}

const pick = (candidates: FirstBoatCandidate[]) =>
  firstBoatAfterwards({ sessionEndsAt: SESSION_ENDS, candidates })?.tripId ?? null;

describe("a good first boat afterwards", () => {
  it("picks the earliest qualifying departure, whatever order the candidates arrive in", () => {
    expect(
      pick([
        boat({ tripId: "later", startsAt: new Date("2026-12-08T13:00:00Z") }),
        boat({ tripId: "sooner", startsAt: new Date("2026-12-06T13:00:00Z") }),
      ]),
    ).toBe("sooner");
  });

  it("takes a boat whose every planned site the shop rates for beginners", () => {
    expect(
      pick([
        boat({
          tripId: "gentle-sites",
          lensSlug: null,
          plannedSiteDifficulties: ["beginner", "beginner"],
        }),
      ]),
    ).toBe("gentle-sites");
  });

  it("takes a boat the shop tags easygoing even when its sites are unrated", () => {
    expect(pick([boat({ tripId: "tagged", plannedSiteDifficulties: [null] })])).toBe("tagged");
  });

  it("skips a full boat", () => {
    expect(
      pick([boat({ tripId: "full", seatsOpen: 0 }), boat({ tripId: "open", seatsOpen: 1 })]),
    ).toBe("open");
  });

  it("skips a course session", () => {
    expect(pick([boat({ tripId: "course", courseId: "c1" })])).toBeNull();
  });

  it("skips a boat with a harder, unrated or mixed site and no easygoing tag", () => {
    expect(
      pick([
        boat({ tripId: "hard", lensSlug: "wrecks", plannedSiteDifficulties: ["advanced"] }),
        boat({ tripId: "mixed", lensSlug: null, plannedSiteDifficulties: ["beginner", null] }),
        boat({
          tripId: "mixed-up",
          lensSlug: null,
          plannedSiteDifficulties: ["beginner", "intermediate"],
        }),
        boat({ tripId: "no-sites", lensSlug: null, plannedSiteDifficulties: [] }),
      ]),
    ).toBeNull();
  });

  it("skips departures that start before the session ends, or as it ends", () => {
    expect(
      pick([
        boat({ tripId: "before", startsAt: new Date("2026-12-05T12:00:00Z") }),
        boat({ tripId: "as-it-ends", startsAt: SESSION_ENDS }),
        boat({ tripId: "after", startsAt: new Date("2026-12-05T17:01:00Z") }),
      ]),
    ).toBe("after");
  });

  it("returns null when nothing qualifies", () => {
    expect(pick([])).toBeNull();
  });

  it("breaks a tie on start time by id, so the answer is stable", () => {
    expect(pick([boat({ tripId: "b" }), boat({ tripId: "a" })])).toBe("a");
  });
});
