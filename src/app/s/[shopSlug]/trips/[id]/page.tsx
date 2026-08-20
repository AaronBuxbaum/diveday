import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { FlashParams } from "@/components/FlashParams";
import { JsonLd } from "@/components/JsonLd";
import { buttonClass } from "@/components/ui/button";
import { issueBookingCapability, verifyBookingCapability } from "@/db/booking-capabilities";
import { getBookingForTrip } from "@/db/bookings";
import {
  getLatestCheckoutForBooking,
  refreshCheckoutFromStripe,
  retirePendingCheckoutIfRepriced,
} from "@/db/checkouts";
import { getDb } from "@/db/client";
import { listDiveSiteBriefingExtras } from "@/db/dive-sites";
import { nitroxCardOnFilePersonIds, verifiedNitroxPersonIds } from "@/db/nitrox";
import { bookingConfirmationAndWaiverEmailsSent } from "@/db/notifications";
import { getBookingPayment } from "@/db/payments";
import { getBookingReadiness, getTripRequirements, getTripSiteRequirement } from "@/db/readiness";
import { getRentalFit, toDiverRentalFit } from "@/db/rental-fit";
import { getShopReviewAggregate } from "@/db/reviews";
import { issuePartySeatClaims } from "@/db/seat-claims";
import { getShopBySlug } from "@/db/shops";
import { canAcceptPayments, getShopStripeAccount } from "@/db/stripe-accounts";
import {
  getTripWithBooked,
  getWaitlistEntryForTrip,
  listTripDives,
  listTripScheduleDays,
} from "@/db/trips";
import { DiverIntlProvider } from "@/i18n/DiverIntlProvider";
import { fieldGuideCards } from "@/i18n/marine-life-labels";
import { diverTranslator } from "@/i18n/messages";
import { tripRequirementList } from "@/i18n/readiness-labels";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { auth } from "@/lib/auth";
import { isStaff } from "@/lib/authz";
import { claimLinkPath, readinessLinkPath } from "@/lib/booking-capabilities";
import { nowDate } from "@/lib/clock";
import { perDiverBookingPriceCents } from "@/lib/courses";
import { conditionsChangedSinceBooking } from "@/lib/diver-planning";
import { formatDateTimeTz, formatShortDate } from "@/lib/format";
import {
  fetchAutomatedMarineForecast,
  hasCrewPrediction,
  shouldShowAutomatedForecast,
} from "@/lib/marine-forecast";
import { minimumSeatsState } from "@/lib/minimum-seats";
import { type ShopCurrency, toShopCurrency } from "@/lib/money";
import { publicAppUrl } from "@/lib/notifications";
import { publicSchedulePath, publicTripCalendarPath, publicTripPath } from "@/lib/public-routes";
import { combineCertRequirements } from "@/lib/readiness";
import { openGraphSite, shopSearchListingRobots } from "@/lib/site-metadata";
import { tripPageJsonLd } from "@/lib/structured-data";
import { isFull, spotsRemaining } from "@/lib/trips";
import { uuidParam } from "@/lib/uuid";
import { BookingConfirmation } from "./_components/BookingConfirmation";
import {
  BookSpotSection,
  CancelledTripNotice,
  ConditionsHoldSection,
  TripFullSection,
  TripSailedNotice,
  WaitlistConfirmation,
} from "./_components/BookingSections";
import { DiveBriefingsSection } from "./_components/DiveBriefingsSection";
import { ForecastSection } from "./_components/ForecastSection";
import { PackingSection } from "./_components/PackingSection";
import { StaffPreviewBar } from "./_components/StaffPreviewBar";
import { TripActions } from "./_components/TripActions";
import { TripHeader } from "./_components/TripHeader";
import { TripTerms } from "./_components/TripTerms";
import { ERROR_MESSAGE_KEYS, isErrorCode, type PaymentPanel } from "./_components/types";

