import { and, count, eq, inArray, isNotNull, isNull, ne } from "drizzle-orm";
import { checkMinimumAge } from "@/lib/age";
import { calendarDateInTimezone } from "@/lib/calendar-date";
import { nowDate } from "@/lib/clock";
import { entryLevelCourseCapacity } from "@/lib/course-ratios";
import { personNamesMatch } from "@/lib/person-name";
import { hasVerifiedCertificationAtLeast } from "@/lib/readiness";
import { revokeBookingCapabilities } from "./booking-capabilities";
import type { AppDb } from "./client";
import { getBookingPayment } from "./payments";
import { findOrCreatePerson } from "./people";
import {
  bookingCheckoutBookings,
  bookingCheckouts,
  bookings,
  certifications,
  courses,
  people,
  personRoles,
  shops,
  tripAssignments,
  trips,
} from "./schema";

/**
 * A booking names its diver one of two ways: a walk-in supplies a name (and,
 * usually, an email — deduped/created), or a returning diver is picked by
 * identity so the one person row — with its certs, waivers, rental fit, and
 * history — is reused instead of re-typed. "Enter once, reuse everywhere."
 *
 * Email is optional on the name path: a counter walk-in the crew can't wait
 * to ask for an address gets a fresh person row with no email on file, the
 * same as `createDiver` (src/db/divers.ts) already allows outside a booking —
 * `people.email` is nullable precisely for this (schema.ts). There is
 * nothing to dedup against without one, so a later booking with the same name
 * and still no email creates its own row rather than guessing an identity.
 */
export type BookingPerson =
  | { personId: string }
  | { fullName: string; email?: string; phone?: string };

export type BookingRequest = {
  shopId: string;
  tripId: string;
  /**
   * Who is making this booking. `"public"` is the anonymous schedule form,
   * where the submitter supplies an email but never proves it is theirs — the
   * same uncertainty `identityUnconfirmedAt` exists for (H-13).
   *
   * The minimum-age gate is skipped for `"public"` on purpose. Refusing there
   * would answer "is the holder of this address under N?" to anyone who can
   * guess an address, and the course minimums (10/12/15/18) let a few probes
   * bracket a real child's age — a disclosure about a minor, to an
   * unauthenticated caller. It is also unsound: the gate would judge the
   * submitter by a person record they may have no relationship to. Staff
   * bookings keep the gate; the readiness blocker catches an under-age seat
   * whichever door it came through.
   *
   * Required, not optional: an omission here is a silently re-opened oracle,
   * and there is no default that is right for both callers. Making it a type
   * error costs three call sites once.
   */
  actor: "staff" | "public";
  /** Optional, non-sensitive interest or pace preference for crew buddy grouping. */
  groupPreference?: string;
} & BookingPerson;

export type BookingOutcome =
  | { ok: true; bookingId: string; personId: string; personName: string }
  | {
      ok: false;
      reason:
        | "trip_unavailable"
        | "trip_full"
        | "already_booked"
        | "course_unstaffed"
        | "course_prerequisite"
        | "course_ratio_full"
        | "course_min_age"
        | "person_not_found";
    };

export type BookingPartyOutcome =
  | { ok: true; bookings: Array<{ bookingId: string; personId: string; personName: string }> }
  | (Exclude<BookingOutcome, { ok: true }> & {
      /**
       * Which request in the submitted array the rollback happened on
       * (task 25) — a caller can then point a per-member error at the right
       * fieldset instead of a generic top-of-form banner that reads as if
       * the first diver were the problem when it was a later one. Present
       * for every failure; a caller only has field positions to highlight
       * for reasons that are actually about one member (`already_booked`).
       */
      failedIndex: number;
    });

/**
 * The whole "grab a spot" operation in one transaction: trip must be
 * scheduled and in the future, capacity re-checked inside the transaction
 * (the UI's spots-left pill is advisory, this is the enforcement), the diver
 * resolved by identity (a returning diver picked from the shop) or deduped by
 * email (a walk-in), and a cancelled booking re-activates instead of violating
 * the one-booking-per-person constraint.
 */
