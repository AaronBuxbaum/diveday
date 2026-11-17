import { RepeatFields } from "@/components/RepeatFields";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { ChoiceRow, FormStatus } from "@/components/ui/form";
import { InlineConfirm } from "@/components/ui/InlineConfirm";
import { type StaffTranslator, staffTranslator } from "@/i18n/staff-messages";
import type { CalendarDate } from "@/lib/calendar-date";
import { cachedListFormat } from "@/lib/intl-cache";
import { type WeekdaySet, weekdaysIn } from "@/lib/recurrence";
import type { FormNotice } from "@/lib/staff-notices";

/**
 * What "Cancel every upcoming date" will do, said before the tap: how many
 * dates, how many booked divers it messages, and how many of them have paid,
 * because each of those is refunded or owed (`cancelFutureSeriesTrips`).
 */
function cancelConfirmText(
  t: StaffTranslator,
  reach: { dates: number; booked: number; paid: number; refundsHeld?: boolean },
): string {
  const parts = [t("tripSeries.panel.cancelDescription", { count: reach.dates })];
  if (reach.booked === 0) {
    parts.push(t("tripSeries.panel.cancelReachNone"));
  } else {
    parts.push(t("tripSeries.panel.cancelReach", { count: reach.booked }));
    if (reach.paid > 0) {
      parts.push(
        t(
          reach.refundsHeld
            ? "tripSeries.panel.cancelReachPaidHeld"
            : "tripSeries.panel.cancelReachPaid",
          { count: reach.paid },
        ),
      );
    }
  }
  return parts.join(" ");
}

/** An upcoming date the edited cadence no longer fires on, as the panel shows it. */
export type OffCadenceDate = { id: string; title: string; label: string; booked: number };

/**
 * **The cadence, edited on the run's page under Schedule** (ADR
 * 20261117-trip-page-clock); the three series-wide acts sit below it
 * (`SeriesMoreActions`).
 *
 * Narrowing a run is still never a silent bulk cancellation: the dates that no
 * longer fit are listed here, with their head counts, and taken off the board
 * only if staff say so.
 */
export function SeriesCadenceEditor({
  intervalWeeks,
  weekdays,
  endsOn,
  anchorDate,
  offCadence,
  weekdayNames,
  status,
  cadenceAction,
  cancelOffCadenceAction,
  refundsHeld = false,
  locale,
}: {
  intervalWeeks: number;
  weekdays: WeekdaySet;
  /** The series' last date, or null when it simply keeps going. */
  endsOn: CalendarDate | null;
  /** The cadence's phase date — the earliest day the editor will accept as an end. */
  anchorDate: CalendarDate;
  /**
   * Upcoming dates the *current* cadence no longer fires on — non-empty only
   * after staff narrowed the run and have not yet said what to do about them.
   */
  offCadence: OffCadenceDate[];
  /** The seven weekday names for the request locale, Sunday first. */
  weekdayNames: string[];
  /**
   * What the last series action did — apply, cadence, repeat, or cancel. One
   * status for all of them: they are one subject and only one can have just run,
   * and this is where the run's page puts the answer.
   */
  status?: FormNotice;
  cadenceAction: (formData: FormData) => void;
  cancelOffCadenceAction: () => void;
  /** True when this staffer may not refund; the card refunds wait for an owner or manager (H-20261013-call-off-queues-refunds). */
  refundsHeld?: boolean;
  locale: string;
}) {
  const t = staffTranslator(locale);
  const bookedOffCadence = offCadence.filter((date) => date.booked > 0).length;
  return (
    <div className="flex flex-col gap-4 pt-1">
      <FormStatus tone={status?.tone}>{status?.text}</FormStatus>

      {/* The dates the *saved* cadence no longer fires on. Above the editor,
          not below it, because it is the one thing here that is a consequence
          of what staff just did rather than an offer — and it is never acted on
          for them. Absent entirely except after somebody narrows a run. */}
      {offCadence.length > 0 ? (
        <form
          action={cancelOffCadenceAction}
          className="flex flex-col gap-2 rounded-lg border border-warning/40 bg-surface-sunken p-4"
        >
          <p className="text-sm font-medium">
            {t("tripSeries.panel.offCadenceHeading", { count: offCadence.length })}
          </p>
          <ul className="flex flex-col gap-0.5 text-sm text-muted">
            {offCadence.map((date) => (
              <li key={date.id}>
                {date.booked > 0
                  ? t("tripSeries.panel.offCadenceDateBooked", {
                      date: date.label,
                      count: date.booked,
                    })
                  : t("tripSeries.panel.offCadenceDateEmpty", { date: date.label })}
              </li>
            ))}
          </ul>
          <SubmitButton
            pendingLabel={t("words.busy.canceling")}
            className={buttonClass({ variant: "danger", className: "w-fit" })}
          >
            {t("tripSeries.panel.cancelOffCadence", { count: offCadence.length })}
          </SubmitButton>
          <p className="text-sm text-muted">
            {bookedOffCadence > 0
              ? t(
                  refundsHeld
                    ? "tripSeries.panel.offCadenceDescriptionBookedHeld"
                    : "tripSeries.panel.offCadenceDescriptionBooked",
                  { count: bookedOffCadence },
                )
              : t("tripSeries.panel.offCadenceDescription")}
          </p>
        </form>
      ) : null}

      <form action={cadenceAction} className="rounded-inset bg-surface-sunken p-4 sm:p-5">
        <p className="mb-4 max-w-prose text-sm text-muted">
          {t("tripSeries.panel.editCadenceDescription")}
        </p>
        <RepeatFields
          startDate={anchorDate}
          initial={{ intervalWeeks, weekdays: weekdaysIn(weekdays), endsOn }}
          copy={{
            howOftenLabel: t("schedule.builder.howOftenLabel"),
            doesntRepeat: t("schedule.builder.doesntRepeat"),
            everyWeek: t("schedule.builder.everyWeek"),
            every2Weeks: t("schedule.builder.every2Weeks"),
            every4Weeks: t("schedule.builder.every4Weeks"),
            repeatsOnLabel: t("schedule.builder.repeatsOnLabel"),
            everyDay: t("schedule.builder.everyDay"),
            endsLabel: t("schedule.builder.endsLabel"),
            endsNever: t("schedule.builder.endsNever"),
            endsOnChoice: t("schedule.builder.endsOnChoice"),
            endsOnLabel: t("schedule.builder.endsOnLabel"),
            weekdayNames,
          }}
        />
        <SubmitButton
          pendingLabel={t("words.busy.saving")}
          className={buttonClass({ variant: "primary", className: "mt-5" })}
        >
          {t("tripSeries.panel.saveCadence")}
        </SubmitButton>
      </form>
    </div>
  );
}

