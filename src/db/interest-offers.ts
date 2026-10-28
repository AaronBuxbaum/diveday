import {
  and,
  eq,
  exists,
  gt,
  inArray,
  isNotNull,
  isNull,
  ne,
  not,
  notExists,
  notInArray,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { HOUR_MS, nowDate } from "@/lib/clock";
import { courseSeatCapacity } from "@/lib/course-ratios";
import { offerMailClass } from "@/lib/interests";
import { generateLastMinutePromoCode, lastMinuteDealDiscount } from "@/lib/last-minute-list";
import { minorToMajor } from "@/lib/money";
import {
  type NotificationDelivery,
  type NotificationProvider,
  publicAppUrl,
  recipientLocale,
} from "@/lib/notifications";
import { diverSeatLimit, seatRefusal } from "@/lib/participant-types";
import type { PromotionProvider } from "@/lib/payments/promotions";
import { type PromoDiscount, promoDiscountColumns } from "@/lib/promo-codes";
import { publicTripPath } from "@/lib/public-routes";
import { hasVerifiedCertificationAtLeast } from "@/lib/readiness";
import { SHOP_FEATURE_COLUMNS } from "@/lib/shop-features";
import { hasSailed, spotsRemaining } from "@/lib/trips";
import { courseStudentSeatCap, tripAdmissionFor, tripCourseCrewCounts } from "./bookings";
import type { AppDb, DbExecutor } from "./client";
import { issuePersonCourtesyEmailUnsubscribeToken } from "./courtesy-email";
import { listDateInterestsInReach } from "./interest-dates";
import {
  ensureDepartureInterest,
  issueInterestUnsubscribeToken,
  listAnytimeInterestsCovering,
} from "./interests";
import { sendNotification } from "./notifications";
import { recordTripActivity } from "./operations";
import {
  bookings,
  certifications,
  courses,
  type Interest,
  interests,
  people,
  shops,
  tripLastMinutePromos,
  trips,
} from "./schema";
import { getShopById } from "./shops";
import { canAcceptPayments, getShopCurrency, getShopStripeAccount } from "./stripe-accounts";
import { promotionProviderFromEnvironment } from "./stripe-providers";
import { livePerson, liveTrip } from "./trips-live";
import { heldSeatCounts, sellableCapacity } from "./trips-queries";
import { getTripWithBooked } from "./trips-record";

/**
 * **Offer a seat** (ADR 20261017-one-interest-with-a-scope): the one staff act on a
 * departure interest. It reserves nothing and never touches a manifest; the diver
 * books like anyone else from the link, so the booking door's own gates
 * (`readiness.ts`, `trip-admission.ts`) are untouched and an offer can never put
 * an uncleared diver aboard.
 */

/**
 * How one offer reached (or did not reach) the diver. Anything but `sent` hands
 * staff the composer fallback (a prewritten mailto or copy message) rather than
 * pretending mail went out. `opted_out` is a commercial offer to a diver who has
 * turned off courtesy email: no automated send, though staff may still reach
 * them by hand. `already_sent` is a commercial offer the 24-hour window refused.
 */
export type SeatOfferDelivery = "sent" | "fallback" | "opted_out" | "already_sent";

/** How long after its last email a commercial offer may not be emailed again (#2133). */
const OFFER_RESEND_WINDOW_MS = 24 * HOUR_MS;

const parentInterest = alias(interests, "parent_interest");

/**
 * The deal an offer carries into the email: the code, the figure, the shop's
 * currency (a fixed amount is typed in it) and when the code stops working. It
 * travels with the send rather than being read back off the interest, because the
 * promo row is still `pending` while the blast is going out.
 */
export type OfferDeal = {
  code: string;
  discount: PromoDiscount;
  currency: string;
  expiresAt: Date;
};

/** The shop-scoped interest, diver, departure and shop facts one offer needs. */
async function getOfferContext(db: AppDb, shopId: string, tripId: string, interestId: string) {
  const [row] = await db
    .select({
      interest: interests,
      parentScope: parentInterest.scope,
      parentClosedAt: parentInterest.closedAt,
      person: people,
      trip: trips,
      shop: shops,
    })
    .from(interests)
    .innerJoin(trips, and(eq(trips.id, interests.tripId), eq(trips.shopId, shopId), liveTrip()))
    .innerJoin(shops, eq(shops.id, shopId))
    .leftJoin(
      parentInterest,
      and(eq(parentInterest.id, interests.parentInterestId), eq(parentInterest.shopId, shopId)),
    )
    .leftJoin(people, and(eq(people.id, interests.personId), eq(people.shopId, shopId)))
    .where(
      and(
        eq(interests.id, interestId),
        eq(interests.scope, "departure"),
        eq(interests.shopId, shopId),
        eq(interests.tripId, tripId),
      ),
    )
    .limit(1);
  return row ?? null;
}

type OfferContext = NonNullable<Awaited<ReturnType<typeof getOfferContext>>>;

/** Who started a seat offer, when it was not the wait list itself (`deliverSeatOffer`). */
export type OfferInitiator = "shop" | "suggestion";

/**
 * **The Features switch a seat offer is the send of**, or null when a staffer
 * reached out themselves (review 2026-10-23, items 4 and 10). A past-diver
 * suggestion's invite is that switch's. A diver's own wait-list ask (their own
 * row, or one carried or rolled from another date) offered by the wait list
 * itself, the nightly roll or the "Who wants in" offer, is the wait list's. A
 * date request's reply and a last-minute list row are their own features'.
 */
function offerGovernedBy(
  initiatedBy: OfferInitiator | undefined,
  context: OfferContext,
): "waitlist" | "pastDiverInvites" | undefined {
  if (initiatedBy === "suggestion") return "pastDiverInvites";
  if (initiatedBy === "shop") return undefined;
  const waitListAsk =
    context.interest.askedBy === "diver" &&
    (context.parentScope === null || context.parentScope === "departure");
  return waitListAsk ? "waitlist" : undefined;
}

/**
 * Stamp one interest as offered and email the diver — as service mail or as
 * commercial mail, by `offerMailClass` (Aaron, 2026-10-06, issue #1953):
 *
 * - **What the diver asked for** is `seat_offer` (H-96's test, H-145 D-2
 *   option b): a seat on the departure whose wait list they joined, or the
 *   reply to their own date request. It reaches them whatever their
 *   courtesy-email setting, with no unsubscribe, and is not throttled.
 * - **Every other offer** (the shop's invitation, a carried or rolled row, the
 *   last-minute list, a deal) is `seat_offer_commercial`: it carries a fresh
 *   courtesy unsubscribe link (and with it the shop's postal footer) and is not
 *   sent to a person whose `people.courtesyEmailOptOutAt` is set. The unsubscribe
 *   token is keyed to a person, so a commercial offer to a row with no person
 *   is composer-only.
 *
 * The `offeredAt` stamp is written first in every case: "Offered" is the record
 * that staff reached out, by email or by hand.
 *
 * **A commercial offer is not emailed twice in a day** (Aaron, 2026-10-13, issue
 * #2133). Every send stamps a fresh `offeredAt`, and with it a new unsubscribe
 * token and idempotency key, so the window is held by its own mark, `emailedAt`:
 * a repeat inside `OFFER_RESEND_WINDOW_MS` of the last email is refused before
 * anything is written or sent (`already_sent`, and the composer fallback so
 * staff can still write by hand), and the window does not slide forward on a
 * refusal. The mark is read and taken under one row lock (`claimOfferSend`), so
 * two submits that land together send once, and it is given back when the mail
 * does not go (`releaseOfferSend`), so a failed send or a missing address never
 * locks the diver out.
 */
export async function deliverSeatOffer(
  db: AppDb,
  input: {
    shopId: string;
    shopSlug: string;
    tripId: string;
    interestId: string;
    /**
     * The run's date this interest waited for, when the nightly roll moved them
     * here: the offer says it filled and this date has room (fourth review,
     * item 31).
     */
    sailedStartsAt?: Date;
    /** The deal this offer carries, when it is the blast of one (`offerSeats`). */
    deal?: OfferDeal;
    /**
     * `"shop"` when a staffer reached out to this one diver themselves (a
     * direct invite, the course ladder, the no-show desk's "Email them this
     * date", a deal blast): the wait-list switch never refuses that, even when
     * the diver's row is a wait-list ask (`ensureDepartureInterest` reuses it).
     * `"suggestion"` for the invite a past-diver suggestion sends, governed by
     * that switch. Left out, the send is the wait list's own (the nightly roll,
     * the "Who wants in" offer) and the wait list's switch governs it.
     */
    initiatedBy?: OfferInitiator;
    now?: Date;
  },
  provider?: NotificationProvider,
): Promise<SeatOfferDelivery> {
  const context = await getOfferContext(db, input.shopId, input.tripId, input.interestId);
  if (!context) return "fallback";
  // The switch this send belongs to, if any, is asked before anything is
  // stamped, and rides on the queued mail so a retry asks it again.
  const governedBy = offerGovernedBy(input.initiatedBy, context);
  if (governedBy && !context.shop[SHOP_FEATURE_COLUMNS[governedBy]]) return "fallback";
  const send = { ...input, governedBy };
  const mailClass = offerMailClass({
    scope: context.interest.scope,
    askedBy: context.interest.askedBy,
    parentScope: context.parentScope,
    carriesDeal: context.interest.promoId !== null,
  });
  if (mailClass === "commercial") {
    const claim = await claimOfferSend(db, input.shopId, input.interestId, input.now);
    if (!claim) return "already_sent";
    return sendClaimedOffer(db, send, context, claim, provider);
  }
  const offeredAt = input.now ?? nowDate();
  const [stamped] = await db
    .update(interests)
    .set({ offeredAt })
    .where(and(eq(interests.id, input.interestId), eq(interests.shopId, input.shopId)))
    .returning({ id: interests.id });
  if (!stamped) return "fallback";
  return (await sendOffer(db, send, context, offeredAt, provider)).delivery;
}

/** What the deal a held offer carried did: sent under a code, or why nothing went. */
export type SeatOfferDealOutcome =
  | { ok: true; promoId: string; code: string; recipientCount: number }
  | {
      ok: false;
      reason:
        | "invalid_discount"
        | "trip_unavailable"
        | "trip_full"
        | "not_connected"
        | "no_recipients"
        | "stripe_failed";
    };

export type SeatOffersOutcome = {
  results: { interestId: string; delivery: SeatOfferDelivery }[];
  /** Present only when the offer carried a discount. */
  deal?: SeatOfferDealOutcome;
};

/** The discount a held offer carries: a percent, or a fixed amount in minor units. */
export type SeatOfferDiscount = { percent: number } | { amountCents: number };

/**
 * **The held send's body**: offer a seat to each interest staff ticked, one email
 * apiece. One interest never fails the rest: each answers for itself, and anything
 * but `sent` is the composer fallback on that row. Every interest is read inside
 * this shop, so an id from another shop is `fallback` and nothing is written.
 *
 * A **departure** interest is offered as it stands. An **anytime** interest (the
 * last-minute list) is first copied to a departure row of this trip
 * (`parent_interest_id` pointing back), because every offer is a departure row; only
 * the interests that clear `listAnytimeInterestsCovering`'s below-the-bar filter and
 * whose stated dates cover the day are offered at all, whatever was posted.
 *
 * **With a discount, this is the deal** (ADR 20260727-last-minute-fill-promos).
 * It fails closed on anything ambiguous: a full, past or rehearsal departure, a
 * shop that cannot take payments, or a Stripe error, and then nothing is sent.
 * The promo row is written `pending` before either Stripe call, the departure
 * rows (each with `promo_id`) only after Stripe has minted the code, and the
 * mail only after those. A diver whose row already took the 24-hour cold-send
 * window is skipped rather than failing the blast, and is not given the code.
 */
export async function offerSeats(
  db: AppDb,
  input: {
    shopId: string;
    shopSlug: string;
    tripId: string;
    interestIds: string[];
    discount?: SeatOfferDiscount;
    createdByPersonId?: string;
  },
  provider?: NotificationProvider,
  promotions: PromotionProvider = promotionProviderFromEnvironment(),
): Promise<SeatOffersOutcome> {
  const interestIds = [...new Set(input.interestIds)];
  const tripRow = await getTripWithBooked(db, input.shopId, input.tripId);
  // Read when the held send fires, not when it was held (dive-domain review of
  // #2656, m3): a departure cancelled, held for conditions, gone or made a
  // rehearsal during the hold offers nobody, with or without a deal, and
  // nothing is stamped. "Gone" is `hasSailed`, the booking transaction's own
  // gate, not the scheduled minute: a seat the counter released as the boat
  // loads is still the shop's to sell, and offering it to the wait list is
  // the no-show salvage (`salvageOffer`).
  const offerable =
    tripRow !== null &&
    !tripRow.isRehearsal &&
    tripRow.status === "scheduled" &&
    !tripRow.conditionsHold &&
    !hasSailed(tripRow.startsAt, nowDate());
  if (!offerable && !input.discount) {
    return {
      results: interestIds.map((interestId) => ({ interestId, delivery: "fallback" as const })),
    };
  }
  const found =
    tripRow && !tripRow.isRehearsal
      ? await db
          .select()
          .from(interests)
          .where(and(eq(interests.shopId, input.shopId), inArray(interests.id, interestIds)))
      : [];
  const byId = new Map(found.map((interest) => [interest.id, interest]));

  // The anytime interests a bulk offer may reach: dates covering the day, an address,
  // and the below-the-bar filter. Anything else posted is not offered.
  const eligibleAnytime = new Set<string>();
  if (tripRow && found.some((interest) => interest.scope === "anytime")) {
    const covering = await listAnytimeInterestsCovering(db, input.shopId, {
      id: tripRow.id,
      startsAt: tripRow.startsAt,
      course: tripRow.course ?? null,
    });
    for (const { interest } of covering.eligible) eligibleAnytime.add(interest.id);
  }
  // A date interest is offered only while it is open and within reach of this
  // departure's day (`listDateInterestsInReach`, the panel's own read).
  const inReachDate = new Set<string>();
  if (tripRow && found.some((interest) => interest.scope === "date")) {
    for (const row of await listDateInterestsInReach(db, input.shopId, { tripId: tripRow.id })) {
      inReachDate.add(row.id);
    }
  }
  // Nobody already holding a seat on this departure is offered one, whatever id
  // was posted: the panel hides them, and the server does not rely on it.
  const aboard = new Set(tripRow ? await seatedPersonIds(db, input.shopId, tripRow.id) : []);
  const targets = interestIds.filter((id) => {
    const interest = byId.get(id);
    if (!interest || (interest.personId && aboard.has(interest.personId))) return false;
    if (interest.scope === "anytime") return eligibleAnytime.has(id);
    if (interest.scope === "date") return inReachDate.has(id);
    return interest.scope === "departure" && interest.tripId === input.tripId;
  });

  if (!input.discount) {
    return {
      results: await deliverTargets(db, input, interestIds, targets, byId, undefined, provider),
    };
  }

  const refused = (reason: Extract<SeatOfferDealOutcome, { ok: false }>["reason"]) => ({
    results: [],
    deal: { ok: false, reason } as const,
  });
  const discount = lastMinuteDealDiscount({
    discountPercent: "percent" in input.discount ? input.discount.percent : null,
    discountAmountCents: "amountCents" in input.discount ? input.discount.amountCents : null,
  });
  if (!discount) return refused("invalid_discount");
  const [shop, account] = await Promise.all([
    getShopById(db, input.shopId),
    getShopStripeAccount(db, input.shopId),
  ]);
  // A rehearsal is never sold or announced (ADR 20261012-rehearsal-departures).
  if (!shop || !tripRow || !offerable) return refused("trip_unavailable");
  const openSeats = spotsRemaining({ capacity: tripRow.capacity, booked: tripRow.booked });
  if (openSeats <= 0) return refused("trip_full");
  if (!canAcceptPayments(account)) return refused("not_connected");
  const stripeAccountId = (account as NonNullable<typeof account>).stripeAccountId;
  if (targets.length === 0) return refused("no_recipients");

  const currency = await getShopCurrency(db, input.shopId);
  const code = generateLastMinutePromoCode(
    discount.kind === "percent"
      ? discount.percent
      : Math.round(minorToMajor(discount.amountCents, currency)),
  );
  // Durable evidence before either Stripe call.
  const [pendingRow] = await db
    .insert(tripLastMinutePromos)
    .values({
      shopId: input.shopId,
      tripId: input.tripId,
      ...promoDiscountColumns(discount),
      code,
      expiresAt: tripRow.startsAt,
      // The cap Stripe is about to be given, kept so the checkout can hold the
      // same cap on the path Stripe cannot see (src/db/promo-caps.ts).
      maxRedemptions: openSeats,
      createdByPersonId: input.createdByPersonId,
    })
    .returning();
  if (!pendingRow) throw new Error("offerSeats: promo insert returned no row");

  const stripeResult = await promotions.createTripPromotion({
    stripeAccountId,
    code,
    discount,
    currency,
    expiresAt: tripRow.startsAt,
    maxRedemptions: openSeats,
    idempotencyKey: pendingRow.id,
  });
  if (stripeResult.status !== "created") {
    await db
      .update(tripLastMinutePromos)
      .set({ status: "failed" })
      .where(eq(tripLastMinutePromos.id, pendingRow.id));
    return refused("stripe_failed");
  }

  const deal: OfferDeal = { code, discount, currency, expiresAt: tripRow.startsAt };
  const results = await deliverTargets(
    db,
    input,
    interestIds,
    targets,
    byId,
    { promoId: pendingRow.id, deal },
    provider,
  );
  const sentCount = results.filter(({ delivery }) => delivery === "sent").length;
  await db
    .update(tripLastMinutePromos)
    .set({
      status: "sent",
      stripeCouponId: stripeResult.stripeCouponId,
      stripePromotionCodeId: stripeResult.stripePromotionCodeId,
      recipientCount: sentCount,
    })
    .where(eq(tripLastMinutePromos.id, pendingRow.id));
  return {
    results,
    deal: { ok: true, promoId: pendingRow.id, code, recipientCount: sentCount },
  };
}

/** The people holding a seat on this departure that is not cancelled. */
async function seatedPersonIds(db: AppDb, shopId: string, tripId: string): Promise<string[]> {
  const rows = await db
    .select({ personId: bookings.personId })
    .from(bookings)
    .where(
      and(
        eq(bookings.shopId, shopId),
        eq(bookings.tripId, tripId),
        ne(bookings.status, "cancelled"),
      ),
    );
  return rows.map((row) => row.personId);
}

/**
 * Write each target's departure row, then send. An interest that is not a target
 * (another shop's id, an anytime interest that does not clear the filter) answers
 * `fallback` with nothing written.
 */
async function deliverTargets(
  db: AppDb,
  input: { shopId: string; shopSlug: string; tripId: string; createdByPersonId?: string },
  interestIds: string[],
  targets: string[],
  byId: Map<string, Interest>,
  carried: { promoId: string; deal: OfferDeal } | undefined,
  provider: NotificationProvider | undefined,
): Promise<SeatOffersOutcome["results"]> {
  const targeted = new Set(targets);
  const results: SeatOffersOutcome["results"] = [];
  for (const interestId of interestIds) {
    const source = byId.get(interestId);
    if (!source || !targeted.has(interestId)) {
      results.push({ interestId, delivery: "fallback" });
      continue;
    }
    const row = await departureRowToOffer(db, source, {
      tripId: input.tripId,
      createdByPersonId: input.createdByPersonId,
      promoId: carried?.promoId,
    });
    if (row === "window_taken") {
      results.push({ interestId, delivery: "already_sent" });
      continue;
    }
    if (!row) {
      results.push({ interestId, delivery: "fallback" });
      continue;
    }
    results.push({
      interestId,
      delivery: await deliverSeatOffer(
        db,
        {
          ...input,
          interestId: row,
          // A deal is the shop's own blast; without one, this is the "Who
          // wants in" offer, the wait list's send.
          ...(carried ? { deal: carried.deal, initiatedBy: "shop" as const } : {}),
        },
        provider,
      ),
    });
  }
  return results;
}

/**
 * The departure row an offer goes out on. A departure interest is its own row. An
 * anytime interest is copied to one for this trip (`parent_interest_id` = the anytime
 * interest): one row per person per departure, so a diver who already has a row here
 * (waiting, or invited before) keeps it, and it gains only the deal. It is never
 * re-parented onto the list (security review of #2656, MAJOR 1): the row stays
 * what the diver or the shop made it, so its later offers keep the person's own
 * way out and the roll keeps reading it as the wait list it is. A
 * row whose last commercial email is inside the 24-hour window is
 * `window_taken`, left exactly as it is: the blast skips that diver rather than
 * failing (#2133). Null when the interest names nobody this shop can write to.
 */
async function departureRowToOffer(
  db: AppDb,
  source: Interest,
  input: { tripId: string; createdByPersonId?: string; promoId?: string },
): Promise<string | "window_taken" | null> {
  if (source.scope === "departure") {
    if (
      source.emailedAt &&
      nowDate().getTime() - source.emailedAt.getTime() < OFFER_RESEND_WINDOW_MS
    ) {
      return "window_taken";
    }
    if (input.promoId) {
      await db
        .update(interests)
        .set({ promoId: input.promoId })
        .where(and(eq(interests.id, source.id), eq(interests.shopId, source.shopId)));
    }
    return source.id;
  }
  if (source.scope === "anytime" && !source.personId) return null;
  if (source.scope !== "anytime" && source.scope !== "date") return null;

  // The row this interest already has on the trip: a person's one row, else the
  // copy of this very interest (a date interest attached from the schedule builder).
  const find = () =>
    db
      .select()
      .from(interests)
      .where(
        and(
          eq(interests.scope, "departure"),
          eq(interests.shopId, source.shopId),
          eq(interests.tripId, input.tripId),
          source.personId
            ? or(eq(interests.personId, source.personId), eq(interests.parentInterestId, source.id))
            : eq(interests.parentInterestId, source.id),
        ),
      )
      .limit(1);
  // A date interest is a diver's own ask (the offer is the reply to it); an
  // anytime interest is outreach. A date interest with no person keeps its snapshot.
  const fromDate = source.scope === "date";
  const [inserted] = await db
    .insert(interests)
    .values({
      shopId: source.shopId,
      scope: "departure",
      askedBy: fromDate ? "diver" : "shop",
      tripId: input.tripId,
      personId: source.personId,
      ...(fromDate && !source.personId
        ? { name: source.name, email: source.email, phone: source.phone }
        : {}),
      parentInterestId: source.id,
      createdByPersonId: input.createdByPersonId,
      partySize: fromDate ? Math.min(20, Math.max(1, source.partySize ?? 1)) : 1,
      ...(fromDate ? { askedAt: source.askedAt } : {}),
      promoId: input.promoId,
    })
    .onConflictDoNothing()
    .returning({ id: interests.id });
  if (inserted) return inserted.id;
  const [existing] = await find();
  if (!existing) return null;
  if (
    existing.emailedAt &&
    nowDate().getTime() - existing.emailedAt.getTime() < OFFER_RESEND_WINDOW_MS
  ) {
    return "window_taken";
  }
  if (input.promoId) {
    await db
      .update(interests)
      .set({ promoId: input.promoId })
      .where(and(eq(interests.id, existing.id), eq(interests.shopId, source.shopId)));
  }
  return existing.id;
}

/**
 * A commercial offer's send under its claim, given back when the mail does not
 * go. A retryable failure keeps it: that mail is on the retry queue and will
 * still go, so a second submit inside the window would send a second (#2133).
 */
async function sendClaimedOffer(
  db: AppDb,
  input: {
    shopId: string;
    shopSlug: string;
    interestId: string;
    sailedStartsAt?: Date;
    deal?: OfferDeal;
    governedBy?: "waitlist" | "pastDiverInvites";
  },
  context: OfferContext,
  claim: OfferSendClaim,
  provider: NotificationProvider | undefined,
): Promise<SeatOfferDelivery> {
  let send: OfferSend = { delivery: "fallback", queued: false };
  try {
    send = await sendOffer(db, input, context, claim.at, provider);
  } finally {
    if (send.delivery !== "sent" && !send.queued) {
      await releaseOfferSend(db, input.shopId, input.interestId, claim);
    }
  }
  return send.delivery;
}

/** The send's answer, and whether its mail is queued to go later. */
type OfferSend = { delivery: SeatOfferDelivery; queued: boolean };

/** The send itself, once the stamp (and for a commercial offer, the claim) is written. */
async function sendOffer(
  db: AppDb,
  input: {
    shopId: string;
    shopSlug: string;
    sailedStartsAt?: Date;
    deal?: OfferDeal;
    governedBy?: "waitlist" | "pastDiverInvites";
  },
  context: OfferContext,
  offeredAt: Date,
  provider: NotificationProvider | undefined,
): Promise<OfferSend> {
  const origin = publicAppUrl();
  const { interest, person, trip, shop } = context;
  const to = person?.email ?? interest.email;
  // A record deleted since the interest was made is not somebody to sell a seat to
  // (`findCourtesyEmailRecipientByAddress` is blind to them too).
  if (!to || !origin || person?.deletedAt) return { delivery: "fallback", queued: false };
  const shared = {
    interestId: interest.id,
    shopId: input.shopId,
    to,
    locale: recipientLocale(person?.locale, shop.defaultLocale),
    diverName: person?.fullName ?? interest.name ?? "Diver",
    shopName: shop.name,
    tripTitle: trip.title,
    startsAt: trip.startsAt,
    endsAt: trip.endsAt,
    timezone: shop.timezone,
    bookingUrl: new URL(publicTripPath(input.shopSlug, trip.id), `${origin}/`).toString(),
    offeredAt,
    ...(input.governedBy ? { governedBy: input.governedBy } : {}),
  };
  const mailClass = offerMailClass({
    scope: interest.scope,
    askedBy: interest.askedBy,
    parentScope: context.parentScope,
    carriesDeal: interest.promoId !== null,
  });
  if (mailClass === "service") {
    return sendOf(
      await sendNotification(
        db,
        {
          ...shared,
          kind: "seat_offer",
          answers: context.parentScope === "date" ? "date_request" : "wait_list",
          partySize: interest.partySize ?? undefined,
        },
        provider,
      ),
    );
  }
  if (!person) return { delivery: "fallback", queued: false };
  // Before anything about the send itself: a diver who opted out is
  // `opted_out` whether or not this deployment could have emailed them.
  if (person.courtesyEmailOptOutAt) return { delivery: "opted_out", queued: false };
  // An offer the last-minute list made possible is the list's to stop
  // (security review of #2656, MAJOR 1): once the diver has left the list, no
  // later offer goes out on the row it made, so the link in the first mail did
  // what it said. The drain asks the same before a retry
  // (`courtesyRecipientOptedOut`).
  const fromList = interest.parentInterestId !== null && context.parentScope === "anytime";
  if (fromList && context.parentClosedAt) return { delivery: "opted_out", queued: false };
  // An offer copied from a last-minute-list interest carries that list's own way
  // out (the interest's token, which closes the interest and with it every offer on
  // this row), the one the diver joined; any other commercial offer, a diver's
  // own wait-list row included, carries the person's courtesy opt-out.
  const unsubscribeToken =
    fromList && interest.parentInterestId
      ? await issueInterestUnsubscribeToken(db, {
          shopId: input.shopId,
          interestId: interest.parentInterestId,
        })
      : await issuePersonCourtesyEmailUnsubscribeToken(db, {
          shopId: input.shopId,
          personId: person.id,
        });
  // A course session's offer carries the course's prerequisite note, so it never
  // implies the diver already qualifies (dive-domain review N3).
  const [course] = trip.courseId
    ? await db
        .select({ prerequisiteNote: courses.prerequisiteNote })
        .from(courses)
        .where(and(eq(courses.id, trip.courseId), eq(courses.shopId, input.shopId)))
        .limit(1)
    : [];
  const prerequisiteNote = course?.prerequisiteNote?.trim().slice(0, 2_000) || undefined;
  const delivery = await sendNotification(
    db,
    {
      ...shared,
      kind: "seat_offer_commercial",
      askedBy: interest.askedBy,
      unsubscribeUrl: new URL(`/unsubscribe/${unsubscribeToken}`, `${origin}/`).toString(),
      partySize: interest.partySize ?? undefined,
      ...(input.sailedStartsAt ? { sailedStartsAt: input.sailedStartsAt } : {}),
      prerequisiteNote,
      ...(input.deal
        ? {
            code: input.deal.code,
            expiresAt: input.deal.expiresAt,
            ...(input.deal.discount.kind === "percent"
              ? { discountPercent: input.deal.discount.percent }
              : {
                  discountAmountCents: input.deal.discount.amountCents,
                  currency: input.deal.currency,
                }),
          }
        : {}),
    },
    provider,
  ).catch(() => ({ status: "failed" as const, retryable: false }));
  return sendOf(delivery);
}

/** A delivery read as a send: a retryable failure is on the retry queue (`sendNotification`). */
function sendOf(delivery: NotificationDelivery): OfferSend {
  if (delivery.status === "sent") return { delivery: "sent", queued: false };
  return {
    delivery: "fallback",
    queued: delivery.status === "failed" && delivery.retryable === true,
  };
}

/** A commercial offer's taken send: the mark it wrote, and the one it replaced. */
type OfferSendClaim = { at: Date; previous: Date | null };

/**
 * **Take a commercial offer's send, or learn it is not this call's** (#2133).
 * The row is locked, read and marked in one transaction, so two submits that
 * land together cannot both pass the window: the second waits for the first's
 * mark and is refused. The claim writes both `emailedAt` (the window) and
 * `offeredAt` ("Offered").
 */
async function claimOfferSend(
  db: AppDb,
  shopId: string,
  interestId: string,
  at?: Date,
): Promise<OfferSendClaim | null> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ emailedAt: interests.emailedAt })
      .from(interests)
      .where(
        and(
          eq(interests.id, interestId),
          eq(interests.shopId, shopId),
          eq(interests.scope, "departure"),
        ),
      )
      .limit(1)
      .for("update");
    if (!row) return null;
    const now = at ?? nowDate();
    if (row.emailedAt && now.getTime() - row.emailedAt.getTime() < OFFER_RESEND_WINDOW_MS) {
      return null;
    }
    await tx
      .update(interests)
      .set({ emailedAt: now, offeredAt: now })
      .where(and(eq(interests.id, interestId), eq(interests.shopId, shopId)));
    return { at: now, previous: row.emailedAt };
  });
}

