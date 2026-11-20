import { and, asc, count, eq, inArray, or, sql } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import {
  effectiveRollCallKey,
  foldEffectiveRollCallEvidence,
  projectEffectiveRollCalls,
} from "@/lib/effective-roll-call";
import { offlineRollCallWitnessEnabled } from "@/lib/offline-roll-call-witness";
import { compareMarkOrder, type RollCallRecord } from "@/lib/roll-call";
import {
  canonicalRollCallEvidenceId,
  causalScopeAllowsObservation,
  type RollCallCausalContext,
  type RollCallEvidence,
} from "@/lib/roll-call-causality";
import { carriedMissing, manifestRollCallView, standingByDay } from "@/lib/roll-call-days";
import { rollCallDayOf, rollCallDayStarts } from "@/lib/trip-days";
import type { DbExecutor } from "./client";
import { crewMarks, seatMarks } from "./roll-call-subject";
import {
  bookings,
  people,
  rollCallEvents,
  tripAssignments,
  tripScheduleDays,
  trips,
} from "./schema";
import { rollCallDayIndex } from "./trip-meeting-windows";
import { liveTrip } from "./trips-live";

export type RollCallCausalSubject = {
  shopId: string;
  tripId: string;
  checkpoint: string;
} & ({ bookingId: string } | { personId: string });

type CausalEvent = typeof rollCallEvents.$inferSelect;

/** Recompute each subject/checkpoint/day once from its original statements. */
export function projectCausalEvents(
  rows: readonly CausalEvent[],
  fallbackDayFor: (row: CausalEvent) => number,
  isEligible: (row: CausalEvent) => boolean,
) {
  const scopes = new Map<string, CausalEvent[]>();
  for (const row of rows) {
    if (!isEligible(row)) continue;
    const key = JSON.stringify([
      row.shopId,
      row.tripId,
      row.subjectKind,
      row.bookingId,
      row.crewPersonId,
      row.checkpoint,
    ]);
    const scope = scopes.get(key) ?? [];
    scope.push(row);
    scopes.set(key, scope);
  }
  const projected = new Map<string, CausalEvent>();
  for (const scope of scopes.values()) {
    const first = scope[0];
    if (!first) continue;
    const fallbackDay = fallbackDayFor(first);
    const evidence = scopedCausalEvidence(scope, first.checkpoint, fallbackDay);
    const projections = projectEffectiveRollCalls(
      evidence.map((item, index) => {
        const row = scope[index];
        if (!row) throw new Error("roll-call evidence row missing");
        return {
          ...item,
          subject: "current",
          checkpoint: first.checkpoint,
          day: row.meetingDay ?? fallbackDay,
        };
      }),
      () => true,
    );
    const latest = new Map<number, CausalEvent>();
    for (const row of scope) {
      const day = row.meetingDay ?? fallbackDay;
      if ((latest.get(day)?.seq ?? -1) < row.seq) latest.set(day, row);
    }
    for (const [day, row] of latest) {
      const projection = projections.get(effectiveRollCallKey("current", first.checkpoint, day));
      if (!projection) throw new Error("roll-call projection missing");
      projected.set(row.id, {
        ...row,
        status: projection.status ?? "cleared",
        causalFrontier: projection.frontier,
        evidenceConflict: projection.conflict,
        evidenceOrderingUnknown: projection.orderingUnknown,
      });
    }
  }
  return projected;
}

/** Keep only eligible rows, replacing each day's latest row with the effective fold. */
export function effectiveCausalRows<T extends { event: CausalEvent; day: number }>(
  rows: readonly T[],
  isEligible: (event: CausalEvent) => boolean,
): T[] {
  const eligible = rows.filter(({ event }) => isEligible(event));
  const fallbackDays = new Map(
    eligible
      .filter(({ event }) => event.meetingDay === null)
      .map(({ event, day }) => [event.tripId, day]),
  );
  const projections = projectCausalEvents(
    eligible.map(({ event }) => event),
    (event) => fallbackDays.get(event.tripId) ?? 0,
    () => true,
  );
  return eligible.map((row) => ({ ...row, event: projections.get(row.event.id) ?? row.event }));
}