export async function createBooking(db: AppDb, req: BookingRequest): Promise<BookingOutcome> {
  return db.transaction((tx) => createBookingRecord(tx as unknown as AppDb, req));
}

/** Books every named diver as one all-or-nothing party reservation. */
export async function createBookingParty(
  db: AppDb,
  requests: BookingRequest[],
): Promise<BookingPartyOutcome> {
  if (requests.length === 0) return { ok: false, reason: "trip_unavailable", failedIndex: -1 };
  return db
    .transaction(async (tx) => {
      const created: Array<{ bookingId: string; personId: string; personName: string }> = [];
      for (const [index, request] of requests.entries()) {
        const outcome = await createBookingRecord(tx as unknown as AppDb, request);
        if (!outcome.ok) throw new PartyBookingError(outcome.reason, index);
        created.push(outcome);
      }
      return { ok: true as const, bookings: created };
    })
    .catch((error: unknown) => {
      if (error instanceof PartyBookingError) {
        return { ok: false as const, reason: error.reason, failedIndex: error.index };
      }
      throw error;
    });
}

class PartyBookingError extends Error {
  constructor(
    public readonly reason: Exclude<BookingOutcome, { ok: true }>["reason"],
    public readonly index: number,
  ) {
    super(reason);
  }
}

async function createBookingRecord(db: AppDb, req: BookingRequest): Promise<BookingOutcome> {
  const tx = db;
  // FOR UPDATE serializes concurrent bookings on the same trip: under READ
  // COMMITTED two transactions could otherwise both read `booked = capacity-1`
  // and both insert. PGlite is single-connection so tests can't exhibit the
  // race — the lock is for production Postgres.
  const [trip] = await tx
    .select()
    .from(trips)
    .where(and(eq(trips.id, req.tripId), eq(trips.shopId, req.shopId)))
    .limit(1)
    .for("update");
  if (trip?.status !== "scheduled" || trip.conditionsHold || trip.startsAt <= nowDate()) {
    return { ok: false, reason: "trip_unavailable" };
  }

  const [course] = trip.courseId
    ? await tx
        .select()
        .from(courses)
        .where(and(eq(courses.id, trip.courseId), eq(courses.shopId, req.shopId)))
        .limit(1)
    : [];
  // A course session is unsafe to market as open until an instructor is on
  // the session. This is a booking gate, not a cosmetic staff warning.
  let entryLevelSeatCap: number | null = null;
  if (course) {
    const crew = await tx
      .select({ personId: tripAssignments.personId, role: personRoles.role })
      .from(tripAssignments)
      .innerJoin(personRoles, eq(personRoles.personId, tripAssignments.personId))
      .where(
        and(
          eq(tripAssignments.tripId, trip.id),
          inArray(personRoles.role, ["instructor", "divemaster"]),
        ),
      );
    const instructorIds = new Set(
      crew.filter((row) => row.role === "instructor").map((row) => row.personId),
    );
    if (instructorIds.size === 0) return { ok: false, reason: "course_unstaffed" };
    // Entry-level (no-card-required) sessions carry PADI's published in-water
    // ratio — see src/lib/course-ratios.ts for the sourcing. Scoped to PADI
    // specifically: the sourced ratio is a PADI figure, and `courses.agency`
    // is shop-set free text (an SSI, NAUI, etc. course is a real, unremarkable
    // row) — applying a PADI number to another agency's course would be a
    // wrong-but-confident safety control, so those fall back to the trip's
    // own stated capacity only, same as before this gate existed. Continuing-ed
    // courses (minimumCertificationLevel set) already gate on a verified card
    // and PADI does not publish a comparable numeric ratio for them.
    if (course.agency === "padi" && !course.minimumCertificationLevel) {
      // A person holding both roles is the instructor, not their own assistant.
      const assistantCount = new Set(
        crew
          .filter((row) => row.role === "divemaster" && !instructorIds.has(row.personId))
          .map((row) => row.personId),
      ).size;
      entryLevelSeatCap = entryLevelCourseCapacity(instructorIds.size, assistantCount);
    }
  }

  // Resolve the diver. A returning diver picked by identity reuses that exact
  // person row (the whole point of "enter once"); a walk-in is looked up by
  // email so a re-typed regular still collapses onto their record. A
  // soft-deleted person's email is free (matching createDiver): a rebooking
  // diver whose record staff removed gets a fresh person row, not a booking
  // attached to a record that's invisible on the roster. Any new walk-in row is
  // only written after the capacity gate passes (`pendingInsert`).
  let person: typeof people.$inferSelect | undefined;
  let pendingInsert: { fullName: string; email: string | null; phone?: string } | null = null;
  // Set when this booking reused an existing person by email but the submitted
  // name did not match — a possible shared-inbox / different-human signal that
  // must not silently inherit the matched person's evidence (H-13). Only the
  // by-email path can raise it; the identity path re-books a diver picked from
  // their own record and submits no name to disagree with, and a fresh
  // no-email row has no prior identity to disagree with either.
  let identityUnconfirmed = false;
  if ("personId" in req) {
    [person] = await tx
      .select()
      .from(people)
      .where(
        and(eq(people.id, req.personId), eq(people.shopId, req.shopId), isNull(people.deletedAt)),
      )
      .limit(1);
    // A copied URL or a since-removed diver must not book into this tenant.
    if (!person) return { ok: false, reason: "person_not_found" };
  } else {
    const email = req.email?.trim().toLowerCase() || null;
    if (email) {
      [person] = await tx
        .select()
        .from(people)
        .where(
          and(eq(people.shopId, req.shopId), eq(people.email, email), isNull(people.deletedAt)),
        )
        .limit(1);
      if (person) {
        // Reuse-by-email before the capacity gate: flag a name that doesn't match
        // the person already on file for this address.
        identityUnconfirmed = !personNamesMatch(person.fullName, req.fullName);
      } else {
        pendingInsert = { fullName: req.fullName.trim(), email, phone: req.phone };
      }
    } else {
      // No email to dedup against — matching createDiver (src/db/divers.ts),
      // this always gets a fresh person row rather than guessing an identity.
      pendingInsert = { fullName: req.fullName.trim(), email: null, phone: req.phone };
    }
  }

  // Both course gates below read the shop's local calendar, so take its
  // timezone once for whichever of them applies.
  if (course?.minimumCertificationLevel || course?.minimumAge) {
    const [shop] = await tx
      .select({ timezone: shops.timezone })
      .from(shops)
      .where(eq(shops.id, req.shopId))
      .limit(1);
    if (!shop) throw new Error(`createBookingRecord: shop ${req.shopId} not found`);

    // Existing-card courses deliberately fail closed at enrollment. Staff can
    // capture and verify a card, then the same public form will admit the
    // diver; we never reserve capacity based on a self-assertion.
    if (course.minimumCertificationLevel) {
      if (!person) return { ok: false, reason: "course_prerequisite" };
      const cardRows = await tx
        .select()
        .from(certifications)
        .where(
          and(
            eq(certifications.shopId, req.shopId),
            eq(certifications.personId, person.id),
            isNull(certifications.deletedAt),
          ),
        );
      const todayLocal = calendarDateInTimezone(nowDate(), shop.timezone);
      if (
        !hasVerifiedCertificationAtLeast(cardRows, course.minimumCertificationLevel, todayLocal)
      ) {
        return { ok: false, reason: "course_prerequisite" };
      }
    }

    // Minimum age, measured on the day the course actually runs (H-08). Unlike
    // the card gate this **fails open**: a diver with no date of birth on file
    // books exactly as before, because nothing collects one at booking and
    // failing closed would lock out every diver already on the books. Age is
    // still verified at the dock; this only catches the case the shop already
    // has the data to catch. A walk-in with no `person` row yet is likewise
    // unknown, and passes.
    //
    // Staff only — see `BookingRequest.actor` for why the anonymous form must
    // not refuse on someone else's date of birth. An under-age seat booked
    // through the public form surfaces as a readiness blocker instead.
    if (req.actor !== "public" && course.minimumAge && person?.dateOfBirth) {
      const courseDate = calendarDateInTimezone(trip.startsAt, shop.timezone);
      if (checkMinimumAge(person.dateOfBirth, course.minimumAge, courseDate).status === "under") {
        return { ok: false, reason: "course_min_age" };
      }
    }
  }

  const [row] = await tx
    .select({ booked: count(bookings.id) })
    .from(bookings)
    .where(and(eq(bookings.tripId, trip.id), ne(bookings.status, "cancelled")));
  const booked = row?.booked ?? 0;
  if (booked >= trip.capacity) {
    return { ok: false, reason: "trip_full" };
  }
  if (entryLevelSeatCap !== null && booked >= entryLevelSeatCap) {
    return { ok: false, reason: "course_ratio_full" };
  }

  if (!person && pendingInsert) {
    if (pendingInsert.email) {
      // Under concurrency this can still resolve to an existing row (a racing
      // insert won); `nameMatches` reflects the row that actually landed, so a
      // simultaneous shared-inbox booking is flagged the same as a serial one.
      const resolved = await findOrCreatePerson(tx, {
        shopId: req.shopId,
        fullName: pendingInsert.fullName,
        email: pendingInsert.email,
        phone: pendingInsert.phone,
      });
      person = resolved.person;
      identityUnconfirmed = !resolved.nameMatches;
    } else {
      // No email means no `people_shop_email_unique` row to race for (that
      // index is partial — null emails never collide, schema.ts) — a plain
      // insert, same shape as findOrCreatePerson's own insert branch.
      const [inserted] = await tx
        .insert(people)
        .values({
          shopId: req.shopId,
          fullName: pendingInsert.fullName,
          email: null,
          phone: pendingInsert.phone,
        })
        .returning();
      if (!inserted) throw new Error("createBookingRecord: person insert returned no row");
      await tx.insert(personRoles).values({ personId: inserted.id, role: "diver" });
      person = inserted;
    }
  }
  // Only reachable on the identity path if the row vanished mid-transaction;
  // the walk-in path always has a pendingInsert. Guards the non-null uses below.
  if (!person) return { ok: false, reason: "person_not_found" };

  const [existing] = await tx
    .select()
    .from(bookings)
    .where(and(eq(bookings.tripId, trip.id), eq(bookings.personId, person.id)))
    .limit(1);
  if (existing) {
    if (existing.status !== "cancelled") return { ok: false, reason: "already_booked" };
    await tx
      .update(bookings)
      .set({
        status: "booked",
        conditionsBriefedAt: trip.conditionsUpdatedAt,
        groupPreference: req.groupPreference?.trim() || null,
        // Re-booking this seat re-evaluates identity: a matching name now clears
        // any stale flag, a mismatch (re)raises it.
        identityUnconfirmedAt: identityUnconfirmed ? nowDate() : null,
      })
      .where(eq(bookings.id, existing.id));
    return { ok: true, bookingId: existing.id, personId: person.id, personName: person.fullName };
  }

  const [created] = await tx
    .insert(bookings)
    .values({
      shopId: req.shopId,
      tripId: trip.id,
      personId: person.id,
      conditionsBriefedAt: trip.conditionsUpdatedAt,
      groupPreference: req.groupPreference?.trim() || null,
      identityUnconfirmedAt: identityUnconfirmed ? nowDate() : null,
    })
    .returning();
  if (!created) throw new Error("createBooking: booking insert returned no row");
  return { ok: true, bookingId: created.id, personId: person.id, personName: person.fullName };
}

