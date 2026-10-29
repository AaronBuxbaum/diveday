import { expect, it } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import { rescheduleHoldCopy } from "./reschedule-hold-copy";

it.each(["en-US", "es-ES"] as const)(
  "uses request-locale copy with count-free progress and accurate final counts (%s)",
  (locale) => {
    const t = staffTranslator(locale);
    const copy = rescheduleHoldCopy(t);
    expect(copy.telling).toBe(t("shared.rescheduleHold.telling"));
    expect(copy.telling).not.toContain("1");
    expect(copy.told[20]).toBe(t("shared.rescheduleHold.told", { count: 20 }));
    expect(copy.someMissed[12]).toBe(t("shared.rescheduleHold.someMissed", { count: 12 }));
  },
);
