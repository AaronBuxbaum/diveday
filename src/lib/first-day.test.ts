import { describe, expect, it } from "vitest";
import {
  firstDepartureDay,
  firstDepartureEndTime,
  MAX_FIRST_DAY_NAME,
  parseDepartureTime,
  parseFirstDayFields,
  parseFirstDayName,
} from "./first-day";

describe("parseFirstDayName", () => {
  it("collapses the whitespace a paste carries and trims the ends", () => {
    expect(parseFirstDayName("  Coral   Cove  Dive Co. ")).toBe("Coral Cove Dive Co.");
  });

  it("refuses a name with nothing in it", () => {
    expect(parseFirstDayName("   ")).toBeNull();
    expect(parseFirstDayName("")).toBeNull();
  });

  it("refuses anything that is not a string", () => {
    expect(parseFirstDayName(undefined)).toBeNull();
    expect(parseFirstDayName(["Coral Cove"])).toBeNull();
    expect(parseFirstDayName(7)).toBeNull();
  });

  it("refuses a name past the carried length rather than truncating one", () => {
    expect(parseFirstDayName("a".repeat(MAX_FIRST_DAY_NAME))).toHaveLength(MAX_FIRST_DAY_NAME);
    expect(parseFirstDayName("a".repeat(MAX_FIRST_DAY_NAME + 1))).toBeNull();
  });

  it("refuses control and invisible characters", () => {
    // A newline is a two-line name; a zero-width joiner paints identically to
    // the name beside it and is how two shops look like one.
    expect(parseFirstDayName("Coral\nCove")).toBeNull();
    expect(parseFirstDayName("Coral\u200dCove")).toBeNull();
    expect(parseFirstDayName("Coral\u0000Cove")).toBeNull();
  });
});

describe("parseDepartureTime", () => {
  it("takes what a time field submits", () => {
    expect(parseDepartureTime("07:30")).toBe("07:30");
    expect(parseDepartureTime("00:00")).toBe("00:00");
    expect(parseDepartureTime("23:59")).toBe("23:59");
  });

  it("refuses junk, a bare hour, and an hour that does not exist", () => {
    for (const input of ["7:30", "7", "07:30 AM", "24:00", "23:60", "0730", "", "abc", null, 730]) {
      expect(parseDepartureTime(input)).toBeNull();
    }
  });
});

describe("firstDepartureDay", () => {
  it("is tomorrow in the shop's zone, not the server's", () => {
    // 03:30 UTC on the 2nd is still the 1st in Key Largo, so the first
    // departure belongs on the 2nd there and the 3rd in Bangkok.
    const now = new Date("2026-09-02T03:30:00Z");
    expect(firstDepartureDay(now, "America/New_York")).toBe("2026-09-02");
    expect(firstDepartureDay(now, "Asia/Bangkok")).toBe("2026-09-03");
  });
});

describe("firstDepartureEndTime", () => {
  it("runs four hours from the typed time", () => {
    expect(firstDepartureEndTime("07:30")).toBe("11:30");
    expect(firstDepartureEndTime("08:00")).toBe("12:00");
  });

  it("holds a late departure inside its own day", () => {
    // `tripDetailsPatch` reads a start and an end against one date, so an end
    // past midnight is a departure that never gets created at all.
    expect(firstDepartureEndTime("22:00")).toBe("23:59");
    expect(firstDepartureEndTime("23:58")).toBe("23:59");
  });

  it("has no answer at the very end of the day, where there is nothing to clamp into", () => {
    // 23:59 clamps to its own start, which `tripDetailsPatch` refuses as
    // `end_before_start` — so this says no first, and `createFirstDay` writes
    // neither the departure nor the hull it would have sailed on.
    expect(firstDepartureEndTime("23:59")).toBeNull();
  });

  it("has no answer for a time it cannot read", () => {
    expect(firstDepartureEndTime("7:30")).toBeNull();
  });
});

describe("parseFirstDayFields", () => {
  it("reads back what the form posted", () => {
    expect(parseFirstDayFields({ boat: "Reef Runner", departure: "07:30" })).toEqual({
      boatName: "Reef Runner",
      departure: "07:30",
    });
  });

  it("drops only the field that is junk", () => {
    expect(
      parseFirstDayFields({ boat: "a".repeat(MAX_FIRST_DAY_NAME + 1), departure: "07:30" }),
    ).toEqual({ boatName: null, departure: "07:30" });
    expect(parseFirstDayFields({ boat: "Reef Runner", departure: "half past seven" })).toEqual({
      boatName: "Reef Runner",
      departure: null,
    });
  });

  it("takes neither value when a parameter is repeated", () => {
    expect(parseFirstDayFields({ boat: ["Reef Runner", "Sea Cat"] }).boatName).toBeNull();
  });

  it("has nothing to say about a bare form", () => {
    expect(parseFirstDayFields({})).toEqual({ boatName: null, departure: null });
  });
});
