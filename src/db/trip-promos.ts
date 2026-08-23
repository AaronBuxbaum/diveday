import { and, asc, count, desc, eq, gt, inArray } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import {
  filterEligibleLastMinuteRecipients,
  generateLastMinutePromoCode,
  isValidLastMinuteDiscountPercent,
  lastMinuteEntryMatchesTripDate,
  orderLastMinuteRecipients,
} from "@/lib/last-minute-list";
import { type NotificationProvider, publicAppUrl, recipientLocale } from "@/lib/notifications";
import {
  type PromotionProvider,
  promotionProviderFromEnvironment,
} from "@/lib/payments/promotions";
import { publicTripPath } from "@/lib/public-routes";
import { combineCertRequirements } from "@/lib/readiness";
import { spotsRemaining } from "@/lib/trips";
import { toDateInputValue, utcToWallTime } from "@/lib/zoned";
import type { AppDb, DbExecutor } from "./client";
import { issueLastMinuteListUnsubscribeToken, listLastMinuteList } from "./last-minute-list";
import { notificationProviderForDb, sendNotificationBatch } from "./notifications";
import { offsetPage, PAGE_SIZE } from "./paging";
import { getTripRequirements, getTripSiteRequirement } from "./readiness";
import {
  people,
  type TripLastMinutePromo,
  tripLastMinutePromoRecipients,
  tripLastMinutePromos,
  trips,
} from "./schema";
import { listCertificationSummaries } from "./self-declared-cards";
import { getShopById } from "./shops";
import { canAcceptPayments, getShopStripeAccount } from "./stripe-accounts";
import { getTripWaitlist, getTripWithBooked } from "./trips";
import { liveTrip } from "./trips-live";

export type SendLastMinuteDealInput = {
  shopId: string;
  shopSlug: string;
  tripId: string;
  discountPercent: number;
  createdByPersonId?: string;
  recipientPersonIds?: string[];
};

export type SendLastMinuteDealOutcome =
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

/**
 * Creates a Stripe coupon + promotion code for one under-capacity trip and
 * emails it to every last-minute-list entry whose stated date range covers
 * the departure. Fails closed on anything ambiguous — an unpriced/full/past
 * trip, a shop that can't take payments, or a Stripe error — and never
 * partially sends: the local row is durable evidence before either Stripe
 * call, but the email step only runs after Stripe has actually minted the
 * code (docs ADR 20260727-last-minute-fill-promos).
 */