/**
 * Give the claim back after mail that did not go: the window goes back to the
 * last email that did, only while the mark is still this claim's. `offeredAt`
 * stays, because "Offered" is still true (staff reach the diver by hand).
 */
async function releaseOfferSend(
  db: AppDb,
  shopId: string,
  interestId: string,
  claim: OfferSendClaim,
) {
  await db
    .update(interests)
    .set({ emailedAt: claim.previous })
    .where(
      and(
        eq(interests.id, interestId),
        eq(interests.shopId, shopId),
        eq(interests.emailedAt, claim.at),
      ),
    );
}

const listParent = alias(interests, "list_parent");

/** A deal row the last-minute list made: shop-asked, copied from an anytime interest. */
function madeByTheList(db: AppDb): SQL {
  return sql`${and(
    eq(interests.askedBy, "shop"),
    exists(
      db
        .select({ id: listParent.id })
        .from(listParent)
        .where(and(eq(listParent.id, interests.parentInterestId), eq(listParent.scope, "anytime"))),
    ),
  )}`;
}

/**
 * **How many offers this departure can honor right now.** Measured as a seat is
 * measured when it is sold (`createBookingRecord`, `moveBooking`): the boat's
 * sellable seats, the divers-only limit, and for a course session the instructor
 * it needs and the ratio its crew allows. An interest asks for a diver's seat, so the
 * divers-only limit binds. Every offer already out to someone who has not taken a
 * seat holds as many of those seats as their party asked for, so they are taken
 * off. A person-less date-request offer stops counting after 48 hours (#2914),
 * or when its specific linked booking is live; this is advice for the next
 * offer, not a reservation or booking gate.
 * **A row a deal made off the last-minute list does not count** (ADR
 * 20261017-one-interest-with-a-scope, R2): one blast to forty people must not push a
 * three-seat departure to "0 invitable" and stop the roll inviting real
 * wait-listers. Only the rows the list made (`asked_by = 'shop'`, parent an
 * anytime interest): a deal that reaches a diver's own wait-list row or the shop's
 * cold invitation leaves the seats that offer holds counted (dive-domain review
 * of #2656, M3), so the roll never promises them twice. Advice for whom to offer, never a gate: the seat is still
 * measured under the trip's lock when the diver books. Exported for its test
 * (agency review G5 of #2226).
 */
