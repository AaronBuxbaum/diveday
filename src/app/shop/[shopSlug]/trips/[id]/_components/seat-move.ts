import { listSeatMoveTargets } from "@/db/bookings";
import type { AppDb } from "@/db/client";
import { calendarDateInTimezone } from "@/lib/calendar-date";
import { formatDateWithYear, formatTimeTz } from "@/lib/format";
import { hasSailed } from "@/lib/trips";
import { moveSeatAction } from "../roster-seating-actions";
import type { SeatMove } from "./roster-model";

/**
 * The roster's "Move to another departure" (ADR 20261013-staff-move-a-seat):
 * the departures a seat here may move to, each worded with its date and zone,
 * and the action bound to this departure. Undefined when there is nowhere to
 * go. Once the departure has left it says so (`departed`); a seat the desk
 * turned away moves only until the scheduled start (`started`, `seatMoveForRow`).
 */
export async function seatMoveFor(input: {
  db: AppDb;
  shopId: string;
  shopSlug: string;
  tripId: string;
  startsAt: Date;
  timeZone: string;
  locale: string;
  now: Date;
}): Promise<SeatMove | undefined> {
  const targets = await listSeatMoveTargets(input.db, input.shopId, input.tripId, input.now);
  if (targets.length === 0) return undefined;
  return {
    action: moveSeatAction.bind(null, input.shopSlug, input.tripId),
    departed: hasSailed(input.startsAt, input.now),
    started: input.now.getTime() >= input.startsAt.getTime(),
    targets: wordSeatMoveTargets(targets, input.locale, input.timeZone),
  };
}

/** Date grouping uses actual instants in the shop zone, never a localized option label. */
export function wordSeatMoveTargets(
  targets: readonly { id: string; title: string; startsAt: Date; seatsLeft: number }[],
  locale: string,
  timeZone: string,
): SeatMove["targets"] {
  return [...targets]
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
    .map((target) => ({
      id: target.id,
      label: target.title,
      startsAt: target.startsAt.toISOString(),
      localDay: calendarDateInTimezone(target.startsAt, timeZone),
      dayLabel: formatDateWithYear(target.startsAt, locale, timeZone),
      timeLabel: formatTimeTz(target.startsAt, locale, timeZone),
      seatsLeft: target.seatsLeft,
    }));
}
