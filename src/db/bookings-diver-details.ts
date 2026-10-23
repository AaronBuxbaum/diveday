import { and, eq, inArray, ne } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import type { DiveIntent } from "@/lib/dive-intent";
import type { DiveRecencyBand } from "@/lib/dive-recency";
import { cleanDietaryNote } from "@/lib/lunch-aboard";
import type { ReEntryAsk } from "@/lib/re-entry";
import type { AppDb, DbExecutor } from "./client";
import { recordDeskEvent } from "./desk-events";
import { bookings, shops, trips } from "./schema";
import { liveTrip } from "./trips-live";

/**
 * **What this dive is for, changed from the diver's own `/ready` page** (ADR
 * 20260904-reef-all-the-way-down, D12).
 *
 * The same shape as `setBookingLastDived` below: scoped to the booking the
 * capability names, refuses a cancelled seat, and typed against the pgEnum so
 * nothing free-typed reaches the column. It is what makes the booking form's
 * "change it any time" a promise the product keeps.
 *
 * There is no path back to "not said" on purpose: an answer given is a thing
 * the crew read, and a diver who mis-tapped picks a different one rather than
 * erasing what the shop already saw.
 *
 * Returns false when no live booking matched, so the caller can say so rather
 * than reporting a save that never happened.
 */
export async function setBookingDiveIntent(
  db: AppDb,
  input: { shopId: string; bookingId: string; intent: DiveIntent },
): Promise<boolean> {
  const [updated] = await db
    .update(bookings)
    .set({ diveIntent: input.intent })
    .where(
      and(
        eq(bookings.id, input.bookingId),
        eq(bookings.shopId, input.shopId),
        ne(bookings.status, "cancelled"),
      ),
    )
    .returning({ id: bookings.id });
  return Boolean(updated);
}

/**
 * **What would help a diver easing back into it** (ADR
 * 20260904-reef-all-the-way-down, D18).
 *
 * The twin of {@link setBookingDiveIntent} and asked on the same page, one
 * question later: a diver who has said this dive is about getting comfortable
 * again is offered a word with the divemaster, an easy first dive, or the
 * shop's refresher course. It informs the crew and gates nothing — every one of
 * the three is something the shop chooses to do, not a condition on boarding.
 *
 * The offers were posted from the public booking form until 2026-09-06, from a
 * chip a stranger tapped before paying. They arrive from the diver's own
 * `/ready` link now, which is also the only door a party member or a walk-in
 * the counter seated ever had.
 *
 * Returns false when no live booking matched, so the caller can say so rather
 * than reporting a save that never happened.
 */
export async function setBookingReEntryAsk(
  db: AppDb,
  input: { shopId: string; bookingId: string; ask: ReEntryAsk },
): Promise<boolean> {
  const [updated] = await db
    .update(bookings)
    .set({ reEntryAsk: input.ask })
    .where(
      and(
        eq(bookings.id, input.bookingId),
        eq(bookings.shopId, input.shopId),
        ne(bookings.status, "cancelled"),
      ),
    )
    .returning({ id: bookings.id });
  return Boolean(updated);
}

/**
 * **The diver answered "Anything changed?" for this seat** (ADR
 * 20260904-reef-all-the-way-down, D15 with D19 folded in).
 *
 * Written from the diver's own `/ready` thread, by the primary "Nothing
 * changed" and by every one of the three change doors alike — acting on a fact
 * is answering the question, so a diver who corrects a wetsuit size never has
 * to then confirm that they corrected it.
 *
 * Idempotent by design and deliberately not guarded against re-answering: a
 * second tap is a diver tapping twice, not an error, and the stamp moving to
 * the later of the two is the honest record of when they last looked.
 *
 * Returns false when no live booking matched, so the caller can say so rather
 * than reporting a save that never happened.
 */
export async function confirmCarriedFacts(
  db: AppDb,
  input: { shopId: string; bookingId: string },
): Promise<boolean> {
  const [updated] = await db
    .update(bookings)
    .set({ carriedFactsConfirmedAt: nowDate() })
    .where(
      and(
        eq(bookings.id, input.bookingId),
        eq(bookings.shopId, input.shopId),
        ne(bookings.status, "cancelled"),
      ),
    )
    .returning({ id: bookings.id });
  return Boolean(updated);
}

/**
 * Record how recently the diver says they last dived (ADR
 * 20260821-currency-is-what-catches-people). Written from the diver's own
 * `/ready` page, so it is scoped to the booking the capability names and
 * refuses a cancelled seat — the same shape as `setBookingNitrox`.
 *
 * The band is typed against the pgEnum, so nothing free-typed reaches the
 * column and the callers cannot invent a sixth answer. There is no "clear it
 * back to not said" path on purpose: an answer given is a thing the crew read,
 * and a diver who mis-tapped picks a different band rather than erasing what
 * the shop already saw.
 *
 * Returns false when no live booking matched, so the caller can say so rather
 * than reporting a save that never happened.
 */
