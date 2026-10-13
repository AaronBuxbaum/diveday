import type { AppDb } from "@/db/client";
import { departureRollCallForBooking } from "@/db/manifests";
import { departureAfterLateBoarding, getRecapPageState, type RecapPageState } from "@/db/recap";
import { isAfterTheDive, theBoatIsHome } from "@/lib/thread-steps";

/**
 * **Whether `/ready` turns to the afterglow, and the recap it would show**
 * (ADR 20260827-the-divers-thread, decision 4).
 *
 * The crew's departure roll call decides whose day is over wherever a shop
 * kept one, and the four-hour recap floor where none exists
 * (`isAfterTheDive`). Neither is read until the boat is scheduled home, so a
 * night-before load never pays for them.
 *
 * **The recap is read beside the roll call, not after it** (code review
 * 2026-10-13, item 29): past the recap floor it is the likely answer, and a
 * read-only one, so it starts with the roll call and is awaited only if the
 * page does turn. Before the floor it is read only once the roll call says
 * the diver boarded. A held identity never reads it at all: its card is decided
 * before the recap is (issue #2125).
 */
export async function readAfterTheDive(
  db: AppDb,
  input: { shopId: string; tripId: string; endsAt: Date; bookingId: string; identityHeld: boolean },
): Promise<{ afterTheDive: boolean; recap: () => Promise<RecapPageState> }> {
  const { shopId, tripId, endsAt, bookingId } = input;
  const boatIsHome = theBoatIsHome({ endsAt });
  // Started early only past the recap floor, where the afterglow is the answer
  // unless the crew left the diver at the dock. Between the boat coming home
  // and that floor, a shop that keeps no roll call stays on the thread, so the
  // recap waits for the roll call's "boarded" instead of being read and
  // thrown away on every load of that window.
  const speculate = boatIsHome && !input.identityHeld && isAfterTheDive({ endsAt });
  const recapRead = speculate ? getRecapPageState(db, bookingId) : null;
  // Settled here so a page that stays on the thread never leaves it unhandled.
  recapRead?.catch(() => null);
  const departure = boatIsHome
    ? await departureRollCallForBooking(db, shopId, tripId, bookingId)
    : null;
  const boarded = await departureAfterLateBoarding(db, departure, {
    booking: { id: bookingId },
    shop: { id: shopId },
    trip: { id: tripId },
  });
  return {
    afterTheDive: isAfterTheDive({ endsAt, boarded }),
    recap: () => recapRead ?? getRecapPageState(db, bookingId),
  };
}
