import { and, asc, count, eq, inArray, or, sql } from "drizzle-orm";
import { canonicalRollCallEvidenceId, foldRollCallEvidence } from "@/lib/roll-call-causality";
import type { DbExecutor } from "./client";
import {
  type RollCallCausalSubject,
  refreshCausalRollCall,
  scopedCausalEvidence,
} from "./roll-call-causal-store";
import { oldestMarkFirst } from "./roll-call-order";
import { crewMarks, seatMarks } from "./roll-call-subject";
import { rollCallEvents, tripScheduleDays, trips } from "./schema";
import type { SeedRollCallEvidenceInput } from "./seed-roll-call-evidence";
import { liveTrip } from "./trips-live";

type EvidenceRow = Parameters<typeof scopedCausalEvidence>[0][number] & { seq: number };
type Scope = { subject: RollCallCausalSubject; rows: EvidenceRow[]; fallbackDay: number };
type ProjectionColumns = Pick<
  typeof rollCallEvents.$inferSelect,
  "meetingDay" | "status" | "causalFrontier" | "evidenceConflict" | "evidenceOrderingUnknown"
>;

function subjectOf(value: SeedRollCallEvidenceInput): RollCallCausalSubject | null {
  const common = {
    shopId: value.shopId,
    tripId: value.tripId,
    checkpoint: value.checkpoint ?? "departure",
  };
  return (value.subjectKind ?? "seat") === "crew"
    ? value.crewPersonId && !value.bookingId
      ? { ...common, personId: value.crewPersonId }
      : null
    : value.bookingId && !value.crewPersonId
      ? { ...common, bookingId: value.bookingId }
      : null;
}

function scopeKey(subject: RollCallCausalSubject) {
  return JSON.stringify([
    subject.shopId,
    subject.tripId,
    subject.checkpoint,
    "bookingId" in subject ? "seat" : "crew",
    "bookingId" in subject ? subject.bookingId : subject.personId,
  ]);
}

function scopeWhere(subject: RollCallCausalSubject) {
  return and(
    eq(rollCallEvents.shopId, subject.shopId),
    eq(rollCallEvents.tripId, subject.tripId),
    eq(rollCallEvents.checkpoint, subject.checkpoint),
    "bookingId" in subject ? seatMarks() : crewMarks(),
    "bookingId" in subject
      ? eq(rollCallEvents.bookingId, subject.bookingId)
      : eq(rollCallEvents.crewPersonId, subject.personId),
  );
}

/** The SQL refresh's same shared fold, over a fixture author's current prefix. */
function prefixProjection(scope: Scope, day: number, next?: EvidenceRow) {
  const rows = next ? [...scope.rows, next] : scope.rows;
  const eligible = new Set(
    rows
      .filter(
        (row) =>
          (row.meetingDay ?? scope.fallbackDay) === day ||
          ((row.meetingDay ?? scope.fallbackDay) < 0 && row.statementStatus === "cleared"),
      )
      .map(canonicalRollCallEvidenceId),
  );
  const evidence = scopedCausalEvidence(rows, scope.subject.checkpoint, scope.fallbackDay);
  if (next?.retractsEventId && !scope.rows.some((row) => row.id === next.retractsEventId)) {
    // A scalar writer cannot retract itself or a future row it has not inserted.
    evidence[evidence.length - 1].retracts = undefined;
  }
  return foldRollCallEvidence(evidence, scope.subject.checkpoint, eligible);
}

function projectionColumns(scope: Scope, day: number, next?: EvidenceRow): ProjectionColumns {
  const projection = prefixProjection(scope, day, next);
  return {
    meetingDay: day,
    status: projection.status ?? "cleared",
    causalFrontier: projection.frontier,
    evidenceConflict: projection.conflict,
    evidenceOrderingUnknown: projection.orderingUnknown,
  };
}

function meetingDay(value: SeedRollCallEvidenceInput, total: number) {
  const captured = value.meetingDay;
  return captured != null && Number.isInteger(captured) && captured >= 0 && captured < total
    ? captured
    : total === 1
      ? 0
      : -1;
}

function latestRow(rows: readonly EvidenceRow[]): EvidenceRow | undefined {
  return rows.reduce<EvidenceRow | undefined>(
    (latest, row) => (!latest || row.seq > latest.seq ? row : latest),
    undefined,
  );
}

/**
 * Array authorship keeps the scalar author's prefix order, not capture-clock
 * order. Read/lock the scopes once, INSERT only fully projected rows in a batch,
 * then run the unchanged SQL refresh once per affected subject/checkpoint.
 * Live crew taps never use this fixture-only path.
 */
