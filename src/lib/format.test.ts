import { describe, expect, it } from "vitest";
import {
  formatDateTimeTz,
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
