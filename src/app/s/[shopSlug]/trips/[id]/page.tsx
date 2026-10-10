import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { FlashParams } from "@/components/FlashParams";
import { JsonLd } from "@/components/JsonLd";
import { PhoneFootBar } from "@/components/PhoneFootBar";
import { ShopContactLinks } from "@/components/ShopContactLinks";
import { DiveDayIcon } from "@/components/StaffDestinationIcon";
import { StoredPhoto } from "@/components/StoredPhoto";
import { TripChangeLedger } from "@/components/TripChangeLedger";
import { TONE_PANEL_CLASS, TONE_PANEL_LG_CLASS } from "@/components/ui/card";
import { verifyBookingCapability } from "@/db/booking-capabilities";
import { readKnownDiver } from "@/db/booking-handoff";
import { getBookingForTrip } from "@/db/bookings";
import { getLatestCheckoutForBooking } from "@/db/checkouts";
import { getDb } from "@/db/client";
import { listDiveSiteBriefingExtras } from "@/db/dive-sites";
import { bookingConfirmationAndWaiverEmailsSent } from "@/db/notifications";
import { getTripRequirements, getTripSiteRequirement } from "@/db/readiness";
import { getShopReviewAggregate } from "@/db/reviews";
import { tripMayTakeACode } from "@/db/shop-promos";
import { shopBySlugCached } from "@/db/shops-cached";
import { canAcceptPayments, checkoutMode, getShopStripeAccount } from "@/db/stripe-accounts";
import { listTripChangeEvents } from "@/db/trip-change-events";
import { siteSightings } from "@/db/trip-sightings";
import {
  getTripWithBooked,
  getWaitlistEntryForTrip,
  listTripDives,
  listTripScheduleDays,
  pagedUpcomingTripsWithCounts,
  tripCrewSpokenLanguages,
  tripPublicCrew,
} from "@/db/trips";
import { DiverIntlProvider } from "@/i18n/DiverIntlProvider";
import { languageEndonymList } from "@/i18n/language-labels";
import { fieldGuideCards } from "@/i18n/marine-life-labels";
import { diverTranslator } from "@/i18n/messages";
import { DIVER_CERT_LEVEL_KEYS } from "@/i18n/next-dive-labels";
import { tripRequirementList } from "@/i18n/readiness-labels";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { auth } from "@/lib/auth";
import { nowDate } from "@/lib/clock";
import { courseCharges, perDiverBookingPriceCents } from "@/lib/courses";
import { checkoutSeatTerms } from "@/lib/deposits";
import { conditionsChangedSinceBooking } from "@/lib/diver-planning";
import { formatDateTimeTz, formatDayParts, formatShortDate, formatTime } from "@/lib/format";
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
import { similarDepartures } from "@/lib/similar-departures";
import { openGraphSite, shopSearchListingRobots } from "@/lib/site-metadata";
import { tripPageJsonLd } from "@/lib/structured-data";
import { hasSailed, isFull, spotsRemaining } from "@/lib/trips";
import { uuidParam } from "@/lib/uuid";
import { worthALook } from "@/lib/worth-a-look";
import { BookingFinePrint } from "./_components/BookingFinePrint";
import {
  BookSpotSection,
  CancelledTripNotice,
  ConditionsHoldSection,
  TripFullSection,
  TripSailedNotice,
  WaitlistConfirmation,
} from "./_components/BookingSections";
import { ConditionsLine } from "./_components/ConditionsLine";
import { EmbedBookedNotice } from "./_components/EmbedBookedNotice";
import { StaffPreviewBar } from "./_components/StaffPreviewBar";
import { TripActions } from "./_components/TripActions";
import { TripAlternatives } from "./_components/TripAlternatives";
import { dayCoverPhoto, TripDayPlan } from "./_components/TripDayPlan";
import { TripHeader } from "./_components/TripHeader";
import { pitchHasDoor, pitchOpensOnDoor, TripPitch } from "./_components/TripPitch";
import { ERROR_MESSAGE_KEYS, isErrorCode } from "./_components/types";
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
  const db = await getDb();
  const shop = await shopBySlugCached(shopSlug);
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
    /** A diver's own handoff (ADR 20260906-before-you-ask, decision 3). */
    handoff?: string | string[];
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
    pay,
    embed,
    handoff: handoffParam,
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
  const [trip, tripDives, meetingDays, crewLanguages, publicCrew] = await Promise.all([
    getTripWithBooked(db, shop.id, tripId),
    listTripDives(db, shop.id, tripId),
    // Shop-scoped by the query's own join on `trips.shop_id`, like every other
    // read on this page. A departure always has at least one of these rows.
    listTripScheduleDays(db, shop.id, tripId),
    tripCrewSpokenLanguages(db, shop.id, tripId),
    // Only the crew who said yes (issue #1181, D21). Empty for every shop that
    // has switched nothing on, which is every shop until somebody does.
    tripPublicCrew(db, shop.id, tripId),
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
            isEmbed
              ? "w-full flex-1 px-3 py-4"
              : "mx-auto w-full max-w-xl flex-1 px-4 py-8 sm:px-6 sm:py-10"
          }
        >
          {staffPreviewBar}
          {/* The way back and the notice, a section apart: the page's
              `space-y-10`, never a margin on the notice (pixel-craft class
              4, K-162). */}
          <div className="space-y-10">
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
          </div>
        </main>
      </DiverIntlProvider>
    );
  }
  const crewLanguageNames = languageEndonymList(crewLanguages);
  const crewLanguagesLine =
    crewLanguageNames.length === 0
      ? null
      : cachedListFormat(locale, { style: "long", type: "conjunction" }).format(crewLanguageNames);
  const changeEvents = await listTripChangeEvents(db, shop.id, tripId);
  const crewPrediction = hasCrewPrediction(trip);
  const forecastPoint =
    trip.diveSite &&
    trip.diveSite.forecastLatitude !== null &&
    trip.diveSite.forecastLongitude !== null
      ? { latitude: trip.diveSite.forecastLatitude, longitude: trip.diveSite.forecastLongitude }
      : null;
  // **Started, never awaited here** (code review 2026-10-10, item 1): the
  // outlook waits on Open-Meteo, up to four seconds, so the conditions line
  // streams it in inside its own `<Suspense>` and the booking form never waits
  // for it. It never rejects: any provider failure answers null.
  const automatedForecast =
    !crewPrediction && forecastPoint && shouldShowAutomatedForecast(trip.startsAt)
      ? fetchAutomatedMarineForecast(forecastPoint, trip.startsAt)
      : Promise.resolve(null);
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
  // **The door remembers who opened it** (ADR 20260906-before-you-ask,
  // decision 3). Facts reach this page through a handoff and nothing else: a
  // cold request, an embed, and an unverifiable token all read as null, and
  // null renders the form that ships. The facts are worded here, where the
  // locale and the shop's zone are, and reach the client as sentences.
  const knownDiver =
    handoffToken && !isEmbed
      ? await readKnownDiver(db, { shopId: shop.id, token: handoffToken })
      : null;
  const knownDiverPanel = knownDiver
    ? {
        name: knownDiver.fullName,
        handoff: handoffToken ?? "",
        blankHref: `${publicTripPath(shopSlug, tripId)}#book`,
        lead: { fullName: knownDiver.fullName, email: knownDiver.email, phone: knownDiver.phone },
        lines: knownDiver.facts.map((fact) => {
          const on = (at: Date) => formatShortDate(at, locale, shop.timezone);
          switch (fact.kind) {
            case "card":
              return t("booking.knownDiver.card", {
                level: t(DIVER_CERT_LEVEL_KEYS[fact.level]),
                date: on(fact.keptAt),
              });
            case "waiver":
              return t("booking.knownDiver.waiver", { date: on(fact.keptAt) });
            case "own_gear":
              return t("booking.knownDiver.ownGear", { date: on(fact.keptAt) });
            case "sizes":
              return t("booking.knownDiver.sizes", { date: on(fact.keptAt) });
            case "contact":
              return t("booking.knownDiver.contact", { name: fact.name });
            default:
              return "";
          }
        }),
      }
    : null;
  const [confirmed, waitlistConfirmation] = await Promise.all([
    confirmCapability ? getBookingForTrip(db, tripId, confirmCapability.bookingId) : null,
    waitlistId ? getWaitlistEntryForTrip(db, shop.id, tripId, waitlistId) : null,
  ]);
  // Two queries for the whole day's briefings, not two per dive.
  const siteIds = tripDives
    .map(({ diveSite }) => diveSite?.id)
    .filter((id): id is string => Boolean(id));
  const briefingExtras = await listDiveSiteBriefingExtras(db, shop.id, siteIds);
  // What the crew has actually logged at those sites this month. Batched over
  // the whole day for the same reason the briefings are: this is a public page,
  // and a query per site per departure is how one becomes slow.
  const seenBySite = await siteSightings(db, shop.id, siteIds);
  const diveBriefings = tripDives.map(({ dive, diveSite }) => ({
    dive,
    diveSite,
    creatures: fieldGuideCards(
      diveSite ? (briefingExtras.creatures.get(diveSite.id) ?? []) : [],
      t,
    ),
    moments: diveSite ? (briefingExtras.moments.get(diveSite.id) ?? []) : [],
  }));
  const coverPhoto = dayCoverPhoto(diveBriefings);
  // The dock-day rhythm's inputs (per-site bottom times, per-leg travel) are
  // gone from this page with `PackingSection`: what to bring and when to be
  // there is preparation, and preparation belongs to the thread the diver
  // reaches after booking (ADR 20260827-the-divers-thread, decision 2).
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
  const offerCodeField = payAtBooking
    ? await tripMayTakeACode(db, { shopId: shop.id, tripId: trip.id })
    : false;
  // The money lines the form's one block states, resolved here so the deposit
  // and course-fee arithmetic (src/lib/deposits.ts, src/lib/courses.ts) never
  // ships to the browser — the same reason `TripTerms` is a server component.
  const courseBreakdown = trip.course
    ? courseCharges({
        title: trip.course.title,
        priceCents: trip.course.priceCents ?? trip.priceCents,
        eLearningPriceCents: trip.course.eLearningPriceCents,
      })
    : [];
  const courseFeeCents =
    courseBreakdown.find((line) => line.kind === "course_fee")?.amountCents ?? null;
  const eLearningFeeCents =
    courseBreakdown.find((line) => line.kind === "e_learning_fee")?.amountCents ?? null;
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
  // Who this trip is for: one line, no box, and the form's own first line (UX
  // audit #25), so it is read with the party-size control it governs rather
  // than floating above the card. It says only what the *trip* demands, never
  // anything about the reader, which is what makes it safe on an anonymous
  // page (DOM-M6), and nothing at all on a course session, whose own page
  // states its admission rule.
  const requirementSentence = requirementNote
    ? t("trip.requirementNote", { list: requirementNote })
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

  const now = nowDate();
  const inPast = hasSailed(trip.startsAt, now);
  // Where this departure stands against the head count it needs, if it named
  // one. A departure that already sailed has nothing conditional left to
  // promise; a cancelled one returned far above this line, at the `status`
  // check that renders `CancelledTripNotice` instead of the booking page.
  const minimumSeats = inPast ? ({ kind: "none" } as const) : minimumSeatsState(trip, trip.booked);
  const full = isFull(trip);
  /**
   * **What else this shop is running, for a boat with no seats left** (issue
   * #1166, D06). Read only when the trip is actually full: on every other
   * render this is a query nobody asked for, and the surface it feeds does not
   * exist.
   *
   * The candidate pool is the storefront's own schedule reader with
   * `hasSpace`, so a departure offered here is one a diver can actually get
   * onto, and a private charter is never offered to the public. Bounded at 50
   * rather than paged: `similarDepartures` needs a pool, not a page, and a
   * shop whose next matching departure is past the fiftieth is a shop the
   * "find another trip" link serves better anyway.
   */
  // One read of the shop's own board, feeding both lists. It used to run only
  // for a full boat; D01 asks the same question of a departure a diver can
  // still get on, and reading the schedule twice for two lists that are never
  // both on screen would be a query nobody asked for either way.
  const offersAnotherBoat = !inPast && !trip.conditionsHold && !confirmed && !waitlistConfirmation;
  const board = !offersAnotherBoat
    ? []
    : (
        await pagedUpcomingTripsWithCounts(db, shop.id, {
          now,
          limit: 50,
          hasSpace: true,
          publicOnly: true,
        })
      ).trips;
  const alternatives = full
    ? similarDepartures({
        full: { tripId: trip.id, courseId: trip.courseId, diveSiteId: trip.diveSiteId },
        candidates: board.map((candidate) => ({
          id: candidate.id,
          title: candidate.title,
          startsAt: candidate.startsAt,
          courseId: candidate.courseId,
          diveSiteId: candidate.diveSiteId,
        })),
      }).map((row) => ({
        tripId: row.tripId,
        title: row.title,
        reason: row.reason,
        // Preformatted in the shop's own zone, like every other date this page
        // hands a client component.
        when: formatDayParts(row.startsAt, locale, shop.timezone),
        href: `${publicTripPath(shopSlug, row.tripId)}${isEmbed ? "?embed=1" : ""}`,
      }))
    : [];
  /**
   * **The right departure, not just the next open seat** (issue #1161, D01).
   *
   * Only for a boat a diver can still get on: a full one already stands
   * `TripFullSection` with D06's own list, and two lists of other boats on one
   * page is exactly the accretion ADR 20260904-reef-all-the-way-down bounds.
   */
  const worthALookRows =
    full || !offersAnotherBoat
      ? []
      : worthALook({
          subject: {
            tripId: trip.id,
            courseId: trip.courseId,
            diveSiteId: trip.diveSiteId,
            difficultyLevel: trip.diveSite?.difficultyLevel ?? null,
            startsAt: trip.startsAt,
            seatsOpen: spotsRemaining(trip),
          },
          candidates: board.map((candidate) => ({
            tripId: candidate.id,
            title: candidate.title,
            courseId: candidate.courseId,
            diveSiteId: candidate.diveSiteId,
            difficultyLevel: candidate.diveSite?.difficultyLevel ?? null,
            startsAt: candidate.startsAt,
            seatsOpen: Math.max(candidate.capacity - candidate.booked, 0),
          })),
          timeZone: shop.timezone,
          now,
        }).map((row) => ({
          tripId: row.tripId,
          title: row.title,
          seatsOpen: row.seatsOpen,
          reason: row.reason,
          partOfDay: row.partOfDay,
          when: `${formatDayParts(row.startsAt, locale, shop.timezone).weekday} ${formatTime(row.startsAt, locale, shop.timezone)}`,
          href: `${publicTripPath(shopSlug, row.tripId)}${isEmbed ? "?embed=1" : ""}`,
        }));
  const remaining = spotsRemaining(trip);
  const errorMessage = error && isErrorCode(error) ? t(ERROR_MESSAGE_KEYS[error]) : undefined;
  const tripRef = { shopSlug, tripId, embed: isEmbed };

  // One `Event` for this departure, on the canonical standalone page only —
  // the embed points its canonical here, so emitting the same graph at both
  // URLs would be the duplication the canonical exists to resolve (docs ADR
  // 20260729-booking-page-structured-data). The shop's rating rides along as
  // the organizer's `aggregateRating`.
  const reviewAggregate =
    isEmbed || !shop.reviewsEnabled ? null : await getShopReviewAggregate(db, shop.id);
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
        "participants",
        "party",
        "rental",
        "trip",
      ]}
    >
      <main
        className={
          isEmbed
            ? "w-full flex-1 px-3 py-4"
            : "mx-auto w-full max-w-xl flex-1 px-4 py-8 sm:px-6 sm:py-10 lg:max-w-5xl"
        }
      >
        {structuredData ? <JsonLd data={structuredData} /> : null}
        <FlashParams params={["error", "pay"]} />
        {staffPreviewBar}
        {/* **Two columns from `lg` up.** At 1280 the column was 528px wide in a
            1280 window and the form stood about 1,500px down, the last thing
            a diver reached. From `lg` the form and the contact line take a
            25rem right-hand column level with the title, and the hero and the
            reading run down the left at the 528px they always had, so nothing
            in them (the pitch's tiles, their `sizes`) changes width. The
            section stack below joins this grid as `contents`; its last row
            is `1fr`, so a form taller than the reading stretches that row
            rather than the gaps between sections. A phone keeps the one
            column and the form terminal, as the source order does (ADR
            20260827-the-divers-thread, decision 2 and its 2026-10-03
            amendment). */}
        <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_25rem] lg:grid-rows-[auto_repeat(4,auto)_1fr] lg:gap-x-12 lg:gap-y-10">
          <div>
            {/* No standalone "← All trips" link: the header's own eyebrow is the
                way up outside the frame (2026-08-28 diver-views review, finding
                8 — see TripHeader). */}
            <TripHeader
              shop={shop}
              trip={trip}
              meetingDays={meetingDays}
              locale={locale}
              embed={isEmbed}
              showMeetingPoint={false}
            />
            {/* The hero's two conveniences, inside the hero rather than as a row of
                buttons under it. */}
            {isEmbed ? null : (
              <TripActions calendarUrl={publicTripCalendarPath(shopSlug, tripId)} />
            )}
            {/* The place, before the words about it: the day's first site
                photo (`dayCoverPhoto`). Decorative, as the site page's own
                cover is — the title and "The day" name the place. Not inside
                an embed, where the frame is a list-first window. */}
            {coverPhoto && !isEmbed ? (
              <StoredPhoto
                src={coverPhoto}
                alt=""
                className="mt-6 aspect-[3/2] w-full rounded-panel"
                sizes="(min-width: 640px) 33rem, 92vw"
                priority
              />
            ) : null}
            {/* The one warning panel this page ever wears — the same radius,
                border and tone as the conditions-changed panel below, on purpose.
                Two amber boxes with different radii and border weights read as two
                different systems warning about one weather call. Each is a card in
                a tone on its neighbour's inset. A hold replaces the booking form
                with plain type, so this banner never stands beside the form's
                card: the box beside it is the minimum-seats note directly under
                it, 16px in, so it takes the default tone panel (`TONE_PANEL_CLASS`),
                level with that note on a phone. */}
            {trip.conditionsHold ? (
              <div
                role="status"
                className={`mt-5 ${TONE_PANEL_CLASS} border-warning/40 bg-warning/10`}
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
              <p className="mt-5 rounded-inset bg-surface-sunken p-4 text-sm text-muted">
                {t("trip.minimumSeatsNotice", {
                  minimum: minimumSeats.minimum,
                  deadline: formatDateTimeTz(minimumSeats.decidesAt, locale, shop.timezone),
                })}
              </p>
            ) : null}
          </div>
          {/* **One rhythm below the hero** (pixel-craft class 4, K-162;
              forms-and-controls.md's section rhythm): every section from the
              day's run to the shop's contact line stands 40px from the next, on
              this `space-y-10`, and none carries a margin of its own. Each used
              to spell its own — `mt-6`, `mt-8`, `mt-10` — and the page's
              sections stood 24, 32 and 40px apart. */}
          <div className="mt-10 space-y-10 lg:contents lg:space-y-0">
            {/* **The pitch, then the ask.** Everything that answers "is this my
                day?" runs above the form, and nothing runs below it but the fine
                print it owns and the shop's own contact line. It read the other way
                round until 2026-08-28 — the form sat directly under the hero and
                roughly a thousand pixels of forecast, packing and briefings
                followed it — which put the page's one act in the middle of its own
                scroll (ADR 20260827-the-divers-thread, decision 2). Packing left
                for the thread entirely: what to bring is preparation, and
                preparation is for a diver who has a seat. */}
            {/* The shape of the day as well as its sites: how long each dive runs,
                how long the boat sits between two of them, and — once a reader
                names a card — which of the day's sites go deeper than that card
                covers. Facts the shop already publishes (issue #1479); the beat
                stays time-neutral, since durations promise no clock. */}
            {/* Its run closes itself, except over a pitch that opens on its
                door's own rule (pixel-craft class 6). */}
            <TripDayPlan
              briefings={diveBriefings}
              nextOpensOnRule={pitchOpensOnDoor(diveBriefings, publicCrew)}
              sightings={seenBySite}
              shop={shop}
              locale={locale}
              profile={{
                rhythm: shop,
                depthUnit: shop.depthUnit,
                diveMode: trip.diveMode,
                dayCount: meetingDays.length,
              }}
            />
            {/* **The bound** (ADR 20260904-reef-all-the-way-down, decision 1). The
                route, the rest of the field guide, the moments strip, the shop's
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
            <div className={pitchHasDoor(diveBriefings, publicCrew) ? undefined : "space-y-10"}>
              <TripPitch
                briefings={diveBriefings}
                crew={publicCrew}
                locale={locale}
                embed={isEmbed}
              />
              <ConditionsLine
                shop={shop}
                trip={trip}
                crewPrediction={crewPrediction}
                automatedForecast={automatedForecast}
                crewLanguages={crewLanguagesLine}
                locale={locale}
              />
            </div>
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
              // Only a booked diver sees this, and a booking renders the booked
              // moment on the `lg` rung below, so this panel is its `lg` twin.
              <section
                className={`${TONE_PANEL_LG_CLASS} border-warning/40 bg-warning/10`}
                role="status"
              >
                <h2 className="font-semibold">{t("trip.conditionsChangedHeading")}</h2>
                <p className="mt-1 text-sm text-muted">{t("trip.conditionsChangedBody")}</p>
              </section>
            ) : null}
            <TripAlternatives alternatives={worthALookRows} locale={locale} />

            {/* The form, terminal — or whichever state stands in its place —
                and the contact line under it: the right-hand column from `lg`. */}
            <div className="space-y-10 lg:col-start-2 lg:row-span-6 lg:row-start-1">
              {confirmed ? (
                <EmbedBookedNotice
                  shop={shop}
                  shopSlug={shopSlug}
                  locale={locale}
                  trip={trip}
                  confirmed={confirmed}
                  readinessLink={readinessLink}
                  emailsOnTheWay={emailsOnTheWay}
                  payNotice={pay}
                  paymentUrl={
                    pay === "due"
                      ? ((await getLatestCheckoutForBooking(db, shop.id, confirmed.booking.id))
                          ?.checkoutUrl ?? null)
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
                  contactEmail={shop.contactEmail}
                  contactPhone={shop.contactPhone}
                  alternatives={alternatives}
                  offerLastMinuteList={shop.lastMinuteListEnabled}
                  requirement={requirementSentence}
                  terms={<BookingFinePrint shop={shop} trip={trip} locale={locale} />}
                />
              ) : (
                <BookSpotSection
                  trip={trip}
                  tripRef={tripRef}
                  remaining={remaining}
                  errorMessage={errorMessage}
                  payAtBooking={payAtBooking && checkoutMode(stripeAccount)}
                  offerCodeField={offerCodeField}
                  perDiverPriceCents={perDiverPriceCents}
                  currency={shopCurrency}
                  locale={locale}
                  timeZone={shop.timezone}
                  contactEmail={shop.contactEmail}
                  contactPhone={shop.contactPhone}
                  rentalItems={shop.rentalItems}
                  rentalPricing={shop.rentalPricing}
                  passThroughFee={passThroughFee}
                  taxEnabled={shop.taxEnabled}
                  courseFeeCents={courseFeeCents}
                  eLearningFeeCents={eLearningFeeCents}
                  {...checkoutSeatTerms(trip, trip.course)}
                  balanceDueAt={trip.startsAt}
                  terms={<BookingFinePrint shop={shop} trip={trip} locale={locale} />}
                  knownDiver={knownDiverPanel}
                  requirement={requirementSentence}
                  offerHandoff={offerHandoff.bind(null, tripRef)}
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
          </div>
        </div>
        {/* Full keeps the same sticky CTA rather than hiding it — a diver who
            scrolls to a full boat still has one obvious next step (the wait
            list), not a dead-ended thumb (task 12). Both destinations share
            the `#book` anchor: `BookSpotSection` and `TripFullSection`'s
            wait-list form each carry it. */}
        {!confirmed && !inPast && !trip.conditionsHold ? (
          <PhoneFootBar href="#book">
            {full ? t("booking.waitlistHeading") : t("booking.bookVerb")}
          </PhoneFootBar>
        ) : null}
      </main>
    </DiverIntlProvider>
  );
}
