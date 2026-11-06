import { SectionCard } from "@/components/ui/card";
import type { AppDb } from "@/db/client";
import type { ReadyPageData } from "@/db/ready";
import { listYourDays } from "@/db/your-days";
import type { DiverTranslator } from "@/i18n/messages";
import type { DiverLocale } from "@/i18n/settings";
import { formatOrdinal, formatShortDate, formatTime } from "@/lib/format";
import { openYourDayAction } from "../your-days-actions";
import { YourDayRow, type YourDayRowWords } from "./YourDayRow";

/**
 * **"Your days with Blue Mantis Divers"**: a regular's other bookings with the
 * shop, from this one's page (fifth-loop ideas, item 38; H-20261014-other-days-send-fresh; ADR
 * 20261016-fresh-link-per-booking-row).
 *
 * Every row opens that day's own page (#4059). Reads its own rows, so the
 * page mounts it in one line; renders nothing when there is no other day, on a
 * held seat, whose holder may not be the person on file, or on a link that was
 * not delivered: the one a booking or a seat claim redirects to proves only a
 * typed name and address (security review r5-4, F1).
 */
export async function YourDays({
  ready: { db, token, bookingId, data, delivered },
  locale,
  t,
  className = "mt-10",
}: {
  /** This page's own reads: the booking it opened and what was read for it. */
  ready: { db: AppDb; token: string; bookingId: string; data: ReadyPageData; delivered: boolean };
  locale: DiverLocale;
  t: DiverTranslator;
  className?: string;
}) {
  const shopId = data.shop.id;
  const shopName = data.detail.shop.name;
  const timezone = data.detail.shop.timezone;
  if (data.identityHeld || !delivered) return null;
  const { upcoming, past } = await listYourDays(db, { shopId, bookingId });
  if (upcoming.length === 0 && past.length === 0) return null;

  const words: YourDayRowWords = {
    open: t("yourDays.open"),
    opening: t("words.busy.opening"),
    rateLimited: t("yourDays.rateLimited"),
    unavailable: t("yourDays.unavailable"),
  };
  const action = openYourDayAction.bind(null, token);

  return (
    <SectionCard padding="lg" className={className} title={t("yourDays.heading", { shopName })}>
      {upcoming.length > 0 ? (
        <>
          <h3 className="text-base font-semibold">{t("yourDays.comingUp")}</h3>
          <ul className="mt-2 divide-y divide-border">
            {upcoming.map((day) => (
              <YourDayRow
                key={day.bookingId}
                bookingId={day.bookingId}
                label={t("yourDays.upcomingRow", {
                  date: formatShortDate(day.startsAt, locale, timezone),
                  title: day.title,
                  time: formatTime(day.startsAt, locale, timezone),
                })}
                words={words}
                action={action}
              />
            ))}
          </ul>
        </>
      ) : null}
      {past.length > 0 ? (
        <>
          <h3 className={`${upcoming.length > 0 ? "mt-6 " : ""}text-base font-semibold`}>
            {t("yourDays.logbook")}
          </h3>
          <ul className="mt-2 divide-y divide-border">
            {past.map((day) => (
              <YourDayRow
                key={day.bookingId}
                bookingId={day.bookingId}
                label={t("yourDays.pastRow", {
                  ordinal: formatOrdinal(day.dayNumber ?? 1, locale),
                  title: day.title,
                  date: formatShortDate(day.startsAt, locale, timezone),
                })}
                words={words}
                action={action}
              />
            ))}
          </ul>
        </>
      ) : null}
    </SectionCard>
  );
}
