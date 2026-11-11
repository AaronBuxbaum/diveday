import Link from "next/link";
import { buttonClass } from "@/components/ui/button";
import { sectionCardClass } from "@/components/ui/card";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { FIGURE_INLINE_CLASS } from "@/components/ui/typography";
import type { DateInterestRow, DepartureOnTheBoard } from "@/db/interest-dates";
import { summarizeRequestDay } from "@/features/requests-page";
import type { StaffTranslator } from "@/i18n/staff-messages";
import type { CalendarDate } from "@/lib/calendar-date";
import type { DateRequestEntry } from "@/lib/date-requests";
import { formatTime } from "@/lib/format";
import { shopPath } from "@/lib/staff-notices";
import { WEEK_PARAM, weekStartOf } from "@/lib/week-board";

/** A comparison of recorded facts, never a promise that a party can board. */
export function RequestDayPlan({
  date,
  entries,
  departures,
  shopSlug,
  locale,
  timezone,
  crewEnabled,
  crewAwayCountByTrip = new Map(),
  t,
}: {
  date: CalendarDate;
  entries: readonly DateRequestEntry<DateInterestRow>[];
  departures: readonly DepartureOnTheBoard[];
  shopSlug: string;
  locale: string;
  timezone: string;
  crewEnabled: boolean;
  crewAwayCountByTrip?: ReadonlyMap<string, number>;
  t: StaffTranslator;
}) {
  const plan = summarizeRequestDay(entries);
  return (
    <div className={sectionCardClass({ className: "mt-4 grid min-w-0 gap-6 md:grid-cols-2" })}>
      <div className="min-w-0 space-y-3">
        <h3 className="text-sm font-semibold">{t("requests.plan.interestHeading")}</h3>
        <dl className="grid grid-cols-3 gap-3 text-sm">
          {(["preferred", "alternate", "nearby"] as const).map((choice) => (
            <div key={choice}>
              <dt className="text-muted">{t(`requests.plan.${choice}`)}</dt>
              <dd className={FIGURE_INLINE_CLASS}>{plan.choices[choice]}</dd>
            </div>
          ))}
        </dl>
        <p className="text-sm text-muted">
          {t("requests.plan.headcount", { count: plan.knownDivers })}
          {plan.unknownParties > 0
            ? ` · ${t("requests.plan.unknown", { count: plan.unknownParties })}`
            : null}
        </p>
        <ul className="space-y-1 text-sm">
          {plan.interests.map((interest) => (
            <li key={interest.key} className="break-words">
              {t("requests.plan.interest", { title: interest.title, count: interest.count })}
            </li>
          ))}
        </ul>
        {plan.charterParties > 0 ? (
          <p className="text-sm text-muted">
            {t("requests.plan.charters", { count: plan.charterParties })}
          </p>
        ) : null}
      </div>
      <div className="min-w-0 space-y-3">
        <h3 className="text-sm font-semibold">{t("requests.plan.departuresHeading")}</h3>
        {departures.length === 0 ? (
          <p className="text-sm text-muted">{t("requests.plan.noDepartures")}</p>
        ) : (
          <ul className="space-y-4">
            {departures.map((departure) => (
              <li key={departure.tripId} className="min-w-0 space-y-1">
                <Link
                  href={`${shopPath(shopSlug, "trips", departure.tripId)}#who-wants-in`}
                  className={buttonClass({ variant: "link", size: "sm", flush: true })}
                >
                  {t("requests.plan.departure", {
                    title: departure.title,
                    when: formatTime(departure.startsAt, locale, timezone),
                  })}
                </Link>
                <p className="text-sm tabular-nums">
                  {departure.isPrivate
                    ? t("requests.plan.private")
                    : t("requests.plan.seats", { count: departure.seatsLeft })}
                </p>
                {!departure.isPrivate && plan.charterParties === 0 && plan.knownDivers > 0 ? (
                  <ProgressBar
                    aria-hidden="true"
                    className="h-1.5"
                    segments={[
                      {
                        key: "seats",
                        fraction: Math.min(departure.seatsLeft / plan.knownDivers, 1),
                        className: "bg-primary",
                      },
                    ]}
                  />
                ) : null}
                {crewEnabled && (crewAwayCountByTrip.get(departure.tripId) ?? 0) > 0 ? (
                  <p className="text-sm text-warning-strong">
                    {t("requests.plan.crewAway", {
                      count: crewAwayCountByTrip.get(departure.tripId) ?? 0,
                    })}
                  </p>
                ) : null}
                {crewEnabled ? (
                  <p className="text-sm text-muted">
                    {t("requests.plan.crew", { count: departure.assignedCrewCount })}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {crewEnabled ? (
          <Link
            href={`${shopPath(shopSlug, "staffing")}?${WEEK_PARAM}=${weekStartOf(date)}`}
            className={buttonClass({ variant: "link", size: "sm", flush: true })}
          >
            {t("requests.plan.reviewCrew")}
          </Link>
        ) : null}
      </div>
    </div>
  );
}
