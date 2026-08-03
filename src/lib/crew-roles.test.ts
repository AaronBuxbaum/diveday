import { describe, expect, it } from "vitest";
import {
  countInWaterCrew,
  effectiveCrewRoles,
  groupCrewAssignments,
  inWaterCrewRole,
  isTripCrewRole,
  TRIP_CREW_ROLES,
} from "./crew-roles";

/**
 * DOM-M3. Who counts as an instructor and who counts as an in-water certified
 * assistant decides the supervision ratio, which decides how many students may
 * be in the water with them. It was written out five times across `src/db` and
 * `src/app` and named nowhere in `src/lib`, and every copy read shop-wide
 * roles — so a divemaster rostered as *this trip's boat captain* still bought
 * two students' worth of capacity, and a shop-wide instructor rostered as deck
 * crew was worth eight and cleared a course's "unstaffed" gap on his own.
 *
 * `src/lib/course-ratios.test.ts` exercises the arithmetic from bare numbers
 * and never touches the role→count mapping. This is that mapping.
 */
describe("inWaterCrewRole", () => {
  it("falls back to shop-wide inference when no per-trip role is specified", () => {
    // The status quo, exactly: every `trip_assignments` row written before the
    // column existed is null here and must keep counting as it always did.
    expect(inWaterCrewRole({ tripRole: null, shopRoles: ["instructor"] })).toBe("instructor");
    expect(inWaterCrewRole({ tripRole: null, shopRoles: ["divemaster"] })).toBe(
      "certified_assistant",
    );
    // A person holding both is the instructor, never also their own assistant.
    expect(inWaterCrewRole({ tripRole: null, shopRoles: ["instructor", "divemaster"] })).toBe(
      "instructor",
    );
    expect(inWaterCrewRole({ tripRole: null, shopRoles: ["captain"] })).toBe("none");
    expect(inWaterCrewRole({ tripRole: null, shopRoles: ["crew"] })).toBe("none");
    expect(inWaterCrewRole({ tripRole: null, shopRoles: [] })).toBe("none");
    // Undefined reads the same as null — a caller that has no column value and
    // a caller that has a null one must not diverge.
    expect(inWaterCrewRole({ shopRoles: ["divemaster"] })).toBe("certified_assistant");
  });

  it("takes a divemaster rostered as this trip's captain out of the water", () => {
    // The finding, stated as a test.
    expect(inWaterCrewRole({ tripRole: "captain", shopRoles: ["divemaster"] })).toBe("none");
    expect(inWaterCrewRole({ tripRole: "crew", shopRoles: ["divemaster"] })).toBe("none");
    // And the instructor on the helm or the deck is not supervising either.
    expect(inWaterCrewRole({ tripRole: "captain", shopRoles: ["instructor"] })).toBe("none");
    expect(inWaterCrewRole({ tripRole: "crew", shopRoles: ["instructor", "divemaster"] })).toBe(
      "none",
    );
  });

  it("lets an instructor work a trip as its divemaster — a downgrade, and a real one", () => {
    expect(inWaterCrewRole({ tripRole: "divemaster", shopRoles: ["instructor"] })).toBe(
      "certified_assistant",
    );
    expect(
      inWaterCrewRole({ tripRole: "divemaster", shopRoles: ["instructor", "divemaster"] }),
    ).toBe("certified_assistant");
  });

  it("never lets the roster mint a credential the person does not hold", () => {
    // Rostering the deckhand as "instructor" buys the session nothing: a
    // scheduling document cannot make somebody an instructor.
    expect(inWaterCrewRole({ tripRole: "instructor", shopRoles: ["crew"] })).toBe("none");
    expect(inWaterCrewRole({ tripRole: "instructor", shopRoles: [] })).toBe("none");
    // A divemaster rostered as the instructor still counts only as an assistant.
    expect(inWaterCrewRole({ tripRole: "instructor", shopRoles: ["divemaster"] })).toBe(
      "certified_assistant",
    );
    expect(inWaterCrewRole({ tripRole: "divemaster", shopRoles: ["captain"] })).toBe("none");
  });

  /**
   * The invariant that makes this migration safe to ship: adding a per-trip
   * role can only ever *lower* what a person is worth to the ratio, never raise
   * it. So no existing session can silently gain capacity because somebody
   * filled in a roster field.
   */
  it("is monotone — a per-trip role never raises the count above the shop-wide inference", () => {
    const weight = { none: 0, certified_assistant: 1, instructor: 2 } as const;
    const roleSets = [
      [],
      ["crew"],
      ["captain"],
      ["divemaster"],
      ["instructor"],
      ["instructor", "divemaster"],
      ["owner", "divemaster"],
    ];
    for (const shopRoles of roleSets) {
      const baseline = weight[inWaterCrewRole({ tripRole: null, shopRoles })];
      for (const tripRole of TRIP_CREW_ROLES) {
        expect(weight[inWaterCrewRole({ tripRole, shopRoles })]).toBeLessThanOrEqual(baseline);
      }
    }
  });
});

