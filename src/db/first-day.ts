import { MIN_TRIP_DAYS } from "@/lib/trip-days";
import { type TripDetailsShop, tripDetailsPatch } from "@/lib/trip-details";
import { FIRST_BOAT_CAPACITY, firstDepartureDay, firstDepartureEndTime } from "@/lib/try-it";
import { createBoat } from "./boats";
import type { AppDb } from "./client";
import { createTrip } from "./trips";

/**
 * **The first day a new shop opens onto** — the boat and the one departure a
 * visitor typed into DiveDay's homepage hero, written once, when they open the
 * door (ADR 20260908-one-hand, decision 6, possibility Y).
 *
 * The homepage draws that day from client state and stores nothing; this is the
 * only thing in the tree that turns it into rows, and it runs after the shop,
 * the owner and the account exist.
 *
 * **It creates the departure through the schedule's own door.** `createTrip`
 * (`@/db/trips`) is what the schedule builder calls, and `tripDetailsPatch` is
 * the same validator that builder's action runs — the boat's capacity ceiling,
 * the wall-clock-to-instant conversion in the shop's zone, the end-before-start
 * refusal. A second, softer create path here would produce a departure the rest
 * of the app has never seen the shape of.
 *
 * **Nothing it does is required for a signup to succeed.** The caller treats a
 * null as "no first departure", never as a failed sign-up: an owner with a shop
 * and no boat can add one in the builder in fifteen seconds, and an owner with
 * no shop has nowhere to do it.
 */
export type FirstDay = {
  boatId: string;
  tripId: string;
};

export type FirstDayShop = TripDetailsShop & { id: string };

export async function createFirstDay(
  db: AppDb,
  shop: FirstDayShop,
  input: {
    /** The hull's name, exactly as the visitor typed it. */
    boatName: string;
    /** `HH:MM` in the shop's own zone. */
    departure: string;
    /** The instant "tomorrow" is counted from — the caller's clock. */
    now: Date;
  },
): Promise<FirstDay | null> {
  const endTime = firstDepartureEndTime(input.departure);
  if (!endTime) return null;

  const boat = await createBoat(db, shop.id, input.boatName, FIRST_BOAT_CAPACITY);

  const details = tripDetailsPatch(
    {
      date: firstDepartureDay(input.now, shop.timezone),
      startTime: input.departure,
      endTime,
      dayCount: MIN_TRIP_DAYS,
      diveMode: "boat",
      boatId: boat.id,
      capacity: FIRST_BOAT_CAPACITY,
      boatCapacity: FIRST_BOAT_CAPACITY,
    },
    shop,
  );
  // The boat stays either way. It is the half the shop typed and would have to
  // retype, and a hull with no departure on it is a normal state of the
  // register; a departure with no hull is not.
  if (!details.ok) return null;

  const trip = await createTrip(db, {
    shopId: shop.id,
    // **The boat's name is the departure's title**, because it is the only word
    // for this day that anyone has actually written. A DiveDay-authored title
    // ("First departure", "Morning dive") would be English filler in a Spanish
    // shop's schedule and a claim about a day nobody has planned yet — the same
    // reason a dive site's briefing is never seeded with words the shop did not
    // write (ADR 20260813-dive-site-briefings-are-the-shops-own-words).
    title: input.boatName,
    startsAt: details.patch.startsAt,
    endsAt: details.patch.endsAt,
    scheduleDays: details.patch.scheduleDays,
    capacity: FIRST_BOAT_CAPACITY,
    // **The validator's answer, not the one asked for.** `tripDetailsPatch`
    // narrows the mode against the shop's own offered kinds of diving, so a
    // shop that does not run boats gets whatever it does run rather than a
    // departure claiming a hull it does not use. Repeating the literals here
    // would put a second answer beside the one the schedule board trusts.
    diveMode: details.patch.diveMode ?? "boat",
    boatId: details.patch.boatId ?? null,
  });
  if (!trip) return null;

  return { boatId: boat.id, tripId: trip.id };
}
