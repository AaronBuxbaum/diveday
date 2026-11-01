import type { DiverTranslator } from "@/i18n/messages";
import { formatShortDate } from "@/lib/format";

/** Format the shared catalog/shelf next-start label in the shop's timezone. */
export function courseNextStartLabel(
  date: Date,
  locale: string,
  timeZone: string,
  t: DiverTranslator,
): string {
  return t("courses.shelf.nextStart", { date: formatShortDate(date, locale, timeZone) });
}
