import { and, eq, ne, sql } from "drizzle-orm";
import { isPlausibleDateOfBirth } from "@/lib/age";
import { isValidCalendarDate } from "@/lib/calendar-date";
import { BLOCKER_CATEGORY } from "@/lib/readiness";
import type { AppDb } from "./client";
import { getBookingReadiness } from "./readiness";
import { bookings, people } from "./schema";
import { type SeatDiverRefusal, type SeatDiverWaiver, seatDiver } from "./seat-diver";
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
 * certificate's passenger limit (H-20261009-certificate-caps-seats, `sellableCapacity`).
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
 *
 * Both are read **outside** the booking transaction, before it opens: a stage
 * recorded, or a namesake seated, in the instant between the read and the
 * seat is not caught here. The limits that matter for safety (capacity, the
 * certificate, a sailed or canceled departure) are all read inside it, under
 * the trip-row lock; these two are a convenience for the crew, not a gate.
 *
 * **A seat is not boarding.** The rider still owes whatever the departure asks
 * of everybody aboard — the release and its medical statement, and payment
 * where the shop takes it before boarding and names no rider price — and the
 * roll call refuses Boarded until readiness clears them, exactly as for a seat
 * sold at the desk. What they still owe comes back as `owes`, with the release
 * link to open on the crew's phone (`waiverPath`), so the door can say so.
 *
 * The emergency contact and an optional date of birth are written onto the
 * new person row inside the booking's own transaction (`freshPerson`), so a
 * minor shows as one on the manifest at once.
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
  /** `YYYY-MM-DD`; absent when the crew did not ask. */
  dateOfBirth?: string;
  /** Riding along, or snorkeling. Never a diver: a diver goes through the desk. */
  participantType?: "rider" | "snorkeler";
};

export type DockRiderRefusal = SeatDiverRefusal | "departed" | "already_aboard" | "invalid";

/** What the rider still owes before the rail will take them. */
export type DockRiderOwes = "release" | "payment" | "other";

export type DockRiderResult =
  | {
      ok: true;
      bookingId: string;
      personId: string;
      waiver: SeatDiverWaiver;
      waiverPath?: string;
      owes: DockRiderOwes[];
    }
  | { ok: false; reason: DockRiderRefusal };

export async function addDockRider(db: AppDb, input: DockRiderInput): Promise<DockRiderResult> {
  const fullName = input.fullName.trim();
  const dateOfBirth = input.dateOfBirth?.trim() || undefined;
  if (dateOfBirth && !(isValidCalendarDate(dateOfBirth) && isPlausibleDateOfBirth(dateOfBirth))) {
    return { ok: false, reason: "invalid" };
  }

  const stage = await latestTripStage(db, input.shopId, input.tripId);
  if (stage && stage.stage !== "boarding") return { ok: false, reason: "departed" };

  const [namesake] = await db
    .select({ id: bookings.id })
    .from(bookings)
    .innerJoin(people, and(eq(people.id, bookings.personId), eq(people.shopId, input.shopId)))
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
    // emergency contact and date of birth below can never land on somebody
    // else's record.
    diver: {
      fullName,
      phone: input.phone?.trim() || undefined,
      freshPerson: {
        emergencyContactName: input.emergencyContactName.trim(),
        emergencyContactPhone: input.emergencyContactPhone.trim(),
        dateOfBirth,
      },
    },
    entry: "dock",
    refusals: "specific",
    participantType: input.participantType ?? "rider",
  });
  if (!seated.ok) return { ok: false, reason: seated.reason };

  const readiness = await getBookingReadiness(db, input.shopId, seated.bookingId);
  const owes = new Set<DockRiderOwes>();
  for (const blocker of readiness?.blockers ?? []) {
    const category = BLOCKER_CATEGORY[blocker.code];
    owes.add(category === "waiver" ? "release" : category === "payment" ? "payment" : "other");
  }

  return {
    ok: true,
    bookingId: seated.bookingId,
    personId: seated.personId,
    waiver: seated.waiver,
    waiverPath: seated.waiverPath,
    owes: (["release", "payment", "other"] as const).filter((kind) => owes.has(kind)),
  };
}
