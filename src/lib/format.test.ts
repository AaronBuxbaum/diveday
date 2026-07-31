import { describe, expect, it } from "vitest";
import {
  formatDateTimeTz,
  formatRelativeDay,
  formatShortDate,
  formatTime,
  formatTimeRange,
  formatTimeRangeTz,
  isValidTimeZone,
} from "./format";

const morning = new Date("2026-07-17T07:30:00Z");
const midday = new Date("2026-07-17T11:00:00Z");

describe("isValidTimeZone (CR-014)", () => {
  it("accepts real IANA zones", () => {
    expect(isValidTimeZone("America/New_York")).toBe(true);
    expect(isValidTimeZone("Pacific/Honolulu")).toBe(true);
    expect(isValidTimeZone("UTC")).toBe(true);
  });

  it("rejects a well-formed but nonexistent zone", () => {
    expect(isValidTimeZone("Etc/Nowhere")).toBe(false);
  });

  it("rejects garbage and an empty string", () => {
    expect(isValidTimeZone("not a timezone")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
  });
});

describe("formatShortDate", () => {
  it("renders weekday, month, and day", () => {
    expect(formatShortDate(morning, "en-US", "UTC")).toBe("Fri, Jul 17");
  });
});

describe("formatTime", () => {
  it("renders 12-hour time with minutes", () => {
    expect(formatTime(morning, "en-US", "UTC")).toBe("7:30 AM");
  });
});

describe("formatDateTimeTz", () => {
  it("includes a timezone on safety-relevant timestamps", () => {
    expect(formatDateTimeTz(morning, "en-US", "UTC")).toBe("Jul 17, 7:30 AM UTC");
  });
});

describe("formatTimeRange", () => {
  it("joins start and end with an en dash", () => {
    expect(formatTimeRange(morning, midday, "en-US", "UTC")).toBe("7:30 AM – 11:00 AM");
  });
});

describe("formatTimeRangeTz", () => {
  it("labels the end time with the zone", () => {
    expect(formatTimeRangeTz(morning, midday, "en-US", "UTC")).toBe("7:30 AM – 11:00 AM UTC");
    expect(formatTimeRangeTz(morning, midday, "en-US", "America/New_York")).toBe(
      "3:30 AM – 7:00 AM EDT",
    );
  });
});

describe("formatRelativeDay", () => {
  const noon = (day: string) => new Date(`${day}T12:00:00Z`);

  it("reads today/tomorrow/in N days off the calendar day, not the raw hour difference", () => {
    expect(formatRelativeDay(noon("2026-07-17"), noon("2026-07-17"), "en-US", "UTC")).toBe(
      "today",
    );
    expect(formatRelativeDay(noon("2026-07-18"), noon("2026-07-17"), "en-US", "UTC")).toBe(
      "tomorrow",
    );
    expect(formatRelativeDay(noon("2026-07-19"), noon("2026-07-17"), "en-US", "UTC")).toBe(
      "in 2 days",
    );
    expect(formatRelativeDay(noon("2026-07-16"), noon("2026-07-17"), "en-US", "UTC")).toBe(
      "yesterday",
    );
  });

  it("diffs by calendar day in the given timezone, so a trip just after local midnight isn't misread as two days out", () => {
    // 11pm Honolulu on the 17th is already 9am UTC on the 18th — the same
    // calendar day locally as `now`, so this must still read "today" there
    // even though the raw UTC dates differ.
    const lateNightHonolulu = new Date("2026-07-18T09:00:00Z");
    const sameEveningHonolulu = new Date("2026-07-18T05:00:00Z");
    expect(
      formatRelativeDay(lateNightHonolulu, sameEveningHonolulu, "en-US", "Pacific/Honolulu"),
    ).toBe("today");
  });

  it("localizes through Intl.RelativeTimeFormat rather than hard-coded English", () => {
    expect(formatRelativeDay(noon("2026-07-19"), noon("2026-07-17"), "es-ES", "UTC")).toBe(
      "pasado mañana",
    );
  });
});