export async function sendLastMinuteDealBlast(
  db: AppDb,
  input: SendLastMinuteDealInput,
  promotions: PromotionProvider = promotionProviderFromEnvironment(),
  notifications?: NotificationProvider,
): Promise<SendLastMinuteDealOutcome> {
  if (!isValidLastMinuteDiscountPercent(input.discountPercent)) {
    return { ok: false, reason: "invalid_discount" };
  }

  const [shop, tripRow, account, tripRequirement, siteRequirement] = await Promise.all([
    getShopById(db, input.shopId),
    getTripWithBooked(db, input.shopId, input.tripId),
    getShopStripeAccount(db, input.shopId),
    getTripRequirements(db, input.shopId, input.tripId),
    getTripSiteRequirement(db, input.shopId, input.tripId),
  ]);
  if (!shop || !tripRow || tripRow.status !== "scheduled" || tripRow.startsAt <= nowDate()) {
    return { ok: false, reason: "trip_unavailable" };
  }
  const openSeats = spotsRemaining({ capacity: tripRow.capacity, booked: tripRow.booked });
  if (openSeats <= 0) return { ok: false, reason: "trip_full" };
  if (!canAcceptPayments(account)) return { ok: false, reason: "not_connected" };
  const stripeAccountId = (account as NonNullable<typeof account>).stripeAccountId;

  const tripDateIso = toDateInputValue(utcToWallTime(tripRow.startsAt, shop.timezone));
  const rawMatches = (await listLastMinuteList(db, input.shopId)).filter(
    ({ entry, person }) =>
      Boolean(person.email) && lastMinuteEntryMatchesTripDate(entry, tripDateIso),
  );

  if (rawMatches.length === 0) return { ok: false, reason: "no_recipients" };

  const certSummaries = await listCertificationSummaries(
    db,
    input.shopId,
    rawMatches.map((m) => m.person.id),
  );
  const matchesWithCert = rawMatches.map((m) => ({
    ...m,
    certification: certSummaries.get(m.person.id) ?? null,
  }));

  const dealRequirement = combineCertRequirements(
    tripRequirement ?? {
      minimumCertificationLevel: null,
      requiredSpecialties: [],
      requiresNitrox: false,
    },
    siteRequirement,
  );

  let eligibleMatches = filterEligibleLastMinuteRecipients(
    matchesWithCert,
    dealRequirement,
    tripRow.course
      ? {
          slug: tripRow.course.slug,
          title: tripRow.course.title,
          sourceTemplateSlug: tripRow.course.sourceTemplateSlug,
          minimumCertificationLevel: tripRow.course.minimumCertificationLevel,
          isIntroCourse: tripRow.course.isIntroCourse,
        }
      : null,
  );

  if (input.recipientPersonIds && input.recipientPersonIds.length > 0) {
    const allowed = new Set(input.recipientPersonIds);
    eligibleMatches = eligibleMatches.filter((m) => allowed.has(m.person.id));
  }

  if (eligibleMatches.length === 0) return { ok: false, reason: "no_recipients" };

  // A diver already waiting on this exact trip has told the shop they want
  // this departure, and the deal can otherwise sell the seat out from under
  // them — so they hear about it first, longest wait first, ahead of anyone
  // just generically around that week. That is send order for one automated
  // mail, not a standing in a queue: the wait list has none
  // (ADR 20260813-wait-list-is-a-lead-list).
  const waitlist = await getTripWaitlist(db, input.shopId, input.tripId);
  const orderedMatches = orderLastMinuteRecipients(
    eligibleMatches,
    waitlist.map(({ person }) => person.id),
  );

  const code = generateLastMinutePromoCode(input.discountPercent);
  const [pendingRow] = await db
    .insert(tripLastMinutePromos)
    .values({
      shopId: input.shopId,
      tripId: input.tripId,
      discountPercent: input.discountPercent,
      code,
      expiresAt: tripRow.startsAt,
      createdByPersonId: input.createdByPersonId,
    })
    .returning();
  if (!pendingRow) throw new Error("sendLastMinuteDealBlast: insert returned no row");

  const stripeResult = await promotions.createTripPromotion({
    stripeAccountId,
    code,
    percentOff: input.discountPercent,
    expiresAt: tripRow.startsAt,
    maxRedemptions: openSeats,
    idempotencyKey: pendingRow.id,
  });
  if (stripeResult.status !== "created") {
    await db
      .update(tripLastMinutePromos)
      .set({ status: "failed" })
      .where(eq(tripLastMinutePromos.id, pendingRow.id));
    return { ok: false, reason: "stripe_failed" };
  }

  const origin = publicAppUrl();
  const bookingUrl = origin
    ? new URL(publicTripPath(input.shopSlug, input.tripId), `${origin}/`).toString()
    : null;

  let sentCount = 0;
  if (origin && bookingUrl) {
    const recipients = await Promise.all(
      orderedMatches
        .filter(({ person }) => Boolean(person.email))
        .map(async ({ entry, person }) => {
          const unsubscribeToken = await issueLastMinuteListUnsubscribeToken(db, {
            shopId: input.shopId,
            entryId: entry.id,
          });
          return {
            personId: person.id,
            kind: "last_minute_deal" as const,
            shopId: input.shopId,
            // Filtered above; non-null for every entry that reaches here.
            to: person.email as string,
            locale: recipientLocale(person.locale, shop.defaultLocale),
            diverName: person.fullName,
            shopName: shop.name,
            tripTitle: tripRow.title,
            startsAt: tripRow.startsAt,
            endsAt: tripRow.endsAt,
            timezone: shop.timezone,
            discountPercent: input.discountPercent,
            code,
            bookingUrl,
            expiresAt: tripRow.startsAt,
            unsubscribeUrl: new URL(`/unsubscribe/${unsubscribeToken}`, `${origin}/`).toString(),
          };
        }),
    );
    const deliveries = await sendNotificationBatch(
      db,
      recipients.map(({ personId: _pid, ...payload }) => payload),
      notificationProviderForDb(notifications),
    );
    const successfulRecipients = recipients.filter(
      (_, index) => deliveries[index]?.status === "sent",
    );
    sentCount = successfulRecipients.length;

    if (recipients.length > 0) {
      await db.insert(tripLastMinutePromoRecipients).values(
        recipients.map((r) => ({
          shopId: input.shopId,
          tripPromoId: pendingRow.id,
          personId: r.personId,
          email: r.to,
        })),
      );
    }
  }

  await db
    .update(tripLastMinutePromos)
    .set({
      status: "sent",
      stripeCouponId: stripeResult.stripeCouponId,
      stripePromotionCodeId: stripeResult.stripePromotionCodeId,
      recipientCount: sentCount,
    })
    .where(eq(tripLastMinutePromos.id, pendingRow.id));

  return { ok: true, promoId: pendingRow.id, code, recipientCount: sentCount };
}

