import { and, asc, eq, inArray, lt, ne } from "drizzle-orm";
import { nowMs } from "@/lib/clock";
import type { AppDb, DbExecutor } from "./client";
import { DEMO_SHOP_SLUG } from "./dev-credentials";
import {
  accountTokens,
  bookingCapabilities,
  bookingCheckoutBookings,
  bookingCheckouts,
  bookingPayments,
  bookings,
  buddyPairMembers,
  certifications,
  courseInquiries,
  coursePaths,
  courses,
  dayCloseouts,
  diveSiteCreatures,
  diveSiteMoments,
  diveSites,
  lastMinuteListEntries,
  lastMinuteListUnsubscribeTokens,
  mediaDeletionAttempts,
  nitroxCertifications,
  notificationDeliveries,
  notificationDeliveryAttempts,
  notificationSendQueue,
  orderLineItems,
  orders,
  paymentOperationIntents,
  people,
  personCourtesyEmailUnsubscribeTokens,
  personRoles,
  priorVisits,
  processorErasureObligations,
  recapPhotos,
  rentalFitProfiles,
  rollCallCrewAttestations,
  rollCallCrewEvents,
  rollCallEvents,
  shopPromoCodes,
  shopPromoRedemptions,
  shopStripeAccounts,
  shops,
  specialtyCertifications,
  tips,
  tripAssignments,
  tripDives,
  tripLastMinutePromos,
  tripRequirements,
  tripReviews,
  tripSeries,
  trips,
  tripWaitlistEntries,
  userAccounts,
  waiverRecords,
  waiverTemplates,
} from "./schema";
import { DAY_MS } from "./seed-clock";

/**
 * The life and death of a minted demo shop.
 *
 * "Try the live demo" mints a throwaway `isDemo` shop per visitor (ADR
 * 20260724-per-visitor-demo-shops), so something has to clean up after them:
 * a TTL reaper, a hard cascade delete that knows every child table, and an
 * aggregate live-count cap enforced before each mint. The canonical
 * blue-mantis demo and every real shop are never eligible for any of it.
 */

/** Default lifetime of a minted demo shop before the reaper clears it. */
export const DEFAULT_DEMO_TTL_MS = 7 * DAY_MS;

/**
 * Delete a demo shop and every row it owns. There is no `ON DELETE CASCADE` on
 * the shop-scoped foreign keys, so this is a hand-maintained topological delete:
 * every table that references bookings, trips, orders, checkouts, dive sites, or
 * people is cleared before those parents, and the shop row goes last. The
 * **global** dive-site catalog (`globalDiveSites`) is shared across shops and is
 * deliberately never touched.
 *
 * The guard on this ordering is `reap-demos.test.ts`, but read it before trusting
 * it: it is a set of hand-written per-table cases (a tip, an account token, a
 * last-minute unsubscribe token), **not** a sweep that proves every table is
 * empty. A new table with a shop-scoped FK is therefore invisible to it until
 * someone adds a case — which is exactly how
 * `last_minute_list_unsubscribe_tokens` slipped through and started aborting
 * every `/api/test/reset` mid-run. Adding a table here means adding its case
 * there in the same change.
 *
 * Never call this on the canonical blue-mantis demo or any real shop; the reaper
 * below only ever passes it a minted demo (`isDemo`, non-canonical slug).
 */
