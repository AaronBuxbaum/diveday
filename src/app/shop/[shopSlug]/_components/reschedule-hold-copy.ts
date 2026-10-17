import type { StaffTranslator } from "@/i18n/staff-messages";
import type { RescheduleHoldCopy } from "./RescheduleHold";

/**
 * Words for `RescheduleHold`, resolved server-side for the seats the
 * hold was made for (the house pattern for a staff Client Component).
 * `placeOnly` is a notice about the meeting point alone (#2443).
 */
export function rescheduleHoldCopy(
  t: StaffTranslator,
  count: number,
  placeOnly = false,
): RescheduleHoldCopy {
  const told: Record<number, string> = {};
  const someMissed: Record<number, string> = {};
  // A few more than were held for: a seat booked during the hold still counts.
  for (let n = 1; n <= count + 5; n += 1) {
    told[n] = t(placeOnly ? "shared.rescheduleHold.toldPlace" : "shared.rescheduleHold.told", {
      count: n,
    });
    someMissed[n] = t("shared.rescheduleHold.someMissed", { count: n });
  }
  return {
    telling: t(placeOnly ? "shared.rescheduleHold.tellingPlace" : "shared.rescheduleHold.telling", {
      count,
    }),
    told,
    someMissed,
    notTold: t(placeOnly ? "shared.rescheduleHold.notToldPlace" : "shared.rescheduleHold.notTold"),
    tellThem: t("shared.rescheduleHold.tellThem"),
    undo: t("shared.sendHold.undo"),
  };
}
