import { tankFillOptions } from "@/i18n/gear-labels";
import type { StaffTranslator } from "@/i18n/staff-messages";
import type { O2CleanStanding } from "@/lib/gear";
import type { CartWords } from "./CounterRentalCart";
export function counterRentalCartWords(t: StaffTranslator, days: number): CartWords {
  return {
    gearHeading: t("counterRentals.new.gearHeading"),
    kindsAria: t("counterRentals.new.kindsAria"),
    filterLabel: t("counterRentals.new.filterLabel"),
    clearFilter: t("counterRentals.new.clearFilter"),
    noMatches: t("counterRentals.new.noMatches"),
    billHeading: t("counterRentals.new.pickedHeading"),
    billEmpty: t("counterRentals.new.billEmpty"),
    inSet: t("counterRentals.new.inSet"),
    setLabel: t("counterRentals.new.setPrice", { count: days }),
    total: t("counterRentals.new.total"),
    payHeading: t("counterRentals.new.pay.heading"),
    items: {
      one: t("counterRentals.new.itemsOne"),
      other: t("counterRentals.new.itemsOther"),
    },
    submit: t("counterRentals.new.submit"),
    submitting: t("counterRentals.new.submitting"),
    fillLabel: t("counterRentals.new.fillLabel"),
    fillOptions: tankFillOptions(t, t("counterRentals.new.fillChoose")),
    fillHint: t("counterRentals.new.fillHint"),
  };
}

/**
 * What a tank's row says once its gas is EANx (issue #2719): a lapsed O2
 * cleaning and one never recorded each with the next move; null when the
 * cleaning stands or the unit is not a tank. Read on the window's last day, as
 * the service clocks are.
 */
export function o2CleanWarning(
  t: StaffTranslator,
  label: string,
  standing: O2CleanStanding | null,
): string | null {
  if (standing === "lapsed") return t("counterRentals.new.o2CleanLapsed", { label });
  if (standing === "never") return t("counterRentals.new.o2CleanNever", { label });
  return null;
}