/**
 * A booking on a specific trip, with its person — for the confirmation
 * panel, which must render from the database, never from URL params.
 */
export async function getBookingForTrip(db: AppDb, tripId: string, bookingId: string) {
  const [row] = await db
    .select({ booking: bookings, person: people })
    .from(bookings)
    .innerJoin(people, eq(people.id, bookings.personId))
    .where(
      and(
        eq(bookings.id, bookingId),
        eq(bookings.tripId, tripId),
        ne(bookings.status, "cancelled"),
      ),
    )
    .limit(1);
  return row ?? null;
}

export type RestoreBookingOutcome = "restored" | "already_active" | "trip_full" | "not_found";

/**
 * Undo of a roster removal. Only a currently-cancelled booking is restorable,
 * and only if the seat is still free — a waitlisted diver may have taken it
 * between the remove and the undo, and silently exceeding capacity would put
 * more divers on the manifest than the boat holds.
 */
export async function restoreBooking(
  db: AppDb,
  shopId: string,
  bookingId: string,
): Promise<RestoreBookingOutcome> {
  return db.transaction(async (tx) => {
    const [booking] = await tx
      .select()
      .from(bookings)
      .where(and(eq(bookings.id, bookingId), eq(bookings.shopId, shopId)))
      .limit(1);
    if (!booking) return "not_found";
    // A double-tapped Undo (or a checked-in/no-show booking) is already on
    // the roster — restoring would clobber that state, not undo a removal.
    if (booking.status !== "cancelled") return "already_active";

    // Same trip-row lock as createBooking, so the capacity re-check can't
    // race a concurrent booking into an overfull boat.
    const [trip] = await tx
      .select()
      .from(trips)
      .where(eq(trips.id, booking.tripId))
      .limit(1)
      .for("update");
    if (!trip) return "not_found";
    const [row] = await tx
      .select({ booked: count(bookings.id) })
      .from(bookings)
      .where(and(eq(bookings.tripId, trip.id), ne(bookings.status, "cancelled")));
    if ((row?.booked ?? 0) >= trip.capacity) return "trip_full";

    await tx
      .update(bookings)
      .set({ status: "booked" })
      .where(and(eq(bookings.id, bookingId), eq(bookings.status, "cancelled")));
    return "restored";
  });
}

