import { type CalendarDate, formatCalendarDate } from "@/lib/calendar-date";
import { weekdayNames } from "@/lib/format";
import { cachedListFormat } from "@/lib/intl-cache";
import {
  type RecurrenceCadence,
  type RecurrenceSummary,
  recurrenceSummary,
  type WeekdaySet,
} from "@/lib/recurrence";
import type { StaffMessageKey, StaffTranslator } from "./staff-messages";

/**
 * **A run's words**: the cadence sentence, and the one line Edit trip's
 * Repeats card and the series page under Schedule both say about a run.
 */

/** The run's hull in the yard: its window and the weeks it touches (#3988, #4010). */
export type SeriesYardLine = {
  boat: string;
  from: CalendarDate;
  until: CalendarDate;
  leftOff: CalendarDate[];
  onBoard: CalendarDate[];
};

/**
 * `recurrenceSummary` returns codes, not prose (src/lib/recurrence.ts) — this
 * map is where the cadence half of it becomes a word in the staff bundle.
 * Shared by the run's one line (`repeatsRowText`) and the series page.
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

/**
 * The run's one line: the cadence, and how much of the run is still on
 * the board — a fact the cadence sentence alone does not carry, and the one the
 * "cancel every upcoming date" confirm is counting. It rides on the row rather
 * than on the collapsed strip, which is one truncating line and has the
 * cadence to fit first.
 */
export function repeatsRowText(
  t: StaffTranslator,
  locale: string,
  series: {
    intervalWeeks: number;
    weekdayMask: WeekdaySet;
    endsOn: CalendarDate | null;
    futureScheduledCount: number;
    /** Who crews every date, by name; empty when the run has no standing crew. */
    standingCrewNames: string[];
    /** The run's hull in the yard: its window's last day, and the weeks it touches (#3988, #4010). */
    yardLine: SeriesYardLine | null;
  } | null,
): string {
  if (!series) return t("trips.about.oneTime");
  const summary = recurrenceSummaryText(
    t,
    locale,
    recurrenceSummary({
      intervalWeeks: series.intervalWeeks,
      weekdays: series.weekdayMask,
      endsOn: series.endsOn,
    }),
  );
  const counted =
    series.futureScheduledCount > 0
      ? t("tripSeries.panel.summaryWithFuture", { summary, count: series.futureScheduledCount })
      : t("tripSeries.panel.summaryAllDone", { summary });
  // The run's standing crew, so a staffer sees it before hand-assigning a date
  // the next apply would overwrite.
  const crewLine =
    series.standingCrewNames.length === 0
      ? ""
      : t("tripSeries.panel.standingCrewLine", {
          names: cachedListFormat(locale, { type: "conjunction" }).format(series.standingCrewNames),
          count: series.standingCrewNames.length,
        });
  return [counted, crewLine, yardLineText(t, locale, series.yardLine)].filter(Boolean).join(" ");
}

/** The most yard dates the row names before the rest are counted. */
const YARD_DATES_SHOWN = 3;

/**
 * **The run's hull in the yard** (issues #3988, #4010): which hull and until
 * when, the weeks the nightly roll left off for it, and the weeks still on the
 * board inside the window, which sail into the yard unless the desk moves
 * them. The hull is the run's own (the one the roll copies forward), named so
 * a page whose departure sails on another boat is not read as about that one.
 * Read from the board and the window as they stand: nothing is stored, so the
 * line goes when the window moves. Empty when there is no line.
 */
function yardLineText(t: StaffTranslator, locale: string, line: SeriesYardLine | null): string {
  if (!line) return "";
  const dates = (list: readonly CalendarDate[]) => {
    const named = list.slice(0, YARD_DATES_SHOWN).map((date) => formatCalendarDate(date, locale));
    const rest = list.length - named.length;
    if (rest > 0) named.push(t("tripSeries.panel.yardLeftOffMore", { count: rest }));
    return cachedListFormat(locale, { type: "conjunction" }).format(named);
  };
  return [
    t("tripSeries.panel.yardThrough", {
      boat: line.boat,
      from: formatCalendarDate(line.from, locale),
      until: formatCalendarDate(line.until, locale),
    }),
    line.leftOff.length > 0
      ? t("tripSeries.panel.yardLeftOff", { dates: dates(line.leftOff) })
      : "",
    line.onBoard.length > 0
      ? t("tripSeries.panel.yardStillOn", { dates: dates(line.onBoard) })
      : "",
  ]
    .filter(Boolean)
    .join(" ");
}
