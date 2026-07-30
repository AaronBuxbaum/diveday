import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { FlashParams } from "@/components/FlashParams";
import { JsonLd } from "@/components/JsonLd";
import { buttonClass } from "@/components/ui/button";
import { issueBookingCapability, verifyBookingCapability } from "@/db/booking-capabilities";
import { getBookingForTrip } from "@/db/bookings";
import { getLatestCheckoutForBooking, refreshCheckoutFromStripe } from "@/db/checkouts";
import { getDb } from "@/db/client";
import { listActiveCourses } from "@/db/courses";
import { listDiveSiteCreatures, listPublishedDiveSiteMoments } from "@/db/dive-sites";
import { verifiedNitroxPersonIds } from "@/db/nitrox";
import { getBookingPayment } from "@/db/payments";
import { getBookingReadiness, getTripRequirements } from "@/db/readiness";
import { getRentalFit, toDiverRentalFit } from "@/db/rental-fit";
import { getShopReviewAggregate } from "@/db/reviews";
import { getShopBySlug } from "@/db/shops";
import { canAcceptPayments, getShopStripeAccount } from "@/db/stripe-accounts";
import { getTripWithBooked, getWaitlistEntryForTrip, listTripDives } from "@/db/trips";
import { DiverIntlProvider } from "@/i18n/DiverIntlProvider";
import { auth } from "@/lib/auth";
import { isStaff } from "@/lib/authz";
import { readinessLinkPath } from "@/lib/booking-capabilities";
import { nowDate } from "@/lib/clock";
import { perDiverBookingPriceCents } from "@/lib/courses";
import { googleMapsUrl } from "@/lib/dive-site-map";
import { conditionsChangedSinceBooking } from "@/lib/diver-planning";
import { formatShortDate } from "@/lib/format";
import {
  fetchAutomatedMarineForecast,
  hasCrewPrediction,
  shouldShowAutomatedForecast,
} from "@/lib/marine-forecast";
import { publicAppUrl } from "@/lib/notifications";
import { tripPageJsonLd } from "@/lib/structured-data";
import { isFull, spotsRemaining } from "@/lib/trips";
import { BookingConfirmation } from "./_components/BookingConfirmation";
import {
  BookSpotSection,
  ConditionsHoldSection,
  TripFullSection,
  TripSailedNotice,
  WaitlistConfirmation,
} from "./_components/BookingSections";
import { DiveBriefingsSection } from "./_components/DiveBriefingsSection";
import { ForecastSection } from "./_components/ForecastSection";
import { PackingSection } from "./_components/PackingSection";
import { TripActions } from "./_components/TripActions";
import { TripHeader } from "./_components/TripHeader";
import { ERROR_MESSAGES, type PaymentPanel } from "./_components/types";

