import { describe, expect, it } from "vitest";
import { waterBandFor } from "./water-band";

/**
 * The band is chosen from the *shop's* hour. Every case below is written as a
 * UTC instant, and the ones that matter are the ones where the machine's hour
 * and the shop's fall in different bands: that is the failure this file
 * exists for, and it is invisible on a UTC box.
 */
describe("waterBandFor", () => {
  const NY = "America/New_York";

  it.each([
    ["04:59", "2026-07-21T08:59:00.000Z", "night"],
    ["05:00", "2026-07-21T09:00:00.000Z", "dawn"],
    ["07:59", "2026-07-21T11:59:00.000Z", "dawn"],
    ["08:00", "2026-07-21T12:00:00.000Z", "day"],
    ["16:59", "2026-07-21T20:59:00.000Z", "day"],
    ["17:00", "2026-07-21T21:00:00.000Z", "dusk"],
    ["19:59", "2026-07-21T23:59:00.000Z", "dusk"],
    ["20:00", "2026-07-22T00:00:00.000Z", "night"],
    ["23:59", "2026-07-22T03:59:00.000Z", "night"],
  ] as const)("is %s in New York, which is %s → %s", (_local, instant, band) => {
    expect(waterBandFor(new Date(instant), NY)).toBe(band);
  });

  it("reads one instant as four different bands in four zones", () => {
    // The e2e fleet's frozen instant, which is how the visual spec photographs
    // all four washes without moving a clock it cannot move.
    const frozen = new Date("2026-07-21T13:30:00.000Z");
    expect(waterBandFor(frozen, "America/Los_Angeles")).toBe("dawn"); // 06:30
    expect(waterBandFor(frozen, NY)).toBe("day"); // 09:30
    expect(waterBandFor(frozen, "Indian/Maldives")).toBe("dusk"); // 18:30
    expect(waterBandFor(frozen, "Pacific/Honolulu")).toBe("night"); // 03:30
  });

  it("follows the shop across a spring-forward", () => {
    // 2026-03-08, the US jump. 10:30Z is 05:30 the day before the change and
    // 06:30 after it — dawn on both sides, so the case that bites is the hour
    // that crosses: 09:30Z is 04:30 (night) on Saturday and 05:30 (dawn) on
    // Sunday, with nothing in the code aware a jump happened.
    expect(waterBandFor(new Date("2026-03-07T09:30:00.000Z"), NY)).toBe("night");
    expect(waterBandFor(new Date("2026-03-08T09:30:00.000Z"), NY)).toBe("dawn");
  });

  it("reads a zone east of UTC by its own clock", () => {
    // Asia/Tokyo is +09:00, so a UTC midnight is nine in the morning there.
    expect(waterBandFor(new Date("2026-07-21T00:00:00.000Z"), "Asia/Tokyo")).toBe("day");
    expect(waterBandFor(new Date("2026-07-21T00:00:00.000Z"), "UTC")).toBe("night");
  });
});
