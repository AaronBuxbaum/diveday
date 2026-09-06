import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  max,
  ne,
  notInArray,
  sql,
} from "drizzle-orm";
import { type StaffTranslator, staffTranslator } from "@/i18n/staff-messages";
import { HOUR_MS, nowDate } from "@/lib/clock";
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
import type { CrewRollCallSubject } from "@/lib/manifests";
import { carryForwardNotBoarded, rollCallCheckpoints } from "@/lib/roll-call";
import type { TodayAction } from "@/lib/today";
import { shopDayBounds } from "@/lib/zoned";
import type { AppDb } from "./client";
import {
  bookings,
  closeoutLeftoverDecisions,
  dayCloseouts,
  diveSites,
  executedDives,
  notificationDeliveries,
  people,
  recapPhotos,
  rollCallCrewEvents,
  rollCallEvents,
  tripAssignments,
  tripDives,
  tripRecapPhotos,
  trips,
} from "./schema";
import { getTodayWork, listRollCallGaps } from "./today";
import { tripIdsNeverSentLastMinuteDeal } from "./trip-promos";
import { liveTrip } from "./trips-live";

/**
 * The db half of the day's closing state (ADR 20260804-day-closeout, folded
 * into the shop home by 20260827-clearwater-surface-language's decision 4).
 * `getDayCloseout` gathers the day's facts through the readers that already
 * own them — `listRollCallGaps` and `getTodayWork` (src/db/today.ts) — and
 * hands them to the pure assembly (src/lib/closeout.ts); `closeDay` appends
 * the recorded act. Nothing here detects anything of its own: an evening that
 * counted a head count differently from the queue that chases it would let the
 * two disagree about whether a person is accounted for.
 *
 * Its one caller is the shop home. `/close-out` is a 308 (H-62), so this file
 * lost a page and kept every fact.
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
 * Read the latest choice for each leftover in one shop-local day. The table is
 * append-only, so a descending sequence and first-seen map give deterministic
 * last-write-wins semantics even when the test/e2e clock is frozen.
 */
export async function listLatestLeftoverDecisions(
  db: AppDb,
  shopId: string,
  shopDay: string,
): Promise<Readonly<Record<string, LeftoverDecision>>> {
  const rows = await db
    .select({
      actionId: closeoutLeftoverDecisions.actionId,
      decision: closeoutLeftoverDecisions.decision,
    })
    .from(closeoutLeftoverDecisions)
    .where(
      and(
        eq(closeoutLeftoverDecisions.shopId, shopId),
        eq(closeoutLeftoverDecisions.shopDay, shopDay),
      ),
    )
    .orderBy(desc(closeoutLeftoverDecisions.seq));
  const latest: Record<string, LeftoverDecision> = Object.create(null);
  for (const row of rows) {
    if (
      !Object.hasOwn(latest, row.actionId) &&
      (row.decision === "carry" || row.decision === "dismiss")
    ) {
      latest[row.actionId] = row.decision;
    }
  }
  return latest;
}

/** Append one per-row close-out choice. There is deliberately no update/delete path. */
export async function recordLeftoverDecision(
  db: AppDb,
  input: {
    shopId: string;
    shopDay: string;
    actionId: string;
    decision: LeftoverDecision;
    actorPersonId: string;
    decidedAt?: Date;
  },
): Promise<void> {
  if (!input.actionId || input.actionId.length > 200)
    throw new Error("invalid close-out action id");
  if (input.decision !== "carry" && input.decision !== "dismiss") {
    throw new Error("invalid close-out leftover decision");
  }
  const [actor] = await db
    .select({ id: people.id })
    .from(people)
    .where(and(eq(people.id, input.actorPersonId), eq(people.shopId, input.shopId)))
    .limit(1);
  if (!actor) throw new Error("close-out actor is not a person of this shop");
  await db.insert(closeoutLeftoverDecisions).values({
    shopId: input.shopId,
    shopDay: input.shopDay,
    actionId: input.actionId,
    decision: input.decision,
    actorPersonId: input.actorPersonId,
    decidedAt: input.decidedAt,
  });
}

/**
 * One trip's assigned crew as the closing checkpoint sees them.
 *
 * Carry-forward is the reason this is a function rather than a lookup: a crew
 * member marked ashore at the dock with nothing after it is *accounted for* at
 * every later checkpoint (`carryForwardNotBoarded`, src/lib/roll-call.ts), and
 * reading only the last checkpoint's own row would call them awaiting and hold
 * the evening open over somebody who never left the dock. The same walk the
 * manifest makes, on the same function.
 */
