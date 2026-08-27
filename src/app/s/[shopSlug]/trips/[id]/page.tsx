import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { FlashParams } from "@/components/FlashParams";
import { JsonLd } from "@/components/JsonLd";
import { DiveDayIcon } from "@/components/StaffDestinationIcon";
import { buttonClass } from "@/components/ui/button";
import { verifyBookingCapability } from "@/db/booking-capabilities";
import { getBookingForTrip } from "@/db/bookings";
import { getDb } from "@/db/client";
import { listDiveSiteBriefingExtras } from "@/db/dive-sites";
import { bookingConfirmationAndWaiverEmailsSent } from "@/db/notifications";
import { getTripRequirements, getTripSiteRequirement } from "@/db/readiness";
import { getShopReviewAggregate } from "@/db/reviews";
import { getShopBySlug } from "@/db/shops";
import { canAcceptPayments, getShopStripeAccount } from "@/db/stripe-accounts";
import {
  getTripWithBooked,
  getWaitlistEntryForTrip,
  listTripDives,
  listTripScheduleDays,
  tripCrewSpokenLanguages,
} from "@/db/trips";
import { DiverIntlProvider } from "@/i18n/DiverIntlProvider";
import { languageEndonymList } from "@/i18n/language-labels";
import { fieldGuideCards } from "@/i18n/marine-life-labels";
import { diverTranslator } from "@/i18n/messages";
import { tripRequirementList } from "@/i18n/readiness-labels";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { auth } from "@/lib/auth";
import { nowDate } from "@/lib/clock";
import { perDiverBookingPriceCents } from "@/lib/courses";
import { conditionsChangedSinceBooking } from "@/lib/diver-planning";
import { formatDateTimeTz, formatShortDate } from "@/lib/format";
import { cachedListFormat } from "@/lib/intl-cache";
import {
  fetchAutomatedMarineForecast,
  hasCrewPrediction,
  shouldShowAutomatedForecast,
} from "@/lib/marine-forecast";
import { minimumSeatsState } from "@/lib/minimum-seats";
import { toShopCurrency } from "@/lib/money";
import { publicAppUrl } from "@/lib/notifications";
import { parsePassThroughFee } from "@/lib/pass-through-fee";
import { publicSchedulePath, publicTripCalendarPath, publicTripPath } from "@/lib/public-routes";
import { combineCertRequirements } from "@/lib/readiness";
import { isLiveShopStaff } from "@/lib/session";
import { openGraphSite, shopSearchListingRobots } from "@/lib/site-metadata";
import { tripPageJsonLd } from "@/lib/structured-data";
import { isFull, spotsRemaining } from "@/lib/trips";
import { uuidParam } from "@/lib/uuid";
import {
  BookSpotSection,
  CancelledTripNotice,
  ConditionsHoldSection,
  TripFullSection,
  TripSailedNotice,
  WaitlistConfirmation,
} from "./_components/BookingSections";
import { DiveBriefingsSection } from "./_components/DiveBriefingsSection";
import { EmbedBookedNotice } from "./_components/EmbedBookedNotice";
import { ForecastSection } from "./_components/ForecastSection";
import { PackingSection } from "./_components/PackingSection";
import { StaffPreviewBar } from "./_components/StaffPreviewBar";
import { TripActions } from "./_components/TripActions";
import { TripHeader } from "./_components/TripHeader";
import { TripTerms } from "./_components/TripTerms";
import { ERROR_MESSAGE_KEYS, isErrorCode } from "./_components/types";

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
  const description =
    trip.description ??
    shop.description ??
    shop.tagline ??
    `Book ${trip.title} with ${shop.name} on ${when}.`;
  const canonical = publicTripPath(shop.slug, trip.id);
  return {
    title,
    description,
    alternates: { canonical },
    robots: shopSearchListingRobots(shop.searchListingOptOutAt),
    openGraph: {
      ...openGraphSite,
      title,
      description,
      url: canonical,
      ...(shop.logoUrl ? { images: [{ url: shop.logoUrl, alt: `${shop.name} logo` }] } : {}),
    },
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
    /** Stripe's cancel return, embed only — see `EmbedBookedNotice`. */
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
  const { booking: bookingToken, waitlist: waitlistId, error, pay, embed } = await searchParams;
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
  // frame instead of the compact booking widget. Live-checked (issue #966):
  // the "manage this trip" link it discloses is separately live-gated on
  // click, but the banner itself used to trust the cached JWT alone.
  const staffPreview = !isEmbed && (await isLiveShopStaff(db, shop.id, session));
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
  const [trip, tripDives, meetingDays, crewLanguages] = await Promise.all([
    getTripWithBooked(db, shop.id, tripId),
    listTripDives(db, shop.id, tripId),
    // Shop-scoped by the query's own join on `trips.shop_id`, like every other
    // read on this page. A departure always has at least one of these rows.
    listTripScheduleDays(db, shop.id, tripId),
    tripCrewSpokenLanguages(db, shop.id, tripId),
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
              className="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-primary hover:underline"
            >
              <DiveDayIcon name="arrow-left" className="size-4" />
              {t("trip.backToAllTrips")}
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
  const crewLanguageNames = languageEndonymList(crewLanguages);
  const crewLanguagesLine =
    crewLanguageNames.length === 0
      ? null
      : cachedListFormat(locale, { style: "long", type: "conjunction" }).format(crewLanguageNames);
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

  // The embed's short confirmation renders only from a verified `confirm`
  // capability — never from a raw booking id in the URL (design principle 6:
  // trustworthy by inspection; CR-003). A guessed/leaked booking UUID alone is
  // not a credential; only a token this server itself issued verifies here.
  //
  // `isEmbed` first, and it is the *whole* gate: outside the frame a booking
  // lands on `/ready` and no `confirm` token is ever minted (ADR
  // 20260820-one-page-after-booking), so an unframed `?booking=` can only be a
  // stale link or a guess. Refusing to look at it at all is the narrower
  // answer than verifying a token nothing issues any more.
  const confirmCapability =
    isEmbed && bookingToken
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
  const passThroughFee = parsePassThroughFee(shop.passThroughFee);
  const perDiverPriceCents = perDiverBookingPriceCents(trip, trip.course);
  const payablePerDiverCents =
    perDiverPriceCents === null ? null : perDiverPriceCents + (passThroughFee?.amountCents ?? 0);
  const stripeAccount = payablePerDiverCents ? await getShopStripeAccount(db, shop.id) : null;
  const payAtBooking = Boolean(
    payablePerDiverCents && canAcceptPayments(stripeAccount) && publicAppUrl(),
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
  // The embed's short confirmation needs exactly one fact beyond the booking
  // itself: whether both emails went. Everything the old in-page confirmation
  // read — the payment panel, readiness, rental fit, the nitrox card, the
  // party's claim links — now belongs to `/ready`, which reads it for every
  // visit rather than only the one right after booking (ADR
  // 20260820-one-page-after-booking).
  //
  // Only say "two emails are on their way" when both actually went — a party
  // member booked without an address of their own gets neither.
  const emailsOnTheWay = confirmed
    ? await bookingConfirmationAndWaiverEmailsSent(db, shop.id, confirmed.booking.id)
    : false;
  // The door out to `/ready` is a *path*, resolved by `./ready/route.ts` when
  // the diver taps it. This render mints no capability: a readiness token is
  // stored hashed and so cannot be read back, and minting a fresh one per
  // render both wrote a row per reload and — past
  // `MAX_LIVE_CAPABILITIES_PER_PURPOSE` — retired the readiness link `bookSpot`
  // had already emailed (`coderabbitai`).
  //
  // Always a real destination, which is the other half of what that costs: the
  // link used to be `href="#"` whenever no capability came back, and `#` under
  // `target="_top"` is not inert — a keyboard Enter replaced the shop's own
  // page with the embed route. `bookingToken` is a string wherever this
  // renders (`confirmed` exists only downstream of verifying it), and the empty
  // case lands on the departure's public page rather than nowhere.
  const readinessLink = `${publicTripPath(shopSlug, tripId)}/ready?booking=${encodeURIComponent(bookingToken ?? "")}`;

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
            className="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-primary hover:underline"
          >
            <DiveDayIcon name="arrow-left" className="size-4" />
            {t("trip.backToAllTrips")}
          </Link>
        )}

        <TripHeader shop={shop} trip={trip} meetingDays={meetingDays} locale={locale} />
        {crewLanguagesLine ? (
          <p className="mt-3 text-sm text-muted">
            {t("trip.languagesAboard", { languages: crewLanguagesLine })}
          </p>
        ) : null}
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
          <EmbedBookedNotice
            shop={shop}
            shopSlug={shopSlug}
            locale={locale}
            trip={trip}
            confirmed={confirmed}
            readinessLink={readinessLink}
            emailsOnTheWay={emailsOnTheWay}
            payCancelled={pay === "cancelled"}
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
            passThroughFee={passThroughFee}
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
          // No `rentalFit` here any more: the only reader who had one was the
          // in-page confirmation, and a diver's own gear now sits beside their
          // packing list on `/ready` (ADR 20260820-one-page-after-booking).
          // This page is what an unbooked visitor reads, and it never had one.
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
        <DiveBriefingsSection
          briefings={diveBriefings}
          trip={trip}
          // The species photos lead for a diver still deciding and stay folded
          // for one who has already paid — the same split the comment above
          // the booking block makes about the seat coming first (issue #760).
          leadWithFieldGuide={!confirmed}
          locale={locale}
        />
      </main>
    </DiverIntlProvider>
  );
}
