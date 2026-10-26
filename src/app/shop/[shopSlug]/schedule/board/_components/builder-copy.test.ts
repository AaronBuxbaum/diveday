import { describe, expect, it } from "vitest";
import { DIVER_LOCALES } from "@/i18n/settings";
import { staffTranslator } from "@/i18n/staff-messages";
import { MAX_TRIP_DAYS, MIN_TRIP_DAYS } from "@/lib/trip-days";
import { builderPriceInput, scheduleBuilderCopy, scheduleBuilderMore } from "./builder-copy";

function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (value && typeof value === "object") return Object.values(value).flatMap(strings);
  return [];
}

describe("scheduleBuilderCopy", () => {
  it.each(DIVER_LOCALES)("resolves every word the builder says in %s", (locale) => {
    const copy = scheduleBuilderCopy(staffTranslator(locale), "America/New_York");
    const words = strings(copy);
    expect(words.length).toBeGreaterThan(100);
    for (const word of words) expect(word.trim()).not.toBe("");
  });

  it.each(DIVER_LOCALES)("names the shop timezone beside the move time in %s", (locale) => {
    const copy = scheduleBuilderCopy(staffTranslator(locale), "Pacific/Honolulu");
    expect(copy.newDepartureTime).toContain("Pacific/Honolulu");
  });

  it("hands placeholders over raw, for the component to fill", () => {
    expect(
      scheduleBuilderCopy(staffTranslator("en-US"), "America/New_York").removeConfirm,
    ).toContain("{");
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

describe("builderPriceInput", () => {
  it("takes cents in a two-decimal currency", () => {
    const input = builderPriceInput("usd", "en-US");
    expect(input.step).toBe("0.01");
    expect(input.placeholder).toBe("$0.00");
  });

  it("takes whole units in a zero-decimal currency", () => {
    const input = builderPriceInput("jpy", "en-US");
    expect(input.step).toBe("1");
    expect(input.placeholder).not.toContain(".");
  });
});
