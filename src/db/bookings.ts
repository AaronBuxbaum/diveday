import { and, count, eq, isNotNull, isNull, ne } from "drizzle-orm";
import { checkMinimumAge } from "@/lib/age";
import { calendarDateInTimezone } from "@/lib/calendar-date";
import { nowDate } from "@/lib/clock";
import { courseSeatCapacity } from "@/lib/course-ratios";
import { countInWaterCrew, groupCrewAssignments } from "@/lib/crew-roles";
import type { DiveIntent } from "@/lib/dive-intent";
import type { DiveRecencyBand } from "@/lib/dive-recency";
import { personNamesMatch } from "@/lib/person-name";
import type { ReEntryAsk } from "@/lib/re-entry";
import { hasVerifiedCertificationAtLeast } from "@/lib/readiness";
import { partnerReferralSlug } from "@/lib/referrals";
import {
  decideTripAdmission,
  type SelfDeclaration,
  type TripAdmission,
  type TripAdmissionEvidence,
  type TripAdmissionRefusal,
} from "@/lib/trip-admission";
import { hasSailed } from "@/lib/trips";
import { revokeBookingCapabilities } from "./booking-capabilities";
import { type AppDb, type DbExecutor, queryAll } from "./client";
import { consumeEntitlementsForBooking, releaseEntitlementsForBooking } from "./dive-packages";
import { releaseUnclaimedGearReservations } from "./gear";
import { publishManifestEvent } from "./manifest-events";
import { setBookingPayment } from "./payments";
import { findOrCreatePerson } from "./people";
import { getTripRequirements, getTripSiteRequirement } from "./readiness";
import {
  bookingPayments,
  bookings,
  certifications,
  courses,
  nitroxCertifications,
  people,
  personRoles,
  shops,
  specialtyCertifications,
  tripAssignments,
  trips,
} from "./schema";
import { recordSelfDeclaredCards } from "./self-declared-cards";
import { getShopCurrency } from "./stripe-accounts";
import { liveTrip } from "./trips-live";

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

/**
 * What the booker said about their own diving, as the booking path carries it.
 *
 * Wider than {@link SelfDeclaration}, which is only the part the *gate* reads.
 * "I'm not certified yet" is deliberately not in that half: it is recorded but
 * it never refuses a sale, because a diver must not be able to talk themselves
 * out of a seat a staffer could have cleared them for — the rule
 * `self-declared-cards.test.ts` has pinned since this answer existed.
 */
export type BookingDeclaration = SelfDeclaration & { noCertification?: boolean };

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
  /**
   * What this diver said this dive is for, from the booking form's five choices
   * (ADR 20260904-reef-all-the-way-down, D12). Omitted is "not said".
   *
   * **A soft cue, never a promise or a pairing rule**: the crew reads a count
   * for the departure, nothing here gates a seat, and no surface names who
   * chose what.
   */
  diveIntent?: DiveIntent;
  /**
   * The one support a diver easing back asked for (D18). Omitted is "asked for
   * nothing", which is every booking that never saw the question. **Gates
   * nothing** — it is a line the crew answers.
   */
  reEntryAsk?: ReEntryAsk;
  /**
   * What this diver said about their own certification on the form, when the
   * form asked (ADR 20260820-attested-at-booking-verified-at-boarding). Read by
   * the admission gate for this decision and written to the record **only on a
   * completed booking**, so a refused submission leaves nothing behind on
   * anybody's row — which is what keeps an anonymous form from editing a
   * stranger's safety record by failing.
   */
  declared?: BookingDeclaration;
  /**
   * What to do when the trip's own certification gate is not satisfied.
   *
   * `"enforce"` (the default, and every caller that does not say otherwise)
   * refuses with `trip_prerequisite`. `"advise"` sells the seat and hands the
   * unmet requirement back on the success as `admissionAdvisory`.
   *
   * **Only the public booking form advises**, because only it asks each diver
   * what they hold and can warn them as they answer. The three callers that
   * keep the refusal are the ones with nowhere to put a warning and something
   * worse to lose by proceeding:
   *
   * - **Reschedule** moves a seat the diver already has. Silently landing them
   *   on a departure they cannot dive is a worse outcome than the refusal, and
   *   they did not ask for it — the picker on `/ready` offers qualifying trips,
   *   so this is a backstop rather than the first line.
   * - **Seat claims** run the gate for the claimant on a seat somebody else
   *   bought (ADR 20260804-seat-claim-links); there is no form and no answer.
   * - **Staff seating** is a person at a counter who can read the refusal and
   *   act on it, which is exactly the conversation the gate is for.
   */
  admissionGate?: "enforce" | "advise";
  /**
   * The partner slug whose link brought this diver, when one did
   * (`partnerReferralSlug`, src/lib/referrals.ts). Only the public booking form
   * ever supplies it: a staff counter booking is not a referral, and a
   * reschedule or a seat claim is a seat that already exists.
   *
   * Normalised again here rather than trusted, because it arrives from a
   * cookie. A value that does not slug is stored as null — the booking still
   * completes, credited to nobody. Nothing about the booking depends on it.
   */
  referralSource?: string | null;
} & BookingPerson;