/** Compare verified offline capture generations to the current seat and meeting in one batched read. */
export async function effectiveCausalRowsForDb<T extends { event: CausalEvent; day: number }>(
  db: DbExecutor,
  rows: readonly T[],
): Promise<T[]> {
  return (await rollCallProjectionForDb(db, rows)).rows;
}

export function recountKey(event: CausalEvent, day: number): string {
  return recountScopeKey(
    event.shopId,
    event.tripId,
    event.bookingId ?? (event.crewPersonId ? `crew:${event.crewPersonId}` : null),
    event.checkpoint,
    day,
  );
}
export function recountScopeKey(
  shopId: string,
  tripId: string,
  bookingId: string | null,
  checkpoint: string,
  day: number,
): string {
  return JSON.stringify([
    shopId.toLowerCase(),
    tripId.toLowerCase(),
    bookingId?.toLowerCase() ?? null,
    checkpoint,
    day,
  ]);
}

/** Unresolved earlier and unknown-day presence stays visible at later counts. */
export function recountApplies(
  recount: ReadonlySet<string>,
  shopId: string,
  tripId: string,
  subjectId: string,
  checkpoint: string,
  day: number,
): boolean {
  const current =
    checkpoint === "departure" ? 0 : Number(/^after_dive_(\d+)$/.exec(checkpoint)?.[1] ?? -1);
  if (current < 0) return false;
  for (let index = 0; index <= 6; index++) {
    const source = index === 0 ? "departure" : `after_dive_${index}`;
    if (recount.has(recountScopeKey(shopId, tripId, subjectId, source, -1))) return true;
    for (let earlier = 0; earlier < day; earlier++)
      if (recount.has(recountScopeKey(shopId, tripId, subjectId, source, earlier))) return true;
    if (index <= current && recount.has(recountScopeKey(shopId, tripId, subjectId, source, day)))
      return true;
  }
  return false;
}

export function recountHasUnknownDay(
  recount: ReadonlySet<string>,
  shopId: string,
  tripId: string,
  subjectId: string,
): boolean {
  for (let index = 0; index <= 6; index++) {
    if (
      recount.has(
        recountScopeKey(
          shopId,
          tripId,
          subjectId,
          index === 0 ? "departure" : `after_dive_${index}`,
          -1,
        ),
      )
    )
      return true;
  }
  return false;
}

/** Load all offline sources for subjects represented in a possibly checkpoint-limited reader. */
async function offlineSourcesForRows<T extends { event: CausalEvent; day: number }>(
  db: DbExecutor,
  rows: readonly T[],
) {
  if (rows.length === 0) return [];
  const trips = [...new Set(rows.map(({ event }) => event.tripId))];
  const shops = [...new Set(rows.map(({ event }) => event.shopId))];
  const seats = [
    ...new Set(rows.flatMap(({ event }) => (event.bookingId ? [event.bookingId] : []))),
  ];
  const crew = [
    ...new Set(rows.flatMap(({ event }) => (event.crewPersonId ? [event.crewPersonId] : []))),
  ];
  if (!seats.length && !crew.length) return [];
  const events = await db
    .select({ event: rollCallEvents, day: rollCallDayIndex() })
    .from(rollCallEvents)
    // diveday:roll-call-both-subjects: the paired subject predicates bound this lookup.
    .where(
      and(
        inArray(rollCallEvents.tripId, trips),
        inArray(rollCallEvents.shopId, shops),
        eq(rollCallEvents.source, "offline"),
        or(
          seats.length ? inArray(rollCallEvents.bookingId, seats) : undefined,
          crew.length ? inArray(rollCallEvents.crewPersonId, crew) : undefined,
        ),
      ),
    );
  const existing = new Set(rows.map(({ event }) => event.id));
  return events.filter(({ event }) => !existing.has(event.id));
}

