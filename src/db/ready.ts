import { and, eq, isNull } from "drizzle-orm";
import { type CarriedPreparation, carriedPreparation } from "@/lib/carried-preparation";
import { nowDate } from "@/lib/clock";
import { perDiverBookingPriceCents } from "@/lib/courses";
import { withinCancellationWindow } from "@/lib/deposits";
import type { DiveRecencyBand } from "@/lib/dive-recency";
import { publicAppUrl } from "@/lib/notifications";
import { isCapturedPaymentStatus } from "@/lib/payment-source";
import type { RentalPricing } from "@/lib/rentals";
import type { SupportNeeds } from "@/lib/support-needs";
import { hasSailed } from "@/lib/trips";
import { shopWaiverStatus } from "@/lib/waivers";
import type { AppDb } from "./client";
import { getHelpRequestForBooking, type HelpRequest } from "./help-requests";
import { nitroxCardOnFilePersonIds, verifiedNitroxPersonIds } from "./nitrox";
import { getBookingPayment } from "./payments";
import { type BookingReadinessDetail, getBookingReadinessDetail } from "./readiness";
import { type DiverRentalFit, getRentalFit, toDiverRentalFit } from "./rental-fit";
import { bookings, certifications, people, shops } from "./schema";
import { canAcceptPayments, getShopStripeAccount } from "./stripe-accounts";
import { getSupportNeeds } from "./support-needs";
import { getTripWithBooked } from "./trips";
import { getCurrentWaiverTemplate, listSignedWaiversByPerson } from "./waivers";

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
  };
  wantsNitrox: boolean;
  /**
   * The diver's own answer to "when did you last dive?", or null when they have
   * not been asked or have not said (ADR 20260821-currency-is-what-catches-people).
   * Gates nothing anywhere; `/ready` renders it as a question the diver can still
   * answer, and the staff surfaces render it as their word.
   */
  lastDivedBand: DiveRecencyBand | null;
  nitroxCardVerified: boolean;
  /**
   * A live nitrox card exists for this diver, sighted or not. Only decides
   * whether the fit form still asks for one — never a fill or boarding gate
   * (`nitroxCardOnFilePersonIds`).
   */
  nitroxCardOnFile: boolean;
  /** Projected: staff-only fit columns never reach the diver's browser. */
  rentalFit: DiverRentalFit | null;
  /**
   * What this diver's dive needs set up, if they have said (ADR
   * 20260827-support-needs-are-a-record-about-the-dive). Null means nobody has
   * asked yet, which is the ordinary state and reads as an optional row rather
   * than an outstanding one.
   */
  supportNeeds: SupportNeeds | null;
  /** The one active, non-medical day-of request this booking has made. */
  helpRequest: HelpRequest | null;
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
      lastDivedBand: bookings.lastDivedBand,
      hotelPickupLocation: bookings.hotelPickupLocation,
      pickupTime: bookings.pickupTime,
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
    })
    .from(bookings)
    .innerJoin(people, eq(people.id, bookings.personId))
    .innerJoin(shops, eq(shops.id, bookings.shopId))
    .where(eq(bookings.id, bookingId))
    .limit(1);
  if (!row) return null;

  const trip = await getTripWithBooked(db, row.shopId, row.tripId);
  if (!trip) return null;

  const [
    rentalFit,
    supportNeeds,
    helpRequest,
    payment,
    stripeAccount,
    nitroxVerified,
    nitroxOnFile,
  ] = await Promise.all([
    getRentalFit(db, row.shopId, row.personId),
    getSupportNeeds(db, row.shopId, row.personId),
    getHelpRequestForBooking(db, row.shopId, bookingId, now),
    getBookingPayment(db, row.shopId, bookingId),
    getShopStripeAccount(db, row.shopId),
    verifiedNitroxPersonIds(db, row.shopId),
    nitroxCardOnFilePersonIds(db, row.shopId),
  ]);
  // `partly_refunded` settles too, or this page would invite a diver who has
  // already paid — and been handed part of it back — to pay the full price a
  // second time. The capability URL is shared by design, so anyone holding it
  // could do it (issue #699 security review). `startBookingCheckout` refuses
  // it server-side as well; this only decides whether the button is drawn.
  const settled = isCapturedPaymentStatus(payment?.status) || payment?.status === "waived";

  const perDiverPriceCents = perDiverBookingPriceCents(trip, trip.course);
  const canPay = Boolean(
    perDiverPriceCents && !settled && canAcceptPayments(stripeAccount) && publicAppUrl(),
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

  const canCancelBooking = row.status === "booked" && !hasSailed(trip.startsAt, now);

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
    },
    wantsNitrox: row.wantsNitrox,
    lastDivedBand: row.lastDivedBand,
    nitroxCardVerified: nitroxVerified.has(row.personId),
    nitroxCardOnFile: nitroxOnFile.has(row.personId),
    rentalFit: toDiverRentalFit(rentalFit),
    supportNeeds,
    helpRequest,
    hotelPickupLocation: row.hotelPickupLocation,
    pickupTime: row.pickupTime,
    canPay,
    cancelPreview,
    canCancelBooking,
    departureCancelled: trip.status !== "scheduled",
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
  const [levelCards, signedWaivers, waiverTemplate] = await Promise.all([
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
    getCurrentWaiverTemplate(db, input.shopId),
  ]);

  return carriedPreparation({
    waiver: shopWaiverStatus({
      personSignedWaivers: signedWaivers.get(input.personId) ?? [],
      currentTemplateVersion: waiverTemplate?.materialGeneration ?? null,
    }),
    certifications: levelCards,
    hasRentalFit: input.hasRentalFit,
  });
}
