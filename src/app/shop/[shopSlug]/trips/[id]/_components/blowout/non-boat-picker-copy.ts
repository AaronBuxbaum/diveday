import type { NonBoatOfferOption } from "@/db/blowout-alternatives";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { formatDateTimeTz } from "@/lib/format";
import type { NonBoatPickerCopy, NonBoatPickerOption } from "./NonBoatAlternativesPicker";

export function nonBoatPickerCopy(t: StaffTranslator): NonBoatPickerCopy {
  return {
    title: t("blowout.alternatives.title"),
    legend: t("blowout.alternatives.legend"),
    help: t("blowout.alternatives.help"),
    limit: t("blowout.alternatives.limit"),
  };
}
export function nonBoatPickerOptions(
  options: readonly NonBoatOfferOption[],
  locale: string,
  timezone: string,
  t: StaffTranslator,
): NonBoatPickerOption[] {
  return options.map((option) => ({
    id: option.id,
    title: option.title,
    when: formatDateTimeTz(option.startsAt, locale, timezone),
    kind: t(option.diveMode === "shore" ? "boats.shoreDivingLabel" : "boats.poolDivingLabel"),
  }));
}
