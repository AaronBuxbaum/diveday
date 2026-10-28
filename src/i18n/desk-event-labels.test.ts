import { describe, expect, it } from "vitest";
import { catchUpSentences } from "./desk-event-labels";
import { staffTranslator } from "./staff-messages";

describe("Today catch-up copy", () => {
  it.each([
    ["en-US", "Lina is running late.", "Since 9:30 AM EDT"],
    ["es-ES", "Lina llega tarde.", "Desde 9:30 EDT"],
  ] as const)("says a late arrival and the time in %s", (locale, late, label) => {
    const t = staffTranslator(locale);
    expect(catchUpSentences(t, locale, [{ kind: "running_late", names: ["Lina"] }])).toEqual([
      late,
    ]);
    expect(
      t("manifest.catchUp.todayLabel", { time: locale === "en-US" ? "9:30 AM EDT" : "9:30 EDT" }),
    ).toBe(label);
  });
});
