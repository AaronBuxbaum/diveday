import { and, asc, eq, isNull, ne } from "drizzle-orm";
import { trackEvent } from "@/lib/analytics";
import { calendarDateInTimezone } from "@/lib/calendar-date";
import { nowDate } from "@/lib/clock";
import { personNamesMatch } from "@/lib/person-name";
import { hasVerifiedCertificationAtLeast } from "@/lib/readiness";
import type { TripAdmissionRefusal } from "@/lib/trip-admission";
import {
  type IssuedCapability,
  issueBookingCapability,
  revokeBookingCapabilities,
  verifyBookingCapability,
} from "./booking-capabilities";
import { tripAdmissionFor } from "./bookings";
import { type AppDb, type DbExecutor, isUniqueConstraintViolation } from "./client";
import { recordTripActivity } from "./operations";
import { findOrCreatePerson } from "./people";
import { bookings, certifications, courses, people, shops, trips, waiverRecords } from "./schema";
import { issueWaiverOnJoin } from "./waiver-issue";

/**
 * Seat claims (docs ADR 20260804-seat-claim-links): one organizer books a
 * party, every other diver claims their own seat through a bearer
 * `/claim/[token]` link — own name, own contact, own waiver, own prep —
 * instead of the organizer relaying paperwork for people the shop has never
 * met. Claiming re-points the seat's existing booking row at the claimant's
 * person record; it never creates or frees a seat, so capacity, payment
 * state, and the party's atomicity are untouched. An unclaimed seat stays
 * exactly as the organizer typed it and boards exactly as today — claiming
 * is an upgrade, never a requirement.
 */

/**
 * Everything the `/claim/[token]` page needs to render the claim form.
 * `null` for anything that must read as "this link isn't available" —
 * unknown/expired/revoked token, cancelled booking or trip (both fail closed
 * inside `verifyBookingCapability`), a seat already claimed, a seat that
 * isn't a party member's, or a departed trip. Callers must not distinguish
 * those cases in a response, same rule as every capability page.
 */
export type ClaimPageData = {
  shopId: string;
  shopName: string;
  shopSlug: string;
  defaultLocale: string;
  timezone: string;
  contactEmail: string | null;
  contactPhone: string | null;
  tripId: string;
  tripTitle: string;
  startsAt: Date;
  endsAt: Date;
  /** The name the organizer typed for this seat — the seat being claimed, never a sibling's. */
  seatName: string;
};

export async function getClaimPageData(
  db: AppDb,
  token: string,
  now: Date = nowDate(),
): Promise<ClaimPageData | null> {
  const capability = await verifyBookingCapability(db, { token, purpose: "claim", now });
  if (!capability) return null;
  const [row] = await db
    .select({ booking: bookings, trip: trips, shop: shops, person: people })
    .from(bookings)
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .innerJoin(shops, eq(shops.id, bookings.shopId))
    .innerJoin(people, eq(people.id, bookings.personId))
    .where(and(eq(bookings.id, capability.bookingId), eq(bookings.shopId, capability.shopId)))
    .limit(1);
  if (!row) return null;
  if (!claimableNow(row.booking, row.trip, now)) return null;
  return {
    shopId: row.shop.id,
    shopName: row.shop.name,
    shopSlug: row.shop.slug,
    defaultLocale: row.shop.defaultLocale,
    timezone: row.shop.timezone,
    contactEmail: row.shop.contactEmail,
    contactPhone: row.shop.contactPhone,
    tripId: row.trip.id,
    tripTitle: row.trip.title,
    startsAt: row.trip.startsAt,
    endsAt: row.trip.endsAt,
    seatName: row.person.fullName,
  };
}

/**
 * The one claimability rule, shared by the page read and the claim write so
 * they can never drift: the seat is a live party-member booking
 * (`status = 'booked'`, linked to a lead, not yet claimed) on a scheduled
 * trip that hasn't departed. Deliberately *not* checked: `conditions_hold`
 * — a hold pauses new seat sales while existing bookings remain valid
 * (glossary), and a claim moves paperwork onto an existing seat rather than
 * selling one, the same reasoning `restoreBooking` records for undo.
 */
function claimableNow(
  booking: typeof bookings.$inferSelect,
  trip: typeof trips.$inferSelect,
  now: Date,
): boolean {
  return (
    booking.status === "booked" &&
    booking.partyLeadBookingId !== null &&
    booking.claimedAt === null &&
    trip.status === "scheduled" &&
    trip.startsAt > now
  );
}

