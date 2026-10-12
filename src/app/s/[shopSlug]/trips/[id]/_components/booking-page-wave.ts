import { cache } from "react";
import type { AppDb } from "@/db/client";
import { getDb } from "@/db/client";
import { listDiveSiteBriefingExtras } from "@/db/dive-sites";
import { bookingConfirmationAndWaiverEmailsSent } from "@/db/notifications";
import { getTripRequirements, getTripSiteRequirement } from "@/db/readiness";
import { tripMayTakeACode } from "@/db/shop-promos";
import { canAcceptPayments, getShopStripeAccount } from "@/db/stripe-accounts";
import { listTripChangeEvents } from "@/db/trip-change-events";
import { siteSightings } from "@/db/trip-sightings";
import { getTripWithBooked, pagedUpcomingTripsWithCounts } from "@/db/trips";
import { publicAppUrl } from "@/lib/notifications";

/**
 * **The departure, read once per render** (code review 2026-10-11, item 2):
 * `generateMetadata` and the page body both need the row, and two calls to
 * `getTripWithBooked` were two statements for one fact. Keyed on the shop id and
 * the trip id, request-scoped like `shopBySlugCached`.
 */
export const publicTripRecord = cache(async (shopId: string, tripId: string) =>
  getTripWithBooked(await getDb(), shopId, tripId),
);

/**
 * **Every read the public booking page has left, in one wave** (code review
 * 2026-10-11, item 2). Each takes only the shop, the trip or the departure's
 * sites, all in hand after the page's fan-out, so none waits on another; they
 * used to be eight awaits one after another, on the page a stranger loads
 * most. A read that depends on another — the emails behind the confirmation,
 * the code gate behind the Stripe account, the board behind whether this visit
 * booked — is chained inside the wave rather than awaited before it.
 *
 * The three gated reads (the embed's `confirm` capability, the handoff, the
 * waitlist entry) and the review aggregate arrive already started: their gates
 * live in the page, where its composition test pins them.
 */
export async function readBookingPageWave<
  Booked extends { booking: { id: string } } | null,
  Waitlisted,
  Known,
  Aggregate,
>(
  db: AppDb,
  input: {
    shopId: string;
    tripId: string;
    conditionsHold: boolean;
    siteIds: string[];
    payablePerDiverCents: number | null;
    inPast: boolean;
    now: Date;
    confirmedRead: Promise<Booked>;
    waitlistRead: Promise<Waitlisted>;
    knownDiverRead: Promise<Known>;
    reviewAggregateRead: Promise<Aggregate> | null;
  },
) {
  const { shopId, tripId, siteIds, payablePerDiverCents, confirmedRead, waitlistRead } = input;
  const [
    knownDiver,
    confirmed,
    waitlistConfirmation,
    emailsOnTheWay,
    changeEvents,
    briefingExtras,
    seenBySite,
    { stripeAccount, payAtBooking, offerCodeField },
    [requirement, siteRequirement],
    board,
    reviewAggregate,
  ] = await Promise.all([
    input.knownDiverRead,
    confirmedRead,
    waitlistRead,
    // The embed's short confirmation needs exactly one fact beyond the booking
    // itself: whether both emails went.
    confirmedRead.then((booked) =>
      booked ? bookingConfirmationAndWaiverEmailsSent(db, shopId, booked.booking.id) : false,
    ),
    listTripChangeEvents(db, shopId, tripId),
    // Two queries for the whole day's briefings, not two per dive.
    listDiveSiteBriefingExtras(db, shopId, siteIds),
    // What the crew has actually logged at those sites this month, batched over
    // the whole day for the same reason: a query per site per departure is how
    // a public page becomes slow.
    siteSightings(db, shopId, siteIds),
    // Pay-at-booking is offered only when the shop's own Stripe account can
    // take a charge, the trip carries a price, and a canonical origin exists
    // for the return links; otherwise the flow is book-now-pay-later.
    (payablePerDiverCents ? getShopStripeAccount(db, shopId) : Promise.resolve(null)).then(
      async (account) => {
        const payable = Boolean(
          payablePerDiverCents && canAcceptPayments(account) && publicAppUrl(),
        );
        return {
          stripeAccount: account,
          payAtBooking: payable,
          offerCodeField: payable ? await tripMayTakeACode(db, { shopId, tripId }) : false,
        };
      },
    ),
    Promise.all([
      getTripRequirements(db, shopId, tripId),
      getTripSiteRequirement(db, shopId, tripId),
    ]),
    Promise.all([confirmedRead, waitlistRead]).then(async ([booked, waitlisted]) =>
      input.inPast || input.conditionsHold || booked || waitlisted
        ? []
        : (
            await pagedUpcomingTripsWithCounts(db, shopId, {
              now: input.now,
              limit: 50,
              hasSpace: true,
              publicOnly: true,
            })
          ).trips,
    ),
    input.reviewAggregateRead,
  ]);
  return {
    knownDiver,
    confirmed,
    waitlistConfirmation,
    emailsOnTheWay,
    changeEvents,
    briefingExtras,
    seenBySite,
    stripeAccount,
    payAtBooking,
    offerCodeField,
    requirement,
    siteRequirement,
    board,
    reviewAggregate,
  };
}