describe("countInWaterCrew", () => {
  it("counts each person once, taking the instructor over their own assistant slot", () => {
    expect(
      countInWaterCrew([
        { tripRole: null, shopRoles: ["instructor", "divemaster"] },
        { tripRole: null, shopRoles: ["divemaster"] },
        { tripRole: null, shopRoles: ["captain"] },
      ]),
    ).toEqual({ instructorCount: 1, assistantCount: 1 });
  });

  it("drops a rostered captain out of the ratio while an unrostered one still counts", () => {
    const dm = ["divemaster"];
    // Same person, same qualification — only the roster line differs.
    expect(countInWaterCrew([{ tripRole: "captain", shopRoles: dm }])).toEqual({
      instructorCount: 0,
      assistantCount: 0,
    });
    expect(countInWaterCrew([{ tripRole: null, shopRoles: dm }])).toEqual({
      instructorCount: 0,
      assistantCount: 1,
    });
  });

  it("stops a shop-wide instructor rostered as deck crew from staffing a course", () => {
    expect(countInWaterCrew([{ tripRole: "crew", shopRoles: ["instructor"] }])).toEqual({
      instructorCount: 0,
      assistantCount: 0,
    });
  });

  it("is empty-safe", () => {
    expect(countInWaterCrew([])).toEqual({ instructorCount: 0, assistantCount: 0 });
  });
});

describe("groupCrewAssignments", () => {
  it("folds one row per held role into one entry per person", () => {
    // The join fan-out is the trap: counting rows would make this person both
    // an instructor and an assistant.
    const grouped = groupCrewAssignments([
      { personId: "p1", tripRole: null, role: "instructor" },
      { personId: "p1", tripRole: null, role: "divemaster" },
      { personId: "p2", tripRole: "captain", role: "divemaster" },
    ]);
    expect(grouped).toHaveLength(2);
    expect(countInWaterCrew(grouped)).toEqual({ instructorCount: 1, assistantCount: 0 });
  });

  it("keeps a person with no shop-wide role at all — a left join hands back a null role", () => {
    const grouped = groupCrewAssignments([{ personId: "p1", tripRole: "crew", role: null }]);
    expect(grouped).toEqual([{ personId: "p1", tripRole: "crew", shopRoles: [] }]);
    expect(countInWaterCrew(grouped)).toEqual({ instructorCount: 0, assistantCount: 0 });
  });
});

describe("effectiveCrewRoles", () => {
  it("shows the job on this boat when there is one, otherwise the standing roles", () => {
    expect(
      effectiveCrewRoles({ tripRole: "captain", shopRoles: ["divemaster", "captain"] }),
    ).toEqual(["captain"]);
    expect(effectiveCrewRoles({ tripRole: null, shopRoles: ["divemaster", "captain"] })).toEqual([
      "divemaster",
      "captain",
    ]);
  });
});

describe("isTripCrewRole", () => {
  it("accepts only the four jobs a boat has", () => {
    for (const role of TRIP_CREW_ROLES) expect(isTripCrewRole(role)).toBe(true);
    // Standing facts about a person, never a job on a sailing.
    expect(isTripCrewRole("owner")).toBe(false);
    expect(isTripCrewRole("manager")).toBe(false);
    expect(isTripCrewRole("diver")).toBe(false);
    expect(isTripCrewRole("")).toBe(false);
  });
});
