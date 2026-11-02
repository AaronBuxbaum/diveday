import { and, asc, desc, eq, isNull, ne, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { trackEvent } from "@/lib/analytics";
import { nowDate } from "@/lib/clock";
import { seatListPriceCents } from "@/lib/deposits";
import { guardianSignatureRequired, signingDate } from "@/lib/guardian";
import { seatName } from "@/lib/held-seat";
import { log } from "@/lib/log";
import { seatIsHeld } from "@/lib/no-show";
import type { ParticipantType } from "@/lib/participant-types";
import { isCapturedPaymentStatus } from "@/lib/payment-source";
import { personNamesMatch } from "@/lib/person-name";
import { hasVerifiedCertificationAtLeast } from "@/lib/readiness";
import type { TripAdmissionRefusal } from "@/lib/trip-admission";
import { isCompletedWaiverCurrent, waiverClockInstant } from "@/lib/waivers";
import { type AboardHold, heldAtTheDoor } from "./aboard-at-sea";
import {
  type IssuedCapability,
  mintBookingCapabilities,
  revokeBookingCapabilities,
  staleBookingCapabilityForToken,
  verifyBookingCapability,
} from "./booking-capabilities";
import { partySeatGoesWithLead, tripAdmissionFor } from "./bookings";
import type { AppDb, DbExecutor } from "./client";
import { recordTripActivity } from "./operations";
import { findOrCreatePerson } from "./people";
import { storedPhone } from "./person-phone";
import { isUniqueConstraintViolation } from "./query-helpers";
import { getBookingReadiness } from "./readiness";
import {
  bookingPayments,
  bookings,
  certifications,
  courses,
  people,
  type Shop,
  shops,
  trips,
  waiverRecords,
  waiverTemplates,
} from "./schema";
import { livePerson, liveTrip } from "./trips-live";
import { issueWaiverOnJoin } from "./waiver-issue";
import { WAIVER_STATE_COLUMNS } from "./waiver-record-columns";
import { issueWaiverRequest } from "./waivers-requests";

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
  /**
   * The booker said this seat is "Under 18" (`bookings.minor_declared_at`):
   * the page says a parent or guardian signs the release with them (H-20261014-parent-signs-minor-release).
   */
  minorDeclared: boolean;
  /**
   * The booker could sign this seat's release from their own page now (the
   * panel's `sign`), so the page may say so. False where that door refuses,
   * such as a teen with an address of their own (dive-domain review F4).
   */
  parentCanSign: boolean;
};

export async function getClaimPageData(
  db: AppDb,
  token: string,
  now: Date = nowDate(),
): Promise<ClaimPageData | null> {
  const capability = await verifyBookingCapability(db, {
    token,
    purpose: "claim",
    now,
  });
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
  const leadBookingId = row.booking.partyLeadBookingId;
  const lead =
    row.booking.minorDeclaredAt !== null && leadBookingId
      ? await leadSigningContext(db, row.shop.id, leadBookingId)
      : null;
  const door = lead
    ? await minorSeatDoor(db, row.shop.id, lead, row, { now, claimable: true })
    : null;
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
    seatName: seatName(row.person.fullName, row.booking),
    minorDeclared: row.booking.minorDeclaredAt !== null,
    parentCanSign: door === "sign",
  };
}

/**
 * **The one thing a dead claim link is allowed to say about its shop.**
 *
 * A claim link is a *booking* capability, so it wears the booking tier of the
 * dead-link law (ADR 20260827-first-light, decision 3, and decision 4 — claim
 * joins the thread): the person holding a dead one is a party member who was
 * forwarded a URL in a group chat, and their whole question is *who do I ask*.
 * Answering "ask the shop" without naming the shop is a dead end, so where the
 * token still tells us which shop issued it, the page hands over that shop's
 * own published name and contact and the claim page's terminal card is
 * `ExpiredLinkCard`. Where it does not, the bare door renders and names
 * nothing — there is no shop to attribute an unresolvable token to without
 * weakening the guarantee the whole model rests on, that a bearer token reveals
 * only its own record.
 *
 * **What is relaxed here is only *when* the token was valid, never *whether* it
 * was ours.** `staleBookingCapabilityForToken` still requires a genuine hash
 * match on a capability issued for the `claim` purpose, so guessing is no
 * cheaper than it was; expiry and revocation are what it lets through, which is
 * exactly the population this tier exists for — a spent claim (claiming revokes
 * every capability on the booking), a link replaced by a newer one, a seat
 * somebody else took, a seat the shop cancelled and a departure it called off
 * (those two fail closed inside `verifyBookingCapability`), a departure that
 * has since sailed.
 *
 * **That list is the constraint on what the page may say.** Six causes reach
 * one arm and this reader cannot tell them apart, so the dead card's sentence
 * has to be true of the worst of them: the seat may be gone, the boat may be
 * back, the day may be off, and no fresh link is mintable for any of those —
 * `issuePartySeatClaims` returns `claim: null` the moment `claimableNow` is
 * false, so the organizer has nothing left to forward. A sentence claiming the
 * seat, or offering that link, is this page telling a diver whose Saturday was
 * called off that their seat is safe and sending them to ask for something
 * nobody can produce. Widening the arm is not the fix; the sentence claiming
 * less is.
 *
 * **The shop's four public columns and nothing else.** No booking, no diver, no
 * trip is read through a dead token, and the narrow return type is the guard
 * rather than a comment asking the next caller not to — the same argument
 * `staleBookingCapabilityForToken`'s `{ shopId }`-only shape makes one file
 * over. `defaultLocale` is in the set because the page has to choose a language
 * before it can say anything at all.
 *
 * Like `/ready`'s, this attribution outlives revocation and expiry: it lasts
 * until the row is pruned, 90 days past its `expires_at` (`booking_capabilities`
 * in `src/lib/retention.ts`, issue #1726), and after that the URL names nobody.
 * That is recorded in
 * docs/engineering/capability-telemetry-runbook.md, where an exposed URL is
 * assessed.
 */