export async function invitableSeats(db: AppDb, trip: typeof trips.$inferSelect): Promise<number> {
  const anonymousOfferCutoff = new Date(nowDate().getTime() - 48 * HOUR_MS);
  const held = await heldSeatCounts(db, trip.shopId, trip.id);
  let room = (await sellableCapacity(db, trip)) - held.aboard;
  const diverLimit = diverSeatLimit(trip);
  if (diverLimit !== null) room = Math.min(room, diverLimit - held.divers);
  // The students, its divers: a priced rider is a passenger (G5 of #2226).
  const ratioCap = await courseStudentSeatCap(db, trip);
  if (ratioCap !== null) room = Math.min(room, ratioCap - held.divers);
  const [outstanding] = await db
    .select({ offered: sql<number>`coalesce(sum(${interests.partySize}), 0)::int` })
    .from(interests)
    .where(
      and(
        eq(interests.scope, "departure"),
        eq(interests.shopId, trip.shopId),
        eq(interests.tripId, trip.id),
        isNotNull(interests.offeredAt),
        or(isNotNull(interests.personId), gt(interests.offeredAt, anonymousOfferCutoff)),
        or(isNull(interests.promoId), not(madeByTheList(db))),
        notExists(
          db
            .select({ id: bookings.id })
            .from(bookings)
            .where(
              and(
                eq(bookings.tripId, trip.id),
                eq(bookings.personId, interests.personId),
                ne(bookings.status, "cancelled"),
              ),
            ),
        ),
        notExists(
          db
            .select({ id: bookings.id })
            .from(bookings)
            .where(
              and(
                eq(bookings.id, interests.bookedBookingId),
                eq(bookings.shopId, interests.shopId),
                eq(bookings.tripId, interests.tripId),
                ne(bookings.status, "cancelled"),
              ),
            ),
        ),
      ),
    );
  return Math.max(0, room - (outstanding?.offered ?? 0));
}

