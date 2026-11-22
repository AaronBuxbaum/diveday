import { cacheLife } from "next/cache";
import { FIGURE_CLASS, SECTION_TITLE_CLASS } from "@/components/ui/typography";
import { getDb } from "@/db/client";
import { readSafetyRecord, type SafetyRecord } from "@/features/boarding/safety-record";
import { cacheStamp, reportCacheRead } from "@/features/platform/runtime-cache";
import type { DiverTranslator } from "@/i18n/messages";
import { type CalendarDate, calendarDateInTimezone } from "@/lib/calendar-date";
import { nowDate } from "@/lib/clock";
import { formatCalendarDateRange } from "@/lib/format";

/**
 * The record's counts, read at most once an hour per shop and day: five
 * statements over every departure the shop has run, for numbers that change
 * when a boat comes home. Keyed on the shop, its zone and the shop's own day,
 * like "Our year" (`OurYear.tsx`, which says why it is plain `"use cache"`).
 */
async function publicSafetyRecord(
  shopId: string,
  timeZone: string,
  // Read by nothing in the body: it is here to be part of the cache key.
  _shopDay: CalendarDate,
) {
  "use cache";
  cacheLife("hours");
  const record = await readSafetyRecord(await getDb(), shopId, timeZone, nowDate());
  return { record, computedAtMs: cacheStamp() };
}

/**
 * **The safety record on the shopfront** (issue #4255): four counts and the
 * days they cover, only while the owner has turned it on
 * (`shops.safety_record_enabled`, off for a new shop) and only once a
 * departure has run. A shop with no history shows nothing, never zeros.
 */
export async function SafetyRecordSection({
  shop,
  locale,
  t,
  className = "",
}: {
  shop: { id: string; timezone: string; safetyRecordEnabled: boolean };
  locale: string;
  t: DiverTranslator;
  className?: string;
}) {
  if (!shop.safetyRecordEnabled) return null;
  const shopDay = calendarDateInTimezone(nowDate(), shop.timezone);
  const cached = await publicSafetyRecord(shop.id, shop.timezone, shopDay);
  reportCacheRead("safety_record", cached.computedAtMs, { shopId: shop.id });
  if (!cached.record) return null;
  return <SafetyRecordPanel record={cached.record} locale={locale} t={t} className={className} />;
}

/** The panel itself: a heading, the days it covers, and the four counts. */
export function SafetyRecordPanel({
  record,
  locale,
  t,
  className = "",
}: {
  record: SafetyRecord;
  locale: string;
  t: DiverTranslator;
  className?: string;
}) {
  const counts = [
    {
      key: "departures",
      count: record.departures,
      label: t("safetyRecord.departures", { count: record.departures }),
    },
    {
      key: "divers",
      count: record.boardings,
      label: t("safetyRecord.divers", { count: record.boardings }),
    },
    {
      key: "rollCalls",
      count: record.rollCallsCompleted,
      label: t("safetyRecord.rollCalls", { count: record.rollCallsCompleted }),
    },
    {
      key: "readiness",
      count: record.readinessCompleted,
      label: t("safetyRecord.readiness", { count: record.readinessCompleted }),
    },
  ];
  return (
    <section aria-labelledby="our-record" className={className}>
      <h2 id="our-record" className={SECTION_TITLE_CLASS}>
        {t("safetyRecord.heading")}
      </h2>
      <p className="mt-1 text-sm text-muted">
        {t("safetyRecord.range", {
          range: formatCalendarDateRange(record.startsOn, record.endsOn, locale),
        })}
      </p>
      <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
        {counts.map(({ key, count, label }) => (
          <div key={key}>
            <dt className="text-sm text-muted">{label}</dt>
            <dd className={`${FIGURE_CLASS} text-foreground`}>
              {t("safetyRecord.count", { count })}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
