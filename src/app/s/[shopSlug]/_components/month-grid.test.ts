import { describe, expect, it } from "vitest";
import {
  currentWeekWindow,
  monthGridWeekdays,
  monthGridWeeks,
  monthSpanLabel,
  windowGridWeeks,
} from "./month-grid";

const dayKeyOf = (d: Date) => d.toISOString().slice(0, 10);
const trip = (iso: string, capacity: number, booked: number) => ({
  startsAt: new Date(iso),
  capacity,
  booked,
});

describe("monthGridWeeks", () => {
  it("pads to whole weeks and starts the week where asked", () => {
    const sunday = monthGridWeeks({ year: 2026, month: 11 }, [], dayKeyOf, 0);
    expect(sunday[0]?.[0]?.day).toBe(1); // 1 Nov 2026 is a Sunday
    expect(sunday.every((week) => week.length === 7)).toBe(true);
    const monday = monthGridWeeks({ year: 2026, month: 11 }, [], dayKeyOf, 1);
    expect(monday[0]?.slice(0, 6).every((c) => c === null)).toBe(true);
    expect(monday[0]?.[6]?.day).toBe(1);
  });

  it("counts boats with room, says full days apart, and leaves empty days blank", () => {
    const weeks = monthGridWeeks(
      { year: 2026, month: 11 },
      [
        trip("2026-11-03T13:00:00Z", 10, 4),
        trip("2026-11-03T18:00:00Z", 10, 10),
        trip("2026-11-04T13:00:00Z", 8, 8),
      ],
      dayKeyOf,
      0,
    );
    const cell = (key: string) => weeks.flat().find((c) => c?.dayKey === key);
    expect(cell("2026-11-03")).toMatchObject({ withRoom: 1, total: 2 });
    expect(cell("2026-11-04")).toMatchObject({ withRoom: 0, total: 1 });
    expect(cell("2026-11-05")).toMatchObject({ withRoom: 0, total: 0 });
  });

  it("names the weekdays in grid order", () => {
    expect(monthGridWeekdays("en-US", 1)[0]).toBe("Mon");
    expect(monthGridWeekdays("en-US", 0)[0]).toBe("Sun");
  });
});

describe("the grid that starts on this week", () => {
  it("opens on the week holding today, where the reader's week begins, and runs five weeks", () => {
    // Monday 23 November 2026.
    const sunday = currentWeekWindow("2026-11-23", 0);
    expect(sunday).toMatchObject({ start: "2026-11-22", weeks: 5 });
    expect(sunday.first).toEqual({ year: 2026, month: 11 });
    expect(sunday.last).toEqual({ year: 2026, month: 12 });
    expect(currentWeekWindow("2026-11-23", 1).start).toBe("2026-11-23");
    expect(currentWeekWindow("2026-11-22", 1).start).toBe("2026-11-16");
  });

  it("runs across the month boundary with every square a real day", () => {
    const window = currentWeekWindow("2026-11-23", 0);
    const weeks = windowGridWeeks(
      window,
      [trip("2026-12-02T13:00:00Z", 10, 4), trip("2026-11-24T13:00:00Z", 8, 8)],
      dayKeyOf,
    );
    expect(weeks).toHaveLength(5);
    expect(weeks.every((week) => week.length === 7 && week.every((cell) => cell !== null))).toBe(
      true,
    );
    const days = weeks.flat().map((cell) => cell?.dayKey);
    expect(days[0]).toBe("2026-11-22");
    expect(days[8]).toBe("2026-11-30");
    expect(days[9]).toBe("2026-12-01");
    expect(days.at(-1)).toBe("2026-12-26");
    expect(weeks.flat().find((cell) => cell?.dayKey === "2026-12-02")).toMatchObject({
      day: 2,
      withRoom: 1,
      total: 1,
    });
    expect(weeks.flat().find((cell) => cell?.dayKey === "2026-11-24")).toMatchObject({
      withRoom: 0,
      total: 1,
    });
  });

  it("crosses a year as well as a month", () => {
    const window = currentWeekWindow("2026-12-20", 0);
    expect(window.first).toEqual({ year: 2026, month: 12 });
    expect(window.last).toEqual({ year: 2027, month: 1 });
  });

  it("names both months the grid draws, and one when it draws one", () => {
    expect(monthSpanLabel({ year: 2026, month: 11 }, { year: 2026, month: 12 }, "en-US")).toMatch(
      /^November\s*[–-]\s*December 2026$/,
    );
    expect(monthSpanLabel({ year: 2026, month: 12 }, { year: 2027, month: 1 }, "en-US")).toMatch(
      /December 2026\s*[–-]\s*January 2027/,
    );
    expect(monthSpanLabel({ year: 2026, month: 11 }, { year: 2026, month: 11 }, "en-US")).toBe(
      "November 2026",
    );
  });
});
