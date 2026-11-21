import type { getOrdersIndex } from "@/features/money/orders-index";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { calendarDateInTimezone, calendarDateToUtcMidnight } from "@/lib/calendar-date";
import { nowDate } from "@/lib/clock";
import { formatMoneyCents, formatShortDate } from "@/lib/format";
import { orderLedgerRow } from "../_components/ledger-row";
import type { OrderLedgerDay } from "../_components/OrdersLedger";

export function orderLedgerDays(
  groups: Awaited<ReturnType<typeof getOrdersIndex>>["ledger"]["groups"],
  {
    timezone,
    locale,
    t,
    shopSlug,
  }: { timezone: string; locale: string; t: StaffTranslator; shopSlug: string },
): OrderLedgerDay[] {
  const today = calendarDateInTimezone(nowDate(), timezone);
  return groups.map((group) => {
    // Format date-only ledger headers at UTC midnight in UTC to avoid shifting
    // them to the prior day in the shop's timezone.
    const date = formatShortDate(calendarDateToUtcMidnight(group.day), locale, "UTC");
    const named = group.day === today ? t("orders.index.ledger.today", { date }) : date;
    return {
      key: group.day,
      // Mark a day continued across pages; its subtotal still covers the whole day.
      label: group.continued ? t("orders.index.ledger.continued", { day: named }) : named,
      meta: t("orders.index.ledger.dayMeta", {
        count: group.count,
        // Preserve each order's stored currency if a day spans a shop currency change.
        subtotal: group.subtotals
          .map((entry) => formatMoneyCents(entry.cents, entry.currency, locale))
          .join(" · "),
      }),
      rows: group.orders.map((row) => orderLedgerRow(row, { t, locale, shopSlug })),
    };
  });
}
