import { describe, expect, it } from "vitest";
import { shopCrewTarget } from "./crew-schedule";
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
