/**
 * Properties of `seriesOccurrenceDates` (src/lib/recurrence.ts): the dates a
 * weekly series fires on inside a window. `rollSeriesForward` itself writes to
 * the database; its idempotence rests on the pure statement pinned here.
 * Example tests: recurrence.test.ts.
 */
import fc from "fast-check";
import { describe, expect } from "vitest";
import { arbDay, property } from "@/test/property";
import { shiftCalendarDate } from "./calendar-date";
import {
  MAX_INTERVAL_WEEKS,
  MIN_INTERVAL_WEEKS,
  type OccurrenceWindow,
  seriesFiresOn,
  seriesOccurrenceDates,
} from "./recurrence";

const arbWindow: fc.Arbitrary<OccurrenceWindow> = fc
  .record({
    anchorDate: arbDay,
    intervalWeeks: fc.integer({ min: MIN_INTERVAL_WEEKS, max: MAX_INTERVAL_WEEKS }),
    weekdays: fc.integer({ min: 1, max: 0b111_1111 }),
    fromOffset: fc.integer({ min: -60, max: 60 }),
    span: fc.integer({ min: 0, max: 120 }),
    endsAfter: fc.option(fc.integer({ min: -30, max: 200 }), { nil: null }),
  })
  .map(({ anchorDate, intervalWeeks, weekdays, fromOffset, span, endsAfter }) => {
    const from = shiftCalendarDate(anchorDate, fromOffset);
    return {
      anchorDate,
      pattern: { intervalWeeks, weekdays },
      from,
      through: shiftCalendarDate(from, span),
      endsOn: endsAfter === null ? null : shiftCalendarDate(anchorDate, endsAfter),
    };
  });

describe("seriesOccurrenceDates", () => {
  /**
   * Occurrence dates are strictly increasing (so unique), inside the window,
   * never before the anchor or after the end, and each one is a date the
   * series fires on.
   */
  property("dates are strictly increasing, in bounds, and fire", [arbWindow], (window) => {
    const dates = seriesOccurrenceDates(window) ?? [];
    dates.forEach((date, index) => {
      if (index > 0) expect(date > (dates[index - 1] as string)).toBe(true);
      expect(date >= window.from && date <= window.through).toBe(true);
      expect(date >= window.anchorDate).toBe(true);
      if (window.endsOn) expect(date <= window.endsOn).toBe(true);
      expect(seriesFiresOn(window, date)).toBe(true);
    });
  });

  /**
   * Rolling forward twice equals rolling once: the window filled in two
   * consecutive steps yields exactly the dates of the whole window at once.
   */
  property("two consecutive rolls equal one", [arbWindow, fc.nat(120)], (window, cut) => {
    const cutDay = shiftCalendarDate(window.from, cut);
    const middle = cutDay < window.through ? cutDay : window.through;
    const first = seriesOccurrenceDates({ ...window, through: middle }) ?? [];
    const second = seriesOccurrenceDates({ ...window, from: shiftCalendarDate(middle, 1) }) ?? [];
    const whole = seriesOccurrenceDates(window) ?? [];
    expect([...first, ...second]).toEqual(whole);
  });
});