/** Keep invalidated positive evidence visible as an unresolved count, not an older answer. */
export async function rollCallProjectionForDb<T extends { event: CausalEvent; day: number }>(
  db: DbExecutor,
  rows: readonly T[],
): Promise<{ rows: T[]; recount: Set<string> }> {
  const sources = [...rows, ...(await offlineSourcesForRows(db, rows))];
  const bound = sources.filter(
    ({ event }) =>
      event.source === "offline" &&
      (offlineRollCallWitnessEnabled() ||
        event.offlineMeetingGeneration !== null ||
        event.offlineAssignmentGeneration !== null ||
        event.offlineCrewAssignmentId !== null),
  );
  if (bound.length === 0)
    return { rows: effectiveCausalRows(rows, () => true), recount: new Set() };
  const ids = [
    ...new Set(bound.flatMap(({ event }) => (event.bookingId ? [event.bookingId] : []))),
  ];
  const current =
    ids.length === 0
      ? []
      : await db
          .select({
            id: bookings.id,
            shopId: bookings.shopId,
            tripId: bookings.tripId,
            assignment: bookings.offlineAssignmentGeneration,
            meeting: trips.offlineMeetingGeneration,
          })
          .from(bookings)
          .innerJoin(trips, and(eq(trips.id, bookings.tripId), eq(trips.shopId, bookings.shopId)))
          .where(and(inArray(bookings.id, ids), liveTrip()));
  const byId = new Map(current.map((row) => [row.id, row]));
  const crewTripIds = [
    ...new Set(
      bound.filter(({ event }) => event.subjectKind === "crew").map(({ event }) => event.tripId),
    ),
  ];
  const currentCrew = crewTripIds.length
    ? await db
        .select({
          tripId: trips.id,
          shopId: trips.shopId,
          meeting: trips.offlineMeetingGeneration,
          personId: tripAssignments.personId,
          incarnation: tripAssignments.offlineIncarnation,
        })
        .from(tripAssignments)
        .innerJoin(trips, eq(trips.id, tripAssignments.tripId))
        .where(and(inArray(trips.id, crewTripIds), liveTrip()))
    : [];
  const crewById = new Map(currentCrew.map((row) => [`${row.tripId}:${row.personId}`, row]));
  const eligible = (event: CausalEvent) => {
    if (event.source !== "offline") return true;
    if (event.subjectKind === "crew") {
      if (event.offlineMeetingGeneration === null && event.offlineCrewAssignmentId === null)
        return !offlineRollCallWitnessEnabled();
      const crew = crewById.get(`${event.tripId}:${event.crewPersonId}`);
      return (
        crew !== undefined &&
        crew.shopId === event.shopId &&
        crew.meeting === event.offlineMeetingGeneration &&
        crew.incarnation === event.offlineCrewAssignmentId
      );
    }
    if (event.offlineMeetingGeneration === null && event.offlineAssignmentGeneration === null)
      return !offlineRollCallWitnessEnabled();
    if (!event.bookingId || event.subjectKind !== "seat") return false;
    const seat = byId.get(event.bookingId);
    return (
      seat !== undefined &&
      seat.shopId === event.shopId &&
      seat.tripId === event.tripId &&
      event.offlineMeetingGeneration === seat.meeting &&
      event.offlineAssignmentGeneration === seat.assignment
    );
  };
  const recount = new Set<string>();
  const liveByKey = new Map<string, CausalEvent[]>();
  const stale = bound.filter(({ event }) => !eligible(event));
  const tripIds = [...new Set(stale.map(({ event }) => event.tripId))];
  const shopIds = [...new Set(stale.map(({ event }) => event.shopId))];
  const seatIds = [
    ...new Set(stale.flatMap(({ event }) => (event.bookingId ? [event.bookingId] : []))),
  ];
  const crewIds = [
    ...new Set(stale.flatMap(({ event }) => (event.crewPersonId ? [event.crewPersonId] : []))),
  ];
  const laterLive =
    tripIds.length && (seatIds.length || crewIds.length)
      ? await db
          .select()
          .from(rollCallEvents)
          // diveday:roll-call-both-subjects: scoped subjects are named in the paired predicates.
          .where(
            and(
              inArray(rollCallEvents.tripId, tripIds),
              inArray(rollCallEvents.shopId, shopIds),
              eq(rollCallEvents.source, "live"),
              or(
                seatIds.length ? inArray(rollCallEvents.bookingId, seatIds) : undefined,
                crewIds.length ? inArray(rollCallEvents.crewPersonId, crewIds) : undefined,
              ),
            ),
          )
      : [];
  const evidenceRows = [
    ...rows.map(({ event, day }) => ({ event, day })),
    ...laterLive.flatMap((event) =>
      event.meetingDay === null ? [] : [{ event, day: event.meetingDay }],
    ),
  ];
  const maxDay = evidenceRows.reduce((maximum, row) => Math.max(maximum, row.day), 0);
  for (const { event, day } of evidenceRows) {
    if (event.source !== "live") continue;
    const key = recountKey(event, day);
    const events = liveByKey.get(key) ?? [];
    events.push(event);
    liveByKey.set(key, events);
  }
  for (const { event, day } of bound) {
    const statement = event.statementStatus ?? event.status;
    if (
      eligible(event) ||
      (!event.bookingId && !event.crewPersonId) ||
      statement === "cleared" ||
      (event.checkpoint === "departure" && statement !== "boarded")
    )
      continue;
    const key = recountKey(event, day);
    const current = event.bookingId ? byId.get(event.bookingId) : undefined;
    const crew = event.crewPersonId
      ? crewById.get(`${event.tripId}:${event.crewPersonId}`)
      : undefined;
    const subjectId = event.bookingId ?? `crew:${event.crewPersonId}`;
    const ordinal =
      event.checkpoint === "departure"
        ? 0
        : Number(/^after_dive_(\d+)$/.exec(event.checkpoint)?.[1] ?? -1);
    const keys = [{ key, laterDay: false }];
    if (day >= 0 && ordinal >= 0)
      for (let later = ordinal + 1; later <= 6; later++)
        keys.push({
          key: recountScopeKey(event.shopId, event.tripId, subjectId, `after_dive_${later}`, day),
          laterDay: false,
        });
    if (day >= 0)
      for (let nextDay = day + 1; nextDay <= maxDay; nextDay++)
        for (let index = 0; index <= 6; index++)
          keys.push({
            key: recountScopeKey(
              event.shopId,
              event.tripId,
              subjectId,
              index === 0 ? "departure" : `after_dive_${index}`,
              nextDay,
            ),
            laterDay: true,
          });
    const resolved = keys.some((candidate) => {
      const live = (liveByKey.get(candidate.key) ?? []).reduce<CausalEvent | undefined>(
        (latest, candidate) => (!latest || latest.seq < candidate.seq ? candidate : latest),
        undefined,
      );
      return (
        live !== undefined &&
        live.seq > event.seq &&
        (live.statementStatus ?? live.status) !== "cleared" &&
        (!candidate.laterDay || (live.statementStatus ?? live.status) === "boarded") &&
        (candidate.key === key || live.captureContext?.liveRecountVerified === true) &&
        ((current !== undefined &&
          current.shopId === event.shopId &&
          current.tripId === event.tripId &&
          live.offlineMeetingGeneration === current.meeting &&
          live.offlineAssignmentGeneration === current.assignment) ||
          (crew !== undefined &&
            crew.shopId === event.shopId &&
            live.offlineMeetingGeneration === crew.meeting &&
            live.offlineCrewAssignmentId === crew.incarnation))
      );
    });
    if (!resolved) recount.add(key);
  }
  const kept = rows.filter(({ event, day }) => {
    const subjectId = event.bookingId ?? (event.crewPersonId ? `crew:${event.crewPersonId}` : null);
    return (
      eligible(event) &&
      (!subjectId ||
        !recountApplies(recount, event.shopId, event.tripId, subjectId, event.checkpoint, day))
    );
  });
  return { rows: effectiveCausalRows(kept, () => true), recount };
}