// `instant = true`: this route has a real static shell. Every request-scoped
// read below sits inside this segment's `loading.tsx` boundary, so the frame
// paints without waiting on the request and the data streams into it —
// and `next build` fails if that ever stops being true.
// See ADR 20260804-instant-navigation.
export const instant = true;

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
  // Metadata runs its own read, so it needs its own guard — and it must not
  // throw either: a junk id here would 500 the page before the body's
  // notFound() could render it.
  if (!uuidParam(id)) return { title: "Trip — DiveDay" };
  const db = await getDb();
  const shop = await getShopBySlug(db, shopSlug);
  if (!shop) return { title: "Trip — DiveDay" };
  const trip = await getTripWithBooked(db, shop.id, id);
  if (!trip) return { title: "Trip — DiveDay" };
  const locale = await requestLocale(shop.defaultLocale);
  const when = formatShortDate(trip.startsAt, locale, shop.timezone);
  const title = `${trip.title} — ${when} · ${shop.name}`;
  const description = trip.description ?? `Book ${trip.title} with ${shop.name} on ${when}.`;
  const canonical = publicTripPath(shop.slug, trip.id);
  return {
    title,
    description,
    alternates: { canonical },
    robots: shopSearchListingRobots(shop.searchListingOptOutAt),
    openGraph: { ...openGraphSite, title, description, url: canonical },
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
  // An unparseable id names no row. Guarded here rather than in the query
  // helper: comparing junk against a `uuid` column raises in Postgres, so
  // without this the page 500s where its own notFound() belongs.
  if (!uuidParam(tripId)) notFound();
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
  // What this visitor's device asked for, falling back to the shop's own
  // default — DiveDay never asks (docs ADR 20260729-diver-copy-localization).
  const locale = await requestLocale(shop.defaultLocale);
  // Every list price on this page is in the shop's own currency — a Cozumel
  // shop quotes pesos. Amounts a diver has already *paid* keep the currency
  // stored on their payment row instead (docs ADR 20260731-shop-currency).
  const shopCurrency = toShopCurrency(shop.currency);
  const t = diverTranslator(locale);
  const session = await auth();
  // A staffer looking at their own shop's booking page is *previewing* it, and
  // this page used to answer that with a redirect straight back to the
  // management view — so "View booking page" on the trip overview could never
  // show the booking page at all, it just bounced to where the click came
  // from. A banner says the same thing without taking the page away, and it
  // also serves the staffer who followed a shared /s/ link and wants the
  // management view. Never in embed mode: that destination isn't in the
  // framing allowlist, so an embedded staff preview would show a blocked
  // frame instead of the compact booking widget.
  const staffPreview = !isEmbed && session?.user?.shopId === shop.id && isStaff(session.user.roles);
  // Staff words come from the staff bundle even here — the rest of this page
  // speaks to divers, and mixing the two vocabularies in one file is exactly
  // what the two bundles exist to prevent.
  const staffPreviewBar = staffPreview ? (
    <StaffPreviewBar
      message={staffTranslator(locale)("trips.publicPreview.banner")}
      manageLabel={staffTranslator(locale)("trips.publicPreview.manage")}
      manageHref={`/shop/${shopSlug}/trips/${tripId}`}
    />
  ) : null;
  const [trip, tripDives, meetingDays] = await Promise.all([
    getTripWithBooked(db, shop.id, tripId),
    listTripDives(db, shop.id, tripId),
    // Shop-scoped by the query's own join on `trips.shop_id`, like every other
    // read on this page. A departure always has at least one of these rows.
    listTripScheduleDays(db, shop.id, tripId),
  ]);
  if (!trip) notFound();
  // A cancelled trip gets its own soft landing (task 13) rather than the same
  // bare `notFound()` as a typo'd URL — a diver who followed a saved or
  // shared link into a since-cancelled departure gets told what happened and
  // a way back, not a dead end. Nothing past this point (booking, forecast,
  // dive briefings) applies to a cancelled departure, so it renders before
  // any of that is fetched.
  if (trip.status === "cancelled") {
    return (
      <DiverIntlProvider locale={locale} timeZone={shop.timezone} namespaces={["booking"]}>
        <main
          className={
            isEmbed ? "w-full flex-1 px-3 py-4" : "mx-auto w-full max-w-2xl flex-1 px-6 py-16"
          }
        >
          {staffPreviewBar}
          {isEmbed ? null : (
            <Link
              href={publicSchedulePath(shopSlug)}
              className="inline-flex min-h-11 items-center text-sm font-medium text-primary hover:underline"
            >
              ← {t("trip.backToAllTrips")}
            </Link>
          )}
          <CancelledTripNotice
            shopSlug={shopSlug}
            embed={isEmbed}
            contactEmail={shop.contactEmail}
          />
        </main>
      </DiverIntlProvider>
    );
  }
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
  // Two queries for the whole day's briefings, not two per dive.
  const briefingExtras = await listDiveSiteBriefingExtras(
    db,
    shop.id,
    tripDives.map(({ diveSite }) => diveSite?.id).filter((id): id is string => Boolean(id)),
  );
  const diveBriefings = tripDives.map(({ dive, diveSite }) => ({
    dive,
    diveSite,
    creatures: fieldGuideCards(
      diveSite ? (briefingExtras.creatures.get(diveSite.id) ?? []) : [],
      t,
    ),
    moments: diveSite ? (briefingExtras.moments.get(diveSite.id) ?? []) : [],
  }));
  // Dive 1 first, in the dive plan's own order: where a site names its own
  // time in the water, that is what the day's rhythm counts rather than the
  // shop-wide default (src/lib/diver-planning.ts).
  const siteBottomTimes = tripDives.map(({ diveSite }) => diveSite?.expectedBottomTimeMinutes);
  // ...and each leg of the run between them, in the same order: dock to the
  // first site, then site to site. A departure that states none of them reads
  // the shop's own ride out on every leg, exactly as it did before this existed
  // (ADR 20260815-per-leg-travel-minutes).
  const legTravelTimes = tripDives.map(({ dive }) => dive.travelMinutes);
  // Pay-at-booking is offered only when the shop's own Stripe account can
  // take a charge, the trip carries a price, and a canonical origin exists
  // for the return links; otherwise the flow is book-now-pay-later as before.
  const perDiverPriceCents = perDiverBookingPriceCents(trip, trip.course);
  const stripeAccount = perDiverPriceCents ? await getShopStripeAccount(db, shop.id) : null;
  const payAtBooking = Boolean(
    perDiverPriceCents && canAcceptPayments(stripeAccount) && publicAppUrl(),
  );
  // **What this trip asks of anybody**, read for every visitor rather than only
  // for a diver who already holds a seat. `requirement` used to be fetched
  // inside the `confirmed` branch below and passed only into
  // `BookingConfirmation` — so a trip's cert gate was first stated *after* the
  // seat was bought, and a diver who could not clear it read "4 spots left",
  // paid, and found out at the dock (DOM-M6). A trip's requirement is a
  // property of the trip: it discloses nothing about any person, so it belongs
  // above the form.
  const [requirement, siteRequirement] = await Promise.all([
    getTripRequirements(db, shop.id, tripId),
    getTripSiteRequirement(db, shop.id, tripId),
  ]);
  // Course sessions are left out on purpose: a course states its own admission
  // rule on its own page, and its itinerary's gate is deliberately *not* a
  // booking gate (src/lib/trip-admission.ts) — repeating the site's demand here
  // would read as a bar on the very students the course exists to create.
  const combinedRequirement = trip.course
    ? null
    : combineCertRequirements(
        requirement ?? {
          minimumCertificationLevel: null,
          requiredSpecialties: [],
          requiresNitrox: false,
        },
        siteRequirement,
      );
  const requirementNote = combinedRequirement
    ? tripRequirementList(t, combinedRequirement, locale)
    : null;
  // The bare level code, for the per-diver warning under each certification
  // select. A property of the *trip*, exactly like `requirementNote` above, so
  // it is safe to send to an anonymous page — it says nothing about any reader.
  const requiredLevel = combinedRequirement?.minimumCertificationLevel ?? undefined;

  // The confirmed-booking panels draw on several more independent queries — batch them.
  const [
    payment,
    readiness,
    rentalFit,
    nitroxCardVerified,
    nitroxCardOnFile,
    readinessCapability,
    emailsOnTheWay,
    partySeatClaims,
  ] = confirmed
    ? await Promise.all([
        resolvePaymentPanel(
          db,
          shop.id,
          confirmed.booking.id,
          payAtBooking,
          perDiverPriceCents,
          shopCurrency,
        ),
        getBookingReadiness(db, shop.id, confirmed.booking.id),
        // Projected: this page is public and the form is a client
        // component, so staff-only fit columns must not ship to the browser.
        getRentalFit(db, shop.id, confirmed.person.id).then(toDiverRentalFit),
        verifiedNitroxPersonIds(db, shop.id).then((ids) => ids.has(confirmed.person.id)),
        // Not a gate — only whether the fit form should still ask for a card
        // number, so a diver who typed one at 9pm is not asked again while it
        // sits `pending` (src/db/nitrox.ts).
        nitroxCardOnFilePersonIds(db, shop.id).then((ids) => ids.has(confirmed.person.id)),
        issueBookingCapability(db, {
          shopId: shop.id,
          bookingId: confirmed.booking.id,
          purpose: "readiness",
        }),
        // Only say "two emails are on their way" when both actually went —
        // a party member booked without an address of their own gets neither.
        bookingConfirmationAndWaiverEmailsSent(db, shop.id, confirmed.booking.id),
        // The organizer's claim panel: one shareable link per still-unclaimed
        // seat this booking leads (docs ADR 20260804-seat-claim-links).
        // Authorized by the verified `confirm` capability above; the query
        // itself only walks seats whose party lead is this booking, so a
        // non-party confirmation gets an empty list and no panel.
        issuePartySeatClaims(db, { shopId: shop.id, leadBookingId: confirmed.booking.id }),
      ])
    : [null, null, null, false, false, null, false, []];
  const readinessLink = readinessCapability ? readinessLinkPath(readinessCapability.token) : null;
  // Absolute when a canonical origin is configured — these URLs exist to be
  // pasted into a group chat — with the same-relative fallback the readiness
  // link uses so a missing APP_HOST never renders a broken link.
  const claimOrigin = publicAppUrl();
  const partySeats = partySeatClaims.map((seat) => ({
    bookingId: seat.bookingId,
    seatName: seat.seatName,
    claimed: seat.claimed,
    claimUrl: seat.claim
      ? claimOrigin
        ? new URL(claimLinkPath(seat.claim.token), `${claimOrigin}/`).toString()
        : claimLinkPath(seat.claim.token)
      : null,
  }));

  const inPast = new Date(trip.startsAt.getTime() + 60 * 60 * 1000) <= nowDate();
  // Where this departure stands against the head count it needs, if it named
  // one. A departure that already sailed has nothing conditional left to
  // promise; a cancelled one returned far above this line, at the `status`
  // check that renders `CancelledTripNotice` instead of the booking page.
  const minimumSeats = inPast ? ({ kind: "none" } as const) : minimumSeatsState(trip, trip.booked);
  const full = isFull(trip);
  const remaining = spotsRemaining(trip);
  const errorMessage = error && isErrorCode(error) ? t(ERROR_MESSAGE_KEYS[error]) : undefined;
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
    // src/i18n/settings.ts for why the locale isn't in the URL. The namespace
    // list is the union of every Client Component this subtree can render
    // (TripActions, BookingSections' several outcome sections + the
    // BookingPartyFields it shares with the wait list, RentalFitForm reached
    // through BookingConfirmation) — see each's `useTranslations(...)` call.
    <DiverIntlProvider
      locale={locale}
      timeZone={shop.timezone}
      // `bookingGear` is BookingGearFields' own namespace; without it every
      // string in the checkout gear picker rendered as its raw key.
      // `course` carries the certification-level words `DiveDeclarationFields`
      // renders in the wait-list form's optional "what can you dive?" select.
      namespaces={[
        "booking",
        "bookingGear",
        "common",
        "course",
        "fallback",
        "party",
        "rental",
        "trip",
      ]}
    >
      <main
        className={
          isEmbed ? "w-full flex-1 px-3 py-4" : "mx-auto w-full max-w-2xl flex-1 px-6 py-16"
        }
      >
        {structuredData ? <JsonLd data={structuredData} /> : null}
        <FlashParams params={["error", "pay"]} />
        {staffPreviewBar}
        {isEmbed ? null : (
          <Link
            href={publicSchedulePath(shopSlug)}
            className="inline-flex min-h-11 items-center text-sm font-medium text-primary hover:underline"
          >
            ← {t("trip.backToAllTrips")}
          </Link>
        )}

        <TripHeader shop={shop} trip={trip} meetingDays={meetingDays} locale={locale} />
        {/* The one warning panel this page ever wears — the same shape as the
            conditions-changed panel below, on purpose. Two amber boxes with
            different radii and border weights read as two different systems
            warning about one weather call. */}
        {trip.conditionsHold ? (
          <div
            role="status"
            className="mt-5 rounded-2xl border border-warning/40 bg-warning/10 p-5"
          >
            <h2 className="font-semibold">{t("trip.conditionsHoldHeading")}</h2>
            <p className="mt-1 text-sm text-muted">{t("trip.conditionsHoldBody")}</p>
          </div>
        ) : null}
        {/* The promise, stated before anyone pays: what this departure needs to
            run, and the exact moment the answer arrives. It is what makes the
            automatic cancellation fair rather than abrupt — a diver who books
            a boat that needs four people knows that, and knows when they'll
            hear (ADR 20260813-minimum-head-count-departures). Dropped once the
            count is met, because then there is nothing conditional left to
            say, and on a departure that already sailed or was cancelled. */}
        {minimumSeats.kind === "short" || minimumSeats.kind === "due" ? (
          // Sunken fill, no border: a stated fact about the departure, not a
          // warning — it wears the same quiet material as the supporting
          // reading, one step below the amber conditions banner above.
          <p className="mt-5 rounded-xl bg-surface-sunken p-4 text-sm text-muted">
            {t("trip.minimumSeatsNotice", {
              minimum: minimumSeats.minimum,
              deadline: formatDateTimeTz(minimumSeats.decidesAt, locale, shop.timezone),
            })}
          </p>
        ) : null}
        {!isEmbed ? <TripActions calendarUrl={publicTripCalendarPath(shopSlug, tripId)} /> : null}
        {/* Full keeps the same sticky CTA rather than hiding it — a diver who
            scrolls to a full boat still has one obvious next step (the wait
            list), not a dead-ended thumb (task 12). Both destinations share
            the `#book` anchor: `BookSpotSection` and `TripFullSection`'s
            wait-list form each carry it. */}
        {!confirmed && !inPast && !trip.conditionsHold ? (
          <a
            href="#book"
            className={buttonClass({
              size: "cta",
              className: "fixed right-4 bottom-4 z-20 rounded-full shadow-lg sm:hidden",
            })}
          >
            {full ? t("booking.waitlistHeading") : t("trip.bookAndSpotsLeft", { count: remaining })}
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
            locale={locale}
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
            nitroxCardOnFile={nitroxCardOnFile}
            fitSaved={fit === "saved"}
            payment={payment}
            payCancelled={pay === "cancelled"}
            readinessLink={readinessLink}
            emailsOnTheWay={emailsOnTheWay}
            partySeats={partySeats}
            terms={<TripTerms shop={shop} trip={trip} locale={locale} cancellationOnly />}
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
            contactEmail={shop.contactEmail}
            contactPhone={shop.contactPhone}
            terms={<TripTerms shop={shop} trip={trip} locale={locale} />}
          />
        ) : (
          <BookSpotSection
            trip={trip}
            tripRef={tripRef}
            remaining={remaining}
            errorMessage={errorMessage}
            minimumCertificationLevel={requiredLevel}
            requirementHeading={requirementNote ? t("trip.requirementHeading") : undefined}
            requirementNote={
              requirementNote ? t("trip.requirementNote", { list: requirementNote }) : undefined
            }
            payAtBooking={payAtBooking}
            perDiverPriceCents={perDiverPriceCents}
            currency={shopCurrency}
            locale={locale}
            contactEmail={shop.contactEmail}
            contactPhone={shop.contactPhone}
            rentalItems={shop.rentalItems}
            rentalPricing={shop.rentalPricing}
            terms={<TripTerms shop={shop} trip={trip} locale={locale} />}
          />
        )}

        <ForecastSection
          shop={shop}
          trip={trip}
          crewPrediction={crewPrediction}
          automatedForecast={automatedForecast}
          locale={locale}
        />
        {confirmed &&
        conditionsChangedSinceBooking(
          trip.conditionsUpdatedAt,
          confirmed.booking.conditionsBriefedAt,
        ) ? (
          <section
            className="mt-6 rounded-2xl border border-warning/40 bg-warning/10 p-5"
            role="status"
          >
            <h2 className="font-semibold">{t("trip.conditionsChangedHeading")}</h2>
            <p className="mt-1 text-sm text-muted">{t("trip.conditionsChangedBody")}</p>
          </section>
        ) : null}
        <PackingSection
          shop={shop}
          trip={trip}
          rentalFit={rentalFit}
          day={meetingDays[0]}
          days={meetingDays}
          multiDay={meetingDays.length > 1}
          siteBottomTimes={siteBottomTimes}
          legTravelTimes={legTravelTimes}
          // Exactly the condition under which the conditions card above renders
          // its water-temperature tile — and with it the suit line — rather
          // than an approximation of it, so a departure with a crew note but no
          // temperature still gets the advice down here instead of neither
          // section saying anything.
          temperatureStatedAbove={
            (crewPrediction
              ? trip.waterTemperatureC
              : (automatedForecast?.waterTemperatureC ?? null)) !== null
          }
          locale={locale}
        />
        <DiveBriefingsSection briefings={diveBriefings} trip={trip} locale={locale} />
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
  // i18n-exempt: multi-line type annotation, not copy — the scanner misreads the signature as a string.
  db: Awaited<ReturnType<typeof getDb>>,
  shopId: string,
  bookingId: string,
  payAtBooking: boolean,
  fullPriceCents: number | null,
  /**
   * What to show when a settled payment predates the currency column and has
   * none of its own. A settled amount that *does* carry a currency keeps it —
   * it is evidence of what was charged, and today's shop setting must never
   * reinterpret it.
   */
  shopCurrency: ShopCurrency,
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
      currency: settled?.currency ?? shopCurrency,
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
  if (checkout?.status === "pending") {
    // "Finish paying" links this session's Stripe URL directly, so the figure
    // the diver lands on is the one it was minted for. Retire it if the trip
    // has been repriced since (PAY-L2) — the panel then falls through to its
    // "Pay now" form, which mints a fresh session at today's price.
    checkout = await retirePendingCheckoutIfRepriced(db, shopId, checkout);
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