export type ClaimSeatInput = {
  token: string;
  fullName: string;
  /** Required — the claimant's own contact is the whole point of claiming. */
  email: string;
  phone?: string;
  now?: Date;
};

export type ClaimSeatResult =
  | {
      ok: true;
      shopId: string;
      bookingId: string;
      tripId: string;
      personId: string;
      personName: string;
      /** Set when the claimant's submitted name didn't match the person row their email resolved to (H-13). */
      identityUnconfirmed: boolean;
    }
  | { ok: false; reason: "invalid" | "already_booked" | "course_prerequisite" }
  | { ok: false; reason: "trip_prerequisite"; refusal: TripAdmissionRefusal };

/**
 * The claim transaction. Verifies the bearer token, locks the seat, resolves
 * the claimant to a person row (reused by email — "enter once, reuse
 * everywhere" — or created), re-runs the trip's own admission gate on the
 * *claimant's* evidence, then re-points the booking and closes every door the
 * placeholder identity had open:
 *
 * - Any not-superseded waiver record on this booking that belongs to a
 *   different person is superseded — without this, `listTripWaiverStatuses`'s
 *   booking-scoped join would let the claimant board on the placeholder's
 *   signature (and the organizer's still-live waiver link could sign "for"
 *   the claimant). Superseding keeps the signed history immutable while
 *   making it non-current, the same correction mechanism waivers already use.
 * - Every outstanding capability on the booking is revoked, whatever its
 *   purpose: all live claim links die (one-shot claiming — a second claim of
 *   the same seat fails at verify, first untouched), and any link minted
 *   while the seat was the placeholder's stops granting authority over the
 *   claimant's data.
 *
 * Identity semantics follow the public booking form exactly (H-13): an email
 * match reuses that person row, and a submitted name that doesn't match the
 * row on file stamps `identity_unconfirmed_at`, so readiness fails closed
 * until staff confirm — a claimant can never silently inherit someone else's
 * verified evidence by typing their email.
 */
