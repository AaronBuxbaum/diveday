import { describe, expect, it } from "vitest";
import { homeDiverDoorEnabled } from "./rules";

describe("HOME_DIVER_DOOR", () => {
  it("is off when unset or blank, so the hero never leads to an empty shop list", () => {
    expect(homeDiverDoorEnabled({})).toBe(false);
    expect(homeDiverDoorEnabled({ HOME_DIVER_DOOR: "" })).toBe(false);
    expect(homeDiverDoorEnabled({ HOME_DIVER_DOOR: "  " })).toBe(false);
  });

  it("is on only for exactly 1", () => {
    expect(homeDiverDoorEnabled({ HOME_DIVER_DOOR: "1" })).toBe(true);
    expect(homeDiverDoorEnabled({ HOME_DIVER_DOOR: " 1 " })).toBe(true);
  });

  it("stays off for anything else, including a near miss", () => {
    for (const value of ["0", "true", "on", "yes", "11"]) {
      expect(homeDiverDoorEnabled({ HOME_DIVER_DOOR: value })).toBe(false);
    }
  });
});
