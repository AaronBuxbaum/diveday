import { agencyCheckOffered } from "@/lib/agency-check";
import { calendarDateInTimezone } from "@/lib/calendar-date";
import { nowDate } from "@/lib/clock";
import { courseCertifiesStudents, readLearningMaterials } from "@/lib/courses";
import { departureUnderway } from "@/lib/day-blowout";
import { demandRecommendation } from "@/lib/demand";
import { nitroxTanksApproved } from "@/lib/dive-prep";
import { type ElearningQuery, elearningCheckQuery } from "@/lib/elearning-check";
import {
  type CourseTargetInfo,
  filterEligibleLastMinuteRecipients,
  type LastMinuteDepartureBar,
  lastMinuteEntryMatchesTripDate,
  orderLastMinuteRecipients,
} from "@/lib/interests";
import { unionRequirements } from "@/lib/requirement";
import { isFull } from "@/lib/trips";
import { toDateInputValue, utcToWallTime } from "@/lib/zoned";
import { type AboardHold, aboardAtSeaBookingIds } from "./aboard-at-sea";
import { listAgencyCheckableCards } from "./agency-check";
import { type IssuedCard, issuedCardsForTrip } from "./agency-processing";
import { sameNameHeldSeats as findSameNameHeldSeats } from "./bookings";
import type { AppDb } from "./client";
import { chartersRelyingOnCourseSeats, type DependentCharter } from "./course-dependent-seats";
import { type CourseMaterialsDone, courseMaterialsDoneByPerson } from "./course-materials";
import { courseNextStepsByBooking } from "./course-next-step";
import { spendableDivesForTrip } from "./dive-packages";
import { findSimilarDivers, lastDiveDaysHere, listBookableDivers } from "./divers";
import { otherSameNamePeople } from "./identity-repoint";
import { listDateInterestsInReach } from "./interest-dates";
import { listDepartureInterests, listOpenAnytimeInterests, specialtiesForFit } from "./interests";
import { listInviteSuggestions, recentInviteDates } from "./invite-suggestions";
import { listBookingNotes, listDiverNotesForTrip, listTripActivity } from "./operations";
import { getTripRosterWithPaymentMarks } from "./payment-marks";
import { getTripRequirements, getTripSiteRequirement, listTripReadiness } from "./readiness";
import { listTripPrepDivers } from "./rental-fit";
import type { DiveSpecialty } from "./schema";
import { type CertificationSummary, listCertificationSummaries } from "./self-declared-cards";
import { canAcceptPayments, getShopStripeAccount } from "./stripe-accounts";
import { trainingMarksForRoster } from "./training-marks";
import { listTripLastMinutePromoRecipients, listTripLastMinutePromos } from "./trip-promos";
import { getTripWithBooked } from "./trips-record";
import type { TripSharedReads } from "./trips-shared-reads";

/**
 * Everything the trip's Guests page is about, in one call — the last of the
 * three surfaces #632 names, after `getTripPrep` and `getTripOverview`.
 *
 * Guests ran the largest fan-out of the five trip pages and then re-keyed its
 * results into four booking-keyed Maps, merged two note scopes into a third, and
 * ran the whole last-minute eligibility pipeline on top. All of that is the join
 * and filter that decides what a staffer sees; none of it is markup.
 *
 * What stays in the page: the `?notice=` routing, which row to open on arrival,
 * and every sentence. `src/db` returns codes and data, never sentences.
 *
 * Takes the shop row rather than a shop id, like its two siblings — the caller
 * has already resolved it through `requireShopSurface`.
 *
 * Returns `null` when the trip is absent so the page keeps its own `notFound()`.
 */

/** `padiChecksEnabled`: whether PADI's eLearning check is offered here (H-121). */
export type TripGuestsShop = {
  id: string;
  timezone: string;
  padiChecksEnabled: boolean;
  pastDiverInvitesEnabled: boolean;
  waitlistEnabled: boolean;
};

export type TripGuestsFilters = {
  /** The returning-diver picker's query. Blank means the picker is closed. */
  diverQuery?: string;
  /** A name a staffer is being asked to confirm against existing divers. */
  confirmName?: string;
};

/**
 * **Who on the last-minute list fits this departure**, in send order: the
 * list's matches (seated people already left out) with their summary and
 * specialty cards, through the same fit check the send makes
 * (`listAnytimeInterestsCovering`), this departure's wait-listers first.
 */