export async function setBookingLastDived(
  db: AppDb,
  input: { shopId: string; bookingId: string; band: DiveRecencyBand },
): Promise<boolean> {
  const [updated] = await db
    .update(bookings)
    .set({ lastDivedBand: input.band })
    .where(
      and(
        eq(bookings.id, input.bookingId),
        eq(bookings.shopId, input.shopId),
        ne(bookings.status, "cancelled"),
      ),
    )
    .returning({ id: bookings.id });
  return Boolean(updated);
}

/**
 * A meal preference for the galley, not an allergy record (dive-domain
 * review B1), from the Day-of form or the roster of a departure that serves
 * lunch aboard (fifth-loop ideas, item 56). The booking's, not the person's:
 * it is for this boat's galley. Null clears it. False when nothing was
 * written: no such live booking, or its departure does not serve lunch.
 */
export async function setBookingDietaryNote(
  db: AppDb,
  input: { shopId: string; bookingId: string; note: string | null },
): Promise<boolean> {
  const updated = await db
    .update(bookings)
    .set({ dietaryNote: cleanDietaryNote(input.note) })
    .where(
      and(
        eq(bookings.id, input.bookingId),
        eq(bookings.shopId, input.shopId),
        ne(bookings.status, "cancelled"),
        // Only a departure that serves lunch aboard takes a lunch note, from
        // either writer (dive-domain second pass, N-a): the roster hides its
        // control otherwise, and a hand-posted form is refused here too.
        inArray(
          bookings.tripId,
          db
            .select({ id: trips.id })
            .from(trips)
            .where(and(eq(trips.shopId, input.shopId), eq(trips.lunchAboard, true), liveTrip())),
        ),
      ),
    )
    .returning({ id: bookings.id });
  return updated.length > 0;
}

export async function setBookingHotelPickup(
  db: AppDb,
  input: { shopId: string; bookingId: string; hotelPickupLocation: string | null },
): Promise<boolean> {
  const [updated] = await db
    .update(bookings)
    .set({ hotelPickupLocation: input.hotelPickupLocation })
    .where(
      and(
        eq(bookings.id, input.bookingId),
        eq(bookings.shopId, input.shopId),
        ne(bookings.status, "cancelled"),
      ),
    )
    .returning({ id: bookings.id, tripId: bookings.tripId, personId: bookings.personId });
  if (!updated) return false;
  // "Ada Lindqvist has a hotel pickup." — one of the four arrival facts #1187
  // names, and the one a crew planning a run to the dock most needs. Only when
  // there is a pickup: clearing one is the desk tidying a field, not news.
  if (input.hotelPickupLocation) {
    await recordDeskEvent(db, {
      shopId: input.shopId,
      tripId: updated.tripId,
      kind: "pickup_set",
      bookingId: updated.id,
      subjectPersonId: updated.personId,
    });
  }
  return true;
}

/**
 * The hotel pickup time staff set on one seat, or `null` when the diver makes
 * their own way to the dock. Read by the saved arrival card, which states the
 * dock call only to a diver who is not being collected (issue #2034).
 */
export async function getBookingPickupTime(
  db: DbExecutor,
  shopId: string,
  bookingId: string,
): Promise<string | null> {
  // Only while the shop offers hotel pickups (the Features page); off, the
  // card names the dock call.
  const [row] = await db
    .select({ pickupTime: bookings.pickupTime })
    .from(bookings)
    .innerJoin(shops, and(eq(shops.id, bookings.shopId), eq(shops.offersHotelPickup, true)))
    .where(and(eq(bookings.id, bookingId), eq(bookings.shopId, shopId)))
    .limit(1);
  return row?.pickupTime?.trim() || null;
}

export async function setBookingPickupDetails(
  db: AppDb,
  input: {
    shopId: string;
    bookingId: string;
    pickupTime: string | null;
    hotelPickupLocation?: string | null;
  },
): Promise<boolean> {
  const values: { pickupTime: string | null; hotelPickupLocation?: string | null } = {
    pickupTime: input.pickupTime,
  };
  if (input.hotelPickupLocation !== undefined) {
    values.hotelPickupLocation = input.hotelPickupLocation;
  }
  const [updated] = await db
    .update(bookings)
    .set(values)
    .where(
      and(
        eq(bookings.id, input.bookingId),
        eq(bookings.shopId, input.shopId),
        ne(bookings.status, "cancelled"),
      ),
    )
    .returning({ id: bookings.id });
  return Boolean(updated);
}
