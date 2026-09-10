import { SegmentedControl } from "@/components/ui/SegmentedControl";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { shopPath } from "@/lib/staff-notices";

/**
 * **The only new control on Reports** (ADR 20260908-one-hand, decision 6,
 * lever T): this month, or this year. Two views of one route, so it wears the
 * app's one segmented control with `aria-current="true"` and the current
 * choice still a link — the same grammar the departure's tabs and the Today
 * queue's view switch already speak.
 *
 * The year is `?range=year` and the month is the bare page, so a bookmark, a
 * back button and a shared link all keep working exactly as they did.
 */
export function ReportRangeTabs({
  shopSlug,
  range,
  t,
  className,
}: {
  shopSlug: string;
  range: "month" | "year";
  t: StaffTranslator;
  className?: string;
}) {
  const reports = shopPath(shopSlug, "reports");
  return (
    <SegmentedControl
      ariaLabel={t("reports.year.rangeLabel")}
      currentKey={range}
      currentIsLink
      ariaCurrentValue="true"
      scroll={false}
      className={className}
      items={[
        { key: "month", label: t("reports.year.thisMonth"), href: reports },
        { key: "year", label: t("reports.year.thisYear"), href: `${reports}?range=year` },
      ]}
    />
  );
}