export async function cancelBooking(db: AppDb, shopId: string, bookingId: string) {
  return db.transaction(async (tx) => {
    const [booking] = await tx
      .update(bookings)
      .set({ status: "cancelled" })
      .where(and(eq(bookings.id, bookingId), eq(bookings.shopId, shopId)))
      .returning();
    if (!booking) return null;
    // Belt-and-suspenders: verifyBookingCapability already fails closed on a
    // cancelled booking, but revoking outright keeps the capability table's
    // own audit trail honest and stops relying solely on that join. Both
    // writes share this transaction so a revoke failure rolls the status
    // change back too, instead of leaving a cancelled booking whose
    // capabilities are still live.
    await revokeBookingCapabilities(tx as unknown as AppDb, { shopId, bookingId });
    return booking;
  });
}

export type SelfCancelResult =
  | { ok: true }
  | {
      ok: false;
      /** already_cancelled / not_cancellable / trip_departed are distinct so a
       * caller can pick honest copy, but they must never be distinguished in
       * a *response* to the diver — same fail-closed-uniformly rule as
       * verifyBookingCapability (a booking-state oracle is still a leak). */
      reason: "not_found" | "already_cancelled" | "not_cancellable" | "trip_departed";
    };

/**
 * Cancel a diver's own booking from their readiness link. Thin, deliberately
 * stricter wrapper around `cancelBooking` for a self-service caller — the
 * staff roster path trusts a human looking at a row and can flip any status
 * straight to cancelled, but a diver acting through a bearer token gets its
 * own pre-checks `cancelBooking` itself doesn't enforce:
 *
 * - Only a plain `booked` seat is self-cancellable — not one already
 *   `cancelled`, and not `checked_in`/`no_show`, which are day-of states a
 *   diver clicking a pre-trip link should never be able to flip back.
 * - The trip must not have already started; cancelling a seat on a boat
 *   that's already left has no honest meaning (mirrors the same
 *   already-departed check the checkout-recovery scan makes, docs ADR
 *   20260726-abandoned-checkout-recovery).
 *
 * Refunding is the caller's job, same as the staff path (docs H-07): this
 * only frees the seat, so a refund failure can never block the cancellation.
 */
