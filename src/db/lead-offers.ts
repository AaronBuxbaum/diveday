import {
  and,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  ne,
  notExists,
  notInArray,
  or,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { HOUR_MS, nowDate } from "@/lib/clock";
import { courseSeatCapacity } from "@/lib/course-ratios";
import { generateLastMinutePromoCode, lastMinuteDealDiscount } from "@/lib/last-minute-list";
import { offerMailClass } from "@/lib/leads";
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
import { spotsRemaining } from "@/lib/trips";
import { courseStudentSeatCap, tripAdmissionFor, tripCourseCrewCounts } from "./bookings";
import type { AppDb, DbExecutor } from "./client";
import { issuePersonCourtesyEmailUnsubscribeToken } from "./courtesy-email";
import { listDateLeadsInReach } from "./lead-dates";
import { ensureDepartureLead, issueLeadUnsubscribeToken, listAnytimeLeadsCovering } from "./leads";
import { sendNotification } from "./notifications";
import { recordTripActivity } from "./operations";
import {
  bookings,
  certifications,
  courses,
  type Lead,
  leads,
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
 * **Offer a seat** (ADR 20261017-one-lead-with-a-scope): the one staff act on a
 * departure lead. It reserves nothing and never touches a manifest; the diver
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

const parentLead = alias(leads, "parent_lead");

/**
 * The deal an offer carries into the email: the code, the figure, the shop's
 * currency (a fixed amount is typed in it) and when the code stops working. It
 * travels with the send rather than being read back off the lead, because the
 * promo row is still `pending` while the blast is going out.
 */
export type OfferDeal = {
  code: string;
  discount: PromoDiscount;
  currency: string;
  expiresAt: Date;
};

/** The shop-scoped lead, diver, departure and shop facts one offer needs. */
async function getOfferContext(db: AppDb, shopId: string, tripId: string, leadId: string) {
  const [row] = await db
    .select({
      lead: leads,
      parentScope: parentLead.scope,
      person: people,
      trip: trips,
      shop: shops,
    })
    .from(leads)
    .innerJoin(trips, and(eq(trips.id, leads.tripId), eq(trips.shopId, shopId), liveTrip()))
    .innerJoin(shops, eq(shops.id, shopId))
    .leftJoin(parentLead, and(eq(parentLead.id, leads.parentLeadId), eq(parentLead.shopId, shopId)))
    .leftJoin(people, and(eq(people.id, leads.personId), eq(people.shopId, shopId)))
    .where(
      and(
        eq(leads.id, leadId),
        eq(leads.scope, "departure"),
        eq(leads.shopId, shopId),
        eq(leads.tripId, tripId),
      ),
    )
    .limit(1);
  return row ?? null;
}

type OfferContext = NonNullable<Awaited<ReturnType<typeof getOfferContext>>>;

/**
 * Stamp one lead as offered and email the diver — as service mail or as
 * commercial mail, by `offerMailClass` (Aaron, 2026-10-06, issue #1953):
 *
 * - **A reply to a diver's own date request** is `seat_offer`: the diver asked,
 *   so it reaches them whatever their courtesy-email setting, with no
 *   unsubscribe, and is not throttled.
 * - **Every other offer** is `seat_offer_commercial`: it carries a fresh
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
    leadId: string;
    /**
     * The run's date this lead waited for, when the nightly roll moved them
     * here: the offer says it filled and this date has room (fourth review,
     * item 31).
     */
    sailedStartsAt?: Date;
    /** The deal this offer carries, when it is the blast of one (`offerSeats`). */
    deal?: OfferDeal;
    now?: Date;
  },
  provider?: NotificationProvider,
): Promise<SeatOfferDelivery> {
  const context = await getOfferContext(db, input.shopId, input.tripId, input.leadId);
  if (!context) return "fallback";
  const mailClass = offerMailClass({
    scope: context.lead.scope,
    askedBy: context.lead.askedBy,
    parentScope: context.parentScope,
    carriesDeal: context.lead.promoId !== null,
  });
  if (mailClass === "commercial") {
    const claim = await claimOfferSend(db, input.shopId, input.leadId, input.now);
    if (!claim) return "already_sent";
    return sendClaimedOffer(db, input, context, claim, provider);
  }
  const offeredAt = input.now ?? nowDate();
  const [stamped] = await db
    .update(leads)
    .set({ offeredAt })
    .where(and(eq(leads.id, input.leadId), eq(leads.shopId, input.shopId)))
    .returning({ id: leads.id });
  if (!stamped) return "fallback";
  return (await sendOffer(db, input, context, offeredAt, provider)).delivery;
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
  results: { leadId: string; delivery: SeatOfferDelivery }[];
  /** Present only when the offer carried a discount. */
  deal?: SeatOfferDealOutcome;
};

