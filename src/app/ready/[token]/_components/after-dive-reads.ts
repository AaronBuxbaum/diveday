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
 * 2026-10-13, item 29): once the boat is home it is the likely answer, and a
 * read-only one, so it starts with the roll call and is awaited only if the
 * page does turn. A held identity never reads it at all: its card is decided
 * before the recap is (issue #2125).
 */
export async function readAfterTheDive(
  db: AppDb,
  input: { shopId: string; tripId: string; endsAt: Date; bookingId: string; identityHeld: boolean },
): Promise<{ afterTheDive: boolean; recap: () => Promise<RecapPageState> }> {
  const { shopId, tripId, endsAt, bookingId } = input;
  const boatIsHome = theBoatIsHome({ endsAt });
  const recapRead = boatIsHome && !input.identityHeld ? getRecapPageState(db, bookingId) : null;
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
