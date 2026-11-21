import { describe, expect, it } from "vitest";
import { urgencyFor } from "./today-urgency";

const NOW = new Date("2026-07-20T14:00:00Z");
const hoursFromNow = (hours: number) => new Date(NOW.getTime() + hours * 60 * 60 * 1000);

describe("urgencyFor", () => {
  it("flags the next boat out — inside three hours — as imminent", () => {
    expect(urgencyFor(hoursFromNow(0.5), NOW)).toBe("imminent");
    expect(urgencyFor(hoursFromNow(3), NOW)).toBe("imminent");
  });

  it("treats the rest of today, past the imminent window, as work for now", () => {
    expect(urgencyFor(hoursFromNow(3.5), NOW)).toBe("now");
    expect(urgencyFor(hoursFromNow(23), NOW)).toBe("now");
  });

  it("separates the next three days from the rest of the week", () => {
    expect(urgencyFor(hoursFromNow(30), NOW)).toBe("soon");
    expect(urgencyFor(hoursFromNow(71), NOW)).toBe("soon");
    expect(urgencyFor(hoursFromNow(80), NOW)).toBe("later");
  });

  it("puts undated work last rather than pretending it is urgent", () => {
    expect(urgencyFor(null, NOW)).toBe("later");
  });
});
