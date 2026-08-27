import type { BirthdayCallout } from "@/lib/age";
import type { StaffTranslator } from "./staff-messages";

/**
 * When a birthday is, in words: "today", "in 2 days", "2 days ago". Just the timing —
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

/**
 * The same timing, **with its subject** — "Birthday in 2 days".
 *
 * For the surfaces where the 🎂 does not ride along to say what the timing is
 * about: the boat manifest, whose marks are drawn SVG and whose rows carry at
 * most one capsule (ADR 20260827-the-departure-is-two-working-surfaces,
 * decision 5), and the printed sheet it produces. Without it a capsule reads
 * "in 7 days" beside a diver's name, which on a manifest is a countdown to
 * nothing anyone can name.
 *
 * Three whole sentences rather than a label interpolated into a fragment: the
 * word order of "birthday" against its timing is a locale's choice, not a JSX
 * literal's.
 */
export function birthdayCalloutText(t: StaffTranslator, callout: BirthdayCallout): string {
  if (callout.status === "today") return t("shared.birthday.calloutToday");
  if (callout.status === "soon") return t("shared.birthday.calloutSoon", { days: callout.inDays });
  return t("shared.birthday.calloutRecent", { days: callout.daysAgo });
}
