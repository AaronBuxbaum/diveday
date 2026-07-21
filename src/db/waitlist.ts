import { and, count, eq, ne } from "drizzle-orm";
import type { AppDb } from "./client";
import { bookings, people, personRoles, trips, tripWaitlistEntries } from "./schema";

/**
 * Stamp a wait-list entry as invited, so the roster shows "Invited 2h ago" and
 * two staff don't both reach out. Shop-scoped, idempotent (a re-invite just
 * moves the timestamp forward). Stage 1 of seat recovery: the actual invite is
 * a one-tap email/composer in the UI; this records that it happened.
 *
 * Stage 2 (auto-invite position 1 on a cancellation, with an expiring window)
 * is deliberately not built here — it is blocked on the H-09 notification
 * policy decision. When that lands, it hangs off this same `invitedAt` column.
 */
export async function recordWaitlistInvite(
  db: AppDb,
  input: { shopId: string; entryId: string; now?: Date },
): Promise<boolean> {
  const [updated] = await db
    .update(tripWaitlistEntries)
    .set({ invitedAt: input.now ?? new Date() })
    .where(
      and(eq(tripWaitlistEntries.id, input.entryId), eq(tripWaitlistEntries.shopId, input.shopId)),
    )
    .returning({ id: tripWaitlistEntries.id });
  return Boolean(updated);
}

export type WaitlistRequest = {
  shopId: string;
  tripId: string;
  fullName: string;
  email: string;
  phone?: string;
};

export type WaitlistOutcome =
  | { ok: true; entryId: string; personName: string }
  | {
      ok: false;
      reason: "trip_unavailable" | "trip_available" | "already_booked" | "already_waitlisted";
      entryId?: string;
      personName?: string;
    };

/**
 * Adds a diver to a full trip's first-come wait list. A wait-list entry is not
 * a booking and must never reserve a manifest seat.
 */
export async function joinTripWaitlist(db: AppDb, req: WaitlistRequest): Promise<WaitlistOutcome> {
  const email = req.email.trim().toLowerCase();
  const fullName = req.fullName.trim();

  return db.transaction(async (tx): Promise<WaitlistOutcome> => {
    const [trip] = await tx
      .select()
      .from(trips)
      .where(and(eq(trips.id, req.tripId), eq(trips.shopId, req.shopId)))
      .limit(1);
    if (trip?.status !== "scheduled" || trip.startsAt <= new Date()) {
      return { ok: false, reason: "trip_unavailable" };
    }

    const [capacity] = await tx
      .select({ booked: count(bookings.id) })
      .from(bookings)
      .where(and(eq(bookings.tripId, trip.id), ne(bookings.status, "cancelled")));
    if ((capacity?.booked ?? 0) < trip.capacity) return { ok: false, reason: "trip_available" };

    let [person] = await tx
      .select()
      .from(people)
      .where(and(eq(people.shopId, req.shopId), eq(people.email, email)))
      .limit(1);
    if (!person) {
      [person] = await tx
        .insert(people)
        .values({ shopId: req.shopId, fullName, email, phone: req.phone })
        .returning();
      if (!person) throw new Error("joinTripWaitlist: person insert returned no row");
      await tx.insert(personRoles).values({ personId: person.id, role: "diver" });
    }

    const [booking] = await tx
      .select({ id: bookings.id })
      .from(bookings)
      .where(
        and(
          eq(bookings.tripId, trip.id),
          eq(bookings.personId, person.id),
          ne(bookings.status, "cancelled"),
        ),
      )
      .limit(1);
    if (booking) return { ok: false, reason: "already_booked" };

    const [existing] = await tx
      .select()
      .from(tripWaitlistEntries)
      .where(
        and(eq(tripWaitlistEntries.tripId, trip.id), eq(tripWaitlistEntries.personId, person.id)),
      )
      .limit(1);
    if (existing) {
      return {
        ok: false,
        reason: "already_waitlisted",
        entryId: existing.id,
        personName: person.fullName,
      };
    }

    const [entry] = await tx
      .insert(tripWaitlistEntries)
      .values({ shopId: req.shopId, tripId: trip.id, personId: person.id })
      .returning();
    if (!entry) throw new Error("joinTripWaitlist: entry insert returned no row");
    return { ok: true, entryId: entry.id, personName: person.fullName };
  });
}
