import { and, eq, isNull, sql } from "drizzle-orm";
import { type CarriedPreparation, carriedPreparation } from "@/lib/carried-preparation";
import { nowDate } from "@/lib/clock";
import { type CourseLearningMaterial, readLearningMaterials } from "@/lib/courses";
import { seatListPriceCents, withinCancellationWindow } from "@/lib/deposits";
import type { DeskPayment } from "@/lib/desk-payment";
import type { DiveIntent } from "@/lib/dive-intent";
import type { DiveRecencyBand } from "@/lib/dive-recency";
import { seatIsHeld } from "@/lib/no-show";
import { publicAppUrl } from "@/lib/notifications";
import type { ParticipantType } from "@/lib/participant-types";
import { isCapturedPaymentStatus } from "@/lib/payment-source";
import { publicCoursePath } from "@/lib/public-routes";
import { type ReEntryAsk, reEntryWindowOpen } from "@/lib/re-entry";
import { noCertificationStands } from "@/lib/readiness";
import type { RentalPricing } from "@/lib/rentals";
import { canSayRunningLate, runningLateShown } from "@/lib/running-late";
import { hasSailed } from "@/lib/trips";
import { type DiveDayMilestone, diveDayMilestone } from "@/lib/visit-milestones";
import { shopWaiverStatus } from "@/lib/waivers";
import {
  type OfferableWelcomeCue,
  offerableWelcomeCue,
  type WelcomeHello,
} from "@/lib/welcome-cue";
import { heldAtTheDoor } from "./aboard-at-sea";
import type { AppDb } from "./client";
import { courseMaterialsDoneByPerson } from "./course-materials";
import { firstActiveIntroCourse, hasActiveRefresherCourse } from "./courses";
import { getHelpRequestForBooking, type HelpRequest } from "./help-requests";
import { getPendingMoveAsk, type PendingMoveAsk } from "./inbound-messages";
import { nitroxCardOnFilePersonIds, verifiedNitroxPersonIds } from "./nitrox";
import { getBookingPayment } from "./payments";
import { type BookingReadinessDetail, getBookingReadinessDetail } from "./readiness";
import {
  type DiverRentalFit,
  fitConfirmationForDiver,
  getRentalFit,
  type RentalFitItem,
  toDiverRentalFit,
} from "./rental-fit";
import { bookings, certifications, people, shops, trips } from "./schema";
import { canAcceptPayments, getShopStripeAccount } from "./stripe-accounts";
import { getTripWithBookedOnce, listTripScheduleDays } from "./trips";
import { getCurrentWaiverGeneration, listSignedWaiversByPerson } from "./waivers";
import { diveDayCountForSeat, welcomeCueInputsByBooking } from "./welcome-cues";

/**
 * **What `/ready` says in the first paint after a booking**, and nothing else
 * (UX review 2026-10-10, item 7).
 *
 * The page after a booking POST used to hold the diver on a whole-page
 * skeleton until {@link getReadyPageData} had finished, and that loader reads
 * the departure's entire readiness roster before it returns. The masthead and
 * the "You've got a seat" card need none of it: whose shop, which departure,
 * when, when to be at the dock, and who to greet. That is one row, so the page
 * paints it from this read and streams the thread in under it.
 *
 * Keyed by a booking id the caller has already verified through the readiness
 * capability; it reads only that booking's own row, its departure and its
 * shop, and authorizes nothing. The two `Cancelled` flags are there so the page
 * can decline the fast path for a seat or departure that is already gone and
 * fall through to the full loader, which owns those terminal cards.
 *
 * The greeting follows {@link getReadyPageData}'s rule word for word: a booking
 * whose identity is held greets the name it was booked under, never the
 * matched record's (`src/db/ready.test.ts` holds the two to each other).
 *
 * **It reads no readiness, deliberately**, which is why the card it feeds
 * claims a seat and never boarding ("You've got a seat", not "You're on the
 * boat"; dive-domain review 2026-10-12). A diver held for medical review, short
 * a certification level, with a held identity or under a course's minimum age
 * still holds the seat, so the card is true of them; whether they board is the
 * thread's to say, directly under it.
 */
export type BookedCard = {
  shop: {
    name: string;
    slug: string;
    timezone: string;
    defaultLocale: (typeof shops.$inferSelect)["defaultLocale"];
    dockCallMinutes: number;
  };
  trip: { id: string; title: string; startsAt: Date; endsAt: Date };
  greetingName: string;
  pickup: { time: string | null; location: string | null };
  bookingCancelled: boolean;
  departureCancelled: boolean;
  /** This seat is the diver's 10th, 25th, 50th or 100th boat with the shop (H-128), or null. */
  milestone: DiveDayMilestone | null;
};