export type DeadClaimShop = Pick<Shop, "name" | "contactEmail" | "contactPhone" | "defaultLocale">;

export type ClaimPageState =
  /** A live token over a seat that can still change hands: render the form. */
  | { kind: "claimable"; data: ClaimPageData }
  /** Dead, but ours: the booking tier — name the shop, offer its hand. */
  | { kind: "dead"; shop: DeadClaimShop }
  /** Nothing resolved at all: the bare door, naming no one. */
  | { kind: "unknown" };

export async function getClaimPageState(
  db: AppDb,
  token: string,
  now: Date = nowDate(),
): Promise<ClaimPageState> {
  const data = await getClaimPageData(db, token, now);
  if (data) return { kind: "claimable", data };
  const stale = await staleBookingCapabilityForToken(db, {
    token,
    purpose: "claim",
  });
  if (!stale) return { kind: "unknown" };
  const [shop] = await db
    .select({
      name: shops.name,
      contactEmail: shops.contactEmail,
      contactPhone: shops.contactPhone,
      defaultLocale: shops.defaultLocale,
    })
    .from(shops)
    .where(eq(shops.id, stale.shopId))
    .limit(1);
  return shop ? { kind: "dead", shop } : { kind: "unknown" };
}

/**
 * The one claimability rule, shared by the page read and the claim write so
 * they can never drift: the seat is a live booking somebody else is holding
 * for a diver (`status = 'booked'`, not yet claimed, linked to its organizer's
 * lead booking — ADR 20260804-seat-claim-links) on a scheduled trip that
 * hasn't departed.
 *
 * Deliberately *not* checked: `conditions_hold`
 * — a hold pauses new seat sales while existing bookings remain valid
 * (glossary), and a claim moves paperwork onto an existing seat rather than
 * selling one, the same reasoning `restoreBooking` records for undo.
 */
