import { afterEach, describe, expect, it, vi } from "vitest";
import { isValidTimeZone } from "./format";
import {
  CURATED_TIMEZONE_GROUPS,
  curatedTimeZones,
  DEFAULT_TIMEZONE,
  supportedTimeZones,
  timeZoneOptionText,
  timezoneOptionGroups,
} from "./timezones";

afterEach(() => {
  vi.unstubAllGlobals();
});

/** A stand-in `Intl` whose `supportedValuesOf` answers however a test wants. */
function stubSupportedValuesOf(implementation: unknown) {
  vi.stubGlobal("Intl", { ...Intl, supportedValuesOf: implementation });
}

describe("curated timezone groups", () => {
  it("names only real IANA zones", () => {
    for (const zone of curatedTimeZones()) {
      expect(isValidTimeZone(zone), `${zone} is not a real IANA zone`).toBe(true);
    }
  });

  it("lists every zone at most once", () => {
    const zones = curatedTimeZones();
    expect(new Set(zones).size).toBe(zones.length);
  });

  it("starts from a curated default so the picker opens on a real choice", () => {
    expect(curatedTimeZones()).toContain(DEFAULT_TIMEZONE);
    expect(isValidTimeZone(DEFAULT_TIMEZONE)).toBe(true);
  });

  it("covers the dive regions the old closed list turned away", () => {
    // The regression this file exists for: a shop in Bonaire, Belize, Roatán,
    // the Maldives, Indonesia, or Fiji could not finish signing up.
    const zones = curatedTimeZones();
    for (const zone of [
      "America/Curacao",
      "America/Belize",
      "America/Tegucigalpa",
      "America/Cayman",
      "Indian/Maldives",
      "Asia/Jakarta",
      "Asia/Makassar",
      "Pacific/Fiji",
    ]) {
      expect(zones, `${zone} missing from the curated groups`).toContain(zone);
    }
  });
});

describe("supportedTimeZones", () => {
  it("returns the runtime's full, sorted zone list", () => {
    const zones = supportedTimeZones();
    expect(zones.length).toBeGreaterThan(100);
    expect(zones).toEqual([...zones].sort());
    // The zones a closed list would have missed are all in here.
    expect(zones).toContain("America/Costa_Rica");
    expect(zones).toContain("Asia/Jayapura");
    expect(zones.every((zone) => isValidTimeZone(zone))).toBe(true);
  });

  it("deduplicates and drops anything that isn't a zone id", () => {
    stubSupportedValuesOf(() => ["Asia/Jakarta", "Asia/Jakarta", "", "not a zone", 42, null]);
    expect(supportedTimeZones()).toEqual(["Asia/Jakarta"]);
  });

  it("answers empty when the runtime has no enumeration API", () => {
    stubSupportedValuesOf(undefined);
    expect(supportedTimeZones()).toEqual([]);
  });

  it("answers empty when the enumeration API throws", () => {
    stubSupportedValuesOf(() => {
      throw new RangeError("timeZone is not a supported key");
    });
    expect(supportedTimeZones()).toEqual([]);
  });

  it("answers empty when the enumeration API returns something unusable", () => {
    stubSupportedValuesOf(() => "America/New_York");
    expect(supportedTimeZones()).toEqual([]);
  });
});

describe("timezoneOptionGroups", () => {
  it("pins the curated dive regions above the full list", () => {
    const groups = timezoneOptionGroups();
    expect(groups.map((group) => group.group)).toEqual([
      ...CURATED_TIMEZONE_GROUPS.map((group) => group.group),
      "allZones",
    ]);
    const all = groups.at(-1);
    expect(all?.zones).toContain("America/Costa_Rica");
    expect(all?.zones).toContain("Asia/Jayapura");
    // Every curated zone is in the full list too, so type-ahead on the id works.
    for (const zone of curatedTimeZones()) expect(all?.zones).toContain(zone);
  });

  it("falls back to the curated groups alone rather than an empty picker", () => {
    stubSupportedValuesOf(undefined);
    const groups = timezoneOptionGroups();
    expect(groups.map((group) => group.group)).toEqual(
      CURATED_TIMEZONE_GROUPS.map((group) => group.group),
    );
    expect(groups.flatMap((group) => group.zones)).toEqual(curatedTimeZones());
  });
});

describe("timeZoneOptionText", () => {
  it("reads a zone id back as its own display text", () => {
    expect(timeZoneOptionText("Asia/Ho_Chi_Minh")).toBe("Asia/Ho Chi Minh");
    expect(timeZoneOptionText("America/Costa_Rica")).toBe("America/Costa Rica");
    expect(timeZoneOptionText("Asia/Jayapura")).toBe("Asia/Jayapura");
  });
});
