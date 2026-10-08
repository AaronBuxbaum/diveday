import type { CustomerGearItem } from "@/db/schema";
import type { StaffMessageKey, StaffTranslator } from "@/i18n/staff-messages";
import { formatCalendarDate } from "@/lib/calendar-date";
import { type CustomerDueField, customerDueFields } from "@/lib/work-orders";

const DUE_KEYS: Record<CustomerDueField, StaffMessageKey> = {
  serviceDueOn: "workOrders.detail.serviceDue",
  inspectionDueOn: "workOrders.detail.inspectionDue",
  hydroDueOn: "workOrders.detail.hydroDue",
};

/**
 * A customer piece's due dates, each labelled by what is due: a cylinder's
 * visual inspection and hydro test, or everything else's one service. Only the
 * dates its kind has, and only the ones set.
 */
export function pieceDueLine(
  piece: Pick<CustomerGearItem, "kind" | "serviceDueOn" | "inspectionDueOn" | "hydroDueOn">,
  locale: string,
  t: StaffTranslator,
): string[] {
  return customerDueFields(piece.kind).flatMap((field) => {
    const date = piece[field];
    return date ? [t(DUE_KEYS[field], { date: formatCalendarDate(date, locale) })] : [];
  });
}
