import { eq } from "drizzle-orm";
import { perDiverBookingPriceCents } from "@/lib/courses";
import { publicAppUrl } from "@/lib/notifications";
import type { RentalPricing } from "@/lib/rentals";
import type { AppDb } from "./client";
import { nitroxCardOnFilePersonIds, verifiedNitroxPersonIds } from "./nitrox";
import { getBookingPayment } from "./payments";
import { type BookingReadinessDetail, getBookingReadinessDetail } from "./readiness";
import { type DiverRentalFit, getRentalFit, toDiverRentalFit } from "./rental-fit";
import { bookings, people, shops } from "./schema";
import { canAcceptPayments, getShopStripeAccount } from "./stripe-accounts";
import { getTripWithBooked } from "./trips";

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
};

export async function getReadyPageData(
  db: AppDb,
  bookingId: string,
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
  };
}