export async function getBookedCard(
  db: AppDb,
  {
    shopId,
    bookingId,
    delivered,
  }: {
    shopId: string;
    bookingId: string;
    /** The link was mailed to the contact on file; only then is a count said. */
    delivered: boolean;
  },
): Promise<BookedCard | null> {
  const [row] = await db
    .select({
      status: bookings.status,
      pickupTime: bookings.pickupTime,
      hotelPickupLocation: bookings.hotelPickupLocation,
      identityUnconfirmedAt: bookings.identityUnconfirmedAt,
      identityBookedAs: bookings.identityBookedAs,
      personName: people.fullName,
      tripId: trips.id,
      tripTitle: trips.title,
      startsAt: trips.startsAt,
      endsAt: trips.endsAt,
      tripStatus: trips.status,
      shopName: shops.name,
      slug: shops.slug,
      timezone: shops.timezone,
      defaultLocale: shops.defaultLocale,
      dockCallMinutes: shops.dockCallMinutes,
    })
    .from(bookings)
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .innerJoin(people, eq(people.id, bookings.personId))
    .innerJoin(shops, eq(shops.id, bookings.shopId))
    .where(and(eq(bookings.id, bookingId), eq(bookings.shopId, shopId)))
    .limit(1);
  // A seat the desk released is not one the card may claim (layer 3 review,
  // dde-1 F2): no card, and the full path answers with its own.
  if (!row || row.status === "no_show") return null;
  const identityHeld = row.identityUnconfirmedAt !== null;
  // A held seat speaks for a record staff have not matched to whoever booked
  // (#2082), and a booking redirect proved only a typed name and address
  // (security review r5-4, second pass, N-c): neither is told a count.
  const milestone =
    identityHeld || !delivered
      ? null
      : diveDayMilestone(await diveDayCountForSeat(db, shopId, bookingId));
  return {
    shop: {
      name: row.shopName,
      slug: row.slug,
      timezone: row.timezone,
      defaultLocale: row.defaultLocale,
      dockCallMinutes: row.dockCallMinutes,
    },
    trip: { id: row.tripId, title: row.tripTitle, startsAt: row.startsAt, endsAt: row.endsAt },
    greetingName: identityHeld ? row.identityBookedAs?.trim() || "" : row.personName,
    // Said even after the shop stops offering hotel pickups (the Features
    // page): a pickup already promised still happens.
    pickup: { time: row.pickupTime, location: row.hotelPickupLocation },
    bookingCancelled: row.status === "cancelled",
    departureCancelled: row.tripStatus !== "scheduled",
    milestone,
  };
}

/**
 * Everything the transactional `/ready` page needs, gathered from the same
 * source-of-truth queries the staff and booking surfaces use, so the diver's
 * self-serve page can never show a state those surfaces disagree with. The
 * readiness result itself still comes from the fail-closed engine; this only
 * adds the ids, contact details, rental fit, and payment capability the page
 * acts on.
 */
