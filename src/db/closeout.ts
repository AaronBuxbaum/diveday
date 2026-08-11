import { and, count, desc, eq, gte, inArray, lt, ne } from "drizzle-orm";
import { type StaffTranslator, staffTranslator } from "@/i18n/staff-messages";
import { nowDate } from "@/lib/clock";
import {
  assembleDayCloseout,
  buildCloseoutSnapshot,
  type CloseoutSnapshot,
  type DayCloseoutState,
  type LeftoverDecision,
  parseCloseoutSnapshot,
  shopDayOf,
} from "@/lib/closeout";
import { shopDayBounds } from "@/lib/zoned";
import type { AppDb } from "./client";
import { bookings, dayCloseouts, people, trips } from "./schema";
import { getTodayWork, listRollCallGaps } from "./today";

/**
 * The db half of the end-of-day close-out (ADR 20260804-day-closeout).
 * `getDayCloseout` gathers the day's facts through the readers that already
 * own them — `listRollCallGaps` and `getTodayWork` (src/db/today.ts) — and
 * hands them to the pure assembly (src/lib/closeout.ts); `closeDay` appends
 * the recorded act. Nothing here detects anything of its own: a close-out
 * that counted a head count differently from the queue that chases it would
 * let the two disagree about whether a person is accounted for.
 */

/** One recorded close of a day, ready to render. */
export type DayCloseoutRecord = {
  id: string;
  shopDay: string;
  closedAt: Date;
  actorName: string;
  outstanding: CloseoutSnapshot;
};

export type DayCloseout = {
  state: DayCloseoutState;
  /** The most recent close of this day, or null while the day is still open. */
  latest: DayCloseoutRecord | null;
  /** How many times this day has been closed (re-closing appends, never edits). */
  closeCount: number;
};

/**
 * Today's departures in the shop's own calendar day — backwards-looking on
 * purpose, like `listRollCallGaps`: the boats this surface reconciles have
 * mostly already fallen out of every forward-looking reader.
 */
async function todaysTrips(db: AppDb, shopId: string, timeZone: string, now: Date) {
  const bounds = shopDayBounds(now, timeZone);
  const rows = await db
    .select({
      id: trips.id,
      title: trips.title,
      startsAt: trips.startsAt,
      endsAt: trips.endsAt,
      recapShoutout: trips.recapShoutout,
    })
    .from(trips)
    .where(
      and(
        eq(trips.shopId, shopId),
        // A cancelled trip never sailed; it has no end-state to confirm.
        eq(trips.status, "scheduled"),
        gte(trips.startsAt, bounds.from),
        lt(trips.startsAt, bounds.to),
      ),
    );
  if (rows.length === 0) return [];
  const counts = await db
    .select({ tripId: bookings.tripId, booked: count() })
    .from(bookings)
    .where(
      and(
        eq(bookings.shopId, shopId),
        inArray(
          bookings.tripId,
          rows.map((row) => row.id),
        ),
        ne(bookings.status, "cancelled"),
      ),
    )
    .groupBy(bookings.tripId);
  const bookedByTrip = new Map(counts.map((row) => [row.tripId, Number(row.booked)]));
  return rows.map((row) => ({
    tripId: row.id,
    title: row.title,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    booked: bookedByTrip.get(row.id) ?? 0,
    recapShoutout: row.recapShoutout,
  }));
}

async function assembleState(
  db: AppDb,
  shopId: string,
  shopSlug: string,
  timeZone: string,
  now: Date,
  t: StaffTranslator,
  locale: string,
  includeOpsAlerts: boolean,
): Promise<DayCloseoutState> {
  const [tripsToday, gaps, work] = await Promise.all([
    todaysTrips(db, shopId, timeZone, now),
    listRollCallGaps(db, shopId, now),
    getTodayWork(db, shopId, shopSlug, timeZone, now, undefined, t, locale, includeOpsAlerts),
  ]);
  return assembleDayCloseout({
    trips: tripsToday,
    gaps,
    actions: work.actions,
    timeZone,
    now,
  });
}

