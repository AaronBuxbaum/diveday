import { cache } from "react";
import { verifyBookingCapability } from "@/db/booking-capabilities";
import { readKnownDiver } from "@/db/booking-handoff";
import { getBookingForTrip } from "@/db/bookings";
import { getLatestCheckoutForBooking } from "@/db/checkouts";
import { type AppDb, getDb } from "@/db/client";
import { listDiveSiteBriefingExtras } from "@/db/dive-sites";
import { bookingConfirmationMailState } from "@/db/notifications";
import {
  getTripRequirements,
  getTripSiteRequirement,
  tripRequirementSummaries,
} from "@/db/readiness";
import { getShopReviewAggregate } from "@/db/reviews";
import { tripMayTakeACode } from "@/db/shop-promos";
import type { shopBySlugCached } from "@/db/shops-cached";
import { canAcceptPayments, getShopStripeAccount } from "@/db/stripe-accounts";
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
import type { auth } from "@/lib/auth";
import { perDiverBookingPriceCents } from "@/lib/courses";
import { publicAppUrl } from "@/lib/notifications";
import { parsePassThroughFee } from "@/lib/pass-through-fee";
import type { SiteCertRequirement } from "@/lib/readiness";
import { isLiveShopStaff } from "@/lib/session";
import { hasSailed, seatsOnSale } from "@/lib/trips";

/** The trip the page hands its client booking form, projected (`booking-form-trip.ts`). */
export { bookingFormTrip } from "./booking-form-trip";

/**
 * **The departure, read once per render** (code review 2026-10-11, item 2):
 * `generateMetadata` and the page body both need the row, and two calls to
 * `getTripWithBooked` were two statements for one fact. Keyed on the shop id and
 * the trip id, request-scoped like `shopBySlugCached`.
 */
export const publicTripRecord = cache(async (shopId: string, tripId: string) =>
  getTripWithBooked(await getDb(), shopId, tripId),
);

type Shop = NonNullable<Awaited<ReturnType<typeof shopBySlugCached>>>;

/** One departure of the shop's board, with what it asks of anybody. */
type BoardDeparture = Awaited<ReturnType<typeof pagedUpcomingTripsWithCounts>>["trips"][number] & {
  requirement: SiteCertRequirement | null;
};

/** What the request asked this page for, already narrowed by the page. */
export type TripPageRequest = {
  tripId: string;
  isEmbed: boolean;
  bookingToken: string | undefined;
  waitlistId: string | undefined;
  handoffToken: string | null;
  /** `?pay=due`: the embed's confirmation links the booking's open checkout. */
  payDue: boolean;
  /** Started by the page, never awaited before the wave: the live-staff check chains off it. */
  session: ReturnType<typeof auth>;
  now: Date;
};

/**
 * **Everything the public trip page reads after the shop**, sent as one wave.
 * Lifted out of `page.tsx` so the route stays a renderer; the page owns what
 * each answer means, and this owns only when each one is asked.
 */