function crewSubjectsAtClose(
  plannedDives: number,
  personIds: readonly string[],
  standing: (personId: string, checkpoint: string) => "boarded" | "not_boarded" | undefined,
): CrewRollCallSubject[] {
  const checkpoints = rollCallCheckpoints(plannedDives);
  return personIds.map((personId) => {
    const perCheckpoint = checkpoints.map((checkpoint) => {
      const state = standing(personId, checkpoint);
      return state ? { state } : undefined;
    });
    return { rollCall: carryForwardNotBoarded(perCheckpoint).at(-1) };
  });
}

/**
 * How far back the evening looks for a departure to compare a short boat with
 * (issue #1207, D47). A season, roughly — far enough that a weekly charter has
 * run a dozen times, near enough that the comparison is about this year's
 * market rather than last year's. One constant, deliberately: it is the
 * implementing session's call rather than the issue's, and it is meant to be
 * easy to move.
 */
const COMPARABLE_HORIZON_MS = 90 * 24 * HOUR_MS;

/**
 * **The comparable departure** — the most recent same-title trip that filled,
 * per departure of today.
 *
 * One query, one `where`, one `having`: the capacity comparison rides inside
 * the same grouped read that produces the row, so the count and the row can
 * never disagree about which departures qualify. Splitting them is the classic
 * bug on exactly this kind of view, and #1207's triage names it.
 *
 * **It carries no crew, no rank and no rate**, and it must not grow any. D47's
 * boundary is that the evening states facts about seats, never a scoreboard
 * about people, and the surest way to keep it one is to have nothing here that
 * could become one.
 */
