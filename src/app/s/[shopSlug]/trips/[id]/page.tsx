import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FlashParams } from "@/components/FlashParams";
import { JsonLd } from "@/components/JsonLd";
import { PhoneFootBar } from "@/components/PhoneFootBar";
import { ShopContactLinks } from "@/components/ShopContactLinks";
import { TripChangeLedger } from "@/components/TripChangeLedger";
import { getDb } from "@/db/client";
import { shopBySlugCached } from "@/db/shops-cached";
import { checkoutMode } from "@/db/stripe-accounts";
import { DiverIntlProvider } from "@/i18n/DiverIntlProvider";
import { diverTranslator } from "@/i18n/messages";
import { requestLocale, requestReaderUnits } from "@/i18n/request";
import { auth } from "@/lib/auth";
import { nowDate } from "@/lib/clock";
import { perDiverBookingPriceCents } from "@/lib/courses";
import { checkoutSeatTerms } from "@/lib/deposits";
import { conditionsChangedSinceBooking } from "@/lib/diver-planning";
import { formatShortDate } from "@/lib/format";
import { minimumSeatsState } from "@/lib/minimum-seats";
import { toShopCurrency } from "@/lib/money";
import { connectionForRoute } from "@/lib/observability/render-connection";
import { parsePassThroughFee } from "@/lib/pass-through-fee";
import { publicTripPath } from "@/lib/public-routes";
import { unionRequirements } from "@/lib/requirement";
import { openGraphSite, shopSearchListingRobots } from "@/lib/site-metadata";
import { hasSailed, isFull, spotsRemaining } from "@/lib/trips";
import { uuidParam } from "@/lib/uuid";
import { BookingFinePrint } from "./_components/BookingFinePrint";
import {
  BookSpotSection,
  ConditionsHoldSection,
  TripFullSection,
  TripSailedNotice,
  WaitlistConfirmation,
} from "./_components/BookingSections";
import { BookingSentLanding } from "./_components/BookingSentLanding";
import { CancelledTripLanding } from "./_components/CancelledTripLanding";
import { ConditionsChangedNotice } from "./_components/ConditionsChangedNotice";
import { ConditionsLine } from "./_components/ConditionsLine";
import { bookingCourseFees } from "./_components/course-fees";
import { crewLanguagesSentence } from "./_components/crew-languages";
import { EmbedBookedNotice } from "./_components/EmbedBookedNotice";
import { knownDiverPanelFor } from "./_components/known-diver-lines";
import { fullTripAlternatives, worthALookList } from "./_components/other-boats";
import { TripAlternatives } from "./_components/TripAlternatives";
import { dayCoverPhoto, dayProfileFacts, TripDayPlan } from "./_components/TripDayPlan";
import { TripBoatPhoto, TripHero } from "./_components/TripHero";
import { pitchOpensOnDoor, TripPitch } from "./_components/TripPitch";
import { ERROR_MESSAGE_KEYS, isErrorCode } from "./_components/types";
import { dayBriefings } from "./_lib/day-briefings";
import { departureJsonLd } from "./_lib/departure-json-ld";
import { fullFootLabel } from "./_lib/foot-bar-label";
import { bookingFormTrip, publicTripRecord, readTripPage } from "./_lib/page-reads";
import { publicForecast } from "./_lib/public-forecast";
import { readinessDoorPath } from "./_lib/readiness-door";
import { requirementSentenceFor } from "./_lib/requirement-sentence";
import { offerHandoff } from "./actions";

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
  const shop = await shopBySlugCached(shopSlug);
  if (!shop) return { title: "Trip — DiveDay" };
  const trip = await publicTripRecord(shop.id, id);
  if (!trip || trip.isRehearsal) return { title: "Trip — DiveDay" };
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
    robots: shopSearchListingRobots(shop),
    openGraph: {
      ...openGraphSite,
      title,
      description,
      url: canonical,
    },
  };
}

