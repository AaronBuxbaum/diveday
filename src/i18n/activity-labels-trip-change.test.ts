import { describe, expect, it } from "vitest";
import { tripChangeEventKind } from "@/db/schema/activity";
import { shopActivityLineText } from "./activity-labels";
import { staffTranslator } from "./staff-messages";

/**
 * **Every plan-change kind has a sentence in the shop's log** (review of
 * #3061, security note 3). The log reads `trip_change_events.kind` straight
 * off the column, so a kind the enum gained without a sentence rendered as
 * "unknown" for every site edit the office made. Held to the enum itself, so
 * the next kind fails here rather than on a shop's screen.
 */
describe("the plan-change trail in the shop's log", () => {
  it.each(["en-US", "es-ES"])("words every trip change kind in %s", (locale) => {
    const t = staffTranslator(locale);
    for (const code of tripChangeEventKind.enumValues) {
      const line = shopActivityLineText(t, {
        source: "trip_change",
        code,
        params: {},
        actorName: "Marisol Vega",
      });
      expect(line, code).not.toBe(t("activity.unknown"));
      expect(line, code).toContain("Marisol Vega");
      expect(line, code).not.toMatch(/[{}]|activity\./);
    }
  });

  it("says a site edit was a site edit", () => {
    expect(
      shopActivityLineText(staffTranslator("en-US"), {
        source: "trip_change",
        code: "site_change",
        params: {},
        actorName: "Marisol Vega",
      }),
    ).toBe("Marisol Vega changed the dive sites");
  });
});