export type ReadyPageData = {
  detail: BookingReadinessDetail;
  shop: {
    id: string;
    slug: string;
    defaultLocale: string;
    /** The shop's own currency, so the rental quote is not quoted in dollars. */
    currency: string;
    contactEmail: string | null;
    contactPhone: string | null;
    /**
     * The shop's own street address — where a diver actually meets the boat.
     * Every part is nullable and a shop can have none of it on file; the
     * readiness page renders the block (and its map) only when there is
     * something real to show, never a guessed or partial address.
     */
    address: {
      street: string | null;
      locality: string | null;
      region: string | null;
      postalCode: string | null;
      country: string | null;
    };
    rentalItems: string[];
    rentalPricing: RentalPricing;
    /** Minutes before departure the shop wants divers at the dock — the same figure the night-before email's arrival line uses. */
    dockCallMinutes: number;
    /** How the desk takes money, said after a figure owed there (fifth-loop ideas, item 21). */
    deskPayment: DeskPayment | null;
  };
  trip: {
    id: string;
    plannedDives: number;
    meetingPointLabel: string | null;
    meetingPointAddress: string | null;
    arrivalLandmark: string | null;
    arrivalParkingNote: string | null;
    arrivalTransitNote: string | null;
    arrivalLookFor: string | null;
    arrivalFirstInteraction: string | null;
    /**
     * Only what the gear step needs, never the whole catalog row: whether a
     * session of this course may run on enriched air (`nitroxAvailableOn`,
     * src/lib/rentals.ts), and whether its rental gear is part of the course
     * fee, which takes the prices off the sizes form. Null on an ordinary
     * charter, which the gate reads as "the shop's answer is the whole answer".
     */
    course: { nitroxCompatible: boolean; gearIncluded: boolean } | null;
    /**
     * What this seat costs on this departure (`seatListPriceCents`): the fare
     * for its participant type, or null on an unpriced trip. The thread's
     * receipt works out a balance after a deposit from it.
     */
    seatPriceCents: number | null;
  };
  person: {
    id: string;
    email: string | null;
    /** Their own recorded reading language, or null when DiveDay has never
     * heard one first-hand (docs ADR 20260731-per-person-notification-locale). */
    locale: string | null;
  };
  /**
   * **The diver's own emergency contact, read back to them on their own link**
   * (ADR 20260904-reef-all-the-way-down, D15).
   *
   * An explicit two-field projection, never the `people` row: this is the same
   * boundary `toDiverRentalFit` draws, and the next column added to `people`
   * must not reach a bearer-token page by default.
   *
   * This adds no new audience for the number. It is already on the manifest the
   * crew carries and on the waiver the diver signed; what is new is that the
   * person it belongs to can see and correct it without asking the shop.
   */
  emergencyContact: { name: string | null; phone: string | null };
  /**
   * Staff have not yet confirmed that this seat's diver is the diver record it
   * was matched to (`bookings.identity_unconfirmed_at`). Until they do, the
   * link may be in someone else's hands, so nothing read off that record —
   * emergency contact, rental fit, the kept-fit recall, nitrox cards — comes
   * back, and the actions refuse to write onto it (#2082).
   */
  identityHeld: boolean;
  /**
   * The name the page greets: the person's own, or while the seat is held the
   * name it was booked under ("" when none was typed, so the page greets
   * nobody by name). The matched person's name would tell the booker whose
   * record their email reached (issue #2125).
   */
  greetingName: string;
  /**
   * When this seat was booked. Read for one question and one only: whether the
   * shop was already holding this diver's stated fit *before* the booking
   * existed, which is what makes the "Anything changed?" step a question about
   * last time rather than about a form they filled in five minutes ago
   * (`buildThreadSteps`'s `carriedFacts`).
   */
  bookingCreatedAt: Date;
  /** They have answered that question for this seat, or null — the ordinary absent state. */
  carriedFactsConfirmedAt: Date | null;
  /**
   * A staffer kept this diver's fit after a previous trip, with the piece and
   * the day (D14). Null unless the name, the item and the time are all on file,
   * which is what stops the recall sentence half-rendering.
   */
  fitConfirmation: { staffFullName: string; item: RentalFitItem; confirmedAt: Date } | null;
  wantsNitrox: boolean;
  /**
   * The diver's own answer to "when did you last dive?", or null when they have
   * not been asked or have not said (ADR 20260821-currency-is-what-catches-people).
   * Gates nothing anywhere; `/ready` renders it as a question the diver can still
   * answer, and the staff surfaces render it as their word.
   */
  lastDivedBand: DiveRecencyBand | null;
  /**
   * What the diver said this dive is for, or null when they were not asked or
   * did not say (ADR 20260904-reef-all-the-way-down, D12). Gates nothing; the
   * booking form asks it and `/ready` is where it can be changed, which is what
   * makes the form's "change it any time" true — and what reaches the party
   * member and the walk-in who never saw a booking form at all.
   */
  diveIntent: DiveIntent | null;
  /**
   * Which of D18's three offers this diver took, or null when they were never
   * offered or took none. Only ever asked of a diver whose {@link diveIntent}
   * is `easing_back`; it informs the crew and gates nothing.
   */
  reEntryAsk: ReEntryAsk | null;
  /**
   * Whether the three offers are worth making at all: the diver said they are
   * easing back, the departure is far enough out that the shop can still act
   * (`reEntryWindowOpen`), and — for the third offer — the shop publishes a
   * refresher course to point them at. False the rest of the time, which is
   * almost always, and the query behind it only runs then.
   */
  refresherCourseOffered: boolean;
  /**
   * Present when this seat's level gate is unmet because the diver said "I'm
   * not certified yet" (`certification_not_yet`, third UX review item 23): the
   * try-it course (`is_intro_course`) the certification step points them at,
   * null when the shop publishes none. Null on every other seat.
   */
  certificationNotYet: { introCourse: { title: string; href: string } | null } | null;
  reEntryOffersOpen: boolean;
  nitroxCardVerified: boolean;
  /**
   * A live nitrox card exists for this diver, sighted or not. Only decides
   * whether the fit form still asks for one — never a fill or boarding gate
   * (`nitroxCardOnFilePersonIds`).
   */
  nitroxCardOnFile: boolean;
  /**
   * At least one live certification card on file, verified or not; false
   * while the seat is held. Decides only whether a course student's packing
   * list suggests a logbook (`packsLogbook`) — never a gate.
   */
  holdsCertification: boolean;
  /**
   * How many days this departure meets on (`trip_schedule_days`), read on a
   * course session only (0 elsewhere): its one-day plan is said on a
   * one-meeting session alone (`SessionDayPlan`).
   */
  meetingDayCount: number;
  /** Projected: staff-only fit columns never reach the diver's browser. */
  rentalFit: DiverRentalFit | null;
  /** The one active, non-medical day-of request this booking has made. */
  helpRequest: HelpRequest | null;
  /** The shop takes day-of help requests (the Features page); off, only an open one is shown. */
  helpRequestsOn: boolean;
  /** True when the shop can actually take a card for this trip right now. */
  canPay: boolean;
  /** The shop runs hotel pickups, so Day-of details asks about one (fourth UX review, item 8). */
  offersHotelPickup: boolean;
  /** Lunch is served aboard, so Day-of details asks for a lunch preference (ideas item 56). */
  lunchAboard: boolean;
  /** This diver's lunch preference; null when nothing. */
  dietaryNote: string | null;
  /**
   * This seat is priced, unpaid, and the page cannot take a card for it: the
   * money is owed at the shop, and `/ready` says how much, the party's unclaimed
   * seats included (fourth UX review, item 5).
   */
  owesAtShop: boolean;
  /**
   * What this seat is (ADR 20261007-participant-types): its price is its own,
   * and a snorkeler or a rider is not asked a diver's questions.
   */
  participantType: ParticipantType;
  /**
   * The seat may owe course forms: it is on a course session, or staff marked
   * it as a training dive for a course seat (issue #2275), whose forms are
   * then signed on the enrollment.
   */
  asksCourseForms: boolean;
  /**
   * What cancelling right now would do to any payment already captured —
   * shown before the diver commits, mirroring `refundBookingOnCancellation`'s
   * decision without moving any money. Never trust this for the actual
   * refund: the cancel action re-derives it server-side at the moment of
   * cancellation, since "now" and payment state can both move between page
   * load and submit.
   */
  cancelPreview: "refund" | "forfeit" | "no_policy" | "unpaid";
  /**
   * Lodging / hotel pickup location (free text) provided by the diver on /ready.
   */
  hotelPickupLocation: string | null;
  /**
   * Staff-set pickup time for this booking (e.g. "07:15").
   */
  pickupTime: string | null;
  /**
   * Whether a seat this diver can still release exists. Mirrors
   * `selfCancelBooking`'s own two pre-checks exactly — a plain `booked` seat,
   * on a departure that has not sailed — including its one-hour late-departure
   * buffer (AGENTS.md), so the page can never render a control that could only
   * ever come back refused. A `checked_in`/`no_show` seat is a day-of state a
   * pre-trip link must not flip back, and a boat that has left cannot un-take
   * someone aboard.
   */
  canCancelBooking: boolean;
  /**
   * The desk saw this diver and turned them away (H-135), rather than marking
   * them not here. After the departure the page says the shop could not take
   * them, never that they did not make it. The category is not carried: the
   * diver was there, and a bearer link is no place to print it.
   */
  turnedAway: boolean;
  /**
   * The desk released this seat (turned away, or marked not here). Before
   * the day is over the page says only that the shop released it and to talk
   * to the desk, with no category, and draws no checklist, payment or
   * running-late control (layer 3 review, dde-1 F2).
   */
  seatReleased: boolean;
  /**
   * **"Add a seat"** (UX review 2026-10-11, item 13): this booking may lead a
   * party seat added from the page. The same moment a seat may be released
   * (`canCancelBooking`), never on a held seat, and never on a party member's
   * own seat, so the page draws no control `addPartySeat` would only refuse
   * for who is asking. Capacity and admission are its own to answer.
   */
  canAddSeat: boolean;
  /**
   * **"Pay for this seat"** (issue #2474): this booking leads a party and the
   * page could open a checkout for a seat it added. A fact about the lead and
   * the shop only (a live seat on a departure still ahead, a connected
   * account, a held identity that is not); which seats are owed is
   * `PartySeatClaim.payable`.
   */
  canPayPartySeats: boolean;
  /**
   * **"Running late"** (J3). `open` is `canSayRunningLate` for this seat now —
   * booked, not checked in, from the night-before brief until a scheduled
   * departure has sailed — and `saidAt` is when the diver already said
   * so, on a seat still to arrive. The page draws the button while it is
   * open and nothing has been said, and the said line while it is open after.
   */
  runningLate: { open: boolean; saidAt: Date | null };
  /**
   * **"Ask to move"** (H-126). Past the free-cancellation window, or on a
   * trip with none, a paid cancel returns nothing right away, so the diver
   * may ask the shop for another date instead: `open` while that ask could be
   * made — a paid seat the diver may still release, not held, on their own
   * booking — and a receipt while one about this departure stands
   * (`getPendingMoveAsk`), so the page says so rather than offering it twice. Null
   * everywhere else. The move itself is staff's.
   */
  moveAsk: "open" | PendingMoveAsk | null;
  /**
   * **The departure itself was called off** — `trips.status`, not the
   * booking's.
   *
   * The two are genuinely different facts and the page needs both. A blow-out
   * cancels the trip and deliberately leaves every booking `booked`, because
   * whether each seat is refunded stays a per-booking staff decision
   * (src/db/blowouts.ts) — so `detail.cancelled` is false for every diver a
   * cancellation stranded, and a page reading only that told them to pack.
   */
  departureCancelled: boolean;
  /**
   * **What there would be to tell the crew about this diver** (issue #1182,
   * delight report D22) — a first trip with this shop, or a return after a long
   * gap — regardless of whether they have said yes. Null means there is nothing
   * to offer and the question is not asked at all.
   */
  welcomeOffer: OfferableWelcomeCue | null;
  /** Whether they have said yes. Their own answer, on their own link. */
  welcomeShared: boolean;
  /** What they chose to add to the hello (#2425); null without a yes. */
  welcomeHello: WelcomeHello | null;
  /**
   * What this course asks a student to work through before day 1 (ADR
   * 20261008-course-learning-materials), read through `readLearningMaterials`
   * so only `https:` links reach the page. Empty on a fun dive.
   */
  learningMaterials: CourseLearningMaterial[];
  /**
   * Someone marked this student's materials done, on this departure or another
   * of the same course (`courseMaterialsDoneByPerson`).
   */
  courseMaterialsDone: boolean;
  /** The session's first day has begun: the list is reference now, not a to-do. */
  courseStarted: boolean;
};

