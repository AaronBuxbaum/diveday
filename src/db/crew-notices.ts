import { and, asc, eq, gt, inArray, isNull, lte, max, sql } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import { CREW_NOTICE_SETTLE_MS, type CrewNoticeChange, netCrewNotices } from "@/lib/crew-notices";
import { log } from "@/lib/log";
import {
  type Notification,
  type NotificationProvider,
  publicAppUrl,
  recipientLocale,
} from "@/lib/notifications";
import { shopPath } from "@/lib/staff-notices";
import type { AppDb, DbExecutor } from "./client";
import { sendNotification } from "./notifications";
import { crewNotices, people, shops, trips, userAccounts } from "./schema";
import { liveTrip } from "./trips-live";

/**
 * Pending crew news and the hourly pass that tells it (ADR
 * 20261009-crew-hear-about-their-boats). The netting rule is
 * `src/lib/crew-notices.ts`; this module stores and sends.
 */

/** Most departures one message lists; the schema's own cap. */
export const MAX_CREW_NEWS_PER_MESSAGE = 50;

export type CrewNoticeInput = {
  shopId: string;
  personId: string;
  tripId: string;
  change: CrewNoticeChange;
  /** Who made the change; `null` when no person did. */
  actorPersonId: string | null;
};

/**
 * Record crew changes as pending news, inside the caller's transaction so a
 * notice exists exactly when the change it describes does.
 *
 * **The actor is never told about their own act**: a row whose person made
 * the change is dropped here, at the one place every writer passes through.
 */
export async function recordCrewNotices(
  tx: DbExecutor,
  notices: readonly CrewNoticeInput[],
  now: Date = nowDate(),
): Promise<void> {
  const told = notices.filter((notice) => notice.personId !== notice.actorPersonId);
  if (told.length === 0) return;
  await tx.insert(crewNotices).values(told.map((notice) => ({ ...notice, createdAt: now })));
}

export type CrewNoticePassSummary = {
  /** People whose crew had been still long enough this pass. */
  settled: number;
  sent: number;
  failed: number;
  /** Settled with nothing left to say after netting, or nobody to say it to. */
  quiet: number;
};

type ShopRow = {
  id: string;
  slug: string;
  name: string;
  timezone: string;
  defaultLocale: string;
  isDemo: boolean;
};

/**
 * The message this person's settled notices make, or null when netting leaves
 * nothing (an assign undone, a departure since cancelled or already gone).
 * Shared by the send and by the e2e preview, so the two cannot disagree.
 */
async function crewNewsNotification(
  db: DbExecutor,
  input: {
    shop: ShopRow;
    personId: string;
    rows: { id: string; tripId: string; change: CrewNoticeChange; seq: number }[];
    origin: string;
    now: Date;
  },
): Promise<Notification | null> {
  const news = netCrewNotices(input.rows);
  if (news.length === 0) return null;
  const tripRows = await db
    .select({ id: trips.id, title: trips.title, startsAt: trips.startsAt })
    .from(trips)
    .where(
      and(
        liveTrip(),
        eq(trips.shopId, input.shop.id),
        eq(trips.status, "scheduled"),
        gt(trips.startsAt, input.now),
        inArray(
          trips.id,
          news.map((entry) => entry.tripId),
        ),
      ),
    )
    .orderBy(asc(trips.startsAt));
  const changeByTrip = new Map(news.map((entry) => [entry.tripId, entry.change]));
  const changes = tripRows.slice(0, MAX_CREW_NEWS_PER_MESSAGE).map((trip) => ({
    change: changeByTrip.get(trip.id) as CrewNoticeChange,
    tripTitle: trip.title,
    startsAt: trip.startsAt,
    tripUrl: `${input.origin}${shopPath(input.shop.slug, "trips", trip.id)}`,
  }));
  if (changes.length === 0) return null;

  const [recipient] = await db
    .select({
      fullName: people.fullName,
      personEmail: people.email,
      accountEmail: userAccounts.email,
      locale: people.locale,
    })
    .from(people)
    .leftJoin(
      userAccounts,
      and(eq(userAccounts.personId, people.id), eq(userAccounts.status, "active")),
    )
    .where(
      and(
        eq(people.id, input.personId),
        eq(people.shopId, input.shop.id),
        isNull(people.deletedAt),
        isNull(people.anonymizedAt),
      ),
    )
    .limit(1);
  const to = recipient?.accountEmail ?? recipient?.personEmail;
  if (!recipient || !to) return null;

  // The newest row names the message: the same settled batch always yields
  // the same id, so a retried pass converges on one send.
  const newest = input.rows.reduce((a, b) => (b.seq > a.seq ? b : a));
  return {
    kind: "crew_schedule_change",
    noticeId: newest.id,
    shopId: input.shop.id,
    to,
    // Staff mail in the staffer's own recorded language, else the shop's.
    locale: recipientLocale(recipient.locale, input.shop.defaultLocale),
    recipientName: recipient.fullName,
    shopName: input.shop.name,
    timezone: input.shop.timezone,
    changes,
  };
}

