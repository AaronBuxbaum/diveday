import { describe, expect, it } from "vitest";
import { departureShowsCrew, shopCrewTarget } from "./crew-schedule";
import { divemasterRatioGap } from "./divemaster-ratio";

describe("shopCrewTarget", () => {
  it("is the shop's own target while it plans its crew here", () => {
    expect(shopCrewTarget({ crewScheduleEnabled: true, diversPerDivemaster: 5 })).toBe(5);
  });

  it("is no target at all when it does not", () => {
    expect(shopCrewTarget({ crewScheduleEnabled: false, diversPerDivemaster: 5 })).toBeNull();
  });

  it("means a shop that keeps no roster is never told its boat is short", () => {
    // Twelve divers and nobody in the water would be two divemasters short at
    // 6:1 — and says nothing for a shop that does not plan crew here.
    const off = shopCrewTarget({ crewScheduleEnabled: false, diversPerDivemaster: 6 });
    expect(
      divemasterRatioGap({ divers: 12, divemasterCount: 0, diversPerDivemaster: off }),
    ).toEqual({ code: "none" });
    const on = shopCrewTarget({ crewScheduleEnabled: true, diversPerDivemaster: 6 });
    expect(
      divemasterRatioGap({ divers: 12, divemasterCount: 0, diversPerDivemaster: on }).code,
    ).toBe("under_target");
  });
});

describe("departureShowsCrew", () => {
  it("shows every departure's crew while the shop plans its crew", () => {
    expect(departureShowsCrew({ crewScheduleEnabled: true }, { course: null })).toBe(true);
  });

  it("hides a fun dive's crew when the shop does not", () => {
    expect(departureShowsCrew({ crewScheduleEnabled: false }, { course: null })).toBe(false);
  });

  it("keeps a course session's crew either way, because its instructor gates enrolment", () => {
    // The agency training ratio refuses seats from the named instructors
    // (`courseSeatCapacity`), so a switch about rosters can never hide them.
    expect(
      departureShowsCrew({ crewScheduleEnabled: false }, { course: { slug: "open-water" } }),
    ).toBe(true);
  });
});
