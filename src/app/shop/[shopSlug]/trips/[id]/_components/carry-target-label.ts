import type { StaffTranslator } from "@/i18n/staff-messages";
import type { SeatMove } from "./roster-model";

/**
 * One "Carry the wait list" option: the departure as the move names it, and
 * the seats it still sells (dive-domain review r4-4, N9). A full departure is
 * still offered, since interests may wait there, but reads as full.
 */
export function carryTargetLabel(target: SeatMove["targets"][number], t: StaffTranslator): string {
  return t("trips.guests.carryWaitlistTarget", {
    target: `${target.dayLabel} · ${target.timeLabel} · ${target.label}`,
    count: target.seatsLeft,
  });
}
