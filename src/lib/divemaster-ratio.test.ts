import { describe, expect, it } from "vitest";
import { courseCrewGap } from "./course-ratios";
import { countInWaterCrew } from "./crew-roles";
import {
  DEFAULT_DIVERS_PER_DIVEMASTER,
  divemasterRatioCapacity,
  divemasterRatioGap,
  divemastersNeeded,
  inWaterDivemasterCount,
  MAX_DIVERS_PER_DIVEMASTER,
  MIN_DIVERS_PER_DIVEMASTER,
} from "./divemaster-ratio";

describe("how many divemasters a target wants", () => {
  it("rounds a part-full group up to a whole person", () => {
    expect(divemastersNeeded(11, 6)).toBe(2);
    expect(divemastersNeeded(12, 6)).toBe(2);
    expect(divemastersNeeded(13, 6)).toBe(3);
  });

  it("wants nobody for nobody", () => {
    expect(divemastersNeeded(0, 6)).toBe(0);
    // Negative is not a head count, but a caller subtracting its way to one
    // must not be handed a negative crew to roster.
    expect(divemastersNeeded(-3, 6)).toBe(0);
  });

  it("reports what a rostered crew covers", () => {
    expect(divemasterRatioCapacity(2, 6)).toBe(12);
    expect(divemasterRatioCapacity(0, 6)).toBe(0);
  });
});

describe("who counts as a divemaster for the shop's own target", () => {
  /**
   * The agency course ratios need instructors and certified assistants kept
   * apart — an instructor is worth eight students, an assistant buys two more.
   * This target does not: both are people supervising divers in the water.
   */
  it("counts an instructor and a divemaster alike", () => {
    const crew = countInWaterCrew([
      { tripRole: null, shopRoles: ["instructor"] },
      { tripRole: null, shopRoles: ["divemaster"] },
    ]);
    expect(crew).toEqual({ instructorCount: 1, assistantCount: 1 });
    expect(inWaterDivemasterCount(crew)).toBe(2);
  });

  it("counts nobody who is not in the water", () => {
    // The captain is driving and the deckhand is handling lines, whatever they
    // are qualified to do on another day (`inWaterCrewRole`).
    const crew = countInWaterCrew([
      { tripRole: "captain", shopRoles: ["divemaster"] },
      { tripRole: "crew", shopRoles: ["instructor"] },
    ]);
    expect(inWaterDivemasterCount(crew)).toBe(0);
  });
});

describe("measuring a departure against the shop's target", () => {
  it("reports how many divemasters short a departure is", () => {
    expect(divemasterRatioGap({ divers: 14, divemasterCount: 1, diversPerDivemaster: 6 })).toEqual({
      code: "under_target",
      divers: 14,
      divemasterCount: 1,
      needed: 3,
      shortBy: 2,
    });
  });

  it("says nothing when the target is met, or beaten", () => {
    expect(divemasterRatioGap({ divers: 12, divemasterCount: 2, diversPerDivemaster: 6 })).toEqual({
      code: "none",
    });
    expect(divemasterRatioGap({ divers: 3, divemasterCount: 4, diversPerDivemaster: 6 })).toEqual({
      code: "none",
    });
  });

  it("never calls an empty departure short", () => {
    // The target describes divers in the water; an empty boat has none, so an
    // unstaffed departure nobody has booked is not a gap to nag about.
    expect(divemasterRatioGap({ divers: 0, divemasterCount: 0, diversPerDivemaster: 6 })).toEqual({
      code: "none",
    });
  });

  it("is short the moment one diver has nobody at all", () => {
    expect(
      divemasterRatioGap({ divers: 1, divemasterCount: 0, diversPerDivemaster: 6 }),
    ).toMatchObject({ code: "under_target", needed: 1, shortBy: 1 });
  });
});

describe("the target and the agency caps are different things", () => {
  /**
   * A shop typing a generous number here must never loosen a published agency
   * ratio, and typing a tight one does not tighten it either: the target binds
   * nothing, `courseCrewGap` binds a seat. This pins that they are measured
   * separately rather than one feeding the other.
   */
  it("leaves an entry-level course session's published cap alone", () => {
    const course = { agency: "PADI", minimumCertificationLevel: null, isIntroCourse: false };
    // One instructor, nine students: inside PADI's 8/+2/12 only with help, so
    // the agency gate fires — while a lenient 10:1 shop target is content.
    expect(
      courseCrewGap({ course, instructorCount: 1, assistantCount: 0, booked: 9 }),
    ).toMatchObject({ code: "over_ratio", capacity: 8 });
    expect(divemasterRatioGap({ divers: 9, divemasterCount: 1, diversPerDivemaster: 10 })).toEqual({
      code: "none",
    });
  });

  it("can be short while the agency cap is satisfied", () => {
    const course = { agency: "PADI", minimumCertificationLevel: null, isIntroCourse: false };
    expect(courseCrewGap({ course, instructorCount: 1, assistantCount: 0, booked: 8 })).toEqual({
      code: "none",
    });
    expect(
      divemasterRatioGap({ divers: 8, divemasterCount: 1, diversPerDivemaster: 4 }),
    ).toMatchObject({ code: "under_target", shortBy: 1 });
  });
});

describe("the bounds the settings form and the check constraint share", () => {
  it("keeps the default inside them", () => {
    expect(DEFAULT_DIVERS_PER_DIVEMASTER).toBeGreaterThanOrEqual(MIN_DIVERS_PER_DIVEMASTER);
    expect(DEFAULT_DIVERS_PER_DIVEMASTER).toBeLessThanOrEqual(MAX_DIVERS_PER_DIVEMASTER);
  });
});