export async function deleteDemoShopCascade(db: DbExecutor, shopId: string): Promise<void> {
  const shopTrips = await db.select({ id: trips.id }).from(trips).where(eq(trips.shopId, shopId));
  const tripIds = shopTrips.map((t) => t.id);
  const shopPeople = await db
    .select({ id: people.id })
    .from(people)
    .where(eq(people.shopId, shopId));
  const personIds = shopPeople.map((p) => p.id);

  // Order/checkout/booking dependents first.
  await db.delete(orderLineItems).where(eq(orderLineItems.shopId, shopId));
  await db.delete(paymentOperationIntents).where(eq(paymentOperationIntents.shopId, shopId));
  await db.delete(orders).where(eq(orders.shopId, shopId));
  await db.delete(bookingCheckoutBookings).where(eq(bookingCheckoutBookings.shopId, shopId));
  // Redemptions reference checkouts; the codes themselves are referenced *by*
  // checkouts, so the codes go after them (docs ADR 20260729-shop-promo-codes).
  await db.delete(shopPromoRedemptions).where(eq(shopPromoRedemptions.shopId, shopId));
  await db.delete(bookingCheckouts).where(eq(bookingCheckouts.shopId, shopId));
  await db.delete(shopPromoCodes).where(eq(shopPromoCodes.shopId, shopId));
  await db.delete(bookingPayments).where(eq(bookingPayments.shopId, shopId));
  await db.delete(tips).where(eq(tips.shopId, shopId));
  await db.delete(bookingCapabilities).where(eq(bookingCapabilities.shopId, shopId));
  await db.delete(rollCallCrewAttestations).where(eq(rollCallCrewAttestations.shopId, shopId));
  await db.delete(rollCallCrewEvents).where(eq(rollCallCrewEvents.shopId, shopId));
  await db.delete(rollCallEvents).where(eq(rollCallEvents.shopId, shopId));
  // The close-out trail references people and the shop, so it must clear
  // before both parents below (ADR 20260804-day-closeout).
  await db.delete(dayCloseouts).where(eq(dayCloseouts.shopId, shopId));
  await db.delete(recapPhotos).where(eq(recapPhotos.shopId, shopId));
  await db.delete(tripReviews).where(eq(tripReviews.shopId, shopId));
  await db.delete(waiverRecords).where(eq(waiverRecords.shopId, shopId));
  await db
    .delete(notificationDeliveryAttempts)
    .where(eq(notificationDeliveryAttempts.shopId, shopId));
  await db.delete(notificationSendQueue).where(eq(notificationSendQueue.shopId, shopId));
  await db.delete(notificationDeliveries).where(eq(notificationDeliveries.shopId, shopId));
  await db.delete(tripWaitlistEntries).where(eq(tripWaitlistEntries.shopId, shopId));
  // Same reasoning as resetDemoSchedule above (docs ADR 20260727-last-minute-fill-promos),
  // including the unsubscribe tokens that reference the entries.
  await db.delete(tripLastMinutePromos).where(eq(tripLastMinutePromos.shopId, shopId));
  await db
    .delete(lastMinuteListUnsubscribeTokens)
    .where(eq(lastMinuteListUnsubscribeTokens.shopId, shopId));
  await db.delete(lastMinuteListEntries).where(eq(lastMinuteListEntries.shopId, shopId));
  // References people, same reasoning as resetDemoSchedule above.
  await db
    .delete(personCourtesyEmailUnsubscribeTokens)
    .where(eq(personCourtesyEmailUnsubscribeTokens.shopId, shopId));
  if (tripIds.length > 0) {
    await db.delete(tripAssignments).where(inArray(tripAssignments.tripId, tripIds));
    await db.delete(tripDives).where(inArray(tripDives.tripId, tripIds));
  }
  await db.delete(tripRequirements).where(eq(tripRequirements.shopId, shopId));
  // Buddy pairs reference bookings, so they go before the bookings delete
  // (ADR 20260804-buddy-pairs).
  await db.delete(buddyPairMembers).where(eq(buddyPairMembers.shopId, shopId));
  await db.delete(bookings).where(eq(bookings.shopId, shopId));
  await db.delete(trips).where(eq(trips.shopId, shopId));
  await db.delete(tripSeries).where(eq(tripSeries.shopId, shopId));

  // People-scoped records and the shop's own catalog/config.
  await db.delete(certifications).where(eq(certifications.shopId, shopId));
  await db.delete(specialtyCertifications).where(eq(specialtyCertifications.shopId, shopId));
  await db.delete(nitroxCertifications).where(eq(nitroxCertifications.shopId, shopId));
  await db.delete(rentalFitProfiles).where(eq(rentalFitProfiles.shopId, shopId));
  await db.delete(priorVisits).where(eq(priorVisits.shopId, shopId));
  await db.delete(diveSiteMoments).where(eq(diveSiteMoments.shopId, shopId));
  await db.delete(diveSiteCreatures).where(eq(diveSiteCreatures.shopId, shopId));
  await db.delete(diveSites).where(eq(diveSites.shopId, shopId));
  // Paths first: their steps cascade from either side, but a path row itself
  // is only shop-scoped, so deleting courses alone would strand it. A course
  // inquiry references its course without cascade (a lead is evidence, not
  // something a schedule reset should silently vanish), so it must go before
  // the courses delete or this FK-violates and aborts the whole reset mid-run
  // — the same class of bug the comment above already walks.
  await db.delete(coursePaths).where(eq(coursePaths.shopId, shopId));
  await db.delete(courseInquiries).where(eq(courseInquiries.shopId, shopId));
  await db.delete(courses).where(eq(courses.shopId, shopId));
  await db.delete(waiverTemplates).where(eq(waiverTemplates.shopId, shopId));
  await db.delete(shopStripeAccounts).where(eq(shopStripeAccounts.shopId, shopId));
  await db.delete(mediaDeletionAttempts).where(eq(mediaDeletionAttempts.shopId, shopId));
  // References both shops and people (ADR 20260803-processor-erasure-obligations),
  // so it must go before the people/shops deletes below or reaping a demo shop
  // whose visitor tried the erasure flow FK-violates and strands the shop past
  // its TTL — the same class of bug the account-tokens comment below walks.
  await db
    .delete(processorErasureObligations)
    .where(eq(processorErasureObligations.shopId, shopId));

  if (personIds.length > 0) {
    // Account tokens reference user_accounts, one layer further down the same
    // chain the comment above already walks — a demo owner who ever requested
    // a reset link leaves one behind, and it must go before user_accounts or
    // this FK-violates and strands the shop past the reaper's TTL (security
    // review finding on 20260725-account-lifecycle-emails).
    const demoAccountIds = (
      await db
        .select({ id: userAccounts.id })
        .from(userAccounts)
        .where(inArray(userAccounts.personId, personIds))
    ).map((row) => row.id);
    if (demoAccountIds.length > 0) {
      await db.delete(accountTokens).where(inArray(accountTokens.userAccountId, demoAccountIds));
    }
    await db.delete(userAccounts).where(inArray(userAccounts.personId, personIds));
    await db.delete(personRoles).where(inArray(personRoles.personId, personIds));
  }
  await db.delete(people).where(eq(people.shopId, shopId));
  await db.delete(shops).where(eq(shops.id, shopId));
}