/** The discount a held offer carries: a percent, or a fixed amount in minor units. */
export type SeatOfferDiscount = { percent: number } | { amountCents: number };

/**
 * **The held send's body**: offer a seat to each lead staff ticked, one email
 * apiece. One lead never fails the rest: each answers for itself, and anything
 * but `sent` is the composer fallback on that row. Every lead is read inside
 * this shop, so an id from another shop is `fallback` and nothing is written.
 *
 * A **departure** lead is offered as it stands. An **anytime** lead (the
 * last-minute list) is first copied to a departure row of this trip
 * (`parent_lead_id` pointing back), because every offer is a departure row; only
 * the leads that clear `listAnytimeLeadsCovering`'s below-the-bar filter and
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
    leadIds: string[];
    discount?: SeatOfferDiscount;
    createdByPersonId?: string;
  },
  provider?: NotificationProvider,
  promotions: PromotionProvider = promotionProviderFromEnvironment(),
): Promise<SeatOffersOutcome> {
  const leadIds = [...new Set(input.leadIds)];
  const tripRow = await getTripWithBooked(db, input.shopId, input.tripId);
  const found =
    tripRow && !tripRow.isRehearsal
      ? await db
          .select()
          .from(leads)
          .where(and(eq(leads.shopId, input.shopId), inArray(leads.id, leadIds)))
      : [];
  const byId = new Map(found.map((lead) => [lead.id, lead]));

  // The anytime leads a bulk offer may reach: dates covering the day, an address,
  // and the below-the-bar filter. Anything else posted is not offered.
  const eligibleAnytime = new Set<string>();
  if (tripRow && found.some((lead) => lead.scope === "anytime")) {
    const covering = await listAnytimeLeadsCovering(db, input.shopId, {
      id: tripRow.id,
      startsAt: tripRow.startsAt,
      course: tripRow.course ?? null,
    });
    for (const { lead } of covering.eligible) eligibleAnytime.add(lead.id);
  }
  // A date lead is offered only while it is open and within reach of this
  // departure's day (`listDateLeadsInReach`, the panel's own read).
  const inReachDate = new Set<string>();
  if (tripRow && found.some((lead) => lead.scope === "date")) {
    for (const row of await listDateLeadsInReach(db, input.shopId, { tripId: tripRow.id })) {
      inReachDate.add(row.id);
    }
  }
  const targets = leadIds.filter((id) => {
    const lead = byId.get(id);
    if (!lead) return false;
    if (lead.scope === "anytime") return eligibleAnytime.has(id);
    if (lead.scope === "date") return inReachDate.has(id);
    return lead.scope === "departure" && lead.tripId === input.tripId;
  });

  if (!input.discount) {
    return {
      results: await deliverTargets(db, input, leadIds, targets, byId, undefined, provider),
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
  if (
    !shop ||
    !tripRow ||
    // A rehearsal is never sold or announced (ADR 20261012-rehearsal-departures).
    tripRow.isRehearsal ||
    tripRow.status !== "scheduled" ||
    tripRow.startsAt <= nowDate()
  ) {
    return refused("trip_unavailable");
  }
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
    leadIds,
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

/**
 * Write each target's departure row, then send. A lead that is not a target
 * (another shop's id, an anytime lead that does not clear the filter) answers
 * `fallback` with nothing written.
 */
async function deliverTargets(
  db: AppDb,
  input: { shopId: string; shopSlug: string; tripId: string; createdByPersonId?: string },
  leadIds: string[],
  targets: string[],
  byId: Map<string, Lead>,
  carried: { promoId: string; deal: OfferDeal } | undefined,
  provider: NotificationProvider | undefined,
): Promise<SeatOffersOutcome["results"]> {
  const targeted = new Set(targets);
  const results: SeatOffersOutcome["results"] = [];
  for (const leadId of leadIds) {
    const source = byId.get(leadId);
    if (!source || !targeted.has(leadId)) {
      results.push({ leadId, delivery: "fallback" });
      continue;
    }
    const row = await departureRowToOffer(db, source, {
      tripId: input.tripId,
      createdByPersonId: input.createdByPersonId,
      promoId: carried?.promoId,
    });
    if (row === "window_taken") {
      results.push({ leadId, delivery: "already_sent" });
      continue;
    }
    if (!row) {
      results.push({ leadId, delivery: "fallback" });
      continue;
    }
    results.push({
      leadId,
      delivery: await deliverSeatOffer(
        db,
        { ...input, leadId: row, ...(carried ? { deal: carried.deal } : {}) },
        provider,
      ),
    });
  }
  return results;
}