// The booking form and its sibling notices are Client Components, so the
// shop's locale and messages have to cross the boundary explicitly — see
// src/i18n/settings.ts for why the locale isn't in the URL. The namespace
// list is the union of every Client Component this subtree can render
// (TripActions, BookingSections' several outcome sections + the
// BookingPartyFields it shares with the wait list, RentalFitForm reached
// through BookingConfirmation) — see each's `useTranslations(...)` call.
//
// `bookingGear` is BookingGearFields' own namespace; without it every
// string in the checkout gear picker rendered as its raw key.
// `course` carries the certification-level words `DiveDeclarationFields`
// renders in the wait-list form's optional "what can you dive?" select.
const TRIP_PAGE_NAMESPACES = [
  "booking",
  "bookingGear",
  "common",
  "course",
  "fallback",
  "findMyBooking",
  "participants",
  "party",
  "rental",
  "trip",
] as const;

export default async function TripDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string; id: string }>;
  searchParams: Promise<{
    booking?: string;
    interest?: string;
    error?: string;
    /** Stripe's cancel return, embed only — see `EmbedBookedNotice`. */
    pay?: string;
    embed?: string;
    /** A diver's own handoff (ADR 20260906-before-you-ask, decision 3). */
    handoff?: string | string[];
    sent?: string;
  }>;
}) {
  await connectionForRoute("/s/[shopSlug]/trips/[id]");
  const { shopSlug, id: tripId } = await params;
  // An unparseable id names no row. Guarded here rather than in the query
  // helper: comparing junk against a `uuid` column raises in Postgres, so
  // without this the page 500s where its own notFound() belongs.
  if (!uuidParam(tripId)) notFound();
  const {
    booking: bookingToken,
    interest: interestId,
    error,
    pay,
    embed,
    handoff: handoffParam,
    sent,
  } = await searchParams;
  // One string or nothing: a repeated `?handoff=` arrives as an array, and an
  // array must read as no handoff rather than reach the hasher.
  const handoffToken = typeof handoffParam === "string" ? handoffParam : null;
  // Embed mode is the compact surface a shop frames on its own website
  // (docs ADR 20260726-schedule-embed) — no "All trips" chrome pointing back
  // to a schedule the embedding page may never have shown at all.
  const isEmbed = embed === "1";
  const db = await getDb();
  const shop = await shopBySlugCached(shopSlug);
  if (!shop) notFound();
  // What this visitor's device asked for, falling back to the shop's own
  // default — DiveDay never asks (docs ADR 20260729-diver-copy-localization).
  const locale = await requestLocale(shop.defaultLocale);
  // The units this visitor thinks in, after the shop's (fifth-loop ideas, item 22).
  const readerUnits = await requestReaderUnits(locale);
  // Every list price on this page is in the shop's own currency — a Cozumel
  // shop quotes pesos. Amounts a diver has already *paid* keep the currency
  // stored on their payment row instead (docs ADR 20260731-shop-currency).
  const shopCurrency = toShopCurrency(shop.currency);
  const t = diverTranslator(locale);
  if (sent === "1") return <BookingSentLanding t={t} />;
  const session = auth();
  const now = nowDate();
  const {
    trip,
    tripDives,
    meetingDays,
    crewLanguages,
    publicCrew,
    changeEvents,
    knownDiver,
    confirmed,
    waitlistConfirmation,
    briefing,
    requirement,
    siteRequirement,
    payment,
    mailState,
    paymentUrl,
    board,
    reviewAggregate,
    run,
  } = await readTripPage(db, shop, {
    tripId,
    isEmbed,
    bookingToken,
    interestId,
    handoffToken,
    payDue: pay === "due",
    session,
    now,
  });
  if (!trip || trip.isRehearsal) notFound();
  // A cancelled trip gets its own soft landing (task 13) rather than the same
  // bare `notFound()` as a typo'd URL — a diver who followed a saved or
  // shared link into a since-cancelled departure gets told what happened and
  // a way back, not a dead end. Nothing past this point (booking, forecast,
  // dive briefings) applies to a cancelled departure, so it renders before
  // any of that is fetched.
  if (trip.status === "cancelled") {
    return (
      <CancelledTripLanding
        locale={locale}
        timeZone={shop.timezone}
        isEmbed={isEmbed}
        shopSlug={shopSlug}
        contactEmail={shop.contactEmail}
        staffPreviewBar={null}
        t={t}
      />
    );
  }
  const crewLanguagesLine = crewLanguagesSentence(crewLanguages, locale);
  // Public conditions off drops only the automated outlook (`publicForecast`).
  const { crewPrediction, automatedForecast } = publicForecast(shop, trip);
  const knownDiverPanel = knownDiverPanelFor(knownDiver, t, {
    handoff: handoffToken,
    blankHref: `${publicTripPath(shopSlug, tripId)}#book`,
    locale,
    timeZone: shop.timezone,
  });
  const diveBriefings = dayBriefings(tripDives, briefing.extras, t);
  const coverPhoto = dayCoverPhoto(diveBriefings);
  // The dock-day rhythm's full run stays on the thread the diver reaches after
  // booking (ADR 20260827-the-divers-thread, decision 2); "The day" carries its
  // two ends in one line (fifth-loop ideas, item 19).
  const perDiverPriceCents = perDiverBookingPriceCents(trip, trip.course);
  const { stripeAccount, payAtBooking, offerCodeField } = payment;
  // The money lines the form's one block states, resolved here so the deposit
  // and course-fee arithmetic (src/lib/deposits.ts, src/lib/courses.ts) never
  // ships to the browser — the same reason `TripTerms` is a server component.
  const { courseFeeCents, eLearningFeeCents } = bookingCourseFees(trip);
  // **What this trip asks of anybody**, read for every visitor rather than only
  // for a diver who already holds a seat. `requirement` used to be fetched
  // inside the `confirmed` branch below and passed only into
  // `BookingConfirmation` — so a trip's cert gate was first stated *after* the
  // seat was bought, and a diver who could not clear it read "4 spots left",
  // paid, and found out at the dock (DOM-M6). A trip's requirement is a
  // property of the trip: it discloses nothing about any person, so it belongs
  // above the form.
  // (Both read in the wave above.)
  // Course sessions are left out on purpose: a course states its own admission
  // rule on its own page, and its itinerary's gate is deliberately *not* a
  // booking gate (src/lib/trip-admission.ts) — repeating the site's demand here
  // would read as a bar on the very students the course exists to create.
  const combinedRequirement = trip.course ? null : unionRequirements(requirement, siteRequirement);
  const requirementSentence = requirementSentenceFor(combinedRequirement, t, locale, knownDiver);

  const inPast = hasSailed(trip.startsAt, now);
  const logEntry = inPast ? undefined : { startsAt: trip.startsAt, isCourse: !!trip.course };

  // Where this departure stands against the head count it needs, if it named
  // one. A departure that already sailed has nothing conditional left to
  // promise; a cancelled one returned far above this line, at the `status`
  // check that renders `CancelledTripNotice` instead of the booking page.
  const minimumSeats = inPast ? ({ kind: "none" } as const) : minimumSeatsState(trip, trip.booked);
  const full = isFull(trip);
  const where = { shopSlug, isEmbed, locale, timeZone: shop.timezone };
  const offersAnotherBoat = !inPast && !trip.conditionsHold && !confirmed && !waitlistConfirmation;
  const alternatives = full ? fullTripAlternatives(trip, board, where) : [];
  const worthALookRows =
    full || !offersAnotherBoat ? [] : worthALookList(trip, board, { ...where, now });
  const remaining = spotsRemaining(trip);
  const errorMessage = error && isErrorCode(error) ? t(ERROR_MESSAGE_KEYS[error]) : undefined;
  const tripRef = { shopSlug, tripId, embed: isEmbed };

  // One `Event` for this departure, on the canonical standalone page only —
  // the embed points its canonical here, so emitting the same graph at both
  // URLs would be the duplication the canonical exists to resolve (docs ADR
  // 20260729-booking-page-structured-data). The shop's rating rides along as
  // the organizer's `aggregateRating`.
  const structuredData = isEmbed
    ? null
    : departureJsonLd(shop, trip, perDiverPriceCents, reviewAggregate);

  const conditionsLine = (
    <ConditionsLine
      shop={shop}
      trip={trip}
      crewPrediction={crewPrediction}
      automatedForecast={automatedForecast}
      crewLanguages={crewLanguagesLine}
      locale={locale}
      readerUnits={readerUnits}
    />
  );

  const dayPlan = (
    <div
      className={isEmbed ? "space-y-4" : "mt-10 space-y-4 lg:mt-0 lg:col-start-1 lg:row-start-2"}
    >
      <TripDayPlan
        briefings={diveBriefings}
        nextOpensOnRule={pitchOpensOnDoor(diveBriefings, publicCrew, !!logEntry)}
        sightings={briefing.seen}
        siteReviews={briefing.siteReviews}
        shop={shop}
        locale={locale}
        profile={dayProfileFacts(shop, trip, meetingDays.length, readerUnits.depth)}
      />
      {!isEmbed ? <TripBoatPhoto db={db} shopId={shop.id} boatId={trip.boatId} t={t} /> : null}
    </div>
  );

  return (
    <DiverIntlProvider locale={locale} timeZone={shop.timezone} namespaces={TRIP_PAGE_NAMESPACES}>
      <main
        className={
          isEmbed
            ? "w-full flex-1 px-3 py-4"
            : "mx-auto w-full max-w-xl flex-1 px-4 py-8 sm:px-6 sm:py-10 lg:max-w-5xl"
        }
      >
        {structuredData ? <JsonLd data={structuredData} /> : null}
        <FlashParams params={["error", "pay"]} />
        {/* **Two columns from `lg` up.** At 1280 the column was 528px wide and
            the form stood 1,500px down, the last thing a diver reached. From
            `lg` the form and the contact line take a 25rem right-hand column
            level with the title, and the hero and the reading run down the
            left at the 528px they always had, so nothing in them (the pitch's
            tiles, their `sizes`) changes width. The section stack below joins
            this grid as `contents`; its last row is `1fr`, so a form taller
            than the reading stretches that row rather than the gaps between
            sections. A phone reads the compact itinerary before the booking fields;
            supporting wildlife and site prose stay below (public audit P2, #3140). */}
        <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_25rem] lg:grid-rows-[auto_repeat(4,auto)_1fr] lg:gap-x-12 lg:gap-y-10">
          <TripHero
            shop={shop}
            trip={trip}
            meetingDays={meetingDays}
            locale={locale}
            isEmbed={isEmbed}
            shopSlug={shopSlug}
            coverPhoto={coverPhoto}
            minimumSeats={minimumSeats}
            run={run}
            t={t}
          />
          {!isEmbed ? dayPlan : null}
          {/* The selected departure’s next action, after the compact day plan. */}
          <div
            id={confirmed || waitlistConfirmation ? undefined : "book"}
            className="mt-10 scroll-mt-4 space-y-10 lg:mt-0 lg:col-start-2 lg:row-span-6 lg:row-start-1"
          >
            {confirmed ? null : conditionsLine}
            {confirmed && bookingToken ? (
              <EmbedBookedNotice
                shop={shop}
                shopSlug={shopSlug}
                locale={locale}
                trip={trip}
                confirmed={confirmed}
                readinessLink={readinessDoorPath(shopSlug, tripId, bookingToken)}
                mailState={mailState}
                payNotice={pay}
                paymentUrl={paymentUrl}
              />
            ) : waitlistConfirmation ? (
              <WaitlistConfirmation
                firstName={(waitlistConfirmation.person?.fullName ?? "").split(" ")[0]}
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
                trip={bookingFormTrip(trip)}
                tripRef={tripRef}
                withAnchor={false}
                errorMessage={errorMessage}
                alternatives={alternatives}
                offerWaitlist={shop.waitlistEnabled}
                requirement={requirementSentence}
                terms={<BookingFinePrint shop={shop} trip={trip} locale={locale} />}
              />
            ) : (
              <BookSpotSection
                context={{
                  trip: bookingFormTrip(trip),
                  withAnchor: false,
                  tripRef,
                  remaining,
                  errorMessage,
                  payAtBooking: payAtBooking && checkoutMode(stripeAccount),
                  offerCodeField,
                  perDiverPriceCents,
                  currency: shopCurrency,
                  locale,
                  timeZone: shop.timezone,
                  rentalItems: shop.rentalItems,
                  rentalPricing: shop.rentalPricing,
                  passThroughFee: parsePassThroughFee(shop.passThroughFee),
                  taxEnabled: shop.taxEnabled,
                  deskPayment: shop.deskPayment,
                  courseFeeCents,
                  eLearningFeeCents,
                  ...checkoutSeatTerms(trip, trip.course),
                  balanceDueAt: trip.startsAt,
                  terms: <BookingFinePrint shop={shop} trip={trip} locale={locale} />,
                  knownDiver: knownDiverPanel,
                  requirement: requirementSentence,
                  offerHandoff: offerHandoff.bind(null, tripRef),
                }}
              />
            )}
            {/* The last line on the page: how to reach a human. Renders nothing at
                  all when the shop has published neither a phone nor an address. */}
            {shop.contactPhone || shop.contactEmail ? (
              <p className="flex flex-wrap items-baseline gap-x-2 text-sm text-muted">
                {t("trip.questionsContact")}
                <ShopContactLinks phone={shop.contactPhone} email={shop.contactEmail} />
              </p>
            ) : null}
          </div>
          <div className="mt-10 space-y-10 lg:contents lg:space-y-0">
            {isEmbed ? dayPlan : null}
            {/* **The bound** (ADR 20260904-reef-all-the-way-down, decision 1). The
                route, the rest of the field guide, the shop's
                site prose and the crew used to run down the page as five more
                beats — 5,782px at 390 before a diver was offered a seat. They are
                all still here, in this order, behind `TripPitch`'s one door. A
                feature that wants to sell harder opens that door; it does not add
                a section, and `page.composition.test.ts` is what says so. */}
            {/* The pitch and the conditions line, one block of the stack. Under
                the pitch's door the line sits flush, so its rule is the door's
                close rather than a second rule a gap below it; with no door the
                two stand a section apart. An empty block takes no room: its
                margins collapse through it. */}
            <div>
              <TripPitch
                briefings={diveBriefings}
                crew={publicCrew}
                locale={locale}
                timeZone={shop.timezone}
                logEntry={logEntry}
                embed={isEmbed}
              />
            </div>
            {confirmed ? conditionsLine : null}
            <TripChangeLedger
              events={changeEvents}
              locale={locale}
              timeZone={shop.timezone}
              revealArrivalDetails={false}
            />
            {confirmed &&
            conditionsChangedSinceBooking(
              trip.conditionsUpdatedAt,
              confirmed.booking.conditionsBriefedAt,
            ) ? (
              <ConditionsChangedNotice locale={locale} />
            ) : null}
            <TripAlternatives alternatives={worthALookRows} locale={locale} />
          </div>
        </div>
        {/* Full keeps the same sticky CTA rather than hiding it — a diver who
            scrolls to a full boat still has one obvious next step (the wait
            list), not a dead-ended thumb (task 12). Both destinations share
            the `#book` anchor: `BookSpotSection` and `TripFullSection`'s
            wait-list form each carry it. */}
        {!confirmed && !inPast && !trip.conditionsHold ? (
          <PhoneFootBar href="#book">
            {t(full ? fullFootLabel(shop) : "booking.bookVerb")}
          </PhoneFootBar>
        ) : null}
      </main>
    </DiverIntlProvider>
  );
}