async function closesOfDay(db: AppDb, shopId: string, shopDay: string) {
  return db
    .select({
      id: dayCloseouts.id,
      shopDay: dayCloseouts.shopDay,
      closedAt: dayCloseouts.closedAt,
      outstanding: dayCloseouts.outstanding,
      actorName: people.fullName,
    })
    .from(dayCloseouts)
    .innerJoin(people, eq(people.id, dayCloseouts.actorPersonId))
    .where(and(eq(dayCloseouts.shopId, shopId), eq(dayCloseouts.shopDay, shopDay)))
    .orderBy(desc(dayCloseouts.seq));
}

function toRecord(row: Awaited<ReturnType<typeof closesOfDay>>[number]): DayCloseoutRecord {
  return {
    id: row.id,
    shopDay: row.shopDay,
    closedAt: row.closedAt,
    actorName: row.actorName,
    // Defensive parse: the column is ours, but a trail rendered for years must
    // not crash the page over one malformed historical row.
    outstanding: parseCloseoutSnapshot(row.outstanding),
  };
}

/**
 * Everything the close-out surface needs, in one pass.
 *
 * `includeOpsAlerts` mirrors the Today page's owner/manager gate: the
 * leftovers list is "what the Today queue would still show *you*", so it must
 * hold the same rows for the same viewer.
 */
export async function getDayCloseout(
  db: AppDb,
  shopId: string,
  shopSlug: string,
  timeZone: string,
  now: Date = nowDate(),
  t: StaffTranslator = staffTranslator("en-US"),
  locale = "en-US",
  includeOpsAlerts = false,
): Promise<DayCloseout> {
  const state = await assembleState(
    db,
    shopId,
    shopSlug,
    timeZone,
    now,
    t,
    locale,
    includeOpsAlerts,
  );
  const closes = await closesOfDay(db, shopId, state.shopDay);
  const latestRow = closes[0];
  return {
    state,
    latest: latestRow ? toRecord(latestRow) : null,
    closeCount: closes.length,
  };
}

/**
 * Close the day: append the recorded act. The outstanding snapshot is
 * **recomputed here**, never taken from the form — closing with outstanding
 * items must record exactly what was outstanding according to the source of
 * truth at the moment of closing, whatever a stale tab believed. `decisions`
 * only says what the closer chose to do with each leftover; ids the day does
 * not actually hold are ignored (src/lib/closeout.ts).
 *
 * Never a refusal: the human is the authority on their own day. The surface
 * makes closing over an open head count deliberate; nothing makes it
 * impossible, and nothing downstream conditions on the row existing.
 */
export async function closeDay(
  db: AppDb,
  input: {
    shopId: string;
    shopSlug: string;
    timeZone: string;
    actorPersonId: string;
    decisions: Readonly<Record<string, LeftoverDecision>>;
    now?: Date;
    t?: StaffTranslator;
    locale?: string;
    includeOpsAlerts?: boolean;
  },
): Promise<DayCloseoutRecord> {
  const now = input.now ?? nowDate();
  const t = input.t ?? staffTranslator("en-US");
  // Belt-and-braces tenant check: the session already ties actor to shop, but
  // an attributed trail row must never name someone from another shop.
  const [actor] = await db
    .select({ fullName: people.fullName })
    .from(people)
    .where(and(eq(people.id, input.actorPersonId), eq(people.shopId, input.shopId)))
    .limit(1);
  if (!actor) throw new Error("close-out actor is not a person of this shop");
  const state = await assembleState(
    db,
    input.shopId,
    input.shopSlug,
    input.timeZone,
    now,
    t,
    input.locale ?? "en-US",
    input.includeOpsAlerts ?? false,
  );
  const outstanding = buildCloseoutSnapshot(state, input.decisions);
  const [row] = await db
    .insert(dayCloseouts)
    .values({
      shopId: input.shopId,
      shopDay: shopDayOf(now, input.timeZone),
      actorPersonId: input.actorPersonId,
      closedAt: now,
      outstanding,
    })
    .returning({
      id: dayCloseouts.id,
      shopDay: dayCloseouts.shopDay,
      closedAt: dayCloseouts.closedAt,
    });
  if (!row) throw new Error("day close-out insert returned no row");
  return {
    id: row.id,
    shopDay: row.shopDay,
    closedAt: row.closedAt,
    actorName: actor.fullName,
    outstanding,
  };
}
