import type { StaffTranslator } from "@/i18n/staff-messages";
import { formatMoneyCents } from "@/lib/format";
import {
  formatPercent,
  formatPercentChange,
  formatPointsChange,
  formatReportMoney,
  hasComparableBaseline,
  type MonthComparison,
  type MonthlyReport,
} from "@/lib/reporting";
import type { MonthFigure } from "./MonthFigures";

/**
 * **The month's five figures, and the baseline line under each** — moved out
 * of the page whole so the route stays thin. No new arithmetic: every number
 * here is the one the tile above it carried.
 *
 * The comparison line under each headline card — "{trend}vs {baseline} in
 * {month}", with the fallback labelled per issue #700's own acceptance
 * criteria. Built in JS from small already-translated fragments rather than
 * one large ICU template: the branching (percent vs. points vs. neither,
 * year-ago vs. previous-month) is a decision tree, not something ICU's own
 * conditionals read clearly.
 *
 * **By this date last year** (fifth loop, item 25): while the month is under
 * way, the page reads its year-ago baseline only to the same moment, and the
 * line names the day ("vs $5,920 in October 2025 by October 14"), so a half
 * month is never set against a whole one.
 */
export function monthFigureList({
  report,
  baselineReport,
  comparison,
  baselineMonthLabel,
  toDateDay,
  currency,
  locale,
  t,
}: {
  report: MonthlyReport;
  baselineReport: MonthlyReport | null;
  comparison: MonthComparison | null;
  baselineMonthLabel: string | null;
  /** "October 14" while the month is under way against last year; otherwise null. */
  toDateDay: string | null;
  currency: string;
  locale: string;
  t: StaffTranslator;
}): MonthFigure[] {
  // **No line against nothing** (UX audit 2026-10-07, item 21): "vs $0 in
  // October 2025" compares a month to one that had none of the thing, which
  // reads as a bug. A zero baseline drops its line; the figure stands alone.
  function comparisonLine(trend: string | null, baselineText: string): string | undefined {
    if (!comparison || !baselineMonthLabel) return undefined;
    const values = {
      trend: trend ? `${trend} ` : "",
      baseline: baselineText,
      month: baselineMonthLabel,
    };
    if (comparison.kind === "yearAgo" && toDateDay) {
      return t("reports.comparison.yearAgoToDate", { ...values, day: toDateDay });
    }
    return t(
      comparison.kind === "yearAgo"
        ? "reports.comparison.yearAgo"
        : "reports.comparison.previousMonthFallback",
      values,
    );
  }
  const moneyLine = (key: "revenueCents" | "tipsCents") =>
    comparison && hasComparableBaseline(comparison[key])
      ? comparisonLine(
          comparison[key].percentChange !== null
            ? formatPercentChange(comparison[key].percentChange)
            : null,
          formatReportMoney(baselineReport?.[key] ?? 0, currency, locale),
        )
      : undefined;
  const bookingsComparison =
    comparison && hasComparableBaseline(comparison.seatsBooked)
      ? comparisonLine(
          comparison.seatsBooked.percentChange !== null
            ? formatPercentChange(comparison.seatsBooked.percentChange)
            : null,
          String(comparison.seatsBooked.baseline),
        )
      : undefined;
  // Ratio cards need their own baseline to exist too, not merely a
  // comparison month with a report — a baseline month with zero seats
  // offered has nothing to measure fill against, and that absence must stay
  // absent rather than render as a manufactured "0%" (docs/design/principles.md).
  const ratioLine = (key: "fillRate" | "waiverCompletion") => {
    const ratio = comparison?.[key];
    return ratio && ratio.baseline !== null
      ? comparisonLine(
          ratio.pointsChange !== null ? formatPointsChange(ratio.pointsChange) : null,
          formatPercent(ratio.baseline),
        )
      : undefined;
  };

  // The five figures, in reading order: one number, one label, one optional
  // delta line each (visual review A06). What used to sit under a number (the
  // basis, the sailed split, the tip shares, the waiver count) is elsewhere:
  // the basis is the row's one caption (`monthFigureBasis`), the shares are
  // the crew sheet's, and each departure row names its own waivers to collect.
  //
  // The two percentages still render only over a denominator that exists
  // (`formatPercent` answers an em dash for a null ratio, which is what
  // `summarizeMonth` returns when a month offered no seat and took no booking).
  return [
    {
      key: "revenue",
      label: t("reports.metrics.revenueLabel"),
      value: formatReportMoney(report.revenueCents, currency, locale),
      comparison: moneyLine("revenueCents"),
    },
    {
      key: "tips",
      label: t("reports.metrics.tipsLabel"),
      value: formatMoneyCents(report.tipsCents, currency, locale),
      comparison: moneyLine("tipsCents"),
    },
    {
      key: "seats",
      label: t("reports.metrics.bookingsLabel"),
      value: String(report.seatsBooked),
      comparison: bookingsComparison,
    },
    {
      key: "fill",
      label: t("reports.metrics.seatFillLabel"),
      value: formatPercent(report.fillRate),
      comparison: ratioLine("fillRate"),
    },
    {
      key: "waivers",
      label: t("reports.metrics.waiversLabel"),
      value: formatPercent(report.waiverCompletion),
      comparison: ratioLine("waiverCompletion"),
    },
  ];
}

/**
 * **The basis caption, once under the tile row** (third review, item 1;
 * visual review A06): net revenue is anchored to the month's departures, and
 * "Money in, by line" below it to the day money was paid, so the two totals
 * differ and the row says which it is. The imported case names money inside
 * the figure Stripe has not confirmed, and the counter case money inside it
 * that no departure row carries.
 */
export function monthFigureBasis({
  report,
  currency,
  locale,
  t,
}: {
  report: MonthlyReport;
  currency: string;
  locale: string;
  t: StaffTranslator;
}): string {
  const counter =
    report.counterCents !== 0 ? formatReportMoney(report.counterCents, currency, locale) : null;
  const importedDetail =
    report.importedFinancialRecordCount > 0
      ? t("reports.metrics.revenueDetailWithImported", {
          count: report.importedFinancialRecordCount,
          payments: formatReportMoney(report.importedPaymentCents, currency, locale),
          refunds: formatReportMoney(report.importedRefundCents, currency, locale),
        })
      : null;
  if (importedDetail) {
    return counter
      ? `${importedDetail} ${t("reports.metrics.revenueCounter", { amount: counter })}`
      : importedDetail;
  }
  return counter
    ? t("reports.metrics.revenueBasisWithCounter", { amount: counter })
    : t("reports.metrics.revenueBasis");
}
