import type { BirthdayCallout } from "@/lib/age";
import type { StaffTranslator } from "./staff-messages";

/**
 * Returns a full birthday sentence for roster and manifest surfaces, where no
 * cake glyph accompanies the timing. Keep subject and timing in each locale's
 * message because their word order varies.
 */
export function birthdayCalloutText(t: StaffTranslator, callout: BirthdayCallout): string {
  if (callout.status === "today") return t("shared.birthday.calloutToday");
  if (callout.status === "soon") return t("shared.birthday.calloutSoon", { days: callout.inDays });
  return t("shared.birthday.calloutRecent", { days: callout.daysAgo });
}
