import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { FlashParams } from "@/components/FlashParams";
import { buttonClass } from "@/components/ui/button";
import { getBookingForTrip } from "@/db/bookings";
import { getLatestCheckoutForBooking, refreshCheckoutFromStripe } from "@/db/checkouts";
import { getDb } from "@/db/client";
import { listDiveSiteCreatures, listPublishedDiveSiteMoments } from "@/db/dive-sites";
import { verifiedNitroxPersonIds } from "@/db/nitrox";
import { getBookingPayment } from "@/db/payments";
import { getBookingReadiness, getTripRequirements } from "@/db/readiness";
import { getRentalFit } from "@/db/rental-fit";
import { getShopBySlug } from "@/db/shops";
import { canAcceptPayments, getShopStripeAccount } from "@/db/stripe-accounts";
import { getTripWithBooked, getWaitlistEntryForTrip, listTripDives } from "@/db/trips";
import { auth } from "@/lib/auth";
import { isStaff } from "@/lib/authz";
import { nowDate } from "@/lib/clock";
import { perDiverBookingPriceCents } from "@/lib/courses";
import {
  fetchAutomatedMarineForecast,
  hasCrewPrediction,
  shouldShowAutomatedForecast,
} from "@/lib/marine-forecast";
import { publicAppUrl } from "@/lib/notifications";
import { isFull, spotsRemaining } from "@/lib/trips";
import { BookingConfirmation } from "./_components/BookingConfirmation";
import {
  BookSpotSection,
  TripFullSection,
  TripSailedNotice,
  WaitlistConfirmation,
} from "./_components/BookingSections";
import { DiveBriefingsSection } from "./_components/DiveBriefingsSection";
import { ForecastSection } from "./_components/ForecastSection";
import { PackingSection } from "./_components/PackingSection";
import { TripHeader } from "./_components/TripHeader";
import { ERROR_MESSAGES, type PaymentPanel } from "./_components/types";

export const metadata: Metadata = {
  title: "Trip — DiveDay",
};

