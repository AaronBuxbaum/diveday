import { describe, expect, it } from "vitest";
import { DIVER_LOCALES } from "@/i18n/settings";
import { staffTranslator } from "@/i18n/staff-messages";
import { MAX_TRIP_DAYS, MIN_TRIP_DAYS } from "@/lib/trip-days";
import { scheduleBuilderCopy, scheduleBuilderMore } from "./builder-copy";

function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (value && typeof value === "object") return Object.values(value).flatMap(strings);
  return [];
}

describe("scheduleBuilderCopy", () => {
  it.each(DIVER_LOCALES)("resolves every word the builder says in %s", (locale) => {
    const copy = scheduleBuilderCopy(staffTranslator(locale));
    const words = strings(copy);
    expect(words.length).toBeGreaterThan(100);
    for (const word of words) expect(word.trim()).not.toBe("");
  });

  it("hands placeholders over raw, for the component to fill", () => {
    expect(scheduleBuilderCopy(staffTranslator("en-US")).removeConfirm).toContain("{");
  });
});

describe("scheduleBuilderMore", () => {
  it("carries the domain's day bounds and the locale's weekday names", () => {
    const more = scheduleBuilderMore(staffTranslator("en-US"), "en-US");
    expect(more.minDays).toBe(MIN_TRIP_DAYS);
    expect(more.maxDays).toBe(MAX_TRIP_DAYS);
    expect(more.weekdayNames).toHaveLength(7);
    expect(more.diveFields.heading).not.toBe("");
  });
});
