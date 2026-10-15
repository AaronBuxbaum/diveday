import type { DiverTranslator } from "@/i18n/messages";
import { weekdayNames } from "@/lib/format";
import { cachedListFormat } from "@/lib/intl-cache";
import { recurrenceSummary } from "@/lib/recurrence";

/**
 * "every Saturday", "every 2 weeks on Monday and Thursday", "every day": a
 * run's cadence in the reader's weekday names, as one phrase. The schedule's
 * horizon sentence (`seriesHorizonLines`) and a series departure's own header
 * line (fourth review, item 35) both say it, so they say it the same way.
 */
export function runCadenceWords(
  t: DiverTranslator,
  locale: string,
  run: { intervalWeeks: number; weekdayMask: number },
): string {
  const summary = recurrenceSummary({
    intervalWeeks: run.intervalWeeks,
    weekdays: run.weekdayMask,
  });
  const longWeekdays = weekdayNames(locale, "long");
  const days = cachedListFormat(locale, { type: "conjunction" }).format(
    summary.weekdays.map((day) => longWeekdays[day] ?? ""),
  );
  return summary.cadence === "daily"
    ? t("schedule.horizon.cadenceDaily")
    : summary.cadence === "weekly"
      ? t("schedule.horizon.cadenceWeekly", { days })
      : t("schedule.horizon.cadenceEveryNWeeks", { weeks: summary.intervalWeeks, days });
}
