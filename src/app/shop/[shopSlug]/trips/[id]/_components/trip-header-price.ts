import type { StaffTranslator } from "@/i18n/staff-messages";
import { formatShortDate } from "@/lib/format";

/**
 * **"3 days · Fri, Oct 23 – Sun, Oct 25"** for a departure that meets on more
 * than one day (fourth UX review, item 26), the span the public page states;
 * the header's single date and hours read as a one-day course. Undefined for
 * a one-day departure, which keeps its date and time.
 */
export function tripHeaderDaySpan(
  days: readonly { startsAt: Date }[],
  locale: string,
  timeZone: string,
  t: StaffTranslator,
): string | undefined {
  const first = days[0];
  const last = days.at(-1);
  if (!first || !last || days.length < 2) return undefined;
  return t("trips.about.meetingDaysSummary", {
    count: days.length,
    first: formatShortDate(first.startsAt, locale, timeZone),
    last: formatShortDate(last.startsAt, locale, timeZone),
  });
}