async function claimSeatRecord(tx: DbExecutor, input: ClaimSeatInput): Promise<ClaimSeatResult> {
  const now = input.now ?? nowDate();
  const capability = await verifyBookingCapability(tx, {
    token: input.token,
    purpose: "claim",
    now,
  });
  if (!capability) return { ok: false, reason: "invalid" };

  // Same lock as every seat-granting write: serializes two concurrent claims
  // of the same seat so the second re-reads `claimed_at` after the first
  // commits and refuses, instead of both re-pointing.
  const [booking] = await tx
    .select()
    .from(bookings)
    .where(and(eq(bookings.id, capability.bookingId), eq(bookings.shopId, capability.shopId)))
    .limit(1)
    .for("update");
  if (!booking) return { ok: false, reason: "invalid" };
  const [trip] = await tx
    .select()
    .from(trips)
    .where(and(eq(trips.id, booking.tripId), eq(trips.shopId, capability.shopId)))
    .limit(1);
  if (!trip || !claimableNow(booking, trip, now)) return { ok: false, reason: "invalid" };

  const email = input.email.trim().toLowerCase();
  const fullName = input.fullName.trim();
  // Look up without creating: a refused claim must leave no orphan person
  // behind, same as `createBookingRecord`'s pendingInsert ordering.
  const [existing] = await tx
    .select()
    .from(people)
    .where(
      and(eq(people.shopId, capability.shopId), eq(people.email, email), isNull(people.deletedAt)),
    )
    .limit(1);
  const identityUnconfirmed = existing ? !personNamesMatch(existing.fullName, fullName) : false;

  // One person, one seat: if the claimant already holds their own live seat
  // on this trip, re-pointing this one would put them on the manifest twice
  // (and violate bookings_trip_person_unique). The organizer's other seats
  // stay untouched — this refusal is about the claimant, not the party.
  if (existing && existing.id !== booking.personId) {
    const [clash] = await tx
      .select({ id: bookings.id })
      .from(bookings)
      .where(
        and(
          eq(bookings.tripId, trip.id),
          eq(bookings.personId, existing.id),
          ne(bookings.status, "cancelled"),
        ),
      )
      .limit(1);
    if (clash) return { ok: false, reason: "already_booked" };
  }

  // On a course session the course's own card gate is the admission rule,
  // and it fails closed exactly as it does at booking (`createBookingRecord`'s
  // `course_prerequisite`): a claimant with no verified card at the course's
  // stated level cannot take the seat — a party seat on a card-gated session
  // only exists because *its current person* cleared that gate, and a claim
  // must not be the door that dodges it. Minimum age is deliberately not
  // checked here, matching the public booking actor: an age refusal keyed to
  // an email the claimant merely typed is an oracle about someone else's
  // record (H-22), and the readiness blocker still catches an under-age seat.
  if (trip.courseId) {
    const [course] = await tx
      .select()
      .from(courses)
      .where(and(eq(courses.id, trip.courseId), eq(courses.shopId, capability.shopId)))
      .limit(1);
    if (course?.minimumCertificationLevel) {
      if (!existing) return { ok: false, reason: "course_prerequisite" };
      const [shop] = await tx
        .select({ timezone: shops.timezone })
        .from(shops)
        .where(eq(shops.id, capability.shopId))
        .limit(1);
      if (!shop) throw new Error(`claimSeatRecord: shop ${capability.shopId} not found`);
      const cardRows = await tx
        .select()
        .from(certifications)
        .where(
          and(
            eq(certifications.shopId, capability.shopId),
            eq(certifications.personId, existing.id),
            isNull(certifications.deletedAt),
          ),
        );
      const todayLocal = calendarDateInTimezone(now, shop.timezone);
      if (
        !hasVerifiedCertificationAtLeast(cardRows, course.minimumCertificationLevel, todayLocal)
      ) {
        return { ok: false, reason: "course_prerequisite" };
      }
    }
  }

  // The trip's own cert/specialty/nitrox gate, re-run on the claimant's
  // evidence — claiming never weakens a gate, and admission for the claimant
  // is exactly what a fresh booking of this seat by this person would face.
  // An unknown or identity-unconfirmed claimant is admitted (absence of
  // evidence is never a refusal) and readiness still holds the boarding line.
  const admission = await tripAdmissionFor(
    tx,
    capability.shopId,
    trip.id,
    existing ? { id: existing.id } : undefined,
    identityUnconfirmed,
    Boolean(trip.courseId),
  );
  if (!admission.admitted) {
    return { ok: false, reason: "trip_prerequisite", refusal: admission.refusal };
  }

  // Gates passed — now resolve for real. Under a racing insert for the same
  // email, `findOrCreatePerson` converges on the winner and reports whether
  // *our* name matches the row that actually landed.
  const resolved = existing
    ? { person: existing, nameMatches: !identityUnconfirmed }
    : await findOrCreatePerson(tx, {
        shopId: capability.shopId,
        fullName,
        email,
        phone: input.phone,
      });
  const person = resolved.person;
  const unconfirmed = !resolved.nameMatches;

  // The claimant's own contact, but only onto an identity that matched: an
  // unconfirmed claimant must not write contact data onto the person row
  // they merely named (H-13's borrowed-evidence rule, applied to writes).
  if (!unconfirmed && input.phone?.trim() && !person.phone) {
    await tx
      .update(people)
      .set({ phone: input.phone.trim() })
      .where(and(eq(people.id, person.id), eq(people.shopId, capability.shopId)));
  }

  // Supersede any current waiver record on this booking that isn't the
  // claimant's — see the function comment for why this is load-bearing.
  await tx
    .update(waiverRecords)
    .set({ supersededAt: now })
    .where(
      and(
        eq(waiverRecords.shopId, capability.shopId),
        eq(waiverRecords.bookingId, booking.id),
        ne(waiverRecords.personId, person.id),
        isNull(waiverRecords.supersededAt),
      ),
    );

  await tx
    .update(bookings)
    .set({
      personId: person.id,
      claimedAt: now,
      identityUnconfirmedAt: unconfirmed ? now : null,
    })
    .where(eq(bookings.id, booking.id));

  // Every purpose, not just `claim`: any capability minted over this booking
  // before the claim was authority over the placeholder's seat, and must not
  // survive as authority over the claimant's.
  await revokeBookingCapabilities(tx, {
    shopId: capability.shopId,
    bookingId: booking.id,
    now,
  });

  return {
    ok: true,
    shopId: capability.shopId,
    bookingId: booking.id,
    tripId: trip.id,
    personId: person.id,
    personName: person.fullName,
    identityUnconfirmed: unconfirmed,
  };
}