export async function seedRollCallEvidenceBatch(
  db: DbExecutor,
  events: readonly SeedRollCallEvidenceInput[],
  options: { observesPrevious: boolean },
  authorScalar: (
    tx: DbExecutor,
    value: SeedRollCallEvidenceInput,
  ) => Promise<(typeof rollCallEvents.$inferSelect)[]>,
): Promise<(typeof rollCallEvents.$inferSelect)[]> {
  if (events.length === 0) return [];
  return db.transaction(async (tx) => {
    // A stable trip lock order also covers arrays spanning several departures.
    const tripSubjects = [
      ...new Map(
        events.map((value) => [JSON.stringify([value.shopId, value.tripId]), value]),
      ).values(),
    ];
    await tx
      .select({ id: trips.id })
      .from(trips)
      .where(
        and(
          liveTrip(),
          or(
            ...tripSubjects.map((value) =>
              and(eq(trips.shopId, value.shopId), eq(trips.id, value.tripId)),
            ),
          ),
        ),
      )
      .orderBy(asc(trips.id))
      .for("no key update");
    const dayCounts = await tx
      .select({ tripId: tripScheduleDays.tripId, n: count() })
      .from(tripScheduleDays)
      .where(
        inArray(
          tripScheduleDays.tripId,
          tripSubjects.map((value) => value.tripId),
        ),
      )
      .groupBy(tripScheduleDays.tripId);
    const totals = new Map(dayCounts.map((row) => [row.tripId, Math.max(row.n, 1)]));
    const scopes = new Map<string, Scope>();
    for (const value of events) {
      const subject = subjectOf(value);
      if (subject)
        scopes.set(scopeKey(subject), {
          subject,
          rows: [],
          fallbackDay: (totals.get(value.tripId) ?? 1) === 1 ? 0 : -1,
        });
    }
    const existing =
      scopes.size === 0
        ? []
        : await tx
            .select()
            // diveday:roll-call-both-subjects: Every OR branch in scopeWhere names the kind and subject.
            .from(rollCallEvents)
            .where(or(...[...scopes.values()].map(({ subject }) => scopeWhere(subject))))
            .orderBy(...oldestMarkFirst());
    for (const row of existing) {
      const subject = subjectOf(row);
      if (subject) scopes.get(scopeKey(subject))?.rows.push(row);
    }

    // Reserve the database's actual default values, in input-auto order.
    // Explicit seq does not advance a PostgreSQL sequence: a later default
    // can be lower than an existing explicit value. Neither max+1 nor append
    // order reproduces scalar projection revisions. Like any nextval, a failed
    // transaction can leave ordinary gaps; those gaps prove no observation.
    const automatic = events.filter((value) => value.seq === undefined).length;
    const reserved =
      automatic === 0
        ? []
        : (
            await tx.execute<{ seq: string | number }>(sql`
      select nextval(pg_get_serial_sequence('roll_call_events', 'seq')) as seq
      from generate_series(1, ${automatic}) as reservation(position)
      order by position
    `)
          ).rows;
    let cursor = 0;
    const authored = events.map((value) =>
      value.seq === undefined ? { ...value, seq: Number(reserved[cursor++].seq) } : value,
    );
    const seen = new Map<string, Set<string>>();
    let ties = false;
    for (const [key, scope] of scopes) {
      const revisions = new Set<string>();
      for (const row of scope.rows) {
        const revision = JSON.stringify([row.meetingDay ?? scope.fallbackDay, row.seq]);
        if (revisions.has(revision)) ties = true;
        revisions.add(revision);
      }
      seen.set(key, revisions);
    }
    for (const value of authored) {
      const subject = subjectOf(value);
      if (!subject) continue;
      const revisions = seen.get(scopeKey(subject));
      const revision = JSON.stringify([
        meetingDay(value, totals.get(value.tripId) ?? 1),
        value.seq,
      ]);
      if (revisions?.has(revision)) ties = true;
      revisions?.add(revision);
    }
    if (ties) {
      // seq is not unique. Let the scalar SQL path retain its own tie choice
      // instead of inventing a tie-breaker in a batch optimization.
      const written: (typeof rollCallEvents.$inferSelect)[] = [];
      for (const value of authored) written.push(...(await authorScalar(tx, value)));
      return written;
    }

    const values: (typeof rollCallEvents.$inferInsert)[] = [];
    const pending = new Map<string, typeof rollCallEvents.$inferInsert>();
    const returnedProjection = new Map<string, ProjectionColumns>();
    const existingRevisions = new Map<
      string,
      { subject: RollCallCausalSubject; projection: ProjectionColumns }
    >();
    const authoredIds = new Set<string>();
    for (const value of authored) {
      const id = value.id ?? crypto.randomUUID();
      if (
        value.retractsEventId !== id &&
        value.retractsEventId &&
        !authoredIds.has(value.retractsEventId) &&
        events.some((later) => later.id === value.retractsEventId)
      ) {
        // A scalar INSERT's immediate FK refuses a withdrawal of a future
        // authored row. A multi-row INSERT must not accidentally legalize it.
        throw new Error("seedRollCallEvidence: withdrawal precedes its target");
      }
      authoredIds.add(id);
      const subject = subjectOf(value);
      if (!subject) {
        // Deliberately invalid fixtures must still fail the real SQL constraint.
        values.push({
          ...value,
          id,
          statementStatus: value.status,
          causalFrontier: [canonicalRollCallEvidenceId({ id, clientEventId: value.clientEventId })],
        });
        continue;
      }
      const scope = scopes.get(scopeKey(subject));
      if (!scope) throw new Error("seedRollCallEvidence: scope missing");
      const day = meetingDay(value, totals.get(value.tripId) ?? 1);
      let observed = value.observedEvidenceIds ?? undefined;
      let retractsEventId = value.retractsEventId ?? undefined;
      if (observed === undefined && options.observesPrevious) {
        const previous = latestRow(scope.rows.filter((row) => row.meetingDay === day));
        observed = previous ? prefixProjection(scope, day).frontier : [];
        if (
          value.status === "cleared" &&
          !retractsEventId &&
          previous &&
          observed.length === 1 &&
          observed.includes(canonicalRollCallEvidenceId(previous))
        )
          retractsEventId = previous.id;
      }
      const next: EvidenceRow = {
        id,
        clientEventId: value.clientEventId ?? null,
        status: value.status,
        statementStatus: value.status,
        meetingDay: day,
        observedEvidenceIds: observed ?? null,
        reconcilesEvidence: value.reconcilesEvidence ?? false,
        retractsEventId: retractsEventId ?? null,
        seq: value.seq as number,
      };
      const projection = projectionColumns(scope, day, next);
      const inserted = {
        ...value,
        id,
        ...projection,
        statementStatus: value.status,
        captureContext: {
          occurredAt: value.occurredAt.toISOString(),
          meetingDay: value.meetingDay ?? undefined,
          retractsEventId,
        },
        retractsEventId: retractsEventId ?? null,
        observedEvidenceIds: observed ?? null,
      };
      values.push(inserted);
      pending.set(id, inserted);
      returnedProjection.set(id, projection);
      scope.rows.push(next);
      // Scalar refresh revises every day's latest row at EACH prefix. A later
      // mark can retire one of those rows, preserving its intermediate result
      // in history. A final-only refresh would silently rewrite that history.
      const latestByDay = new Map<number, EvidenceRow>();
      for (const row of scope.rows) {
        const groupDay = row.meetingDay ?? scope.fallbackDay;
        const previous = latestByDay.get(groupDay);
        if (!previous || row.seq > previous.seq) latestByDay.set(groupDay, row);
      }
      for (const [groupDay, latest] of latestByDay) {
        const revised = projectionColumns(scope, groupDay);
        const queued = pending.get(latest.id);
        if (queued) Object.assign(queued, revised);
        else existingRevisions.set(latest.id, { subject, projection: revised });
        latest.meetingDay = groupDay;
      }
    }
    const written = await tx.insert(rollCallEvents).values(values).returning();
    // Only derived columns of pre-existing rows that scalar prefix refreshes
    // touched. Original intent, actor, note and raw capture time stay immutable.
    for (const [id, revision] of existingRevisions) {
      await tx
        // diveday:roll-call-both-subjects: Iterates both kinds; scopeWhere confines each revision to its named kind and subject.
        .update(rollCallEvents)
        .set(revision.projection)
        .where(and(scopeWhere(revision.subject), eq(rollCallEvents.id, id)));
    }
    for (const { subject } of scopes.values()) await refreshCausalRollCall(tx, subject);
    // Preserve authored return order without relying on SQL RETURNING order.
    const byId = new Map(written.map((row) => [row.id, row]));
    return values.map((value) => {
      const row = byId.get(value.id as string);
      if (!row) throw new Error("seedRollCallEvidence: insert returned no row");
      // Scalar authors return INSERT's prefix projection, before refresh;
      // stored rows can legitimately carry a later prefix revision above.
      return { ...row, ...returnedProjection.get(row.id) };
    });
  });
}
