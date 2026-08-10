import { RepeatFields } from "@/components/RepeatFields";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { FormStatus } from "@/components/ui/form";
import { type StaffMessageKey, type StaffTranslator, staffTranslator } from "@/i18n/staff-messages";
import { type CalendarDate, formatCalendarDate } from "@/lib/calendar-date";
import { weekdayNames } from "@/lib/format";
import { cachedListFormat } from "@/lib/intl-cache";
import {
  type RecurrenceCadence,
  type RecurrenceSummary,
  recurrenceSummary,
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
 * Series-wide controls for a materialized recurring trip: apply this date's
 * template to the rest of the run, change the cadence, stop (or restart) the
 * repeat, or cancel every upcoming date at once. Each instance stays fully
 * independent — these are conveniences over the per-date tooling, never a live
 * link that rewrites siblings behind staff's back
 * (20260719-recurring-trip-series).
 *
 * There is no "add more dates" control, and its absence is the feature: an
 * open-ended series keeps its own next few months on the board (ADR
 * 20260810-open-ended-recurring-trips).
 *
 * The cadence editor below is deliberately asymmetric. Widening a run — a
 * weekday added, the end date pushed out — just saves and the new dates appear.
 * Narrowing one saves the cadence and then *asks*: the dates that no longer fit
 * are ordinary departures with divers on them, so they are listed with their
 * head counts and taken off the board only if staff say so.
 */
export function SeriesSection({
  intervalWeeks,
  weekdays,
  endsOn,
  anchorDate,
  futureScheduledCount,
  horizonDays,
  offCadence,
  weekdayNames,
  status,
  applyAction,
  cancelAction,
  repeatAction,
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
  futureScheduledCount: number;
  /** How far ahead the board is kept full, for the "keeps going" explanation. */
  horizonDays: number;
  /**
   * Upcoming dates the *current* cadence no longer fires on — non-empty only
   * after staff narrowed the run and have not yet said what to do about them.
   */
  offCadence: OffCadenceDate[];
  /** The seven weekday names for the request locale, Sunday first. */
  weekdayNames: string[];
  /**
   * What the last series action did — apply, cadence, repeat, or cancel. One
   * status for all of them: they share a section and only one can have just run.
   */
  status?: FormNotice;
  applyAction: () => void;
  cancelAction: () => void;
  repeatAction: (formData: FormData) => void;
  cadenceAction: (formData: FormData) => void;
  cancelOffCadenceAction: () => void;
  locale: string;
}) {
  const t = staffTranslator(locale);
  const hasFuture = futureScheduledCount > 0;
  const hasOtherFuture = futureScheduledCount > 1;
  const repeating = endsOn === null;
  const bookedOffCadence = offCadence.filter((date) => date.booked > 0).length;
  const summary = recurrenceSummaryText(
    t,
    locale,
    recurrenceSummary({ intervalWeeks, weekdays, endsOn }),
  );
  return (
    <section className="mt-12 rounded-xl border border-border bg-surface p-5">
      <h2 className="text-base font-semibold">{t("tripSeries.panel.heading")}</h2>
      <p className="mt-1 text-sm text-muted">
        {hasFuture
          ? t("tripSeries.panel.summaryWithFuture", { summary, count: futureScheduledCount })
          : t("tripSeries.panel.summaryAllDone", { summary })}
      </p>

      <FormStatus tone={status?.tone} className="mt-2">
        {status?.text}
      </FormStatus>

      <div className="mt-4 flex flex-col gap-4">
        {hasOtherFuture ? (
          <form action={applyAction} className="flex flex-col gap-1.5">
            <SubmitButton
              pendingLabel={t("tripSeries.panel.applying")}
              className={buttonClass({ variant: "secondary" })}
            >
              {t("tripSeries.panel.applyToSeries")}
            </SubmitButton>
            <p className="text-sm text-muted">{t("tripSeries.panel.applyDescription")}</p>
          </form>
        ) : null}

        {/* The dates the *saved* cadence no longer fires on. Rendered above the
            controls, not below, because it is the one thing here that is a
            consequence of what staff just did rather than an offer — and it is
            never acted on for them. Absent entirely when there are none, which
            is every state except "somebody just narrowed a run". */}
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

        {/* The rare half, collapsed: a cadence is set once and changed
            occasionally, so it costs a line at rest and opens when asked
            (design principles #8). A `<details>`, not client state — the panel
            around it renders on the server and this needs no JavaScript to
            open. */}
        <details className="group/cadence">
          <summary className="flex min-h-11 w-fit cursor-pointer list-none items-center gap-2 text-sm font-medium select-none [&::-webkit-details-marker]:hidden">
            <span
              aria-hidden="true"
              className="inline-block text-xs text-muted transition-transform duration-200 group-open/cadence:rotate-90"
            >
              ▸
            </span>
            {t("tripSeries.panel.editCadence")}
          </summary>
          <form action={cadenceAction} className="mt-2 rounded-lg border border-border p-4">
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
                repeatsOnDescription: t("schedule.builder.repeatsOnDescription"),
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
        </details>

        {/* One switch, two directions — a series that was stopped (or arrived
            finite from before this feature existed) can be turned back on, so
            "stop repeating" is never a door that only shuts. */}
        <form action={repeatAction} className="flex flex-col gap-1.5">
          <input type="hidden" name="keepRepeating" value={repeating ? "no" : "yes"} />
          <SubmitButton
            pendingLabel={t("tripSeries.panel.saving")}
            className={buttonClass({ variant: "secondary" })}
          >
            {repeating ? t("tripSeries.panel.stopRepeating") : t("tripSeries.panel.startRepeating")}
          </SubmitButton>
          <p className="text-sm text-muted">
            {repeating
              ? t("tripSeries.panel.stopRepeatingDescription")
              : t("tripSeries.panel.startRepeatingDescription", { days: horizonDays })}
          </p>
        </form>

        {hasFuture ? (
          <form action={cancelAction} className="flex flex-col gap-1.5">
            <SubmitButton
              pendingLabel={t("tripSeries.panel.cancelling")}
              className={buttonClass({ variant: "danger" })}
            >
              {t("tripSeries.panel.cancelAllUpcoming")}
            </SubmitButton>
            <p className="text-sm text-muted">
              {t("tripSeries.panel.cancelDescription", { count: futureScheduledCount })}
            </p>
          </form>
        ) : null}
      </div>
    </section>
  );
}
