import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lt, max, ne } from "drizzle-orm";
import { type CalendarDate, calendarDateInTimezone } from "@/lib/calendar-date";
import { nowDate } from "@/lib/clock";
import {
  assembleDayCloseout,
  assembleEveningClose,
  type DayCloseoutState,
  type DayLoadOut,
  dayLoadOut,
  loadOutDue,
  seatSailed,
  tomorrowNoon,
} from "@/lib/closeout";
import type { CrewRollCallSubject } from "@/lib/manifests";
import { carryForwardNotBoarded, rollCallCheckpoints } from "@/lib/roll-call";
import { settleWithLimit } from "@/lib/settle-with-limit";
import { shopDayBounds, shopDaysBounds } from "@/lib/zoned";
import type { AppDb } from "./client";
import { isDemoShopWithDemoOwnerOrCaptainAccount } from "./demo-account-guard";
import { listAfterDiveRollCallByTrip, listDepartureRollCallByTrip } from "./manifests";
import { listCrewRecapPhotosForTrips, listRecapPhotosForTrips } from "./recap";
import {
  bookings,
  diveSites,
  executedDives,
  notificationDeliveries,
  people,
  rollCallCrewEvents,
  rollCallEvents,
  tripAssignments,
  tripDives,
  trips,
} from "./schema";
import { DEMO_SHOP_TIMEZONE, demoFinishedDuskDeparture } from "./seed-clock";
import { AT_SEA_DUSK_TITLE } from "./seed-identifiers";
import { listRollCallGaps } from "./today";
import { latestTripStagesByTrip } from "./trip-stages";
import { liveTrip, notRehearsal } from "./trips-live";
import { getTripPrep, type TripPrepShop } from "./trips-prep";
import { listShopDayDepartures } from "./trips-queries";

/**
 * The db half of the day's closing state (the shop home's evening, ADR
 * 20260827-clearwater-surface-language decision 4).
 * `getDayCloseout` gathers the day's facts through the reader that already
 * owns them — `listRollCallGaps` (src/db/today.ts) — and hands them to the
 * pure assembly (src/lib/closeout.ts). Nothing here detects anything of its
 * own: an evening that counted a head count differently from the queue that
 * chases it would let the two disagree about whether a person is accounted for.
 *
 * Its one caller is the shop home.
 */

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
 * One shop day's departures — today's, or a past day's (issue #2662) —
 * backwards-looking on purpose, like `listRollCallGaps`: the boats this
 * surface reconciles have mostly already fallen out of every forward-looking
 * reader.
 */
