import { describe, expect, it } from "vitest";
import type { DiverStatusRow } from "@/features/diver-status";
import { readinessBlockerText } from "@/i18n/readiness-labels";
import { staffTranslator } from "@/i18n/staff-messages";
import { tripNeedsLines } from "./trip-needs";

describe("trip needs for a submitted lower card", () => {
  it.each(["en-US", "es-ES"] as const)(
    "never calls an unverified card verified in %s",
    (locale) => {
      const blocker = {
        code: "certification_insufficient" as const,
        params: {
          requiredLevel: "advanced_open_water" as const,
          heldLevel: "open_water" as const,
          heldUnverified: true,
        },
      };
      const row = { sentence: { blocker } } as DiverStatusRow;
      const t = staffTranslator(locale);
      expect(tripNeedsLines(t, row)).toEqual([
        { text: readinessBlockerText(t, blocker), notHeld: true },
      ]);
    },
  );
});
