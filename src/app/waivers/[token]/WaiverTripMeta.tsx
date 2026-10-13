import type { DiverTranslator } from "@/i18n/messages";
import { formatShortDate, formatTimeRangeTz } from "@/lib/format";

/**
 * The lines under the waiver's title: what the page is for, and the trip this
 * release is for (task 42), named so the diver can verify what they are
 * signing for rather than trusting a link that names only the shop. The date
 * and time are the shop's own zone in the reader's locale.
 */
export function WaiverTripMeta({
  tripHeader,
  locale,
  timezone,
  t,
}: {
  tripHeader: { title: string; startsAt: Date; endsAt: Date } | null;
  locale: string;
  timezone: string;
  t: DiverTranslator;
}) {
  return (
    <>
      <p className="mt-2 text-base text-muted">{t("waiver.beforeDockDescription")}</p>
      {tripHeader ? (
        <p className="mt-3 text-base font-medium text-foreground">
          {t("waiver.tripHeader", {
            trip: tripHeader.title,
            when: formatShortDate(tripHeader.startsAt, locale, timezone),
            time: formatTimeRangeTz(tripHeader.startsAt, tripHeader.endsAt, locale, timezone),
          })}
        </p>
      ) : null}
    </>
  );
}