async function dayTrips(
  db: AppDb,
  shopId: string,
  bounds: { from: Date; to: Date },
  options: { rehearsals?: boolean; tripId?: string } = {},
) {
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
        // diveday:allow-rehearsal: Today keeps a rehearsal in the water on its spine; a past day does not.
        ...(options.rehearsals === false ? [notRehearsal()] : []),
        ...(options.tripId ? [eq(trips.id, options.tripId)] : []),
        gte(trips.startsAt, bounds.from),
        lt(trips.startsAt, bounds.to),
      ),
    );
  if (rows.length === 0) return [];
  const tripIds = rows.map((row) => row.id);
  const [
    roster,
    dockResults,
    afterDiveSpoken,
    photos,
    crewPhotos,
    recapDeliveries,
    crewRoster,
    crewResults,
    planChangeRows,
    loggedDiveRows,
    stagesByTrip,
  ] = await Promise.all([
    // **Two counts off one roster, because the evening and the shelf ask
    // different questions** (issue #1689). `booked` is the seats this
    // departure sold — what the open-seats debrief subtracts from capacity, since
    // a released seat never came back to the shelf. `sailed` is the divers the
    // day actually carried, and the homecoming line counted a diver left
    // standing on the dock out *and* home because both numbers came off the
    // one count.
    //
    // The rows themselves rather than `count()` and a `filter (where …)`,
    // because deciding whether a seat sailed takes two statements about that
    // seat and only one of them is on this row: the rule is
    // `seatSailed` (src/lib/closeout.ts) and the other half is the query
    // below. One shop day of non-cancelled bookings is bounded by the day's
    // capacity, which is the same population `listRollCallGaps` already walks
    // per booking over a thirty-day residue window.
    db
      .select({ tripId: bookings.tripId, bookingId: bookings.id, status: bookings.status })
      .from(bookings)
      .where(
        and(
          eq(bookings.shopId, shopId),
          inArray(bookings.tripId, tripIds),
          ne(bookings.status, "cancelled"),
        ),
      ),
    // **The crew's own word on who got on the boat**, which outranks the desk's
    // (`seatSailed`). Through the manifest's departure-pinned reader rather
    // than a second scan of `roll_call_events` here: it already applies the
    // supersession every reader of that trail applies (newest event per
    // booking wins, a newest `cleared` drops out) and the cancelled-booking
    // guard, and a second copy of those rules beside the head count is the
    // drift `src/db/manifests.ts` keeps warning about.
    //
    // Pinned to `departure` is the whole of why this is safe: `not_boarded`
    // there means "never left the dock", and the same word at an after-dive
    // checkpoint means "did not come back" — a diver who sailed.
    listDepartureRollCallByTrip(db, shopId, tripIds),
    // The other half of the crew's evidence: a seat spoken for at sea. Read
    // beside the dock rather than instead of it, because the two words mean
    // opposite things at the two checkpoints ({@link seatSailed}, issue #1704).
    listAfterDiveRollCallByTrip(db, shopId, tripIds),
    listRecapPhotosForTrips(
      db,
      shopId,
      rows.map((row) => row.id),
    ),
    listCrewRecapPhotosForTrips(
      db,
      shopId,
      rows.map((row) => row.id),
    ),
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
    // The highest dive the crew logged, so an open count on an earlier dive
    // never reads as a count still being taken (dive-domain review of
    // 56ba7c1, auditor F2).
    db
      .select({
        tripId: executedDives.tripId,
        loggedDives: max(executedDives.diveNumber),
      })
      .from(executedDives)
      .where(
        and(
          eq(executedDives.shopId, shopId),
          inArray(executedDives.tripId, tripIds),
          isNull(executedDives.deletedAt),
        ),
      )
      .groupBy(executedDives.tripId),
    // **#1480** — the crew's last tap, so a Home at the rail can settle a
    // station the return buffer still calls "still out". One batched query for
    // the whole day, never one per boat.
    latestTripStagesByTrip(db, shopId, tripIds),
  ]);
  // **The roster, and the subset of it the boat carried** (issue #1689). One
  // walk, one rule per seat, so the two numbers can never be derived by
  // different readings of the same rows.
  const bookedByTrip = new Map<string, number>();
  const sailedByTrip = new Map<string, number>();
  for (const seat of roster) {
    bookedByTrip.set(seat.tripId, (bookedByTrip.get(seat.tripId) ?? 0) + 1);
    const sailed = seatSailed({
      noShow: seat.status === "no_show",
      dockResult: dockResults.get(seat.tripId)?.get(seat.bookingId) ?? null,
      afterDiveResultStands: afterDiveSpoken.get(seat.tripId)?.has(seat.bookingId) === true,
    });
    if (sailed) sailedByTrip.set(seat.tripId, (sailedByTrip.get(seat.tripId) ?? 0) + 1);
  }
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
  const loggedDivesByTrip = new Map(
    loggedDiveRows.map((row) => [row.tripId, row.loggedDives ?? 0] as const),
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
    sailed: sailedByTrip.get(row.id) ?? 0,
    capacity: row.capacity,
    plannedDives: row.plannedDives,
    stage: stagesByTrip.get(row.id) ?? null,
    crew: crewSubjectsAtClose(
      row.plannedDives,
      crewByTrip.get(row.id) ?? [],
      (personId, checkpoint) => standingCrewResult.get(`${row.id}\0${personId}\0${checkpoint}`),
    ),
    loggedDives: loggedDivesByTrip.get(row.id) ?? 0,
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
 * Everything the home's evening reading needs, in one pass: today's
 * departures and the roll-call gaps that decide how each one settled.
 */
export async function getDayCloseout(
  db: AppDb,
  shopId: string,
  timeZone: string,
  now: Date = nowDate(),
  /**
   * The shop whose tomorrow to add up once every boat today has settled
   * (fifth-loop ideas, item 2). Absent, tomorrow is never read.
   */
  loadOutShop?: TripPrepShop,
  /**
   * **A past shop day instead of today** (issue #2662), `YYYY-MM-DD` in the
   * shop's zone: how that day's boats closed, read now. Never a load-out: a
   * past day has no tomorrow to fill tanks for.
   */
  day?: CalendarDate,
): Promise<DayCloseoutState> {
  if (day !== undefined) return pastDayCloseout(db, shopId, timeZone, now, day);
  const [tripsToday, gaps, carryover] = await Promise.all([
    dayTrips(db, shopId, shopDayBounds(now, timeZone)),
    listRollCallGaps(db, shopId, now),
    demoDuskCarryover(db, shopId, timeZone, now),
  ]);
  const state = assembleDayCloseout({ trips: tripsToday, gaps, timeZone, now });
  if (carryover && !tripsToday.some((trip) => trip.tripId === carryover.tripId)) {
    state.carryover = carryover;
  }
  // Only once it is due (`loadOutDue`): a dozen prep reads for a day still sailing would
  // be spent on a block nobody is shown.
  if (!loadOutShop || !loadOutDue(state.departures, now)) return state;
  return {
    ...state,
    tomorrow: await readDayLoadOut(db, loadOutShop, tomorrowNoon(now, timeZone), now),
  };
}

/** The prior or current day's finished dusk departure, on demo Today only. */
async function demoDuskCarryover(
  db: AppDb,
  shopId: string,
  timeZone: string,
  now: Date,
): Promise<DayCloseoutState["carryover"]> {
  // This fixture's timestamps are seeded against its fixed demo clock zone.
  // Read/render them in the shop's current zone below, but match the seed plan
  // in the same zone that created it so a staffer changing the shop timezone
  // cannot make the finished demo departure disappear.
  const plan = demoFinishedDuskDeparture(now, DEMO_SHOP_TIMEZONE);
  if (!plan || !(await isDemoShopWithDemoOwnerOrCaptainAccount(db, shopId))) return undefined;

  const [trip] = await db
    .select({ id: trips.id })
    .from(trips)
    .where(
      and(
        liveTrip(),
        eq(trips.shopId, shopId),
        eq(trips.status, "scheduled"),
        eq(trips.title, AT_SEA_DUSK_TITLE),
        eq(trips.startsAt, plan.startsAt),
      ),
    )
    .limit(1);
  if (!trip) return undefined;

  const tripDay = calendarDateInTimezone(plan.startsAt, timeZone);
  const [candidate] = await dayTrips(db, shopId, shopDayBounds(plan.startsAt, timeZone), {
    tripId: trip.id,
  });
  if (!candidate) return undefined;

  const gaps = await listRollCallGaps(db, shopId, now, [trip.id], { historical: true });
  const [departure] = assembleDayCloseout({
    trips: [candidate],
    gaps,
    timeZone,
    now,
    shopDay: tripDay,
    historical: true,
  }).departures;
  if (departure?.status !== "all_home") return undefined;
  return assembleEveningClose([departure], now).stations[0];
}

/**
 * **A past day, closed as it stands now** (issue #2662). The same assembly as
 * today's, over that day's departures, and the same head-count reader: every
 * roll-call mark ever written on those boats, so a count corrected on Monday
 * reads corrected on Saturday's page.
 *
 * **Never "all home" by age** (review dom-w4-dock B1). Today's reader drops a
 * dock count after 48 hours home and a boat after thirty days, because Today
 * is a queue. This page is a record, so it asks `listRollCallGaps` in its
 * `historical` mode: those boats only, no window, `home` from each boat's own
 * `endsAt`. A rehearsal is left off (ADR 20261012-rehearsal-departures:
 * counted nowhere); Today still shows one in the water.
 */
async function pastDayCloseout(
  db: AppDb,
  shopId: string,
  timeZone: string,
  now: Date,
  day: CalendarDate,
): Promise<DayCloseoutState> {
  const departures = await dayTrips(db, shopId, shopDaysBounds(day, day, timeZone), {
    rehearsals: false,
  });
  if (departures.length === 0) {
    return assembleDayCloseout({ trips: [], gaps: [], timeZone, now, shopDay: day });
  }
  const gaps = await listRollCallGaps(
    db,
    shopId,
    now,
    departures.map((trip) => trip.tripId),
    { historical: true },
  );
  return assembleDayCloseout({
    trips: departures,
    gaps,
    timeZone,
    now,
    shopDay: day,
    historical: true,
  });
}

/**
 * **Who closed each head count, and when** — the two facts a settled station
 * says about itself beyond its numbers (ADR
 * 20260827-clearwater-surface-language, decision 4; the Evening artboard's
 * "back by 10:26 AM · last roll call closed by Keiko").
 *
 * The latest standing mark at the trip's **final checkpoint** *is* the moment
 * the count closed: these rows are append-only and a count is closed by its
 * last mark. A mark on an earlier checkpoint (a dock mis-tap corrected from the
 * shop at 4:10) and a `cleared` retraction anywhere close nothing, so neither
 * moves the time or the name (#2536). So this asks for the newest such mark per
 * trip and nothing else — it decides no state,
 * raises no gap and disagrees with nobody. Whether a count is closed at all
 * stays `listRollCallGaps`'s answer alone (an absent gap), which is why this
 * can be a plain read.
 *
 * **Both halves of the count, once both are closed** (issue #2331): the
 * newest diver mark and the newest crew mark per trip, and the later of the two
 * supplies the time *and* the name. Reading diver marks alone named whoever
 * made the last diver mark when a crew member's own back-aboard mark closed the
 * count. But a trip whose crew are not all accounted for (`crewClosed` false)
 * keeps the diver-only sentence, "8 of 8 back by {time}", and a crew mark is
 * no part of that claim: the divers were back when the last diver was, so the
 * diver half alone answers both the time and the name there (dive-domain review
 * of #2331). A trip with no roll call at all is simply absent from the map,
 * and the station drops the clause rather than guessing at one.
 *
 * Each half is ordered by the trio every roll-call read in this repo orders by
 * — `occurredAt`, then `createdAt`, then `seq` — because the first two tie
 * constantly (a frozen test clock, an offline batch applied in one
 * transaction) and `seq` is the only column that records what actually came
 * first (ADR 20260815-roll-call-order-is-a-property-of-the-data). Between the
 * halves only `occurredAt` and `createdAt` compare: each table has its own
 * sequence, so a diver `seq` says nothing against a crew one. On a tie on both,
 * the diver mark stands, as it did before crew marks were read here.
 */
export async function listHeadCountCloses(
  db: AppDb,
  shopId: string,
  stations: readonly { tripId: string; crewClosed: boolean }[],
): Promise<Map<string, { closedAt: Date; closedBy: string }>> {
  const closes = new Map<string, { closedAt: Date; closedBy: string }>();
  if (stations.length === 0) return closes;
  const tripIds = stations.map((station) => station.tripId);
  const crewClosedTripIds = stations
    .filter((station) => station.crewClosed)
    .map((station) => station.tripId);
  const [tripRows, diverRows, crewRows] = await Promise.all([
    db
      .select({ id: trips.id, plannedDives: trips.plannedDives })
      .from(trips)
      .where(and(eq(trips.shopId, shopId), inArray(trips.id, [...tripIds]), liveTrip())),
    db
      .select({
        tripId: rollCallEvents.tripId,
        checkpoint: rollCallEvents.checkpoint,
        occurredAt: rollCallEvents.occurredAt,
        createdAt: rollCallEvents.createdAt,
        closedBy: people.fullName,
      })
      .from(rollCallEvents)
      .innerJoin(people, eq(people.id, rollCallEvents.recordedByPersonId))
      .where(
        and(
          eq(rollCallEvents.shopId, shopId),
          inArray(rollCallEvents.tripId, [...tripIds]),
          ne(rollCallEvents.status, "cleared"),
        ),
      )
      .orderBy(
        desc(rollCallEvents.occurredAt),
        desc(rollCallEvents.createdAt),
        desc(rollCallEvents.seq),
      ),
    crewClosedTripIds.length === 0
      ? []
      : db
          .select({
            tripId: rollCallCrewEvents.tripId,
            checkpoint: rollCallCrewEvents.checkpoint,
            occurredAt: rollCallCrewEvents.occurredAt,
            createdAt: rollCallCrewEvents.createdAt,
            closedBy: people.fullName,
          })
          .from(rollCallCrewEvents)
          .innerJoin(people, eq(people.id, rollCallCrewEvents.recordedByPersonId))
          .where(
            and(
              eq(rollCallCrewEvents.shopId, shopId),
              inArray(rollCallCrewEvents.tripId, crewClosedTripIds),
              ne(rollCallCrewEvents.status, "cleared"),
            ),
          )
          .orderBy(
            desc(rollCallCrewEvents.occurredAt),
            desc(rollCallCrewEvents.createdAt),
            desc(rollCallCrewEvents.seq),
          ),
  ]);
  const closingCheckpoint = new Map(
    tripRows.map((trip) => [trip.id, rollCallCheckpoints(trip.plannedDives).at(-1) ?? "departure"]),
  );
  type Mark = (typeof diverRows)[number];
  const newestPerTrip = (rows: readonly Mark[]) => {
    const newest = new Map<string, Mark>();
    for (const row of rows) {
      if (row.checkpoint !== closingCheckpoint.get(row.tripId)) continue;
      if (!newest.has(row.tripId)) newest.set(row.tripId, row);
    }
    return newest;
  };
  const diverLast = newestPerTrip(diverRows);
  const crewLast = newestPerTrip(crewRows);
  const crewIsLater = (crew: Mark, diver: Mark) =>
    crew.occurredAt.getTime() !== diver.occurredAt.getTime()
      ? crew.occurredAt > diver.occurredAt
      : crew.createdAt > diver.createdAt;
  for (const tripId of new Set([...diverLast.keys(), ...crewLast.keys()])) {
    const diver = diverLast.get(tripId);
    const crew = crewLast.get(tripId);
    const last = diver && crew ? (crewIsLater(crew, diver) ? crew : diver) : (diver ?? crew);
    if (last) closes.set(tripId, { closedAt: last.occurredAt, closedBy: last.closedBy });
  }
  return closes;
}

/**
 * **Was a diver ever recorded not back after a dive?** Per trip, the first
 * dive with a `not_boarded` mark at its after-dive checkpoint, even when a
 * later mark resolved it. A past day's station reads as it closed, so a
 * resolved scare would otherwise vanish; the roll call log stays the record.
 */
export async function listNotBackAfterDive(
  db: AppDb,
  shopId: string,
  tripIds: readonly string[],
): Promise<Map<string, number>> {
  const firstDive = new Map<string, number>();
  if (tripIds.length === 0) return firstDive;
  const rows = await db
    .select({ tripId: rollCallEvents.tripId, checkpoint: rollCallEvents.checkpoint })
    .from(rollCallEvents)
    .where(
      and(
        eq(rollCallEvents.shopId, shopId),
        inArray(rollCallEvents.tripId, [...tripIds]),
        eq(rollCallEvents.status, "not_boarded"),
        ne(rollCallEvents.checkpoint, "departure"),
      ),
    );
  for (const row of rows) {
    const dive = Number(/^after_dive_(\d+)$/.exec(row.checkpoint)?.[1]);
    if (!Number.isInteger(dive)) continue;
    const seen = firstDive.get(row.tripId);
    if (seen === undefined || dive < seen) firstDive.set(row.tripId, dive);
  }
  return firstDive;
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

/** Departures whose prep is read at once: the paper day's own bound, for its reason. */
const LOAD_OUTS_IN_FLIGHT = 3;

/**
 * **One shop day's tanks and rental pieces, added together** (fifth-loop
 * ideas, item 2): every scheduled departure of the day `at` falls in, each
 * read through its own Gear tab's reader (`getTripPrep`), so the evening's
 * sum and each boat's tiles cannot disagree. Null for a day with no departure.
 *
 * A departure whose prep cannot be read (taken off the board mid-read) drops
 * out of the sum, and `departures` says how many were counted.
 */
export async function readDayLoadOut(
  db: AppDb,
  shop: TripPrepShop,
  /** Any instant inside the day to add up (`tomorrowNoon` for tomorrow). */
  at: Date,
  now: Date,
): Promise<DayLoadOut | null> {
  const departures = await listShopDayDepartures(db, shop.id, shop.timezone, at);
  if (departures.length === 0) return null;
  const preps = await settleWithLimit(departures, LOAD_OUTS_IN_FLIGHT, (departure) =>
    getTripPrep(db, shop, departure.id, now),
  );
  return dayLoadOut(
    preps.flatMap((settled) =>
      settled.status === "fulfilled" && settled.value
        ? [{ tanks: settled.value.checklist.tanks, lines: settled.value.checklist.lines }]
        : [],
    ),
  );
}