export default async function TripDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string; id: string }>;
  searchParams: Promise<{
    booking?: string;
    waitlist?: string;
    error?: string;
    fit?: string;
    pay?: string;
  }>;
}) {
  await connection();
  const { shopSlug, id: tripId } = await params;
  const { booking: bookingId, waitlist: waitlistId, error, fit, pay } = await searchParams;
  const db = await getDb();
  const shop = await getShopBySlug(db, shopSlug);
  if (!shop) notFound();
  const session = await auth();
  if (session?.user?.shopId === shop.id && isStaff(session.user.roles)) {
    redirect(`/shop/${shopSlug}/trips/${tripId}`);
  }
  const trip = await getTripWithBooked(db, shop.id, tripId);
  if (trip?.status !== "scheduled") notFound();
  const tripDives = await listTripDives(db, shop.id, tripId);
  const crewPrediction = hasCrewPrediction(trip);
  const forecastPoint =
    trip.diveSite &&
    trip.diveSite.forecastLatitude !== null &&
    trip.diveSite.forecastLongitude !== null
      ? { latitude: trip.diveSite.forecastLatitude, longitude: trip.diveSite.forecastLongitude }
      : null;
  const automatedForecast =
    !crewPrediction && forecastPoint && shouldShowAutomatedForecast(trip.startsAt)
      ? await fetchAutomatedMarineForecast(forecastPoint, trip.startsAt)
      : null;

  // The confirmation renders only from a real booking row — never from a
  // URL claim (design principle 6: trustworthy by inspection).
  const confirmed = bookingId ? await getBookingForTrip(db, tripId, bookingId) : null;
  const waitlistConfirmation = waitlistId
    ? await getWaitlistEntryForTrip(db, tripId, waitlistId)
    : null;
  const diveBriefings = await Promise.all(
    tripDives.map(async ({ dive, diveSite }) => {
      const [creatures, moments] = diveSite
        ? await Promise.all([
            listDiveSiteCreatures(db, shop.id, diveSite.id),
            listPublishedDiveSiteMoments(db, shop.id, diveSite.id),
          ])
        : [[], []];
      return { dive, diveSite, creatures, moments };
    }),
  );
  // Pay-at-booking is offered only when the shop's own Stripe account can
  // take a charge, the trip carries a price, and a canonical origin exists
  // for the return links; otherwise the flow is book-now-pay-later as before.
  const perDiverPriceCents = perDiverBookingPriceCents(trip, trip.course);
  const stripeAccount = perDiverPriceCents ? await getShopStripeAccount(db, shop.id) : null;
  const payAtBooking = Boolean(
    perDiverPriceCents && canAcceptPayments(stripeAccount) && publicAppUrl(),
  );
  const payment = confirmed
    ? await resolvePaymentPanel(db, shop.id, confirmed.booking.id, payAtBooking, perDiverPriceCents)
    : null;

  const readiness = confirmed ? await getBookingReadiness(db, shop.id, confirmed.booking.id) : null;
  const requirement = confirmed ? await getTripRequirements(db, shop.id, tripId) : null;
  const rentalFit = confirmed ? await getRentalFit(db, shop.id, confirmed.person.id) : null;
  const nitroxCardVerified = confirmed
    ? (await verifiedNitroxPersonIds(db, shop.id)).has(confirmed.person.id)
    : false;

  const inPast = trip.startsAt <= nowDate();
  const full = isFull(trip);
  const remaining = spotsRemaining(trip);
  const errorMessage = error ? ERROR_MESSAGES[error] : undefined;
  const tripRef = { shopSlug, tripId };

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-16">
      <FlashParams params={["error", "pay"]} />
      <Link
        href={`/shop/${shopSlug}/schedule`}
        className="text-sm font-medium text-primary hover:underline"
      >
        ← All trips
      </Link>

      <TripHeader shop={shop} trip={trip} />
      {!confirmed && !inPast && !full ? (
        <a
          href="#book"
          className={buttonClass({
            size: "cta",
            className: "fixed right-4 bottom-4 z-20 rounded-full shadow-lg sm:hidden",
          })}
        >
          Book · {remaining} left
        </a>
      ) : null}

      {/*
        The seat comes first. Booking (or, once booked, the confirmation) sits
        directly under the hero so a diver reaches the form in one flick and a
        just-paid diver lands on their confirmation without scrolling past a
        creature gallery. The dive-site content is good pre-trip reading, so it
        follows for the now-committed diver rather than standing in the way.
      */}
      {confirmed ? (
        <BookingConfirmation
          shop={shop}
          shopSlug={shopSlug}
          trip={trip}
          confirmed={confirmed}
          readiness={readiness}
          requirement={requirement}
          fitRef={{
            ...tripRef,
            shopId: shop.id,
            bookingId: confirmed.booking.id,
            personId: confirmed.person.id,
          }}
          rentalFit={rentalFit}
          nitroxCardVerified={nitroxCardVerified}
          fitSaved={fit === "saved"}
          payment={payment}
          payCancelled={pay === "cancelled"}
        />
      ) : waitlistConfirmation ? (
        <WaitlistConfirmation
          firstName={waitlistConfirmation.person.fullName.split(" ")[0]}
          shopSlug={shopSlug}
        />
      ) : inPast ? (
        <TripSailedNotice shopSlug={shopSlug} />
      ) : full ? (
        <TripFullSection
          shopSlug={shopSlug}
          trip={trip}
          tripRef={tripRef}
          remaining={remaining}
          errorMessage={errorMessage}
        />
      ) : (
        <BookSpotSection
          trip={trip}
          tripRef={tripRef}
          remaining={remaining}
          errorMessage={errorMessage}
          payAtBooking={payAtBooking}
          perDiverPriceCents={perDiverPriceCents}
        />
      )}

      <ForecastSection
        shop={shop}
        trip={trip}
        crewPrediction={crewPrediction}
        automatedForecast={automatedForecast}
      />
      <PackingSection shop={shop} trip={trip} />
      <DiveBriefingsSection briefings={diveBriefings} trip={trip} />
    </main>
  );
}

/**
 * What the confirmation says about money. Paid state comes from the booking's
 * payment row (webhook or the refresh below), never from a return-URL claim; a
 * still-open Stripe session is offered again; an expired one starts over.
 */
async function resolvePaymentPanel(
  db: Awaited<ReturnType<typeof getDb>>,
  shopId: string,
  bookingId: string,
  payAtBooking: boolean,
  fullPriceCents: number | null,
): Promise<PaymentPanel> {
  const paidPanel = (
    settled: Awaited<ReturnType<typeof getBookingPayment>>,
  ): PaymentPanel & { state: "paid" } => {
    const isDeposit = settled?.status === "deposit_paid";
    const balanceDueCents =
      isDeposit && fullPriceCents !== null
        ? Math.max(0, fullPriceCents - (settled?.amountCents ?? 0))
        : 0;
    return {
      state: "paid",
      amountCents: settled?.amountCents ?? null,
      currency: settled?.currency ?? "usd",
      isDeposit,
      balanceDueCents,
    };
  };

  const settled = await getBookingPayment(db, shopId, bookingId);
  if (settled?.status === "paid" || settled?.status === "deposit_paid") {
    return paidPanel(settled);
  }
  if (settled?.status === "waived") return null;

  let checkout = await getLatestCheckoutForBooking(db, shopId, bookingId);
  if (checkout?.status === "pending") {
    // The diver may have just paid and beaten the webhook home; ask Stripe.
    checkout = await refreshCheckoutFromStripe(db, shopId, checkout.id);
    if (checkout?.status === "completed") {
      return paidPanel(await getBookingPayment(db, shopId, bookingId));
    }
  }
  if (
    checkout?.status === "pending" &&
    checkout.checkoutUrl &&
    (!checkout.expiresAt || checkout.expiresAt > nowDate())
  ) {
    return { state: "pending", checkoutUrl: checkout.checkoutUrl };
  }
  return payAtBooking ? { state: "payable" } : null;
}
