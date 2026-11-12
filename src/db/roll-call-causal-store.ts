import { and, asc, count, eq, sql } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import { compareMarkOrder, type RollCallRecord } from "@/lib/roll-call";
import {
  canonicalRollCallEvidenceId,
  causalScopeAllowsObservation,
  foldRollCallEvidence,
  type RollCallCausalContext,
  type RollCallEvidence,
} from "@/lib/roll-call-causality";
import { carriedMissing, manifestRollCallView, standingByDay } from "@/lib/roll-call-days";
import { rollCallDayOf, rollCallDayStarts } from "@/lib/trip-days";
import type { DbExecutor } from "./client";
import { crewMarks, seatMarks } from "./roll-call-subject";
import { people, rollCallEvents, tripScheduleDays } from "./schema";

export type RollCallCausalSubject = {
  shopId: string;
  tripId: string;
  checkpoint: string;
} & ({ bookingId: string } | { personId: string });

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
  const rows = await db
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
  const evidence = scopedCausalEvidence(rows, subject.checkpoint, fallbackDay);
  const unknownWithdrawals = rows
    .filter(
      (row) =>
        (row.meetingDay ?? fallbackDay) < 0 && (row.statementStatus ?? row.status) === "cleared",
    )
    .map((row) => canonicalRollCallEvidenceId(row));
  const groups = new Map<number, typeof rows>();
  for (const row of rows) {
    const day = row.meetingDay ?? (await causalMeetingDay(db, subject.tripId));
    const group = groups.get(day) ?? [];
    group.push(row);
    groups.set(day, group);
  }
  for (const [day, group] of groups) {
    const latest = group.reduce((a, b) => (a.seq > b.seq ? a : b));
    const eligible = new Set([
      ...group.map((row) => canonicalRollCallEvidenceId(row)),
      ...unknownWithdrawals,
    ]);
    const projection = foldRollCallEvidence(evidence, subject.checkpoint, eligible);
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
  const rows = await db
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
  return { causal: { meetingDay, contexts }, crewRollCalls };
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
  const rows = await db
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
  const projection = foldRollCallEvidence(
    rows.map((row) => ({
      id: canonicalRollCallEvidenceId(row),
      status: row.statementStatus ?? row.status,
      observed: row.observedEvidenceIds ?? undefined,
      reconciles: row.reconcilesEvidence,
      retracts: row.retractsEventId ? ids.get(row.retractsEventId) : undefined,
    })),
    subject.checkpoint,
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
  const rows = await db
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
  const eligible = new Set([
    identity,
    ...rows
      .filter(
        (row) =>
          (row.meetingDay ?? fallbackDay) === day ||
          ((row.meetingDay ?? fallbackDay) < 0 &&
            (row.statementStatus ?? row.status) === "cleared"),
      )
      .map((row) => canonicalRollCallEvidenceId(row)),
  ]);
  const projection = foldRollCallEvidence([...raw, next], subject.checkpoint, eligible);
  return {
    id,
    meetingDay: day,
    status: projection.status ?? "cleared",
    causalFrontier: projection.frontier,
    evidenceConflict: projection.conflict,
    evidenceOrderingUnknown: projection.orderingUnknown,
  };
}