function lastMinuteRecipientsOf<M extends { person: { id: string } }>(input: {
  trip: { course?: CourseTargetInfo | null };
  matched: readonly M[];
  certificationSummaries: ReadonlyMap<string, CertificationSummary>;
  specialtiesByPerson: ReadonlyMap<string, DiveSpecialty[]>;
  dealRequirement: LastMinuteDepartureBar | null;
  waitlistPersonIds: readonly string[];
}) {
  const course = input.trip.course;
  const courseTarget = course
    ? {
        slug: course.slug,
        title: course.title,
        sourceTemplateSlug: course.sourceTemplateSlug,
        minimumCertificationLevel: course.minimumCertificationLevel,
        isIntroCourse: course.isIntroCourse,
      }
    : null;
  const recipients = orderLastMinuteRecipients(
    filterEligibleLastMinuteRecipients(
      input.matched.map((match) => ({
        ...match,
        certification: input.certificationSummaries.get(match.person.id) ?? null,
        specialties: input.specialtiesByPerson.get(match.person.id) ?? [],
      })),
      input.dealRequirement,
      courseTarget,
    ),
    [...input.waitlistPersonIds],
  );
  return { courseTarget, recipients };
}

export type TripGuests = NonNullable<Awaited<ReturnType<typeof getTripGuests>>>;

function inviteDatesForCandidates(
  db: AppDb,
  shopId: string,
  candidates: readonly { person: { id: string } }[],
) {
  return recentInviteDates(
    db,
    shopId,
    candidates.map(({ person }) => person.id),
    nowDate(),
  );
}

function seatedPersonIdsOf(roster: readonly { booking: { personId: string; status: string } }[]) {
  return new Set(
    roster
      .filter(({ booking }) => booking.status !== "cancelled")
      .map(({ booking }) => booking.personId),
  );
}