/**
 * **Could this diver book this departure from a link right now?** The
 * no-show's "another day" names a departure and promises the diver can take
 * it (dive-domain review of layer 8, F1), so both the panel that lists the
 * days and the act that sends one ask this first.
 *
 * The same refusals the booking transaction would give the diver, read
 * without its locks: a departure that is cancelled, held for conditions,
 * private or already gone; no sellable seat (`seatRefusal` over
 * `sellableCapacity`, the certificate's cap included); a course session with
 * no instructor, at its ratio cap, or asking a verified card the diver lacks;
 * and the trip's own admission gate (`tripAdmissionFor`) on the diver's
 * evidence. "Already gone" is the scheduled time, not `hasSailed`'s grace: the
 * diver books later, from an email.
 *
 * Any live booking row on it refuses too: `bookings` is unique on (trip,
 * person) and the booking form answers `already_booked` for a row it cannot
 * reactivate. A cancelled row and a no-show on a departure still ahead can be
 * booked again, so they do not refuse (#2484, `rowCanBeReactivated`).
 */
export async function departureOpenToDiver(
  db: DbExecutor,
  input: { shopId: string; tripId: string; personId: string; now?: Date },
): Promise<boolean> {
  const now = input.now ?? nowDate();
  const [trip] = await db
    .select()
    .from(trips)
    .where(
      and(
        eq(trips.id, input.tripId),
        eq(trips.shopId, input.shopId),
        eq(trips.status, "scheduled"),
        eq(trips.isPrivate, false),
        gt(trips.startsAt, now),
        liveTrip(),
      ),
    )
    .limit(1);
  if (!trip || trip.conditionsHold) return false;

  const [row] = await db
    .select({ id: bookings.id })
    .from(bookings)
    .where(
      and(
        eq(bookings.shopId, input.shopId),
        eq(bookings.tripId, trip.id),
        eq(bookings.personId, input.personId),
        // A cancelled row, or a no-show on a departure still ahead, can be
        // booked again (`rowCanBeReactivated`); the departure is future here.
        notInArray(bookings.status, ["cancelled", "no_show"]),
      ),
    )
    .limit(1);
  if (row) return false;

  const held = await heldSeatCounts(db, input.shopId, trip.id);
  if (seatRefusal("diver", { ...trip, capacity: await sellableCapacity(db, trip) }, held)) {
    return false;
  }

  if (trip.courseId) {
    const [course] = await db
      .select()
      .from(courses)
      .where(and(eq(courses.id, trip.courseId), eq(courses.shopId, input.shopId)))
      .limit(1);
    if (!course) return false;
    const { instructorCount, assistantCount } = await tripCourseCrewCounts(db, trip.id);
    if (instructorCount === 0) return false;
    const seatCap = courseSeatCapacity(course, instructorCount, assistantCount);
    // The students, its divers: a priced rider is a passenger (G5 of #2226).
    if (seatCap !== null && held.divers >= seatCap) return false;
    if (course.minimumCertificationLevel) {
      const cards = await db
        .select()
        .from(certifications)
        .where(
          and(
            eq(certifications.shopId, input.shopId),
            eq(certifications.personId, input.personId),
            isNull(certifications.deletedAt),
          ),
        );
      if (!hasVerifiedCertificationAtLeast(cards, course.minimumCertificationLevel)) return false;
    }
  }

  const admission = await tripAdmissionFor(
    db,
    input.shopId,
    trip.id,
    { id: input.personId },
    false,
    Boolean(trip.courseId),
  );
  return admission.admitted;
}

