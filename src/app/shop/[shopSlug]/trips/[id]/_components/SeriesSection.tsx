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
} from "@/lib/recurrence";
import type { FormNotice } from "@/lib/staff-notices";

/**
 * `recurrenceSummary` returns codes, not prose (src/lib/recurrence.ts) — this
 * map is where the cadence half of it becomes a word in the staff bundle.
 * Shared with `trips/[id]/page.tsx`'s "part of a series" line, which composes
 * the same summary into a different parent sentence.
 */
const RECURRENCE_CADENCE_KEYS: Record<RecurrenceCadence, StaffMessageKey> = {
  daily: "trips.series.cadenceDaily",
  weekly: "trips.series.cadenceWeekly",
  everyNWeeks: "trips.series.cadenceEveryNWeeks",
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
      ? t("trips.series.cadenceUnset")
      : summary.cadence === "daily"
        ? t(RECURRENCE_CADENCE_KEYS.daily)
        : summary.cadence === "weekly"
          ? t(RECURRENCE_CADENCE_KEYS.weekly, { days })
          : t(RECURRENCE_CADENCE_KEYS.everyNWeeks, { weeks: summary.intervalWeeks, days });
  return summary.endsOn
    ? t("trips.series.summaryUntil", {
        cadence,
        date: formatCalendarDate(summary.endsOn, locale),
      })
    : t("trips.series.summaryOpenEnded", { cadence });
}

/**
 * Series-wide controls for a materialized recurring trip: apply this date's
 * template to the rest of the run, stop (or restart) the repeat, or cancel
 * every upcoming date at once. Each instance stays fully independent — these
 * are conveniences over the per-date tooling, never a live link that rewrites
 * siblings behind staff's back (20260719-recurring-trip-series).
 *
 * There is no "add more dates" control any more, and its absence is the
 * feature: an open-ended series keeps its own next few months on the board
 * (ADR 20260810-open-ended-recurring-trips), so the only honest questions left
 * are whether it should keep going and whether the dates already on the board
 * should stand.
 */
export function SeriesSection({
  intervalWeeks,
  weekdays,
  endsOn,
  futureScheduledCount,
  horizonDays,
  status,
  applyAction,
  cancelAction,
  repeatAction,
  locale,
}: {
  intervalWeeks: number;
  weekdays: WeekdaySet;
  /** The series' last date, or null when it simply keeps going. */
  endsOn: CalendarDate | null;
  futureScheduledCount: number;
  /** How far ahead the board is kept full, for the "keeps going" explanation. */
  horizonDays: number;
  /**
   * What the last series action did — apply, repeat, or cancel. One status for
   * the three of them: they share a section and only one can have just run.
   */
  status?: FormNotice;
  applyAction: () => void;
  cancelAction: () => void;
  repeatAction: (formData: FormData) => void;
  locale: string;
}) {
  const t = staffTranslator(locale);
  const hasFuture = futureScheduledCount > 0;
  const hasOtherFuture = futureScheduledCount > 1;
  const repeating = endsOn === null;
  const summary = recurrenceSummaryText(
    t,
    locale,
    recurrenceSummary({ intervalWeeks, weekdays, endsOn }),
  );
  return (
    <section className="mt-12 rounded-xl border border-border bg-surface p-5">
      <h2 className="text-base font-semibold">{t("trips.series.heading")}</h2>
      <p className="mt-1 text-sm text-muted">
        {hasFuture
          ? t("trips.series.summaryWithFuture", { summary, count: futureScheduledCount })
          : t("trips.series.summaryAllDone", { summary })}
      </p>

      <FormStatus tone={status?.tone} className="mt-2">
        {status?.text}
      </FormStatus>

      <div className="mt-4 flex flex-col gap-4">
        {hasOtherFuture ? (
          <form action={applyAction} className="flex flex-col gap-1.5">
            <SubmitButton
              pendingLabel={t("trips.series.applying")}
              className={buttonClass({ variant: "secondary" })}
            >
              {t("trips.series.applyToSeries")}
            </SubmitButton>
            <p className="text-sm text-muted">{t("trips.series.applyDescription")}</p>
          </form>
        ) : null}

        {/* One switch, two directions — a series that was stopped (or arrived
            finite from before this feature existed) can be turned back on, so
            "stop repeating" is never a door that only shuts. */}
        <form action={repeatAction} className="flex flex-col gap-1.5">
          <input type="hidden" name="keepRepeating" value={repeating ? "no" : "yes"} />
          <SubmitButton
            pendingLabel={t("trips.series.saving")}
            className={buttonClass({ variant: "secondary" })}
          >
            {repeating ? t("trips.series.stopRepeating") : t("trips.series.startRepeating")}
          </SubmitButton>
          <p className="text-sm text-muted">
            {repeating
              ? t("trips.series.stopRepeatingDescription")
              : t("trips.series.startRepeatingDescription", { days: horizonDays })}
          </p>
        </form>

        {hasFuture ? (
          <form action={cancelAction} className="flex flex-col gap-1.5">
            <SubmitButton
              pendingLabel={t("trips.series.cancelling")}
              className={buttonClass({ variant: "danger" })}
            >
              {t("trips.series.cancelAllUpcoming")}
            </SubmitButton>
            <p className="text-sm text-muted">
              {t("trips.series.cancelDescription", { count: futureScheduledCount })}
            </p>
          </form>
        ) : null}
      </div>
    </section>
  );
}