export async function selfCancelBooking(
  db: AppDb,
  input: { shopId: string; bookingId: string; now?: Date },
): Promise<SelfCancelResult> {
  const now = input.now ?? nowDate();
  return db.transaction(async (tx) => {
    // Locks the row for the rest of this transaction — closes the gap a bare
    // read-then-write would leave open for a concurrent roll-call action to
    // flip this same seat to checked_in/no_show between the check below and
    // the write, which the unconditional update this replaced could then
    // blindly stomp back to cancelled (security review finding on this ADR).
    const [row] = await tx
      .select({ status: bookings.status, tripId: bookings.tripId })
      .from(bookings)
      .where(and(eq(bookings.id, input.bookingId), eq(bookings.shopId, input.shopId)))
      .limit(1)
      .for("update");
    if (!row) return { ok: false, reason: "not_found" };
    if (row.status === "cancelled") return { ok: false, reason: "already_cancelled" };
    if (row.status !== "booked") return { ok: false, reason: "not_cancellable" };

    const [trip] = await tx
      .select({ startsAt: trips.startsAt })
      .from(trips)
      .where(eq(trips.id, row.tripId))
      .limit(1);
    if (trip && trip.startsAt <= now) return { ok: false, reason: "trip_departed" };

    const [cancelled] = await tx
      .update(bookings)
      .set({ status: "cancelled" })
      .where(
        and(
          eq(bookings.id, input.bookingId),
          eq(bookings.shopId, input.shopId),
          eq(bookings.status, "booked"),
        ),
      )
      .returning({ id: bookings.id });
    if (!cancelled) return { ok: false, reason: "not_cancellable" };
    // Same belt-and-suspenders revoke `cancelBooking` does for the staff path.
    await revokeBookingCapabilities(tx as unknown as AppDb, {
      shopId: input.shopId,
      bookingId: input.bookingId,
    });
    return { ok: true };
  });
}

