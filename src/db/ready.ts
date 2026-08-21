import { eq } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import { perDiverBookingPriceCents } from "@/lib/courses";
import { withinCancellationWindow } from "@/lib/deposits";
import { publicAppUrl } from "@/lib/notifications";
import type { RentalPricing } from "@/lib/rentals";
import type { AppDb } from "./client";
import { nitroxCardOnFilePersonIds, verifiedNitroxPersonIds } from "./nitrox";
import { getBookingPayment } from "./payments";
import { type BookingReadinessDetail, getBookingReadinessDetail } from "./readiness";
import { type DiverRentalFit, getRentalFit, toDiverRentalFit } from "./rental-fit";
import { bookings, people, shops } from "./schema";
import { canAcceptPayments, getShopStripeAccount } from "./stripe-accounts";
import { getTripWithBooked, pagedUpcomingTripsWithCounts } from "./trips";

/** One alternative trip a diver could reschedule this booking into. */
export type RescheduleCandidate = {
  id: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  spotsLeft: number;
};

/**
 * Why self-service rescheduling isn't on offer. Codes, not sentences
 * (AGENTS.md) — `/ready` turns each into a diver-facing explanation next to
 * the shop's contact links. The policy itself is unchanged; what changed is
 * that the option no longer just vanishes, which reads as "DiveDay lost my
 * booking" rather than as a rule.
 */
export type RescheduleBlockedReason =
  /** Paid, deposit-paid, or waived — moving it needs staff-mediated money handling. */
  | "payment_settled"
  /** Nothing else on the calendar with room, so there is nowhere to move to. */
  | "no_open_trips"
  /** The seat itself is past self-service (checked in, no-show, or the boat has left). */
  | "booking_closed";

/**
 * What the "Need to change your plans?" section can still offer.
 *
 * `shop_only` is the case that used to render as nothing at all: on trip
 * morning a diver who needs to bail has the *most* urgent reason to reach the
 * shop and was shown the fewest ways to do it.
 */
export type ManageBookingState =
  /** Cancel (and possibly a move) are the diver's own to make. */
  | "self_serve"
  /** Past self-service, but the trip hasn't finished — the shop can still act today. */
  | "shop_only"
  /** The trip is over; there is nothing left to change. */
  | "closed";

/** How many upcoming trips the reschedule picker offers — plenty to browse without loading the whole calendar. */
const MAX_RESCHEDULE_CANDIDATES = 8;

/**
 * How many upcoming trips to scan for reschedule candidates. Some of the
 * scanned trips are full and get filtered out below, so this is generously
 * larger than MAX_RESCHEDULE_CANDIDATES rather than fetching every scheduled
 * trip the shop has.
 */
const RESCHEDULE_CANDIDATE_SCAN_LIMIT = 50;

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
  };
  trip: {
    id: string;
    plannedDives: number;
    /**
     * Only what the nitrox gate needs, never the whole catalog row: whether a
     * session of this course may run on enriched air (`nitroxAvailableOn`,
     * src/lib/rentals.ts). Null on an ordinary charter, which the gate reads
     * as "the shop's answer is the whole answer".
     */
    course: { nitroxCompatible: boolean } | null;
  };
  person: {
    id: string;
    email: string | null;
    /** Their own recorded reading language, or null when DiveDay has never
     * heard one first-hand (docs ADR 20260731-per-person-notification-locale). */
    locale: string | null;
    emergencyContactName: string | null;
    emergencyContactPhone: string | null;
  };
  wantsNitrox: boolean;
  nitroxCardVerified: boolean;
  /**
   * A live nitrox card exists for this diver, sighted or not. Only decides
   * whether the fit form still asks for one — never a fill or boarding gate
   * (`nitroxCardOnFilePersonIds`).
   */
  nitroxCardOnFile: boolean;
  /** Projected: staff-only fit columns never reach the diver's browser. */
  rentalFit: DiverRentalFit | null;
  /** True when the shop can actually take a card for this trip right now. */
  canPay: boolean;
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
   * Other upcoming trips this booking could move to, or null when the
   * booking has settled payment (paid, deposit-paid, or waived) —
   * rescheduling any of those needs staff-mediated money/policy handling
   * this slice doesn't automate, so the picker doesn't offer it at all
   * (docs ADR 20260727-diver-self-service-cancel).
   */
  rescheduleCandidates: RescheduleCandidate[] | null;
  /**
   * Why the picker above is absent, or null when it is genuinely on offer.
   * Always set whenever `rescheduleCandidates` is null or empty, so the page
   * can never render a silent gap where an option used to be.
   */
  rescheduleBlocked: RescheduleBlockedReason | null;
  /**
   * How much of the "change your plans" section is still actionable. The page
   * renders self-service controls, a "call the shop" line, or nothing, from
   * this one code.
   */
  manageState: ManageBookingState;
  /**
   * Whether the booking is still in a state either self-service mutation can
   * actually act on — a plain `booked` seat on a trip that hasn't started.
   * False for `checked_in`/`no_show` or a departed trip, where cancel/
   * reschedule would only ever fail server-side; the page uses this to hide
   * the "change your plans" controls entirely rather than show a button that
   * can't work (Codex finding).
   */
  canManageBooking: boolean;
};

