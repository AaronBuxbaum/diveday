import { tankFillOptions } from "@/i18n/gear-labels";
import type { StaffTranslator } from "@/i18n/staff-messages";
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