/** Every blast sent for one trip, newest first — the staff page's send history. */
export async function listTripLastMinutePromos(
  db: DbExecutor,
  shopId: string,
  tripId: string,
): Promise<TripLastMinutePromo[]> {
  return db
    .select()
    .from(tripLastMinutePromos)
    .where(and(eq(tripLastMinutePromos.shopId, shopId), eq(tripLastMinutePromos.tripId, tripId)))
    .orderBy(desc(tripLastMinutePromos.createdAt));
}

export type TripLastMinutePromoRecipientItem = {
  promoId: string;
  personId: string;
  fullName: string;
  email: string;
  createdAt: Date;
};

/**
 * Returns who has been sent deals for this trip, with their name, email, promoId, and timestamp.
 */
export async function listTripLastMinutePromoRecipients(
  db: DbExecutor,
  shopId: string,
  tripId: string,
): Promise<TripLastMinutePromoRecipientItem[]> {
  return db
    .select({
      promoId: tripLastMinutePromoRecipients.tripPromoId,
      personId: tripLastMinutePromoRecipients.personId,
      fullName: people.fullName,
      email: tripLastMinutePromoRecipients.email,
      createdAt: tripLastMinutePromoRecipients.createdAt,
    })
    .from(tripLastMinutePromoRecipients)
    .innerJoin(
      tripLastMinutePromos,
      eq(tripLastMinutePromoRecipients.tripPromoId, tripLastMinutePromos.id),
    )
    .innerJoin(people, eq(tripLastMinutePromoRecipients.personId, people.id))
    .where(
      and(
        eq(tripLastMinutePromoRecipients.shopId, shopId),
        eq(tripLastMinutePromos.tripId, tripId),
      ),
    )
    .orderBy(asc(tripLastMinutePromoRecipients.createdAt), asc(people.fullName));
}

export type OutstandingLastMinutePromo = TripLastMinutePromo & {
  tripTitle: string;
  tripStartsAt: Date;
};

/** How many deals the Promos page's "Trip deals" list shows per page. */
export const TRIP_DEAL_PAGE_SIZE = PAGE_SIZE.list;

export type OutstandingLastMinutePromoPage = {
  deals: OutstandingLastMinutePromo[];
  page: number;
  pageCount: number;
  pageSize: number;
  total: number;
};

/**
 * Every `sent`, unexpired last-minute code across the whole shop, soonest to
 * expire first — the shop-wide counterpart to `listTripLastMinutePromos`'s
 * one-trip history. Backs the read-only "Trip deals" section on `/promos`
 * (task 148, UX-persona Lens 17): before this, a live trip-scoped code was
 * only ever visible from the one departure it was sent on, so a code nobody
 * remembered sending kept discounting quietly. `pending`/`failed` rows are
 * excluded — they were never redeemable and showing them here would just be
 * noise the trip's own send history already carries.
 *
 * One page at a time (ordered by expiry, then id for a stable tiebreak), same
 * idiom as `listShopPromoCodes` — offset-paged, so the Promos page's two lists
 * wear the same pager as every other staff list
 * (ADR 20260803-one-pagination-model).
 *
 * `now` bounds the list and so must bound the count too: both halves take the
 * same `scope`, or "page 1 of 3" would count deals that have already expired
 * out of the rows below it.
 */