/**
 * **Email only, by decision** (Aaron, 2026-10-13, #2476): this is a commercial
 * message and no per-channel marketing consent exists, so a diver with a phone
 * and no email is not reached and the counter sees "not sent". SMS or WhatsApp
 * waits for that consent field; do not route this through `courtesy.ts`'s
 * transactional channel choice in the meantime.
 *
 * **"Email them this date"** on the counter's no-show panel (UX review
 * 2026-10-11, item 14). The desk already knows the fix for the diver who missed
 * the boat, another departure with room, and this sends it in one tap: a shop
 * interest for that departure, delivered the way every offer is (`deliverSeatOffer`),
 * so the diver books the seat themselves from the link. It stays immediate
 * (ADR 20260906-before-you-ask named only four held sends): one diver at a
 * counter. Nothing is seated and nothing is charged.
 *
 * An interest already standing for this diver and departure is offered again rather
 * than refused, so a second tap after "no email" was fixed works. An offer is
 * commercial, so it takes the same claim: mail to this diver for this departure
 * that went out in the last 24 hours answers `already_sent` and sends nothing
 * (#2133, and #2480's double tap at a busy counter is one email, not two). A
 * send that did not go gives its claim back, so a fallback never blocks the
 * retry. The `departure_offered` line goes on the departure's trail only on a
 * sent delivery. `unavailable` covers every reason there is nothing to offer:
 * the departure is gone or full, the diver could not book it
 * (`departureOpenToDiver`), or the person is not this shop's diver. Nothing is
 * written or sent then.
 */
export async function offerDepartureToDiver(
  db: AppDb,
  input: {
    shopId: string;
    shopSlug: string;
    tripId: string;
    personId: string;
    createdByPersonId: string;
  },
  provider?: NotificationProvider,
): Promise<SeatOfferDelivery | "unavailable"> {
  if (!(await departureOpenToDiver(db, input))) return "unavailable";
  const interest = await ensureDepartureInterest(db, input);
  if (!interest) return "unavailable";
  const delivery = await deliverSeatOffer(
    db,
    {
      shopId: input.shopId,
      shopSlug: input.shopSlug,
      tripId: input.tripId,
      interestId: interest.interestId,
      initiatedBy: "shop",
    },
    provider,
  );
  if (delivery === "sent") {
    const [diver] = await db
      .select({ fullName: people.fullName })
      .from(people)
      .where(and(eq(people.id, input.personId), eq(people.shopId, input.shopId), livePerson()))
      .limit(1);
    await recordTripActivity(db, {
      shopId: input.shopId,
      tripId: input.tripId,
      actorPersonId: input.createdByPersonId,
      subjectPersonId: input.personId,
      entry: { code: "departure_offered", diver: diver?.fullName ?? "" },
    });
  }
  return delivery;
}
