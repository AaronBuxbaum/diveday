import { describe, expect, it } from "vitest";
import { REMINDER_ACTION_CODES } from "@/lib/readiness-summary";
import { diverTranslator } from "./messages";
import { reminderActionText } from "./reminder-labels";

/**
 * The reminder mail speaks as the shop ("we"), so the to-do line inside it
 * may not switch to talking about "your shop" in the third person (#2448).
 */
describe("reminderActionText", () => {
  const thirdPerson = {
    "en-US": /\b(the|your) shop\b/i,
    "es-ES": /\b(el|tu) centro\b/i,
  } as const;

  for (const locale of ["en-US", "es-ES"] as const) {
    it(`speaks in the shop's own voice in ${locale}`, () => {
      const t = diverTranslator(locale);
      for (const code of REMINDER_ACTION_CODES) {
        expect(reminderActionText(t, code), code).not.toMatch(thirdPerson[locale]);
      }
    });
  }
});