export async function listOutstandingLastMinutePromos(
  db: DbExecutor,
  shopId: string,
  now: Date = nowDate(),
  options: { page?: number; limit?: number } = {},
): Promise<OutstandingLastMinutePromoPage> {
  const scope = and(
    eq(tripLastMinutePromos.shopId, shopId),
    eq(tripLastMinutePromos.status, "sent"),
    gt(tripLastMinutePromos.expiresAt, now),
  );

  const paged = await offsetPage({
    page: options.page,
    pageSize: options.limit ?? TRIP_DEAL_PAGE_SIZE,
    countRows: async () => {
      const [counted] = await db
        .select({ total: count() })
        .from(tripLastMinutePromos)
        .innerJoin(trips, eq(trips.id, tripLastMinutePromos.tripId))
        .where(and(scope, liveTrip()));
      return counted?.total ?? 0;
    },
    fetchRows: async (offset, limit) =>
      db
        .select({
          promo: tripLastMinutePromos,
          tripTitle: trips.title,
          tripStartsAt: trips.startsAt,
        })
        .from(tripLastMinutePromos)
        .innerJoin(trips, eq(trips.id, tripLastMinutePromos.tripId))
        .where(and(scope, liveTrip()))
        .orderBy(asc(tripLastMinutePromos.expiresAt), asc(tripLastMinutePromos.id))
        .limit(limit)
        .offset(offset),
  });

  return {
    deals: paged.rows.map(({ promo, tripTitle, tripStartsAt }) => ({
      ...promo,
      tripTitle,
      tripStartsAt,
    })),
    page: paged.page,
    pageCount: paged.pageCount,
    pageSize: paged.pageSize,
    total: paged.total,
  };
}

/**
 * Resolves a diver-typed code to a live, unexpired promotion issued for this
 * exact trip — the trip-scoping check that keeps a code from being reused on
 * an unrelated booking (docs ADR 20260727-last-minute-fill-promos). Returns
 * null on anything that doesn't match, rather than distinguishing "wrong
 * code" from "wrong trip" from "expired" — the diver-facing behavior is the
 * same either way (the code just doesn't apply).
 */
export async function getActiveTripPromoByCode(
  db: DbExecutor,
  input: { shopId: string; tripId: string; code: string; now?: Date },
): Promise<TripLastMinutePromo | null> {
  const code = input.code.trim().toUpperCase();
  if (!code) return null;
  const [row] = await db
    .select()
    .from(tripLastMinutePromos)
    .where(
      and(
        eq(tripLastMinutePromos.shopId, input.shopId),
        eq(tripLastMinutePromos.tripId, input.tripId),
        eq(tripLastMinutePromos.code, code),
        eq(tripLastMinutePromos.status, "sent"),
        gt(tripLastMinutePromos.expiresAt, input.now ?? nowDate()),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** Trip ids among `tripIds` that have never had a `sent` last-minute-deal blast. */
export async function tripIdsNeverSentLastMinuteDeal(
  db: DbExecutor,
  shopId: string,
  tripIds: string[],
): Promise<Set<string>> {
  if (tripIds.length === 0) return new Set();
  const sent = await db
    .select({ tripId: tripLastMinutePromos.tripId })
    .from(tripLastMinutePromos)
    .where(
      and(
        eq(tripLastMinutePromos.shopId, shopId),
        inArray(tripLastMinutePromos.tripId, tripIds),
        eq(tripLastMinutePromos.status, "sent"),
      ),
    );
  const alreadySent = new Set(sent.map((row) => row.tripId));
  return new Set(tripIds.filter((id) => !alreadySent.has(id)));
}
