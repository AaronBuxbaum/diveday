import { FormStatus } from "@/components/ui/form";
import type { StaffTranslator } from "@/i18n/staff-messages";
import type { CounterRentalWindowRefusal } from "@/lib/counter-rentals";
export function rentalWindowStatus(
  t: StaffTranslator,
  windowRefusal: CounterRentalWindowRefusal | null,
  days: number,
) {
  return windowRefusal ? (
    <FormStatus tone="danger">
      {t(
        windowRefusal === "starts_in_past"
          ? "counterRentals.new.notice.startsInPast"
          : windowRefusal === "window_too_long"
            ? "counterRentals.new.notice.windowTooLong"
            : "counterRentals.new.notice.invalidWindow",
      )}
    </FormStatus>
  ) : (
    <span className="text-muted">{t("counterRentals.new.days", { count: days })}</span>
  );
}
