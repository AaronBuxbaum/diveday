import type { DiverTranslator } from "@/i18n/messages";
import { courseNextStartLabel } from "../course-date-label";

/**
 * Catalog rows reuse the shelf's shop-local next-start label (UX review 4,
 * item 33). With no date, offer a request link only when the shop accepts
 * email inquiries.
 */
export function courseRowDate(input: {
  nextStart: Date | null;
  canAsk: boolean;
  locale: string;
  timeZone: string;
  t: DiverTranslator;
}): { kind: "next" | "ask"; text: string } | null {
  const { nextStart, t } = input;
  if (nextStart) {
    return {
      kind: "next",
      text: courseNextStartLabel(nextStart, input.locale, input.timeZone, t),
    };
  }
  return input.canAsk ? { kind: "ask", text: t("courses.index.askForADate") } : null;
}
