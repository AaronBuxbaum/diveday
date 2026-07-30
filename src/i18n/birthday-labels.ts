import type { BirthdayCallout } from "@/lib/age";
import type { StaffTranslator } from "./staff-messages";

/**
 * When a birthday is, in words: "today", "in 2d", "2d ago". Just the timing —
 * the 🎂 beside it carries the meaning, so the text stays short enough to sit
 * in a badge on an already-dense roster row.
 *
 * `src/lib/age.ts` returns the shape and never the sentence; this is where the
 * words are chosen (AGENTS.md — domain returns codes, the UI picks the copy).
 */
export function birthdayText(t: StaffTranslator, callout: BirthdayCallout): string {
  if (callout.status === "today") return t("shared.birthday.today");
  if (callout.status === "soon") return t("shared.birthday.soon", { days: callout.inDays });
  return t("shared.birthday.recent", { days: callout.daysAgo });
}