function claimableNow(
  booking: Pick<typeof bookings.$inferSelect, "status" | "partyLeadBookingId" | "claimedAt">,
  trip: Pick<typeof trips.$inferSelect, "status" | "startsAt">,
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
      /** Set when the claimant's submitted name didn't match the person row their email resolved to (H-20260724-one-person-per-email). */
      identityUnconfirmed: boolean;
    }
  | { ok: false; reason: "invalid" | "course_prerequisite" }
  /**
   * The typed address already holds a live seat on this trip. `held`
   * is that seat, for the note to its holder (`tellSeatAlreadyHeld`); the
   * claimant is never shown it. Null only when two claims raced and the seat
   * could not be re-found.
   */
  | { ok: false; reason: "already_booked"; held: { shopId: string; bookingId: string } | null }
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
 * Identity semantics follow the public booking form exactly (H-20260724-one-person-per-email): an email
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
    .where(and(eq(trips.id, booking.tripId), eq(trips.shopId, capability.shopId), liveTrip()))
    .limit(1);
  if (!trip || !claimableNow(booking, trip, now)) {
    return { ok: false, reason: "invalid" };
  }

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

  // On a course session the course's own card gate is the admission rule,
  // and it fails closed exactly as it does at booking (`createBookingRecord`'s
  // `course_prerequisite`): a claimant with no verified card at the course's
  // stated level cannot take the seat — a party seat on a card-gated session
  // only exists because *its current person* cleared that gate, and a claim
  // must not be the door that dodges it. Minimum age is deliberately not
  // checked here, matching the public booking actor: an age refusal keyed to
  // an email the claimant merely typed is an oracle about someone else's
  // record (H-20260724-minimum-age-gate-fail), and the readiness blocker still catches an under-age seat.
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
      if (!hasVerifiedCertificationAtLeast(cardRows, course.minimumCertificationLevel)) {
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
    undefined,
    // The seat's own type: a rider or a snorkeler is asked for no card, here
    // exactly as at booking (ADR 20261007-participant-types).
    booking.participantType,
  );
  if (!admission.admitted) {
    return {
      ok: false,
      reason: "trip_prerequisite",
      refusal: admission.refusal,
    };
  }

  // One person, one seat: if the claimant already holds their own live seat
  // on this trip, re-pointing this one would put them on the manifest twice
  // (and violate bookings_trip_person_unique). The organizer's other seats
  // stay untouched — this refusal is about the claimant, not the party.
  // It runs after every gate, so a gate refusal does not depend on whether
  // the typed email holds a seat here (issue #2288). The refusal itself is not
  // shown: the action answers it exactly as it answers a claim that worked,
  // and tells the seat's holder by email instead (issue #2381).
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
    if (clash)
      return {
        ok: false,
        reason: "already_booked",
        held: { shopId: capability.shopId, bookingId: clash.id },
      };
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
  // they merely named (H-20260724-one-person-per-email's borrowed-evidence rule, applied to writes).
  if (!unconfirmed && input.phone?.trim() && !person.phone) {
    await tx
      .update(people)
      .set({ phone: await storedPhone(tx, capability.shopId, input.phone) })
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
      identityBookedAs: unconfirmed ? fullName : null,
      identityMatchedBy: unconfirmed ? "shared_email" : null,
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
 * The live seat the typed address already holds on the claimed seat's trip,
 * found again after a racing claim rolled back. Null when it cannot be told.
 */
async function heldSeatForClaim(
  db: AppDb,
  input: ClaimSeatInput,
): Promise<{ shopId: string; bookingId: string } | null> {
  const capability = await verifyBookingCapability(db, {
    token: input.token,
    purpose: "claim",
    now: input.now ?? nowDate(),
  });
  if (!capability) return null;
  const [seat] = await db
    .select({ tripId: bookings.tripId })
    .from(bookings)
    .where(and(eq(bookings.id, capability.bookingId), eq(bookings.shopId, capability.shopId)))
    .limit(1);
  if (!seat) return null;
  const [held] = await db
    .select({ id: bookings.id })
    .from(bookings)
    .innerJoin(people, and(eq(people.id, bookings.personId), eq(people.shopId, bookings.shopId)))
    .where(
      and(
        eq(bookings.shopId, capability.shopId),
        eq(bookings.tripId, seat.tripId),
        eq(people.email, input.email.trim().toLowerCase()),
        isNull(people.deletedAt),
        ne(bookings.status, "cancelled"),
        ne(bookings.id, capability.bookingId),
      ),
    )
    .limit(1);
  return held ? { shopId: capability.shopId, bookingId: held.id } : null;
}

/**
 * **A refused claim kills its link, as a claim that worked does** (issue
 * #2381). The action answers a booked address exactly as it answers a fresh
 * one, but the claim page behind the link is a second answer: a success ends
 * every claim link on the seat, so a refusal that left its link live would tell
 * anyone holding it which addresses hold a seat. Committed here, outside the
 * claim's transaction, because that one rolled back (or ended with no write)
 * and a revoke inside it would roll back with it. The organizer's next view of
 * the party panel mints a fresh link (`issuePartySeatClaims`).
 *
 * Fails open to the log: the refusal stands either way, and a failed revoke
 * must not turn into a different answer for a booked address.
 */
async function retireRefusedClaimLink(db: AppDb, input: ClaimSeatInput): Promise<void> {
  try {
    const now = input.now ?? nowDate();
    const capability = await verifyBookingCapability(db, {
      token: input.token,
      purpose: "claim",
      now,
    });
    if (!capability) return;
    await revokeBookingCapabilities(db, {
      shopId: capability.shopId,
      bookingId: capability.bookingId,
      purpose: "claim",
      now,
    });
  } catch (error) {
    log("seat_claim.refused_link_not_retired", "error", {
      errorCode: error instanceof Error ? error.name : "unknown_error",
    });
  }
}

/**
 * The claim itself and nothing after it: the re-point (one transaction) and,
 * for a refusal of an address that already holds a seat, the retired link.
 * The caller owes `settleClaimedSeat` for a success, after its response
 * (`claimSeatAction`): that work sends mail inline, so doing it before the
 * answer would let a claim that worked take visibly longer than one that was
 * refused (issue #2381).
 */
export async function claimPartySeatRecord(
  db: AppDb,
  input: ClaimSeatInput,
): Promise<ClaimSeatResult> {
  const outcome = await db
    .transaction((tx) => claimSeatRecord(tx, input))
    .catch(async (error: unknown): Promise<ClaimSeatResult> => {
      // Two truly concurrent claims by the same *new* email on two different
      // seats of one trip both pass the serial clash check (neither person
      // row exists yet), converge on one person via `findOrCreatePerson`, and
      // the second re-point then trips `bookings_trip_person_unique`. The
      // index is the backstop that keeps one diver off the manifest twice;
      // surface it as the same refusal the serial path gives.
      if (isUniqueConstraintViolation(error)) {
        return {
          ok: false,
          reason: "already_booked",
          held: await heldSeatForClaim(db, input),
        };
      }
      throw error;
    });
  if (!outcome.ok && outcome.reason === "already_booked") await retireRefusedClaimLink(db, input);
  return outcome;
}

/**
 * What a committed claim owes, each best-effort so a mail-provider outage can
 * never cost anyone their claim: the claimant's own waiver goes out, the
 * analytics event fires and the trip's activity trail records who claimed
 * (`seatDiver` is the model).
 */
export async function settleClaimedSeat(
  db: AppDb,
  outcome: Extract<ClaimSeatResult, { ok: true }>,
): Promise<void> {
  try {
    await trackEvent({ name: "seat_claimed", source: "diver" });
  } catch (error) {
    log("seat_claim.event_failed", "error", {
      bookingId: outcome.bookingId,
      errorCode: error instanceof Error ? error.name : "unknown_error",
    });
  }
  try {
    // The claimant's own waiver, to their own address — idempotent, and a
    // sign-once diver with a current signature at this shop is skipped.
    await issueWaiverOnJoin(db, outcome.shopId, outcome.bookingId);
  } catch (error) {
    log("seat_claim.waiver_failed", "error", {
      bookingId: outcome.bookingId,
      errorCode: error instanceof Error ? error.name : "unknown_error",
    });
  }
  try {
    await recordTripActivity(db, {
      shopId: outcome.shopId,
      tripId: outcome.tripId,
      actorPersonId: outcome.personId,
      entry: { code: "seat_claimed" },
    });
  } catch (error) {
    log("seat_claim.activity_record_failed", "error", {
      bookingId: outcome.bookingId,
      errorCode: error instanceof Error ? error.name : "unknown_error",
    });
  }
}

/** Claim a party seat and settle it at once; the action splits the two around its response. */
export async function claimPartySeat(db: AppDb, input: ClaimSeatInput): Promise<ClaimSeatResult> {
  const outcome = await claimPartySeatRecord(db, input);
  if (outcome.ok) await settleClaimedSeat(db, outcome);
  return outcome;
}

/** One party seat as the organizer's claim panel shows it. */
export type PartySeatClaim = {
  bookingId: string;
  /** This authorized companion sails on a different departure from the lead. */
  differentDeparture: boolean;
  /** Current capacity fact for the header summary; the panel also retains released rows. */
  seatHeld: boolean;
  /** The name currently on the seat — the organizer's own typing until claimed, the claimant after. */
  seatName: string;
  claimed: boolean;
  /**
   * Their waiver is signed. **One booking-scoped fact, never readiness**: the
   * organizer paid for this seat and is the person who will notice it is not
   * ready, so "has this seat signed?" is theirs to know — but a card sitting
   * with the shop for verification is the shop's move, not the party's, and
   * nothing here says a word about it. The thread renders this only as the
   * party's own aggregate line (`thread.partyAllSet`), never per seat.
   */
  waiverSigned: boolean;
  /**
   * What the seat is (ADR 20261007-participant-types), so the lead's money
   * line can price each unclaimed seat by its own fare (fourth UX review, item 5).
   */
  participantType: ParticipantType;
  /**
   * **The lead may sign this seat's release as its parent** (H-20261014-parent-signs-minor-release, ADR
   * 20261014-parent-signs-minor-release): an unclaimed seat the booker said
   * is "Under 18", not held, still claimable, and owing a waiver. The panel
   * offers "Sign {name}'s waiver" exactly then; `openMinorSeatWaiver`
   * re-derives the same answer before it opens anything.
   */
  signForMinor: boolean;
  /**
   * What the panel says on a minor seat with no "Sign" button (dive-domain
   * review F4 and N7 of layer r4-1): `send_link` when a release is owed but
   * the parent's door refuses (the seat has an address of its own), so the
   * path left is the seat's link with a parent or guardian beside them;
   * `physician` when the child's medical referred them, which only the shop
   * can clear. Null otherwise.
   */
  minorNote: "send_link" | "physician" | null;
  /**
   * The lead's own cancel would take this seat with it: unclaimed and still
   * `booked` (batch 6 item 10, `cancelUnclaimedPartySeats`). The confirm lists
   * these, and the rest as staying.
   */
  cancelsWithLead: boolean;
  /**
   * A fresh claim capability for an unclaimed seat, or null for a claimed one
   * (nothing left to hand out) — and null when issuing failed, which the
   * panel renders as the seat's name with no link rather than an error.
   */
  claim: IssuedCapability | null;
  /**
   * The lead may pay for this seat online (issue #2474): unclaimed, priced and
   * not yet settled. A fact about the seat only; whether the page may charge
   * at all (a connected shop, a lead the page trusts) is `canPayPartySeats`.
   */
  payable: boolean;
};

/** The party lead's own booking, joined beside each of the party's seats. */
const partyLead = alias(bookings, "party_lead");

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
 *
 * **Ordered seat time, then the seat's name, then the booking id** — the clause
 * `getTripRoster` states in full (issue #1753). This reader is the one on that
 * list where **production reaches the tie**, not only a test: every row here
 * belongs to *one party*, and `createBookingParty` writes the whole party in a
 * single transaction with `createBooking` stamping `nowDate()` per seat, at
 * millisecond resolution. Two seats typed into the same form landing in one
 * millisecond is ordinary, and the tie-break used to be `asc(bookings.id)` — a
 * `defaultRandom()` uuid. The organizer's panel renders this array in order
 * (`PartyClaimPanel`), so "Milo, then Pia" or "Pia, then Milo" was decided by
 * whichever uuid Postgres minted, and re-renders of the same party disagree
 * across databases. Under the frozen test clock the tie is not a maybe: every
 * seat of every party a spec books shares one instant.
 *
 * `people.full_name` carries `COLLATE "und-x-icu"`
 * (`drizzle/20260911200158_person-name-collation`), so the name key orders
 * sensibly in any language without the query saying so. It is *not*
 * alphabetical in the sense an organizer would search — `full_name` is one
 * free-text box — which is why the panel's copy never calls it a sorted list.
 */
export async function issuePartySeatClaims(
  db: AppDb,
  input: { shopId: string; leadBookingId: string; now?: Date },
): Promise<PartySeatClaim[]> {
  const now = input.now ?? nowDate();
  const rows = await db
    .select({
      // Only what the panel reads: not the trip's other pricing, and not the
      // waiver's token, draft or signed body. The person's email, birth date
      // and removal stamps are read for the parent's door (`minorSeatDoor`,
      // H-20261014-parent-signs-minor-release) and never leave the server: the panel gets its answer only.
      booking: {
        id: bookings.id,
        personId: bookings.personId,
        status: bookings.status,
        tripId: bookings.tripId,
        partyLeadBookingId: bookings.partyLeadBookingId,
        claimedAt: bookings.claimedAt,
        minorDeclaredAt: bookings.minorDeclaredAt,
        identityUnconfirmedAt: bookings.identityUnconfirmedAt,
        identityBookedAs: bookings.identityBookedAs,
        participantType: bookings.participantType,
      },
      person: {
        fullName: people.fullName,
        email: people.email,
        dateOfBirth: people.dateOfBirth,
        deletedAt: people.deletedAt,
        anonymizedAt: people.anonymizedAt,
      },
      trip: {
        status: trips.status,
        startsAt: trips.startsAt,
        endsAt: trips.endsAt,
        // What `seatListPriceCents` reads for `payable`, and nothing else of the pricing.
        priceCents: trips.priceCents,
        snorkelerPriceCents: trips.snorkelerPriceCents,
        riderPriceCents: trips.riderPriceCents,
      },
      waiver: WAIVER_STATE_COLUMNS,
      // The shop's current material terms, in the same statement
      // (`getCurrentWaiverGeneration`'s read): no extra round trip on a page
      // the render-cost ratchet counts.
      generation: sql<number | null>`(${db
        .select({ materialGeneration: waiverTemplates.materialGeneration })
        .from(waiverTemplates)
        .where(and(eq(waiverTemplates.shopId, input.shopId), isNull(waiverTemplates.deletedAt)))
        .orderBy(desc(waiverTemplates.createdAt))
        .limit(1)})`,
      leadTripId: partyLead.tripId,
      course: courses,
      paymentStatus: bookingPayments.status,
    })
    .from(bookings)
    .innerJoin(people, eq(people.id, bookings.personId))
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .leftJoin(courses, eq(courses.id, trips.courseId))
    .leftJoin(
      bookingPayments,
      and(eq(bookingPayments.bookingId, bookings.id), eq(bookingPayments.shopId, input.shopId)),
    )
    // The seat's current waiver and no other — a superseded record is a
    // replaced one, and counting it would report a seat as signed on paperwork
    // the shop has already withdrawn.
    .leftJoin(
      waiverRecords,
      and(eq(waiverRecords.bookingId, bookings.id), isNull(waiverRecords.supersededAt)),
    )
    // The lead's own departure, beside every seat rather than a second
    // statement after them: a seat moved to another departure does not go with
    // the lead's cancel (`cancelUnclaimedPartySeats` reaches the lead's own
    // departure only).
    .leftJoin(
      partyLead,
      and(eq(partyLead.id, bookings.partyLeadBookingId), eq(partyLead.shopId, input.shopId)),
    )
    .where(
      and(
        eq(bookings.shopId, input.shopId),
        eq(bookings.partyLeadBookingId, input.leadBookingId),
        ne(bookings.status, "cancelled"),
      ),
    )
    .orderBy(asc(bookings.createdAt), asc(people.fullName), asc(bookings.id));
  // A seat counted aboard a boat past its time stays with the crew, as
  // `cancelUnclaimedPartySeats` keeps it (H-20261015-aboard-diver-removal-at).
  const onLeadTrip = rows.filter((row) => row.booking.tripId === row.leadTripId);
  const onLead = onLeadTrip[0];
  const held = onLead
    ? await heldAtTheDoor(db, {
        shopId: input.shopId,
        tripId: onLead.booking.tripId,
        startsAt: onLead.trip.startsAt,
        now,
        bookingIds: onLeadTrip.map((row) => row.booking.id),
      })
    : new Map<string, AboardHold>();
  // Every unclaimed seat's link in a fixed number of statements, not one
  // round trip per seat (#2488): a party of six costs the same as a party of one.
  const claimable = rows.filter((row) => claimableNow(row.booking, row.trip, now));
  // The lead's signing context (H-20261014-parent-signs-minor-release) only when a seat was declared "Under
  // 18", and beside the mint rather than before it: neither needs the other's
  // answer, so the parent's door costs an adult party nothing and a minor's
  // party no round trip of its own.
  const [lead, claims] = await Promise.all([
    rows.some((row) => row.booking.minorDeclaredAt !== null)
      ? leadSigningContext(db, input.shopId, input.leadBookingId)
      : null,
    // The rows above are this lead's party in this shop and not cancelled, read
    // in this request, so the departure's end is already in hand.
    mintBookingCapabilities(db, {
      shopId: input.shopId,
      seats: claimable.map((row) => ({
        bookingId: row.booking.id,
        tripEndsAt: row.trip.endsAt,
      })),
      purpose: "claim",
      now,
    }),
  ]);
  const seats: PartySeatClaim[] = [];
  for (const row of rows) {
    const door = await minorSeatDoor(db, input.shopId, lead, row, {
      now,
      claimable: claimableNow(row.booking, row.trip, now),
    });
    seats.push({
      bookingId: row.booking.id,
      differentDeparture: row.booking.tripId !== row.leadTripId,
      seatHeld: seatIsHeld(row.booking.status),
      // A held seat goes by the name it was booked under: the matched
      // record's name would tell whoever typed the email whose it is (#2125).
      seatName: seatName(row.person.fullName, row.booking),
      claimed: row.booking.claimedAt !== null,
      // "Signed" is the sign-once question, not the record's status: a
      // release aged past its year or signed against terms the shop has since
      // changed is one the diver signs again (dive-domain-expert run 4, D3).
      waiverSigned: row.waiver
        ? isCompletedWaiverCurrent(
            row.waiver,
            row.generation === null ? null : Number(row.generation),
            // The roster's instant for this seat (issue #2611): a release that
            // runs out before the trip is one the diver signs again.
            waiverClockInstant({ now, startsAt: row.trip.startsAt, endsAt: row.trip.endsAt }),
          )
        : false,
      participantType: row.booking.participantType,
      signForMinor: door === "sign",
      minorNote: door === "send_link" || door === "physician" ? door : null,
      cancelsWithLead:
        partySeatGoesWithLead(row.booking) &&
        row.booking.tripId === row.leadTripId &&
        !held.has(row.booking.id),
      payable:
        row.booking.claimedAt === null &&
        row.booking.tripId === row.leadTripId &&
        seatListPriceCents(row.trip, row.course, row.booking.participantType) !== null &&
        !isCapturedPaymentStatus(row.paymentStatus) &&
        row.paymentStatus !== "waived",
      claim: claims.get(row.booking.id) ?? null,
    });
  }
  return seats;
}

/**
 * The seat's half of "may the lead sign this release as its parent?":
 *
 * - unclaimed (a claimed seat is its claimant's, who signs from their own link)
 * - declared "Under 18" by the booker, not held on identity (#2125), and still
 *   claimable (before the boat leaves)
 * - **a person this booking made**: no email of their own, or only the lead's.
 *   A seat typed with somebody's real name and email lands on that person's
 *   record when the names match, and the lead must never sign a release for a
 *   diver the shop already knows (security review of H-20261014-parent-signs-minor-release). The email is only
 *   the cheap half: `seatPersonIsThisBookings` reads the record itself, because
 *   a walk-in has no address either and a staff merge can point the seat at one
 * - a record still standing: not removed or erased, the seat's and the lead's
 * - **a guardian is what the page will ask for**: `guardianSignatureRequired`
 *   on the shop's day, the rule `/waivers/[token]` and `completeWaiver` read.
 *   A date of birth on file saying adult would make the page ask for the
 *   diver's own signature, and the lead is never that.
 */
function minorSeatSignable(
  booking: Pick<
    typeof bookings.$inferSelect,
    "claimedAt" | "minorDeclaredAt" | "identityUnconfirmedAt"
  >,
  person: Pick<typeof people.$inferSelect, "email" | "dateOfBirth" | "deletedAt" | "anonymizedAt">,
  context: { leadEmail: string | null; timezone: string; now: Date; claimable: boolean },
): boolean {
  const ownEmail = person.email?.trim().toLowerCase() || null;
  const leadEmail = context.leadEmail?.trim().toLowerCase() || null;
  return (
    context.claimable &&
    booking.claimedAt === null &&
    booking.minorDeclaredAt !== null &&
    booking.identityUnconfirmedAt === null &&
    person.deletedAt === null &&
    person.anonymizedAt === null &&
    (ownEmail === null || ownEmail === leadEmail) &&
    guardianSignatureRequired(person.dateOfBirth, signingDate(context.now, context.timezone), true)
  );
}

/** The lead's own email and the shop's zone: what `minorSeatSignable` measures against. */
async function leadSigningContext(
  db: AppDb,
  shopId: string,
  leadBookingId: string,
): Promise<{ leadEmail: string | null; timezone: string } | null> {
  const [row] = await db
    .select({ email: people.email, timezone: shops.timezone })
    .from(bookings)
    .innerJoin(
      people,
      and(eq(people.id, bookings.personId), isNull(people.deletedAt), isNull(people.anonymizedAt)),
    )
    .innerJoin(shops, eq(shops.id, bookings.shopId))
    .where(and(eq(bookings.id, leadBookingId), eq(bookings.shopId, shopId)))
    .limit(1);
  return row ? { leadEmail: row.email, timezone: row.timezone } : null;
}

/**
 * Whether the seat's person is one this booking made, read from the record:
 * stamped at creation with this booking (`people.created_by_booking_id`,
 * issue #2665), no other booking under any status, and no release filed
 * anywhere but this seat. A name-only seat always inserts a fresh person
 * stamped with its booking, so this holds for every seat the door is meant
 * for; a diver the shop knew before (a walk-in with no address, a record a
 * staff merge pointed the seat at) has history or another stamp, and the lead
 * never signs for them (security review F2 of H-20261014-parent-signs-minor-release). A merge keeps the
 * survivor's stamp, so an imported record with no history never matches.
 */
async function seatPersonIsThisBookings(
  db: AppDb,
  shopId: string,
  booking: Pick<typeof bookings.$inferSelect, "id" | "personId">,
): Promise<boolean> {
  const [stamped] = await db
    .select({ id: people.id })
    .from(people)
    .where(
      and(
        eq(people.id, booking.personId),
        eq(people.shopId, shopId),
        eq(people.createdByBookingId, booking.id),
        livePerson(),
      ),
    )
    .limit(1);
  if (!stamped) return false;
  const [otherBooking] = await db
    .select({ id: bookings.id })
    .from(bookings)
    .where(
      and(
        eq(bookings.shopId, shopId),
        eq(bookings.personId, booking.personId),
        ne(bookings.id, booking.id),
      ),
    )
    .limit(1);
  if (otherBooking) return false;
  const [otherRelease] = await db
    .select({ id: waiverRecords.id })
    .from(waiverRecords)
    .where(
      and(
        eq(waiverRecords.shopId, shopId),
        eq(waiverRecords.personId, booking.personId),
        or(isNull(waiverRecords.bookingId), ne(waiverRecords.bookingId, booking.id)),
      ),
    )
    .limit(1);
  return !otherRelease;
}

/** The release blockers a parent's signature answers; anything else is not theirs to fix. */
const PARENT_SIGNABLE_BLOCKERS = new Set([
  "waiver_not_sent",
  "waiver_pending",
  "waiver_expired",
  "guardian_signature_missing",
]);

/**
 * **What the lead's panel and the seat's claim page may say about a minor
 * seat's release**, one answer for both and for `openMinorSeatWaiver`:
 *
 * - `sign`: the parent's door (`minorSeatSignable`, `seatPersonIsThisBookings`)
 *   and a release still owed by readiness's own rule
 * - `physician`: the parent's door, but the child's medical referred them,
 *   which the parent's signature does not answer (it blocks, and must)
 * - `send_link`: a release is owed and the parent's door refuses, so the
 *   seat's own link, with a parent or guardian beside them, is the path
 * - null: nothing to say (not a minor seat, claimed, held, past claiming, or
 *   nothing owed)
 */
async function minorSeatDoor(
  db: AppDb,
  shopId: string,
  lead: { leadEmail: string | null; timezone: string } | null,
  row: {
    booking: Pick<
      typeof bookings.$inferSelect,
      "id" | "personId" | "claimedAt" | "minorDeclaredAt" | "identityUnconfirmedAt"
    >;
    person: Pick<
      typeof people.$inferSelect,
      "email" | "dateOfBirth" | "deletedAt" | "anonymizedAt"
    >;
  },
  context: { now: Date; claimable: boolean },
): Promise<"sign" | "send_link" | "physician" | null> {
  const { booking, person } = row;
  if (
    !context.claimable ||
    booking.claimedAt !== null ||
    booking.minorDeclaredAt === null ||
    booking.identityUnconfirmedAt !== null
  ) {
    return null;
  }
  const readiness = await getBookingReadiness(db, shopId, booking.id);
  const codes = new Set<string>(readiness?.blockers.map((blocker) => blocker.code) ?? []);
  const owed = [...PARENT_SIGNABLE_BLOCKERS].some((code) => codes.has(code));
  const parentsDoor =
    lead !== null &&
    minorSeatSignable(booking, person, { ...lead, ...context }) &&
    (await seatPersonIsThisBookings(db, shopId, booking));
  if (parentsDoor && owed) return "sign";
  if (parentsDoor && codes.has("medical_review")) return "physician";
  return owed ? "send_link" : null;
}

/**
 * **A parent signs a child's release from their own page** (H-20261014-parent-signs-minor-release, ADR
 * 20261014-parent-signs-minor-release). The lead's verified `readiness`
 * capability is the authority, as it is for the claim links this panel hands
 * out; the seat must be one this lead booked, in this shop, and one the panel
 * would offer (`minorSeatSignable` and a waiver still owed), all re-read here
 * rather than trusted from the form.
 *
 * Opens the seat's own booking-scoped release: the live link when there is
 * one (ADR 20260820-waiver-links-are-reused-not-reissued), a fresh one when
 * not. That page asks for the guardian's card beside the diver's signature,
 * because the seat is declared a minor, so the parent signs as the guardian
 * on their own device. Nothing about the seat changes hands: it stays the
 * lead's, and a later claim supersedes the release as any claim does.
 */
export async function openMinorSeatWaiver(
  db: AppDb,
  input: { shopId: string; leadBookingId: string; seatBookingId: string; now?: Date },
): Promise<{ ok: true; token: string } | { ok: false }> {
  const now = input.now ?? nowDate();
  const [row] = await db
    .select({ booking: bookings, trip: trips, person: people })
    .from(bookings)
    .innerJoin(
      trips,
      and(eq(trips.id, bookings.tripId), eq(trips.shopId, input.shopId), liveTrip()),
    )
    .innerJoin(
      people,
      and(
        eq(people.id, bookings.personId),
        eq(people.shopId, input.shopId),
        isNull(people.deletedAt),
        isNull(people.anonymizedAt),
      ),
    )
    .where(
      and(
        eq(bookings.id, input.seatBookingId),
        eq(bookings.shopId, input.shopId),
        eq(bookings.partyLeadBookingId, input.leadBookingId),
        ne(bookings.status, "cancelled"),
      ),
    )
    .limit(1);
  if (!row) return { ok: false };
  const lead = await leadSigningContext(db, input.shopId, input.leadBookingId);
  if (!lead) return { ok: false };
  const claimable = claimableNow(row.booking, row.trip, now);
  if ((await minorSeatDoor(db, input.shopId, lead, row, { now, claimable })) !== "sign") {
    return { ok: false };
  }
  const issued = await issueWaiverRequest(db, {
    shopId: input.shopId,
    bookingId: row.booking.id,
    now,
  });
  return issued.ok ? { ok: true, token: issued.token } : { ok: false };
}

/**
 * **Back to the parent's own page after a child's release** (dive-domain
 * review F6 of layer r4-1). `signMinorWaiverAction` hands the lead's own
 * readiness token to the waiver page in a cookie scoped to that one waiver
 * link; once it is signed, this returns the token only when it is a live
 * readiness link for the seat's own party lead, in this shop. Anything else
 * is null and the signer lands where every signer does. Nothing is minted:
 * whoever holds the cookie already held the lead's link.
 */
export async function partyLeadReturnToken(
  db: AppDb,
  input: { shopId: string; seatBookingId: string; leadToken: string },
): Promise<string | null> {
  const capability = await verifyBookingCapability(db, {
    token: input.leadToken,
    purpose: "readiness",
  });
  if (!capability || capability.shopId !== input.shopId) return null;
  const [seat] = await db
    .select({ partyLeadBookingId: bookings.partyLeadBookingId })
    .from(bookings)
    .where(and(eq(bookings.id, input.seatBookingId), eq(bookings.shopId, input.shopId)))
    .limit(1);
  return seat?.partyLeadBookingId === capability.bookingId ? input.leadToken : null;
}

/**
 * **The party seats still booked after the lead's own cancel** (batch 6 item
 * 10): what the lead's cancelled page names as staying. Read from the seats
 * themselves, never the URL, and only seats this lead booked in this shop on
 * the lead's own departure.
 * Ordered as `issuePartySeatClaims` orders them.
 */
export async function partySeatsKeptAfterLeadCancel(
  db: AppDb,
  input: { shopId: string; leadBookingId: string },
): Promise<string[]> {
  // The page says these keep their seats *on the lead's trip*, so a seat moved
  // to another departure is not one of them (`cancelUnclaimedPartySeats` is
  // scoped the same way).
  const [lead] = await db
    .select({ tripId: bookings.tripId })
    .from(bookings)
    .where(and(eq(bookings.id, input.leadBookingId), eq(bookings.shopId, input.shopId)))
    .limit(1);
  if (!lead) return [];
  const rows = await db
    .select({
      fullName: people.fullName,
      identityUnconfirmedAt: bookings.identityUnconfirmedAt,
      identityBookedAs: bookings.identityBookedAs,
    })
    .from(bookings)
    .innerJoin(people, eq(people.id, bookings.personId))
    .where(
      and(
        eq(bookings.shopId, input.shopId),
        eq(bookings.partyLeadBookingId, input.leadBookingId),
        eq(bookings.tripId, lead.tripId),
        ne(bookings.status, "cancelled"),
      ),
    )
    .orderBy(asc(bookings.createdAt), asc(people.fullName), asc(bookings.id));
  return rows.map((row) => seatName(row.fullName, row));
}