/**
 * Every way a booking can be refused. Codes, never sentences — each surface
 * looks them up in its own message bundle.
 *
 * `trip_prerequisite` is the trip's *own* cert/specialty/nitrox gate (DOM-M6),
 * and carries structured detail because a staffer's next move depends on which
 * requirement failed and what the diver holds. It is a sibling of
 * `course_prerequisite`, not a replacement: that one is a course's admission
 * rule, this one is the boat's.
 */
export type BookingRefusal =
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
    }
  | { ok: false; reason: "trip_prerequisite"; refusal: TripAdmissionRefusal };

/**
 * What the trip asks for that this diver's record does not yet answer, on a
 * booking that **went through anyway**.
 *
 * Not a refusal, and deliberately a different field from `BookingRefusal`'s
 * `refusal` so the two can never be confused at a call site: one means the seat
 * was not sold, this one means it was. The sale-time certification gate informs
 * (see `createBookingRecord`); readiness still decides boarding.
 */
export type BookingAdmissionAdvisory = TripAdmissionRefusal;

/**
 * **Whether this particular shortfall may be advised rather than refused.**
 *
 * Three conditions, and each one is load-bearing:
 *
 * 1. **The caller asked** (`admissionGate: "advise"`). Only the public booking
 *    form does; reschedule, seat claims and staff seating keep the stop.
 *
 * 2. **The shortfall rests on what this submitter just typed**, not on the
 *    shop's own record. H-30 is a *Chosen* decision that kept the refusal and
 *    rejected "sell the seat and let readiness catch it" outright — but its own
 *    text draws this line: "the common refusal is a response to what this
 *    submitter just typed rather than a disclosure about somebody on file".
 *    A diver who leaves the select alone and is short on their *record* is
 *    H-30's case exactly — nothing was said to them as they filled the form,
 *    so a silent sale would charge a carded regular in full and hand them a
 *    refund conversation at the dock. They still get the refusal.
 *
 * 3. **The unmet requirement is the level.** A specialty or nitrox gate is not
 *    something a diver can assert on this form — there is no field for either —
 *    so it is the one arm of this gate nobody could ever talk past, and
 *    switching it off would buy nothing the warning can replace.
 *
 * What is left is precisely the case FU-20260820-the-sale-gate-bites-only-the-
 * honest was about: a diver who answered truthfully and short, told so as they
 * answered, and refused anyway while "Rather not say" and an inflated rung both
 * walked through.
 */
function advisable(req: BookingRequest, refusal: TripAdmissionRefusal): boolean {
  return (
    req.admissionGate === "advise" &&
    Boolean(req.declared?.level) &&
    Boolean(refusal.requiredLevel) &&
    refusal.missingSpecialties.length === 0 &&
    !refusal.nitroxRequired
  );
}

export type BookingSuccess = {
  ok: true;
  bookingId: string;
  personId: string;
  personName: string;
  admissionAdvisory?: BookingAdmissionAdvisory;
};

export type BookingOutcome = BookingSuccess | BookingRefusal;

