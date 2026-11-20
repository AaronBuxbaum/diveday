import Link from "next/link";
import { buttonClass } from "@/components/ui/button";
import { LedgerRow } from "@/components/ui/ledger";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { calendarDateInTimezone } from "@/lib/calendar-date";
import { nowDate } from "@/lib/clock";
import type { DayLoadOut } from "@/lib/closeout-kinds";
import { formatShortDate, formatTime } from "@/lib/format";
import { quietDayTipIndex } from "@/lib/quiet-day-tip";
import { QuietDaySuggestions } from "./QuietDaySuggestions";
import { QuietDayThinBoats } from "./QuietDayThinBoats";
import { TomorrowFromTonight } from "./TomorrowFromTonight";

const QUIET_TIPS = [
  "shopHome.quietTip.0",
  "shopHome.quietTip.1",
  "shopHome.quietTip.2",
  "shopHome.quietTip.3",
  "shopHome.quietTip.4",
  "shopHome.quietTip.5",
] as const;

/**
 * **The quiet day** (`spineIsQuiet`): the home collapsed to the boats that
 * could use divers, the one act available, the next departure, and, when
 * tomorrow sails, what it needs from tonight. A no-boat Monday before a full,
 * ready Tuesday is still the evening the fill station and the printed day are
 * for (dive-domain review FIX 2). The week after's boats with someone blocked
 * come first (issue #4257): that is real work a quiet day can start.
 */
export function QuietDay({
  shop,
  nextDeparture,
  loadOut,
  locale,
  t,
}: {
  /** The signed-in shop, the one row every query below names (security review N7). */
  shop: { id: string; slug: string; timezone: string };
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
  t: StaffTranslator;
}) {
  const { id: shopId, slug: shopSlug, timezone: timeZone } = shop;
  return (
    <div className="mt-8 flex flex-col gap-4">
      <QuietDaySuggestions
        shopId={shopId}
        shopSlug={shopSlug}
        locale={locale}
        timeZone={timeZone}
        t={t}
      />
      <QuietDayThinBoats
        shopId={shopId}
        shopSlug={shopSlug}
        locale={locale}
        timeZone={timeZone}
        t={t}
      />
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
      {/* After the work, never before it: one line for the dock, by the shop's own day (issue #4263). */}
      <p className="text-sm text-muted">
        {t(
          QUIET_TIPS[quietDayTipIndex(calendarDateInTimezone(nowDate(), timeZone))] ??
            QUIET_TIPS[0],
        )}
      </p>
    </div>
  );
}
