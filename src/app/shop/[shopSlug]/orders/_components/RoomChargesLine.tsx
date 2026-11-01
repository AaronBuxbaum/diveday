import type { RoomChargeTotal } from "@/db/room-charges";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { formatMoneyCents, joinFacts } from "@/lib/format";

/** Monthly room-charge totals by hotel; renders nothing when there are no charges (fifth-loop ideas, item 57). */
export function RoomChargesLine({
  totals,
  month,
  locale,
  t,
}: {
  totals: RoomChargeTotal[];
  month: string;
  locale: string;
  t: StaffTranslator;
}) {
  if (totals.length === 0) return null;
  const lines = totals.map((total) => {
    const amount = formatMoneyCents(total.totalCents, total.currency, locale);
    return total.hotel
      ? t("orders.index.roomCharges.hotel", { hotel: total.hotel, amount, count: total.orders })
      : t("orders.index.roomCharges.unnamed", { amount, count: total.orders });
  });
  return (
    <p className="mb-6 text-sm text-muted tabular-nums" data-testid="room-charges">
      {t("orders.index.roomCharges.line", { month, lines: joinFacts(lines) })}
    </p>
  );
}
