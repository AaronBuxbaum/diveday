import { and, asc, eq, exists, inArray, isNull, lte, max, or, sql } from "drizzle-orm";
import { STAFF_ROLES } from "@/lib/authz";
import { nowDate } from "@/lib/clock";
import {
  CREW_NOTICE_SETTLE_MS,
  CREW_NOTICE_URGENT_MS,
  type CrewNoticeChange,
  netCrewNotices,
} from "@/lib/crew-notices";
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
import {
  type CrewNoticeOutcomeValue,
  crewNotices,
  people,
  personRoles,
  shops,
  tripAssignments,
  trips,
  userAccounts,
} from "./schema";
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

type ClaimedRow = { id: string; tripId: string; change: CrewNoticeChange; seq: number };

/** What one person's settled notices make, and what became of each row. */
type CrewNewsDraft = {
  notification: Notification | null;
  /** Rows the message speaks for, by trip; the rest are `netted` or `skipped`. */
  toldTripIds: Set<string>;
  /** Trips with news that could not be told: started, gone, or no longer running. */
  skippedTripIds: Set<string>;
  newsTripIds: Set<string>;
};

/**
 * The message this person's settled notices make, or null when netting leaves
 * nothing (an assign undone, a departure since cancelled or already gone).
 * Shared by the send and by the e2e preview, so the two cannot disagree.
 *
 * **Staff only** (security review L3): the recipient must still hold a staff
 * role at this shop, and a login, when they have one, must be active — a
 * person dismissed or disabled since the change hears nothing.
 */
async function draftCrewNews(
  db: DbExecutor,
  input: {
    shop: ShopRow;
    personId: string;
    rows: readonly ClaimedRow[];
    origin: string;
    now: Date;
  },
): Promise<CrewNewsDraft> {
  const news = netCrewNotices(input.rows);
  const newsTripIds = new Set(news.map((entry) => entry.tripId));
  const draft: CrewNewsDraft = {
    notification: null,
    toldTripIds: new Set(),
    skippedTripIds: new Set(),
    newsTripIds,
  };
  if (news.length === 0) return draft;
  const changeByTrip = new Map(news.map((entry) => [entry.tripId, entry.change]));
  const tripRows = await db
    .select({
      id: trips.id,
      title: trips.title,
      startsAt: trips.startsAt,
      status: trips.status,
      role: tripAssignments.tripRole,
    })
    .from(trips)
    .leftJoin(
      tripAssignments,
      and(eq(tripAssignments.tripId, trips.id), eq(tripAssignments.personId, input.personId)),
    )
    .where(and(liveTrip(), eq(trips.shopId, input.shop.id), inArray(trips.id, [...newsTripIds])))
    .orderBy(asc(trips.startsAt), asc(trips.id));
  // A departure is told while it is still ahead, and — unless the news is that
  // it was called off — still running.
  const tellable = tripRows.filter(
    (trip) =>
      trip.startsAt > input.now &&
      (trip.status === "scheduled" || changeByTrip.get(trip.id) === "called_off"),
  );
  const tellableIds = new Set(tellable.map((trip) => trip.id));
  for (const tripId of newsTripIds) {
    if (!tellableIds.has(tripId)) draft.skippedTripIds.add(tripId);
  }
  const listed = tellable.slice(0, MAX_CREW_NEWS_PER_MESSAGE);
  for (const trip of tellable.slice(MAX_CREW_NEWS_PER_MESSAGE)) draft.skippedTripIds.add(trip.id);
  if (listed.length === 0) return draft;

  const [recipient] = await db
    .select({
      fullName: people.fullName,
      personEmail: people.email,
      accountEmail: userAccounts.email,
      accountStatus: userAccounts.status,
      locale: people.locale,
    })
    .from(people)
    .leftJoin(userAccounts, eq(userAccounts.personId, people.id))
    .where(
      and(
        eq(people.id, input.personId),
        eq(people.shopId, input.shop.id),
        isNull(people.deletedAt),
        isNull(people.anonymizedAt),
        exists(
          db
            .select({ one: sql`1` })
            .from(personRoles)
            .where(
              and(eq(personRoles.personId, people.id), inArray(personRoles.role, [...STAFF_ROLES])),
            ),
        ),
      ),
    )
    .limit(1);
  if (!recipient || (recipient.accountStatus && recipient.accountStatus !== "active")) {
    return draft;
  }
  const to = recipient.accountEmail ?? recipient.personEmail;
  if (!to) return draft;

  // The newest row names the message: the same settled batch always yields
  // the same id, so a retried pass converges on one send.
  const newest = input.rows.reduce((a, b) => (b.seq > a.seq ? b : a));
  for (const trip of listed) draft.toldTripIds.add(trip.id);
  draft.notification = {
    kind: "crew_schedule_change",
    noticeId: newest.id,
    shopId: input.shop.id,
    to,
    // Staff mail in the staffer's own recorded language, else the shop's.
    locale: recipientLocale(recipient.locale, input.shop.defaultLocale),
    recipientName: recipient.fullName,
    shopName: input.shop.name,
    timezone: input.shop.timezone,
    changes: listed.map((trip) => ({
      change: changeByTrip.get(trip.id) as CrewNoticeChange,
      role: trip.role,
      tripTitle: trip.title,
      startsAt: trip.startsAt,
      tripUrl: `${input.origin}${shopPath(input.shop.slug, "trips", trip.id)}`,
    })),
  };
  return draft;
}