export type RescheduleResult =
  | { ok: true; newBookingId: string }
  | {
      ok: false;
      reason:
        | "not_found"
        | "already_cancelled"
        | "not_cancellable"
        | "trip_departed"
        | "already_paid"
        | "same_trip"
        | "identity_unconfirmed"
        | "destination_already_paid"
        | Exclude<BookingOutcome, { ok: true }>["reason"];
    };

/**
 * Move a diver's own booking to a different trip, atomically: the new seat
 * is booked *before* the old one is freed, in one transaction, so a diver
 * can never end up holding neither (the failure mode a cancel-then-rebook
 * flow risks — the destination trip could fill, or stop qualifying, in the
 * gap between the two steps). If the new trip can't take them — full,
 * unstaffed, wrong prerequisites, already departed — the old booking is
 * left exactly as it was; nothing is lost on a rejected reschedule.
 *
 * Scoped to a booking with no captured payment. A paid booking's money has
 * to move with it (a full or partial refund, a possible new charge if the
 * destination trip prices differently), which is a staff-mediated decision
 * this slice doesn't automate — a paid diver cancels (auto-refunded inside
 * the shop's stated window, same as today) and books the new trip fresh
 * (docs ADR 20260727-diver-self-service-cancel).
 *
 * Reuses `createBookingRecord` for the destination trip — the same
 * capacity/course/ratio gates a fresh public booking gets, keyed to the
 * same person already on the booking being moved (never re-typed, so there
 * is no email/identity ambiguity to resolve).
 *
 * Refuses a booking still flagged `identity_unconfirmed` (H-13): that flag
 * is a deliberate, staff-only-clearable readiness blocker for a public
 * booking whose submitted name didn't match the email's existing person
 * record, and `createBookingRecord`'s known-`personId` path (the one this
 * function always uses) never sets it on the new booking — silently
 * dropping a flag only a human was supposed to be able to clear. Carries
 * `wantsNitrox` forward onto the new booking for the same reason a diver's
 * gas request shouldn't silently reset just because they moved trips.
 */