export type BookingPartyOutcome =
  | {
      ok: true;
      bookings: Array<{
        bookingId: string;
        personId: string;
        personName: string;
        admissionAdvisory?: BookingAdmissionAdvisory;
      }>;
    }
  | (BookingRefusal & {
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
  return db.transaction(async (tx) => {
    const pending: PendingDeclaration[] = [];
    const outcome = await createBookingRecord(tx, req, pending);
    if (outcome.ok) await flushDeclarations(tx, pending);
    return outcome;
  });
}

/** Books every named diver as one all-or-nothing party reservation. */
export async function createBookingParty(
  db: AppDb,
  requests: BookingRequest[],
): Promise<BookingPartyOutcome> {
  if (requests.length === 0) return { ok: false, reason: "trip_unavailable", failedIndex: -1 };
  return db
    .transaction(async (tx) => {
      const created: Array<{
        bookingId: string;
        personId: string;
        personName: string;
        admissionAdvisory?: BookingAdmissionAdvisory;
      }> = [];
      const pending: PendingDeclaration[] = [];
      for (const [index, request] of requests.entries()) {
        const outcome = await createBookingRecord(tx, request, pending);
        if (!outcome.ok) throw new PartyBookingError(outcome, index);
        // Every seat past the organizer's own records which booking leads its
        // party (docs ADR 20260804-seat-claim-links) — the fact the claim-link
        // surfaces later read to answer "whose seats may this organizer hand
        // out?". Written here rather than inside `createBookingRecord` so the
        // single-booking path never carries party state, and written even for
        // a reactivated row (whose stale linkage the reactivation path just
        // cleared) so a re-booked party member is claimable again.
        const leadBookingId = created[0]?.bookingId;
        if (index > 0 && leadBookingId) {
          await tx
            .update(bookings)
            .set({ partyLeadBookingId: leadBookingId })
            .where(eq(bookings.id, outcome.bookingId));
        }
        created.push(outcome);
      }
      await flushDeclarations(tx, pending);
      return { ok: true as const, bookings: created };
    })
    .catch((error: unknown): BookingPartyOutcome => {
      if (error instanceof PartyBookingError) {
        const refusal = error.refusal;
        // Narrowed rather than spread blind: the `trip_prerequisite` arm
        // carries a `refusal` payload the others don't, and both arms have to
        // land as their own member of `BookingPartyOutcome`.
        return refusal.reason === "trip_prerequisite"
          ? { ...refusal, failedIndex: error.index }
          : { ...refusal, failedIndex: error.index };
      }
      throw error;
    });
}

class PartyBookingError extends Error {
  constructor(
    /** The whole refusal, not just its code — `trip_prerequisite` carries detail. */
    public readonly refusal: BookingRefusal,
    public readonly index: number,
  ) {
    super(refusal.reason);
  }
}

/**
 * The instructors and certified assistants currently assigned to a trip, as the
 * ratio rules count them — `countInWaterCrew` (src/lib/crew-roles.ts) is the one
 * definition of that, shared with Today, the staffing window, and the trip page.
 * One query for every seat-granting path, so the undo of a roster removal can
 * never read a looser crew than the booking that preceded it.
 */
async function tripCourseCrewCounts(
  tx: DbExecutor,
  tripId: string,
): Promise<{ instructorCount: number; assistantCount: number }> {
  // Every assignment, not only those whose holder has an in-water role: the
  // per-trip role is read off the assignment row, so a `left join` keeps a
  // rostered captain visible to the rule that decides they count for nothing.
  const crew = await tx
    .select({
      personId: tripAssignments.personId,
      tripRole: tripAssignments.tripRole,
      role: personRoles.role,
    })
    .from(tripAssignments)
    .leftJoin(personRoles, eq(personRoles.personId, tripAssignments.personId))
    .where(eq(tripAssignments.tripId, tripId));
  return countInWaterCrew(groupCrewAssignments(crew));
}

/**
 * The trip's *own* certification/specialty/nitrox gate, read for one diver
 * (DOM-M6). Composes the trip's requirement row with every dive site the
 * itinerary visits, exactly as readiness does, then asks
 * `decideTripAdmission` (src/lib/trip-admission.ts) whether the seat is
 * possible at all — see that module for why "possible at all" is a narrower
 * question than "cleared to board".
 *
 * Fails closed on an unreadable requirement: both lookups run inside the
 * booking transaction, so a query that throws aborts the whole thing and no
 * seat is written. A refusal is never silent — it comes back as
 * `trip_prerequisite` with the unmet requirement attached.
 *
 * `person` is undefined for a walk-in whose row hasn't been written yet; that
 * diver has no evidence at this shop by construction, which is precisely the
 * unknown-diver case admission admits.
 *
 * `courseSession` short-circuits the whole thing, reads included: on a training
 * session the course's own gate above is the admission rule, so there is
 * nothing here to read (see `TripAdmissionInput.courseSession`).
 *
 * Exported for exactly one other caller: the seat-claim path
 * (src/db/seat-claims.ts), which re-runs this same gate for the claimant so a
 * claimed seat is admitted on the claimant's own evidence, never the
 * placeholder's (docs ADR 20260804-seat-claim-links). Any new caller should be
 * another door that puts a specific person on a specific trip.
 */
export async function tripAdmissionFor(
  tx: DbExecutor,
  shopId: string,
  tripId: string,
  person: { id: string } | undefined,
  identityUnconfirmed: boolean,
  courseSession: boolean,
  /** What the booker said about themselves on this submission, if the form asked. */
  declared?: SelfDeclaration,
): Promise<TripAdmission> {
  if (courseSession) {
    return decideTripAdmission({
      requirement: null,
      siteRequirement: null,
      evidence: NO_EVIDENCE,
      courseSession: true,
    });
  }
  // `queryAll`, not `Promise.all`: every caller of this gate reaches it inside
  // `createBookingRecord`'s transaction, which is one pinned client. See
  // `queryAll` in `src/db/client.ts`.
  const [requirement, siteRequirement] = await queryAll(tx, [
    () => getTripRequirements(tx, shopId, tripId),
    () => getTripSiteRequirement(tx, shopId, tripId),
  ]);
  const demandsSomething = Boolean(
    requirement?.minimumCertificationLevel ||
      requirement?.requiredSpecialties.length ||
      requirement?.requiresNitrox ||
      siteRequirement,
  );
  // The three evidence reads are skipped entirely when the trip demands
  // nothing or the diver is unknown to it — neither case can produce a
  // refusal, and every booking in the product would otherwise pay for them.
  const evidence: TripAdmissionEvidence =
    person && !identityUnconfirmed && demandsSomething
      ? await readCertificationEvidence(tx, shopId, person.id)
      : NO_EVIDENCE;
  // A declaration about a person whose identity did not match is not about
  // *them* (H-13) — the same reason their cards are not read here.
  const stated = identityUnconfirmed || !demandsSomething ? undefined : declared;
  return decideTripAdmission({
    requirement,
    siteRequirement,
    evidence,
    identityUnconfirmed,
    declared: stated,
  });
}

/** What a diver this shop knows nothing about has on file — and what an unread evidence lookup stands in for. */
const NO_EVIDENCE: TripAdmissionEvidence = {
  certifications: [],
  specialtyCertifications: [],
  nitroxCertifications: [],
};

/** One diver's live cert evidence at this shop — the same rows readiness reads. */
async function readCertificationEvidence(tx: DbExecutor, shopId: string, personId: string) {
  const [certificationRows, specialtyRows, nitroxRows] = await queryAll(tx, [
    () =>
      tx
        .select()
        .from(certifications)
        .where(
          and(
            eq(certifications.shopId, shopId),
            eq(certifications.personId, personId),
            isNull(certifications.deletedAt),
          ),
        ),
    () =>
      tx
        .select()
        .from(specialtyCertifications)
        .where(
          and(
            eq(specialtyCertifications.shopId, shopId),
            eq(specialtyCertifications.personId, personId),
            isNull(specialtyCertifications.deletedAt),
          ),
        ),
    () =>
      tx
        .select()
        .from(nitroxCertifications)
        .where(
          and(
            eq(nitroxCertifications.shopId, shopId),
            eq(nitroxCertifications.personId, personId),
            isNull(nitroxCertifications.deletedAt),
          ),
        ),
  ]);
  return {
    certifications: certificationRows,
    specialtyCertifications: specialtyRows,
    nitroxCertifications: nitroxRows,
  };
}

async function settlePackageCoverage(
  tx: DbExecutor,
  input: {
    shopId: string;
    personId: string;
    bookingId: string;
    identityUnconfirmed: boolean;
    trip: { courseId: string | null; plannedDives: number };
  },
) {
  if (input.identityUnconfirmed) return [];
  const spent = await consumeEntitlementsForBooking(tx, {
    shopId: input.shopId,
    personId: input.personId,
    bookingId: input.bookingId,
    trip: input.trip,
  });
  if (spent.length === input.trip.plannedDives) {
    await setBookingPayment(tx, {
      shopId: input.shopId,
      bookingId: input.bookingId,
      status: "paid",
      amountCents: 0,
      currency: await getShopCurrency(tx, input.shopId),
      provider: "dive_package",
      providerRef: spent[0]?.id ?? null,
      operation: "package_consumed",
    });
  }
  return spent;
}

/** Shared cancellation/blow-out release; package-only payment is reset too. */
export async function releasePackageCoverageForBooking(
  tx: DbExecutor,
  shopId: string,
  bookingId: string,
) {
  const released = await releaseEntitlementsForBooking(tx, shopId, bookingId);
  if (released.length === 0) return released;
  const [payment] = await tx
    .select()
    .from(bookingPayments)
    .where(and(eq(bookingPayments.shopId, shopId), eq(bookingPayments.bookingId, bookingId)))
    .limit(1);
  if (payment?.provider === "dive_package") {
    await setBookingPayment(tx, {
      shopId,
      bookingId,
      status: "unpaid",
      amountCents: null,
      currency: payment.currency,
      provider: null,
      providerRef: null,
      operation: "package_released",
    });
  }
  return released;
}

async function createBookingRecord(
  db: DbExecutor,
  req: BookingRequest,
  /**
   * Where this seat's declaration goes instead of straight to the database —
   * see {@link flushDeclarations} for why the write cannot happen here.
   */
  pending: PendingDeclaration[],
): Promise<BookingOutcome> {
  const tx = db;
  // FOR UPDATE serializes concurrent bookings on the same trip: under READ
  // COMMITTED two transactions could otherwise both read `booked = capacity-1`
  // and both insert. The unit suite runs on PGlite, which is single-connection
  // and therefore cannot exhibit the race — but this is no longer untested.
  // `src/db/bookings.postgres.test.ts` races two real connections for the last
  // seat against a genuine Postgres server in CI, and asserts exactly one
  // wins; with this `.for("update")` removed, a one-seat trip sells two.
  const [trip] = await tx
    .select()
    .from(trips)
    .where(and(eq(trips.id, req.tripId), eq(trips.shopId, req.shopId), liveTrip()))
    .limit(1)
    .for("update");
  if (trip?.status !== "scheduled" || trip.conditionsHold || hasSailed(trip.startsAt, nowDate())) {
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
    const { instructorCount, assistantCount } = await tripCourseCrewCounts(tx, trip.id);
    if (instructorCount === 0) return { ok: false, reason: "course_unstaffed" };
    // Which in-water ratio (if any) this session carries is decided in one
    // place — `courseRatioKind` in src/lib/course-ratios.ts — so a DSD taster
    // can't be gated at the Open Water number here and something else there.
    // Null means the session carries no ratio cap and falls back to the trip's
    // own stated capacity, same as before this gate existed.
    entryLevelSeatCap = courseSeatCapacity(course, instructorCount, assistantCount);
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
      if (!hasVerifiedCertificationAtLeast(cardRows, course.minimumCertificationLevel)) {
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

  // The trip's own cert/specialty/nitrox gate (DOM-M6). Every door that sells a
  // seat lands here — the public schedule form, `seatDiver`'s four staff doors,
  // the global add-booking flow, and a self-service reschedule — because they
  // all go through this one function; no call site re-implements it.
  //
  // Deliberately after capacity and the course gates, and before the walk-in's
  // person row is written: a full boat is refused as full rather than as a
  // prerequisite failure (a cheaper answer that says nothing about the diver),
  // and a refused walk-in leaves no orphan person behind.
  //
  // On a course session the course gate above *is* the admission rule and this
  // one stands down — continuing education dives at the sites it certifies
  // people for, so the itinerary's own gate would refuse the students the
  // course exists to create (`TripAdmissionInput.courseSession`).
  // **The sale-time certification gate informs; it does not refuse.**
  //
  // It used to return `trip_prerequisite` here and lose the sale. Three answers
  // reached this line on a gated charter: a rung at or above the requirement
  // (admitted), the select's own "Rather not say" default (admitted, since the
  // field is optional), and an honest lower rung — refused. So the only diver
  // it stopped was the one who answered truthfully and short, and the refusal
  // handed them the answer to give on the next attempt, which then persisted an
  // inflated claim onto their record. A gate that can be talked past has to
  // earn its refusals, and that one was punishing honesty
  // (FU-20260820-the-sale-gate-bites-only-the-honest, product owner 2026-08-20).
  //
  // The disclosure half is what does the work now, and it is stronger than the
  // stop ever was: the requirement is stated above the form, and each diver's
  // own answer is measured against it as they give it
  // (`BookingSections.tsx`'s `belowRequirementFor`).
  //
  // **Nothing about boarding changes.** `calculateReadiness` still clears on a
  // sighted card and nothing else, so this decides who may *buy* a seat, never
  // who may get on the boat. The advisory is carried out so a caller can say
  // what the trip asks; `blowout.ts` and `seat-claims.ts` still read
  // `decideTripAdmission` as a predicate and are untouched.
  const admission = await tripAdmissionFor(
    tx,
    req.shopId,
    trip.id,
    person,
    identityUnconfirmed,
    Boolean(trip.courseId),
    req.declared,
  );
  if (!admission.admitted && !advisable(req, admission.refusal)) {
    return { ok: false, reason: "trip_prerequisite", refusal: admission.refusal };
  }
  const admissionAdvisory = admission.admitted ? undefined : admission.refusal;

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
        // A reactivated row is a *new* booking and starts this booking's own
        // answers rather than inheriting its earlier life's — the same
        // reasoning `partyLeadBookingId` and `referralSource` give below.
        diveIntent: req.diveIntent ?? null,
        reEntryAsk: req.reEntryAsk ?? null,
        // Re-booking this seat re-evaluates identity: a matching name now clears
        // any stale flag, a mismatch (re)raises it.
        identityUnconfirmedAt: identityUnconfirmed ? nowDate() : null,
        // A reactivated row starts a *new* booking and must not inherit party
        // membership from its earlier life: a stale `party_lead_booking_id`
        // would list this fresh, independent seat in the old organizer's claim
        // panel and let them mint a claim link over it — a takeover path, not
        // a convenience (docs ADR 20260804-seat-claim-links). A party booking
        // that reactivates a row re-stamps the linkage right after this
        // returns (`createBookingParty`).
        partyLeadBookingId: null,
        claimedAt: null,
        // Same reasoning as the two lines above: a reactivated row is a *new*
        // booking, so it carries this booking's referral — including null,
        // which un-credits a partner who did not send this visit rather than
        // letting a cancelled seat's old attribution ride along.
        //
        // The cost, stated: a caller that reactivates a cancelled *public*
        // booking without passing a referral — a staff reschedule, a seat claim
        // — silently drops a genuine partner's credit through an act nobody
        // thinks of as touching attribution. Accepted over the alternative,
        // which is a stale credit surviving a cancellation nobody can see.
        referralSource: partnerReferralSlug(req.referralSource),
      })
      .where(eq(bookings.id, existing.id));
    await settlePackageCoverage(tx, {
      shopId: req.shopId,
      personId: person.id,
      bookingId: existing.id,
      identityUnconfirmed,
      trip: { courseId: trip.courseId, plannedDives: trip.plannedDives },
    });
    pending.push({ req, personId: person.id, identityUnconfirmed });
    return {
      ok: true,
      bookingId: existing.id,
      personId: person.id,
      personName: person.fullName,
      admissionAdvisory,
    };
  }

  const [created] = await tx
    .insert(bookings)
    .values({
      shopId: req.shopId,
      tripId: trip.id,
      personId: person.id,
      conditionsBriefedAt: trip.conditionsUpdatedAt,
      diveIntent: req.diveIntent ?? null,
      reEntryAsk: req.reEntryAsk ?? null,
      identityUnconfirmedAt: identityUnconfirmed ? nowDate() : null,
      referralSource: partnerReferralSlug(req.referralSource),
    })
    .returning();
  if (!created) throw new Error("createBooking: booking insert returned no row");
  pending.push({ req, personId: person.id, identityUnconfirmed });

  // **A prepaid dive, spent on this seat** (ADR
  // 20260822-a-package-is-entitlements-not-money).
  //
  // Inside this transaction on purpose: the claim has to be serialised with the
  // seat itself, or two concurrent bookings read the same unused dive and both
  // take it. `consumeEntitlementsForBooking` takes the executor it is given
  // for exactly that reason, and each update's `consumed_at is null` predicate
  // makes the individual claim atomic.
  //
  // Settled through `setBookingPayment` like every other paid seat — there is
  // deliberately **no second path to "paid"**, because `PAYMENT_CLEARED` is
  // what readiness, the manifest and the counter all consult, and a fourth
  // spelling of that fact is how three surfaces come to disagree.
  //
  // Nothing happens for a shop with no packages, or a diver with no covering
  // dive left: `consumeEntitlementForBooking` returns null and the booking pays
  // the ordinary way.
  //
  // **Never under an unconfirmed identity.** `persistDeclaration` below already
  // refuses to write a certification claim when `identityUnconfirmed` is set,
  // on the H-13 grounds that a statement made under a name disagreeing with the
  // matched row is not provably about that person. Spending that person's
  // prepaid property is the same act with a worse failure: anyone who knows a
  // regular's email could book seats in their name on the public form and drain
  // their package, and the victim's only notice would be a balance nothing
  // renders (`dive-domain-expert`, issue #706).
  await settlePackageCoverage(tx, {
    shopId: req.shopId,
    personId: person.id,
    bookingId: created.id,
    identityUnconfirmed,
    trip: { courseId: trip.courseId, plannedDives: trip.plannedDives },
  });

  return {
    ok: true,
    bookingId: created.id,
    personId: person.id,
    personName: person.fullName,
    admissionAdvisory,
  };
}

