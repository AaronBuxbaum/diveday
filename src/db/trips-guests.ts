import { courseCertifiesStudents, readLearningMaterials } from "@/lib/courses";
import { demandRecommendation } from "@/lib/demand";
import { nitroxTanksApproved } from "@/lib/dive-prep";
import {
  filterEligibleLastMinuteRecipients,
  lastMinuteEntryMatchesTripDate,
  orderLastMinuteRecipients,
} from "@/lib/last-minute-list";
import { nowDate } from "@/lib/clock";
import { combineCertRequirements } from "@/lib/readiness";
import { isFull } from "@/lib/trips";
import { toDateInputValue, utcToWallTime } from "@/lib/zoned";
import { sameNameHeldSeats as findSameNameHeldSeats } from "./bookings";
import type { AppDb } from "./client";
import { type CourseMaterialsDone, courseMaterialsDoneByPerson } from "./course-materials";
import { courseNextStepsByBooking } from "./course-next-step";
import { findSimilarDivers, listBookableDivers } from "./divers";
import { listLastMinuteList } from "./last-minute-list";
import { listBookingNotes, listDiverNotesForTrip, listTripActivity } from "./operations";
import { getTripRequirements, getTripSiteRequirement, listTripReadiness } from "./readiness";
import { listTripPrepDivers } from "./rental-fit";
import { listCertificationSummaries } from "./self-declared-cards";
import { canAcceptPayments, getShopStripeAccount } from "./stripe-accounts";
import { listTripInvitations } from "./trip-invitations";
import { listTripLastMinutePromoRecipients, listTripLastMinutePromos } from "./trip-promos";
import { getTripRoster, getTripWaitlist, getTripWithBooked } from "./trips";
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

export type TripGuestsShop = { id: string; timezone: string };

export type TripGuestsFilters = {
  /** The returning-diver picker's query. Blank means the picker is closed. */
  diverQuery?: string;
  /** A name a staffer is being asked to confirm against existing divers. */
  confirmName?: string;
};

export type TripGuests = NonNullable<Awaited<ReturnType<typeof getTripGuests>>>;

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
  const [confirmMatches, diverCandidates] = await Promise.all([
    filters.confirmName ? findSimilarDivers(db, shop.id, filters.confirmName) : [],
    // The returning-diver picker only books, so it is skipped once the boat is
    // full — hand-entry then wait-lists instead.
    isFull(trip) || diverQuery === ""
      ? []
      : listBookableDivers(db, shop.id, tripId, { query: diverQuery }),
  ]);

  const [
    roster,
    requirement,
    siteRequirement,
    readinessRows,
    prepDivers,
    waitlist,
    invitations,
    lastMinuteList,
    lastMinutePromos,
    lastMinutePromoRecipients,
    bookingNotes,
    diverNotes,
    activity,
    stripeAccount,
    courseNextStepByBooking,
  ] = await Promise.all([
    getTripRoster(db, shop.id, tripId),
    shared ? shared.requirement : getTripRequirements(db, shop.id, tripId),
    shared ? shared.siteRequirement : getTripSiteRequirement(db, shop.id, tripId),
    shared ? shared.readiness : listTripReadiness(db, shop.id, tripId),
    shared ? shared.prepDivers : listTripPrepDivers(db, shop.id, tripId),
    getTripWaitlist(db, shop.id, tripId),
    listTripInvitations(db, shop.id, tripId),
    listLastMinuteList(db, shop.id),
    listTripLastMinutePromos(db, shop.id, tripId),
    listTripLastMinutePromoRecipients(db, shop.id, tripId),
    listBookingNotes(db, shop.id, tripId),
    listDiverNotesForTrip(db, shop.id, tripId),
    listTripActivity(db, shop.id, tripId),
    getShopStripeAccount(db, shop.id),
    // What each student on a course session has already been told to do next
    // (issues #1196, #1205), so the roster's box opens holding it.
    courseNextStepsByBooking(db, shop.id, tripId),
  ]);

  // What "Different person" on a held seat can offer to move along with it:
  // other held seats under the same name on the same matched diver, on other
  // departures, named by departure (issue #2081).
  const sameNameHeldSeats = await findSameNameHeldSeats(
    db,
    shop.id,
    roster
      .filter(({ booking }) => booking.identityUnconfirmedAt)
      .map(({ booking }) => ({
        bookingId: booking.id,
        personId: booking.personId,
        tripId,
        bookedAs: booking.identityBookedAs,
      })),
  );

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

  // The last-minute pipeline: who said they are around on this date, who among
  // them could actually be cleared for it, and in what order to offer the seat.
  const tripDateIso = toDateInputValue(utcToWallTime(trip.startsAt, shop.timezone));
  const lastMinuteMatched = lastMinuteList.filter(({ entry }) =>
    lastMinuteEntryMatchesTripDate(entry, tripDateIso),
  );
  const waitlistPersonIds = waitlist.map(({ person }) => person.id);
  const certificationSummaries = await listCertificationSummaries(db, shop.id, [
    ...new Set([...lastMinuteMatched.map(({ person }) => person.id), ...waitlistPersonIds]),
  ]);
  const dealRequirement = combineCertRequirements(
    requirement ?? {
      minimumCertificationLevel: null,
      requiredSpecialties: [],
      requiresNitrox: false,
    },
    siteRequirement,
  );
  const courseTarget = trip.course
    ? {
        slug: trip.course.slug,
        title: trip.course.title,
        sourceTemplateSlug: trip.course.sourceTemplateSlug,
        minimumCertificationLevel: trip.course.minimumCertificationLevel,
        isIntroCourse: trip.course.isIntroCourse,
      }
    : null;
  const lastMinuteRecipients = orderLastMinuteRecipients(
    filterEligibleLastMinuteRecipients(
      lastMinuteMatched.map((match) => ({
        ...match,
        certification: certificationSummaries.get(match.person.id) ?? null,
      })),
      dealRequirement,
      courseTarget,
    ),
    waitlistPersonIds,
  );

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

  // Who finished the course's materials, read across every departure of the
  // course, so a tick on the pool weekend shows on the open-water one (ADR
  // 20261008-course-learning-materials).
  const courseMaterialsDone = trip.courseId
    ? await courseMaterialsDoneByPerson(db, {
        shopId: shop.id,
        courseId: trip.courseId,
        personIds: roster.map(({ person }) => person.id),
        around: trip.startsAt,
      })
    : new Map<string, CourseMaterialsDone>();

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
    waitlist,
    invitations,
    activity,
    confirmMatches,
    diverCandidates,
    notesByBooking,
    courseNextStepByBooking,
    sameNameHeldSeats,
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
      waitlisted: waitlist.length,
    }),
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