const shopColumns = {
  id: shops.id,
  slug: shops.slug,
  name: shops.name,
  timezone: shops.timezone,
  defaultLocale: shops.defaultLocale,
  isDemo: shops.isDemo,
};

type SendOptions = { now: Date; provider?: NotificationProvider; origin: string };

/**
 * Tell one person what their claimed rows add up to, and stamp every row with
 * what became of it — **a row is never settled in silence**: `sent`/`failed`
 * for what the message carried, `netted` for news that cancelled itself out,
 * `skipped` for a departure that had started or stopped running first,
 * `no_recipient` and `demo` for the rest.
 */
async function tellCrewMember(
  db: AppDb,
  shop: ShopRow,
  personId: string,
  claimed: readonly ClaimedRow[],
  options: SendOptions,
): Promise<"sent" | "failed" | "quiet"> {
  const stamp = async (ids: string[], outcome: CrewNoticeOutcomeValue) => {
    if (ids.length === 0) return;
    await db.update(crewNotices).set({ outcome }).where(inArray(crewNotices.id, ids));
  };
  if (shop.isDemo) {
    await stamp(
      claimed.map((row) => row.id),
      "demo",
    );
    return "quiet";
  }
  const draft = await draftCrewNews(db, {
    shop,
    personId,
    rows: claimed,
    origin: options.origin,
    now: options.now,
  });
  const idsWhere = (test: (row: ClaimedRow) => boolean) =>
    claimed.filter(test).map((row) => row.id);
  await stamp(
    idsWhere((row) => !draft.newsTripIds.has(row.tripId)),
    "netted",
  );
  const skipped = idsWhere((row) => draft.skippedTripIds.has(row.tripId));
  if (skipped.length > 0) {
    log("crew_notices.skipped", "warn", { shopId: shop.id, rows: skipped.length });
    await stamp(skipped, "skipped");
  }
  const told = idsWhere((row) => draft.toldTripIds.has(row.tripId));
  const unaddressed = idsWhere(
    (row) =>
      draft.newsTripIds.has(row.tripId) &&
      !draft.skippedTripIds.has(row.tripId) &&
      !draft.toldTripIds.has(row.tripId),
  );
  await stamp(unaddressed, "no_recipient");
  if (!draft.notification) return "quiet";
  const delivery = await sendNotification(db, draft.notification, options.provider);
  const sent = delivery.status === "sent";
  await stamp(told, sent ? "sent" : "failed");
  return sent ? "sent" : "failed";
}

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
  await tellEach(db, due, { now, provider: options.provider, origin }, summary, cutoff);
  return summary;
}

