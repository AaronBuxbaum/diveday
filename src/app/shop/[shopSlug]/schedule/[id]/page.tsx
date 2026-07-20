import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { FlashParams } from "@/components/FlashParams";
import { getBookingForTrip } from "@/db/bookings";
import { getDb } from "@/db/client";
import { listDiveSiteCreatures, listPublishedDiveSiteMoments } from "@/db/dive-sites";
import { verifiedNitroxPersonIds } from "@/db/nitrox";
import { getBookingReadiness, getTripRequirements } from "@/db/readiness";
import { getRentalFit } from "@/db/rental-fit";
import { getShopBySlug } from "@/db/shops";
import { getTripWithBooked, getWaitlistEntryForTrip, listTripDives } from "@/db/trips";
import { auth } from "@/lib/auth";
import { isStaff } from "@/lib/authz";
import {
  fetchAutomatedMarineForecast,
  hasCrewPrediction,
  shouldShowAutomatedForecast,
} from "@/lib/marine-forecast";
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
import { ERROR_MESSAGES } from "./_components/types";

export const metadata: Metadata = {
  title: "Trip — Scuba",
};

export default async function TripDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string; id: string }>;
  searchParams: Promise<{ booking?: string; waitlist?: string; error?: string; fit?: string }>;
}) {
  await connection();
  const { shopSlug, id: tripId } = await params;
  const { booking: bookingId, waitlist: waitlistId, error, fit } = await searchParams;
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
  const readiness = confirmed ? await getBookingReadiness(db, shop.id, confirmed.booking.id) : null;
  const requirement = confirmed ? await getTripRequirements(db, shop.id, tripId) : null;
  const rentalFit = confirmed ? await getRentalFit(db, shop.id, confirmed.person.id) : null;
  const nitroxCardVerified = confirmed
    ? (await verifiedNitroxPersonIds(db, shop.id)).has(confirmed.person.id)
    : false;

  const inPast = trip.startsAt <= new Date();
  const full = isFull(trip);
  const remaining = spotsRemaining(trip);
  const errorMessage = error ? ERROR_MESSAGES[error] : undefined;
  const tripRef = { shopSlug, tripId };

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-16">
      <FlashParams params={["error"]} />
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
          className="fixed right-4 bottom-4 z-20 inline-flex min-h-11 items-center rounded-full bg-primary px-5 py-3 font-medium text-primary-foreground shadow-lg sm:hidden"
        >
          Book · {remaining} left
        </a>
      ) : null}

      <DiveBriefingsSection briefings={diveBriefings} trip={trip} />
      <PackingSection shop={shop} trip={trip} />
      <ForecastSection
        shop={shop}
        trip={trip}
        crewPrediction={crewPrediction}
        automatedForecast={automatedForecast}
      />

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
        />
      )}
    </main>
  );
}
