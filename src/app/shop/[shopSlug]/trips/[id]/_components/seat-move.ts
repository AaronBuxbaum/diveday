import { listSeatMoveTargets } from "@/db/bookings";
import type { AppDb } from "@/db/client";
import { formatDateTimeTz } from "@/lib/format";
import { hasSailed } from "@/lib/trips";
import { moveSeatAction } from "../actions";
import type { SeatMove } from "./roster-model";

/**
 * The roster's "Move to another departure" (ADR 20261013-staff-move-a-seat):
 * the departures a seat here may move to, each worded with its date and zone,
 * and the action bound to this departure. Undefined once the departure has
 * left or when there is nowhere to go, and then no row offers the move.
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
  if (hasSailed(input.startsAt, input.now)) return undefined;
  const targets = await listSeatMoveTargets(input.db, input.shopId, input.tripId, input.now);
  if (targets.length === 0) return undefined;
  return {
    action: moveSeatAction.bind(null, input.shopSlug, input.tripId),
    targets: targets.map((target) => ({
      id: target.id,
      label: `${target.title} · ${formatDateTimeTz(target.startsAt, input.locale, input.timeZone)}`,
    })),
  };
}