/**
 * Everything `getReadyPageData` reads beside the readiness detail: the booking
 * row, then one fan-out of the trip and the rest. Null when the booking or its
 * trip is gone.
 */
async function readyPageReads(db: AppDb, bookingId: string, now: Date) {
  const [row] = await db
    .select({
      shopId: bookings.shopId,
      tripId: bookings.tripId,
      personId: bookings.personId,
      wantsNitrox: bookings.wantsNitrox,
      participantType: bookings.participantType,
      trainingEnrollmentBookingId: bookings.trainingEnrollmentBookingId,
      lastDivedBand: bookings.lastDivedBand,
      welcomeSharedAt: bookings.welcomeSharedAt,
      welcomeHello: bookings.welcomeHello,
      courseMaterialsDoneAt: bookings.courseMaterialsDoneAt,
      diveIntent: bookings.diveIntent,
      reEntryAsk: bookings.reEntryAsk,
      hotelPickupLocation: bookings.hotelPickupLocation,
      dietaryNote: bookings.dietaryNote,
      pickupTime: bookings.pickupTime,
      status: bookings.status,
      turnedAwayAt: bookings.turnedAwayAt,
      runningLateAt: bookings.runningLateAt,
      bookingCreatedAt: bookings.createdAt,
      carriedFactsConfirmedAt: bookings.carriedFactsConfirmedAt,
      identityUnconfirmedAt: bookings.identityUnconfirmedAt,
      identityBookedAs: bookings.identityBookedAs,
      partyLeadBookingId: bookings.partyLeadBookingId,
      slug: shops.slug,
      defaultLocale: shops.defaultLocale,
      currency: shops.currency,
      contactEmail: shops.contactEmail,
      contactPhone: shops.contactPhone,
      addressStreet: shops.addressStreet,
      addressLocality: shops.addressLocality,
      addressRegion: shops.addressRegion,
      addressPostalCode: shops.addressPostalCode,
      addressCountry: shops.addressCountry,
      rentalItems: shops.rentalItems,
      rentalPricing: shops.rentalPricing,
      dockCallMinutes: shops.dockCallMinutes,
      offersHotelPickup: shops.offersHotelPickup,
      helpRequestsOn: shops.helpRequestsEnabled,
      deskPayment: shops.deskPayment,
      personEmail: people.email,
      personLocale: people.locale,
      emergencyContactName: people.emergencyContactName,
      emergencyContactPhone: people.emergencyContactPhone,
      noCertificationDeclaredAt: people.noCertificationDeclaredAt,
      noCertificationClearedAt: people.noCertificationClearedAt,
      tripStartsAt: trips.startsAt,
      tripCourseId: trips.courseId,
      tripLunchAboard: trips.lunchAboard,
      // Any live card, verified or not: whether a course student has dives to
      // log (`packsLogbook`, issue #2795). In this row rather than a query of
      // its own, so the page stays inside its round-trip budget.
      holdsAnyCertification: sql<boolean>`exists (select 1 from ${certifications} where ${certifications.shopId} = ${bookings.shopId} and ${certifications.personId} = ${bookings.personId} and ${certifications.deletedAt} is null)`,
    })
    .from(bookings)
    .innerJoin(people, eq(people.id, bookings.personId))
    .innerJoin(shops, eq(shops.id, bookings.shopId))
    // diveday:allow-deleted-trips: the window and course columns only; the
    // trip itself is read through `getTripWithBookedOnce`, which keeps `liveTrip()`.
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .where(eq(bookings.id, bookingId))
    .limit(1);
  if (!row) return null;

  // The trip and the refresher flag need only the booking row's columns, so
  // they ride the fan-out below rather than going first.

  // **D18's offers, and the one query they are worth.** Inside 24 hours of a
  // departure nobody at the shop can act on an ask, and a diver who has not
  // said they are easing back was never offered one — so both gates are
  // answered from rows already in hand, and the refresher-course lookup only
  // runs for the small set of divers who reach the third offer.
  const reEntryOffersOpen =
    row.diveIntent === "easing_back" && reEntryWindowOpen(row.tripStartsAt, now);

  const [
    trip,
    refresherCourseOffered,
    introCourse,
    materialsDoneElsewhere,
    rentalFit,
    helpRequest,
    payment,
    stripeAccount,
    nitroxVerified,
    nitroxOnFile,
    welcomeInputs,
    fitConfirmation,
    pendingMoveAsk,
    meetingDays,
  ] = await Promise.all([
    getTripWithBookedOnce(db, row.shopId, row.tripId),
    reEntryOffersOpen ? hasActiveRefresherCourse(db, row.shopId) : false,
    // Only for a diver whose "I'm not certified yet" stands: the one door the
    // certification step opens for them (third UX review, item 23).
    noCertificationStands(row) ? firstActiveIntroCourse(db, row.shopId) : null,
    // Someone marked this student's materials done on another departure of the
    // same course; asked only when this seat carries no mark of its own.
    row.courseMaterialsDoneAt === null && row.tripCourseId !== null
      ? courseMaterialsDoneByPerson(db, {
          shopId: row.shopId,
          courseId: row.tripCourseId,
          personIds: [row.personId],
          around: row.tripStartsAt,
        }).then((done) => done.has(row.personId))
      : false,
    getRentalFit(db, row.shopId, row.personId),
    getHelpRequestForBooking(db, row.shopId, bookingId, now),
    getBookingPayment(db, row.shopId, bookingId),
    getShopStripeAccount(db, row.shopId),
    verifiedNitroxPersonIds(db, row.shopId),
    nitroxCardOnFilePersonIds(db, row.shopId),
    // The same reader the manifest uses, so "First dive with us" means the
    // same thing on the diver's own page as it does under their name at the
    // rail (issue #1182).
    welcomeCueInputsByBooking(db, row.shopId, row.tripId, now, { diveDayCounts: false }),
    // Recall, not inference: who kept this diver's fit after a previous trip.
    // Read here rather than folded into `getRentalFit`'s row, because the
    // staffer's name comes from a join this page is the only caller of.
    fitConfirmationForDiver(db, row.shopId, row.personId),
    // Whether an ask to move stands (H-126), read here with the rest rather
    // than after the cancel check it is used behind: that was two round trips
    // more for every seat past the free window. A seat that cannot be
    // released, or whose identity is held, never shows it.
    row.status === "booked" &&
    !hasSailed(row.tripStartsAt, now) &&
    row.identityUnconfirmedAt === null
      ? getPendingMoveAsk(db, row.shopId, bookingId, row.tripId)
      : null,
    // How many days a course session meets on, for its own day plan
    // (`SessionDayPlan`, issue #2795); a charter says no plan day.
    row.tripCourseId !== null ? listTripScheduleDays(db, row.shopId, row.tripId) : [],
  ]);
  if (!trip) return null;
  return {
    row,
    trip,
    refresherCourseOffered,
    introCourse,
    reEntryOffersOpen,
    rentalFit,
    helpRequest,
    payment,
    stripeAccount,
    nitroxVerified,
    nitroxOnFile,
    welcomeInputs,
    fitConfirmation,
    materialsDoneElsewhere,
    pendingMoveAsk,
    // Nothing is read off a held seat's matched person, so a held seat holds none.
    holdsCertification: row.identityUnconfirmedAt === null && row.holdsAnyCertification,
    meetingDayCount: meetingDays.length,
  };
}

