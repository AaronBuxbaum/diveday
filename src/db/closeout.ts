import { and, count, desc, eq, gte, inArray, lt, ne } from "drizzle-orm";
import { type StaffTranslator, staffTranslator } from "@/i18n/staff-messages";
import { nowDate } from "@/lib/clock";
import {
  assembleDayCloseout,
  buildCloseoutSnapshot,
  type CloseoutAdminTask,
  type CloseoutSnapshot,
  closeoutAdminTaskStatus,
  type DayCloseoutState,
  type LeftoverDecision,
  parseCloseoutSnapshot,
  shopDayOf,
} from "@/lib/closeout";
import { shopDayBounds } from "@/lib/zoned";
import type { AppDb } from "./client";
import {
  bookings,
  dayCloseouts,
  notificationDeliveries,
  people,
  recapPhotos,
  tripRecapPhotos,
  trips,
} from "./schema";
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

/** The only close-out refusal: an open person-safety state needs an explicit acknowledgement. */
export class CloseoutAcknowledgementRequired extends Error {
  constructor() {
    super("close-out acknowledgement required");
    this.name = "CloseoutAcknowledgementRequired";
  }
}

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
  const [counts, photos, crewPhotos] = await Promise.all([
    db
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
      .groupBy(bookings.tripId),
    db
      .select({
        id: recapPhotos.id,
        imageUrl: recapPhotos.imageUrl,
        caption: recapPhotos.caption,
        diverName: people.fullName,
        bookingId: recapPhotos.bookingId,
        tripId: recapPhotos.tripId,
      })
      .from(recapPhotos)
      .innerJoin(bookings, eq(bookings.id, recapPhotos.bookingId))
      .innerJoin(people, eq(people.id, bookings.personId))
      .where(
        and(
          eq(recapPhotos.shopId, shopId),
          inArray(
            recapPhotos.tripId,
            rows.map((row) => row.id),
          ),
        ),
      )
      .orderBy(desc(recapPhotos.createdAt)),
    db
      .select({
        id: tripRecapPhotos.id,
        imageUrl: tripRecapPhotos.imageUrl,
        tripId: tripRecapPhotos.tripId,
      })
      .from(tripRecapPhotos)
      .where(
        and(
          eq(tripRecapPhotos.shopId, shopId),
          inArray(
            tripRecapPhotos.tripId,
            rows.map((row) => row.id),
          ),
        ),
      )
      .orderBy(desc(tripRecapPhotos.createdAt)),
  ]);
  const bookedByTrip = new Map(counts.map((row) => [row.tripId, Number(row.booked)]));
  const photosByTrip = new Map<string, typeof photos>();
  for (const photo of photos) {
    const list = photosByTrip.get(photo.tripId) ?? [];
    list.push(photo);
    photosByTrip.set(photo.tripId, list);
  }
  const crewPhotosByTrip = new Map<string, typeof crewPhotos>();
  for (const photo of crewPhotos) {
    const list = crewPhotosByTrip.get(photo.tripId) ?? [];
    list.push(photo);
    crewPhotosByTrip.set(photo.tripId, list);
  }
  return rows.map((row) => ({
    tripId: row.id,
    title: row.title,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    booked: bookedByTrip.get(row.id) ?? 0,
    recapShoutout: row.recapShoutout,
    photos: photosByTrip.get(row.id) ?? [],
    crewPhotos: crewPhotosByTrip.get(row.id) ?? [],
  }));
}

/**
 * Post-dive reports are a task over existing notification state, not a second
 * delivery system. A missing `trip_recap` row is pending; a send or provider
 * failure needs attention; every successful send is complete. Only returned
 * trips in today's shop-local day participate in the ritual.
 */
async function postDiveReportTask(
  db: AppDb,
  shopId: string,
  tripsToday: Awaited<ReturnType<typeof todaysTrips>>,
  now: Date,
): Promise<CloseoutAdminTask | null> {
  const endedTripIds = tripsToday.filter((trip) => trip.endsAt <= now).map((trip) => trip.tripId);
  if (endedTripIds.length === 0) return null;

  const rows = await db
    .select({
      deliveryStatus: notificationDeliveries.status,
      providerStatus: notificationDeliveries.providerStatus,
    })
    .from(bookings)
    .leftJoin(
      notificationDeliveries,
      and(
        eq(notificationDeliveries.bookingId, bookings.id),
        eq(notificationDeliveries.shopId, shopId),
        eq(notificationDeliveries.kind, "trip_recap"),
      ),
    )
    .where(
      and(
        eq(bookings.shopId, shopId),
        inArray(bookings.tripId, endedTripIds),
        ne(bookings.status, "cancelled"),
        ne(bookings.status, "no_show"),
      ),
    );
  if (rows.length === 0) return null;

  const failedProviderStatuses = new Set(["bounced", "complained", "failed", "suppressed"]);
  let completed = 0;
  let failed = 0;
  for (const row of rows) {
    if (
      row.deliveryStatus === "failed" ||
      row.deliveryStatus === "not_configured" ||
      (row.providerStatus !== null && failedProviderStatuses.has(row.providerStatus))
    ) {
      failed++;
    } else if (row.deliveryStatus === "sent") {
      completed++;
    }
  }
  const pending = rows.length - completed - failed;
  return {
    id: "post_dive_reports",
    total: rows.length,
    completed,
    pending,
    failed,
    status: closeoutAdminTaskStatus({
      total: rows.length,
      completed,
      pending,
      failed,
    }),
  };
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
  const adminTask = await postDiveReportTask(db, shopId, tripsToday, now);
  return assembleDayCloseout({
    trips: tripsToday,
    gaps,
    actions: work.actions,
    adminTasks: adminTask ? [adminTask] : [],
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
    acknowledged?: boolean;
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
  if (state.mustAcknowledge.length > 0 && !input.acknowledged) {
    throw new CloseoutAcknowledgementRequired();
  }
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
