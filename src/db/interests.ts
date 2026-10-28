import { and, asc, count, eq, inArray, isNotNull, isNull, ne, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { createBearerToken, hashBearerToken } from "@/lib/bearer-tokens";
import { courseRatioRefusal } from "@/lib/booking-gates";
import type { CalendarDate } from "@/lib/calendar-date";
import { nowDate } from "@/lib/clock";
import type { CourseInquiryExperience } from "@/lib/course-inquiry";
import type { DateRequestOutcome } from "@/lib/date-requests";
import type { DiveDeclaration } from "@/lib/dive-declaration";
import {
  type CourseTargetInfo,
  filterEligibleLastMinuteRecipients,
  type LastMinuteDepartureBar,
  type LastMinuteListWindow,
  type LastMinuteRecipientReview,
  lastMinuteEntryMatchesTripDate,
  orderLastMinuteRecipients,
  reviewLastMinuteRecipients,
} from "@/lib/interests";
import { rowCanBeReactivated, SEAT_HELD_STATUSES } from "@/lib/no-show";
import { seatRefusal } from "@/lib/participant-types";
import { unionRequirements } from "@/lib/requirement";
import { MAX_PUBLIC_PARTY_SIZE } from "@/lib/trips";
import { toDateInputValue, utcToWallTime } from "@/lib/zoned";
import { courseStudentSeatCap } from "./bookings";
import type { AppDb, DbExecutor } from "./client";
import { findOrCreatePerson } from "./people";
import { getTripRequirements, getTripSiteRequirement } from "./readiness";
import {
  bookings,
  type DiveSpecialty,
  dateRequestOfferBookings,
  type Interest,
  interests,
  interestUnsubscribeTokens,
  type Person,
  people,
  personRoles,
  shops,
  specialtyCertifications,
  trips,
} from "./schema";
import { listCertificationSummaries, recordSelfDeclaredCards } from "./self-declared-cards";
import { livePerson, liveTrip, notRehearsal } from "./trips-live";
import { heldSeatCounts, sellableCapacity } from "./trips-queries";

/**
 * **Who wants in**, the writers and the departure reads (ADR
 * 20261017-one-interest-with-a-scope). An interest reserves nothing: `bookings.ts` never
 * reads or writes this table, "booked" is derived at read time for a departure
 * interest, and only staff seating someone *from* an interest stamps `closed_as`, after
 * the seat commits.
 */

export type DepartureAsk = {
  shopId: string;
  tripId: string;
  fullName: string;
  email: string;
  phone?: string;
  /**
   * What the joiner optionally said they can dive, recorded on the **person**
   * as a self-declared pending card (`recordSelfDeclaredCards`). It is shown to
   * the staffer working this list and never gates the join — a wait list is a
   * set of interests, and refusing one on an unverified claim would be a gate built
   * out of somebody's typing (ADR 20260813-wait-list-is-a-lead-list).
   */
  declaration?: DiveDeclaration;
  /**
   * How many seats the joiner waits for, themselves included (fourth review,
   * item 34). One when absent; held to the public form's own bounds.
   */
  partySize?: number;
};

export type DepartureAskOutcome =
  | { ok: true; interestId: string; personName: string }
  | {
      ok: false;
      reason: "trip_unavailable" | "trip_available" | "already_booked" | "already_waitlisted";
      interestId?: string;
      personName?: string;
    };

/**
 * Adds a diver to a full trip's wait list: a `departure` interest the diver asked
 * for. An interest is not a booking, must never reserve a manifest seat, and does
 * not entitle the diver to the next seat that frees: `askedAt` records when they
 * asked, and staff offer whoever fits the departure (ADR
 * 20260813-wait-list-is-a-lead-list). The copy the diver reads on joining says
 * exactly that.
 *
 * **The booking transaction does not learn about this table** (ADR
 * 20261017-one-interest-with-a-scope, R1): the trip-row lock below and the counts
 * it reads are the booking door's own, so "join the wait list" and "book" cannot
 * disagree about one boat.
 */
export async function askForDeparture(db: AppDb, req: DepartureAsk): Promise<DepartureAskOutcome> {
  const email = req.email.trim().toLowerCase();
  const fullName = req.fullName.trim();
  const askedParty = Math.min(
    MAX_PUBLIC_PARTY_SIZE,
    Math.max(1, Math.trunc(req.partySize ?? 1) || 1),
  );

  return db.transaction(async (tx): Promise<DepartureAskOutcome> => {
    const locked = await lockFullDeparture(tx, req.shopId, req.tripId, askedParty);
    if (!locked.ok) return locked;
    const { trip, partySize } = locked;

    const { person, nameMatches } = await findOrCreatePerson(tx, {
      shopId: req.shopId,
      fullName,
      email,
      phone: req.phone,
    });

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

    // After the refusals, before the entry: a diver who is told "you already
    // have a seat" is not joining a list, and a declaration recorded off a
    // submission the product turned away would be data collected from a
    // conversation that did not happen. A repeat joiner (`already_waitlisted`
    // below) *does* land here, which is right — re-submitting is how they
    // update what they said.
    //
    // Gated on `nameMatches` for the same reason the last-minute list is: this
    // form is unauthenticated, and an email that matches an existing diver
    // under a different name may be a second human (H-13). Certification data
    // is a fact about a body, and writing it onto a record that might not be
    // theirs is the one thing every other write on this fork already refuses.
    // The wait-list entry itself is unaffected.
    if (nameMatches) {
      await recordSelfDeclaredCards(tx, {
        shopId: req.shopId,
        personId: person.id,
        level: req.declaration?.level,
        agency: req.declaration?.agency,
        identifier: req.declaration?.identifier,
        noCertification: req.declaration?.noCertification,
        nitrox: req.declaration?.nitrox,
      });
    }

    // One row per person per departure: a diver the shop already invited cold
    // is on the list now, and the row is theirs (they asked).
    const [existing] = await tx
      .select()
      .from(interests)
      .where(
        and(
          eq(interests.scope, "departure"),
          eq(interests.tripId, trip.id),
          eq(interests.personId, person.id),
        ),
      )
      .limit(1);
    if (existing) {
      // Asking again is how a joiner updates what they said, the party too,
      // and how a diver the shop invited cold says they want in. Only under
      // their own name (security review of #2656, minor 3): this form is
      // unauthenticated, and a submit with this address under another name
      // may be a second human, who must not rewrite the shop's invitation.
      if (nameMatches && (existing.partySize !== partySize || existing.askedBy !== "diver")) {
        await tx
          .update(interests)
          .set({ partySize, askedBy: "diver" })
          .where(and(eq(interests.id, existing.id), eq(interests.shopId, req.shopId)));
      }
      return {
        ok: false,
        reason: "already_waitlisted",
        interestId: existing.id,
        personName: person.fullName,
      };
    }

    const [interest] = await tx
      .insert(interests)
      .values({
        shopId: req.shopId,
        scope: "departure",
        askedBy: "diver",
        tripId: trip.id,
        personId: person.id,
        partySize,
      })
      .returning();
    if (!interest) throw new Error("askForDeparture: interest insert returned no row");
    return { ok: true, interestId: interest.id, personName: person.fullName };
  });
}

/**
 * **The desk puts a diver already on file on a full trip's wait list** (Aaron,
 * 2026-10-23): the staffer picks the record instead of typing the diver again,
 * so the list never grows a second person row. It is the diver asking, by
 * phone or at the counter, so the entry is theirs (`askedBy: "diver"`) exactly
 * as a typed one is, and a cold invitation already on the list becomes theirs
 * too. No declaration is recorded: the desk said nothing about cards.
 *
 * `not_found` when the person is not one of this shop's live divers.
 */
export async function askForDepartureAsKnownDiver(
  db: AppDb,
  req: { shopId: string; tripId: string; personId: string },
): Promise<DepartureAskOutcome | { ok: false; reason: "not_found" }> {
  return db.transaction(async (tx) => {
    const locked = await lockFullDeparture(tx, req.shopId, req.tripId, 1);
    if (!locked.ok) return locked;
    const { trip } = locked;

    const [person] = await tx
      .select({ id: people.id, fullName: people.fullName })
      .from(people)
      .innerJoin(personRoles, eq(personRoles.personId, people.id))
      .where(
        and(
          eq(people.id, req.personId),
          eq(people.shopId, req.shopId),
          eq(personRoles.role, "diver"),
          livePerson(),
        ),
      )
      .limit(1);
    if (!person) return { ok: false as const, reason: "not_found" as const };

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
    if (booking) return { ok: false as const, reason: "already_booked" as const };

    const [existing] = await tx
      .select({ id: interests.id, askedBy: interests.askedBy })
      .from(interests)
      .where(
        and(
          eq(interests.scope, "departure"),
          eq(interests.tripId, trip.id),
          eq(interests.personId, person.id),
        ),
      )
      .limit(1);
    if (existing) {
      if (existing.askedBy !== "diver") {
        await tx
          .update(interests)
          .set({ askedBy: "diver" })
          .where(and(eq(interests.id, existing.id), eq(interests.shopId, req.shopId)));
      }
      return {
        ok: false as const,
        reason: "already_waitlisted" as const,
        interestId: existing.id,
        personName: person.fullName,
      };
    }

    const [interest] = await tx
      .insert(interests)
      .values({
        shopId: req.shopId,
        scope: "departure",
        askedBy: "diver",
        tripId: trip.id,
        personId: person.id,
        partySize: 1,
      })
      .returning({ id: interests.id });
    if (!interest) throw new Error("askForDepartureAsKnownDiver: interest insert returned no row");
    return { ok: true as const, interestId: interest.id, personName: person.fullName };
  });
}

/**
 * The departure, locked, when it is full for a party of `askedParty`: the one
 * full/not-full decision both wait-list writers share, under the booking
 * door's own trip-row lock. A refusal says why there is no list to join.
 */
async function lockFullDeparture(
  tx: DbExecutor,
  shopId: string,
  tripId: string,
  askedParty: number,
): Promise<
  | { ok: true; trip: typeof trips.$inferSelect; partySize: number }
  | { ok: false; reason: "trip_unavailable" | "trip_available" }
> {
  // Same trip-row lock as createBooking: the full/not-full decision must be
  // serialized against concurrent bookings, or a waitlist join can race a
  // booking into the wrong outcome.
  const [trip] = await tx
    .select()
    .from(trips)
    // A rehearsal has no wait list (ADR 20261012-rehearsal-departures).
    .where(and(eq(trips.id, tripId), eq(trips.shopId, shopId), liveTrip(), notRehearsal()))
    .limit(1)
    .for("update");
  if (trip?.status !== "scheduled" || trip.startsAt <= nowDate()) {
    return { ok: false, reason: "trip_unavailable" };
  }
  // The form offers "up to the boat's seats"; the server keeps that promise,
  // so a hand-posted party cannot claim more demand than the boat holds.
  const partySize = Math.max(1, Math.min(askedParty, trip.capacity));

  // `heldSeatCounts`, the same counts `createBookingRecord` reads — this
  // decision has to be the one the booking door would make, or the two
  // disagree about the same boat. A seat a staffer released at the counter
  // is free, so the honest answer to "can I join the wait list?" is
  // `trip_available`: go and book it (issue #1209).
  //
  // A wait list is for a diver's seat, so "available" means a diver could
  // book one: a boat with room aboard but every diver's seat taken is still
  // full for this person (ADR 20261007-participant-types).
  // Measured against the certificate-capped seats, as the booking door is
  // (H-107): an over-limit departure is full at its certificate.
  //
  // A party waits until the whole party fits (ADR 20260719-trip-waitlist,
  // amended): its last diver must fit beside the others, so the counts are
  // read as if the rest were already aboard.
  const capacity = await sellableCapacity(tx, trip);
  const held = await heldSeatCounts(tx, shopId, trip.id);
  const withParty = { aboard: held.aboard + partySize - 1, divers: held.divers + partySize - 1 };
  // A course session also seats its students at the crew's ratio, as the
  // sale and the roll measure it (issue #2679): full at the ratio is full.
  const ratioCap = await courseStudentSeatCap(tx, trip);
  if (
    seatRefusal("diver", { ...trip, capacity }, withParty) === null &&
    courseRatioRefusal(withParty.divers, ratioCap) === null
  ) {
    return { ok: false, reason: "trip_available" };
  }
  // **The wait list is a Features switch**, asked after the seat question
  // (review 2026-10-23, item 7): a boat with a seat open answers "go and book
  // it" whatever the switch says. Off, no door anywhere offers the list (the
  // public trip page, the roster, a new diver's form), and a post that reaches
  // here anyway finds no list to join. Interests already on file stay.
  const [shop] = await tx
    .select({ on: shops.waitlistEnabled })
    .from(shops)
    .where(eq(shops.id, shopId))
    .limit(1);
  if (!shop?.on) return { ok: false, reason: "trip_unavailable" };
  return { ok: true, trip, partySize };
}

/** The people columns an interest row renders: a name and the address an offer goes to. */
const interestPerson = { id: people.id, fullName: people.fullName, email: people.email };

/**
 * Every departure interest on one trip, in the order people asked. Interests stay
 * outside the roster because they have not booked a seat. Carries its own
 * `shop_id`, so none of these can be called safely with only a trip UUID for
 * the wrong shop. `person` is null for a row that lives on a snapshot.
 */
export async function listDepartureInterests(db: AppDb, shopId: string, tripId: string) {
  return db
    .select({ interest: interests, person: interestPerson })
    .from(interests)
    .leftJoin(people, and(eq(people.id, interests.personId), eq(people.shopId, shopId)))
    .where(
      and(
        eq(interests.scope, "departure"),
        eq(interests.shopId, shopId),
        eq(interests.tripId, tripId),
      ),
    )
    .orderBy(asc(interests.askedAt), asc(people.fullName), asc(interests.id));
}

export type DepartureInterestRow = Awaited<ReturnType<typeof listDepartureInterests>>[number];

/**
 * Confirmation pages render only a real interest, never an identity in the URL:
 * scoped to the shop, the trip and the departure scope.
 */
export async function getDepartureInterestForTrip(
  db: AppDb,
  shopId: string,
  tripId: string,
  interestId: string,
) {
  const [row] = await db
    .select({ interest: interests, person: people })
    .from(interests)
    .leftJoin(people, and(eq(people.id, interests.personId), eq(people.shopId, shopId)))
    .where(
      and(
        eq(interests.id, interestId),
        eq(interests.scope, "departure"),
        eq(interests.tripId, tripId),
        eq(interests.shopId, shopId),
      ),
    )
    .limit(1);
  return row ?? null;
}

type StaffDepartureInterest = {
  shopId: string;
  tripId: string;
  personId: string;
  createdByPersonId: string;
  partySize?: number;
};

/**
 * **A shop-asked departure interest for an existing diver** (the Invite button, the
 * counter's offer, the suggestions list): outreach that changes no booking
 * state. One row per person per departure, so a diver who is already waiting
 * keeps the row they have and the call answers with it. Null when the trip, the
 * author or the diver is not this shop's live record, or the diver holds a seat
 * that cannot be reactivated.
 */
export async function ensureDepartureInterest(
  tx: DbExecutor,
  input: StaffDepartureInterest,
): Promise<{ interestId: string; created: boolean } | null> {
  const [trip] = await tx
    .select({ id: trips.id, startsAt: trips.startsAt })
    .from(trips)
    .where(
      and(eq(trips.id, input.tripId), eq(trips.shopId, input.shopId), liveTrip(), notRehearsal()),
    )
    .limit(1);
  if (!trip) return null;

  const [author] = await tx
    .select({ id: people.id })
    .from(people)
    .where(
      and(eq(people.id, input.createdByPersonId), eq(people.shopId, input.shopId), livePerson()),
    )
    .limit(1);
  if (!author) return null;

  const [person] = await tx
    .select({ id: people.id })
    .from(people)
    .innerJoin(personRoles, eq(personRoles.personId, people.id))
    .where(
      and(
        eq(people.id, input.personId),
        eq(people.shopId, input.shopId),
        eq(personRoles.role, "diver"),
        // Removed, erased or merged people get no interest row (security review N4):
        // `people_anonymized_stays_removed` and `people_merged_stays_removed`
        // make the last two removed as well.
        livePerson(),
      ),
    )
    .limit(1);
  if (!person) return null;

  const [booking] = await tx
    .select({ status: bookings.status })
    .from(bookings)
    .where(
      and(
        eq(bookings.shopId, input.shopId),
        eq(bookings.tripId, input.tripId),
        eq(bookings.personId, input.personId),
      ),
    )
    .limit(1);
  if (booking && !rowCanBeReactivated(booking.status, trip.startsAt)) return null;

  const [inserted] = await tx
    .insert(interests)
    .values({
      shopId: input.shopId,
      scope: "departure",
      askedBy: "shop",
      tripId: input.tripId,
      personId: input.personId,
      createdByPersonId: input.createdByPersonId,
      partySize: input.partySize ?? 1,
    })
    .onConflictDoNothing()
    .returning({ id: interests.id });
  if (inserted) return { interestId: inserted.id, created: true };

  const [standing] = await tx
    .select({ id: interests.id })
    .from(interests)
    .where(
      and(
        eq(interests.scope, "departure"),
        eq(interests.shopId, input.shopId),
        eq(interests.tripId, input.tripId),
        eq(interests.personId, input.personId),
      ),
    )
    .limit(1);
  return standing ? { interestId: standing.id, created: false } : null;
}

/** Normalizes an optional free-text field to trimmed text or null, never an empty string. */
function normalizeOptional(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/**
 * The shop's live diver holding exactly this address, or null.
 *
 * Exact and case-insensitive, never fuzzy, and never on the phone number: a
 * household number is genuinely shared, and a link written from one would point
 * a future erasure at a partner's or a child's interest. `people_shop_email_unique`
 * is a partial unique index on `lower(email)` over this shop's live rows, so
 * there is at most one candidate and no "first match wins" ordering to reason
 * about. Deleted and erased records are excluded on purpose: a soft-deleted
 * duplicate sits outside the unique index, which is exactly where a second row
 * holding the same address could hide, and linking to it would send a later
 * erasure at the wrong record.
 */
async function livePersonIdForEmail(
  db: DbExecutor,
  shopId: string,
  email: string,
): Promise<string | null> {
  const [match] = await db
    .select({ id: people.id })
    .from(people)
    .where(
      and(
        eq(people.shopId, shopId),
        isNull(people.deletedAt),
        sql`lower(${people.email}) = ${email}`,
      ),
    )
    .limit(1);
  return match?.id ?? null;
}

export type DateAsk = {
  shopId: string;
  /** Null for an ordinary dive request, which names `interest` instead. */
  courseId?: string | null;
  /** What a dive request is about; required when there is no course. */
  interest?: string | null;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  experienceLevel?: CourseInquiryExperience | null;
  timing?: string | null;
  preferredDate?: CalendarDate | null;
  alternateDate?: CalendarDate | null;
  dateFlexible?: boolean;
  /** The asker and whoever dives with them; clamped to the column's 1 to 20. */
  partySize?: number | null;
  message?: string | null;
  /** The staffer who wrote down a phone call; absent for the diver's own form. */
  createdByPersonId?: string | null;
};

/**
 * Records one diver asking for a date: a `date` interest. Insert-only, there is no
 * edit or withdraw path (a diver just asks again).
 *
 * **No person row is made** (H-13): this form is unauthenticated, and creating
 * a person from a stranger's typing is how a second human's record gets
 * written. The contact is a snapshot on the interest. When the writer left an email
 * that a live diver of this shop already holds, the `person_id` link is
 * snapshotted onto the row. That is not a convenience: it is the only handle
 * diver erasure has once the diver changes their address (`scrubInterests`, ADR
 * 20260802-diver-data-erasure). An interest with no email, or an address nobody here
 * holds, is stored unlinked, the honest answer.
 *
 * `courseId` and `shopId` are derived server-side from the URL's slugs, never
 * accepted from the caller.
 */
export async function askForDate(
  db: DbExecutor,
  input: DateAsk,
): Promise<{ id: string; askedAt: Date }> {
  const email = normalizeOptional(input.email)?.toLowerCase() ?? null;
  const courseId = input.courseId ?? null;
  const interest = normalizeOptional(input.interest);
  // A request must be about something. The check constraint says the same, and
  // the server action refuses it in the diver's own words before reaching here;
  // this is the layer that must not depend on either having run.
  if (!courseId && !interest) {
    throw new Error("askForDate: a request names either a course or an interest");
  }
  const personId = email ? await livePersonIdForEmail(db, input.shopId, email) : null;
  const partySize =
    input.partySize == null ? null : Math.min(20, Math.max(1, Math.trunc(input.partySize) || 1));
  const [inserted] = await db
    .insert(interests)
    .values({
      shopId: input.shopId,
      scope: "date",
      askedBy: "diver",
      courseId,
      interest,
      personId,
      name: normalizeOptional(input.name),
      email,
      phone: normalizeOptional(input.phone),
      experienceLevel: input.experienceLevel ?? null,
      timing: normalizeOptional(input.timing),
      preferredDate: input.preferredDate ?? null,
      alternateDate: input.alternateDate ?? null,
      dateFlexible: input.dateFlexible ?? false,
      partySize,
      message: normalizeOptional(input.message),
      createdByPersonId: input.createdByPersonId ?? null,
    })
    .returning({ id: interests.id, askedAt: interests.askedAt });
  if (!inserted) throw new Error("askForDate: insert returned no row");
  return inserted;
}

/**
 * **Close a date interest, or open it again** (third UX review, item 13). `booked`
 * is the seat a staffer made from the request; `done` is the staffer's tick;
 * `null` is Reopen. Scoped by shop and scope, so an id from a form reaches
 * nothing outside this shop's date interests. A `booked` stamp never overwrites an
 * earlier close: the first answer is the one the page shows. Returns whether a
 * row changed.
 *
 * **Closing a date interest never closes its departure children**: a diver offered
 * Saturday keeps that offer standing.
 */
export async function setDateInterestOutcome(
  db: DbExecutor,
  input: { shopId: string; interestId: string; outcome: DateRequestOutcome | null; now: Date },
): Promise<boolean> {
  const scope = and(
    eq(interests.id, input.interestId),
    eq(interests.shopId, input.shopId),
    eq(interests.scope, "date"),
  );
  const rows = await db
    .update(interests)
    .set(
      input.outcome
        ? { closedAt: input.now, closedAs: input.outcome }
        : { closedAt: null, closedAs: null },
    )
    .where(input.outcome === "booked" ? and(scope, isNull(interests.closedAt)) : scope)
    .returning({ id: interests.id });
  return rows.length > 0;
}

/**
 * Link one successfully seated booking to one offered departure child. A date
 * request can ask for several seats, so each booking gets its own row and only
 * one active linked seat is subtracted from the offer. An explicit later
 * request can reassign a moved booking to another offered departure; no diver
 * identity is inferred. The booking lock serializes reassignment of one seat,
 * and the offer lock serializes bookings against that offer's party size.
 */
export async function associateDateRequestOfferBooking(
  db: AppDb,
  input: { shopId: string; tripId: string; requestId: string; bookingId: string },
): Promise<boolean> {
  const source = alias(interests, "date_request");
  return db.transaction(async (tx) => {
    const [booking] = await tx
      .select({ id: bookings.id })
      .from(bookings)
      .where(
        and(
          eq(bookings.id, input.bookingId),
          eq(bookings.shopId, input.shopId),
          eq(bookings.tripId, input.tripId),
          inArray(bookings.status, [...SEAT_HELD_STATUSES]),
        ),
      )
      .limit(1)
      .for("update");
    if (!booking) return false;

    const [offer] = await tx
      .select({ id: interests.id, partySize: interests.partySize })
      .from(interests)
      .innerJoin(
        source,
        and(
          eq(source.id, interests.parentInterestId),
          eq(source.shopId, input.shopId),
          eq(source.scope, "date"),
        ),
      )
      .where(
        and(
          eq(interests.shopId, input.shopId),
          eq(interests.scope, "departure"),
          eq(interests.tripId, input.tripId),
          eq(interests.parentInterestId, input.requestId),
          isNotNull(interests.offeredAt),
        ),
      )
      .limit(1)
      // The date request parent is updated before this child by diver erasure.
      // Lock only the offered child here so the read-only join does not take a
      // parent lock in the opposite order.
      .for("update", { of: interests });
    if (!offer) return false;

    const [existing] = await tx
      .select({ interestId: dateRequestOfferBookings.interestId })
      .from(dateRequestOfferBookings)
      .where(eq(dateRequestOfferBookings.bookingId, input.bookingId))
      .limit(1);
    if (existing?.interestId === offer.id) return true;

    const [linked] = await tx
      .select({ seats: count(bookings.id) })
      .from(dateRequestOfferBookings)
      .innerJoin(
        bookings,
        and(
          eq(bookings.id, dateRequestOfferBookings.bookingId),
          eq(bookings.shopId, input.shopId),
          eq(bookings.tripId, input.tripId),
          inArray(bookings.status, [...SEAT_HELD_STATUSES]),
        ),
      )
      .where(
        and(
          eq(dateRequestOfferBookings.shopId, input.shopId),
          eq(dateRequestOfferBookings.interestId, offer.id),
        ),
      );
    if ((linked?.seats ?? 0) >= (offer.partySize ?? 1)) return false;

    if (existing) {
      const [updated] = await tx
        .update(dateRequestOfferBookings)
        .set({ interestId: offer.id })
        .where(
          and(
            eq(dateRequestOfferBookings.shopId, input.shopId),
            eq(dateRequestOfferBookings.bookingId, input.bookingId),
          ),
        )
        .returning({ bookingId: dateRequestOfferBookings.bookingId });
      return updated !== undefined;
    }

    const [inserted] = await tx
      .insert(dateRequestOfferBookings)
      .values({
        shopId: input.shopId,
        interestId: offer.id,
        bookingId: input.bookingId,
      })
      .onConflictDoNothing()
      .returning({ bookingId: dateRequestOfferBookings.bookingId });
    return inserted !== undefined;
  });
}

/**
 * **Attach date interests to a new departure** (the schedule builder's hand-off):
 * one departure child row per interest, `parent_interest_id` pointing back,
 * `asked_by = 'diver'` and `offered_at` null, so the departure's own panel shows
 * them and staff offer the seat from there. Nothing is sent and nothing is
 * reserved. The interest is only a contact source, so the child copies its
 * snapshot, its party and its original `askedAt`, and never its person link.
 *
 * Idempotent: a unique `(trip, parent)` index makes a retried submit harmless,
 * and a diver already on this departure's list keeps the row they have,
 * untouched. A rehearsal answers nobody's request, so it gets none. Returns how
 * many rows were written.
 */
export async function attachDateInterestsToDeparture(
  db: AppDb,
  input: { shopId: string; tripId: string; interestIds: string[]; createdByPersonId: string },
): Promise<number> {
  const interestIds = [...new Set(input.interestIds)];
  if (interestIds.length === 0) return 0;

  return db.transaction(async (tx) => {
    const [trip] = await tx
      .select({ id: trips.id })
      .from(trips)
      .where(
        and(eq(trips.id, input.tripId), eq(trips.shopId, input.shopId), liveTrip(), notRehearsal()),
      )
      .limit(1);
    if (!trip) return 0;

    const [author] = await tx
      .select({ id: people.id })
      .from(people)
      .where(
        and(eq(people.id, input.createdByPersonId), eq(people.shopId, input.shopId), livePerson()),
      )
      .limit(1);
    if (!author) return 0;

    const parents = await tx
      .select()
      .from(interests)
      .where(
        and(
          eq(interests.shopId, input.shopId),
          eq(interests.scope, "date"),
          inArray(interests.id, interestIds),
        ),
      );
    if (parents.length === 0) return 0;

    const inserted = await tx
      .insert(interests)
      .values(
        parents.map((parent) => ({
          shopId: input.shopId,
          scope: "departure" as const,
          askedBy: "diver" as const,
          tripId: input.tripId,
          parentInterestId: parent.id,
          // Never the parent's person link (H-13; security review of #2656,
          // MAJOR 2): that link is set from an unauthenticated form on the
          // address alone, as a handle for erasure, and copying it here would
          // put whoever owns the address on this departure's list by name, in
          // their (trip, person) slot. The child lives on the request's own
          // snapshot, as `trip_invitations` did on main; erasure blanks it
          // with its parent (`scrubInterests`).
          personId: null,
          name: parent.name,
          email: parent.email,
          phone: parent.phone,
          partySize: Math.min(20, Math.max(1, parent.partySize ?? 1)),
          askedAt: parent.askedAt,
          createdByPersonId: input.createdByPersonId,
        })),
      )
      .onConflictDoNothing()
      .returning({ id: interests.id });
    return inserted.length;
  });
}

/**
 * **The last-minute list** (ADR 20261017-one-interest-with-a-scope): an `anytime`
 * interest is a diver's standing "tell me if something opens", optionally bounded
 * by the dates they said they are around. Shop-wide, never a claim on a boat.
 */

export type AnytimeAsk = {
  shopId: string;
  fullName: string;
  email: string;
  phone?: string;
  /** Date-only (YYYY-MM-DD); either bound omitted means "no preference" on that side. */
  availableFrom?: string;
  availableUntil?: string;
  /**
   * What the joiner optionally said they can dive. Written onto the **person**
   * as a self-declared pending card, not onto the interest — see
   * `recordSelfDeclaredCards`. Absent, or all-empty, records nothing.
   */
  declaration?: DiveDeclaration;
};

export type AnytimeAskOutcome = { interestId: string; personName: string };

/**
 * Adds (or reopens) a diver's shop-wide last-minute-list interest. Unlike
 * `askForDeparture`, this is not scoped to one trip and never checks capacity:
 * it is a standing preference, not a claim on a specific charter. A re-submit
 * (same shop and person) overwrites the stated date range and **reopens an
 * unsubscribed interest**, so a diver can update "when I'm around" by filling the
 * form out again.
 */
export async function askAnytime(db: AppDb, input: AnytimeAsk): Promise<AnytimeAskOutcome> {
  const email = input.email.trim().toLowerCase();
  const fullName = input.fullName.trim();
  const availableFrom = input.availableFrom || null;
  const availableUntil = input.availableUntil || null;

  return db.transaction(async (tx) => {
    const { person, nameMatches } = await findOrCreatePerson(tx, {
      shopId: input.shopId,
      fullName,
      email,
      phone: input.phone,
    });

    // Inside the same transaction as the interest itself: a joiner who told the
    // shop their level and a joiner who did not are two outcomes, not three, so
    // the card must not be able to land without the interest or the reverse. It
    // refuses to touch a card the shop actually captured — see the
    // anti-displacement rule, which is what makes this safe on a path anyone
    // can post to.
    //
    // `nameMatches` is H-13's borrowed-identity rule, applied to the one write
    // here that is evidence about a body. This form is unauthenticated, and an
    // email that already belongs to a diver under a *different* name is a
    // possible second human — a family sharing an inbox, or somebody typing an
    // address that is not theirs. Everywhere else that reaches this fork
    // refuses to write on a mismatch (`seat-claims.ts` will not even record a
    // phone number, `people.ts` will not record a locale), and certification
    // data is stronger than either. The **interest** is still created: joining a
    // marketing list under a borrowed address is the behaviour this feature
    // found, not one it introduced, and refusing the opt-in would be a new
    // regression. Only the safety record is withheld.
    if (nameMatches) {
      await recordSelfDeclaredCards(tx, {
        shopId: input.shopId,
        personId: person.id,
        level: input.declaration?.level,
        agency: input.declaration?.agency,
        identifier: input.declaration?.identifier,
        noCertification: input.declaration?.noCertification,
        nitrox: input.declaration?.nitrox,
      });
    }

    const [interest] = await tx
      .insert(interests)
      .values({
        shopId: input.shopId,
        scope: "anytime",
        askedBy: "diver",
        personId: person.id,
        availableFrom,
        availableUntil,
      })
      .onConflictDoUpdate({
        target: [interests.shopId, interests.personId],
        targetWhere: sql`${interests.scope} = 'anytime'`,
        set: { availableFrom, availableUntil, closedAt: null, closedAs: null },
      })
      .returning({ id: interests.id });
    if (!interest) throw new Error("askAnytime: upsert returned no row");
    return { interestId: interest.id, personName: person.fullName };
  });
}

/** An open last-minute-list interest and the person it belongs to. */
export type AnytimeInterestRow = { interest: Interest; person: Person };

/**
 * Every open (not unsubscribed, not closed) anytime interest for a shop, oldest
 * first — none at all while the shop has the list switched off
 * (`shops.last_minute_list_enabled`, ADR 20261005-optional-shop-features), so
 * the trip page's deal sender and the send itself both find nobody to reach.
 */
export async function listOpenAnytimeInterests(
  db: DbExecutor,
  shopId: string,
): Promise<AnytimeInterestRow[]> {
  return db
    .select({ interest: interests, person: people })
    .from(interests)
    .innerJoin(people, and(eq(people.id, interests.personId), eq(people.shopId, shopId)))
    .innerJoin(shops, eq(shops.id, interests.shopId))
    .where(
      and(
        eq(interests.shopId, shopId),
        eq(interests.scope, "anytime"),
        eq(shops.lastMinuteListEnabled, true),
        isNull(interests.closedAt),
      ),
    )
    .orderBy(asc(interests.askedAt), asc(people.fullName), asc(interests.id));
}

/**
 * Just the stated availability windows of a shop's open anytime interests — no
 * people, no ordering. Today's queue reads it to decide whether a "fill these
 * seats" row has anyone behind it at all; the matching is pure arithmetic over
 * the rows (`lastMinuteEntryMatchesTripDate`), done once per departure.
 * Empty while the shop has the list switched off, like the read above.
 */
export async function listOpenAnytimeWindows(
  db: DbExecutor,
  shopId: string,
): Promise<LastMinuteListWindow[]> {
  return db
    .select({ availableFrom: interests.availableFrom, availableUntil: interests.availableUntil })
    .from(interests)
    .innerJoin(shops, eq(shops.id, interests.shopId))
    .where(
      and(
        eq(interests.shopId, shopId),
        eq(interests.scope, "anytime"),
        eq(shops.lastMinuteListEnabled, true),
        isNull(interests.closedAt),
      ),
    );
}

/** The departure an anytime read is made for. */
export type AnytimeTrip = {
  id: string;
  startsAt: Date;
  /** The course this session teaches, when it is one: its target narrows who is eligible. */
  course?: CourseTargetInfo | null;
};

export type AnytimeCoveringOptions = {
  /** The shop's zone; read when absent. */
  timezone?: string;
  /** The departure's effective gate (its own requirement folded with its sites); read when absent. */
  requirement?: LastMinuteDepartureBar | null;
  /** Only divers with an email an offer could go to (the deal needs one). On by default. */
  requireEmail?: boolean;
  /** The preview cap; `LAST_MINUTE_RECIPIENT_PREVIEW_LIMIT` when absent. */
  limit?: number;
};

/** One recipient the panel draws: the interest, the person, and what is known about their card. */
export type AnytimeRecipient = AnytimeInterestRow & {
  certification: Awaited<ReturnType<typeof listCertificationSummaries>> extends Map<
    string,
    infer Summary
  >
    ? Summary | null
    : never;
};

export type AnytimeInterestsCovering = {
  /** Open interests whose stated window covers the departure's day, before the eligibility filter. */
  matched: AnytimeInterestRow[];
  /**
   * Every interest a bulk offer may reach, in send order: this departure's own
   * wait-listers first, then the rest in the order they asked. The below-bar
   * filter has been applied; nothing here is capped.
   */
  eligible: AnytimeRecipient[];
  /** The panel's third group: the first `limit` of `eligible`, risky names first, and the counts. */
  review: LastMinuteRecipientReview<AnytimeRecipient>;
};

/**
 * **The specialty cards on file, read only when the departure asks for one**:
 * the fit check folds them as it folds the rung (dive-domain review of #2656,
 * m1). A live row is a card; the table holds no unsighted claims. The send
 * (`listAnytimeInterestsCovering`) and the Who wants in panel (`getTripGuests`)
 * both read it, so the panel never hides someone the send would reach.
 */
export async function specialtiesForFit(
  db: DbExecutor,
  shopId: string,
  personIds: readonly string[],
  requirement: { requiredSpecialties: readonly DiveSpecialty[] } | null,
): Promise<Map<string, DiveSpecialty[]>> {
  const specialties = new Map<string, DiveSpecialty[]>();
  if ((requirement?.requiredSpecialties.length ?? 0) === 0 || personIds.length === 0) {
    return specialties;
  }
  const rows = await db
    .select({
      personId: specialtyCertifications.personId,
      specialty: specialtyCertifications.specialty,
    })
    .from(specialtyCertifications)
    .where(
      and(
        eq(specialtyCertifications.shopId, shopId),
        inArray(specialtyCertifications.personId, [...personIds]),
        isNull(specialtyCertifications.deletedAt),
      ),
    );
  for (const row of rows) {
    specialties.set(row.personId, [...(specialties.get(row.personId) ?? []), row.specialty]);
  }
  return specialties;
}

/**
 * **Who a bulk offer on this departure would reach, and how to draw them.**
 * Open anytime interests whose window covers the departure's day (in the shop's
 * zone), with an address to write to, filtered by the deal's below-the-bar rule
 * (`filterEligibleLastMinuteRecipients`: never someone under the departure's
 * minimum; for a course, only those who would reach its level), this
 * departure's own wait-listers put first, and the capped preview with
 * below-the-bar names lifted to the top (`reviewLastMinuteRecipients`). The cap
 * is safe *because* of that ordering. The review informs and nothing else: the
 * filter above it is what bounds the send.
 */
export async function listAnytimeInterestsCovering(
  db: DbExecutor,
  shopId: string,
  trip: AnytimeTrip,
  options: AnytimeCoveringOptions = {},
): Promise<AnytimeInterestsCovering> {
  const timezone =
    options.timezone ??
    (
      await db.select({ timezone: shops.timezone }).from(shops).where(eq(shops.id, shopId)).limit(1)
    )[0]?.timezone ??
    "UTC";
  const tripDateIso = toDateInputValue(utcToWallTime(trip.startsAt, timezone));
  const requirement =
    options.requirement !== undefined
      ? options.requirement
      : unionRequirements(
          await getTripRequirements(db, shopId, trip.id),
          await getTripSiteRequirement(db, shopId, trip.id),
        );

  const matched = (await listOpenAnytimeInterests(db, shopId)).filter(({ interest }) =>
    lastMinuteEntryMatchesTripDate(interest, tripDateIso),
  );
  const reachable =
    options.requireEmail === false
      ? matched
      : matched.filter(({ person }) => Boolean(person.email));

  const waitlisted = await db
    .select({ personId: interests.personId })
    .from(interests)
    .where(
      and(
        eq(interests.shopId, shopId),
        eq(interests.scope, "departure"),
        eq(interests.tripId, trip.id),
        eq(interests.askedBy, "diver"),
      ),
    )
    // diveday:allow-time-id-order: the send order of wait-listers only; nobody is shown it
    .orderBy(asc(interests.askedAt), asc(interests.id));

  const reachableIds = reachable.map(({ person }) => person.id);
  const summaries = await listCertificationSummaries(db, shopId, reachableIds);
  const specialties = await specialtiesForFit(db, shopId, reachableIds, requirement);
  const eligible = orderLastMinuteRecipients(
    filterEligibleLastMinuteRecipients(
      reachable.map((row) => ({
        ...row,
        certification: summaries.get(row.person.id) ?? null,
        specialties: specialties.get(row.person.id) ?? [],
      })),
      requirement,
      trip.course ?? null,
    ),
    waitlisted.flatMap(({ personId }) => (personId ? [personId] : [])),
  );
  return {
    matched,
    eligible,
    review: reviewLastMinuteRecipients(eligible, requirement, options.limit),
  };
}

/**
 * Mints a fresh, non-expiring bearer link for one anytime interest (Leo — self-serve
 * email unsubscribe). Called once per deal blast, per recipient, so every
 * last-minute-deal email carries its own working unsubscribe link even if an
 * earlier email's link is later relied on too — see `interestUnsubscribeTokens` for
 * why this never expires and is never single-use.
 */
export async function issueInterestUnsubscribeToken(
  db: DbExecutor,
  input: { shopId: string; interestId: string },
): Promise<string> {
  const token = createBearerToken();
  await db.insert(interestUnsubscribeTokens).values({
    shopId: input.shopId,
    interestId: input.interestId,
    tokenHash: hashBearerToken(token),
  });
  return token;
}

export type InterestUnsubscribeContext = {
  shopId: string;
  shopName: string;
  interestId: string;
  alreadyUnsubscribed: boolean;
};

/**
 * Resolves a bearer token to its interest, or null for anything that must read as
 * "this link isn't available" — an unknown token or a since-deleted shop.
 * Deliberately does not treat an already-closed interest as invalid (the page still
 * needs to render a real "you're already unsubscribed" state, not a dead link,
 * if a diver clicks an old email's link twice).
 */
export async function resolveInterestUnsubscribeToken(
  db: DbExecutor,
  token: string,
): Promise<InterestUnsubscribeContext | null> {
  const [row] = await db
    .select({
      tokenShopId: interestUnsubscribeTokens.shopId,
      interestShopId: interests.shopId,
      shopName: shops.name,
      interestId: interests.id,
      closedAt: interests.closedAt,
    })
    .from(interestUnsubscribeTokens)
    .innerJoin(interests, eq(interests.id, interestUnsubscribeTokens.interestId))
    .innerJoin(shops, eq(shops.id, interests.shopId))
    .where(eq(interestUnsubscribeTokens.tokenHash, hashBearerToken(token)))
    .limit(1);
  if (!row) return null;
  // Defense in depth, mirroring verifyBookingCapability: nothing legitimate can
  // cause the token's own shopId to drift from its interest's, but a resolved
  // identity must never be trusted past that check.
  if (row.tokenShopId !== row.interestShopId) return null;
  return {
    shopId: row.interestShopId,
    shopName: row.shopName,
    interestId: row.interestId,
    alreadyUnsubscribed: row.closedAt !== null,
  };
}

/**
 * The one mutating step a diver's own unsubscribe click drives: resolves the
 * token, then closes the interest it names as `unsubscribed`, kept as history and
 * not deleted. Idempotent — a token clicked twice (or an interest closed another
 * way) just confirms the same outcome rather than erroring, and never rewrites
 * the first close.
 */
export async function unsubscribeAnytimeInterestByToken(
  db: AppDb,
  input: { token: string; now?: Date },
): Promise<InterestUnsubscribeContext | null> {
  const context = await resolveInterestUnsubscribeToken(db, input.token);
  if (!context) return null;
  await db
    .update(interests)
    .set({ closedAt: input.now ?? nowDate(), closedAs: "unsubscribed" })
    .where(
      and(
        eq(interests.id, context.interestId),
        eq(interests.shopId, context.shopId),
        eq(interests.scope, "anytime"),
        isNull(interests.closedAt),
      ),
    );
  return context;
}

export type { Interest };