/** Unknown historical meeting days are never reconstructed from a device clock. */
export async function causalMeetingDay(db: DbExecutor, tripId: string, captured?: number) {
  const [days] = await db
    .select({ n: count() })
    .from(tripScheduleDays)
    .where(eq(tripScheduleDays.tripId, tripId));
  const total = Math.max(days?.n ?? 0, 1);
  return captured !== undefined && Number.isInteger(captured) && captured >= 0 && captured < total
    ? captured
    : total === 1
      ? 0
      : -1;
}

/**
 * Maintain only derived fields under the caller's existing trip lock. Original
 * intent, actor, notes and audit instants remain immutable. A sequence orders
 * projection revisions; it does not establish observation between statements.
 */
export async function refreshCausalRollCall(db: DbExecutor, subject: RollCallCausalSubject) {
  const loaded = await db
    .select()
    .from(rollCallEvents)
    .where(
      and(
        eq(rollCallEvents.shopId, subject.shopId),
        eq(rollCallEvents.tripId, subject.tripId),
        eq(rollCallEvents.checkpoint, subject.checkpoint),
        "bookingId" in subject ? seatMarks() : crewMarks(),
        "bookingId" in subject
          ? eq(rollCallEvents.bookingId, subject.bookingId)
          : eq(rollCallEvents.crewPersonId, subject.personId),
      ),
    );
  const fallbackDay = await causalMeetingDay(db, subject.tripId);
  const rows = (
    await effectiveCausalRowsForDb(
      db,
      loaded.map((event) => ({ event, day: event.meetingDay ?? fallbackDay })),
    )
  ).map(({ event }) => event);
  const evidence = scopedCausalEvidence(rows, subject.checkpoint, fallbackDay);
  const projections = projectEffectiveRollCalls(
    evidence.map((item, index) => {
      const row = rows[index];
      if (!row) throw new Error("roll-call evidence row missing");
      return {
        ...item,
        subject: "current",
        checkpoint: subject.checkpoint,
        day: row.meetingDay ?? fallbackDay,
      };
    }),
    () => true,
  );
  const groups = new Map<number, typeof rows>();
  for (const row of rows) {
    const day = row.meetingDay ?? fallbackDay;
    const group = groups.get(day) ?? [];
    group.push(row);
    groups.set(day, group);
  }
  for (const [day, group] of groups) {
    const latest = group.reduce((a, b) => (a.seq > b.seq ? a : b));
    const projection = projections.get(effectiveRollCallKey("current", subject.checkpoint, day));
    if (!projection) throw new Error("roll-call projection missing");
    // Retain original intent before changing a previously uninitialized row.
    await db
      .update(rollCallEvents)
      .set({
        statementStatus: sql`coalesce(${rollCallEvents.statementStatus}, ${rollCallEvents.status})`,
        meetingDay: day,
      })
      .where(
        and(
          eq(rollCallEvents.shopId, subject.shopId),
          eq(rollCallEvents.id, latest.id),
          "bookingId" in subject ? seatMarks() : crewMarks(),
        ),
      );
    await db
      .update(rollCallEvents)
      .set({
        status: projection.status ?? "cleared",
        causalFrontier: projection.frontier,
        evidenceConflict: projection.conflict,
        evidenceOrderingUnknown: projection.orderingUnknown,
      })
      .where(
        and(
          eq(rollCallEvents.shopId, subject.shopId),
          eq(rollCallEvents.id, latest.id),
          "bookingId" in subject ? seatMarks() : crewMarks(),
        ),
      );
  }
}

