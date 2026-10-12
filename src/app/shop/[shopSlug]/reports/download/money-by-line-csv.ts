import type { MonthMoneyDetail } from "@/db/report-lines";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { buildCsv } from "@/lib/export";
import { BY_LINE_KEYS } from "../_components/MonthMoneyDetail";

/**
 * The "Money in, by line" block of the month's CSV: the rows the page shows,
 * in its words, from the one query that feeds both (issue #2305), so the
 * screen and the file cannot disagree.
 */
export function moneyByLineCsv(
  lines: MonthMoneyDetail["lines"],
  t: StaffTranslator,
  money: (cents: number) => string,
): string {
  return buildCsv(
    [t("reports.byLine.heading"), "This month"],
    lines.map(({ line, cents }) => [t(BY_LINE_KEYS[line]), money(cents)]),
  );
}