/**
 * The departure row an offer goes out on. A departure lead is its own row. An
 * anytime lead is copied to one for this trip (`parent_lead_id` = the anytime
 * lead): one row per person per departure, so a diver who already has a row here
 * (waiting, or invited before) keeps it and it gains the parent and the deal. A
 * row whose last commercial email is inside the 24-hour window is
 * `window_taken`, left exactly as it is: the blast skips that diver rather than
 * failing (#2133). Null when the lead names nobody this shop can write to.
 */
async function departureRowToOffer(
  db: AppDb,
  source: Lead,
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
        .update(leads)
        .set({ promoId: input.promoId })
        .where(and(eq(leads.id, source.id), eq(leads.shopId, source.shopId)));
    }
    return source.id;
  }
  if (source.scope === "anytime" && !source.personId) return null;
  if (source.scope !== "anytime" && source.scope !== "date") return null;

  // The row this lead already has on the trip: a person's one row, else the
  // copy of this very lead (a date lead attached from the schedule builder).
  const find = () =>
    db
      .select()
      .from(leads)
      .where(
        and(
          eq(leads.scope, "departure"),
          eq(leads.shopId, source.shopId),
          eq(leads.tripId, input.tripId),
          source.personId
            ? or(eq(leads.personId, source.personId), eq(leads.parentLeadId, source.id))
            : eq(leads.parentLeadId, source.id),
        ),
      )
      .limit(1);
  // A date lead is a diver's own ask (the offer is the reply to it); an
  // anytime lead is outreach. A date lead with no person keeps its snapshot.
  const fromDate = source.scope === "date";
  const [inserted] = await db
    .insert(leads)
    .values({
      shopId: source.shopId,
      scope: "departure",
      askedBy: fromDate ? "diver" : "shop",
      tripId: input.tripId,
      personId: source.personId,
      ...(fromDate && !source.personId
        ? { name: source.name, email: source.email, phone: source.phone }
        : {}),
      parentLeadId: source.id,
      createdByPersonId: input.createdByPersonId,
      partySize: fromDate ? Math.min(20, Math.max(1, source.partySize ?? 1)) : 1,
      ...(fromDate ? { askedAt: source.askedAt } : {}),
      promoId: input.promoId,
    })
    .onConflictDoNothing()
    .returning({ id: leads.id });
  if (inserted) return inserted.id;
  const [existing] = await find();
  if (!existing) return null;
  if (
    existing.emailedAt &&
    nowDate().getTime() - existing.emailedAt.getTime() < OFFER_RESEND_WINDOW_MS
  ) {
    return "window_taken";
  }
  await db
    .update(leads)
    .set({
      parentLeadId: existing.parentLeadId ?? source.id,
      ...(input.promoId ? { promoId: input.promoId } : {}),
    })
    .where(and(eq(leads.id, existing.id), eq(leads.shopId, source.shopId)));
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
    leadId: string;
    sailedStartsAt?: Date;
    deal?: OfferDeal;
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
      await releaseOfferSend(db, input.shopId, input.leadId, claim);
    }
  }
  return send.delivery;
}

/** The send's answer, and whether its mail is queued to go later. */
type OfferSend = { delivery: SeatOfferDelivery; queued: boolean };

/** The send itself, once the stamp (and for a commercial offer, the claim) is written. */
async function sendOffer(
  db: AppDb,
  input: { shopId: string; shopSlug: string; sailedStartsAt?: Date; deal?: OfferDeal },
  context: OfferContext,
  offeredAt: Date,
  provider: NotificationProvider | undefined,
): Promise<OfferSend> {
  const origin = publicAppUrl();
  const { lead, person, trip, shop } = context;
  const to = person?.email ?? lead.email;
  // A record deleted since the lead was made is not somebody to sell a seat to
  // (`findCourtesyEmailRecipientByAddress` is blind to them too).
  if (!to || !origin || person?.deletedAt) return { delivery: "fallback", queued: false };
  const shared = {
    leadId: lead.id,
    shopId: input.shopId,
    to,
    locale: recipientLocale(person?.locale, shop.defaultLocale),
    diverName: person?.fullName ?? lead.name ?? "Diver",
    shopName: shop.name,
    tripTitle: trip.title,
    startsAt: trip.startsAt,
    endsAt: trip.endsAt,
    timezone: shop.timezone,
    bookingUrl: new URL(publicTripPath(input.shopSlug, trip.id), `${origin}/`).toString(),
    offeredAt,
  };
  const mailClass = offerMailClass({
    scope: lead.scope,
    askedBy: lead.askedBy,
    parentScope: context.parentScope,
    carriesDeal: lead.promoId !== null,
  });
  if (mailClass === "service") {
    return sendOf(await sendNotification(db, { ...shared, kind: "seat_offer" }, provider));
  }
  if (!person) return { delivery: "fallback", queued: false };
  // Before anything about the send itself: a diver who opted out is
  // `opted_out` whether or not this deployment could have emailed them.
  if (person.courtesyEmailOptOutAt) return { delivery: "opted_out", queued: false };
  // An offer copied from a last-minute-list lead carries that list's own way
  // out (the lead's token, which closes the lead), the one the diver joined; any
  // other commercial offer carries the person's courtesy opt-out.
  const unsubscribeToken =
    lead.parentLeadId && context.parentScope === "anytime"
      ? await issueLeadUnsubscribeToken(db, { shopId: input.shopId, leadId: lead.parentLeadId })
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
      askedBy: lead.askedBy,
      unsubscribeUrl: new URL(`/unsubscribe/${unsubscribeToken}`, `${origin}/`).toString(),
      partySize: lead.partySize ?? undefined,
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
  leadId: string,
  at?: Date,
): Promise<OfferSendClaim | null> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ emailedAt: leads.emailedAt })
      .from(leads)
      .where(and(eq(leads.id, leadId), eq(leads.shopId, shopId), eq(leads.scope, "departure")))
      .limit(1)
      .for("update");
    if (!row) return null;
    const now = at ?? nowDate();
    if (row.emailedAt && now.getTime() - row.emailedAt.getTime() < OFFER_RESEND_WINDOW_MS) {
      return null;
    }
    await tx
      .update(leads)
      .set({ emailedAt: now, offeredAt: now })
      .where(and(eq(leads.id, leadId), eq(leads.shopId, shopId)));
    return { at: now, previous: row.emailedAt };
  });
}

