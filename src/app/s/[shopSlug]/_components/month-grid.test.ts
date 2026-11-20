import { describe, expect, it } from "vitest";
import { monthGridWeekdays, monthGridWeeks } from "./month-grid";

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
