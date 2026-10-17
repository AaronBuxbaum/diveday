import { listSeatMoveTargets } from "@/db/bookings";
import type { AppDb } from "@/db/client";
import { formatDateTimeTz } from "@/lib/format";
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
    targets: targets.map((target) => ({
      id: target.id,
      label: `${target.title} · ${formatDateTimeTz(target.startsAt, input.locale, input.timeZone)}`,
      seatsLeft: target.seatsLeft,
    })),
  };
}