const shopColumns = {
  id: shops.id,
  slug: shops.slug,
  name: shops.name,
  timezone: shops.timezone,
  defaultLocale: shops.defaultLocale,
  isDemo: shops.isDemo,
};

/**
 * **The hourly pass.** Every person whose newest pending notice is at least
 * `CREW_NOTICE_SETTLE_MS` old has their settled notices claimed (stamped
 * `settled_at` in the same statement that selects them, so two passes cannot
 * both send), netted, and sent as one message.
 *
 * Demo shops settle without sending: their staff are seeded addresses, as the
 * Monday email decides for the same reason.
 *
 * Not queued on a retryable failure (`notificationIsQueueable`): a crew
 * message a day late can say the wrong thing about a boat that has since
 * changed, and the staffing week and calendar feed say the truth meanwhile.
 */
export async function sendDueCrewNotices(
  db: AppDb,
  options: { now?: Date; provider?: NotificationProvider; origin?: string | null } = {},
): Promise<CrewNoticePassSummary> {
  const now = options.now ?? nowDate();
  const summary: CrewNoticePassSummary = { settled: 0, sent: 0, failed: 0, quiet: 0 };
  const origin = options.origin === undefined ? publicAppUrl() : options.origin;
  if (!origin) {
    log("crew_notices.no_origin", "error", {});
    return summary;
  }
  const cutoff = new Date(now.getTime() - CREW_NOTICE_SETTLE_MS);
  const due = await db
    .select({ shopId: crewNotices.shopId, personId: crewNotices.personId })
    .from(crewNotices)
    .where(isNull(crewNotices.settledAt))
    .groupBy(crewNotices.shopId, crewNotices.personId)
    .having(lte(max(crewNotices.createdAt), cutoff));
  if (due.length === 0) return summary;

  const shopRows = await db
    .select(shopColumns)
    .from(shops)
    .where(
      inArray(
        shops.id,
        due.map((row) => row.shopId),
      ),
    );
  const shopById = new Map(shopRows.map((shop) => [shop.id, shop]));

  for (const { shopId, personId } of due) {
    const shop = shopById.get(shopId);
    if (!shop) continue;
    try {
      const claimed = await db
        .update(crewNotices)
        .set({ settledAt: now })
        .where(
          and(
            eq(crewNotices.shopId, shopId),
            eq(crewNotices.personId, personId),
            isNull(crewNotices.settledAt),
            lte(crewNotices.createdAt, cutoff),
          ),
        )
        .returning({
          id: crewNotices.id,
          tripId: crewNotices.tripId,
          change: crewNotices.change,
          seq: crewNotices.seq,
        });
      if (claimed.length === 0) continue;
      summary.settled += 1;
      const notification = shop.isDemo
        ? null
        : await crewNewsNotification(db, { shop, personId, rows: claimed, origin, now });
      if (!notification) {
        summary.quiet += 1;
        continue;
      }
      const delivery = await sendNotification(db, notification, options.provider);
      if (delivery.status === "sent") summary.sent += 1;
      else summary.failed += 1;
    } catch (error) {
      summary.failed += 1;
      log("crew_notices.person_failed", "error", {
        shopId,
        errorCode: error instanceof Error ? error.name : "unknown_error",
      });
    }
  }
  return summary;
}

/**
 * The message this person would get if their pending notices settled now —
 * claiming nothing and sending nothing. The e2e spec reads it through
 * `/api/test/crew-notices`; a staff surface could, later.
 */
export async function previewCrewNotices(
  db: AppDb,
  input: { shopId: string; personId: string; origin: string; now?: Date },
): Promise<Notification | null> {
  const now = input.now ?? nowDate();
  const [shop] = await db.select(shopColumns).from(shops).where(eq(shops.id, input.shopId));
  if (!shop) return null;
  const rows = await db
    .select({
      id: crewNotices.id,
      tripId: crewNotices.tripId,
      change: crewNotices.change,
      seq: crewNotices.seq,
    })
    .from(crewNotices)
    .where(
      and(
        eq(crewNotices.shopId, input.shopId),
        eq(crewNotices.personId, input.personId),
        isNull(crewNotices.settledAt),
      ),
    );
  if (rows.length === 0) return null;
  return crewNewsNotification(db, {
    shop,
    personId: input.personId,
    rows,
    origin: input.origin,
    now,
  });
}

/** How many notices are still waiting for this person — the tests' window onto the outbox. */
export async function countPendingCrewNotices(
  db: DbExecutor,
  shopId: string,
  personId: string,
): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)`.mapWith(Number) })
    .from(crewNotices)
    .where(
      and(
        eq(crewNotices.shopId, shopId),
        eq(crewNotices.personId, personId),
        isNull(crewNotices.settledAt),
      ),
    );
  return row?.n ?? 0;
}
