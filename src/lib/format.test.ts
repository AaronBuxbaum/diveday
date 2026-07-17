import { describe, expect, it } from "vitest";
import { formatShortDate, formatTime, formatTimeRange } from "./format";

const morning = new Date("2026-07-17T07:30:00Z");
const midday = new Date("2026-07-17T11:00:00Z");

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

describe("formatTimeRange", () => {
  it("joins start and end with an en dash", () => {
    expect(formatTimeRange(morning, midday, "en-US", "UTC")).toBe("7:30 AM – 11:00 AM");
  });
});