export async function getTripGuests(
  db: AppDb,
  shop: TripGuestsShop,
  tripId: string,
  filters: TripGuestsFilters = {},
  /** The reads shared with `getTripOverview` (`./trips-shared-reads`); omitted, this reads its own. */
  sharedReads?: TripSharedReads | null | Promise<TripSharedReads | null>,
) {
  const shared = await sharedReads;
  // Handed reads that found no departure: the answer is already in.
  if (sharedReads !== undefined && shared === null) return null;
  const trip = shared ? shared.trip : await getTripWithBooked(db, shop.id, tripId);
  if (!trip) return null;

  const diverQuery = filters.diverQuery?.trim() ?? "";
  const [
    confirmMatches,
    diverCandidates,
    { roster, paymentMarksByBooking },
    requirement,
    siteRequirement,
    readinessRows,
    prepDivers,
    departureInterests,
    dateInterestsInReach,
    inviteSuggestions,
    lastMinuteList,
    lastMinutePromos,
    lastMinutePromoRecipients,
    bookingNotes,
    diverNotes,
    activity,
    stripeAccount,
    courseNextStepByBooking,
    aboardAtSea,
  ] = await Promise.all([
    filters.confirmName ? findSimilarDivers(db, shop.id, filters.confirmName) : [],
    // The returning-diver picker books an open boat and wait-lists a full one.
    diverQuery === "" ? [] : listBookableDivers(db, shop.id, tripId, { query: diverQuery }),
    // The roster with what each seat's Paid mark recorded and still owes
    // (batch 6 item 1), so the amount field opens on the usual figure: one
    // statement over the seats, not a second beside it.
    getTripRosterWithPaymentMarks(db, shop.id, tripId),
    shared ? shared.requirement : getTripRequirements(db, shop.id, tripId),
    shared ? shared.siteRequirement : getTripSiteRequirement(db, shop.id, tripId),
    shared ? shared.readiness : listTripReadiness(db, shop.id, tripId),
    shared ? shared.prepDivers : listTripPrepDivers(db, shop.id, tripId),
    listDepartureInterests(db, shop.id, tripId),
    // Open date requests that could make this day, for the panel's second group.
    // The departure is already read and live, so its day goes with it.
    listDateInterestsInReach(db, shop.id, {
      tripId,
      day: calendarDateInTimezone(trip.startsAt, shop.timezone),
    }),
    // Past divers of this departure's site worth asking (H-130), only while
    // it has a seat to offer and the shop invites past divers (the Features page).
    isFull(trip) || !shop.pastDiverInvitesEnabled
      ? null
      : listInviteSuggestions(db, { shopId: shop.id, tripId, now: nowDate() }),
    listOpenAnytimeInterests(db, shop.id),
    listTripLastMinutePromos(db, shop.id, tripId),
    listTripLastMinutePromoRecipients(db, shop.id, tripId),
    listBookingNotes(db, shop.id, tripId),
    listDiverNotesForTrip(db, shop.id, tripId),
    listTripActivity(db, shop.id, tripId),
    getShopStripeAccount(db, shop.id),
    // What each student on a course session has already been told to do next
    // (issues #1196, #1205), so the roster's box opens holding it.
    courseNextStepsByBooking(db, shop.id, tripId),
    // Who Remove refuses on this roster: seats the boat carried or may be
    // carrying (H-133), the rule `cancelBooking` applies under its locks.
    // Asked from the scheduled time on, so a boat still to sail pays nothing;
    // a crew who take it out early with someone counted aboard are refused by
    // `cancelBooking` itself, and the row's notice says why.
    departureUnderway({ startsAt: trip.startsAt, rollCallStarted: false }, nowDate())
      ? aboardAtSeaBookingIds(db, { shopId: shop.id, tripId, now: nowDate() })
      : new Map<string, AboardHold>(),
  ]);

  // The last-minute pipeline: who said they are around on this date, who among
  // them could actually be cleared for it, and in what order to offer the seat.
  const tripDateIso = toDateInputValue(utcToWallTime(trip.startsAt, shop.timezone));
  const lastMinuteMatched = lastMinuteList.filter(({ interest }) =>
    lastMinuteEntryMatchesTripDate(interest, tripDateIso),
  );
  // **Seated means hidden**: an interest reserves nothing and the booking transaction
  // never writes to this table (ADR 20261017-one-interest-with-a-scope, R1), so who
  // wants in is read against the seats at read time.
  const seatedPersonIds = seatedPersonIdsOf(roster);
  // A seated diver's interest is hidden. **The wait list's switch hides
  // nobody** (review 2026-10-23, item 8): a diver already waiting when it went
  // off, and a reply to a date request (that feature's own row), stay on the
  // panel until someone handles them; only joining is closed.
  const interests = departureInterests.filter(
    ({ interest }) => interest.personId === null || !seatedPersonIds.has(interest.personId),
  );
  const dateInterests = dateInterestsInReach.filter(
    (r) => !r.personId || !seatedPersonIds.has(r.personId),
  );
  // The interests the diver asked for: what the demand banner counts and the deal
  // list orders by. The shop's own outreach (`asked_by`) is in `interests` too.
  const waitlist = interests.filter(({ interest }) => interest.askedBy === "diver");
  const waitlistPersonIds = waitlist.flatMap(({ interest }) =>
    interest.personId ? [interest.personId] : [],
  );
  const heldSeats = roster.filter(({ booking }) => booking.identityUnconfirmedAt);
  const dealRequirement = unionRequirements(requirement, siteRequirement);

  // **One wave after the roster** (code review 2026-10-11, item 12): each of
  // these takes only the roster, the trip, the wait list or the last-minute
  // list, all in hand, so none waits on another. They used to be five reads
  // one after another, most of the trip page's serial phases.
  const [
    recentInvites,
    sameNameHeldSeats,
    sameNamePeople,
    heldLastDiveDays,
    packageDivesByPerson,
    certificationSummaries,
    courseMaterialsDone,
    agencyCheckCardsByPerson,
    issuedCardByPerson,
    dependentCharters,
    trainingMarks,
    specialtiesByPerson,
  ] = await Promise.all([
    inviteDatesForCandidates(db, shop.id, diverCandidates),
    // What "Different person" on a held seat can offer to move along with it:
    // other held seats under the same name on the same matched diver, on other
    // departures, named by departure (issue #2081).
    findSameNameHeldSeats(
      db,
      shop.id,
      heldSeats.map(({ booking }) => ({
        bookingId: booking.id,
        personId: booking.personId,
        tripId,
        bookedAs: booking.identityBookedAs,
      })),
    ),
    // "Another diver on file": the shop's other live people with the seat's
    // name, by name only, for a seat held because two divers share it
    // (issue #2129).
    otherSameNamePeople(
      db,
      shop.id,
      heldSeats.map(({ booking }) => ({
        bookingId: booking.id,
        personId: booking.personId,
        bookedAs: booking.identityBookedAs,
      })),
    ),
    // The fact a held seat's "Same person" confirm is weighed against: the
    // matched diver's last dive day at this shop, the same line the name-match
    // prompt shows staff who seat a diver (issue #1789). A staff-seated hold met
    // it there already; an online hold (a public booking that reused an email
    // under another name, H-13) met no prompt, so this is the first time any
    // staffer sees it. Not this departure's: the seat on it is the claim, not
    // evidence for it.
    lastDiveDaysHere(
      db,
      shop.id,
      heldSeats.map(({ booking }) => booking.personId),
      { exceptTripId: tripId },
    ),
    // Unspent package dives this departure could take, per seat, so the payment
    // control says so before anyone takes a fare (issue #1697, H-79).
    spendableDivesForTrip(
      db,
      shop.id,
      [...new Set(roster.map(({ booking }) => booking.personId))],
      {
        courseId: trip.courseId,
      },
    ),
    listCertificationSummaries(db, shop.id, [
      ...new Set([
        ...lastMinuteMatched.map(({ person }) => person.id),
        ...waitlistPersonIds,
        ...dateInterests.flatMap((row) => (row.personId ? [row.personId] : [])),
      ]),
    ]),
    // Who finished the course's materials, read across every departure of the
    // course, so a tick on the pool weekend shows on the open-water one (ADR
    // 20261008-course-learning-materials).
    trip.courseId
      ? courseMaterialsDoneByPerson(db, {
          shopId: shop.id,
          courseId: trip.courseId,
          personIds: roster.map(({ person }) => person.id),
          around: trip.startsAt,
        })
      : new Map<string, CourseMaterialsDone>(),
    // The cards the DiveDay browser extension could check from this tab
    // (H-105), and the N of its "Check all N". Never a held seat's: until a
    // staffer confirms who is standing there, the matched diver's name, birth
    // date and card number are not this seat's to send to an agency.
    listAgencyCheckableCards(db, {
      shopId: shop.id,
      // The nitrox and specialty cards too (issue #2592).
      includeListedCards: true,
      personIds: roster
        .filter(({ booking }) => !booking.identityUnconfirmedAt)
        .map(({ person }) => person.id),
    }),
    // The cards this session issued, so each one can carry "Processed with
    // PADI" (fifth-loop ideas, item 46). Only a course session issues any.
    trip.courseId ? issuedCardsForTrip(db, shop.id, tripId) : new Map<string, IssuedCard>(),
    // On a course session, the charter seats each student was sold only on
    // this course, for the warning in its cancel and move confirmations
    // (issue #2058). Nothing on a charter.
    trip.courseId
      ? chartersRelyingOnCourseSeats(
          db,
          shop.id,
          tripId,
          roster
            .filter(({ booking }) => booking.status === "booked")
            .map(({ booking }) => ({ bookingId: booking.id, personId: booking.personId })),
          nowDate(),
        )
      : new Map<string, DependentCharter[]>(),
    // On a charter, each seat's training mark and the course seats one may
    // name (issue #2275). Nothing on a course session.
    trainingMarksForRoster(
      db,
      shop.id,
      trip,
      roster.map(({ booking }) => ({
        bookingId: booking.id,
        personId: booking.personId,
        participantType: booking.participantType,
        status: booking.status,
        identityHeld: booking.identityUnconfirmedAt !== null,
        trainingEnrollmentBookingId: booking.trainingEnrollmentBookingId,
        trainingMarkedAt: booking.trainingMarkedAt,
        trainingMarkedByPersonId: booking.trainingMarkedByPersonId,
        trainingClearedAt: booking.trainingClearedAt,
        trainingClearedReason: booking.trainingClearedReason,
        trainingClearedByPersonId: booking.trainingClearedByPersonId,
      })),
    ),
    // The list's specialty cards when the departure asks for one, as the send reads them.
    specialtiesForFit(
      db,
      shop.id,
      lastMinuteMatched.map(({ person }) => person.id),
      dealRequirement,
    ),
  ]);

  const heldSeatLastDiveDay = new Map<string, Date | null>(
    heldSeats.map(
      ({ booking }) => [booking.id, heldLastDiveDays.get(booking.personId) ?? null] as const,
    ),
  );

  const packageDivesByBooking = new Map<string, number>();
  for (const { booking } of roster) {
    const dives = packageDivesByPerson.get(booking.personId);
    if (dives) packageDivesByBooking.set(booking.id, dives);
  }

  // Keep the three staff-note entry points one system: a diver-record note is
  // visible on Guests for the same booking, just as it is on Manifest. It is
  // edited on the diver record, the canonical scope, so this roster does not
  // offer a delete action that would silently do nothing.
  const notesByBooking = new Map<
    string,
    Array<(typeof bookingNotes)[number] & { deletable?: boolean }>
  >();
  for (const row of bookingNotes) {
    if (!row.note.bookingId) continue;
    const rows = notesByBooking.get(row.note.bookingId) ?? [];
    rows.push({ ...row, deletable: true });
    notesByBooking.set(row.note.bookingId, rows);
  }
  for (const row of diverNotes) {
    const rows = notesByBooking.get(row.bookingId) ?? [];
    rows.push({ note: row.note, authorName: row.authorName, deletable: false });
    notesByBooking.set(row.bookingId, rows);
  }
  for (const rows of notesByBooking.values()) {
    rows.sort((left, right) => left.note.createdAt.getTime() - right.note.createdAt.getTime());
  }

  const { courseTarget, recipients: lastMinuteRecipients } = lastMinuteRecipientsOf({
    trip,
    matched: lastMinuteMatched.filter(({ person }) => !seatedPersonIds.has(person.id)),
    certificationSummaries,
    specialtiesByPerson,
    dealRequirement,
    waitlistPersonIds,
  });

  // The roster is the spine of the diver section; waiver, readiness, fit and
  // nitrox detail hang off it by booking id so each diver renders as one
  // consolidated card.
  const rentalFitByBooking = new Map(prepDivers.map((row) => [row.bookingId, row.fit] as const));
  const nitroxByBooking = new Map(
    prepDivers
      .filter((row) => row.wantsNitrox)
      .map(
        (row) => [row.bookingId, { requested: true, approved: nitroxTanksApproved(row) }] as const,
      ),
  );
  const readinessByBooking = new Map(readinessRows.map((row) => [row.booking.id, row] as const));
  const waiverByBooking = new Map(
    readinessRows.map(
      (row) =>
        [row.booking.id, { booking: row.booking, person: row.person, waiver: row.waiver }] as const,
    ),
  );

  return {
    trip,
    cancelled: trip.status === "cancelled",
    /** The picker's trimmed query, so the page renders back what it searched for. */
    diverQuery,
    /** This departure's day in the shop's own zone — what a date range is matched against. */
    tripDateIso,
    /** Trip requirements and the site's, combined: what a deal recipient must clear. */
    dealRequirement,
    /** The course this session teaches, in the shape the eligibility filter reads. */
    courseTarget,
    roster,
    requirement,
    interests,
    waitlist,
    inviteSuggestions,
    activity,
    confirmMatches,
    diverCandidates,
    recentInvites,
    notesByBooking,
    courseNextStepByBooking,
    sameNameHeldSeats,
    /** Seats the boat carried or may be carrying: Remove refuses them (H-133). */
    aboardAtSea,
    /** Per same-name held seat, the shop's other people with that name (issue #2129). */
    sameNamePeople,
    /** Per course seat, the charter seats sold only on it (issue #2058). */
    dependentCharters,
    /** On a charter, the training marks and the course seats one may name (issue #2275). */
    trainingMarks,
    /**
     * Per held seat, the matched diver's last dive day at this shop, or null
     * when there is none (issue #1789). Only held seats have an entry.
     */
    heldSeatLastDiveDay,
    /**
     * Per seat, the unspent package dives its diver could put toward this
     * departure; seats with none are absent (issue #1697).
     */
    packageDivesByBooking,
    /** Per seat, the Paid mark's money and what the seat still owes (`getTripRosterWithPaymentMarks`). */
    paymentMarksByBooking,
    /**
     * A split on this departure must take a date of birth: it is a course
     * with a minimum age, which reads the new record's date (issue #2081). A
     * seat whose same-name seats include such a course asks too
     * (`SameNameHeldSeat.asksDateOfBirth`).
     */
    splitAsksDateOfBirth: Boolean(trip.course?.minimumAge),
    /**
     * Whether this roster may certify at all: a course session, and never an
     * intro one (a DSD, a Try Scuba, a refresher). An intro issues no card, and
     * a tap there would mint a verified one for a diver who has never been
     * certified; `certifyDiverFromRosterAction` refuses it too (issue #2059).
     */
    certifies: courseCertifiesStudents(trip.course ?? null),
    /** The rung this course issues (`courses.certifies_level`), where "Certify diver" opens. */
    certifyDefaultLevel: trip.course?.certifiesLevel ?? null,
    /**
     * The course carries learning materials, so each seat says whether a
     * staffer has marked them done (ADR 20261008-course-learning-materials).
     * The tick itself is on the booking row the roster already read.
     */
    courseHasMaterials: readLearningMaterials(trip.course?.learningMaterials).length > 0,
    /**
     * What the DiveDay browser extension would search the agency's eLearning
     * page for, per seat, where it can (H-106): a PADI course with materials.
     */
    elearningQueryByBooking: elearningQueries(trip.course ?? null, roster, shop),
    /** The same course, where the shop's switch keeps PADI's eLearning check off (H-121). */
    elearningChecksOff:
      Boolean(trip.course) &&
      readLearningMaterials(trip.course?.learningMaterials).length > 0 &&
      !agencyCheckOffered(trip.course?.agency ?? "", shop),
    /**
     * Per diver, the cards the DiveDay browser extension could check with
     * their agencies from this tab (H-105). Held seats are never in it.
     */
    agencyCheckCardsByPerson,
    /** Per student, the card this session issued and whether the agency has it yet. */
    issuedCardByPerson,
    /** Done, who and when, by person: the roster's capsule and done line read here. */
    courseMaterialsDoneByPerson: courseMaterialsDone,
    /**
     * Until the session's last day ends, a student with materials still to do
     * wears the capsule; afterwards it would only be noise on a finished roster.
     */
    courseMaterialsOpen: nowDate().getTime() < trip.endsAt.getTime(),
    // `orders/new` refuses without a payable account, so each seat's "Create
    // order" link points at connecting one instead of at a door that bounces.
    paymentsConnected: canAcceptPayments(stripeAccount),
    demand: demandRecommendation({
      capacity: trip.capacity,
      booked: trip.booked,
      // Seats wanted, not interests: a waiting couple is two (fourth review, item 34).
      waitlisted: waitlist.reduce((seats, { interest }) => seats + (interest.partySize ?? 1), 0),
    }),
    dateInterests,
    /** The shop keeps a wait list (the Features page); off, a full boat's roster offers none. */
    waitlistOn: shop.waitlistEnabled,
    lastMinute: {
      matched: lastMinuteMatched,
      dateIso: tripDateIso,
      promos: lastMinutePromos,
      promoRecipients: lastMinutePromoRecipients,
      recipients: lastMinuteRecipients,
      /**
       * "Promote this trip" appears only when there is somebody to promote it
       * to. A blast that *has* gone out keeps its panel regardless: the record
       * of what was sent, to how many people, is trip history and outlives the
       * list that received it.
       */
      showPromote: lastMinuteMatched.length > 0 || lastMinutePromos.length > 0,
    },
    certificationSummaries,
    byBooking: {
      rentalFit: rentalFitByBooking,
      nitrox: nitroxByBooking,
      readiness: readinessByBooking,
      waiver: waiverByBooking,
    },
  };
}

function elearningQueries(
  course: { agency: string; title: string; learningMaterials: unknown } | null,
  roster: readonly {
    booking: { id: string };
    person: { fullName: string; email: string | null };
  }[],
  shop: { padiChecksEnabled: boolean },
): Map<string, ElearningQuery> {
  const queries = new Map<string, ElearningQuery>();
  if (!course || readLearningMaterials(course.learningMaterials).length === 0) return queries;
  // PADI's eLearning waits for the shop's own switch (H-121).
  if (!agencyCheckOffered(course.agency, shop)) return queries;
  for (const { booking, person } of roster) {
    const query = elearningCheckQuery({
      agency: course.agency,
      fullName: person.fullName,
      email: person.email,
      courseTitle: course.title,
    });
    if (query) queries.set(booking.id, query);
  }
  return queries;
}