export async function getReadyPageData(
  db: AppDb,
  bookingId: string,
  now: Date = nowDate(),
): Promise<ReadyPageData | null> {
  // **Two chains side by side, not one after the other** (code review
  // 2026-10-11, item 3). The readiness detail — the fail-closed engine's answer
  // for this seat — and everything else this page reads both start from the
  // booking id alone, so neither waits on the other: the page used to read the
  // detail, then the booking row, then the trip, then the refresher flag, then
  // a fan-out, five steps one after another.
  const [detail, page] = await Promise.all([
    getBookingReadinessDetail(db, bookingId),
    readyPageReads(db, bookingId, now),
  ]);
  if (!detail || !page) return null;
  const {
    row,
    trip,
    refresherCourseOffered,
    introCourse,
    reEntryOffersOpen,
    rentalFit,
    helpRequest,
    payment,
    stripeAccount,
    nitroxVerified,
    nitroxOnFile,
    welcomeInputs,
    fitConfirmation,
    materialsDoneElsewhere,
    pendingMoveAsk,
    holdsCertification,
    meetingDayCount,
  } = page;
  // `partly_refunded` settles too, or this page would invite a diver who has
  // already paid — and been handed part of it back — to pay the full price a
  // second time. The capability URL is shared by design, so anyone holding it
  // could do it (issue #699 security review). `startBookingCheckout` refuses
  // it server-side as well; this only decides whether the button is drawn.
  const settled = isCapturedPaymentStatus(payment?.status) || payment?.status === "waived";

  // This seat's own price: a snorkeler is never asked for the dive fare
  // (ADR 20261007-participant-types).
  const perDiverPriceCents = seatListPriceCents(trip, trip.course, row.participantType);
  // **Only a seat the diver still holds is payable** (layer 3 review, dde-2
  // #1): a seat the desk released may already be resold, and a capture on it
  // is money for a place the diver no longer has. `startBookingCheckout`
  // refuses it server-side as well.
  const canPay = Boolean(
    seatIsHeld(row.status) &&
      perDiverPriceCents &&
      !settled &&
      canAcceptPayments(stripeAccount) &&
      publicAppUrl(),
  );

  // `captured`, not `settled`: a waived booking has no money to give back, so
  // it reads as `unpaid` here — the same answer `refundBookingOnCancellation`
  // reaches, and the reason this preview is derived rather than stored.
  const captured = isCapturedPaymentStatus(payment?.status);
  const cancelPreview: ReadyPageData["cancelPreview"] = !captured
    ? "unpaid"
    : trip.cancellationWindowHours
      ? withinCancellationWindow(trip, now)
        ? "refund"
        : "forfeit"
      : "no_policy";

  const identityHeld = row.identityUnconfirmedAt !== null;
  const canCancelBooking =
    row.status === "booked" &&
    !hasSailed(trip.startsAt, now) &&
    // Counted aboard a boat past its time: `selfCancelBooking` refuses it (H-133).
    !(
      await heldAtTheDoor(db, {
        shopId: row.shopId,
        tripId: row.tripId,
        startsAt: trip.startsAt,
        now,
        bookingIds: [bookingId],
      })
    ).has(bookingId);
  // **A lead the page could charge pays before adding anyone** (security
  // review of layer 8, D3). The link is shared by design, so without this a
  // holder could add unpaid seats until the boat read full. Settled, or a
  // page that takes no payment here (pay at the dock), opens the door.
  const canAddSeat =
    canCancelBooking && !identityHeld && row.partyLeadBookingId === null && (settled || !canPay);
  // Past the free window, or with no window at all, a paid cancel returns
  // nothing right away: the diver may ask the shop to move them instead.
  const moveAskable =
    canCancelBooking &&
    !identityHeld &&
    (cancelPreview === "forfeit" || cancelPreview === "no_policy");
  const moveAsk: ReadyPageData["moveAsk"] =
    moveAskable && trip.status !== "cancelled" ? (pendingMoveAsk ?? "open") : null;

  const canPayPartySeats =
    canCancelBooking &&
    !identityHeld &&
    row.partyLeadBookingId === null &&
    canAcceptPayments(stripeAccount) &&
    Boolean(publicAppUrl()) &&
    Boolean(row.personEmail);

  return {
    detail,
    shop: {
      id: row.shopId,
      slug: row.slug,
      defaultLocale: row.defaultLocale,
      currency: row.currency,
      contactEmail: row.contactEmail,
      contactPhone: row.contactPhone,
      address: {
        street: row.addressStreet,
        locality: row.addressLocality,
        region: row.addressRegion,
        postalCode: row.addressPostalCode,
        country: row.addressCountry,
      },
      rentalItems: row.rentalItems,
      rentalPricing: row.rentalPricing,
      dockCallMinutes: row.dockCallMinutes,
      deskPayment: row.deskPayment,
    },
    trip: {
      id: row.tripId,
      plannedDives: trip.plannedDives,
      meetingPointLabel: trip.meetingPointLabel,
      meetingPointAddress: trip.meetingPointAddress,
      arrivalLandmark: trip.arrivalLandmark,
      arrivalParkingNote: trip.arrivalParkingNote,
      arrivalTransitNote: trip.arrivalTransitNote,
      arrivalLookFor: trip.arrivalLookFor,
      arrivalFirstInteraction: trip.arrivalFirstInteraction,
      course: trip.course
        ? { nitroxCompatible: trip.course.nitroxCompatible, gearIncluded: trip.course.gearIncluded }
        : null,
      seatPriceCents: perDiverPriceCents,
    },
    person: {
      id: row.personId,
      email: row.personEmail,
      locale: row.personLocale,
    },
    emergencyContact: identityHeld
      ? { name: null, phone: null }
      : { name: row.emergencyContactName, phone: row.emergencyContactPhone },
    identityHeld,
    greetingName: identityHeld ? row.identityBookedAs?.trim() || "" : detail.person.fullName,
    bookingCreatedAt: row.bookingCreatedAt,
    carriedFactsConfirmedAt: row.carriedFactsConfirmedAt,
    fitConfirmation: identityHeld ? null : fitConfirmation,
    wantsNitrox: row.wantsNitrox,
    participantType: row.participantType,
    asksCourseForms: Boolean(trip.course) || row.trainingEnrollmentBookingId !== null,
    lastDivedBand: row.lastDivedBand,
    diveIntent: row.diveIntent,
    reEntryAsk: row.reEntryAsk,
    reEntryOffersOpen,
    refresherCourseOffered,
    certificationNotYet:
      !identityHeld &&
      detail.readiness.blockers.some((blocker) => blocker.code === "certification_not_yet")
        ? {
            introCourse: introCourse
              ? { title: introCourse.title, href: publicCoursePath(row.slug, introCourse.slug) }
              : null,
          }
        : null,
    nitroxCardVerified: !identityHeld && nitroxVerified.has(row.personId),
    nitroxCardOnFile: !identityHeld && nitroxOnFile.has(row.personId),
    holdsCertification,
    meetingDayCount,
    rentalFit: identityHeld ? null : toDiverRentalFit(rentalFit),
    helpRequest,
    // Said even after the shop stops offering hotel pickups (the Features
    // page): only the question goes (`offersHotelPickup`), and a pickup
    // already promised still happens.
    hotelPickupLocation: row.hotelPickupLocation,
    pickupTime: row.pickupTime,
    canPay,
    offersHotelPickup: row.offersHotelPickup,
    helpRequestsOn: row.helpRequestsOn,
    lunchAboard: row.tripLunchAboard,
    dietaryNote: row.dietaryNote,
    owesAtShop: Boolean(perDiverPriceCents) && !settled && !canPay,
    cancelPreview,
    canCancelBooking,
    turnedAway: row.status === "no_show" && row.turnedAwayAt !== null,
    seatReleased: row.status === "no_show",
    canAddSeat,
    moveAsk,
    canPayPartySeats,
    runningLate: {
      open: canSayRunningLate({
        bookingStatus: row.status,
        tripStatus: trip.status,
        startsAt: trip.startsAt,
        now,
      }),
      saidAt: runningLateShown({ bookingStatus: row.status, runningLateAt: row.runningLateAt }),
    },
    departureCancelled: trip.status !== "scheduled",
    // `offerableWelcomeCue`, not `welcomeCueFor`: this is the diver's own page,
    // and the whole point of the question is that it can be asked before they
    // have consented. The staff surfaces read the consented one.
    welcomeOffer: offerableWelcomeCue({
      lastDivedAt: welcomeInputs.get(bookingId)?.lastDivedAt ?? null,
      nonDiver: welcomeInputs.get(bookingId)?.nonDiver ?? false,
      tripEndsAt: trip.endsAt,
      now,
    }),
    welcomeShared: row.welcomeSharedAt !== null,
    welcomeHello: row.welcomeSharedAt !== null ? row.welcomeHello : null,
    learningMaterials: readLearningMaterials(trip.course?.learningMaterials),
    courseMaterialsDone: row.courseMaterialsDoneAt !== null || materialsDoneElsewhere,
    courseStarted: trip.startsAt.getTime() <= now.getTime(),
  };
}