/** Evidence rendered with a checkpoint, including awaiting rows after an undo. */
export async function manifestCausalContexts(db: DbExecutor, shopId: string, tripId: string) {
  return (await manifestRollCallReads(db, shopId, tripId)).causal;
}

/**
 * Server-side manifest reads share one scoped event set. Raw rows stay local;
 * the context-only reader above retains its existing transport shape.
 */
export async function manifestRollCallReads(db: DbExecutor, shopId: string, tripId: string) {
  const loaded = await db
    .select({ event: rollCallEvents, recorder: people.fullName })
    // diveday:roll-call-both-subjects: keys include kind; context is for the complete manifest.
    .from(rollCallEvents)
    .innerJoin(people, eq(people.id, rollCallEvents.recordedByPersonId))
    .where(and(eq(rollCallEvents.shopId, shopId), eq(rollCallEvents.tripId, tripId)));
  const windows = await db
    .select({ startsAt: tripScheduleDays.startsAt, endsAt: tripScheduleDays.endsAt })
    .from(tripScheduleDays)
    .where(eq(tripScheduleDays.tripId, tripId))
    .orderBy(asc(tripScheduleDays.startsAt));
  const projection = await rollCallProjectionForDb(
    db,
    loaded.map((row) => ({
      ...row,
      day: row.event.meetingDay ?? (windows.length > 1 ? -1 : 0),
    })),
  );
  const { rows, recount } = projection;
  const meetingDay = rollCallDayOf(rollCallDayStarts(windows), nowDate());
  const latest = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    const e = row.event;
    const key = `${e.subjectKind}:${e.bookingId ?? e.crewPersonId}/${e.checkpoint}/${e.meetingDay ?? (windows.length > 1 ? -1 : 0)}`;
    if ((latest.get(key)?.event.seq ?? -1) < e.seq) latest.set(key, row);
  }
  const standing = standingByDay(
    [...latest.values()]
      .sort((a, b) => a.event.seq - b.event.seq)
      .map(({ event }) => ({
        subject: `${event.subjectKind}:${event.bookingId ?? event.crewPersonId}`,
        checkpoint: event.checkpoint,
        status: event.status,
        day: event.meetingDay ?? (windows.length > 1 ? -1 : 0),
        id: event.id,
        retracts: event.retractsEventId,
        evidenceConflict: event.evidenceConflict,
      })),
  );
  const carriedIds = new Set(
    [...carriedMissing(standing, meetingDay).values()].map((mark) => mark.id),
  );
  // Unknown-day withdrawals remain visible until actually observed. They do
  // not establish attendance, but an untargeted undo can revoke certainty.
  for (const { event } of latest.values()) {
    if (
      (event.meetingDay ?? (windows.length > 1 ? -1 : 0)) < 0 &&
      event.status === "cleared" &&
      event.causalFrontier.length > 0
    )
      carriedIds.add(event.id);
  }
  const contexts = new Map<string, RollCallCausalContext>();
  for (const row of latest.values()) {
    const e = row.event;
    const day = e.meetingDay ?? (windows.length > 1 ? -1 : 0);
    if (day !== meetingDay && !carriedIds.has(e.id)) continue;
    const key = `${e.subjectKind}:${e.bookingId ?? e.crewPersonId}/${e.checkpoint}`;
    const previous = contexts.get(key);
    const ids = [
      ...new Set([
        ...(previous?.observedEvidenceIds ?? []),
        ...(e.causalFrontier ?? [canonicalRollCallEvidenceId(e)]),
      ]),
    ];
    const evidence = rows.flatMap(({ event, recorder }) =>
      ids.includes(canonicalRollCallEvidenceId(event))
        ? [
            {
              id: canonicalRollCallEvidenceId(event),
              eventId: event.id,
              status: event.statementStatus ?? event.status,
              recordedByName: recorder,
              occurredAt: event.occurredAt.toISOString(),
              note: event.note,
              meetingDay: event.meetingDay ?? (windows.length > 1 ? -1 : 0),
              observedEvidenceIds: event.observedEvidenceIds ?? undefined,
              reconcilesEvidence: event.reconcilesEvidence,
              retracts: event.retractsEventId
                ? canonicalRollCallEvidenceId(
                    rows.find((row) => row.event.id === event.retractsEventId)?.event ?? {
                      id: event.retractsEventId,
                    },
                  )
                : undefined,
            },
          ]
        : [],
    );
    const scoped = rows.filter(
      ({ event }) =>
        event.subjectKind === e.subjectKind &&
        event.bookingId === e.bookingId &&
        event.crewPersonId === e.crewPersonId &&
        event.checkpoint === e.checkpoint,
    );
    const validated = new Map(
      scopedCausalEvidence(
        scoped.map((row) => row.event),
        e.checkpoint,
        windows.length > 1 ? -1 : 0,
      ).map((node) => [node.id, node]),
    );
    const pending = [...ids];
    const visited = new Set<string>();
    const ancestry: RollCallEvidence[] = [];
    while (pending.length > 0) {
      const id = pending.pop();
      if (!id || visited.has(id)) continue;
      visited.add(id);
      const node = validated.get(id);
      if (!node) continue;
      ancestry.push(node);
      pending.push(...(node.observed ?? []), ...(node.retracts ? [node.retracts] : []));
    }
    contexts.set(key, {
      meetingDay,
      ancestry,
      observedEvidenceIds: ids,
      conflict:
        new Set(evidence.filter((item) => item.status !== "cleared").map((item) => item.status))
          .size > 1,
      orderingUnknown: (previous?.orderingUnknown ?? false) || e.evidenceOrderingUnknown,
      unknownMeetingDay: (previous?.unknownMeetingDay ?? false) || day === -1,
      evidence,
    });
  }
  // The same selected-day and carry fold as the crew's former separate read,
  // using the event set already read for this tenant/trip's causal context.
  const crewView = manifestRollCallView(
    rows
      .filter(({ event }) => event.subjectKind === "crew")
      .sort((a, b) => compareMarkOrder(a.event, b.event))
      .map(({ event, recorder }) => ({
        event,
        recorder,
        day: event.meetingDay ?? (windows.length > 1 ? -1 : 0),
        subject: event.crewPersonId ?? "",
        checkpoint: event.checkpoint,
        status: event.status,
        evidenceConflict: event.evidenceConflict,
        id: event.id,
        retracts: event.retractsEventId,
      })),
    meetingDay,
  );
  const crewRollCalls = new Map<string, RollCallRecord>();
  for (const { event, recorder, day } of crewView.values()) {
    if (event.status === "cleared") continue;
    crewRollCalls.set(`${event.checkpoint}\u0000${event.crewPersonId}`, {
      state: event.status,
      occurredAt: event.occurredAt,
      recordedByName: recorder,
      note: event.note,
      eventId: event.id,
      ...(day < meetingDay ? { fromEarlierDay: true } : {}),
    });
  }
  return { causal: { meetingDay, contexts }, crewRollCalls, recount };
}

