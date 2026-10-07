import { and, eq, gte, inArray, isNotNull, isNull, lte, min, ne, sql } from "drizzle-orm";
import type { CalendarDate } from "@/lib/calendar-date";
import { nowDate } from "@/lib/clock";
import {
  type DepartureRollCallEvent,
  type ReachedMilestones,
  SHOP_MILESTONES,
  type ShopMilestone,
} from "@/lib/founder-metrics";
import type { AppDb, DbExecutor } from "./client";
import {
  notificationRateLimitState,
  people,
  rollCallEvents,
  shopMilestones,
  shops,
  trips,
  userAccounts,
  waiverRecords,
} from "./schema";
import { liveTrip } from "./trips-live";

/**
 * The founder's numbers, read off the database (ADR 20261007-founder-metrics).
 * The definitions are `src/lib/founder-metrics.ts`'s; this file only fetches
 * what they need.
 *
 * **Only real shops count.** A minted demo and the canonical `blue-mantis`
 * fixture (both `is_demo`) are left out of every number here, or the north
 * star would read the demo's seeded roll calls as a shop running its days. So
 * is any shop nobody can sign into: the two listed shops the seed puts beside
 * the demo (`src/db/seed-listed-shops.ts`) are real rows with no staff and no
 * login, and a shop opened through `/onboard` always has its owner's account.
 * A sign-in is the line between a shop and a row, which is why it is the test
 * rather than a list of seeded slugs that a new seed would silently outgrow.
 */
export function realShop() {
  return and(
    eq(shops.isDemo, false),
    sql`exists (select 1 from ${userAccounts} inner join ${people} on ${people.id} = ${userAccounts.personId} where ${people.shopId} = ${shops.id})`,
  );
}

/**
 * Departure roll-call events for departures that started on `[from, to]` in
 * their shop's own calendar, for real shops. `countDiveDays` turns them into
 * the north star.
 */
export async function departureRollCallEvents(
  db: DbExecutor,
  range: { from: CalendarDate; to: CalendarDate },
): Promise<DepartureRollCallEvent[]> {
  const localDay = sql<string>`to_char(${trips.startsAt} at time zone ${shops.timezone}, 'YYYY-MM-DD')`;
  return db
    .select({
      shopId: rollCallEvents.shopId,
      bookingId: rollCallEvents.bookingId,
      localDay,
      status: rollCallEvents.status,
      occurredAt: rollCallEvents.occurredAt,
      createdAt: rollCallEvents.createdAt,
      seq: rollCallEvents.seq,
    })
    .from(rollCallEvents)
    .innerJoin(
      trips,
      and(eq(trips.id, rollCallEvents.tripId), eq(trips.shopId, rollCallEvents.shopId)),
    )
    .innerJoin(shops, eq(shops.id, rollCallEvents.shopId))
    .where(
      and(
        realShop(),
        liveTrip(),
        eq(rollCallEvents.checkpoint, "departure"),
        gte(localDay, range.from),
        lte(localDay, range.to),
      ),
    );
}

/**
 * Write every milestone the shops' own rows already prove, once. Each is the
 * earliest instant of its kind; a row already there is left alone, so the
 * first answer recorded is the one that stands.
 *
 * - `shop_created`: the shop row.
 * - `first_departure`: the first departure put on the board (`created_at`,
 *   the moment it was scheduled), deleted ones included — it happened.
 * - `first_signed_waiver`: the first release a diver signed themselves, which
 *   is what "the waiver went out before the day" means. A staff-attested paper
 *   release (`recorded_by_person_id`) and an imported record are not it.
 * - `first_roll_call`: the first diver boarded at any checkpoint.
 *
 * `first_public_booking` is not here: nothing on a booking row says which door
 * it came through, so the public booking action records it as it happens.
 */
export async function syncShopMilestones(db: AppDb): Promise<void> {
  const derived: Array<{
    milestone: ShopMilestone;
    rows: Promise<Array<{ shopId: string; reachedAt: Date | null }>>;
  }> = [
    {
      milestone: "shop_created",
      rows: db
        .select({ shopId: shops.id, reachedAt: shops.createdAt })
        .from(shops)
        .where(realShop()),
    },
    {
      milestone: "first_departure",
      rows: db
        .select({ shopId: trips.shopId, reachedAt: min(trips.createdAt) })
        .from(trips)
        // diveday:allow-deleted-trips: a departure that was scheduled and later deleted was still the shop's first step onto the board
        .innerJoin(shops, eq(shops.id, trips.shopId))
        .where(realShop())
        .groupBy(trips.shopId),
    },
    {
      milestone: "first_signed_waiver",
      rows: db
        .select({ shopId: waiverRecords.shopId, reachedAt: min(waiverRecords.signedAt) })
        .from(waiverRecords)
        .innerJoin(shops, eq(shops.id, waiverRecords.shopId))
        .where(
          and(
            realShop(),
            isNotNull(waiverRecords.signedAt),
            isNull(waiverRecords.recordedByPersonId),
            ne(waiverRecords.signatureMethod, "imported"),
          ),
        )
        .groupBy(waiverRecords.shopId),
    },
    {
      milestone: "first_roll_call",
      rows: db
        .select({ shopId: rollCallEvents.shopId, reachedAt: min(rollCallEvents.occurredAt) })
        .from(rollCallEvents)
        .innerJoin(shops, eq(shops.id, rollCallEvents.shopId))
        .where(and(realShop(), eq(rollCallEvents.status, "boarded")))
        .groupBy(rollCallEvents.shopId),
    },
  ];

  for (const { milestone, rows } of derived) {
    const values = (await rows)
      .filter((row): row is { shopId: string; reachedAt: Date } => row.reachedAt !== null)
      .map((row) => ({ shopId: row.shopId, milestone, reachedAt: row.reachedAt }));
    if (values.length === 0) continue;
    await db.insert(shopMilestones).values(values).onConflictDoNothing();
  }
}