/** One seat's declaration, held until every seat in the submission is settled. */
type PendingDeclaration = {
  req: BookingRequest;
  personId: string;
  identityUnconfirmed: boolean;
};

/**
 * Write the submission's declarations in one pass, ordered by the id of the
 * `people` row each one locks.
 *
 * **The order is the point, not the batching.** `recordSelfDeclaredCards` opens
 * with `SELECT ... FOR UPDATE` on the person, and a lock taken inside a
 * transaction is held to commit — so a six-member party holds six `people`
 * locks, and used to take them in the order the form posted them. Two parties
 * on *different* trips naming the same two divers in opposite order therefore
 * took the same two locks in opposite order, and Postgres broke the cycle by
 * aborting one with `40P01`. That is not a `PartyBookingError`, so it did not
 * surface as a booking refusal that a caller could word: it escaped the server
 * action as an unhandled error and the diver saw a crash. Two seats, two trips,
 * opposite name order was the whole recipe.
 *
 * Sorting by the **resolved** id is what removes the cycle — not by submitted
 * order, and not by email, because the id is the thing being locked. Any total
 * order would do; this is the one every caller can agree on without
 * coordinating, since it is a property of the row itself.
 *
 * **This is half the fix, and it is the half that does not show up first.**
 * There is a second deadlock underneath it that ordering cannot touch, because
 * it is a lock *upgrade* on a single row: the `bookings` insert above takes
 * `FOR KEY SHARE` on the diver it names, and `recordSelfDeclaredCards` used to
 * ask for `FOR UPDATE` on that same tuple. Two submissions naming one diver
 * each waited for the other's key-share, on one row, with no second lock to
 * reorder. That is fixed where it lives — `self-declared-cards.ts` now takes
 * `FOR NO KEY UPDATE` — and this sort is still needed for the genuine two-row
 * cycle between two parties.
 *
 * **Not a retry loop, deliberately.** Catching `40P01` and trying again hides
 * the cycle instead of removing it, and doubles the write under exactly the
 * contention that provoked it.
 *
 * **Still inside the party transaction, and that is load-bearing.** It is what
 * makes a party refused at member N leave no certification row and no
 * `no_certification_declared_at` stamp for members 0..N-1 — the difference
 * between an anonymous poster paying a committed seat per claim they write onto
 * a stranger's record and paying nothing at all. `bookings.test.ts` pins it
 * ("a party refused at the last member writes no declaration for the first
 * five") so that a later refactor moving this write out of the transaction goes
 * red rather than quiet.
 */