/**
 * Claim a party seat, with every consequence the seating paths owe
 * (`seatDiver` is the model): the re-point itself is one transaction, then
 * the claimant's own waiver goes out, the trip's activity trail records who
 * claimed, and the analytics event fires — each best-effort after the claim
 * is committed, so a mail-provider outage can never cost anyone their claim.
 */
export async function claimPartySeat(db: AppDb, input: ClaimSeatInput): Promise<ClaimSeatResult> {
  const outcome = await db
    .transaction((tx) => claimSeatRecord(tx, input))
    .catch((error: unknown): ClaimSeatResult => {
      // Two truly concurrent claims by the same *new* email on two different
      // seats of one trip both pass the serial clash check (neither person
      // row exists yet), converge on one person via `findOrCreatePerson`, and
      // the second re-point then trips `bookings_trip_person_unique`. The
      // index is the backstop that keeps one diver off the manifest twice;
      // surface it as the same refusal the serial path gives.
      if (isUniqueConstraintViolation(error)) return { ok: false, reason: "already_booked" };
      throw error;
    });
  if (!outcome.ok) return outcome;
  await trackEvent({ name: "seat_claimed", source: "diver" });
  try {
    // The claimant's own waiver, to their own address — idempotent, and a
    // sign-once diver with a current signature at this shop is skipped.
    await issueWaiverOnJoin(db, outcome.shopId, outcome.bookingId);
  } catch {
    console.error("Waiver-on-claim could not be issued", { bookingId: outcome.bookingId });
  }
  try {
    await recordTripActivity(db, {
      shopId: outcome.shopId,
      tripId: outcome.tripId,
      actorPersonId: outcome.personId,
      action: "claimed their seat",
    });
  } catch {
    console.error("Seat-claim activity could not be recorded", { bookingId: outcome.bookingId });
  }
  return outcome;
}

/** One party seat as the organizer's claim panel shows it. */
export type PartySeatClaim = {
  bookingId: string;
  /** The name currently on the seat — the organizer's own typing until claimed, the claimant after. */
  seatName: string;
  claimed: boolean;
  /**
   * A fresh claim capability for an unclaimed seat, or null for a claimed one
   * (nothing left to hand out) — and null when issuing failed, which the
   * panel renders as the seat's name with no link rather than an error.
   */
  claim: IssuedCapability | null;
};

/**
 * The organizer's view of their party, minting a shareable claim link per
 * still-unclaimed seat. Authorization is the caller's *verified* capability
 * over the lead booking (`confirm` on the confirmation panel, `readiness` on
 * /ready) — this function only ever walks seats whose
 * `party_lead_booking_id` equals that lead within the same shop, so no other
 * booking is reachable however it is called. Tokens are minted per render
 * because only hashes are stored; `MAX_LIVE_CAPABILITIES_PER_PURPOSE` keeps
 * the pile bounded.
 *
 * After departure the links stop being mintable on purpose (`claimableNow`
 * would refuse them anyway): the panel keeps showing who claimed, but a seat
 * nobody claimed before the boat left is the organizer's exactly as today.
 */
export async function issuePartySeatClaims(
  db: AppDb,
  input: { shopId: string; leadBookingId: string; now?: Date },
): Promise<PartySeatClaim[]> {
  const now = input.now ?? nowDate();
  const rows = await db
    .select({ booking: bookings, person: people, trip: trips })
    .from(bookings)
    .innerJoin(people, eq(people.id, bookings.personId))
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .where(
      and(
        eq(bookings.shopId, input.shopId),
        eq(bookings.partyLeadBookingId, input.leadBookingId),
        ne(bookings.status, "cancelled"),
      ),
    )
    .orderBy(asc(bookings.createdAt), asc(bookings.id));
  const seats: PartySeatClaim[] = [];
  for (const row of rows) {
    const claimable = claimableNow(row.booking, row.trip, now);
    seats.push({
      bookingId: row.booking.id,
      seatName: row.person.fullName,
      claimed: row.booking.claimedAt !== null,
      claim: claimable
        ? await issueBookingCapability(db, {
            shopId: input.shopId,
            bookingId: row.booking.id,
            purpose: "claim",
            now,
          })
        : null,
    });
  }
  return seats;
}
