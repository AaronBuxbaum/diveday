import type { DiverTranslator } from "@/i18n/messages";
import { formatShortDate } from "@/lib/format";

/**
 * **When a course next runs, on the catalog's row** (fourth UX review, item
 * 33). The storefront's shelf said "Next Fri, Oct 23" under Open Water, and
 * the catalog a diver opens from the nav said nothing, so finding a date meant
 * opening every course. The same line here, from the same read
 * (`nextSessionStartByCourse`); a course with no session on the board offers
 * "Ask for a date" instead, the door its own page keeps (`#get-in-touch`),
 * when the shop takes date requests by email. Otherwise, nothing.
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
      text: t("courses.shelf.nextStart", {
        date: formatShortDate(nextStart, input.locale, input.timeZone),
      }),
    };
  }
  return input.canAsk ? { kind: "ask", text: t("courses.index.askForADate") } : null;
}