/**
 * **Late news goes now** (dive-domain review, 2026-10-09): straight after a
 * crew change or a call-off commits, everyone with pending news on one of
 * these departures is told at once — every call-off, and any change on a
 * departure leaving within `CREW_NOTICE_URGENT_MS` — rather than at the next
 * hour, which for a 07:00 boat changed at 06:10 is after it has sailed. A
 * person's other pending news rides along in the same message.
 *
 * Never throws: the change it follows has already committed, and a mail
 * failure must not read as the change failing. Rows it cannot send stay
 * pending for the hourly pass.
 */
export async function flushUrgentCrewNotices(
  db: AppDb,
  input: {
    shopId: string;
    tripIds: readonly string[];
    now?: Date;
    provider?: NotificationProvider;
    origin?: string | null;
  },
): Promise<CrewNoticePassSummary> {
  const now = input.now ?? nowDate();
  const summary: CrewNoticePassSummary = { settled: 0, sent: 0, failed: 0, quiet: 0 };
  if (input.tripIds.length === 0) return summary;
  try {
    const origin = input.origin === undefined ? publicAppUrl() : input.origin;
    if (!origin) return summary;
    const urgentBy = new Date(now.getTime() + CREW_NOTICE_URGENT_MS);
    const due = await db
      .selectDistinct({ shopId: crewNotices.shopId, personId: crewNotices.personId })
      .from(crewNotices)
      .innerJoin(trips, eq(trips.id, crewNotices.tripId))
      .where(
        and(
          eq(crewNotices.shopId, input.shopId),
          isNull(crewNotices.settledAt),
          inArray(crewNotices.tripId, [...input.tripIds]),
          or(eq(crewNotices.change, "called_off"), lte(trips.startsAt, urgentBy)),
        ),
      );
    await tellEach(db, due, { now, provider: input.provider, origin }, summary, null);
  } catch (error) {
    log("crew_notices.flush_failed", "error", {
      shopId: input.shopId,
      errorCode: error instanceof Error ? error.name : "unknown_error",
    });
  }
  return summary;
}

/** Claim and tell each person's pending rows (all of them, or those older than `cutoff`). */
async function tellEach(
  db: AppDb,
  due: readonly { shopId: string; personId: string }[],
  options: SendOptions,
  summary: CrewNoticePassSummary,
  cutoff: Date | null,
): Promise<void> {
  if (due.length === 0) return;
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
        .set({ settledAt: options.now })
        .where(
          and(
            eq(crewNotices.shopId, shopId),
            eq(crewNotices.personId, personId),
            isNull(crewNotices.settledAt),
            cutoff ? lte(crewNotices.createdAt, cutoff) : undefined,
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
      const told = await tellCrewMember(db, shop, personId, claimed, options);
      if (told === "sent") summary.sent += 1;
      else if (told === "failed") summary.failed += 1;
      else summary.quiet += 1;
    } catch (error) {
      summary.failed += 1;
      log("crew_notices.person_failed", "error", {
        shopId,
        errorCode: error instanceof Error ? error.name : "unknown_error",
      });
    }
  }
}

/**
 * Record a call-off for everyone on the crew of these departures, inside the
 * transaction that cancels them (`setTripStatus`). The caller tells them once
 * it commits (`flushUrgentCrewNotices`).
 */
export async function recordCrewCalledOff(
  tx: DbExecutor,
  input: { shopId: string; tripIds: readonly string[]; actorPersonId: string | null; now: Date },
): Promise<void> {
  if (input.tripIds.length === 0) return;
  const crew = await tx
    .select({ tripId: tripAssignments.tripId, personId: tripAssignments.personId })
    .from(tripAssignments)
    .innerJoin(trips, eq(trips.id, tripAssignments.tripId))
    .where(
      and(eq(trips.shopId, input.shopId), inArray(tripAssignments.tripId, [...input.tripIds])),
    );
  await recordCrewNotices(
    tx,
    crew.map((row) => ({
      shopId: input.shopId,
      tripId: row.tripId,
      personId: row.personId,
      change: "called_off" as const,
      actorPersonId: input.actorPersonId,
    })),
    input.now,
  );
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
  const draft = await draftCrewNews(db, {
    shop,
    personId: input.personId,
    rows,
    origin: input.origin,
    now,
  });
  return draft.notification;
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