/**
 * Record one milestone as it happens, if the shop has not reached it before.
 * The public booking action's door for `first_public_booking`, and the one
 * billing will use for `first_paid_month`. A demo or seeded shop is skipped:
 * nothing about it is a shop activating.
 */
export async function recordShopMilestone(
  db: DbExecutor,
  input: { shopId: string; milestone: ShopMilestone; at?: Date },
): Promise<void> {
  // Read by primary key first: after its first time a shop has this row for
  // good, and every later booking would otherwise pay for the real-shop
  // check's join to reach a no-op insert.
  const [reached] = await db
    .select({ shopId: shopMilestones.shopId })
    .from(shopMilestones)
    .where(
      and(eq(shopMilestones.shopId, input.shopId), eq(shopMilestones.milestone, input.milestone)),
    )
    .limit(1);
  if (reached) return;
  const [shop] = await db
    .select({ id: shops.id })
    .from(shops)
    .where(and(eq(shops.id, input.shopId), realShop()))
    .limit(1);
  if (!shop) return;
  await db
    .insert(shopMilestones)
    .values({ shopId: input.shopId, milestone: input.milestone, reachedAt: input.at ?? nowDate() })
    .onConflictDoNothing();
}

export type ShopActivation = {
  shopId: string;
  shopName: string;
  shopSlug: string;
  reached: ReachedMilestones;
  /** Milestones whose stall the founder has already been told about. */
  alerted: Set<ShopMilestone>;
};

/** Every real shop's recorded milestones, for the stall check. */
export async function listShopActivation(db: DbExecutor): Promise<ShopActivation[]> {
  const rows = await db
    .select({
      shopId: shops.id,
      shopName: shops.name,
      shopSlug: shops.slug,
      milestone: shopMilestones.milestone,
      reachedAt: shopMilestones.reachedAt,
      stallAlertedAt: shopMilestones.stallAlertedAt,
    })
    .from(shopMilestones)
    .innerJoin(shops, eq(shops.id, shopMilestones.shopId))
    .where(and(realShop(), inArray(shopMilestones.milestone, [...SHOP_MILESTONES])));

  const byShop = new Map<string, ShopActivation>();
  for (const row of rows) {
    const shop = byShop.get(row.shopId) ?? {
      shopId: row.shopId,
      shopName: row.shopName,
      shopSlug: row.shopSlug,
      reached: {},
      alerted: new Set<ShopMilestone>(),
    };
    shop.reached[row.milestone] = row.reachedAt;
    if (row.stallAlertedAt) shop.alerted.add(row.milestone);
    byShop.set(row.shopId, shop);
  }
  return [...byShop.values()];
}

/** The founder was told these shops stopped after these steps. */
export async function markStallsAlerted(
  db: AppDb,
  stalls: ReadonlyArray<{ shopId: string; milestone: ShopMilestone }>,
  at: Date = nowDate(),
): Promise<void> {
  for (const stall of stalls) {
    await db
      .update(shopMilestones)
      .set({ stallAlertedAt: at })
      .where(
        and(eq(shopMilestones.shopId, stall.shopId), eq(shopMilestones.milestone, stall.milestone)),
      );
  }
}

/**
 * Claim the right to send one week's digest. One statement, so two runs on
 * the same Monday cannot both send — the same claim the usage monitor takes on
 * the same table (`src/lib/usage/alert-ledger.ts` explains why a successful
 * send leaves nothing in `notification_send_queue` to deduplicate on). The
 * claim holds for a year: a digest week is never re-sent.
 */
export async function claimFounderDigest(
  db: AppDb,
  weekStart: CalendarDate,
  now: Date = nowDate(),
): Promise<boolean> {
  const until = new Date(now.getTime() + 366 * 86_400_000);
  const [claimed] = await db
    .insert(notificationRateLimitState)
    .values({ key: founderDigestKey(weekStart), nextAllowedAt: until })
    .onConflictDoUpdate({
      target: notificationRateLimitState.key,
      set: { nextAllowedAt: until },
      setWhere: lte(notificationRateLimitState.nextAllowedAt, now),
    })
    .returning({ key: notificationRateLimitState.key });
  return claimed !== undefined;
}

/** Give a week's claim back because its digest did not leave; the next run retries. */
export async function releaseFounderDigest(db: AppDb, weekStart: CalendarDate): Promise<void> {
  await db
    .delete(notificationRateLimitState)
    .where(eq(notificationRateLimitState.key, founderDigestKey(weekStart)));
}

function founderDigestKey(weekStart: CalendarDate): string {
  return `founder-digest/${weekStart}`;
}
