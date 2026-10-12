import { and, eq, ne, sql } from "drizzle-orm";
import type { AppDb } from "./client";
import { publishManifestEvent } from "./manifest-events";
import { bookings, people } from "./schema";
import { type SeatDiverRefusal, seatDiver } from "./seat-diver";
import { latestTripStage } from "./trip-stages";

/**
 * **A rider the crew adds at the boat** (batch 4, D6).
 *
 * Somebody turns up at the dock who is not on the manifest — a partner who
 * came to ride along, a friend who stays on the boat. The crew adds them from
 * the Boat tab with a name, an emergency contact and, if they have one, a
 * phone, and they count in the head count and the roll call at once.
 *
 * **Riders only, and through the one seating path.** A diver who walks on
 * goes through the desk, where the certification checks are; this function
 * cannot seat one, because it never passes anything but `rider`. The seat is
 * made by `seatDiver` → `createBooking`, so everything that refuses a seat
 * anywhere refuses it here: a cancelled or deleted departure, a boat that has
 * sailed, a held departure, a course session (no non-divers on a course), and
 * both limits read under the trip-row lock — the hull's own capacity and the
 * certificate's passenger limit (H-107, `sellableCapacity`).
 *
 * Two refusals are this door's own, both read before the seat is made:
 *
 * - `departed`: the crew has already told DiveDay the boat left the dock (any
 *   stage past `boarding`). `createBooking` only knows the clock, and a boat
 *   that left early is exactly the case it cannot see.
 * - `already_aboard`: somebody by that name already holds a live seat on this
 *   departure — a second tap, or a person the desk seated first. Matched on
 *   the name as typed, ignoring case and outer spaces; two genuinely
 *   different riders sharing a full name is rarer than a double tap, and the
 *   crew can still add one with a distinguishing name.
 */

export type DockRiderInput = {
  shopId: string;
  tripId: string;
  /** The crew member adding them — on the activity trail. */
  actorPersonId: string;
  fullName: string;
  phone?: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
};

export type DockRiderRefusal = SeatDiverRefusal | "departed" | "already_aboard";

export type DockRiderResult =
  | { ok: true; bookingId: string; personId: string }
  | { ok: false; reason: DockRiderRefusal };

export async function addDockRider(db: AppDb, input: DockRiderInput): Promise<DockRiderResult> {
  const fullName = input.fullName.trim();

  const stage = await latestTripStage(db, input.shopId, input.tripId);
  if (stage && stage.stage !== "boarding") return { ok: false, reason: "departed" };

  const [namesake] = await db
    .select({ id: bookings.id })
    .from(bookings)
    .innerJoin(people, eq(people.id, bookings.personId))
    .where(
      and(
        eq(bookings.shopId, input.shopId),
        eq(bookings.tripId, input.tripId),
        ne(bookings.status, "cancelled"),
        sql`lower(trim(${people.fullName})) = lower(${fullName})`,
      ),
    )
    .limit(1);
  if (namesake) return { ok: false, reason: "already_aboard" };

  const seated = await seatDiver(db, {
    shopId: input.shopId,
    tripId: input.tripId,
    actorPersonId: input.actorPersonId,
    // No email, ever: a rider added at the dock always gets a fresh person row
    // (`createBooking` matches an existing person by email only), so the
    // emergency contact written below can never land on somebody else's record.
    diver: { fullName, phone: input.phone?.trim() || undefined },
    entry: "dock",
    refusals: "specific",
    participantType: "rider",
  });
  if (!seated.ok) return { ok: false, reason: seated.reason };

  await db
    .update(people)
    .set({
      emergencyContactName: input.emergencyContactName.trim(),
      emergencyContactPhone: input.emergencyContactPhone.trim(),
    })
    .where(and(eq(people.id, seated.personId), eq(people.shopId, input.shopId)));
  // `seatDiver` already woke the manifests; once more so a phone that
  // refreshed in between picks up the emergency contact too.
  await publishManifestEvent(db, input.shopId, input.tripId);

  return { ok: true, bookingId: seated.bookingId, personId: seated.personId };
}
