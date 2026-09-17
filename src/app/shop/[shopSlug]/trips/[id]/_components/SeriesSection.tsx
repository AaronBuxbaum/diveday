import { RepeatFields } from "@/components/RepeatFields";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { FormStatus } from "@/components/ui/form";
import { InlineConfirm } from "@/components/ui/InlineConfirm";
import { type StaffMessageKey, type StaffTranslator, staffTranslator } from "@/i18n/staff-messages";
import { type CalendarDate, formatCalendarDate } from "@/lib/calendar-date";
import { weekdayNames } from "@/lib/format";
import { cachedListFormat } from "@/lib/intl-cache";
import {
  type RecurrenceCadence,
  type RecurrenceSummary,
  type WeekdaySet,
  weekdaysIn,
} from "@/lib/recurrence";
import type { FormNotice } from "@/lib/staff-notices";

/**
 * `recurrenceSummary` returns codes, not prose (src/lib/recurrence.ts) — this
 * map is where the cadence half of it becomes a word in the staff bundle.
 * Shared with `trips/[id]/page.tsx`'s "part of a series" line, which composes
 * the same summary into a different parent sentence.
 */
const RECURRENCE_CADENCE_KEYS: Record<RecurrenceCadence, StaffMessageKey> = {
  daily: "tripSeries.panel.cadenceDaily",
  weekly: "tripSeries.panel.cadenceWeekly",
  everyNWeeks: "tripSeries.panel.cadenceEveryNWeeks",
};

/**
 * The one sentence a `RecurrenceSummary` renders as, e.g. "Repeats weekly on
 * Mon and Thu · keeps going".
 *
 * Three composed pieces, never string concatenation: the weekday list comes
 * from `Intl.ListFormat` (which knows where a locale puts its "and"), the
 * cadence from one ICU template that receives that list, and the tail from a
 * second template that says whether the run has an end. "Every day" needs no
 * day list at all — spelling out all seven would be noise.
 */
export function recurrenceSummaryText(
  t: StaffTranslator,
  locale: string,
  summary: RecurrenceSummary,
): string {
  const names = weekdayNames(locale);
  const days = cachedListFormat(locale, { type: "conjunction" }).format(
    summary.weekdays.map((day) => names[day] ?? ""),
  );
  const cadence =
    // No days at all is the deploy-window sentinel a release that predates the
    // weekday set could leave behind (see `trip_series.weekday_mask`). It never
    // generates a date, so the honest line says the cadence is unset rather
    // than trailing a dangling "on ".
    summary.weekdays.length === 0
      ? t("tripSeries.panel.cadenceUnset")
      : summary.cadence === "daily"
        ? t(RECURRENCE_CADENCE_KEYS.daily)
        : summary.cadence === "weekly"
          ? t(RECURRENCE_CADENCE_KEYS.weekly, { days })
          : t(RECURRENCE_CADENCE_KEYS.everyNWeeks, { weeks: summary.intervalWeeks, days });
  return summary.endsOn
    ? t("tripSeries.panel.summaryUntil", {
        cadence,
        date: formatCalendarDate(summary.endsOn, locale),
      })
    : t("tripSeries.panel.summaryOpenEnded", { cadence });
}

/** An upcoming date the edited cadence no longer fires on, as the panel shows it. */
export type OffCadenceDate = { id: string; title: string; label: string; booked: number };

/**
 * **The cadence, edited where it is stated** — the About panel's "Repeats" row
 * opens onto this.
 *
 * It used to be a headed "Repeating trip" card restating the row's own
 * sentence, with the cadence form behind a second disclosure inside it and
 * three full-width series buttons stacked underneath, each with a standing
 * caption (design review 2026-09-17). The row is the heading now, the summary
 * and the control; the three series-wide acts moved to the panel's "More"
 * disclosure (`SeriesMoreActions`).
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
   * and this row is where the About panel puts the answer.
   */
  status?: FormNotice;
  cadenceAction: (formData: FormData) => void;
  cancelOffCadenceAction: () => void;
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
            pendingLabel={t("tripSeries.panel.cancelling")}
            className={buttonClass({ variant: "danger", className: "w-fit" })}
          >
            {t("tripSeries.panel.cancelOffCadence", { count: offCadence.length })}
          </SubmitButton>
          <p className="text-sm text-muted">
            {bookedOffCadence > 0
              ? t("tripSeries.panel.offCadenceDescriptionBooked", { count: bookedOffCadence })
              : t("tripSeries.panel.offCadenceDescription")}
          </p>
        </form>
      ) : null}

      <form action={cadenceAction} className="rounded-inset bg-surface-sunken p-4 sm:p-5">
        <p className="max-w-prose text-sm text-muted">
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
          pendingLabel={t("tripSeries.panel.saving")}
          className={buttonClass({ variant: "primary", className: "mt-5" })}
        >
          {t("tripSeries.panel.saveCadence")}
        </SubmitButton>
      </form>
    </div>
  );
}

/**
 * The three series-wide acts, as items in the About panel's "More" column.
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
  futureScheduledCount,
  endsOn,
  applyAction,
  cancelAction,
  repeatAction,
  locale,
}: {
  futureScheduledCount: number;
  /** The series' last date, or null when it simply keeps going. */
  endsOn: CalendarDate | null;
  applyAction: () => void;
  cancelAction: () => void;
  repeatAction: (formData: FormData) => void;
  locale: string;
}) {
  const t = staffTranslator(locale);
  const hasFuture = futureScheduledCount > 0;
  const hasOtherFuture = futureScheduledCount > 1;
  const repeating = endsOn === null;
  return (
    <>
      {hasOtherFuture ? (
        <form action={applyAction} className="w-full">
          <InlineConfirm
            triggerLabel={t("tripSeries.panel.applyToSeries")}
            message={t("tripSeries.panel.applyDescription")}
            confirmLabel={t("tripSeries.panel.applyConfirm")}
            cancelLabel={t("tripSeries.panel.neverMind")}
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
          pendingLabel={t("tripSeries.panel.saving")}
          className={buttonClass({ variant: "link", size: "sm", flush: true })}
        >
          {repeating ? t("tripSeries.panel.stopRepeating") : t("tripSeries.panel.startRepeating")}
        </SubmitButton>
      </form>

      {hasFuture ? (
        <form action={cancelAction} className="w-full">
          <InlineConfirm
            triggerLabel={t("tripSeries.panel.cancelAllUpcoming")}
            message={t("tripSeries.panel.cancelDescription", { count: futureScheduledCount })}
            confirmLabel={t("tripSeries.panel.cancelAllConfirm")}
            cancelLabel={t("tripSeries.panel.neverMind")}
            pendingLabel={t("tripSeries.panel.cancelling")}
            triggerClassName={buttonClass({ variant: "danger-ghost", size: "sm", flush: true })}
            confirmClassName={buttonClass({ variant: "danger", size: "sm" })}
          />
        </form>
      ) : null}
    </>
  );
}