/** An ordinary undo names one standing statement; it is never an opinion about everybody else. */
export async function causalRetractionTarget(
  db: DbExecutor,
  subject: RollCallCausalSubject,
  input: {
    retractsEventId?: string;
    retractsClientEventId?: string;
    observedEvidenceIds?: readonly string[];
    meetingDay?: number;
  },
): Promise<string | undefined> {
  const loaded = await db
    .select()
    .from(rollCallEvents)
    .where(
      and(
        eq(rollCallEvents.shopId, subject.shopId),
        eq(rollCallEvents.tripId, subject.tripId),
        eq(rollCallEvents.checkpoint, subject.checkpoint),
        "bookingId" in subject ? seatMarks() : crewMarks(),
        "bookingId" in subject
          ? eq(rollCallEvents.bookingId, subject.bookingId)
          : eq(rollCallEvents.crewPersonId, subject.personId),
      ),
    );
  const fallbackDay = await causalMeetingDay(db, subject.tripId);
  const rows = (
    await effectiveCausalRowsForDb(
      db,
      loaded.map((event) => ({ event, day: event.meetingDay ?? fallbackDay })),
    )
  ).map(({ event }) => event);
  const target = rows.find(
    (row) =>
      row.id === input.retractsEventId?.toLowerCase() ||
      row.clientEventId === input.retractsClientEventId?.toLowerCase(),
  );
  if (
    !target ||
    (input.observedEvidenceIds !== undefined &&
      !input.observedEvidenceIds.includes(canonicalRollCallEvidenceId(target)))
  )
    return undefined;
  const observerDay = await causalMeetingDay(db, subject.tripId, input.meetingDay);
  const targetDay = target.meetingDay ?? (await causalMeetingDay(db, subject.tripId));
  if (
    input.observedEvidenceIds !== undefined &&
    !causalScopeAllowsObservation(
      observerDay,
      targetDay,
      target.statementStatus ?? target.status,
      subject.checkpoint,
    )
  )
    return undefined;
  const ids = new Map(rows.map((row) => [row.id, canonicalRollCallEvidenceId(row)]));
  const projection = foldEffectiveRollCallEvidence(
    rows.map((row) => ({
      id: canonicalRollCallEvidenceId(row),
      status: row.statementStatus ?? row.status,
      observed: row.observedEvidenceIds ?? undefined,
      reconciles: row.reconcilesEvidence,
      retracts: row.retractsEventId ? ids.get(row.retractsEventId) : undefined,
    })),
    subject.checkpoint,
    () => true,
  );
  return projection.frontier.includes(canonicalRollCallEvidenceId(target)) ? target.id : undefined;
}