async function flushDeclarations(tx: DbExecutor, pending: PendingDeclaration[]): Promise<void> {
  // Plain codepoint order, never `localeCompare`: the requirement is that every
  // concurrent submission agrees on the sequence, and a collation that depends
  // on the reader's locale is the one thing that could make two of them
  // disagree about the same pair of ids.
  const ordered = [...pending].sort((a, b) =>
    a.personId < b.personId ? -1 : a.personId > b.personId ? 1 : 0,
  );
  // Sequential on purpose: a drizzle transaction is one checked-out client, so
  // a fan-out here would be queued rather than parallel (`check:db-concurrency`).
  for (const entry of ordered) {
    await persistDeclaration(tx, entry.req, entry.personId, entry.identityUnconfirmed);
  }
}

/**
 * Write down what the diver said, now that the seat is actually theirs.
 *
 * **After the gate, never before it.** The declaration is read for the
 * admission decision as a value (`tripAdmissionFor`), so a submission that gets
 * refused persists nothing — which is what stops an anonymous form editing a
 * stranger's certification record simply by failing against it. On a completed
 * booking the claim is worth keeping: it is the number the verify queue works
 * from before the dive date.
 *
 * `recordSelfDeclaredCards` owns the rules from here, and they are unchanged —
 * a real card on file always wins and a claim is dropped rather than written
 * beside it, so this can only ever fill a gap.
 *
 * Skipped when the identity did not match (H-13): a statement made under a name
 * that disagrees with the row it resolved to is not provably about that person,
 * for the same reason their cards are not read.
 */
