import { getDb } from "@/db/client";
import { bookingLeadTimes } from "@/db/reporting";
import { staffTranslator } from "@/i18n/staff-messages";
import { calendarDateInTimezone, calendarDateWeekday } from "@/lib/calendar-date";
import { nowDate } from "@/lib/clock";
import { weekdayNames } from "@/lib/format";
import { leadTimeForWeekday, wholePercent } from "@/lib/lead-time";

const YEAR_MS = 365 * 86_400_000;

/**
 * **How late this kind of day sells** (fifth loop, item 34; glossary "Booking
 * lead time"): one line on the deal form, "Saturday departures usually sell
 * 40% of their seats in the last 3 days", over the last twelve months of the
 * shop's departures on this one's weekday. It is what says whether a deal now
 * is early or about to give away seats that were coming anyway. Nothing until
 * that weekday has the history (`leadTimeForWeekday`).
 */
export async function DealLeadTime({
  shopId,
  startsAt,
  timeZone,
  locale,
}: {
  shopId: string;
  startsAt: Date;
  timeZone: string;
  locale: string;
}) {
  const now = nowDate();
  const rows = await bookingLeadTimes(await getDb(), shopId, {
    startUtc: new Date(now.getTime() - YEAR_MS),
    endUtc: now,
    timeZone,
  });
  const weekday = calendarDateWeekday(calendarDateInTimezone(startsAt, timeZone));
  const row = leadTimeForWeekday(rows, weekday === 0 ? 7 : weekday);
  if (!row) return null;
  const t = staffTranslator(locale);
  return (
    <p data-deal-lead-time="" className="mt-1 text-sm text-muted">
      {t("trips.lastMinute.leadTime", {
        weekday: weekdayNames(locale, "long")[weekday] ?? "",
        percent: wholePercent(row.lastThreeDaysShare),
      })}
    </p>
  );
}