/** Validate resolved references against tenant/subject/checkpoint-scoped rows and explicit days.
 * Unknown queued identities remain immutable references until their evidence arrives.
 */
export function scopedCausalEvidence(
  rows: readonly Pick<
    typeof rollCallEvents.$inferSelect,
    | "id"
    | "clientEventId"
    | "status"
    | "statementStatus"
    | "observedEvidenceIds"
    | "reconcilesEvidence"
    | "retractsEventId"
    | "meetingDay"
  >[],
  checkpoint: string,
  fallbackDay = -1,
): RollCallEvidence[] {
  const known = new Map(rows.map((row) => [canonicalRollCallEvidenceId(row), row]));
  const canonical = new Map(rows.map((row) => [row.id, canonicalRollCallEvidenceId(row)]));
  return rows.map((row) => ({
    id: canonicalRollCallEvidenceId(row),
    status: row.statementStatus ?? row.status,
    observed: row.observedEvidenceIds?.filter((id) => {
      const target = known.get(id);
      return (
        !target ||
        causalScopeAllowsObservation(
          row.meetingDay ?? fallbackDay,
          target.meetingDay ?? fallbackDay,
          target.statementStatus ?? target.status,
          checkpoint,
          row.reconcilesEvidence,
        )
      );
    }),
    reconciles: row.reconcilesEvidence,
    retracts: row.retractsEventId ? canonical.get(row.retractsEventId) : undefined,
  }));
}

