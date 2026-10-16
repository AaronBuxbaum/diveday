import Link from "next/link";
import { buttonClass } from "@/components/ui/button";
import { LedgerRow } from "@/components/ui/ledger";
import type { getTodayWork } from "@/db/today";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { formatShortDate, formatTime } from "@/lib/format";
import { QuietDayThinBoats } from "./QuietDayThinBoats";

type NextDeparture = NonNullable<Awaited<ReturnType<typeof getTodayWork>>["nextDeparture"]>;

/**
 * A day with nothing on it: the boats that could use divers, the one act
 * available, and the next boat if there is one.
 */
export function TodayQuietDay({
  shopSlug,
  nextDeparture,
  locale,
  timeZone,
  t,
}: {
  shopSlug: string;
  nextDeparture: NextDeparture | null;
  locale: string;
  timeZone: string;
  t: StaffTranslator;
}) {
  return (
    <div className="mt-8 flex flex-col gap-4">
      <QuietDayThinBoats shopSlug={shopSlug} locale={locale} timeZone={timeZone} t={t} />
      <Link
        href={`/shop/${shopSlug}/schedule/board?add=1`}
        className={buttonClass({ className: "w-full justify-center sm:w-auto" })}
      >
        {t("shopHome.quietAddDeparture")}
      </Link>
      {nextDeparture ? (
        <ul>
          <LedgerRow
            href={`/shop/${shopSlug}/trips/${nextDeparture.tripId}`}
            linkLabel={nextDeparture.title}
          >
            <div className="min-w-0">
              <p className="font-medium break-words">{nextDeparture.title}</p>
              <p className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 text-sm text-muted tabular-nums">
                <span>{t("shopHome.quietNextDepartureLabel")}</span>
                <span>
                  {formatShortDate(nextDeparture.startsAt, locale, timeZone)} ·{" "}
                  {formatTime(nextDeparture.startsAt, locale, timeZone)}
                </span>
                <span>
                  {nextDeparture.booked}/{nextDeparture.sellableCapacity}
                </span>
              </p>
            </div>
          </LedgerRow>
        </ul>
      ) : null}
    </div>
  );
}
