import { fill, pluralForm } from "@/i18n/fill";
import type { StaffTranslator } from "@/i18n/staff-messages";
import type { RescheduleHoldCopy } from "./RescheduleHold";

type CountForms = { one: string; other: string };

/**
 * The line for one actual count: the plural form for `locale`, then `{count}`
 * filled in. A seat booked while the hold drains still counts, so any count the
 * send reports is spoken, not only those a prebuilt table reached.
 */
export function rescheduleCountLine(forms: CountForms, count: number, locale: string): string {
  return fill(pluralForm(count, forms, locale), { count });
}

/**
 * Words for `RescheduleHold`, resolved server-side for the seats the
 * hold was made for (the house pattern for a staff Client Component).
 * `placeOnly` is a notice about the meeting point alone (#2443). The count
 * lines travel as templates; the client fills the one count it needs.
 */
export function rescheduleHoldCopy(
  t: StaffTranslator,
  locale: string,
  placeOnly = false,
): RescheduleHoldCopy {
  return {
    locale,
    telling: t(placeOnly ? "shared.rescheduleHold.tellingPlace" : "shared.rescheduleHold.telling"),
    told: placeOnly
      ? {
          one: t.raw("shared.rescheduleHold.toldPlaceOne"),
          other: t.raw("shared.rescheduleHold.toldPlaceOther"),
        }
      : {
          one: t.raw("shared.rescheduleHold.toldOne"),
          other: t.raw("shared.rescheduleHold.toldOther"),
        },
    someMissed: {
      one: t.raw("shared.rescheduleHold.someMissedOne"),
      other: t.raw("shared.rescheduleHold.someMissedOther"),
    },
    notTold: t(placeOnly ? "shared.rescheduleHold.notToldPlace" : "shared.rescheduleHold.notTold"),
    tellThem: t("shared.rescheduleHold.tellThem"),
    undo: t("shared.sendHold.undo"),
  };
}