/**
 * Clear minted demo shops older than `maxAgeMs`. Selects only `isDemo` shops
 * whose slug is not the canonical demo — so blue-mantis and every real shop are
 * untouchable here — and deletes each in its own transaction so one failure
 * doesn't strand the rest. Time comes through `now` (clock rule); the cron route
 * supplies the TTL from env.
 */
export async function reapExpiredDemoShops(
  db: AppDb,
  opts: { now?: number; maxAgeMs?: number } = {},
): Promise<{ deleted: number; slugs: string[] }> {
  const now = opts.now ?? nowMs();
  const maxAgeMs = opts.maxAgeMs ?? DEFAULT_DEMO_TTL_MS;
  const cutoff = new Date(now - maxAgeMs);

  const expired = await db
    .select({ id: shops.id, slug: shops.slug })
    .from(shops)
    .where(
      and(eq(shops.isDemo, true), ne(shops.slug, DEMO_SHOP_SLUG), lt(shops.createdAt, cutoff)),
    );

  for (const shop of expired) {
    await db.transaction(async (tx) => deleteDemoShopCascade(tx, shop.id));
  }
  return { deleted: expired.length, slugs: expired.map((s) => s.slug) };
}

/**
 * Delete every minted demo shop right now, regardless of age — the canonical
 * blue-mantis demo and all real shops are left alone. The e2e reset uses this so
 * the shared test database doesn't accumulate the disposable shops each "Try the
 * live demo" mints (age-based reaping is unreliable under the frozen e2e clock,
 * since `created_at` is a real wall-clock default).
 */
export async function purgeMintedDemoShops(db: AppDb): Promise<number> {
  const minted = await db
    .select({ id: shops.id })
    .from(shops)
    .where(and(eq(shops.isDemo, true), ne(shops.slug, DEMO_SHOP_SLUG)));
  for (const shop of minted) {
    await db.transaction(async (tx) => deleteDemoShopCascade(tx, shop.id));
  }
  return minted.length;
}

/**
 * Hard ceiling on how many minted demo shops may exist at once — the aggregate
 * bound the per-IP rate limit can't provide (security review, finding 1).
 * `DEMO_SHOP_MAX_LIVE` overrides it; a non-positive or non-numeric value keeps
 * the default.
 */
export const DEFAULT_DEMO_SHOP_MAX_LIVE = 200;

function mintedDemoCap(): number {
  const configured = Number(process.env.DEMO_SHOP_MAX_LIVE);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_DEMO_SHOP_MAX_LIVE;
}

/**
 * Evict the oldest minted demos until there is room for one more under the cap.
 * Only minted demos are ever eligible — the canonical blue-mantis demo (by slug)
 * and every real shop (`isDemo:false`) are excluded, so this can never delete a
 * real tenant. Runs inside the caller's transaction so the eviction and the new
 * mint commit together.
 */
export async function enforceMintedDemoCap(db: DbExecutor): Promise<void> {
  const cap = mintedDemoCap();
  const live = await db
    .select({ id: shops.id })
    .from(shops)
    .where(and(eq(shops.isDemo, true), ne(shops.slug, DEMO_SHOP_SLUG)))
    .orderBy(asc(shops.createdAt));
  const toEvict = live.length - (cap - 1);
  for (let i = 0; i < toEvict; i++) {
    await deleteDemoShopCascade(db, live[i].id);
  }
}