export async function getReadyPageData(
  db: AppDb,
  bookingId: string,
  now: Date = nowDate(),
): Promise<ReadyPageData | null> {
  const detail = await getBookingReadinessDetail(db, bookingId);
  if (!detail) return null;

  const [row] = await db
    .select({
      shopId: bookings.shopId,
      tripId: bookings.tripId,
      personId: bookings.personId,
      wantsNitrox: bookings.wantsNitrox,
      status: bookings.status,
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
      personEmail: people.email,
      personLocale: people.locale,
      emergencyContactName: people.emergencyContactName,
      emergencyContactPhone: people.emergencyContactPhone,
    })
    .from(bookings)
    .innerJoin(people, eq(people.id, bookings.personId))
    .innerJoin(shops, eq(shops.id, bookings.shopId))
    .where(eq(bookings.id, bookingId))
    .limit(1);
  if (!row) return null;

  const trip = await getTripWithBooked(db, row.shopId, row.tripId);
  if (!trip) return null;

  const [rentalFit, payment, stripeAccount, nitroxVerified, nitroxOnFile] = await Promise.all([
    getRentalFit(db, row.shopId, row.personId),
    getBookingPayment(db, row.shopId, bookingId),
    getShopStripeAccount(db, row.shopId),
    verifiedNitroxPersonIds(db, row.shopId),
    nitroxCardOnFilePersonIds(db, row.shopId),
  ]);
  const settled =
    payment?.status === "paid" ||
    payment?.status === "deposit_paid" ||
    payment?.status === "waived";

  const perDiverPriceCents = perDiverBookingPriceCents(trip, trip.course);
  const canPay = Boolean(
    perDiverPriceCents && !settled && canAcceptPayments(stripeAccount) && publicAppUrl(),
  );

  const captured = payment?.status === "paid" || payment?.status === "deposit_paid";
  const cancelPreview: ReadyPageData["cancelPreview"] = !captured
    ? "unpaid"
    : trip.cancellationWindowHours
      ? withinCancellationWindow(trip, now)
        ? "refund"
        : "forfeit"
      : "no_policy";

  // Both self-service mutations (`selfCancelBooking`, `rescheduleBooking`)
  // only ever succeed on a plain `booked` seat on a trip that hasn't started
  // — a day-of `checked_in`/`no_show` flip, or a departed trip, makes both
  // reject with `not_cancellable`/`trip_departed`. Gating the controls
  // themselves on the same condition (Codex finding) means a diver who
  // hasn't touched this page since boarding never sees a "cancel"/"move"
  // button that can only ever fail — the payment-settled gate above answers
  // "would this be allowed to work," this answers "does a seat to change
  // still exist."
  const canManageBooking = row.status === "booked" && trip.startsAt > now;

  let rescheduleCandidates: RescheduleCandidate[] | null = null;
  // `settled`, not `captured`: rescheduleBooking also refuses a waived
  // booking (docs ADR 20260727-diver-self-service-cancel) — staff excused
  // the fee, and a fresh destination booking has no payment row to carry
  // that decision forward. Showing the picker for a waived booking anyway
  // would promise a move `rescheduleBooking` then rejects as already_paid.
  if (!settled && canManageBooking) {
    const { trips: upcoming } = await pagedUpcomingTripsWithCounts(db, row.shopId, {
      now,
      limit: RESCHEDULE_CANDIDATE_SCAN_LIMIT,
    });
    // Known gap (Codex finding, accepted for now): this only filters by raw
    // capacity, not by the course prerequisite / instructor-ratio / minimum-age
    // gates `rescheduleBooking`'s own `createBookingRecord` call enforces at
    // commit time — so a trip this diver isn't actually eligible for can
    // appear as a clickable option (and, since the list caps at
    // MAX_RESCHEDULE_CANDIDATES, could crowd out an eligible one). Selecting
    // an ineligible option always fails safely (`rescheduleBooking` refuses
    // it, nothing is ever double-booked or silently downgraded) — this is a
    // UX rough edge, not a correctness gap. Not replicated here because doing
    // so means keeping two independent copies of cert/ratio/age eligibility
    // logic in sync; revisit if this trips up divers in practice.
    rescheduleCandidates = upcoming
      .filter((candidate) => candidate.id !== row.tripId && candidate.booked < candidate.capacity)
      .slice(0, MAX_RESCHEDULE_CANDIDATES)
      .map((candidate) => ({
        id: candidate.id,
        title: candidate.title,
        startsAt: candidate.startsAt,
        endsAt: candidate.endsAt,
        spotsLeft: candidate.capacity - candidate.booked,
      }));
  }

  // Absence needs a reason. The policy above is unchanged — this only names
  // which rule is in force, so the page can say it out loud instead of
  // dropping the control and leaving the diver to guess.
  const rescheduleBlocked: RescheduleBlockedReason | null = !canManageBooking
    ? "booking_closed"
    : settled
      ? "payment_settled"
      : rescheduleCandidates && rescheduleCandidates.length > 0
        ? null
        : "no_open_trips";

  const manageState: ManageBookingState = canManageBooking
    ? "self_serve"
    : // The seat is past self-service, but while the trip itself is still
      // running (checked in, a no-show flip, the boat already out) the shop
      // can absolutely still act on it — that's exactly the morning a diver
      // needs a phone number, and exactly when this section used to vanish.
      trip.endsAt > now
      ? "shop_only"
      : "closed";

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
    },
    trip: {
      id: row.tripId,
      plannedDives: trip.plannedDives,
      course: trip.course ? { nitroxCompatible: trip.course.nitroxCompatible } : null,
    },
    person: {
      id: row.personId,
      email: row.personEmail,
      locale: row.personLocale,
      emergencyContactName: row.emergencyContactName,
      emergencyContactPhone: row.emergencyContactPhone,
    },
    wantsNitrox: row.wantsNitrox,
    nitroxCardVerified: nitroxVerified.has(row.personId),
    nitroxCardOnFile: nitroxOnFile.has(row.personId),
    rentalFit: toDiverRentalFit(rentalFit),
    canPay,
    cancelPreview,
    rescheduleCandidates,
    rescheduleBlocked,
    manageState,
    canManageBooking,
  };
}