/** Prepare the complete projection before INSERT; an unprojected row is never committable. */
export async function prepareCausalRollCall(
  db: DbExecutor,
  subject: RollCallCausalSubject,
  input: {
    status: (typeof rollCallEvents.$inferSelect)["status"];
    clientEventId?: string;
    eventId?: string;
    observedEvidenceIds?: string[];
    reconcilesEvidence?: boolean;
    meetingDay?: number;
    retractsEventId?: string;
  },
) {
  const id = input.eventId ?? crypto.randomUUID();
  const identity = canonicalRollCallEvidenceId({ id, clientEventId: input.clientEventId });
  const day = await causalMeetingDay(db, subject.tripId, input.meetingDay);
  const fallbackDay = await causalMeetingDay(db, subject.tripId);
  const loaded = await db
    .select()
    .from(rollCallEvents)
    .where(
      and(
        eq(rollCallEvents.shopId, subject.shopId),
        eq(rollCallEvents.tripId, subject.tripId),
        eq(rollCallEvents.checkpoint, subject.checkpoint),
        "bookingId" in subject ? seatMarks() : crewMarks(),
        "bookingId" in subject
          ? eq(rollCallEvents.bookingId, subject.bookingId)
          : eq(rollCallEvents.crewPersonId, subject.personId),
      ),
    );
  const rows = (
    await effectiveCausalRowsForDb(
      db,
      loaded.map((event) => ({ event, day: event.meetingDay ?? fallbackDay })),
    )
  ).map(({ event }) => event);
  const known = new Map(rows.map((row) => [canonicalRollCallEvidenceId(row), row]));
  const raw = scopedCausalEvidence(rows, subject.checkpoint, fallbackDay);
  const target = rows.find((row) => row.id === input.retractsEventId);
  const next: RollCallEvidence = {
    id: identity,
    status: input.status,
    reconciles: input.reconcilesEvidence,
    observed: input.observedEvidenceIds?.filter((value) => {
      const earlier = known.get(value);
      return (
        !earlier ||
        causalScopeAllowsObservation(
          day,
          earlier.meetingDay ?? fallbackDay,
          earlier.statementStatus ?? earlier.status,
          subject.checkpoint,
          input.reconcilesEvidence,
        )
      );
    }),
    retracts: target ? canonicalRollCallEvidenceId(target) : undefined,
  };
  const projection = projectEffectiveRollCalls(
    [
      ...raw.map((item, index) => {
        const row = rows[index];
        if (!row) throw new Error("roll-call evidence row missing");
        return {
          ...item,
          subject: "current",
          checkpoint: subject.checkpoint,
          day: row.meetingDay ?? fallbackDay,
        };
      }),
      { ...next, subject: "current", checkpoint: subject.checkpoint, day },
    ],
    () => true,
  ).get(effectiveRollCallKey("current", subject.checkpoint, day));
  if (!projection) throw new Error("roll-call projection missing");
  return {
    id,
    meetingDay: day,
    status: projection.status ?? "cleared",
    causalFrontier: projection.frontier,
    evidenceConflict: projection.conflict,
    evidenceOrderingUnknown: projection.orderingUnknown,
  };
}