export async function readTripPage(
  db: AppDb,
  shop: Shop,
  {
    tripId,
    isEmbed,
    bookingToken,
    waitlistId,
    handoffToken,
    payDue,
    session,
    now,
  }: TripPageRequest,
) {
  // **Every read this page makes is one wave** (issue #2353). A read that
  // needs another's answer chains off that one promise inside the wave — the
  // booking off its verified capability, the briefings off the day's dives,
  // the payment account and the other boats off the trip — rather than
  // waiting for the whole wave before it. A cancelled departure, which renders
  // its own notice below, pays for the wave like any other; it is the rare
  // visit, and every booking visit used to pay a dozen round trips for it.
  // Seats on sale are capped at the boat's certificate (#2321).
  const tripRead = publicTripRecord(shop.id, tripId).then((row) => row && seatsOnSale(row));
  const tripDivesRead = listTripDives(db, shop.id, tripId);
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
  const confirmedRead =
    isEmbed && bookingToken
      ? verifyBookingCapability(db, { token: bookingToken, purpose: "confirm" }).then(
          (capability) =>
            capability ? getBookingForTrip(db, shop.id, tripId, capability.bookingId) : null,
        )
      : Promise.resolve(null);
  const waitlistRead = waitlistId
    ? getWaitlistEntryForTrip(db, shop.id, tripId, waitlistId)
    : Promise.resolve(null);
  const [
    staffPreview,
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
  ] = await Promise.all([
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
    !isEmbed && session.then((reader) => isLiveShopStaff(db, shop.id, reader)),
    tripRead,
    tripDivesRead,
    // Shop-scoped by the query's own join on `trips.shop_id`, like every other
    // read on this page. A departure always has at least one of these rows.
    listTripScheduleDays(db, shop.id, tripId),
    tripCrewSpokenLanguages(db, shop.id, tripId),
    // Only the crew who said yes (issue #1181, D21). Empty for every shop that
    // has switched nothing on, which is every shop until somebody does.
    tripPublicCrew(db, shop.id, tripId),
    listTripChangeEvents(db, shop.id, tripId),
    // **The door remembers who opened it** (ADR 20260906-before-you-ask,
    // decision 3). Facts reach this page through a handoff and nothing else: a
    // cold request, an embed, and an unverifiable token all read as null, and
    // null renders the form that ships. The facts are worded below, where the
    // locale and the shop's zone are, and reach the client as sentences.
    handoffToken && !isEmbed ? readKnownDiver(db, { shopId: shop.id, token: handoffToken }) : null,
    confirmedRead,
    waitlistRead,
    // Two queries for the whole day's briefings, not two per dive — and what
    // the crew has actually logged at those sites this month, batched over the
    // whole day for the same reason: this is a public page, and a query per
    // site per departure is how one becomes slow.
    tripDivesRead.then(async (dives) => {
      const siteIds = dives
        .map(({ diveSite }) => diveSite?.id)
        .filter((id): id is string => Boolean(id));
      const [extras, seen] = await Promise.all([
        listDiveSiteBriefingExtras(db, shop.id, siteIds),
        siteSightings(db, shop.id, siteIds),
      ]);
      return { extras, seen };
    }),
    // **What this trip asks of anybody**, read for every visitor rather than
    // only for a diver who already holds a seat (DOM-M6; see the note where
    // it is combined below).
    getTripRequirements(db, shop.id, tripId),
    getTripSiteRequirement(db, shop.id, tripId),
    // Pay-at-booking is offered only when the shop's own Stripe account can
    // take a charge, the trip carries a price, and a canonical origin exists
    // for the return links; otherwise the flow is book-now-pay-later as before.
    tripRead.then(async (found) => {
      if (!found) return { stripeAccount: null, payAtBooking: false, offerCodeField: false };
      const passThrough = parsePassThroughFee(shop.passThroughFee);
      const perDiver = perDiverBookingPriceCents(found, found.course);
      const payable = perDiver === null ? null : perDiver + (passThrough?.amountCents ?? 0);
      const account = payable ? await getShopStripeAccount(db, shop.id) : null;
      const pays = Boolean(payable && canAcceptPayments(account) && publicAppUrl());
      return {
        stripeAccount: account,
        payAtBooking: pays,
        offerCodeField: pays
          ? await tripMayTakeACode(db, { shopId: shop.id, tripId: found.id })
          : false,
      };
    }),
    // Only say mail is on its way when it actually went, and name the waiver
    // only when the confirmation carried one (UX review 2026-10-11, item 7).
    confirmedRead.then((booked) =>
      booked ? bookingConfirmationMailState(db, shop.id, booked.booking.id) : ("none" as const),
    ),
    // The checkout a `?pay=due` confirmation links to, chained off the
    // verified booking inside the wave rather than awaited in the JSX after
    // it (code review 2026-10-13, item 29).
    confirmedRead.then(async (booked) =>
      payDue && booked
        ? ((await getLatestCheckoutForBooking(db, shop.id, booked.booking.id))?.checkoutUrl ?? null)
        : null,
    ),
    // One read of the shop's own board, feeding both lists of other boats
    // below (issues #1166 and #1161), and only when one could show.
    //
    // Each departure carries what it asks of anybody (its gate folded with
    // its sites'), and the read boat's own rides as `ceiling`, so neither list
    // offers a boat that asks more than this one (fourth UX review, item 10).
    Promise.all([tripRead, confirmedRead, waitlistRead]).then(
      async ([found, booked, waiting]): Promise<{
        departures: BoardDeparture[];
        ceiling: SiteCertRequirement | null;
      }> => {
        if (!found || hasSailed(found.startsAt, now) || found.conditionsHold || booked || waiting) {
          return { departures: [], ceiling: null };
        }
        const departures = (
          await pagedUpcomingTripsWithCounts(db, shop.id, {
            now,
            limit: 50,
            hasSpace: true,
            publicOnly: true,
          })
        ).trips.map(seatsOnSale);
        const asks = await tripRequirementSummaries(db, shop.id, [
          found.id,
          ...departures.map((departure) => departure.id),
        ]);
        return {
          departures: departures.map((departure) => ({
            ...departure,
            requirement: asks.get(departure.id) ?? null,
          })),
          ceiling: asks.get(found.id) ?? null,
        };
      },
    ),
    // The shop's rating rides along as the organizer's `aggregateRating` in
    // the standalone page's structured data.
    isEmbed || !shop.reviewsEnabled ? null : getShopReviewAggregate(db, shop.id),
  ]);
  return {
    staffPreview,
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
  };
}