async function comparableDepartures(
  db: AppDb,
  shopId: string,
  today: readonly { id: string; title: string; startsAt: Date; priceCents: number | null }[],
): Promise<Map<string, { title: string; startsAt: Date; samePrice: boolean } | null>> {
  const answer = new Map<string, { title: string; startsAt: Date; samePrice: boolean } | null>(
    today.map((trip) => [trip.id, null]),
  );
  if (today.length === 0) return answer;
  const startTimes = today.map((trip) => trip.startsAt.getTime());
  const horizon = new Date(Math.min(...startTimes) - COMPARABLE_HORIZON_MS);
  const latest = new Date(Math.max(...startTimes));

  const candidates = await db
    .select({
      title: trips.title,
      startsAt: trips.startsAt,
      endsAt: trips.endsAt,
      priceCents: trips.priceCents,
    })
    .from(trips)
    .leftJoin(
      bookings,
      and(
        eq(bookings.tripId, trips.id),
        eq(bookings.shopId, shopId),
        ne(bookings.status, "cancelled"),
      ),
    )
    .where(
      and(
        liveTrip(),
        eq(trips.shopId, shopId),
        eq(trips.status, "scheduled"),
        inArray(trips.title, [...new Set(today.map((trip) => trip.title))]),
        lt(trips.endsAt, latest),
        gte(trips.endsAt, horizon),
        notInArray(
          trips.id,
          today.map((trip) => trip.id),
        ),
      ),
    )
    .groupBy(trips.id)
    .having(sql`count(${bookings.id}) >= ${trips.capacity}`)
    .orderBy(desc(trips.endsAt));

  for (const trip of today) {
    const match = candidates.find(
      (candidate) =>
        candidate.title === trip.title && candidate.endsAt.getTime() < trip.startsAt.getTime(),
    );
    answer.set(
      trip.id,
      match
        ? {
            title: match.title,
            startsAt: match.startsAt,
            // Both null reads as the same price, which is honest: two
            // departures that both say "ask the shop" are priced alike as far
            // as anything on the board is concerned.
            samePrice: match.priceCents === trip.priceCents,
          }
        : null,
    );
  }
  return answer;
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
      capacity: trips.capacity,
      plannedDives: trips.plannedDives,
      priceCents: trips.priceCents,
      recapShoutout: trips.recapShoutout,
      recapAutoSendPaused: trips.recapAutoSendPaused,
      recapAutoSendAt: trips.recapAutoSendAt,
    })
    .from(trips)
    .where(
      and(
        liveTrip(),
        eq(trips.shopId, shopId),
        // A cancelled trip never sailed; it has no end-state to confirm.
        eq(trips.status, "scheduled"),
        gte(trips.startsAt, bounds.from),
        lt(trips.startsAt, bounds.to),
      ),
    );
  if (rows.length === 0) return [];
  const tripIds = rows.map((row) => row.id);
  const [
    counts,
    photos,
    crewPhotos,
    recapDeliveries,
    crewRoster,
    crewResults,
    lastBookings,
    neverSentDeal,
    comparables,
    planChangeRows,
  ] = await Promise.all([
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
    db
      .select({
        tripId: bookings.tripId,
        bookingStatus: bookings.status,
        deliveryStatus: notificationDeliveries.status,
        attemptedAt: notificationDeliveries.attemptedAt,
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
          inArray(
            bookings.tripId,
            rows.map((row) => row.id),
          ),
        ),
      ),
    // **The assigned crew** (issue #1346). Tenancy through `trips`:
    // `trip_assignments` carries no `shop_id` of its own (CR-007), so a trip id
    // alone must never reach a roster.
    db
      .select({ tripId: tripAssignments.tripId, personId: tripAssignments.personId })
      .from(tripAssignments)
      .innerJoin(trips, eq(trips.id, tripAssignments.tripId))
      .where(and(liveTrip(), eq(trips.shopId, shopId), inArray(tripAssignments.tripId, tripIds))),
    // Their results, joined back to the roster with the same guard
    // `listRollCallGaps` uses, so a person taken off the trip cannot answer
    // for it. Oldest first: the last row read per (trip, person, checkpoint)
    // is the one that stands, which is the order every reader of this trail
    // walks it in.
    db
      .select({
        tripId: rollCallCrewEvents.tripId,
        personId: rollCallCrewEvents.personId,
        checkpoint: rollCallCrewEvents.checkpoint,
        status: rollCallCrewEvents.status,
      })
      .from(rollCallCrewEvents)
      .innerJoin(
        tripAssignments,
        and(
          eq(tripAssignments.tripId, rollCallCrewEvents.tripId),
          eq(tripAssignments.personId, rollCallCrewEvents.personId),
        ),
      )
      .where(
        and(eq(rollCallCrewEvents.shopId, shopId), inArray(rollCallCrewEvents.tripId, tripIds)),
      )
      .orderBy(
        asc(rollCallCrewEvents.occurredAt),
        asc(rollCallCrewEvents.createdAt),
        asc(rollCallCrewEvents.seq),
      ),
    // **D47's first clause** — when the last seat sold.
    db
      .select({ tripId: bookings.tripId, lastBookingAt: max(bookings.createdAt) })
      .from(bookings)
      .where(
        and(
          eq(bookings.shopId, shopId),
          inArray(bookings.tripId, tripIds),
          ne(bookings.status, "cancelled"),
        ),
      )
      .groupBy(bookings.tripId),
    // **D47's second** — the deal that never went out, answered by the module
    // that owns last-minute deals rather than by a second query here.
    tripIdsNeverSentLastMinuteDeal(db, shopId, tripIds),
    comparableDepartures(db, shopId, rows),
    // **D24** — dives whose actual site was not the planned one. A dive with no
    // planned site is deliberately not a change: there was no plan to depart
    // from, and "the plan changed" would be the surface inventing one.
    db
      .select({
        tripId: executedDives.tripId,
        diveNumber: executedDives.diveNumber,
        siteName: diveSites.name,
        reasonCode: executedDives.planChangeReason,
      })
      .from(executedDives)
      .innerJoin(trips, eq(trips.id, executedDives.tripId))
      .innerJoin(diveSites, eq(diveSites.id, executedDives.actualSiteId))
      .innerJoin(
        tripDives,
        and(
          eq(tripDives.tripId, executedDives.tripId),
          eq(tripDives.diveNumber, executedDives.diveNumber),
        ),
      )
      .where(
        and(
          liveTrip(),
          eq(executedDives.shopId, shopId),
          inArray(executedDives.tripId, tripIds),
          isNull(executedDives.deletedAt),
          isNotNull(tripDives.diveSiteId),
          ne(tripDives.diveSiteId, executedDives.actualSiteId),
        ),
      )
      .orderBy(asc(executedDives.diveNumber)),
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
  const recapStateByTrip = new Map<
    string,
    { total: number; sent: number; failed: number; latest: Date | null }
  >();
  for (const delivery of recapDeliveries) {
    if (delivery.bookingStatus === "cancelled" || delivery.bookingStatus === "no_show") continue;
    const state = recapStateByTrip.get(delivery.tripId) ?? {
      total: 0,
      sent: 0,
      failed: 0,
      latest: null,
    };
    state.total++;
    if (delivery.deliveryStatus === "sent") {
      state.sent++;
      if (delivery.attemptedAt && (!state.latest || delivery.attemptedAt > state.latest)) {
        state.latest = delivery.attemptedAt;
      }
    } else if (delivery.deliveryStatus === "failed") {
      state.failed++;
    }
    recapStateByTrip.set(delivery.tripId, state);
  }
  // **The assigned crew, each with the result that stands at each checkpoint.**
  // Absence is *awaiting*, never accounted for (`crewIsAccountedFor`), so a
  // crew member with no result at all reaches the evening as an empty record
  // rather than being left out of the list.
  const crewByTrip = new Map<string, string[]>();
  for (const row of crewRoster) {
    const list = crewByTrip.get(row.tripId) ?? [];
    list.push(row.personId);
    crewByTrip.set(row.tripId, list);
  }
  const standingCrewResult = new Map<string, "boarded" | "not_boarded">();
  for (const event of crewResults) {
    const key = `${event.tripId}\0${event.personId}\0${event.checkpoint}`;
    // A `cleared` undo collapses to "no result", the same reading every other
    // reader of this trail makes, so an undone tap can never satisfy a count.
    if (event.status === "cleared") standingCrewResult.delete(key);
    else standingCrewResult.set(key, event.status);
  }
  const lastBookingByTrip = new Map(
    lastBookings.map((row) => [row.tripId, row.lastBookingAt ?? null]),
  );
  const planChangesByTrip = new Map<string, typeof planChangeRows>();
  for (const change of planChangeRows) {
    const list = planChangesByTrip.get(change.tripId) ?? [];
    list.push(change);
    planChangesByTrip.set(change.tripId, list);
  }

  return rows.map((row) => ({
    tripId: row.id,
    title: row.title,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    booked: bookedByTrip.get(row.id) ?? 0,
    capacity: row.capacity,
    plannedDives: row.plannedDives,
    crew: crewSubjectsAtClose(
      row.plannedDives,
      crewByTrip.get(row.id) ?? [],
      (personId, checkpoint) => standingCrewResult.get(`${row.id}\0${personId}\0${checkpoint}`),
    ),
    lastBookingAt: lastBookingByTrip.get(row.id) ?? null,
    // The reader answers "never sent", so a trip *absent* from that set is one
    // whose deal went out.
    dealSent: !neverSentDeal.has(row.id),
    comparable: comparables.get(row.id) ?? null,
    planChanges: (planChangesByTrip.get(row.id) ?? []).map((change) => ({
      diveNumber: change.diveNumber,
      siteName: change.siteName,
      reasonCode: change.reasonCode,
    })),
    recapShoutout: row.recapShoutout,
    recapAutoSendPaused: row.recapAutoSendPaused,
    recapAutoSendAt: row.recapAutoSendAt,
    recapFailed: (recapStateByTrip.get(row.id)?.failed ?? 0) > 0,
    recapSentAt:
      recapStateByTrip.get(row.id)?.total === recapStateByTrip.get(row.id)?.sent
        ? (recapStateByTrip.get(row.id)?.latest ?? null)
        : null,
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
  /**
   * The Today queue this render has **already** read.
   *
   * The shop home is now the only surface that reads a day's closing state
   * (H-62 folded the close-out route away), and it has run `getTodayWork` for
   * the spine before it gets here. Without this the same page would run the
   * queue twice — about ten queries, the whole readiness pipeline, and two
   * chances for one render to hold two answers about one boat. Omitted, the
   * state reads its own (which is what `closeDay` does on purpose: the
   * recorded act recomputes from the source of truth, never from what a page
   * believed).
   */
  actions?: readonly TodayAction[],
): Promise<DayCloseoutState> {
  const shopDay = shopDayOf(now, timeZone);
  const [tripsToday, gaps, queued, leftoverDecisions] = await Promise.all([
    todaysTrips(db, shopId, timeZone, now),
    listRollCallGaps(db, shopId, now),
    actions ??
      getTodayWork(
        db,
        shopId,
        shopSlug,
        timeZone,
        now,
        undefined,
        t,
        locale,
        includeOpsAlerts,
      ).then((work) => work.actions),
    listLatestLeftoverDecisions(db, shopId, shopDay),
  ]);
  const adminTask = await postDiveReportTask(db, shopId, tripsToday, now);
  return assembleDayCloseout({
    trips: tripsToday,
    gaps,
    actions: queued,
    adminTasks: adminTask ? [adminTask] : [],
    leftoverDecisions,
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
 * Everything the home's evening reading needs, in one pass.
 *
 * `includeOpsAlerts` mirrors the Today page's owner/manager gate: the
 * leftovers list is "what the Today queue would still show *you*", so it must
 * hold the same rows for the same viewer — which is free when the caller hands
 * its own `actions` in, and load-bearing when it does not.
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
  /** See `assembleState` — the Today queue this render already read. */
  actions?: readonly TodayAction[],
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
    actions,
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

/**
 * **Who closed each head count, and when** — the two facts a settled station
 * says about itself beyond its numbers (ADR
 * 20260827-clearwater-surface-language, decision 4; the Evening artboard's
 * "back by 10:26 AM · head count closed by Keiko").
 *
 * The latest roll-call event on the trip *is* the moment the count closed:
 * these rows are append-only and a count is closed by its last mark. So this
 * asks for the newest one per trip and nothing else — it decides no state,
 * raises no gap and disagrees with nobody. Whether a count is closed at all
 * stays `listRollCallGaps`'s answer alone (an absent gap), which is why this
 * can be a plain read.
 *
 * The diver half only. A trip whose last mark was a crew one reads a few
 * minutes early, which is a rounding error in a sentence about an evening; the
 * alternative is a second table, a merge, and two ways for one line to be
 * wrong. A trip with no roll call at all is simply absent from the map, and
 * the station drops the clause rather than guessing at one.
 *
 * Ordered by the trio every roll-call read in this repo orders by — `occurredAt`,
 * then `createdAt`, then `seq` — because the first two tie constantly (a frozen
 * test clock, an offline batch applied in one transaction) and `seq` is the
 * only column that records what actually came first (ADR
 * 20260815-roll-call-order-is-a-property-of-the-data).
 */
export async function listHeadCountCloses(
  db: AppDb,
  shopId: string,
  tripIds: readonly string[],
): Promise<Map<string, { closedAt: Date; closedBy: string }>> {
  const closes = new Map<string, { closedAt: Date; closedBy: string }>();
  if (tripIds.length === 0) return closes;
  const rows = await db
    .select({
      tripId: rollCallEvents.tripId,
      occurredAt: rollCallEvents.occurredAt,
      closedBy: people.fullName,
    })
    .from(rollCallEvents)
    .innerJoin(people, eq(people.id, rollCallEvents.recordedByPersonId))
    .where(and(eq(rollCallEvents.shopId, shopId), inArray(rollCallEvents.tripId, [...tripIds])))
    .orderBy(
      desc(rollCallEvents.occurredAt),
      desc(rollCallEvents.createdAt),
      desc(rollCallEvents.seq),
    );
  for (const row of rows) {
    if (closes.has(row.tripId)) continue;
    closes.set(row.tripId, { closedAt: row.occurredAt, closedBy: row.closedBy });
  }
  return closes;
}

/**
 * **Has this shop ever had a boat come home before today?**
 *
 * The one input to the evening's once-ever wording: on the day a shop's first
 * departure ties up, "all boats are home" is a smaller sentence than the
 * moment deserves, and the coral table sanctions "your first boat is home"
 * instead (ADR 20260827-clearwater-surface-language, decision 11, the
 * home-evening row). It expires by itself — the moment any earlier day holds a
 * sailed departure this answers true forever after, with nothing stored and
 * nothing to clean up.
 *
 * `before` is the start of the shop's own calendar day, so a second boat
 * landing this afternoon does not cancel this morning's first.
 */
export async function shopHasSailedBefore(
  db: AppDb,
  shopId: string,
  before: Date,
): Promise<boolean> {
  const [row] = await db
    .select({ id: trips.id })
    .from(trips)
    .where(
      and(
        liveTrip(),
        eq(trips.shopId, shopId),
        eq(trips.status, "scheduled"),
        lt(trips.endsAt, before),
      ),
    )
    .limit(1);
  return Boolean(row);
}
