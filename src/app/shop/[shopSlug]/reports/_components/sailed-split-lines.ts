import type { StaffTranslator } from "@/i18n/staff-messages";
import type { SailedSplit } from "@/lib/report-split";
import { formatPercent } from "@/lib/reporting";

/**
 * The "Sailed … · Still to sail …" line under the Revenue, Seats and Fill
 * figures of the month under way (fourth UX review, item 22), worded once.
 * Null when there is no split to state.
 */
export function sailedSplitLines(
  t: StaffTranslator,
  split: SailedSplit | null,
  money: (cents: number) => string,
): { revenue: string; seats: string; fill: string } | null {
  if (!split) return null;
  const line = (sailed: string, toSail: string) => t("reports.metrics.split", { sailed, toSail });
  return {
    revenue: line(money(split.revenueCents.sailed), money(split.revenueCents.toSail)),
    seats: line(String(split.seats.sailed), String(split.seats.toSail)),
    fill: line(formatPercent(split.fill.sailed), formatPercent(split.fill.toSail)),
  };
}
