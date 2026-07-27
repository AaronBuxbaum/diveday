import { eq } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import { perDiverBookingPriceCents } from "@/lib/courses";
import { withinCancellationWindow } from "@/lib/deposits";
import { publicAppUrl } from "@/lib/notifications";
import type { RentalPricing } from "@/lib/rentals";
import type { AppDb } from "./client";
import { verifiedNitroxPersonIds } from "./nitrox";
import { getBookingPayment } from "./payments";
import { type BookingReadinessDetail, getBookingReadinessDetail } from "./readiness";
import { type DiverRentalFit, getRentalFit, toDiverRentalFit } from "./rental-fit";
import { bookings, people, shops } from "./schema";
import { canAcceptPayments, getShopStripeAccount } from "./stripe-accounts";
import { getTripWithBooked, upcomingTripsWithCounts } from "./trips";

/** One alternative trip a diver could reschedule this booking into. */
export type RescheduleCandidate = {
  id: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  spotsLeft: number;
};

/** How many upcoming trips the reschedule picker offers — plenty to browse without loading the whole calendar. */
const MAX_RESCHEDULE_CANDIDATES = 8;

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
    contactEmail: string | null;
    contactPhone: string | null;
    rentalItems: string[];
    rentalPricing: RentalPricing;
  };
  trip: { id: string; plannedDives: number };
  person: {
    id: string;
    email: string | null;
    emergencyContactName: string | null;
    emergencyContactPhone: string | null;
  };
  wantsNitrox: boolean;
  nitroxCardVerified: boolean;
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
      contactEmail: shops.contactEmail,
      contactPhone: shops.contactPhone,
      rentalItems: shops.rentalItems,
      rentalPricing: shops.rentalPricing,
      personEmail: people.email,
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

  const [rentalFit, payment, stripeAccount, nitroxVerified] = await Promise.all([
    getRentalFit(db, row.shopId, row.personId),
    getBookingPayment(db, row.shopId, bookingId),
    getShopStripeAccount(db, row.shopId),
    verifiedNitroxPersonIds(db, row.shopId),
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
    const upcoming = await upcomingTripsWithCounts(db, row.shopId, now);
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

  return {
    detail,
    shop: {
      id: row.shopId,
      slug: row.slug,
      contactEmail: row.contactEmail,
      contactPhone: row.contactPhone,
      rentalItems: row.rentalItems,
      rentalPricing: row.rentalPricing,
    },
    trip: { id: row.tripId, plannedDives: trip.plannedDives },
    person: {
      id: row.personId,
      email: row.personEmail,
      emergencyContactName: row.emergencyContactName,
      emergencyContactPhone: row.emergencyContactPhone,
    },
    wantsNitrox: row.wantsNitrox,
    nitroxCardVerified: nitroxVerified.has(row.personId),
    rentalFit: toDiverRentalFit(rentalFit),
    canPay,
    cancelPreview,
    rescheduleCandidates,
    canManageBooking,
  };
}
