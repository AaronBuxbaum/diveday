/**
 * A seat on a departure, written straight to the row.
 *
 * `createBooking` is the door a *diver* comes through and enforces this shop's
 * readiness requirements on the way; every test here needs only the fact that
 * somebody is aboard, because that is the whole input the supervision target
 * takes ("a departure with nobody booked is never short",
 * src/lib/divemaster-ratio.ts).
 */
import type { AppDb } from "../../db/client";
import { bookings, people } from "../../db/schema/index";

export async function seatDiver(
  db: AppDb,
  shopId: string,
  tripId: string,
  tag: string,
): Promise<void> {
  const [diver] = await db
    .insert(people)
    .values({ shopId, fullName: `Aboard ${tag}`, email: `staffing-aboard-${tag}@example.com` })
    .returning();
  if (!diver) throw new Error("failed to insert diver");
  await db.insert(bookings).values({ bookedAs: "diver", shopId, tripId, personId: diver.id });
}
