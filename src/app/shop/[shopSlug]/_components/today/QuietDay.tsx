import Link from "next/link";
import { buttonClass } from "@/components/ui/button";
import { LedgerRow } from "@/components/ui/ledger";
import type { StaffTranslator } from "@/i18n/staff-messages";
import type { DayLoadOut } from "@/lib/closeout";
import { formatShortDate, formatTime } from "@/lib/format";
import { TomorrowFromTonight } from "./TomorrowFromTonight";

/**
 * **The quiet day** (`spineIsQuiet`): the home collapsed to the one act
 * available, the next departure, and, when tomorrow sails, what it needs from
 * tonight. A no-boat Monday before a full, ready Tuesday is still the evening
 * the fill station and the printed day are for (dive-domain review FIX 2).
 */
export function QuietDay({
  shopSlug,
  nextDeparture,
  loadOut,
  locale,
  timeZone,
  t,
}: {
  shopSlug: string;
  nextDeparture: {
    tripId: string;
    title: string;
    startsAt: Date;
    booked: number;
    sellableCapacity: number;
  } | null;
  /** `assembleEveningClose(...).tomorrow`; null says nothing. */
  loadOut: DayLoadOut | null;
  locale: string;
  timeZone: string;
  t: StaffTranslator;
}) {
  return (
    <div className="mt-8 flex flex-col gap-4">
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
      {loadOut ? <TomorrowFromTonight loadOut={loadOut} shopSlug={shopSlug} t={t} /> : null}
    </div>
  );
}