async function persistDeclaration(
  tx: DbExecutor,
  req: BookingRequest,
  personId: string,
  identityUnconfirmed: boolean,
): Promise<void> {
  const declared = req.declared;
  if (!declared || identityUnconfirmed) return;
  if (!declared.level && !declared.nitrox && !declared.noCertification) return;
  await recordSelfDeclaredCards(tx, {
    shopId: req.shopId,
    personId,
    level: declared.level ?? undefined,
    agency: declared.agency,
    identifier: declared.identifier,
    nitrox: declared.nitrox,
    // The answer the form was asking for all along. Dropping it here was the
    // "ask a question and discard the answer" failure ADR
    // 20260814-self-declared-cards exists against — and it is the *commonest*
    // answer at a shop selling Discover Scuba, so the silence it left looked
    // exactly like a diver nobody had asked.
    noCertification: declared.noCertification,
  });
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

/**
 * The diver's name on a booking, whatever its status — for the trip activity
 * log, which has to name the person on a *removal* too, when the row it is
 * describing has just gone cancelled. `getBookingForTrip` deliberately hides
 * cancelled bookings because it feeds a confirmation panel; the log is the
 * opposite case, so this is its own narrow read rather than a loosened filter
 * on that one.
 */
export async function bookingDiverName(db: AppDb, shopId: string, bookingId: string) {
  const [row] = await db
    .select({ fullName: people.fullName })
    .from(bookings)
    .innerJoin(people, eq(people.id, bookings.personId))
    .where(and(eq(bookings.id, bookingId), eq(bookings.shopId, shopId)))
    .limit(1);
  return row?.fullName ?? null;
}

export type RestoreBookingOutcome =
  | "restored"
  /**
   * The departure itself is gone — the crew stood it down, so there is no
   * manifest left to put anyone back on. Narrower than
   * `createBookingRecord`'s `trip_unavailable` on purpose: that word covers
   * three states a *new* seat can't be sold into, and only one of them is a
   * reason to refuse an undo. See `restoreBooking` for the other two.
   */
  | "trip_cancelled"
  | "already_active"
  | "trip_full"
  | "course_ratio_full"
  | "not_found";

/**
 * Undo of a roster removal. Only a currently-cancelled booking is restorable,
 * and only if the seat is still free — a waitlisted diver may have taken it
 * between the remove and the undo, and silently exceeding capacity would put
 * more divers on the manifest than the boat holds.
 *
 * "Free" means free under **both** limits the booking path applies: the trip's
 * own capacity and, on a ratio-gated course session, the crew's seat cap
 * (`courseSeatCapacity`). Undo is a seat-granting write like any other, and
 * checking capacity alone left the tightest control in the product one misclick
 * from being exceeded — remove a diver from a four-seat DSD, let a walk-up book
 * the freed seat, then tap Undo and a fifth uncertified first-timer joins one
 * instructor with no refusal at all.
 *
 * The trip itself is checked too, but only for the one state that makes an
 * undo meaningless: **cancelled**. An undo is not a new booking, and the two
 * remaining conditions `createBookingRecord` insists on are deliberately not
 * copied here.
 *
 * - *Conditions hold.* A hold means "existing bookings remain valid, new
 *   bookings pause" (glossary). The diver whose row was mis-tapped is an
 *   existing booking; putting them back is undoing a clerical slip, not
 *   selling a seat the hold was meant to stop.
 * - *Already departed.* `cancelBooking` has no trip-state gate at all and the
 *   Remove control renders on every roster row, including at sea — a departed
 *   trip is still `scheduled` and roll call stays live. Refusing the undo
 *   there would make a misclick on an at-sea manifest permanent, and the two
 *   errors are not symmetric: an under-listed manifest costs a search, an
 *   over-listed one costs a tap.
 *
 * Capacity and the course ratio still bind in both cases, so a seat that has
 * genuinely been taken is still refused.
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
      .where(and(eq(trips.id, booking.tripId), liveTrip()))
      .limit(1)
      .for("update");
    if (!trip) return "not_found";
    // Read under the same lock. A cancelled departure has no roster to
    // restore onto; reinstating the trip is the recovery, and then the undo
    // works. No hold check and no departure-time check here — see the doc
    // comment for why an undo is not a new booking.
    if (trip.status === "cancelled") return "trip_cancelled";
    const [row] = await tx
      .select({ booked: count(bookings.id) })
      .from(bookings)
      .where(and(eq(bookings.tripId, trip.id), ne(bookings.status, "cancelled")));
    const booked = row?.booked ?? 0;
    if (booked >= trip.capacity) return "trip_full";

    if (trip.courseId) {
      const [course] = await tx
        .select()
        .from(courses)
        .where(and(eq(courses.id, trip.courseId), eq(courses.shopId, shopId)))
        .limit(1);
      const { instructorCount, assistantCount } = await tripCourseCrewCounts(tx, trip.id);
      // Null means the session carries no ratio at all, so capacity alone binds
      // — exactly as before. A gated session that has since lost its last
      // instructor caps at zero and refuses too: a seat cannot be handed back
      // to a session that could not sell it in the first place.
      const seatCap = courseSeatCapacity(course ?? null, instructorCount, assistantCount);
      if (seatCap !== null && booked >= seatCap) return "course_ratio_full";
    }

    await tx
      .update(bookings)
      .set({ status: "booked" })
      .where(and(eq(bookings.id, bookingId), eq(bookings.status, "cancelled")));
    await settlePackageCoverage(tx, {
      shopId,
      personId: booking.personId,
      bookingId,
      identityUnconfirmed: booking.identityUnconfirmedAt !== null,
      trip: { courseId: trip.courseId, plannedDives: trip.plannedDives },
    });
    return "restored";
  });
}

export async function cancelBooking(db: AppDb, shopId: string, bookingId: string) {
  const booking = await cancelBookingRow(db, shopId, bookingId);
  // A diver just left the roster, which is a manifest change like any other —
  // and one that lands on shore while a captain may already be walking to the
  // boat (ADR 20260804-manifest-web-push). Published *after* the transaction
  // commits, never inside it: this fans out to a push service, and holding a
  // database transaction open across third-party HTTP is how a slow provider
  // becomes a lock-wait on the bookings table.
  if (booking) await publishManifestEvent(db, shopId, booking.tripId);
  return booking;
}

async function cancelBookingRow(db: AppDb, shopId: string, bookingId: string) {
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
    await revokeBookingCapabilities(tx, { shopId, bookingId });
    // And the units the diver never collected: a cancelled booking must not
    // keep tagged gear reserved against the divers who are actually coming
    // (ADR 20260815-minimal-gear-register). Checked-out units stay — they are
    // physically with someone, and the register's overdue chase brings those home.
    await releaseUnclaimedGearReservations(tx, { shopId, bookingId });
    // And the prepaid dive this seat spent, if it spent one. Undoing a link,
    // never crediting an amount, so it cannot round, drift, or give back more
    // than it took (ADR 20260822-a-package-is-entitlements-not-money). Inside
    // this transaction for the same reason the revoke above is: a diver whose
    // booking cancelled but whose dive stayed spent has silently lost it.
    await releasePackageCoverageForBooking(tx, shopId, bookingId);
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
      .where(and(eq(trips.id, row.tripId), liveTrip()))
      .limit(1);
    if (trip && hasSailed(trip.startsAt, now)) {
      return { ok: false, reason: "trip_departed" };
    }

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
    await revokeBookingCapabilities(tx, {
      shopId: input.shopId,
      bookingId: input.bookingId,
    });
    // Same rule as the staff cancel: un-collected units go back on the wall
    // with the seat (ADR 20260815-minimal-gear-register).
    await releaseUnclaimedGearReservations(tx, {
      shopId: input.shopId,
      bookingId: input.bookingId,
    });
    await releasePackageCoverageForBooking(tx, input.shopId, input.bookingId);
    return { ok: true };
  });
}

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
    .returning({ id: bookings.id });
  return Boolean(updated);
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
