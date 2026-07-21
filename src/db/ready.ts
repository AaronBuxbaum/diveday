import { eq } from "drizzle-orm";
import { perDiverBookingPriceCents } from "@/lib/courses";
import { publicAppUrl } from "@/lib/notifications";
import type { AppDb } from "./client";
import { verifiedNitroxPersonIds } from "./nitrox";
import { getBookingPayment } from "./payments";
import { type BookingReadinessDetail, getBookingReadinessDetail } from "./readiness";
import { getRentalFit } from "./rental-fit";
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
    contactEmail: string | null;
    contactPhone: string | null;
    rentalItems: string[];
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
  rentalFit: Awaited<ReturnType<typeof getRentalFit>>;
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
      slug: shops.slug,
      contactEmail: shops.contactEmail,
      contactPhone: shops.contactPhone,
      rentalItems: shops.rentalItems,
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
    getBookingPaymentPaid(db, row.shopId, bookingId),
    getShopStripeAccount(db, row.shopId),
    verifiedNitroxPersonIds(db, row.shopId),
  ]);

  const perDiverPriceCents = perDiverBookingPriceCents(trip, trip.course);
  const canPay = Boolean(
    perDiverPriceCents && !payment && canAcceptPayments(stripeAccount) && publicAppUrl(),
  );

  return {
    detail,
    shop: {
      id: row.shopId,
      slug: row.slug,
      contactEmail: row.contactEmail,
      contactPhone: row.contactPhone,
      rentalItems: row.rentalItems,
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
    rentalFit,
    canPay,
  };
}

/** True when this booking is already settled, so no "Pay" action is offered. */
async function getBookingPaymentPaid(db: AppDb, shopId: string, bookingId: string) {
  const settled = await getBookingPayment(db, shopId, bookingId);
  return (
    settled?.status === "paid" || settled?.status === "deposit_paid" || settled?.status === "waived"
  );
}