/**
 * The departure's own title, description, and canonical URL. Embed mode points
 * its canonical at this standalone page (docs ADR
 * 20260729-booking-page-structured-data).
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ shopSlug: string; id: string }>;
}): Promise<Metadata> {
  const { shopSlug, id } = await params;
  const db = await getDb();
  const shop = await getShopBySlug(db, shopSlug);
  if (!shop) return { title: "Trip — DiveDay" };
  const trip = await getTripWithBooked(db, shop.id, id);
  if (!trip) return { title: "Trip — DiveDay" };
  const when = formatShortDate(trip.startsAt, shop.defaultLocale, shop.timezone);
  const title = `${trip.title} — ${when} · ${shop.name}`;
  const description = trip.description ?? `Book ${trip.title} with ${shop.name} on ${when}.`;
  const canonical = `/shop/${shop.slug}/schedule/${trip.id}`;
  return {
    title,
    description,
    alternates: { canonical },
    openGraph: { title, description, url: canonical },
  };
}

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
    embed?: string;
  }>;
}) {
  await connection();
  const { shopSlug, id: tripId } = await params;
  const {
    booking: bookingToken,
    waitlist: waitlistId,
    error,
    fit,
    pay,
    embed,
  } = await searchParams;
  // Embed mode is the compact surface a shop frames on its own website
  // (docs ADR 20260726-schedule-embed) — no "All trips" chrome pointing back
  // to a schedule the embedding page may never have shown at all.
  const isEmbed = embed === "1";
  const db = await getDb();
  const shop = await getShopBySlug(db, shopSlug);
  if (!shop) notFound();
  const session = await auth();
  // The staff-management redirect only makes sense outside embed mode — that
  // destination isn't in the framing allowlist, so sending an embedded staff
  // preview there would swap a working iframe for a blocked one.
  if (!isEmbed && session?.user?.shopId === shop.id && isStaff(session.user.roles)) {
    redirect(`/shop/${shopSlug}/trips/${tripId}`);
  }
  const [trip, tripDives] = await Promise.all([
    getTripWithBooked(db, shop.id, tripId),
    listTripDives(db, shop.id, tripId),
  ]);
  if (trip?.status !== "scheduled") notFound();
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

  // The confirmation renders only from a verified `confirm` capability —
  // never from a raw booking id in the URL (design principle 6: trustworthy
  // by inspection; CR-003). A guessed/leaked booking UUID alone is not a
  // credential; only a token this server itself issued verifies here.
  const confirmCapability = bookingToken
    ? await verifyBookingCapability(db, { token: bookingToken, purpose: "confirm" })
    : null;
  const [confirmed, waitlistConfirmation] = await Promise.all([
    confirmCapability ? getBookingForTrip(db, tripId, confirmCapability.bookingId) : null,
    waitlistId ? getWaitlistEntryForTrip(db, shop.id, tripId, waitlistId) : null,
  ]);
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
  // The confirmed-booking panels draw on six independent queries — batch them.
  const [
    payment,
    readiness,
    requirement,
    rentalFit,
    nitroxCardVerified,
    readinessCapability,
    courses,
  ] = confirmed
    ? await Promise.all([
        resolvePaymentPanel(db, shop.id, confirmed.booking.id, payAtBooking, perDiverPriceCents),
        getBookingReadiness(db, shop.id, confirmed.booking.id),
        getTripRequirements(db, shop.id, tripId),
        // Projected: this page is public and the form is a client
        // component, so staff-only fit columns must not ship to the browser.
        getRentalFit(db, shop.id, confirmed.person.id).then(toDiverRentalFit),
        verifiedNitroxPersonIds(db, shop.id).then((ids) => ids.has(confirmed.person.id)),
        issueBookingCapability(db, {
          shopId: shop.id,
          bookingId: confirmed.booking.id,
          purpose: "readiness",
        }),
        listActiveCourses(db, shop.id),
      ])
    : [null, null, null, null, false, null, []];
  const readinessLink = readinessCapability ? readinessLinkPath(readinessCapability.token) : null;

  const inPast = trip.startsAt <= nowDate();
  const full = isFull(trip);
  const remaining = spotsRemaining(trip);
  const errorMessage = error ? ERROR_MESSAGES[error] : undefined;
  const tripRef = { shopSlug, tripId, embed: isEmbed };

  // One `Event` for this departure, on the canonical standalone page only —
  // the embed points its canonical here, so emitting the same graph at both
  // URLs would be the duplication the canonical exists to resolve (docs ADR
  // 20260729-booking-page-structured-data). The shop's rating rides along as
  // the organizer's `aggregateRating`.
  const reviewAggregate = isEmbed ? null : await getShopReviewAggregate(db, shop.id);
  const structuredData = isEmbed
    ? null
    : tripPageJsonLd(
        shop,
        {
          id: trip.id,
          title: trip.title,
          description: trip.description,
          startsAt: trip.startsAt,
          endsAt: trip.endsAt,
          capacity: trip.capacity,
          booked: trip.booked,
          priceCents: perDiverPriceCents,
          diveSiteName: trip.diveSite?.name ?? null,
          conditionsHold: trip.conditionsHold,
        },
        publicAppUrl(),
        reviewAggregate,
      );

  return (
    // The booking form and its sibling notices are Client Components, so the
    // shop's locale and messages have to cross the boundary explicitly — see
    // src/i18n/settings.ts for why the locale isn't in the URL.
    <DiverIntlProvider locale={shop.defaultLocale}>
      <main
        className={
          isEmbed ? "w-full flex-1 px-3 py-4" : "mx-auto w-full max-w-2xl flex-1 px-6 py-16"
        }
      >
        {structuredData ? <JsonLd data={structuredData} /> : null}
        <FlashParams params={["error", "pay"]} />
        {isEmbed ? null : (
          <Link
            href={`/shop/${shopSlug}/schedule`}
            className="inline-flex min-h-11 items-center text-sm font-medium text-primary hover:underline"
          >
            ← All trips
          </Link>
        )}

        <TripHeader shop={shop} trip={trip} />
        {trip.conditionsHold ? (
          <div role="status" className="mt-5 rounded-lg border border-warning/40 bg-warning/10 p-4">
            <h2 className="font-semibold">This trip is on a conditions hold</h2>
            <p className="mt-1 text-sm text-muted">
              The crew is watching the weather and will make the final call. Existing seats stay
              held; new bookings are paused for now.
            </p>
          </div>
        ) : null}
        {!isEmbed ? (
          <TripActions
            calendarUrl={`/shop/${shopSlug}/schedule/${tripId}/calendar`}
            directionsUrl={
              trip.diveSite?.locationName ? googleMapsUrl(trip.diveSite.locationName) : null
            }
          />
        ) : null}
        {!confirmed && !inPast && !full && !trip.conditionsHold ? (
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
              // `confirmed` is only non-null when `confirmCapability` (and thus
              // `bookingToken`) verified, so this is always a real token here.
              token: bookingToken as string,
            }}
            rentalFit={rentalFit}
            nitroxCardVerified={nitroxCardVerified}
            fitSaved={fit === "saved"}
            payment={payment}
            payCancelled={pay === "cancelled"}
            readinessLink={readinessLink}
            progressionCourse={
              readiness?.blockers.some((blocker) => blocker.code === "certification_insufficient")
                ? (courses.find((course) => /advanced open water/i.test(course.title)) ?? null)
                : null
            }
          />
        ) : waitlistConfirmation ? (
          <WaitlistConfirmation
            firstName={waitlistConfirmation.person.fullName.split(" ")[0]}
            shopSlug={shopSlug}
            embed={isEmbed}
          />
        ) : inPast ? (
          <TripSailedNotice shopSlug={shopSlug} embed={isEmbed} />
        ) : trip.conditionsHold ? (
          <ConditionsHoldSection />
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
            locale={shop.defaultLocale}
          />
        )}

        <ForecastSection
          shop={shop}
          trip={trip}
          crewPrediction={crewPrediction}
          automatedForecast={automatedForecast}
        />
        {confirmed &&
        conditionsChangedSinceBooking(
          trip.conditionsUpdatedAt,
          confirmed.booking.conditionsBriefedAt,
        ) ? (
          <section
            className="mt-6 rounded-xl border border-warning bg-warning/10 p-5"
            role="status"
          >
            <h2 className="font-semibold">Conditions changed since you booked</h2>
            <p className="mt-1 text-sm text-muted">
              The crew has published a newer read for this day. Review it below; the final route and
              go/no-go call still happen at the dock.
            </p>
          </section>
        ) : null}
        <PackingSection shop={shop} trip={trip} rentalFit={rentalFit} />
        <DiveBriefingsSection briefings={diveBriefings} trip={trip} />
      </main>
    </DiverIntlProvider>
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
