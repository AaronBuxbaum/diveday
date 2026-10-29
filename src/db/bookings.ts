import { and, asc, desc, eq, gt, inArray, isNotNull, isNull, ne, sql } from "drizzle-orm";
import { checkMinimumAge, isPlausibleDateOfBirth } from "@/lib/age";
import { sellableSeats } from "@/lib/boat-safety";
import {
  bookingIdentityColumns,
  courseEnrollmentRefusal,
  courseRatioRefusal,
  type IdentityClaim,
  participantTypeRefusal,
} from "@/lib/booking-gates";
import { calendarDateInTimezone, isValidCalendarDate } from "@/lib/calendar-date";
import { nowDate } from "@/lib/clock";
import { courseSeatCapacity } from "@/lib/course-ratios";
import { countInWaterCrew, groupCrewAssignments } from "@/lib/crew-roles";
import { seatListPriceCents } from "@/lib/deposits";
import { typeChangedDeskEventKind } from "@/lib/desk-events";
import type { DiveIntent } from "@/lib/dive-intent";
import {
  type HeldContactChoice,
  heldContactCarry,
  movingHeldContact,
  seatName,
} from "@/lib/held-seat";
import { inTrainingBefore } from "@/lib/in-training";
import { normalizeEmailAddress } from "@/lib/inbox";
import { rowCanBeReactivated } from "@/lib/no-show";
import {
  holdsRegisterKind,
  isDiver,
  type ParticipantType,
  seatRefusal,
  typeChangeRefusal,
} from "@/lib/participant-types";
import { isCapturedPaymentStatus } from "@/lib/payment-source";
import { personNamesMatch } from "@/lib/person-name";
import type { ReEntryAsk } from "@/lib/re-entry";
import {
  BLOCKER_CATEGORY,
  type CertificationLevel,
  hasVerifiedCertificationAtLeast,
} from "@/lib/readiness";
import { partnerReferralSlug } from "@/lib/referrals";
import { requirementDemandsNothing, unionRequirements } from "@/lib/requirement";
import type { TrainingDiveCourse } from "@/lib/training-mark";
import {
  decideTripAdmission,
  type SelfDeclaration,
  type TripAdmission,
  type TripAdmissionEvidence,
  type TripAdmissionRefusal,
} from "@/lib/trip-admission";
import { hasReturned, hasSailed, MAX_PUBLIC_PARTY_SIZE } from "@/lib/trips";
import { type AboardHold, aboardAtSeaBookingIds } from "./aboard-at-sea";
import { revokeBookingCapabilities } from "./booking-capabilities";
import { readCertificationEvidence } from "./certification-evidence";
import { listCourseSeatsInTraining } from "./certifications-in-training";
import type { AppDb, DbExecutor } from "./client";
import {
  dateRequestOfferBookingFor,
  lockDateRequestOffer,
  moveDateRequestOfferBooking,
  recordDateRequestOfferBooking,
} from "./date-request-offer-bookings";
import { recordDeskEvent } from "./desk-events";
import { consumeEntitlementsForBooking, releaseEntitlementsForBooking } from "./dive-packages";
import { releaseUnclaimedGearReservations } from "./gear";
import { boundLockWaits } from "./lock-bounds";
import { publishManifestEvent } from "./manifest-events";
import { recordDiverActivity, recordSeatChange, recordTripActivity } from "./operations";
import { getBookingPayment, setBookingPayment } from "./payments";
import { findOrCreatePerson } from "./people";
import { storedPhone } from "./person-phone";
import { isUniqueConstraintViolation, queryAll } from "./query-helpers";
import { getBookingReadiness, getTripRequirements, getTripSiteRequirement } from "./readiness";
import {
  bookingCheckoutBookings,
  bookingCheckouts,
  bookingPayments,
  bookings,
  buddyPairMembers,
  certifications,
  courses,
  gearItemKind,
  gearReservations,
  inboundMessages,
  notificationSendQueue,
  people,
  personRoles,
  rollCallEvents,
  shops,
  tripAssignments,
  tripHelpRequests,
  trips,
  waiverRecords,
} from "./schema";
import { lockSeatDeparture } from "./seat-locks";
import { recordSelfDeclaredCards } from "./self-declared-cards";
import { getShopCurrency } from "./stripe-accounts";
import { markableTrainingDives } from "./training-mark-resolve";
import { dropTrainingMarkWithin } from "./training-marks";
import { type SendRescheduleNoticesOptions, sendMissedRescheduleNotice } from "./trip-rescheduled";
import { liveTrip } from "./trips-live";
import {
  heldSeatCounts,
  liveBookingJoin,
  sellableCapacity,
  tripBoatCertifiedPassengers,
} from "./trips-queries";
import { CLEARED_DRAFT_COLUMNS } from "./waiver-record-columns";

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
  | {
      personId: string;
      /**
       * This person may not have been *picked* — the staffer tapped a name off
       * the counter's "is this the same diver?" prompt, whose candidates come
       * from `lower(full_name) = lower(typed) OR similarity() > 0.4`
       * (`findSimilarDivers`, issue #1556).
       *
       * That prompt fires on genuinely different people, so a seat taken from
       * it must not silently inherit the matched diver's certifications,
       * sign-once waiver coverage and rental fit. It also fires on an exact
       * spelling, which is why this carries `typedName` rather than a bare
       * boolean: the flag is raised by the same test the by-email path uses,
       * not by the tap. See {@link nameMatchLeavesIdentityInDoubt}.
       *
       * Raised, it means what a shared-inbox email mismatch means (H-13): the
       * diver is Blocked at the rail until a staffer taps confirm identity,
       * and no certification claim is written under their name.
       *
       * Absent on every other identity booking, which is the point — a
       * returning diver picked out of the search by a staffer who went looking
       * for them is not a guess, and "enter once, reuse everywhere" has to keep
       * costing nothing.
       *
       * **Re-decided after the phone arm widened, and kept** (H-79, issue
       * #1790, 2026-09-16). Since #1765 the search also matches a punctuated
       * or national-only number against the stored E.164, so a ten-digit
       * needle can reach a row in another country, and the search list is
       * longer than it was. The owner ruled that a seat picked from it still
       * lands released: choosing a row is a deliberate act, every row prints
       * the name, email and grouped phone to read before the tap, and a held
       * seat there would cost a tap on every ordinary search-and-seat. Holding
       * only phone-arm matches was considered and not taken. Do not add the
       * flag to the search door, and do not narrow the search, anchor the
       * phone match or raise the digit floor instead: each re-breaks the
       * pasted-number case #1765 fixed. Pinned in `seat-diver.test.ts`.
       */
      fromNameMatch?: { typedName: string };
    }
  | { fullName: string; email?: string; phone?: string; freshPerson?: FreshPersonDetails };

/**
 * What a door knows about somebody it is seating for the first time, written
 * onto the new person row **in the booking's own transaction** — the dock's
 * emergency contact and date of birth (batch 4, D6), so a rider never exists
 * for a moment without them. Only ever written to a row this booking creates
 * with no email: a person matched or created by email goes through
 * `findOrCreatePerson` and keeps what that record says.
 */