/**
 * **What a blown-out day left standing**, for one diver at one shop
 * (issue #1197).
 *
 * Its own reader rather than a field on `getReadyPageData`, because only one
 * branch of `/ready` ever asks: the terminal card a stranded diver reaches when
 * their departure was called off. Every other load of that page is about a trip
 * that is still going, where these three facts are already on the page as
 * things to *do*.
 *
 * Person-scoped and shop-scoped throughout, which is the whole reason the
 * question has an answer at all — a release is signed once and carries across
 * every booking here, a card is a card, and sizes are sizes. None of it is
 * about the seat.
 */
export async function carriedPreparationForDiver(
  db: AppDb,
  input: { shopId: string; personId: string; hasRentalFit: boolean },
): Promise<CarriedPreparation[]> {
  const [levelCards, signedWaivers, waiverTemplate, signerRows] = await Promise.all([
    db
      .select()
      .from(certifications)
      .where(
        and(
          eq(certifications.shopId, input.shopId),
          eq(certifications.personId, input.personId),
          isNull(certifications.deletedAt),
        ),
      ),
    listSignedWaiversByPerson(db, input.shopId, [input.personId]),
    getCurrentWaiverGeneration(db, input.shopId),
    // The guardian rule (src/lib/guardian.ts): a minor's solo signature is not
    // a release that was kept, so it must not be told to a stranded family as one.
    db
      .select({ dateOfBirth: people.dateOfBirth, timezone: shops.timezone })
      .from(people)
      // diveday:allow-deleted-people: the diver's own date of birth on their own token page.
      .innerJoin(shops, eq(shops.id, people.shopId))
      .where(and(eq(people.id, input.personId), eq(people.shopId, input.shopId)))
      .limit(1),
  ]);
  const signer = signerRows[0];

  return carriedPreparation({
    waiver: shopWaiverStatus({
      personSignedWaivers: signedWaivers.get(input.personId) ?? [],
      currentTemplateVersion: waiverTemplate?.materialGeneration ?? null,
      // Person-scoped, so no seat's "Under 18" is in hand: the next booking
      // carries its own, and its readiness asks for the co-signature then.
      signer: signer
        ? { dateOfBirth: signer.dateOfBirth, minorDeclared: false, timezone: signer.timezone }
        : undefined,
    }),
    certifications: levelCards,
    hasRentalFit: input.hasRentalFit,
  });
}