/**
 * The three series-wide acts, one column on the run's page.
 *
 * Each instance of a repeating trip stays fully independent — these are
 * conveniences over the per-date tooling, never a live link that rewrites
 * siblings behind staff's back (20260719-recurring-trip-series). There is no
 * "add more dates" control, and its absence is the feature: an open-ended
 * series keeps its own next few months on the board (ADR
 * 20260810-open-ended-recurring-trips).
 *
 * **No standing captions.** Each of these three used to carry a sentence under
 * it explaining what it would do, permanently, to a staffer who was not doing
 * any of them. The two that write across every upcoming date now say it in the
 * confirm they open — where somebody is about to act on it, and where it is
 * also the thing that makes the confirm worth reading. Stopping a repeat says
 * nothing beforehand because it is reversible: the control opposite it is
 * "Start repeating again", and the notice the save lands on states what
 * happened to the dates already on the board (principle 7).
 */
export function SeriesMoreActions({
  series,
  crewNames,
  applyAction,
  cancelAction,
  repeatAction,
  refundsHeld = false,
  locale,
}: {
  /**
   * The run as `getTripSeriesSummary` reads it: its upcoming dates, the divers
   * booked on them ("cancel every upcoming date" reaches those), how many of
   * them have money with the shop, whether it carries a standing crew, and its
   * last date (null when it simply keeps going).
   */
  series: {
    futureScheduledCount: number;
    futureBookedCount: number;
    futurePaidCount: number;
    standingCrew: boolean;
    endsOn: CalendarDate | null;
  };
  /** This date's crew by name; empty hides the standing-crew choice. */
  crewNames: string[];
  applyAction: (formData: FormData) => void;
  cancelAction: () => void;
  repeatAction: (formData: FormData) => void;
  /** True when this staffer may not refund; the card refunds wait for an owner or manager (H-20261013-call-off-queues-refunds). */
  refundsHeld?: boolean;
  locale: string;
}) {
  const t = staffTranslator(locale);
  const { futureScheduledCount, futureBookedCount, futurePaidCount, standingCrew, endsOn } = series;
  const hasFuture = futureScheduledCount > 0;
  const hasOtherFuture = futureScheduledCount > 1;
  const repeating = endsOn === null;
  return (
    <>
      {hasOtherFuture ? (
        <form action={applyAction} className="w-full">
          <InlineConfirm
            triggerLabel={t("tripSeries.panel.applyToSeries")}
            message={
              crewNames.length > 0
                ? t("tripSeries.panel.applyDescriptionWithCrew")
                : t("tripSeries.panel.applyDescription")
            }
            extra={
              crewNames.length > 0 ? (
                <>
                  <input type="hidden" name="crewSwitch" value="shown" />
                  <ChoiceRow type="checkbox" name="standingCrew" defaultChecked={standingCrew}>
                    {t("tripSeries.panel.standingCrew", {
                      names: cachedListFormat(locale, { type: "conjunction" }).format(crewNames),
                    })}
                  </ChoiceRow>
                </>
              ) : undefined
            }
            confirmLabel={t("tripSeries.panel.applyConfirm")}
            cancelLabel={t("words.dismiss.neverMind")}
            pendingLabel={t("tripSeries.panel.applying")}
            triggerClassName={buttonClass({ variant: "link", size: "sm", flush: true })}
            confirmClassName={buttonClass({ variant: "secondary", size: "sm" })}
          />
        </form>
      ) : null}

      {/* One switch, two directions — a series that was stopped (or arrived
          finite from before this feature existed) can be turned back on, so
          "stop repeating" is never a door that only shuts. */}
      <form action={repeatAction}>
        <input type="hidden" name="keepRepeating" value={repeating ? "no" : "yes"} />
        <SubmitButton
          pendingLabel={t("words.busy.saving")}
          className={buttonClass({ variant: "link", size: "sm", flush: true })}
        >
          {repeating ? t("tripSeries.panel.stopRepeating") : t("tripSeries.panel.startRepeating")}
        </SubmitButton>
      </form>

      {hasFuture ? (
        <form action={cancelAction} className="w-full">
          <InlineConfirm
            triggerLabel={t("tripSeries.panel.cancelAllUpcoming")}
            message={cancelConfirmText(t, {
              dates: futureScheduledCount,
              booked: futureBookedCount,
              paid: futurePaidCount,
              refundsHeld,
            })}
            confirmLabel={t("tripSeries.panel.cancelAllConfirm")}
            cancelLabel={t("words.dismiss.neverMind")}
            pendingLabel={t("words.busy.canceling")}
            triggerClassName={buttonClass({ variant: "danger-ghost", size: "sm", flush: true })}
            confirmClassName={buttonClass({ variant: "danger", size: "sm" })}
          />
        </form>
      ) : null}
    </>
  );
}