export type FreshPersonDetails = {
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  /** `YYYY-MM-DD`, already checked by the caller. */
  dateOfBirth?: string;
};

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
  /** Explicit request context; no person identity is inferred. */
  dateRequestInterestId?: string;
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
  /**
   * **Whoever booked this seat said its diver is under 18** (the public party
   * form's "Under 18" box; decision of 2026-10-13, after H-21). Stamped on the
   * seat as `minor_declared_at`, never on the person: the form is anonymous,
   * so it may only mark the seat it is creating. It gates nothing here (no age
   * oracle at the sale, H-22); the guardian co-signature rule reads it where
   * no date of birth is on file.
   */
  minorDeclared?: boolean;
  /**
   * What this person is doing on the boat (ADR 20261007-participant-types).
   * Omitted is a diver, which is every caller that predates the type and the
   * stricter reading: a diver is asked for more, never less.
   *
   * A snorkeler or a rider holds a seat against the boat's capacity like
   * anyone else, skips the certification gate (there is nothing to dive), is
   * never counted against the divers-only limit, and is refused outright on a
   * course session — a training dive is diving.
   */
  participantType?: ParticipantType;
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
        /**
         * The boat has room, but every seat this departure lets a diver take
         * is taken (`trips.diver_capacity`). A snorkeler or a rider would
         * still fit.
         */
        | "divers_full"
        /**
         * A snorkeler's or a rider's seat on a course session. A training dive
         * is diving; there is no seat on it for someone who is not.
         */
        | "participant_type_unavailable"
        | "already_booked"
        | "course_unstaffed"
        | "course_prerequisite"
        | "course_ratio_full"
        | "course_min_age"
        | "person_not_found"
        | "date_request_offer_unavailable"
        | "date_request_departure_conflict"
        | "date_request_party_full";
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
  /**
   * The seat is real and it is **held**: this booking attached itself to an
   * existing person on something short of proof, so the row is stamped
   * `identityUnconfirmedAt`, readiness fails closed, and none of that person's
   * cards, waiver or package reach the seat until a staffer confirms it
   * (H-13, issue #1556).
   *
   * Reported rather than left for the caller to re-read, because the caller
   * that most needs it is the one furthest from the row: every staff seating
   * door answered a plain "Added" for a held seat, and the staffer learned the
   * seat was held on the next tap — a check-in refusal, three screens from the
   * confirm control (`dive-domain-expert`, 2026-09-11).
   */
  identityUnconfirmed: boolean;
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
        /** {@link BookingSuccess.identityUnconfirmed}, per seat. */
        identityUnconfirmed: boolean;
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
        identityUnconfirmed: boolean;
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
        //
        // A party **staff** seat is stamped claimed as it is made (security
        // review N3): the counter typed each name with that person standing at
        // the desk, so no claim link from the lead's readiness page may
        // re-point the seat to whoever opens it. The public party form's seats
        // stay claimable, which is what the claim link is for.
        const leadBookingId = created[0]?.bookingId;
        if (index > 0 && leadBookingId) {
          await tx
            .update(bookings)
            .set({
              partyLeadBookingId: leadBookingId,
              ...(request.actor === "staff" ? { claimedAt: nowDate() } : {}),
            })
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

/**
 * Why a seat could not be added to a booking from the diver's own page.
 * `lead_unavailable` covers every reason the booking itself cannot lead one
 * (cancelled, held, a party member's own seat, not this shop's), never
 * distinguished to a diver; `party_full` is the public form's own party cap.
 */
export type AddPartySeatOutcome =
  | { ok: true; bookingId: string }
  | { ok: false; reason: "lead_unavailable" | "party_full" }
  | BookingRefusal;

/**
 * **"Add a seat" from `/ready`** (UX review 2026-10-11, item 13; owner
 * decision of the same review, §5.5: yes, because it adds a booking rather than
 * changing one). A diver who booked alone and now wants to bring a friend gets
 * a new seat in their party, held under the name they type, with a claim link
 * the organizer's panel then shows (docs ADR 20260804-seat-claim-links), so
 * the friend fills in their own details, waiver and card.
 *
 * **The same gates as booking a seat**, because it is one: the seat goes
 * through `createBookingRecord` as an anonymous public booking, so capacity,
 * the divers-only limit, the course ratio and the trip's admission rule are
 * re-checked inside this transaction exactly as the schedule's form checks
 * them, and a departed or cancelled trip refuses. The party never grows past
 * the public form's own cap. An unpaid seat raises `payment_due`, which the
 * boarding gate already holds, so nothing here can put an unpaid diver aboard.
 *
 * Authorization is the caller's: a verified readiness capability over
 * `leadBookingId`. This only refuses a lead that cannot lead a party — a held
 * seat (whose record may be somebody else's, issue #2125), a party member's
 * own seat, or a cancelled one.
 */
export async function addPartySeat(
  db: AppDb,
  input: { shopId: string; leadBookingId: string; seatName: string },
): Promise<AddPartySeatOutcome> {
  return db.transaction(async (tx): Promise<AddPartySeatOutcome> => {
    const [lead] = await tx
      .select({
        id: bookings.id,
        tripId: bookings.tripId,
        personId: bookings.personId,
        status: bookings.status,
        identityUnconfirmedAt: bookings.identityUnconfirmedAt,
        partyLeadBookingId: bookings.partyLeadBookingId,
      })
      .from(bookings)
      .where(and(eq(bookings.id, input.leadBookingId), eq(bookings.shopId, input.shopId)))
      .limit(1)
      // One add at a time per party, so two taps cannot both pass the cap.
      .for("update");
    if (
      !lead ||
      lead.status === "cancelled" ||
      lead.identityUnconfirmedAt ||
      lead.partyLeadBookingId
    ) {
      return { ok: false, reason: "lead_unavailable" };
    }
    const members = await tx
      .select({ id: bookings.id })
      .from(bookings)
      .where(
        and(
          eq(bookings.shopId, input.shopId),
          eq(bookings.partyLeadBookingId, lead.id),
          ne(bookings.status, "cancelled"),
        ),
      );
    if (members.length + 1 >= MAX_PUBLIC_PARTY_SIZE) return { ok: false, reason: "party_full" };
    const pending: PendingDeclaration[] = [];
    const outcome = await createBookingRecord(
      tx,
      { actor: "public", shopId: input.shopId, tripId: lead.tripId, fullName: input.seatName },
      pending,
    );
    if (!outcome.ok) return outcome;
    await tx
      .update(bookings)
      .set({ partyLeadBookingId: lead.id })
      .where(eq(bookings.id, outcome.bookingId));
    await flushDeclarations(tx, pending);
    // The departure's trail says where the booking came from: the lead, from
    // their own trip link, the way the self-cancel line does (#2475).
    await recordTripActivity(tx, {
      shopId: input.shopId,
      tripId: lead.tripId,
      actorPersonId: lead.personId,
      subjectPersonId: outcome.personId,
      entry: { code: "seat_added_from_trip_link", diver: input.seatName },
    });
    return { ok: true, bookingId: outcome.bookingId };
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
 * never read a looser crew than the booking that preceded it. Exported for the
 * counter's other seat-granting undo, `undoBookingNoShow` (src/db/no-show.ts):
 * a second copy of this query is a second chance for the two undos to disagree
 * about who is in the water.
 *
 * **The roster's claim, deliberately — not the supervision claim** (issue
 * #1853). Today, the staffing week and the trip page read each professional's
 * recorded ratings (`courseCrewCountsByTrip`, src/db/course-crew-counts.ts), so a lapsed
 * instructor stops counting there. This passes no `lapsedRungs`, so the sale
 * gate, the seat cap and the no-show hand-back go on counting them: H-59
 * (docs/product/human-decisions/README.md) closed new-sale refusal on a locally
 * recorded renewal date, and the 2026-09-16 ruling reopened only the ratio. A
 * shop whose instructor renewed last week and has not updated DiveDay does
 * not lose a sale on Saturday morning; it sees the gap, worded, on the
 * surfaces where it can fix the record.
 */
export async function tripCourseCrewCounts(
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
 * **How many students this departure's course crew may seat**, the one measure
 * the wait-list join and the roll read (issue #2679): null when the departure
 * is no course session or its course carries no ratio, 0 when no instructor is
 * rostered (the sale refuses `course_unstaffed`), otherwise
 * `courseSeatCapacity` over the rostered crew. The sale reads the same parts
 * inside its own lock in `createBookingRecord`, which needs the course row for
 * its enrollment gates as well.
 */
export async function courseStudentSeatCap(
  tx: DbExecutor,
  trip: { id: string; shopId: string; courseId: string | null },
): Promise<number | null> {
  if (!trip.courseId) return null;
  const [course] = await tx
    .select()
    .from(courses)
    .where(and(eq(courses.id, trip.courseId), eq(courses.shopId, trip.shopId)))
    .limit(1);
  const { instructorCount, assistantCount } = await tripCourseCrewCounts(tx, trip.id);
  if (instructorCount === 0) return 0;
  return courseSeatCapacity(course ?? null, instructorCount, assistantCount);
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
  /** A seat that is not a diver's is asked for no card, so nothing is read for it. */
  participantType: ParticipantType = "diver",
): Promise<TripAdmission> {
  if (!isDiver(participantType)) {
    return decideTripAdmission({
      requirement: null,
      siteRequirement: null,
      evidence: NO_EVIDENCE,
      participantType,
    });
  }
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
  // `queryAll` in `src/db/query-helpers.ts`.
  const [requirement, siteRequirement] = await queryAll(tx, [
    () => getTripRequirements(tx, shopId, tripId),
    () => getTripSiteRequirement(tx, shopId, tripId),
  ]);
  const demandsSomething = !requirementDemandsNothing(
    unionRequirements(requirement, siteRequirement),
  );
  // The three evidence reads are skipped entirely when the trip demands
  // nothing or the diver is unknown to it — neither case can produce a
  // refusal, and every booking in the product would otherwise pay for them.
  const evidence: TripAdmissionEvidence =
    person && !identityUnconfirmed && demandsSomething
      ? {
          ...(await readCertificationEvidence(tx, shopId, person.id)),
          levelsInTraining: await levelsInTrainingBefore(tx, shopId, person.id, tripId),
          trainingDives: await trainingDivesOn(tx, shopId, person.id, tripId),
        }
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

/**
 * The levels this diver's booked courses certify them at by the time this
 * trip sails (`src/db/certifications-in-training.ts`). Admission sells the
 * seat on them; readiness still waits for the card.
 */
async function levelsInTrainingBefore(
  tx: DbExecutor,
  shopId: string,
  personId: string,
  tripId: string,
): Promise<CertificationLevel[]> {
  const [[trip], seats] = await queryAll(tx, [
    () =>
      tx
        .select({ id: trips.id, startsAt: trips.startsAt })
        .from(trips)
        .where(and(eq(trips.id, tripId), eq(trips.shopId, shopId), liveTrip()))
        .limit(1),
    () => listCourseSeatsInTraining(tx, shopId, [personId]),
  ]);
  return trip ? inTrainingBefore(seats, trip, nowDate()).map((course) => course.level) : [];
}

/**
 * The courses a staff training mark could make this departure answer to,
 * with room for the candidate under the shared modeled training room
 * (`markableTrainingDives`, issue #2731). Admission may consider this
 * candidate-room data at sale time; readiness resolves a saved mark again at
 * boarding. Neither the plan nor this estimate proves actual underwater
 * groups or assistant supervision.
 */
async function trainingDivesOn(
  tx: DbExecutor,
  shopId: string,
  personId: string,
  tripId: string,
): Promise<TrainingDiveCourse[]> {
  const [trip] = await tx
    .select({ id: trips.id, startsAt: trips.startsAt })
    .from(trips)
    .where(and(eq(trips.id, tripId), eq(trips.shopId, shopId), liveTrip()))
    .limit(1);
  return trip ? markableTrainingDives(tx, shopId, personId, trip) : [];
}

/** What a diver this shop knows nothing about has on file — and what an unread evidence lookup stands in for. */
const NO_EVIDENCE: TripAdmissionEvidence = {
  certifications: [],
  specialtyCertifications: [],
  nitroxCertifications: [],
};

async function settlePackageCoverage(
  tx: DbExecutor,
  input: {
    shopId: string;
    personId: string;
    bookingId: string;
    identityUnconfirmed: boolean;
    /**
     * A rehearsal spends nothing (ADR 20261012-rehearsal-departures): its seats
     * are test divers, and a regular who helps on training day keeps the dives
     * they paid for.
     */
    trip: { courseId: string | null; plannedDives: number; isRehearsal: boolean };
    /**
     * A package is prepaid **dives**. A snorkeler's or a rider's seat dives
     * nothing, so it spends none of the holder's: a regular who brings their
     * partner along to ride must not find two of their own dives gone.
     */
    participantType: ParticipantType;
  },
) {
  if (input.identityUnconfirmed || !isDiver(input.participantType) || input.trip.isRehearsal) {
    return [];
  }
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

/**
 * Does a tap on the counter's name prompt actually leave the identity in doubt?
 *
 * The prompt's candidates are `lower(full_name) = lower(typed)` **or**
 * `similarity() > 0.4` (`findSimilarDivers`), so the regular a shop has carded
 * fifteen times is on it every time a staffer spells the name right. Flagging
 * that seat put a blocker on the ordinary morning: twenty taps of confirm
 * identity before lunch, and the shop learns to tap it without reading it —
 * which spends exactly the credibility H-13's blocker needs to keep
 * (`dive-domain-expert`, the RFH-07 layer). So the tap alone no longer decides;
 * the same test the by-email path at `createBookingRecord` uses does, on the
 * name the staffer actually typed.
 *
 * The one case a matching spelling does not settle is the real "which John
 * Smith": when a second diver in this shop answers to that exact name, the
 * prompt listed both and the tap was a coin flip however well the spelling
 * agrees. Counted here rather than sent from the door, because a door
 * asserting its own ambiguity is a door that can forget to.
 */
async function nameMatchLeavesIdentityInDoubt(
  tx: DbExecutor,
  shopId: string,
  matched: { id: string; fullName: string },
  typedName: string,
): Promise<boolean> {
  // An empty typed name reads as disagreement, not as agreement: a door that
  // marks a tap as a guess and then sends nothing to compare it with must fail
  // towards the blocker.
  if (!personNamesMatch(matched.fullName, typedName)) return true;
  const namesakes = await tx
    .select({ id: people.id })
    .from(people)
    .innerJoin(personRoles, eq(personRoles.personId, people.id))
    .where(
      and(
        eq(people.shopId, shopId),
        eq(personRoles.role, "diver"),
        isNull(people.deletedAt),
        ne(people.id, matched.id),
        // The prompt's exact-match branch, restated: a namesake is another row
        // the staffer was offered under the same spelling.
        eq(sql`lower(${people.fullName})`, typedName.trim().toLowerCase()),
      ),
    )
    .limit(1);
  return namesakes.length > 0;
}

/**
 * The row a booking with no email inserts for its new person: the typed name,
 * the stored phone, and whatever {@link FreshPersonDetails} the door carried.
 */
async function noEmailPersonRow(
  tx: DbExecutor,
  req: BookingRequest,
  pendingInsert: { fullName: string; phone?: string },
) {
  return {
    shopId: req.shopId,
    fullName: pendingInsert.fullName,
    email: null,
    phone: await storedPhone(tx, req.shopId, pendingInsert.phone),
    ...("personId" in req ? undefined : req.freshPerson),
  };
}

/**
 * Whether this departure takes a seat from this actor at all: still scheduled,
 * not held for conditions, not sailed — and, for a rehearsal, only from staff,
 * who seat its test divers (ADR 20261012-rehearsal-departures).
 */
function tripTakesSeatFrom(
  trip: typeof trips.$inferSelect | undefined,
  actor: BookingRequest["actor"],
): trip is typeof trips.$inferSelect {
  if (trip?.status !== "scheduled" || trip.conditionsHold) return false;
  if (hasSailed(trip.startsAt, nowDate())) return false;
  return actor === "staff" || !trip.isRehearsal;
}

/**
 * **One lock order for a seat: the departure's trip row, then the booking
 * row** (#2324). Every writer that touches both takes them in this order —
 * `createBookingRecord` below, `restoreBooking`, `setBookingParticipantType`,
 * and, through `lockSeatDeparture` (`./seat-locks.ts`), `markBookingNoShow`,
 * `undoBookingNoShow`, `checkInBooking`, `undoCheckInBooking` and the rail's
 * `recordRollCall`; and the crew's `recordCrewRollCall`, which locks its trip
 * read before a crew member's own seat (`./manifests.ts`). Two writers taking the pair in opposite orders deadlock
 * when they meet, and a staffer's tap fails. A path that goes on to lock an
 * *existing* booking takes the trip `for no key update`, so a transaction
 * that holds a booking and only needs a `KEY SHARE` on the trip (a roll-call
 * or activity insert's foreign key) is never stuck behind it.
 * `seat-lock-order.postgres.test.ts` races the pairs on a real server.
 */
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
  await boundLockWaits(tx);
  // FOR NO KEY UPDATE (not FOR UPDATE, which also blocks every insert that
  // references the trip by foreign key) serializes concurrent bookings on the
  // same trip, as the roll-call and series paths do: under READ
  // COMMITTED two transactions could otherwise both read `booked = capacity-1`
  // and both insert. The unit suite runs on PGlite, which is single-connection
  // and therefore cannot exhibit the race — but this is no longer untested.
  // `src/db/bookings.postgres.test.ts` races two real connections for the last
  // seat against a genuine Postgres server in CI, and asserts exactly one
  // wins; with this `.for("no key update")` removed, a one-seat trip sells two.
  const [trip] = await tx
    .select()
    .from(trips)
    .where(and(eq(trips.id, req.tripId), eq(trips.shopId, req.shopId), liveTrip()))
    .limit(1)
    .for("no key update", { of: trips });
  if (!tripTakesSeatFrom(trip, req.actor)) return { ok: false, reason: "trip_unavailable" };
  const dateOffer = req.dateRequestInterestId
    ? await lockDateRequestOffer(tx, {
        shopId: req.shopId,
        tripId: req.tripId,
        requestId: req.dateRequestInterestId,
      })
    : null;
  if (typeof dateOffer === "string") return { ok: false, reason: dateOffer };
  const participantType: ParticipantType = req.participantType ?? "diver";
  // The public form sells only the types this departure prices, and a course
  // session takes a non-diver only at a price the shop named, read on the
  // locked row (`participantTypeRefusal`).
  const typeRefusal = participantTypeRefusal({ actor: req.actor, participantType, trip });
  if (typeRefusal) return { ok: false, reason: typeRefusal };

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

  const resolved = await resolveBookingPerson(tx, req);
  if (!resolved.ok) return resolved;
  let { person, identityUnconfirmed, identityClaim } = resolved;
  const { pendingInsert } = resolved;

  // Enrollment is a diver's (issue #2226): a snorkeler or a rider on a course
  // session is a passenger beside the students, asked none of the course's
  // card or age gates and counted against none of its in-water ratio.
  const student = Boolean(course) && isDiver(participantType);
  if (course && student) {
    const refusal = await courseEnrollmentFor(tx, req, course, person, trip.startsAt);
    if (refusal) return { ok: false, reason: refusal };
  }

  // `seatHeld`, not "every status but cancelled": a seat a staffer marked
  // absent at the counter is the shop's to sell again, and this count is the
  // one gate every door that sells a seat lands on (issue #1209).
  //
  // **Two limits, both read under the trip-row lock above** (ADR
  // 20261007-participant-types). Every held seat counts against the boat —
  // a snorkeler and a rider are bodies like anyone else — and divers alone
  // count against `diver_capacity`. Never a pre-check: the counts are read
  // here, inside the transaction that inserts.
  //
  // **The boat's limit is the certificate's when that is lower** (H-107):
  // `sellableCapacity` caps `trips.capacity` at the boat's certified passenger
  // number, read here under the same lock. The forms refuse an over-limit
  // capacity, but a copied, rolled, reinstated or pre-H-107 departure can
  // still carry one, and this is the one gate all of them reach.
  const held = await heldSeatCounts(tx, trip.shopId, trip.id);
  const seatFull = seatRefusal(
    participantType,
    { ...trip, capacity: await sellableCapacity(tx, trip) },
    held,
  );
  if (seatFull) {
    return { ok: false, reason: seatFull };
  }
  // The ratio counts students, who are the divers on a course session.
  const ratioRefusal = student ? courseRatioRefusal(held.divers, entryLevelSeatCap) : null;
  if (ratioRefusal) return { ok: false, reason: ratioRefusal };

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
    participantType,
  );
  if (!admission.admitted && !advisable(req, admission.refusal)) {
    return { ok: false, reason: "trip_prerequisite", refusal: admission.refusal };
  }
  const admissionAdvisory = admission.admitted ? undefined : admission.refusal;

  // A seat with no email of its own inserts a fresh person (`noEmailPersonRow`),
  // which this booking then stamps as its own (issue #2665).
  const madeByThisSeat = !person && pendingInsert !== null && !pendingInsert.email;
  if (!person && pendingInsert) {
    ({ person, identityUnconfirmed, identityClaim } = await writeWalkIn(tx, req, pendingInsert));
  }
  // Only reachable on the identity path if the row vanished mid-transaction;
  // the walk-in path always has a pendingInsert. Guards the non-null uses below.
  if (!person) return { ok: false, reason: "person_not_found" };

  const outcome = await writeSeat(tx, {
    req,
    trip,
    person,
    participantType,
    identityUnconfirmed,
    identityClaim,
    admissionAdvisory,
    pending,
  });
  if (outcome.ok && dateOffer) {
    const linked = await recordDateRequestOfferBooking(tx, {
      shopId: req.shopId,
      offerId: dateOffer.offerId,
      bookingId: outcome.bookingId,
      partySize: dateOffer.partySize,
    });
    if (!linked) throw new Error("locked date request offer could not accept its booking");
  }
  if (madeByThisSeat && outcome.ok) {
    await tx
      .update(people)
      .set({ createdByBookingId: outcome.bookingId })
      .where(
        and(
          eq(people.id, person.id),
          eq(people.shopId, req.shopId),
          isNull(people.createdByBookingId),
        ),
      );
  }
  return outcome;
}

/**
 * **The seat itself**, once every gate in `createBookingRecord` has passed and
 * the person row exists: a cancelled seat for this diver on this departure is
 * reactivated as a new booking, anything else live is `already_booked`, and
 * otherwise a fresh row is inserted. Either way any prepaid dive covering it is
 * spent here, in the same transaction, and the seat's declaration is queued
 * for `flushDeclarations`.
 */
async function writeSeat(
  tx: DbExecutor,
  input: {
    req: BookingRequest;
    trip: typeof trips.$inferSelect;
    person: typeof people.$inferSelect;
    participantType: ParticipantType;
    identityUnconfirmed: boolean;
    identityClaim: IdentityClaim | null;
    admissionAdvisory: BookingAdmissionAdvisory | undefined;
    pending: PendingDeclaration[];
  },
): Promise<BookingOutcome> {
  const { req, trip, person, participantType, identityUnconfirmed, identityClaim } = input;
  const { admissionAdvisory, pending } = input;
  const [existing] = await tx
    .select()
    .from(bookings)
    .where(and(eq(bookings.tripId, trip.id), eq(bookings.personId, person.id)))
    .limit(1);
  if (existing && rowCanBeReactivated(existing.status, trip.startsAt)) {
    const link = await dateRequestOfferBookingFor(tx, {
      shopId: req.shopId,
      bookingId: existing.id,
    });
    if (link) {
      if (
        link.tripId !== req.tripId ||
        (req.dateRequestInterestId && link.requestId !== req.dateRequestInterestId)
      ) {
        return { ok: false, reason: "date_request_departure_conflict" };
      }
      if (!req.dateRequestInterestId && link.requestId) {
        const pinnedOffer = await lockDateRequestOffer(tx, {
          shopId: req.shopId,
          tripId: req.tripId,
          requestId: link.requestId,
          excludeBookingId: existing.id,
        });
        if (typeof pinnedOffer === "string") return { ok: false, reason: pinnedOffer };
      }
    }
  }
  if (existing) {
    if (!rowCanBeReactivated(existing.status, trip.startsAt)) {
      return { ok: false, reason: "already_booked" };
    }
    await tx
      .update(bookings)
      .set({
        status: "booked",
        // A new booking, so no turn-away from the row's last life.
        turnedAwayReason: null,
        turnedAwayAt: null,
        // A reactivated row is a new booking and takes this booking's type.
        // An old nitrox request rides along only for a diver: enriched air is
        // something a diver breathes, and the column's check refuses it on
        // anybody else's seat.
        participantType,
        bookedAs: participantType,
        ...(isDiver(participantType) ? {} : { wantsNitrox: false }),
        conditionsBriefedAt: trip.conditionsUpdatedAt,
        // A reactivated row is a *new* booking and starts this booking's own
        // answers rather than inheriting its earlier life's — the same
        // reasoning `partyLeadBookingId` and `referralSource` give below.
        diveIntent: req.diveIntent ?? null,
        reEntryAsk: req.reEntryAsk ?? null,
        // Re-booking this seat re-evaluates identity: a matching name now clears
        // any stale flag, a mismatch (re)raises it.
        ...bookingIdentityColumns(identityUnconfirmed, identityClaim, nowDate()),
        // A reactivated row starts a *new* booking and must not inherit party
        // membership from its earlier life: a stale `party_lead_booking_id`
        // would list this fresh, independent seat in the old organizer's claim
        // panel and let them mint a claim link over it — a takeover path, not
        // a convenience (docs ADR 20260804-seat-claim-links). A party booking
        // that reactivates a row re-stamps the linkage right after this
        // returns (`createBookingParty`).
        partyLeadBookingId: null,
        claimedAt: null,
        // "Running late" (J3) was said about the seat's earlier life.
        runningLateAt: null,
        // Same reasoning as the two lines above: a reactivated row is a *new* booking, so it
        // carries this booking's referral — including null, which un-credits a partner who did not
        // send this visit rather than letting a cancelled seat's old attribution ride along.
        //
        // The cost, stated: a caller that reactivates a cancelled *public* booking without passing
        // a referral — a staff reschedule, a seat claim — silently drops a genuine partner's credit
        // through an act nobody thinks of as touching attribution. Accepted over the alternative,
        // which is a stale credit surviving a cancellation nobody can see.
        referralSource: partnerReferralSlug(req.referralSource),
        minorDeclaredAt: req.minorDeclared ? nowDate() : null,
      })
      .where(eq(bookings.id, existing.id));
    await settlePackageCoverage(tx, {
      shopId: req.shopId,
      personId: person.id,
      bookingId: existing.id,
      identityUnconfirmed,
      trip,
      participantType,
    });
    pending.push({ req, personId: person.id, identityUnconfirmed });
    return {
      ok: true,
      bookingId: existing.id,
      personId: person.id,
      personName: person.fullName,
      identityUnconfirmed,
      admissionAdvisory,
    };
  }

  const [created] = await tx
    .insert(bookings)
    .values({
      shopId: req.shopId,
      tripId: trip.id,
      personId: person.id,
      participantType,
      bookedAs: participantType,
      conditionsBriefedAt: trip.conditionsUpdatedAt,
      diveIntent: req.diveIntent ?? null,
      reEntryAsk: req.reEntryAsk ?? null,
      ...bookingIdentityColumns(identityUnconfirmed, identityClaim, nowDate()),
      referralSource: partnerReferralSlug(req.referralSource),
      minorDeclaredAt: req.minorDeclared ? nowDate() : null,
      // **Stamped by the application clock, not the column's `defaultNow()`.**
      //
      // `defaultNow()` is Postgres' clock, which `DIVEDAY_CLOCK` does not
      // reach — `src/test/db.ts`'s `dbNow` docblock is the long version. That
      // was harmless while nothing compared this column against an
      // app-stamped one; the diver's thread now does, asking whether
      // `rental_fit_profiles.fit_stated_at` predates this booking to decide
      // whether a diver is returning.
      //
      // A comparison that straddles the two clocks "compares a frozen instant
      // against a live one, and the row is selected only while the two happen
      // to fall in the right order" — and under the e2e harness the frozen
      // instant sits weeks behind the wall clock, so *every* fit looked like
      // last season's and every diver looked like a returning one. Both sides
      // of that comparison now come from the same clock.
      //
      // Production is unchanged: with no override the app clock is the live
      // one, so this is the same instant `defaultNow()` would have written,
      // give or take the round trip.
      createdAt: nowDate(),
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
  // renders (`dive-domain-expert`, issue #706). Withheld, not forfeited:
  // `settleConfirmedPackageCoverage` spends them when staff clear the flag.
  await settlePackageCoverage(tx, {
    shopId: req.shopId,
    personId: person.id,
    bookingId: created.id,
    identityUnconfirmed,
    trip,
    participantType,
  });

  return {
    ok: true,
    bookingId: created.id,
    personId: person.id,
    personName: person.fullName,
    identityUnconfirmed,
    admissionAdvisory,
  };
}

/**
 * **Who this seat is for**, read under the trip lock before any gate decides.
 *
 * Returns the person row when one exists, or the row to write for a walk-in
 * once every gate has passed (`pendingInsert`; {@link writeWalkIn}), and
 * whether the match stands on something short of proof (H-13).
 */
async function resolveBookingPerson(
  tx: DbExecutor,
  req: BookingRequest,
): Promise<
  | { ok: false; reason: "person_not_found" }
  | {
      ok: true;
      person: typeof people.$inferSelect | undefined;
      pendingInsert: PendingWalkIn | null;
      identityUnconfirmed: boolean;
      identityClaim: IdentityClaim | null;
    }
> {
  // Resolve the diver. A returning diver picked by identity reuses that exact
  // person row (the whole point of "enter once"); a walk-in is looked up by
  // email so a re-typed regular still collapses onto their record. A
  // soft-deleted person's email is free (matching createDiver): a rebooking
  // diver whose record staff removed gets a fresh person row, not a booking
  // attached to a record that's invisible on the roster. Any new walk-in row is
  // only written after the capacity gate passes (`pendingInsert`).
  let person: typeof people.$inferSelect | undefined;
  let pendingInsert: PendingWalkIn | null = null;
  // Set when this booking attached itself to an existing person on something
  // short of proof, and must not silently inherit that person's evidence
  // (H-13). Two ways in, and a fresh no-email row raises neither because it has
  // no prior identity to disagree with:
  //
  //  - the by-email path reused a row whose name on file does not match the
  //    submitted one — the shared-inbox / different-human signal this flag was
  //    built for;
  //  - the identity path carries `fromNameMatch`, meaning the person id came
  //    off the counter's name prompt rather than out of a search a staffer went
  //    looking in (issue #1556) — and, on that path, the typed name disagrees
  //    with the one on file, or two divers answer to it.
  //
  // This is where the two counter doors part, on purpose: a seat picked from
  // the search list carries no `fromNameMatch` and lands released, namesake
  // or not, however the row was found (H-79, issue #1790; the reasoning is on
  // `BookingPerson.fromNameMatch`).
  let identityUnconfirmed = false;
  // What the staffer is shown beside the matched record while the flag stands,
  // and what a split-off record is named (`splitBookingIdentity`).
  let identityClaim: IdentityClaim | null = null;
  if ("personId" in req) {
    [person] = await tx
      .select()
      .from(people)
      .where(
        and(eq(people.id, req.personId), eq(people.shopId, req.shopId), isNull(people.deletedAt)),
      )
      .limit(1)
      // Waits on a merge holding this row `for update`, then re-reads it: a
      // record merged away mid-booking is deleted by then and refused here,
      // instead of taking a seat the merge has already moved past. `key share`
      // is the weakest lock that does it, so two bookings for one diver never
      // block each other.
      .for("key share");
    // A copied URL, a since-removed diver or a merged-away record must not book into this tenant.
    if (!person) return { ok: false, reason: "person_not_found" };
    identityUnconfirmed = req.fromNameMatch
      ? await nameMatchLeavesIdentityInDoubt(tx, req.shopId, person, req.fromNameMatch.typedName)
      : false;
    if (identityUnconfirmed && req.fromNameMatch) {
      identityClaim = { bookedAs: req.fromNameMatch.typedName.trim(), matchedBy: "picked_name" };
    }
  } else {
    const email = req.email?.trim().toLowerCase() || null;
    if (email) {
      [person] = await tx
        .select()
        .from(people)
        .where(
          and(eq(people.shopId, req.shopId), eq(people.email, email), isNull(people.deletedAt)),
        )
        .limit(1)
        // As above: a record a merge is moving away is re-read once it lands.
        .for("key share");
      if (person) {
        // Reuse-by-email before the capacity gate: flag a name that doesn't match
        // the person already on file for this address.
        identityUnconfirmed = !personNamesMatch(person.fullName, req.fullName);
        if (identityUnconfirmed) {
          identityClaim = { bookedAs: req.fullName.trim(), matchedBy: "shared_email" };
        }
      } else {
        pendingInsert = { fullName: req.fullName.trim(), email, phone: req.phone };
      }
    } else {
      // No email to dedup against — matching createDiver (src/db/divers.ts),
      // this always gets a fresh person row rather than guessing an identity.
      pendingInsert = { fullName: req.fullName.trim(), email: null, phone: req.phone };
    }
  }
  return { ok: true, person, pendingInsert, identityUnconfirmed, identityClaim };
}

/** A walk-in's person row, written only once every gate has passed. */
type PendingWalkIn = { fullName: string; email: string | null; phone?: string };

/**
 * **A course's enrollment gates**, read under the trip lock and decided by
 * `courseEnrollmentRefusal` (`src/lib/booking-gates.ts`): the card gate fails
 * closed, the staff-only age gate fails open. Reads the diver's cards only when
 * the course asks for one, and the shop's calendar only when age is in play.
 */
async function courseEnrollmentFor(
  tx: DbExecutor,
  req: BookingRequest,
  course: typeof courses.$inferSelect,
  person: typeof people.$inferSelect | undefined,
  startsAt: Date,
): Promise<"course_prerequisite" | "course_min_age" | null> {
  if (!course.minimumCertificationLevel && !course.minimumAge) return null;
  const cards =
    person && course.minimumCertificationLevel
      ? await tx
          .select()
          .from(certifications)
          .where(
            and(
              eq(certifications.shopId, req.shopId),
              eq(certifications.personId, person.id),
              isNull(certifications.deletedAt),
            ),
          )
      : [];
  let courseDate: string | null = null;
  if (req.actor !== "public" && course.minimumAge && person?.dateOfBirth) {
    const [shop] = await tx
      .select({ timezone: shops.timezone })
      .from(shops)
      .where(eq(shops.id, req.shopId))
      .limit(1);
    if (!shop) throw new Error(`createBookingRecord: shop ${req.shopId} not found`);
    courseDate = calendarDateInTimezone(startsAt, shop.timezone);
  }
  return courseEnrollmentRefusal({
    actor: req.actor,
    course,
    diver: person ? { cards, dateOfBirth: person.dateOfBirth } : null,
    courseDate,
  });
}

/**
 * Write the walk-in's person row, after every gate has passed so a refused
 * walk-in leaves no orphan behind.
 */
async function writeWalkIn(
  tx: DbExecutor,
  req: BookingRequest,
  pendingInsert: PendingWalkIn,
): Promise<{
  person: typeof people.$inferSelect;
  identityUnconfirmed: boolean;
  identityClaim: IdentityClaim | null;
}> {
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
    const identityUnconfirmed = !resolved.nameMatches;
    return {
      person: resolved.person,
      identityUnconfirmed,
      identityClaim: identityUnconfirmed
        ? { bookedAs: pendingInsert.fullName, matchedBy: "shared_email" }
        : null,
    };
  }
  // No email means no `people_shop_email_unique` row to race for (that
  // index is partial — null emails never collide, schema.ts) — a plain
  // insert, same shape as findOrCreatePerson's own insert branch.
  const [inserted] = await tx
    .insert(people)
    .values(await noEmailPersonRow(tx, req, pendingInsert))
    .returning();
  if (!inserted) throw new Error("createBookingRecord: person insert returned no row");
  await tx.insert(personRoles).values({ personId: inserted.id, role: "diver" });
  return { person: inserted, identityUnconfirmed: false, identityClaim: null };
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

/** The departure one of this shop's bookings sits on, or null when it is not the shop's. */
export async function getShopBookingTripId(
  db: DbExecutor,
  shopId: string,
  bookingId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ tripId: bookings.tripId })
    .from(bookings)
    .where(and(eq(bookings.id, bookingId), eq(bookings.shopId, shopId)))
    .limit(1);
  return row?.tripId ?? null;
}

/**
 * A booking on a specific trip of this shop, with its person — for the
 * confirmation panel, which must render from the database, never from URL
 * params. Scoped to the shop on the query itself (CR-007), not only through
 * whatever handed it the ids.
 */
export async function getBookingForTrip(
  db: DbExecutor,
  shopId: string,
  tripId: string,
  bookingId: string,
) {
  const [row] = await db
    .select({ booking: bookings, person: people })
    .from(bookings)
    .innerJoin(people, and(eq(people.id, bookings.personId), eq(people.shopId, bookings.shopId)))
    .where(
      and(
        eq(bookings.id, bookingId),
        eq(bookings.shopId, shopId),
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
async function bookingDiverName(db: AppDb, shopId: string, bookingId: string) {
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
  /** The boat has room, but not a diver's seat (`trips.diver_capacity`). */
  | "divers_full"
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
  | "date_request_departure_conflict"
  | "date_request_offer_unavailable"
  | "date_request_party_full"
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
 * - *Already departed.* `cancelBooking` refuses only a diver marked aboard a
 *   boat that has left (H-133); every other row can still be removed at sea —
 *   a departed trip is still `scheduled` and roll call stays live. Refusing
 *   the undo there would make a misclick on an at-sea manifest permanent, and
 *   the two errors are not symmetric: an under-listed manifest costs a
 *   search, an over-listed one costs a tap.
 *
 * Capacity and the course ratio still bind in both cases, so a seat that has
 * genuinely been taken is still refused.
 */
export async function restoreBooking(
  db: AppDb,
  shopId: string,
  bookingId: string,
  /** The staffer who put the seat back, for the trail line written with it. */
  trail?: { actorPersonId: string },
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
      .for("no key update", { of: trips });
    if (!trip) return "not_found";
    // Read under the same lock. A cancelled departure has no roster to
    // restore onto; reinstating the trip is the recovery, and then the undo
    // works. No hold check and no departure-time check here — see the doc
    // comment for why an undo is not a new booking.
    if (trip.status === "cancelled") return "trip_cancelled";
    const dateRequestLink = await dateRequestOfferBookingFor(tx, { shopId, bookingId });
    if (dateRequestLink?.scope === "departure" && dateRequestLink.requestId) {
      const pinnedOffer = await lockDateRequestOffer(tx, {
        shopId,
        tripId: trip.id,
        requestId: dateRequestLink.requestId,
        excludeBookingId: bookingId,
      });
      if (typeof pinnedOffer === "string") return pinnedOffer;
    }
    // Both limits, exactly as a new seat is measured: the boat against every
    // held seat, the divers-only limit against divers (ADR
    // 20261007-participant-types).
    // The boat's certificate caps it under the same lock (H-107).
    const held = await heldSeatCounts(tx, trip.shopId, trip.id);
    const full = seatRefusal(
      booking.participantType,
      { ...trip, capacity: await sellableCapacity(tx, trip) },
      held,
    );
    if (full) return full;

    // The ratio counts students, the divers on a course session; a snorkeler
    // or a rider beside them is not one (issue #2226).
    if (trip.courseId && isDiver(booking.participantType)) {
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
      if (seatCap !== null && held.divers >= seatCap) return "course_ratio_full";
    }

    await tx
      .update(bookings)
      // A seat back on the boat carries no turned-away reason from its last
      // life (`bookings_turned_away_is_released`).
      .set({ status: "booked", turnedAwayReason: null, turnedAwayAt: null })
      .where(and(eq(bookings.id, bookingId), eq(bookings.status, "cancelled")));
    await settlePackageCoverage(tx, {
      shopId,
      personId: booking.personId,
      bookingId,
      identityUnconfirmed: booking.identityUnconfirmedAt !== null,
      trip,
      participantType: booking.participantType,
    });
    if (trail) {
      await recordSeatChange(tx, {
        shopId,
        tripId: trip.id,
        actorPersonId: trail.actorPersonId,
        bookingId,
        code: "booking_restored",
      });
    }
    return "restored";
  });
}

/**
 * Why a seat move did not happen. Codes, never sentences: the roster maps each
 * to its own words (docs ADR 20260731-domain-layer-copy-leaks).
 */
export type MoveBookingRefusal =
  /** No booked seat by that id on that departure. */
  | "not_found"
  /** Checked in or marked absent: a day-of state, not a plan to change. */
  | "not_movable"
  /** The departure the seat is on has already sailed. */
  | "departed"
  /** The other departure does not take a seat: gone, held, sailed, a rehearsal, or this one. */
  | "target_unavailable"
  /** A course seat moves only to another session of the same course, and a dive seat only to a dive. */
  | "course_mismatch"
  /** The diver already holds a seat there. */
  | "already_booked"
  /** The diver had a seat there once; seating them there reactivates it. */
  | "earlier_seat"
  /** Other live seats name this one as their party lead. */
  | "leads_party"
  /** Still on a buddy team here: the team is taken apart first, on its own trail. */
  | "on_buddy_team"
  /** The crew has recorded this seat at roll call. */
  | "roll_call_started"
  | "trip_full"
  | "divers_full"
  | "course_ratio_full"
  | "course_unstaffed"
  /** The course's prerequisite card is no longer on file. */
  | "course_prerequisite"
  /** Too young for the course on the day that session runs. */
  | "course_min_age"
  | "trip_prerequisite"
  | "date_request_departure_conflict"
  | "date_request_offer_unavailable"
  | "date_request_party_full";

export type MoveBookingOutcome =
  | {
      ok: true;
      personId: string;
      personName: string;
      fromTripId: string;
      toTripId: string;
      /** When the diver was last told to come: the old departure's start. */
      previousStartsAt: Date;
      /** A paid seat whose new departure lists higher owes this. Said, never collected. */
      owedCents: number;
    }
  | { ok: false; reason: Exclude<MoveBookingRefusal, "trip_prerequisite"> }
  | { ok: false; reason: "trip_prerequisite"; refusal: TripAdmissionRefusal };

/**
 * **Move a booked seat to another departure** (ADR
 * 20261013-staff-move-a-seat). The same booking row changes trip, so its
 * order, payment, waiver, readiness link and notes travel with it: nothing is
 * charged and nothing is refunded. A seat that would cost more is said back as
 * `owedCents`, the way a type change says it.
 *
 * The new seat is measured exactly as a new staff seat is: the target trip's
 * row is locked, both capacity limits and the course ratio are read under
 * that lock, and the trip's own certification gate **refuses** (the
 * `admissionGate: "enforce"` posture a reschedule always had), because
 * silently landing a diver on a departure they cannot dive is worse than the
 * refusal.
 *
 * What does not travel is refused rather than rewritten. A seat at roll call,
 * on a buddy team, or leading a party carries the old departure's evidence
 * and relationships; each is undone on its own surface first, with its own
 * trail, and then the seat moves. What stays behind on purpose: the old
 * departure's activity, desk events, arrival marks and sealed course forms,
 * which are a record of what happened there.
 */
/**
 * A course session's prerequisite card and minimum age, for a person already
 * on the books: the same two checks `createBookingRecord` makes for staff, with
 * the same postures. A missing card fails closed; an unknown date of birth
 * fails open, because nothing collects one at booking and readiness checks age
 * at the dock.
 */
async function courseGateRefusal(
  tx: DbExecutor,
  shopId: string,
  personId: string,
  course: typeof courses.$inferSelect | undefined,
  startsAt: Date,
): Promise<"course_prerequisite" | "course_min_age" | null> {
  if (!course) return null;
  if (course.minimumCertificationLevel) {
    const cardRows = await tx
      .select()
      .from(certifications)
      .where(
        and(
          eq(certifications.shopId, shopId),
          eq(certifications.personId, personId),
          isNull(certifications.deletedAt),
        ),
      );
    if (!hasVerifiedCertificationAtLeast(cardRows, course.minimumCertificationLevel)) {
      return "course_prerequisite";
    }
  }
  if (course.minimumAge) {
    const [row] = await tx
      .select({ dateOfBirth: people.dateOfBirth, timezone: shops.timezone })
      .from(people)
      .innerJoin(shops, eq(shops.id, people.shopId))
      // diveday:allow-deleted-people: the seat's own diver, whose age the session measures.
      .where(and(eq(people.id, personId), eq(people.shopId, shopId)))
      .limit(1);
    if (row?.dateOfBirth) {
      const day = calendarDateInTimezone(startsAt, row.timezone);
      if (checkMinimumAge(row.dateOfBirth, course.minimumAge, day).status === "under") {
        return "course_min_age";
      }
    }
  }
  return null;
}

async function moveAdmissionRefusal(
  tx: DbExecutor,
  shopId: string,
  target: typeof trips.$inferSelect,
  booking: typeof bookings.$inferSelect,
): Promise<Extract<MoveBookingOutcome, { ok: false }> | null> {
  // Capacity, participant type, course ratio, and admission are checked under
  // the target lock, matching the staff-seat path.
  // Both limits and the course ratio, read under the target's lock, exactly
  // as `createBookingRecord` reads them for a new seat.
  const held = await heldSeatCounts(tx, target.shopId, target.id);
  const full = seatRefusal(
    booking.participantType,
    { ...target, capacity: await sellableCapacity(tx, target) },
    held,
  );
  if (full) return { ok: false, reason: full };
  // A snorkeler or a rider moves only to a session that prices their seat,
  // and is asked none of the course's student gates (issue #2226).
  const typeRefusal = participantTypeRefusal({
    actor: "staff",
    participantType: booking.participantType,
    trip: target,
  });
  if (typeRefusal) return { ok: false, reason: "target_unavailable" };
  if (target.courseId && isDiver(booking.participantType)) {
    const [course] = await tx
      .select()
      .from(courses)
      .where(and(eq(courses.id, target.courseId), eq(courses.shopId, shopId)))
      .limit(1);
    const { instructorCount, assistantCount } = await tripCourseCrewCounts(tx, target.id);
    if (instructorCount === 0) return { ok: false, reason: "course_unstaffed" };
    const seatCap = courseSeatCapacity(course ?? null, instructorCount, assistantCount);
    if (seatCap !== null && held.divers >= seatCap) {
      return { ok: false, reason: "course_ratio_full" };
    }
    // The course's own two gates, read again rather than trusted from the
    // sale: a card can be revoked since, and age is measured on the day the
    // session runs, so an earlier session of the same course can be one the
    // student is still too young for (H-08).
    const gate = await courseGateRefusal(tx, shopId, booking.personId, course, target.startsAt);
    if (gate) return { ok: false, reason: gate };
  }
  const identityUnconfirmed = booking.identityUnconfirmedAt !== null;
  const admission = await tripAdmissionFor(
    tx,
    shopId,
    target.id,
    { id: booking.personId },
    identityUnconfirmed,
    Boolean(target.courseId),
    undefined,
    booking.participantType,
  );
  if (!admission.admitted) {
    return { ok: false, reason: "trip_prerequisite", refusal: admission.refusal };
  }
  return null;
}

export async function moveBooking(
  db: AppDb,
  input: {
    shopId: string;
    fromTripId: string;
    toTripId: string;
    bookingId: string;
    now?: Date;
    /** Who moved it: both departures' trail lines are written with the move. */
    actorPersonId?: string;
  },
): Promise<MoveBookingOutcome> {
  const { shopId, fromTripId, toTripId, bookingId } = input;
  const now = input.now ?? nowDate();
  if (fromTripId === toTripId) return { ok: false, reason: "target_unavailable" };
  return db.transaction(async (tx): Promise<MoveBookingOutcome> => {
    // Both trip rows before the seat (the lock order at `tripTakesSeatFrom`),
    // and the two trips in id order, so two moves crossing between the same
    // pair of departures never hold one each. The target is `for update`
    // because a seat is being added to it; the source only loses one.
    const tripRow = (id: string) =>
      tx
        .select()
        .from(trips)
        .where(and(eq(trips.id, id), eq(trips.shopId, shopId), liveTrip()))
        .limit(1);
    const lockSource = () => tripRow(fromTripId).for("no key update");
    const lockTarget = () => tripRow(toTripId).for("update");
    let source: typeof trips.$inferSelect | undefined;
    let target: typeof trips.$inferSelect | undefined;
    if (fromTripId < toTripId) {
      [source] = await lockSource();
      [target] = await lockTarget();
    } else {
      [target] = await lockTarget();
      [source] = await lockSource();
    }
    if (!source) return { ok: false, reason: "not_found" };
    if (!target) return { ok: false, reason: "target_unavailable" };
    const dateRequestLink = await dateRequestOfferBookingFor(tx, { shopId, bookingId });
    const dateRequestOffer =
      dateRequestLink?.scope === "departure" && dateRequestLink.requestId
        ? await lockDateRequestOffer(tx, {
            shopId,
            tripId: toTripId,
            requestId: dateRequestLink.requestId,
            excludeBookingId: bookingId,
          })
        : null;
    if (typeof dateRequestOffer === "string") return { ok: false, reason: dateRequestOffer };
    const [booking] = await tx
      .select()
      .from(bookings)
      .where(
        and(
          eq(bookings.id, bookingId),
          eq(bookings.shopId, shopId),
          eq(bookings.tripId, fromTripId),
        ),
      )
      .limit(1)
      .for("update");
    if (!booking || booking.status === "cancelled") return { ok: false, reason: "not_found" };
    // **A seat the desk turned away moves too** (layer 3 review, dde-2 #3):
    // the desk's money line sends staff here before the boat leaves. It lands booked on
    // the new departure; the turn-away was about the old one and stays on its
    // trail. A plain no-show does not move: that is the day's own record.
    const turnedAway = booking.status === "no_show" && booking.turnedAwayAt !== null;
    if (booking.status !== "booked" && !turnedAway) return { ok: false, reason: "not_movable" };
    // A turned-away seat moves only before the source's scheduled start
    // (layer 3 re-review, dde-3 #4 and #5): after it, the boat may be out with
    // an offline after-dive mark still to sync, and the move would wipe the
    // turn-away from the departure's record. The door then is Remove.
    const departed = turnedAway
      ? now.getTime() >= source.startsAt.getTime()
      : hasSailed(source.startsAt, now);
    if (departed) return { ok: false, reason: "departed" };
    if (!tripTakesSeatFrom(target, "staff") || target.isRehearsal || source.isRehearsal) {
      return { ok: false, reason: "target_unavailable" };
    }
    if ((source.courseId ?? null) !== (target.courseId ?? null)) {
      return { ok: false, reason: "course_mismatch" };
    }

    const [earlier] = await tx
      .select({ status: bookings.status })
      .from(bookings)
      .where(and(eq(bookings.tripId, target.id), eq(bookings.personId, booking.personId)))
      .limit(1);
    if (earlier) {
      return {
        ok: false,
        reason: earlier.status === "cancelled" ? "earlier_seat" : "already_booked",
      };
    }
    const [follower] = await tx
      .select({ id: bookings.id })
      .from(bookings)
      .where(
        and(
          eq(bookings.shopId, shopId),
          eq(bookings.partyLeadBookingId, booking.id),
          ne(bookings.status, "cancelled"),
        ),
      )
      .limit(1);
    if (follower) return { ok: false, reason: "leads_party" };
    const [teamed] = await tx
      .select({ id: buddyPairMembers.id })
      .from(buddyPairMembers)
      .where(
        and(
          eq(buddyPairMembers.shopId, shopId),
          eq(buddyPairMembers.tripId, source.id),
          eq(buddyPairMembers.bookingId, booking.id),
        ),
      )
      .limit(1);
    if (teamed) return { ok: false, reason: "on_buddy_team" };
    const [rolled] = await tx
      .select({ id: rollCallEvents.id })
      .from(rollCallEvents)
      .where(and(eq(rollCallEvents.shopId, shopId), eq(rollCallEvents.bookingId, booking.id)))
      .limit(1);
    if (rolled) return { ok: false, reason: "roll_call_started" };

    const identityUnconfirmed = booking.identityUnconfirmedAt !== null;
    const admissionRefusal = await moveAdmissionRefusal(tx, shopId, target, booking);
    if (admissionRefusal) return admissionRefusal;

    // The units held for the old day's window are not the new day's. Units
    // already handed over stay with the diver, as on a cancel.
    await releaseUnclaimedGearReservations(tx, { shopId, bookingId: booking.id });
    // A package dive spent on the old departure is given back and the new one
    // settles it again, under the new trip's own rules.
    await releasePackageCoverageForBooking(tx, shopId, booking.id);
    await tx
      .update(bookings)
      .set({
        tripId: target.id,
        // A plan belongs to the departure where staff made it.
        trainingPlanInstructorPersonId: null,
        trainingPlanByPersonId: null,
        trainingPlanAt: null,
        // Moving alone leaves the party it was booked in.
        partyLeadBookingId: null,
        // Each of these was said about the old departure, so none is true of
        // the new one. Lateness was about the old start. The briefing was on
        // the old day's conditions: the notice carries the new time and
        // meeting point, never the new conditions, so the diver has read
        // nothing about them yet and /ready must say so. "Anything changed?"
        // is asked once per departure. A pickup time was set for the old
        // day's run.
        runningLateAt: null,
        conditionsBriefedAt: null,
        carriedFactsConfirmedAt: null,
        pickupTime: null,
        // A turned-away seat is a booked seat on the new departure.
        status: "booked",
        turnedAwayReason: null,
        turnedAwayAt: null,
      })
      .where(
        and(
          eq(bookings.id, booking.id),
          eq(bookings.shopId, shopId),
          eq(bookings.status, booking.status),
        ),
      );
    if (dateRequestLink && dateRequestOffer) {
      const movedLink = await moveDateRequestOfferBooking(tx, {
        shopId,
        bookingId: booking.id,
        fromOfferId: dateRequestLink.offerId,
        toOfferId: dateRequestOffer.offerId,
      });
      if (!movedLink) throw new Error("locked date request booking link could not follow its move");
    }
    // The diver's one open ask follows them: it is about their day, and the
    // new departure's crew is who answers it now. One the old crew already
    // handled is a record of that day, and stays with it.
    await tx
      .update(tripHelpRequests)
      .set({ tripId: target.id })
      .where(
        and(
          eq(tripHelpRequests.shopId, shopId),
          eq(tripHelpRequests.bookingId, booking.id),
          isNull(tripHelpRequests.handledAt),
        ),
      );
    // An "Ask to move" from the booking page (H-126) was about the old
    // departure, and this move is its answer: the Inbox row stops waiting,
    // and the new date's page may be asked about afresh.
    await tx
      .update(inboundMessages)
      .set({ answeredAt: nowDate() })
      .where(
        and(
          eq(inboundMessages.shopId, shopId),
          eq(inboundMessages.channel, "page"),
          eq(inboundMessages.keywordIntent, "move"),
          eq(inboundMessages.bookingId, booking.id),
          isNull(inboundMessages.answeredAt),
        ),
      );
    await settlePackageCoverage(tx, {
      shopId,
      personId: booking.personId,
      bookingId: booking.id,
      identityUnconfirmed,
      trip: target,
      participantType: booking.participantType,
    });

    let owedCents = 0;
    const payment = await getBookingPayment(tx, shopId, booking.id);
    if (isCapturedPaymentStatus(payment?.status)) {
      const before = seatListPriceCents(source, null, booking.participantType) ?? 0;
      const after = seatListPriceCents(target, null, booking.participantType);
      if (after !== null && after > before) owedCents = after - before;
    }
    // A pending checkout quoted the old departure's price. Withdrawn, as a
    // type change withdraws it; a completion that already landed is money
    // that moved, and stays where it is.
    const linked = tx
      .select({ id: bookingCheckoutBookings.checkoutId })
      .from(bookingCheckoutBookings)
      .where(
        and(
          eq(bookingCheckoutBookings.shopId, shopId),
          eq(bookingCheckoutBookings.bookingId, booking.id),
        ),
      );
    await tx
      .update(bookingCheckouts)
      .set({ status: "expired" })
      .where(
        and(
          eq(bookingCheckouts.shopId, shopId),
          eq(bookingCheckouts.status, "pending"),
          inArray(bookingCheckouts.id, linked),
        ),
      );

    const [person] = await tx
      .select({ fullName: people.fullName })
      .from(people)
      // diveday:allow-deleted-people: the seat's own diver, named on both trails.
      .where(and(eq(people.id, booking.personId), eq(people.shopId, shopId)))
      .limit(1);
    // The crew of each boat reads it on the catch-up strip: one fewer here,
    // one more there. A turned-away seat left the old boat when the desk
    // turned them away, so only the new one hears of it.
    if (!turnedAway) {
      await recordDeskEvent(tx, {
        shopId,
        tripId: source.id,
        kind: "seat_released",
        bookingId: booking.id,
        subjectPersonId: booking.personId,
        actorPersonId: input.actorPersonId,
      });
    }
    await recordDeskEvent(tx, {
      shopId,
      tripId: target.id,
      kind: "seat_taken",
      bookingId: booking.id,
      subjectPersonId: booking.personId,
      actorPersonId: input.actorPersonId,
    });
    // Each departure's trail says what happened to its own roster, committed
    // with the move so neither line can be missing from the log.
    if (input.actorPersonId) {
      for (const [tripId, code] of [
        [source.id, "seat_moved_away"],
        [target.id, "seat_moved_here"],
      ] as const) {
        await recordSeatChange(tx, {
          shopId,
          tripId,
          actorPersonId: input.actorPersonId,
          bookingId: booking.id,
          code,
        });
      }
    }
    return {
      ok: true,
      personId: booking.personId,
      personName: person?.fullName ?? "",
      fromTripId: source.id,
      toTripId: target.id,
      previousStartsAt: source.startsAt,
      owedCents,
    };
  });
}

/**
 * The departures a seat on this one could move to: this shop's, live,
 * scheduled, not held, not rehearsals, not yet left, and of the same kind
 * (another session of the same course, or another dive). The roster's "Move
 * to another departure" lists these; `moveBooking` is still the gate, so a
 * departure that fills between the list and the tap is refused there. Each
 * says the seats it still sells (certificate-capped, seat-holding bookings
 * counted), so "Carry the wait list" never offers a full boat as though it
 * could help (dive-domain review r4-4, N9).
 */
export async function listSeatMoveTargets(
  db: AppDb,
  shopId: string,
  tripId: string,
  now: Date = nowDate(),
  limit = 30,
): Promise<{ id: string; title: string; startsAt: Date; seatsLeft: number }[]> {
  const [trip] = await db
    .select({ courseId: trips.courseId })
    .from(trips)
    .where(and(eq(trips.id, tripId), eq(trips.shopId, shopId), liveTrip()))
    .limit(1);
  if (!trip) return [];
  const rows = await db
    .select({
      id: trips.id,
      title: trips.title,
      startsAt: trips.startsAt,
      capacity: trips.capacity,
      certifiedPassengers: tripBoatCertifiedPassengers(),
      held: sql<number>`count(${bookings.id})::int`,
    })
    .from(trips)
    .leftJoin(bookings, liveBookingJoin)
    .where(
      and(
        eq(trips.shopId, shopId),
        liveTrip(),
        eq(trips.status, "scheduled"),
        eq(trips.conditionsHold, false),
        eq(trips.isRehearsal, false),
        ne(trips.id, tripId),
        gt(trips.startsAt, now),
        trip.courseId ? eq(trips.courseId, trip.courseId) : isNull(trips.courseId),
      ),
    )
    .groupBy(trips.id)
    .orderBy(asc(trips.startsAt))
    .limit(limit);
  return rows.map(({ id, title, startsAt, capacity, certifiedPassengers, held }) => ({
    id,
    title,
    startsAt,
    seatsLeft: Math.max(0, sellableSeats(capacity, certifiedPassengers) - Number(held)),
  }));
}

export type SetParticipantTypeOutcome =
  | {
      ok: true;
      changed: boolean;
      from: ParticipantType;
      tripId: string;
      /**
       * A paid seat whose new type lists higher than its old one: the
       * difference, which nothing collects on its own. Zero otherwise. The
       * staffer is told and the catch-up strip says it (`balance_owed`); a
       * payment is still taken the ordinary way, never here.
       */
      owedCents: number;
    }
  | {
      ok: false;
      reason: /** No live seat by that id on that departure at this shop. */
        | "not_found"
        /**
         * The departure is cancelled or deleted, or it has come home. Out on
         * the water a seat may still change either way: joining the dive meets
         * the card check and, once boarded, the boarding gate (issue #2225).
         */
        | "trip_unavailable"
        /**
         * A course session: a student cannot stop diving, a passenger cannot
         * start, and a snorkeler or rider changes only to a type the session
         * prices (issue #2226).
         */
        | "participant_type_unavailable"
        /** Becoming a diver, and every diver's seat is taken. */
        | "divers_full"
        /**
         * Leaving the water while on a buddy team. A team is divers who look
         * after each other underwater; a teammate who is now riding leaves a
         * team of one, or a pair that is silently a solo diver. Staff take
         * them off the team first, which is a recorded act on its own trail.
         */
        | "on_buddy_team"
        /**
         * Joining the dive on a seat the rail already recorded boarded at
         * departure, or on any seat once the boat is at sea, when the
         * boarding gate would refuse it as a diver. The
         * boarding record was granted to a snorkeler or a rider; it is never
         * carried over to a diver it would not have been granted to. No
         * override: the gate is the boarding gate, and the crew answer it.
         */
        | "boarded_not_ready";
    }
  | {
      ok: false;
      /**
       * Becoming a diver, and the booking-time card check would refuse this
       * person on this departure. Nothing was written: staff are asked to
       * change it anyway, knowing which card is missing.
       */
      reason: "cert_blocked";
      refusal: TripAdmissionRefusal;
    };

export type SetParticipantTypeInput = {
  shopId: string;
  /** The departure the staffer is looking at. A seat on any other is `not_found`. */
  tripId: string;
  bookingId: string;
  to: ParticipantType;
  /** The staffer making the change, named on the trail and the catch-up strip. */
  actorPersonId: string;
  /**
   * "Change anyway", after a `cert_blocked` answer. Only ever skips the
   * booking-time card check; the boarding gate still asks for the card, and
   * a seat already boarded is refused outright (`boarded_not_ready`). The
   * caller decides who may send it (`canOverrideCertBlock`).
   */
  confirmCertBlock?: boolean;
};

/**
 * **Change what a seated person is doing on this boat** — the diver whose ears
 * will not clear and who snorkels instead, the partner who decides to dive after
 * all (ADR 20261007-participant-types).
 *
 * The seat stays the same seat: it already holds its place against the boat,
 * so only the divers-only limit can refuse, and only a change *into* diving.
 * Read under the same trip-row lock every seat-granting write takes, so a
 * concurrent booking cannot take the last diver's seat between the count and
 * the write; the booking row is locked too, so two staffers changing one seat
 * at once are serialized rather than both reading the old type.
 *
 * **Leaving the water is the one door that clears a card block without a
 * card**, so it is never silent. Inside this same transaction it writes the
 * departure's trail (who, from what, to what, and which certification blockers
 * the seat stopped facing) and a desk event for the manifest's catch-up strip,
 * and the seat's `booked_as` stays what it was sold as, so every crew surface
 * says "booked as diver" beside it. A physician's "no" is not a card block and
 * is not cleared: the medical form is the same for every type.
 *
 * **Joining the water runs the booking-time card check** for this person, the
 * same `tripAdmissionFor` a new diver's seat takes. A refusal is returned as
 * `cert_blocked` with the missing card named, and only `confirmCertBlock`
 * writes past it, and only before the time on the board. The boarding gate
 * still asks for the card: a seat not yet boarded meets it at the rail, and a
 * seat the rail recorded boarded at departure, or any seat once the boat is at
 * sea, is re-checked here as a diver, inside this transaction, and the whole
 * change rolls back (`boarded_not_ready`) when it would not pass. At sea no
 * override writes past either check.
 *
 * Money is left where it is (a refund stays staff-initiated, H-07), but a
 * pending checkout that quoted this seat at its old type is retired, so it can
 * never be completed at a price for a seat that no longer exists.
 *
 * A nitrox request comes off with the water: enriched air is something a diver
 * breathes, and the column's check refuses it on anybody else's seat.
 */
export async function setBookingParticipantType(
  db: AppDb,
  input: SetParticipantTypeInput,
): Promise<SetParticipantTypeOutcome> {
  const outcome = await changeParticipantType(db, input).catch((error: unknown) => {
    if (error instanceof BoardedNotReady) {
      return { ok: false, reason: "boarded_not_ready" } as const;
    }
    throw error;
  });
  // The rail reads the type on every row; a change made at the desk is a
  // manifest change like a new seat is (ADR 20260804-manifest-web-push).
  if (outcome.ok && outcome.changed) {
    await publishManifestEvent(db, input.shopId, outcome.tripId);
  }
  return outcome;
}

/** Thrown inside the change to roll it back whole; see `boarded_not_ready`. */
class BoardedNotReady extends Error {}

/** Whether the newest departure-checkpoint roll call for this seat is "boarded". */
async function boardedAtDeparture(
  tx: DbExecutor,
  shopId: string,
  tripId: string,
  bookingId: string,
): Promise<boolean> {
  const [newest] = await tx
    .select({ status: rollCallEvents.status })
    .from(rollCallEvents)
    .where(
      and(
        eq(rollCallEvents.shopId, shopId),
        eq(rollCallEvents.tripId, tripId),
        eq(rollCallEvents.bookingId, bookingId),
        eq(rollCallEvents.checkpoint, "departure"),
      ),
    )
    .orderBy(
      desc(rollCallEvents.occurredAt),
      desc(rollCallEvents.createdAt),
      desc(rollCallEvents.seq),
    )
    .limit(1);
  return newest?.status === "boarded";
}

async function changeParticipantType(
  db: AppDb,
  input: SetParticipantTypeInput,
): Promise<SetParticipantTypeOutcome> {
  const { shopId, tripId, bookingId, to, actorPersonId } = input;
  return db.transaction(async (tx): Promise<SetParticipantTypeOutcome> => {
    // The trip first, then the seat — the order written down at
    // `createBookingRecord` — and `no key update`, because the seat comes
    // next and the rail may hold it (`lockSeatDeparture`).
    const [trip] = await tx
      .select()
      .from(trips)
      .where(and(eq(trips.id, tripId), eq(trips.shopId, shopId), liveTrip()))
      .limit(1)
      .for("no key update");
    const [booking] = await tx
      .select({
        id: bookings.id,
        tripId: bookings.tripId,
        status: bookings.status,
        participantType: bookings.participantType,
        personId: bookings.personId,
        identityUnconfirmedAt: bookings.identityUnconfirmedAt,
      })
      .from(bookings)
      .where(
        and(eq(bookings.id, bookingId), eq(bookings.shopId, shopId), eq(bookings.tripId, tripId)),
      )
      .limit(1)
      .for("update");
    if (!booking || booking.status === "cancelled") return { ok: false, reason: "not_found" };
    if (trip?.status !== "scheduled") return { ok: false, reason: "trip_unavailable" };
    const from = booking.participantType;
    if (from === to) return { ok: true, changed: false, from, tripId: trip.id, owedCents: 0 };
    const now = nowDate();
    // Home is final: the head count is closed and the record is what it was.
    // Out on the water a seat may change either way (issue #2225, Aaron
    // 2026-10-13): the partner who rode dive 1 dives the second tank, and the
    // boat that left ten minutes late still has a dock. Joining the dive after
    // the time on the board meets the same two checks it would before it — the
    // booking-time card check below, past which only `confirmCertBlock` writes,
    // and the boarding gate for a seat the rail recorded boarded — and its trail
    // line says it happened at sea. The time on the board, not `hasSailed`'s
    // grace: that buffer is for selling a seat to someone running late.
    if (hasReturned(trip.endsAt, now)) {
      return { ok: false, reason: "trip_unavailable" };
    }
    const atSea = now >= trip.startsAt;
    // On a course session the divers are the students (issue #2226). A student
    // never stops being one by a type change, and a passenger never becomes
    // one: that would skip the course's card, age and ratio gates. Between
    // snorkeling and riding, only at a price the shop named.
    if (
      trip.courseId &&
      (isDiver(from) ||
        isDiver(to) ||
        participantTypeRefusal({ actor: "staff", participantType: to, trip }))
    ) {
      return { ok: false, reason: "participant_type_unavailable" };
    }
    if (isDiver(from) && !isDiver(to)) {
      const [teamed] = await tx
        .select({ bookingId: buddyPairMembers.bookingId })
        .from(buddyPairMembers)
        .where(and(eq(buddyPairMembers.shopId, shopId), eq(buddyPairMembers.bookingId, booking.id)))
        .limit(1);
      if (teamed) return { ok: false, reason: "on_buddy_team" };
    }
    const refusal = typeChangeRefusal(
      from,
      to,
      trip,
      await heldSeatCounts(tx, trip.shopId, trip.id),
    );
    if (refusal) return { ok: false, reason: refusal };

    let certCheck: "none" | "cleared" | "overridden" = "none";
    let cleared: string[] = [];
    if (!isDiver(from) && isDiver(to)) {
      const admission = await tripAdmissionFor(
        tx,
        shopId,
        trip.id,
        { id: booking.personId },
        booking.identityUnconfirmedAt !== null,
        Boolean(trip.courseId),
      );
      if (!admission.admitted) {
        // At sea the person is already aboard, so no rail is left to catch a
        // card the override skipped (dock review of #2225, H1): there is no
        // "Change anyway" out there, and the boarding gate below answers.
        if (atSea) return { ok: false, reason: "boarded_not_ready" };
        if (!input.confirmCertBlock) {
          return { ok: false, reason: "cert_blocked", refusal: admission.refusal };
        }
        certCheck = "overridden";
      }
    } else if (isDiver(from) && !isDiver(to)) {
      // What the seat stops being asked for at the rail, read before the
      // write: the certification family only. A waiver, a medical hold and a
      // payment are everyone's, and keep blocking whatever the type.
      const readiness = await getBookingReadiness(tx, shopId, booking.id);
      cleared = (readiness?.blockers ?? [])
        .filter((blocker) => BLOCKER_CATEGORY[blocker.code] === "certification")
        .map((blocker) => blocker.code);
      if (cleared.length > 0) certCheck = "cleared";
    }

    await tx
      .update(bookings)
      .set({ participantType: to, ...(isDiver(to) ? {} : { wantsNitrox: false }) })
      .where(and(eq(bookings.id, booking.id), eq(bookings.shopId, shopId)));
    // Prepaid dives follow the water. A seat that stops diving gives back the
    // dives it spent (a link undone, never an amount credited); a seat that
    // starts diving spends one exactly as a fresh diver's seat would, under
    // the same rules (an unpaid, identity-confirmed seat only).
    if (!isDiver(to)) {
      // Nor a training dive: the seat is asked none of a course's forms now.
      await dropTrainingMarkWithin(tx, { shopId, bookingId: booking.id, actorPersonId, now });
      await releasePackageCoverageForBooking(tx, shopId, booking.id);
      // And the tagged units the seat will not use now: a rider holds none, a
      // snorkeler the surface kit. Unclaimed only, as a cancellation does;
      // a unit already handed over is with the person and comes home the
      // ordinary way.
      await releaseUnclaimedGearReservations(tx, {
        shopId,
        bookingId: booking.id,
        kinds: gearItemKind.enumValues.filter((kind) => !holdsRegisterKind(to, kind)),
      });
    } else if (booking.identityUnconfirmedAt === null) {
      await settleConfirmedPackageCoverage(tx, {
        shopId,
        bookingId: booking.id,
        personId: booking.personId,
      });
    }
    // **A boarding record is not carried into the water.** The rail recorded
    // this seat boarded at departure as a snorkeler or a rider; the boarding
    // gate (`recordRollCall`) is asked again, now, as the diver it is
    // becoming, and the whole change rolls back if it would refuse.
    // At sea the same holds with no roll call at all: a seat that is out on
    // the water is aboard whatever the rail recorded, so it is asked the
    // boarding gate now (dock review of #2225, H1).
    if (isDiver(to) && (atSea || (await boardedAtDeparture(tx, shopId, trip.id, booking.id)))) {
      const readiness = await getBookingReadiness(tx, shopId, booking.id);
      if (readiness?.status !== "ready") throw new BoardedNotReady();
    }
    // A paid seat that now lists higher owes the difference. Said, never
    // collected here.
    let owedCents = 0;
    const payment = await getBookingPayment(tx, shopId, booking.id);
    if (isCapturedPaymentStatus(payment?.status)) {
      const before = seatListPriceCents(trip, null, from) ?? 0;
      const after = seatListPriceCents(trip, null, to);
      if (after !== null && after > before) owedCents = after - before;
    }
    // A pending checkout quoted this seat at its old type's price. Withdrawn,
    // never completed at a figure for a seat that is no longer that seat; a
    // completion that already landed is money that moved, and is left alone.
    const linked = tx
      .select({ id: bookingCheckoutBookings.checkoutId })
      .from(bookingCheckoutBookings)
      .where(
        and(
          eq(bookingCheckoutBookings.shopId, shopId),
          eq(bookingCheckoutBookings.bookingId, booking.id),
        ),
      );
    await tx
      .update(bookingCheckouts)
      .set({ status: "expired" })
      .where(
        and(
          eq(bookingCheckouts.shopId, shopId),
          eq(bookingCheckouts.status, "pending"),
          inArray(bookingCheckouts.id, linked),
        ),
      );
    const [subject] = await tx
      .select({ fullName: people.fullName })
      .from(people)
      // diveday:allow-deleted-people: the seat's own diver, named on its trail line.
      .where(and(eq(people.id, booking.personId), eq(people.shopId, shopId)))
      .limit(1);
    await recordTripActivity(tx, {
      shopId,
      tripId: trip.id,
      actorPersonId,
      entry: {
        code: "participant_type_changed",
        diver: subject?.fullName ?? "",
        from,
        type: to,
        certCheck,
        cleared: cleared.join(","),
        atSea: atSea ? "yes" : "no",
      },
    });
    await recordDeskEvent(tx, {
      shopId,
      tripId: trip.id,
      kind: typeChangedDeskEventKind(to),
      bookingId: booking.id,
      subjectPersonId: booking.personId,
      actorPersonId,
    });
    if (owedCents > 0) {
      await recordDeskEvent(tx, {
        shopId,
        tripId: trip.id,
        kind: "balance_owed",
        bookingId: booking.id,
        subjectPersonId: booking.personId,
        actorPersonId,
      });
    }
    return { ok: true, changed: true, from, tripId: trip.id, owedCents };
  });
}

/**
 * A staff removal's outcome. `aboard_at_sea`: the boat carried this seat or
 * may be carrying it (H-133, `aboardAtSeaBookingIds`), at sea or home, and
 * `hold` says which: on the water by the roll call, or never counted at the
 * dock of a sailed departure.
 */
export type CancelBookingOutcome =
  | {
      ok: true;
      booking: typeof bookings.$inferSelect & {
        previousStatus: (typeof bookings.$inferSelect)["status"];
      };
    }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "aboard_at_sea"; hold: AboardHold };

/**
 * **A staff member takes a seat off the roster.** Refused for a seat the boat
 * carried or may be carrying (H-133): a cancelled booking is nobody to every
 * roll-call reader, so the removal would drop a person on the water from the
 * count, and after the boat is home it would erase that they sailed. Asked
 * inside the transaction, under the trip and the seat locks the crew's
 * roll-call write takes in the same order (`lockSeatDeparture`), so a tap at
 * the rail and a removal at the desk cannot both decide against the same
 * pre-state. No override: roll-call marks correct a mistaken tap, and money
 * goes back through the order's refund.
 */
export async function cancelBooking(
  db: AppDb,
  shopId: string,
  bookingId: string,
  opts: {
    /**
     * The staffer who took the seat off, when one did: the departure's trail
     * line is written in the same transaction (`recordSeatChange`). A diver's
     * own cancel and the wait-list sweep write their own line, or none.
     */
    trail?: { actorPersonId: string };
    now?: Date;
  } = {},
): Promise<CancelBookingOutcome> {
  const outcome = await cancelBookingRow(db, shopId, bookingId, opts.now ?? nowDate(), opts.trail);
  // A diver just left the roster, which is a manifest change like any other —
  // and one that lands on shore while a captain may already be walking to the
  // boat (ADR 20260804-manifest-web-push). Published *after* the transaction
  // commits, never inside it: this fans out to a push service, and holding a
  // database transaction open across third-party HTTP is how a slow provider
  // becomes a lock-wait on the bookings table.
  if (outcome.ok) await publishManifestEvent(db, shopId, outcome.booking.tripId);
  return outcome;
}

async function cancelBookingRow(
  db: AppDb,
  shopId: string,
  bookingId: string,
  now: Date,
  trail?: { actorPersonId: string },
): Promise<CancelBookingOutcome> {
  return db.transaction(async (tx): Promise<CancelBookingOutcome> => {
    // The departure, then the seat: the order every seat writer takes, the
    // crew's roll call among them.
    const tripId = await lockSeatDeparture(tx, shopId, bookingId);
    if (!tripId) return { ok: false, reason: "not_found" };
    // What the seat was before this, read under the row's lock: only a seat
    // that was `booked` becomes a diver's "your booking is canceled" email, and
    // a roster removal of a checked-in or no-show row is not one.
    const [prior] = await tx
      .select({ status: bookings.status })
      .from(bookings)
      .where(and(eq(bookings.id, bookingId), eq(bookings.shopId, shopId)))
      .for("update");
    if (!prior) return { ok: false, reason: "not_found" };
    const atSea = await aboardAtSeaBookingIds(tx, { shopId, tripId, now, bookingIds: [bookingId] });
    const hold = atSea.get(bookingId);
    if (hold) return { ok: false, reason: "aboard_at_sea", hold };
    const [updated] = await tx
      .update(bookings)
      .set({ status: "cancelled" })
      .where(and(eq(bookings.id, bookingId), eq(bookings.shopId, shopId)))
      .returning();
    if (!updated) return { ok: false, reason: "not_found" };
    const booking = { ...updated, previousStatus: prior.status };
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
    // And the crew, who read "Hugo Marsh gave up a seat." on the manifest's
    // catch-up strip (issue #1202). A seat leaving the roster is the change
    // most likely to land while a captain is already walking to the boat —
    // the same reason the push event below exists. No actor: this path is
    // reached by a staffer, by the diver's own link, and by the wait-list
    // sweep, and none of them hands one down. A seat the desk turned away
    // (H-135) was refused, not given up, and the strip says so; the cancel
    // keeps `turned_away_at`, so the row still knows.
    await recordDeskEvent(tx, {
      shopId,
      tripId: booking.tripId,
      kind: booking.turnedAwayAt === null ? "seat_released" : "seat_turned_away",
      bookingId: booking.id,
      subjectPersonId: booking.personId,
    });
    // A seat that was already off the roster was not removed again.
    if (trail && prior.status !== "cancelled") {
      await recordSeatChange(tx, {
        shopId,
        tripId: booking.tripId,
        actorPersonId: trail.actorPersonId,
        bookingId,
        code: "booking_removed",
      });
    }
    return { ok: true, booking };
  });
}

/**
 * **What a party lead's own cancel did to the seats they booked** (batch 6
 * item 10). `cancelled` went with the lead: unclaimed and still `booked`.
 * `stayed` did not: claimed by their own diver, or already checked in. Names
 * are the seat's own (`seatName`), the same the lead's party panel shows.
 * `ownAddress` is a cancelled seat whose own email is not the lead's: that
 * diver gets their own cancellation notice (glossary "Cancellation notice"),
 * and a seat on the lead's address, or with none, stays quiet.
 */
export type PartyCancelOutcome = {
  cancelled: Array<{ bookingId: string; seatName: string; ownAddress: boolean }>;
  stayed: Array<{ bookingId: string; seatName: string }>;
};

export type SelfCancelResult =
  | { ok: true; party?: PartyCancelOutcome }
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
  input: {
    shopId: string;
    bookingId: string;
    now?: Date;
    /**
     * A party lead's unclaimed seats go with them (batch 6 item 10). Both
     * diver paths, `/ready` and the reply keyword, ask for it.
     */
    withUnclaimedParty?: boolean;
  },
): Promise<SelfCancelResult> {
  const now = input.now ?? nowDate();
  return db.transaction(async (tx) => {
    // Locks the row for the rest of this transaction — closes the gap a bare
    // read-then-write would leave open for a concurrent roll-call action to
    // flip this same seat to checked_in/no_show between the check below and
    // the write, which the unconditional update this replaced could then
    // blindly stomp back to cancelled (security review finding on this ADR).
    const [row] = await tx
      .select({
        status: bookings.status,
        tripId: bookings.tripId,
        personId: bookings.personId,
        partyLeadBookingId: bookings.partyLeadBookingId,
      })
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
    // Within the hour `hasSailed` allows, a boat past its time or taken out by
    // the crew with this diver counted aboard has left all the same (H-133).
    const atSea = await aboardAtSeaBookingIds(tx, {
      shopId: input.shopId,
      tripId: row.tripId,
      now,
      bookingIds: [input.bookingId],
    });
    if (atSea.has(input.bookingId)) return { ok: false, reason: "trip_departed" };

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
    await releaseSelfCancelledSeat(tx, {
      shopId: input.shopId,
      bookingId: input.bookingId,
      tripId: row.tripId,
      personId: row.personId,
    });
    // Only a lead has party seats: a member's own cancel never reaches another seat.
    if (!input.withUnclaimedParty || row.partyLeadBookingId !== null) return { ok: true };
    const party = await cancelUnclaimedPartySeats(tx, {
      shopId: input.shopId,
      leadBookingId: input.bookingId,
      tripId: row.tripId,
      now,
    });
    return { ok: true, party };
  });
}

/**
 * Everything a self-cancelled seat lets go of, the same for the diver's own
 * seat and each party seat that goes with a lead's.
 */
async function releaseSelfCancelledSeat(
  tx: DbExecutor,
  seat: { shopId: string; bookingId: string; tripId: string; personId: string },
) {
  // Same belt-and-suspenders revoke `cancelBooking` does for the staff path.
  await revokeBookingCapabilities(tx, { shopId: seat.shopId, bookingId: seat.bookingId });
  // Same rule as the staff cancel: un-collected units go back on the wall
  // with the seat (ADR 20260815-minimal-gear-register).
  await releaseUnclaimedGearReservations(tx, { shopId: seat.shopId, bookingId: seat.bookingId });
  await releasePackageCoverageForBooking(tx, seat.shopId, seat.bookingId);
  // And the same handoff line the staff cancel writes: a seat the diver gave
  // back from their own link is exactly as much news to the crew (#1202).
  await recordDeskEvent(tx, {
    shopId: seat.shopId,
    tripId: seat.tripId,
    kind: "seat_released",
    bookingId: seat.bookingId,
    subjectPersonId: seat.personId,
  });
}

/**
 * **The one rule for which party seats a lead's cancel takes with it**: still
 * `booked` and not claimed by their own diver (and, at sea, not counted
 * aboard: H-133, applied beside it). `cancelUnclaimedPartySeats`
 * applies it to cancel, `previewPartyCancel` to count, and the lead's party
 * panel (`issuePartySeatClaims`) to list, so what the SMS prompt and the email
 * say can never differ from what the settle does.
 */
export function partySeatGoesWithLead(seat: {
  status: (typeof bookings.$inferSelect)["status"];
  claimedAt: Date | null;
}): boolean {
  return seat.status === "booked" && seat.claimedAt === null;
}

/**
 * How many party seats a lead's cancel would take with it, and how many it
 * would leave booked, read without changing anything. Zero and zero for a
 * booking that is not a lead (a member's own cancel never reaches another
 * seat) or that has no party. The same selection as
 * `cancelUnclaimedPartySeats`: this shop, this lead, the lead's own departure,
 * not already canceled.
 */
export async function previewPartyCancel(
  db: DbExecutor,
  input: { shopId: string; leadBookingId: string; now?: Date },
): Promise<{ goes: number; stays: number }> {
  const [lead] = await db
    .select({ tripId: bookings.tripId, partyLeadBookingId: bookings.partyLeadBookingId })
    .from(bookings)
    .where(and(eq(bookings.id, input.leadBookingId), eq(bookings.shopId, input.shopId)))
    .limit(1);
  if (!lead || lead.partyLeadBookingId !== null) return { goes: 0, stays: 0 };
  const seats = await db
    .select({ id: bookings.id, status: bookings.status, claimedAt: bookings.claimedAt })
    .from(bookings)
    .where(
      and(
        eq(bookings.shopId, input.shopId),
        eq(bookings.partyLeadBookingId, input.leadBookingId),
        eq(bookings.tripId, lead.tripId),
        ne(bookings.status, "cancelled"),
      ),
    );
  // A seat counted aboard a boat that has left stays, as the cancel keeps it
  // (H-133).
  const atSea = await aboardAtSeaBookingIds(db, {
    shopId: input.shopId,
    tripId: lead.tripId,
    now: input.now ?? nowDate(),
    bookingIds: seats.map((seat) => seat.id),
  });
  const goes = seats.filter((seat) => partySeatGoesWithLead(seat) && !atSea.has(seat.id)).length;
  return { goes, stays: seats.length - goes };
}

/**
 * **The lead's unclaimed seats go with the lead** (batch 6 item 10). Inside
 * the lead's own cancel transaction, so the seats and the lead are released
 * together or not at all. Only seats whose `party_lead_booking_id` is this
 * lead in this shop are reached, each locked and re-checked: an unclaimed,
 * `booked` seat is cancelled; a claimed seat belongs to its own diver and
 * stays, as does one already checked in. A seat claimed between the confirm
 * and this lock stays too, and the lead is told it did.
 *
 * Ordered as the lead's party panel orders them (`issuePartySeatClaims`).
 */
export async function cancelUnclaimedPartySeats(
  tx: DbExecutor,
  input: { shopId: string; leadBookingId: string; tripId: string; now: Date },
): Promise<PartyCancelOutcome> {
  const [lead] = await tx
    .select({ email: people.email })
    .from(bookings)
    .innerJoin(people, eq(people.id, bookings.personId))
    .where(and(eq(bookings.id, input.leadBookingId), eq(bookings.shopId, input.shopId)))
    .limit(1);
  const leadAddress = normalizeEmailAddress(lead?.email);
  const seats = await tx
    .select({
      bookingId: bookings.id,
      status: bookings.status,
      claimedAt: bookings.claimedAt,
      personId: bookings.personId,
      fullName: people.fullName,
      email: people.email,
      identityUnconfirmedAt: bookings.identityUnconfirmedAt,
      identityBookedAs: bookings.identityBookedAs,
    })
    .from(bookings)
    .innerJoin(people, eq(people.id, bookings.personId))
    .where(
      and(
        eq(bookings.shopId, input.shopId),
        eq(bookings.partyLeadBookingId, input.leadBookingId),
        eq(bookings.tripId, input.tripId),
        ne(bookings.status, "cancelled"),
      ),
    )
    .orderBy(asc(bookings.createdAt), asc(people.fullName), asc(bookings.id))
    .for("update", { of: bookings });
  // A party seat counted aboard a boat that has left stays, like a claimed one
  // (H-133).
  const atSea = await aboardAtSeaBookingIds(tx, {
    shopId: input.shopId,
    tripId: input.tripId,
    now: input.now,
    bookingIds: seats.map((seat) => seat.bookingId),
  });
  const outcome: PartyCancelOutcome = { cancelled: [], stayed: [] };
  for (const seat of seats) {
    const name = seatName(seat.fullName, seat);
    if (!partySeatGoesWithLead(seat) || atSea.has(seat.bookingId)) {
      outcome.stayed.push({ bookingId: seat.bookingId, seatName: name });
      continue;
    }
    const [gone] = await tx
      .update(bookings)
      .set({ status: "cancelled" })
      .where(
        and(
          eq(bookings.id, seat.bookingId),
          eq(bookings.shopId, input.shopId),
          eq(bookings.status, "booked"),
          isNull(bookings.claimedAt),
        ),
      )
      .returning({ id: bookings.id });
    if (!gone) {
      outcome.stayed.push({ bookingId: seat.bookingId, seatName: name });
      continue;
    }
    await releaseSelfCancelledSeat(tx, {
      shopId: input.shopId,
      bookingId: seat.bookingId,
      tripId: input.tripId,
      personId: seat.personId,
    });
    const seatAddress = normalizeEmailAddress(seat.email);
    outcome.cancelled.push({
      bookingId: seat.bookingId,
      seatName: name,
      ownAddress: seatAddress !== null && seatAddress !== leadAddress,
    });
  }
  return outcome;
}

/**
 * The prepaid dives the flag withheld, spent now that the shop has said who
 * this seat belongs to.
 *
 * `settlePackageCoverage` returns empty under an unconfirmed identity, and
 * that refusal used to be the end of it: nothing re-ran when the flag came
 * off, so the seat stayed unpaid and the ten-dive regular was asked for money
 * on a departure their package covers. Rare while the flag only ever came off
 * a shared-inbox collision; every spelled-right name match at the counter
 * since issue #1556 (`dive-domain-expert`, the RFH-07 layer).
 *
 * Inside the confirm's own transaction, for the reason `createBookingRecord`
 * states at its own call: the claim has to be serialised with the row it
 * belongs to, or two taps read the same unused dive and both take it.
 *
 * **Only onto a seat nothing has settled yet.** A booking already carrying a
 * payment — cash taken at the desk, a card, a waived fare — would otherwise
 * spend the diver's dives *on top of* what they already handed over and
 * overwrite the record that they did; handing that money back needs a refund
 * path this does not have (issue #1697). A cancelled seat is skipped for the
 * plainer reason that the action takes a booking id from the form and a
 * cancelled row can still carry the flag: nobody's package pays for a seat
 * that is off the roster.
 */
async function settleConfirmedPackageCoverage(
  tx: DbExecutor,
  input: { shopId: string; bookingId: string; personId: string },
) {
  const payment = await getBookingPayment(tx, input.shopId, input.bookingId);
  if (payment && payment.status !== "unpaid") return;
  const [row] = await tx
    .select({
      status: bookings.status,
      participantType: bookings.participantType,
      courseId: trips.courseId,
      plannedDives: trips.plannedDives,
      isRehearsal: trips.isRehearsal,
    })
    .from(bookings)
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .where(and(eq(bookings.id, input.bookingId), eq(bookings.shopId, input.shopId)))
    .limit(1);
  if (!row || row.status === "cancelled") return;
  await settlePackageCoverage(tx, {
    shopId: input.shopId,
    personId: input.personId,
    bookingId: input.bookingId,
    identityUnconfirmed: false,
    trip: row,
    participantType: row.participantType,
  });
}

/**
 * Staff confirm a flagged booking really is the person it was attached to
 * (H-13): clears `identity_unconfirmed_at`, which drops the readiness blocker.
 * Shop-scoped and idempotent — a no-op on an already-clear or unknown booking
 * returns false so the caller can distinguish "confirmed" from "nothing to do".
 * The other answer, "not the same person", is {@link splitBookingIdentity}.
 *
 * **The actor is required because the trail is what makes this tap safe.**
 * What clearing the flag hands over is not small: the matched diver's current
 * signed release (`issueWaiverOnJoin` asks for no new one when the person
 * already holds a live signature, so the seat boards on somebody else's
 * paper), their certifications once readiness stops withholding them, and the
 * prepaid dives the seat is owed, which the tap itself now spends
 * (`settleConfirmedPackageCoverage`). It used to be true that the flag only
 * ever came off a shared-inbox email collision, where the two humans at least
 * shared an identifier; the counter's trigram name prompt now raises the same
 * flag off a spelling (issue #1556), so the tap is a lighter-weight diver
 * merge. The role list stays open — a counter staffer who cannot clear the
 * flag they just raised is its own failure mode, and merge's owner/manager
 * boundary would strand a walk-in until a manager walked past — and
 * `src/lib/authz.ts` is explicit about what carries that weight instead: what
 * makes the most sensitive act in the product safe is the trail, not the role
 * list.
 *
 * Two lines, because the consequence lands in two places: one on the
 * departure, where the crew reads what happened to the roster that day, and one
 * on the *matched person's* record, which a trip-scoped row never reaches
 * (`pagedDiverActivity` joins on the booking, and `recordTripActivity` writes
 * none) and which is where a shop looks months later when a stranger's dives
 * are sitting under somebody else's name.
 */
export async function confirmBookingIdentity(
  db: AppDb,
  input: {
    shopId: string;
    bookingId: string;
    actorPersonId: string;
    /**
     * Which emergency contact the confirmed record keeps, when the desk
     * recorded one on the held seat that differs from the record's own
     * (`HeldContactChoice`). Without it, a differing pair refuses the confirm.
     */
    heldContact?: HeldContactChoice;
  },
  notices: SendRescheduleNoticesOptions = {},
): Promise<boolean | "contact_differs"> {
  const booking = await db.transaction(async (tx) => {
    // **The held seat's contact is never dropped silently** (issue #2145,
    // dive-domain review H3). Once the staffer says "Same person", the desk's
    // note of who to call is that person's: onto a record with no contact it
    // goes as it is; beside a different one, the staffer picks which stands.
    const [held] = await tx
      .select({
        personId: bookings.personId,
        heldName: bookings.heldEmergencyContactName,
        heldPhone: bookings.heldEmergencyContactPhone,
        recordName: people.emergencyContactName,
        recordPhone: people.emergencyContactPhone,
      })
      .from(bookings)
      .innerJoin(people, and(eq(people.id, bookings.personId), eq(people.shopId, bookings.shopId)))
      .where(
        and(
          eq(bookings.id, input.bookingId),
          eq(bookings.shopId, input.shopId),
          isNotNull(bookings.identityUnconfirmedAt),
        ),
      )
      .for("update")
      .limit(1);
    if (!held) return null;
    const carry = heldContactCarry(held, input.heldContact);
    if (carry === "differs") return "contact_differs" as const;
    const [row] = await tx
      .update(bookings)
      .set({
        identityUnconfirmedAt: null,
        identityBookedAs: null,
        identityMatchedBy: null,
        heldEmergencyContactName: null,
        heldEmergencyContactPhone: null,
      })
      .where(
        and(
          eq(bookings.id, input.bookingId),
          eq(bookings.shopId, input.shopId),
          isNotNull(bookings.identityUnconfirmedAt),
        ),
      )
      .returning({ tripId: bookings.tripId, personId: bookings.personId });
    if (!row) return null;
    if (carry) {
      await tx
        .update(people)
        .set({ emergencyContactName: carry.name, emergencyContactPhone: carry.phone })
        .where(and(eq(people.id, row.personId), eq(people.shopId, input.shopId)));
    }
    await settleConfirmedPackageCoverage(tx, {
      shopId: input.shopId,
      bookingId: input.bookingId,
      personId: row.personId,
    });
    return row;
  });
  if (!booking) return false;
  if (booking === "contact_differs") return booking;
  const code = "identity_confirmed";
  const diver = await bookingDiverName(db, input.shopId, input.bookingId);
  if (diver) {
    await recordTripActivity(db, {
      shopId: input.shopId,
      tripId: booking.tripId,
      actorPersonId: input.actorPersonId,
      entry: { code, diver },
    });
  }
  await recordDiverActivity(db, {
    shopId: input.shopId,
    personId: booking.personId,
    actorPersonId: input.actorPersonId,
    code,
  });
  // The reschedule notice the hold skipped, once (#2445). After the trail, so a
  // send that throws cannot lose the record that the tap happened.
  await sendMissedRescheduleNotice(
    db,
    { shopId: input.shopId, bookingId: input.bookingId },
    notices,
  );
  return true;
}

/** What a split refused, as a code (`splitBookingIdentity`). */
export type SplitBookingIdentityResult =
  | {
      ok: true;
      personId: string;
      tripId: string;
      /** How many held seats moved onto the new record, this one included. */
      seats: number;
      /** The bookings that moved, this one first: each is owed its own release. */
      seatIds: string[];
    }
  | {
      ok: false;
      reason:
        | "not_held"
        | "name_required"
        | "medical_hold"
        | "date_of_birth_required"
        | "date_of_birth_invalid"
        | "age_unstated"
        | "email_in_use"
        /** Two moving seats hold different emergency contacts (issue #2145). */
        | "held_contact_conflict"
        /** The seat's departure is deleted, cancelled or back (security review Y4). */
        | "departure_closed";
    };

/** What the staffer told a split about the new diver, beyond a name (issue #2081). */
export type SplitBookingIdentityInput = {
  shopId: string;
  bookingId: string;
  actorPersonId: string;
  fullName: string;
  /**
   * `YYYY-MM-DD`, or blank. Required when any seat moving is on a course with
   * a minimum age, because the age check and the guardian co-signature rule
   * both fail open on a record with no date, and a minor split off a parent's
   * booking would otherwise read as an adult (issue #2081).
   */
  dateOfBirth?: string | null;
  /**
   * The staffer's "18 or older", for a split with no date of birth (H-100,
   * issue #2143). One of the two is required on every departure: the split
   * is for someone who is not the matched diver, often a minor booked with a
   * parent's email, and a blank date alone would read as an adult. Ignored
   * beside a date, which is the better answer; never enough on a course with
   * a minimum age, which measures a date.
   */
  adultAttested?: boolean;
  /** Optional, so the shop can send the new diver their own waiver link. */
  email?: string | null;
  phone?: string | null;
  /**
   * Other held seats to move onto the same new record: the ones the form
   * named (`sameNameHeldSeats`), and only those of them that are still
   * movable when the split runs (`movableSameNameSeats`). One person who
   * booked three dives with someone else's email is one record, not three.
   */
  sameNameSeatIds?: ReadonlyArray<string>;
};

/** The longest name a split accepts. */
export const SPLIT_NAME_MAX = 200;

/** The comparable form of a booked-as name: what the same-name seats match on. */
function bookedAsKey(name: string): string {
  return name.trim().toLowerCase();
}

/** Another held seat a split could move along with this one (issue #2081). */
export type SameNameHeldSeat = {
  bookingId: string;
  tripId: string;
  tripTitle: string;
  startsAt: Date;
  /** Its departure is a course with a minimum age: moving it needs a date of birth. */
  asksDateOfBirth: boolean;
};

/**
 * **One person is never on one departure twice** (dive-domain review,
 * 2026-10-06). Of the same-name held seats found beside a seat on
 * `primaryTripId`, the ones a split may move: none on the seat's own
 * departure, and none on a departure holding two or more of them, since two
 * seats on one boat under one name are two people and the split cannot tell
 * which one is standing at the counter. Those are split one at a time.
 */
export function movableSameNameSeats<T extends { tripId: string }>(
  primaryTripId: string,
  candidates: ReadonlyArray<T>,
): T[] {
  const perTrip = new Map<string, number>();
  for (const seat of candidates) perTrip.set(seat.tripId, (perTrip.get(seat.tripId) ?? 0) + 1);
  return candidates.filter(
    (seat) => seat.tripId !== primaryTripId && perTrip.get(seat.tripId) === 1,
  );
}

/**
 * For each held seat given, the *other* held seats the same matched diver
 * carries under the same booked-as name on a live departure that a split may
 * move with it (`movableSameNameSeats`), soonest first: what "Different
 * person" offers to move, named by departure (issue #2081). Seats with no
 * booked-as name, or nothing to move, are absent from the map.
 */
export async function sameNameHeldSeats(
  db: DbExecutor,
  shopId: string,
  seats: ReadonlyArray<{
    bookingId: string;
    personId: string;
    tripId: string;
    bookedAs: string | null;
  }>,
): Promise<Map<string, SameNameHeldSeat[]>> {
  const named = seats.filter((seat): seat is typeof seat & { bookedAs: string } =>
    Boolean(seat.bookedAs?.trim()),
  );
  const result = new Map<string, SameNameHeldSeat[]>();
  if (named.length === 0) return result;
  const held = await db
    .select({
      bookingId: bookings.id,
      personId: bookings.personId,
      bookedAs: bookings.identityBookedAs,
      tripId: trips.id,
      tripTitle: trips.title,
      startsAt: trips.startsAt,
      minimumAge: courses.minimumAge,
    })
    .from(bookings)
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .leftJoin(courses, and(eq(courses.id, trips.courseId), eq(courses.shopId, shopId)))
    .where(
      and(
        eq(bookings.shopId, shopId),
        inArray(bookings.personId, [...new Set(named.map((seat) => seat.personId))]),
        isNotNull(bookings.identityUnconfirmedAt),
        ne(bookings.status, "cancelled"),
        eq(trips.shopId, shopId),
        liveTrip(),
      ),
    )
    .orderBy(asc(trips.startsAt));
  for (const seat of named) {
    const candidates = held
      .filter(
        (row) =>
          row.bookingId !== seat.bookingId &&
          row.personId === seat.personId &&
          row.bookedAs !== null &&
          bookedAsKey(row.bookedAs) === bookedAsKey(seat.bookedAs),
      )
      .map((row) => ({
        bookingId: row.bookingId,
        tripId: row.tripId,
        tripTitle: row.tripTitle,
        startsAt: row.startsAt,
        asksDateOfBirth: row.minimumAge !== null,
      }));
    const movable = movableSameNameSeats(seat.tripId, candidates);
    if (movable.length > 0) result.set(seat.bookingId, movable);
  }
  return result;
}

/**
 * Staff answer "not the same person" to a booking flagged
 * `identity_unconfirmed` (H-13): the seat leaves the matched diver's record
 * and becomes a new diver of its own, named by the staffer (prefilled with
 * the name it was booked under).
 *
 * **It hands over nothing**, which is why it needs no blocking confirm while
 * the opposite answer does. The new record starts with only what the staffer
 * typed about the person in front of them (issue #2081): a name, a date of
 * birth or the staffer's "18 or older" (H-100: one of the two on any
 * departure, and the date itself on a course with a minimum age, since the age
 * check and the guardian rule read the date and fail open without one; the
 * answer is filed with who gave it), and an optional
 * email or phone so the shop can send their own waiver. Never the matched
 * record's: an address another live record holds is refused (`email_in_use`),
 * and the shared address stays with the record that owns it. No cards, no
 * clean release. Readiness then blocks on what the new diver has not given
 * yet, which is the honest state. A wrong split is undone by merging the two
 * records (owner and manager), the same as any duplicate.
 *
 * **With `sameNameSeatIds`, other held seats booked under the same name and
 * matched to the same diver move too**, onto the one new record: someone who
 * booked three dives with a friend's email is one person, and three splits
 * would make three. A booking does not record who made it, so two strangers
 * who share a name are told apart only by the staffer: the box is unticked by
 * default and names each departure it would move. Never two seats on one
 * departure (`movableSameNameSeats`), the seat's own included. All of them or
 * none: a medical hold on any of them refuses the lot.
 *
 * What moves is what was about this seat rather than about the matched person:
 * the booking itself, the gear held for it, and the seat's unsigned release
 * links, with any half-filled answers and any delivery outcome on them
 * cleared, since nobody knows who typed them (issue #2080) and the outcome was
 * about the matched diver's address. Staff notes stay with the matched person.
 *
 * **A signed release stays where it is filed.** `completeWaiver` refuses a
 * signature unless the typed name matches the record's diver, and on a held
 * seat that diver is the matched person, so every signed release on the seat
 * names them. It is their paper, in their record, export and erasure; moving
 * it would file another person's medical answers under the new diver (dive
 * domain review, 2026-10-05). It is superseded all the same: it names someone
 * other than the seat's diver, so the seat asks for its own. A seat on a
 * medical hold, a referral unanswered or one the physician did not clear
 * (`isUnresolvedMedicalHold`), is refused (`medical_hold`) until a physician
 * clears it, since superseding it would lift the hold; the seat's releases
 * are locked first, so a questionnaire submitted mid-split cannot slip one in.
 *
 * The seat's order stays with the person it billed. An order is an invoice to
 * a Stripe customer by email, and the shared address belongs to the matched
 * record; the order still settles this seat through `booking_id`, which moved
 * with the booking.
 *
 * Every bearer link minted over this booking is revoked, and queued sends for
 * it dropped: they were addressed to the matched diver, and a readiness link
 * scoped to the booking would otherwise let them edit the new diver's
 * emergency contact (the same reasoning as `claimSeat`). Prepaid dives never
 * moved in the first place, because an unconfirmed seat spends none
 * (`settlePackageCoverage`). A cancelled seat is refused: there is nobody to
 * give a record to.
 *
 * Two trail lines, for the same reason `confirmBookingIdentity` writes two:
 * the departure's, and one on the matched person's record, which is where a
 * shop looks when a booking it remembers is no longer there.
 */
export async function splitBookingIdentity(
  db: AppDb,
  input: SplitBookingIdentityInput,
  notices: SendRescheduleNoticesOptions = {},
): Promise<SplitBookingIdentityResult> {
  const fullName = input.fullName.trim().slice(0, SPLIT_NAME_MAX);
  if (!fullName) return { ok: false, reason: "name_required" };
  const dateOfBirth = input.dateOfBirth?.trim() || null;
  if (dateOfBirth && !(isValidCalendarDate(dateOfBirth) && isPlausibleDateOfBirth(dateOfBirth))) {
    return { ok: false, reason: "date_of_birth_invalid" };
  }
  const email = input.email?.trim().toLowerCase() || null;
  type Refusal =
    | "not_held"
    | "medical_hold"
    | "date_of_birth_required"
    | "age_unstated"
    | "email_in_use"
    | "held_contact_conflict"
    | "departure_closed";
  type Split =
    | { refused: Refusal }
    | {
        refused: null;
        tripId: string;
        matchedPersonId: string;
        personId: string;
        seats: Array<{ bookingId: string; tripId: string }>;
      };
  let split: Split;
  try {
    split = await db.transaction(async (tx): Promise<Split> => {
      const now = nowDate();
      const [booking] = await tx
        .select({
          tripId: bookings.tripId,
          personId: bookings.personId,
          bookedAs: bookings.identityBookedAs,
          heldContactName: bookings.heldEmergencyContactName,
          heldContactPhone: bookings.heldEmergencyContactPhone,
          tripStatus: trips.status,
          tripDeletedAt: trips.deletedAt,
          endsAt: trips.endsAt,
        })
        .from(bookings)
        .innerJoin(trips, and(eq(trips.id, bookings.tripId), eq(trips.shopId, bookings.shopId)))
        .where(
          and(
            eq(bookings.id, input.bookingId),
            eq(bookings.shopId, input.shopId),
            isNotNull(bookings.identityUnconfirmedAt),
            ne(bookings.status, "cancelled"),
          ),
        )
        .limit(1)
        .for("update", { of: bookings });
      if (!booking) return { refused: "not_held" as const };
      // Only a seat on a departure still to come (security review Y4).
      if (
        booking.tripDeletedAt ||
        booking.tripStatus !== "scheduled" ||
        hasReturned(booking.endsAt, now)
      ) {
        return { refused: "departure_closed" as const };
      }

      // The other held seats booked under the same name and guessed onto the
      // same diver: the same guess, repeated. Only on a departure that
      // still exists (a deleted one has nobody to move), only those the form
      // named, and only those still movable now: never a second seat on one
      // departure (`movableSameNameSeats`), whatever the form posted.
      const requested = new Set(input.sameNameSeatIds ?? []);
      requested.delete(input.bookingId);
      const candidates =
        requested.size > 0 && booking.bookedAs
          ? await tx
              .select({
                bookingId: bookings.id,
                tripId: bookings.tripId,
                endsAt: trips.endsAt,
                heldContactName: bookings.heldEmergencyContactName,
                heldContactPhone: bookings.heldEmergencyContactPhone,
              })
              .from(bookings)
              .innerJoin(trips, eq(trips.id, bookings.tripId))
              .where(
                and(
                  eq(bookings.shopId, input.shopId),
                  eq(bookings.personId, booking.personId),
                  ne(bookings.id, input.bookingId),
                  isNotNull(bookings.identityUnconfirmedAt),
                  ne(bookings.status, "cancelled"),
                  sql`lower(trim(${bookings.identityBookedAs})) = lower(trim(${booking.bookedAs}))`,
                  eq(trips.shopId, input.shopId),
                  eq(trips.status, "scheduled"),
                  liveTrip(),
                ),
              )
              .for("update", { of: bookings })
          : [];
      const siblings = movableSameNameSeats(
        booking.tripId,
        candidates.filter((seat) => !hasReturned(seat.endsAt, now)),
      ).filter((seat) => requested.has(seat.bookingId));
      const seats = [{ bookingId: input.bookingId, tripId: booking.tripId }, ...siblings];
      const seatIds = seats.map((seat) => seat.bookingId);

      // The contact the desk recorded for the person on any moving seat
      // (issue #2145) is theirs, whichever seat it was written on; two
      // different ones are a question for the desk, not a pick made here
      // (dive-domain review H4).
      const heldContact = movingHeldContact([booking, ...siblings]);
      if (heldContact === "conflict") return { refused: "held_contact_conflict" as const };

      // A course with a minimum age measures it against this record, and so
      // does the guardian rule: a record with no date reads as an adult and
      // both fail open (H-08). The new diver is a stranger to the shop, so the
      // date is asked for here rather than left for the dock (issue #2081).
      if (!dateOfBirth) {
        const gated = await tx
          .select({ minimumAge: courses.minimumAge })
          .from(trips)
          .innerJoin(courses, eq(courses.id, trips.courseId))
          .where(
            and(
              inArray(
                trips.id,
                seats.map((seat) => seat.tripId),
              ),
              eq(trips.shopId, input.shopId),
              eq(courses.shopId, input.shopId),
              isNotNull(courses.minimumAge),
              liveTrip(),
            ),
          )
          .limit(1);
        if (gated.length > 0) return { refused: "date_of_birth_required" as const };
        // Anywhere else, a blank date is an adult only by the staffer's word
        // (H-100): it is what the guardian rule will read.
        if (!input.adultAttested) return { refused: "age_unstated" as const };
      }

      // Superseding a referral nobody has answered would lift the hold, and the
      // person at the counter would face a fresh questionnaire they have
      // already learned the answer to (issue #1282). The referral is answered
      // first; then the seat can go.
      // Every live release on every moving seat, locked: a questionnaire that
      // parks a referral commits before this read or waits until the split is
      // done.
      const live = await tx
        .select({
          status: waiverRecords.status,
          medicalClearedAt: waiverRecords.medicalClearedAt,
        })
        .from(waiverRecords)
        .where(
          and(
            eq(waiverRecords.shopId, input.shopId),
            inArray(waiverRecords.bookingId, seatIds),
            isNull(waiverRecords.supersededAt),
          ),
        )
        .for("update");
      if (live.some((row) => row.status === "medical_review" && !row.medicalClearedAt)) {
        return { refused: "medical_hold" as const };
      }

      // An address another live record holds stays with it: the shared inbox is
      // usually exactly that, and `people_shop_email_unique` would refuse it.
      if (email) {
        const [taken] = await tx
          .select({ id: people.id })
          .from(people)
          .where(
            and(eq(people.shopId, input.shopId), eq(people.email, email), isNull(people.deletedAt)),
          )
          .limit(1);
        if (taken) return { refused: "email_in_use" as const };
      }

      const [person] = await tx
        .insert(people)
        .values({
          shopId: input.shopId,
          fullName,
          email,
          phone: await storedPhone(tx, input.shopId, input.phone?.trim() || null),
          dateOfBirth,
          ...(dateOfBirth
            ? {}
            : { adultAttestedAt: now, adultAttestedByPersonId: input.actorPersonId }),
          // The contact the desk recorded for the person on this seat while
          // it was held (issue #2145) is theirs: it goes onto their record.
          emergencyContactName: heldContact?.name ?? null,
          emergencyContactPhone: heldContact?.phone ?? null,
        })
        .returning({ id: people.id });
      if (!person) throw new Error("splitBookingIdentity: person insert returned no row");
      await tx.insert(personRoles).values({ personId: person.id, role: "diver" });
      await tx
        .update(bookings)
        .set({
          personId: person.id,
          identityUnconfirmedAt: null,
          identityBookedAs: null,
          identityMatchedBy: null,
          // A reason the desk gave while the seat was held was chosen about the
          // guess (security review 2026-10-16, F1), so it does not travel to
          // the new record. That the desk turned somebody away does
          // (`turnedAwayAt` stays).
          turnedAwayReason: null,
          heldEmergencyContactName: null,
          heldEmergencyContactPhone: null,
        })
        .where(and(inArray(bookings.id, seatIds), eq(bookings.shopId, input.shopId)));

      // Any link or release on these seats may be the matched diver's: each
      // seat asks for its own. The token goes too, so a link already sent is
      // dead.
      await tx
        .update(waiverRecords)
        .set({ supersededAt: now, tokenSealed: null })
        .where(
          and(
            eq(waiverRecords.shopId, input.shopId),
            inArray(waiverRecords.bookingId, seatIds),
            isNull(waiverRecords.supersededAt),
          ),
        );
      // Unsigned links follow the seat; nothing on them is sealed. Only what is
      // filed under the matched diver: a placeholder's (`claimSeat`) stays put.
      await tx
        .update(waiverRecords)
        .set({
          personId: person.id,
          ...CLEARED_DRAFT_COLUMNS,
          // How the link last reached the matched diver's inbox or phone: a
          // bounce or a provider id about *their* address, not the new diver's.
          deliveryError: null,
          deliveryProviderMessageId: null,
          deliveryProviderStatus: null,
          deliveryProviderStatusAt: null,
          movedFromPersonId: booking.personId,
          movedAt: now,
          movedByPersonId: input.actorPersonId,
        })
        .where(
          and(
            eq(waiverRecords.shopId, input.shopId),
            inArray(waiverRecords.bookingId, seatIds),
            eq(waiverRecords.personId, booking.personId),
            isNull(waiverRecords.signedAt),
            isNull(waiverRecords.integrityHash),
            isNull(waiverRecords.anonymizedAt),
          ),
        );

      for (const bookingId of seatIds) {
        await revokeBookingCapabilities(tx, { shopId: input.shopId, bookingId, now });
      }
      await tx
        .delete(notificationSendQueue)
        .where(
          and(
            eq(notificationSendQueue.shopId, input.shopId),
            inArray(notificationSendQueue.bookingId, seatIds),
            eq(notificationSendQueue.status, "queued"),
          ),
        );

      await tx
        .update(gearReservations)
        .set({ personId: person.id })
        .where(
          and(
            eq(gearReservations.shopId, input.shopId),
            inArray(gearReservations.bookingId, seatIds),
          ),
        );
      // Staff notes stay filed under the matched person (security review,
      // 2026-10-06): a note was written while the seat read as theirs, and may
      // be about them, so it is theirs to keep, export and erase.
      return {
        refused: null,
        tripId: booking.tripId,
        matchedPersonId: booking.personId,
        personId: person.id,
        seats,
      };
    });
  } catch (error) {
    // Two splits racing for the same address: the loser is told it is taken,
    // the same as if it had lost the read above.
    if (email && isUniqueConstraintViolation(error)) return { ok: false, reason: "email_in_use" };
    throw error;
  }
  if (split.refused) return { ok: false, reason: split.refused };
  // One line per departure a seat moved off, so each departure's trail says
  // what happened to its own roster.
  for (const tripId of new Set(split.seats.map((seat) => seat.tripId))) {
    await recordTripActivity(db, {
      shopId: input.shopId,
      tripId,
      actorPersonId: input.actorPersonId,
      entry: { code: "identity_split", diver: fullName },
    });
  }
  await recordDiverActivity(db, {
    shopId: input.shopId,
    personId: split.matchedPersonId,
    actorPersonId: input.actorPersonId,
    code: "identity_split_off",
  });
  // Each moved seat missed the reschedule notice while it was held; the new
  // record's own address hears it once (#2445).
  for (const seat of split.seats) {
    await sendMissedRescheduleNotice(
      db,
      { shopId: input.shopId, bookingId: seat.bookingId },
      notices,
    );
  }
  return {
    ok: true,
    personId: split.personId,
    tripId: split.tripId,
    seats: split.seats.length,
    seatIds: split.seats.map((seat) => seat.bookingId),
  };
}

// Stable public import surface; diver-authored details have one smaller owner.
export {
  confirmCarriedFacts,
  getBookingPickupTime,
  setBookingDietaryNote,
  setBookingDiveIntent,
  setBookingHotelPickup,
  setBookingLastDived,
  setBookingPickupDetails,
  setBookingReEntryAsk,
} from "./bookings-diver-details";