export async function rescheduleBooking(
  db: AppDb,
  input: { shopId: string; bookingId: string; newTripId: string; now?: Date },
): Promise<RescheduleResult> {
  const now = input.now ?? nowDate();
  // `createBookingRecord` below can already have written the destination
  // reactivation by the time the `destination_already_paid` gate refuses it
  // — a plain `return { ok: false, ... }` from inside `db.transaction` only
  // stops further writes, it does NOT undo ones already made, so that
  // refusal would otherwise still commit the reactivation it's supposed to
  // be blocking (Codex finding, caught by this function's own regression
  // test). `tx.rollback()` + this outer variable is the established pattern
  // for a refusal that must undo prior writes in the same transaction (see
  // `inviteStaffMember`, docs ADR 20260726-staff-invite-accounts).
  let refusal: RescheduleResult | null = null;
  try {
    return await db.transaction(async (tx) => {
      // Locks the row for the rest of this transaction. Without this, two
      // concurrent reschedules of the same booking to two *different* trips
      // could both read status="booked" before either writes, both book their
      // own (uncontended) destination trip, and both then unconditionally
      // cancel the same source booking — leaving the diver double-booked on
      // two trips off one original seat (security review finding on this ADR).
      // Holding this lock through the whole transaction serializes that: the
      // second caller blocks here until the first commits, then sees the row
      // already cancelled and refuses cleanly.
      const [row] = await tx
        .select({
          status: bookings.status,
          tripId: bookings.tripId,
          personId: bookings.personId,
          wantsNitrox: bookings.wantsNitrox,
          identityUnconfirmedAt: bookings.identityUnconfirmedAt,
        })
        .from(bookings)
        .where(and(eq(bookings.id, input.bookingId), eq(bookings.shopId, input.shopId)))
        .limit(1)
        .for("update");
      if (!row) return { ok: false, reason: "not_found" };
      if (row.status === "cancelled") return { ok: false, reason: "already_cancelled" };
      if (row.status !== "booked") return { ok: false, reason: "not_cancellable" };
      if (row.tripId === input.newTripId) return { ok: false, reason: "same_trip" };
      if (row.identityUnconfirmedAt) return { ok: false, reason: "identity_unconfirmed" };

      const [oldTrip] = await tx
        .select({ startsAt: trips.startsAt })
        .from(trips)
        .where(eq(trips.id, row.tripId))
        .limit(1);
      if (oldTrip && oldTrip.startsAt <= now) return { ok: false, reason: "trip_departed" };

      const payment = await getBookingPayment(tx, input.shopId, input.bookingId);
      // waived is a settled state exactly like paid/deposit_paid — staff decided
      // this diver owes nothing, and rescheduling into a fresh, unpaid booking
      // would silently drop that decision and offer them a card checkout for a
      // trip whose fee was already waived on the seat they're leaving.
      if (
        payment?.status === "paid" ||
        payment?.status === "deposit_paid" ||
        payment?.status === "waived"
      ) {
        return { ok: false, reason: "already_paid" };
      }

      // Book the destination first. Every capacity/course/ratio gate a fresh
      // public booking gets applies identically here, inside the same
      // transaction — a full or newly-unstaffed trip fails this and returns
      // without ever touching the old booking. `actor: "staff"` is deliberate,
      // not a mismatch with the public-facing surface this runs behind: that
      // gate exists to stop an anonymous form from judging a submitter by a
      // person record they may have no relationship to, but `row.personId` here
      // is the token-verified diver's own identity, not a free-typed guess —
      // so the real minimum-age check applies, same as any staff-entered
      // booking.
      const outcome = await createBookingRecord(tx as unknown as AppDb, {
        shopId: input.shopId,
        tripId: input.newTripId,
        personId: row.personId,
        actor: "staff",
      });
      if (!outcome.ok) return outcome;

      // createBookingRecord can reactivate a previously-cancelled row on the
      // destination trip (the diver had, and cancelled, a seat there before) —
      // and reactivation only ever touches `status`/`conditionsBriefedAt`/
      // `identityUnconfirmedAt`, never `booking_payments`. That row's payment
      // can therefore still read paid/deposit_paid/waived/refunded from its
      // earlier life (a no-policy or forfeit cancellation deliberately leaves
      // a payment captured; a within-window cancellation leaves it refunded),
      // which has nothing to do with this move — the diver hasn't paid
      // anything for it. `refunded` matters here too, not just the settled
      // statuses (Codex finding): it's a FINAL_PAYMENT_STATUSES entry, so if
      // this were allowed through and the diver paid again for the
      // reactivated seat, `setBookingPaymentIfNotFinal` would refuse to
      // overwrite the stale "refunded" record — the diver would be charged
      // while the booking still reads refunded and could even be offered
      // payment again. Refuse rather than silently treating a stale
      // settlement as covering the new seat, or clearing a real payment
      // record programmatically; staff can reconcile the specific history if
      // the diver contacts them.
      const destinationPayment = await getBookingPayment(tx, input.shopId, outcome.bookingId);
      if (
        destinationPayment?.status === "paid" ||
        destinationPayment?.status === "deposit_paid" ||
        destinationPayment?.status === "waived" ||
        destinationPayment?.status === "refunded"
      ) {
        refusal = { ok: false, reason: "destination_already_paid" };
        tx.rollback();
      }

      // A reactivated row can also still be linked to a *pending* (never
      // completed, never refused above) Checkout from its earlier life — a
      // diver who started paying, abandoned the tab, then cancelled before
      // it expired. Marking it `expired` here is a *local* decision only —
      // it doesn't reach out to Stripe, so the hosted session itself stays
      // genuinely completable there until Stripe's own (separate, longer)
      // expiry, and an old tab really can still complete it after this point
      // (Codex finding: this comment previously overclaimed otherwise). What
      // actually closes the loophole is `markCheckoutPaidBySessionId`
      // (src/db/checkouts.ts) refusing to process a completion for any
      // checkout whose local status isn't `pending` or already `completed`
      // — so a completion arriving for this now-`expired` row is ignored
      // rather than
      // attributing the old trip/price to the reactivated seat. Retiring it
      // here is still worth doing on its own (keeps it out of future
      // checkout-recovery batches, keeps the data honest), just not
      // sufficient by itself. A no-op for a genuinely fresh booking, which
      // has no prior checkout to find.
      const staleCheckoutLinks = await tx
        .select({ checkoutId: bookingCheckoutBookings.checkoutId })
        .from(bookingCheckoutBookings)
        .innerJoin(bookingCheckouts, eq(bookingCheckouts.id, bookingCheckoutBookings.checkoutId))
        .where(
          and(
            eq(bookingCheckoutBookings.bookingId, outcome.bookingId),
            eq(bookingCheckouts.status, "pending"),
          ),
        );
      if (staleCheckoutLinks.length > 0) {
        await tx
          .update(bookingCheckouts)
          .set({ status: "expired" })
          .where(
            inArray(
              bookingCheckouts.id,
              staleCheckoutLinks.map((l) => l.checkoutId),
            ),
          );
      }

      // Unconditional, not just when true: `createBookingRecord` can reactivate
      // a previously-cancelled row on the destination trip (a diver who once
      // booked, cancelled, and is now moving back onto it), and that stale row
      // may still carry `wantsNitrox: true` from its earlier life. Only writing
      // the true case would leave that stale request in place even though the
      // source booking being moved doesn't want nitrox (Codex finding).
      await tx
        .update(bookings)
        .set({ wantsNitrox: row.wantsNitrox })
        .where(eq(bookings.id, outcome.bookingId));

      const [cancelled] = await tx
        .update(bookings)
        .set({ status: "cancelled" })
        .where(
          and(
            eq(bookings.id, input.bookingId),
            eq(bookings.shopId, input.shopId),
            eq(bookings.status, "booked"),
          ),
        )
        .returning({ id: bookings.id });
      if (!cancelled) return { ok: false, reason: "not_cancellable" };
      await revokeBookingCapabilities(tx as unknown as AppDb, {
        shopId: input.shopId,
        bookingId: input.bookingId,
      });

      return { ok: true, newBookingId: outcome.bookingId };
    });
  } catch (error) {
    if (refusal) return refusal;
    throw error;
  }
}

/**
 * Staff confirm a flagged booking really is the person it was attached to
 * (H-13): clears `identity_unconfirmed_at`, which drops the readiness blocker.
 * Shop-scoped and idempotent — a no-op on an already-clear or unknown booking
 * returns false so the caller can distinguish "confirmed" from "nothing to do".
 * This never *creates* a separate diver; when it is genuinely a different human
 * behind a shared inbox, staff resolve that by booking them under their own
 * email, not by confirming here.
 */
export async function confirmBookingIdentity(db: AppDb, shopId: string, bookingId: string) {
  const [booking] = await db
    .update(bookings)
    .set({ identityUnconfirmedAt: null })
    .where(
      and(
        eq(bookings.id, bookingId),
        eq(bookings.shopId, shopId),
        isNotNull(bookings.identityUnconfirmedAt),
      ),
    )
    .returning({ id: bookings.id });
  return Boolean(booking);
}
