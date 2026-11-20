import { describe, expect, it } from "vitest";
import type { CalendarDate } from "@/lib/calendar-date";
import { QUIET_DAY_TIP_COUNT, quietDayTipIndex } from "./quiet-day-tip";

const day = (value: string) => value as CalendarDate;

describe("quietDayTipIndex", () => {
  it("holds still within a day and moves on to the next tip tomorrow", () => {
    expect(quietDayTipIndex(day("2026-11-20"))).toBe(quietDayTipIndex(day("2026-11-20")));
    expect(quietDayTipIndex(day("2026-11-21"))).toBe(
      (quietDayTipIndex(day("2026-11-20")) + 1) % QUIET_DAY_TIP_COUNT,
    );
  });

  it("walks every tip and wraps, before the anchor day as well as after", () => {
    const seen = new Set<number>();
    for (let n = 1; n <= QUIET_DAY_TIP_COUNT; n++)
      seen.add(quietDayTipIndex(day(`2026-03-${String(n).padStart(2, "0")}`)));
    expect(seen.size).toBe(QUIET_DAY_TIP_COUNT);
    expect(quietDayTipIndex(day("2025-12-31"))).toBe(QUIET_DAY_TIP_COUNT - 1);
  });
});