/**
 * Give the claim back after mail that did not go: the window goes back to the
 * last email that did, only while the mark is still this claim's. `offeredAt`
 * stays, because "Offered" is still true (staff reach the diver by hand).
 */
async function releaseOfferSend(db: AppDb, shopId: string, leadId: string, claim: OfferSendClaim) {
  await db
    .update(leads)
    .set({ emailedAt: claim.previous })
    .where(and(eq(leads.id, leadId), eq(leads.shopId, shopId), eq(leads.emailedAt, claim.at)));
}

/**
 * **How many offers this departure can honor right now.** Measured as a seat is
 * measured when it is sold (`createBookingRecord`, `moveBooking`): the boat's
 * sellable seats, the divers-only limit, and for a course session the instructor
 * it needs and the ratio its crew allows. A lead asks for a diver's seat, so the
 * divers-only limit binds. Every offer already out to someone who has not taken a
 * seat holds as many of those seats as their party asked for, so they are taken
 * off. **An offer that carries a deal does not count** (ADR
 * 20261017-one-lead-with-a-scope, R2): one blast to forty people must not push a
 * three-seat departure to "0 invitable" and stop the roll inviting real
 * wait-listers. Advice for whom to offer, never a gate: the seat is still
 * measured under the trip's lock when the diver books. Exported for its test
 * (agency review G5 of #2226).
 */
export async function invitableSeats(db: AppDb, trip: typeof trips.$inferSelect): Promise<number> {
  const held = await heldSeatCounts(db, trip.shopId, trip.id);
  let room = (await sellableCapacity(db, trip)) - held.aboard;
  const diverLimit = diverSeatLimit(trip);
  if (diverLimit !== null) room = Math.min(room, diverLimit - held.divers);
  // The students, its divers: a priced rider is a passenger (G5 of #2226).
  const ratioCap = await courseStudentSeatCap(db, trip);
  if (ratioCap !== null) room = Math.min(room, ratioCap - held.divers);
  const [outstanding] = await db
    .select({ offered: sql<number>`coalesce(sum(${leads.partySize}), 0)::int` })
    .from(leads)
    .where(
      and(
        eq(leads.scope, "departure"),
        eq(leads.shopId, trip.shopId),
        eq(leads.tripId, trip.id),
        isNotNull(leads.offeredAt),
        isNull(leads.promoId),
        notExists(
          db
            .select({ id: bookings.id })
            .from(bookings)
            .where(
              and(
                eq(bookings.tripId, trip.id),
                eq(bookings.personId, leads.personId),
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
 * lead for that departure, delivered the way every offer is (`deliverSeatOffer`),
 * so the diver books the seat themselves from the link. It stays immediate
 * (ADR 20260906-before-you-ask named only four held sends): one diver at a
 * counter. Nothing is seated and nothing is charged.
 *
 * A lead already standing for this diver and departure is offered again rather
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
  const lead = await ensureDepartureLead(db, input);
  if (!lead) return "unavailable";
  const delivery = await deliverSeatOffer(
    db,
    {
      shopId: input.shopId,
      shopSlug: input.shopSlug,
      tripId: input.tripId,
      leadId: lead.leadId,
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
