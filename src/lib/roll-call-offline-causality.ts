import {
  type OfflineManifestSnapshot,
  type OfflineRollCallEvent,
  type OfflineRollCallResult,
  offlineEventInCopy,
} from "./offline-manifests";
import {
  causalScopeAllowsObservation,
  clientRollCallEvidenceId,
  foldRollCallEvidence,
  type RollCallCausalContext,
  type RollCallProjection,
} from "./roll-call-causality";

import { carriedMissing, type DayMark, standingByDay } from "./roll-call-days";

type Subject = { bookingId: string } | { crewPersonId: string };
type Checkpoint = OfflineManifestSnapshot["manifests"][number]["checkpoint"];
const MEETING_PROOF =
  /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.(0|[1-9]\d*)\.(-?[0-9a-z]+)\.(-?[0-9a-z]+)\.(0|[1-9]\d*)\.([A-Za-z0-9_-]{43})$/i;

/** A queue's ordinal only names the same meeting while its captured identity and window still match. */
function eventMeetingDay(
  snapshot: OfflineManifestSnapshot,
  event: OfflineRollCallEvent,
  multiDay: boolean,
): number {
  const original = event.meetingDay ?? (multiDay ? -1 : 0);
  if (original < 0) return -1;
  if (event.syncStatus !== "pending" && event.snapshotId === snapshot.snapshotId) return original;
  const capturedToken = event.meetingIdentityProof;
  const currentToken = snapshot.rollCallMeetingDays?.[original]?.meetingIdentityProof;
  const captured = capturedToken?.match(MEETING_PROOF);
  const current = currentToken?.match(MEETING_PROOF);
  if (!captured || !current || captured[2] !== String(original) || current[2] !== String(original))
    return -1;
  const starts = Number.parseInt(captured[3], 36);
  const ends = Number.parseInt(captured[4], 36);
  const generation = Number(captured[5]);
  if (
    !Number.isSafeInteger(starts) ||
    !Number.isSafeInteger(ends) ||
    ends <= starts ||
    starts.toString(36) !== captured[3] ||
    ends.toString(36) !== captured[4] ||
    !Number.isSafeInteger(generation) ||
    generation > 2_147_483_647
  )
    return -1;
  if (event.snapshotId === snapshot.snapshotId && capturedToken !== currentToken) return -1;
  return captured[1].toLowerCase() === current[1].toLowerCase() &&
    captured[3] === current[3] &&
    captured[4] === current[4] &&
    captured[5] === current[5]
    ? original
    : -1;
}

/** Uncertainty follows queued causal dependencies even before the next sync. */
export function offlineReviewReasons(
  snapshot: OfflineManifestSnapshot,
  events: readonly OfflineRollCallEvent[],
): Map<string, string> {
  const multiDay = (snapshot.rollCallDayBoundaries?.length ?? 0) > 0;
  const blocked = new Set(
    events
      .filter((event) => event.syncStatus === "rejected")
      .map((event) => clientRollCallEvidenceId(event.clientEventId)),
  );
  const reasons = new Map<string, string>();
  const dependents = new Map<string, OfflineRollCallEvent[]>();
  for (const event of events) {
    if (event.syncStatus !== "pending") continue;
    const dependencies = [
      ...(event.observedEvidenceIds ?? []).map((id) => id.toLowerCase()),
      ...(event.retractsClientEventId
        ? [clientRollCallEvidenceId(event.retractsClientEventId)]
        : []),
    ];
    for (const id of dependencies) {
      const dependent = dependents.get(id) ?? [];
      dependent.push(event);
      dependents.set(id, dependent);
    }
    const reason =
      event.unresolvedReason ??
      (eventMeetingDay(snapshot, event, multiDay) < 0 ? "meeting_identity_unverified" : undefined);
    if (reason) {
      reasons.set(event.clientEventId, reason);
      blocked.add(clientRollCallEvidenceId(event.clientEventId));
    }
  }
  const queue = [...blocked];
  for (let index = 0; index < queue.length; index += 1) {
    for (const event of dependents.get(queue[index]) ?? []) {
      if (reasons.has(event.clientEventId)) continue;
      reasons.set(event.clientEventId, "unresolved_predecessor");
      const id = clientRollCallEvidenceId(event.clientEventId);
      if (!blocked.has(id)) {
        blocked.add(id);
        queue.push(id);
      }
    }
  }
  return reasons;
}

/** Read the rendered snapshot and queued evidence; no transport or wall clock orders it. */
export function offlineCausalContext(
  snapshot: OfflineManifestSnapshot,
  events: readonly OfflineRollCallEvent[],
  subject: Subject,
  checkpoint: Checkpoint,
): RollCallCausalContext {
  return contextAt(snapshot, events, subject, checkpoint, true).context;
}

function contextAt(
  snapshot: OfflineManifestSnapshot,
  events: readonly OfflineRollCallEvent[],
  subject: Subject,
  checkpoint: Checkpoint,
  includeCarried: boolean,
): { context: RollCallCausalContext; projection: RollCallProjection } {
  const manifest = snapshot.manifests.find((item) => item.checkpoint === checkpoint);
  const row =
    "bookingId" in subject
      ? manifest?.divers.find((item) => item.bookingId === subject.bookingId)
      : manifest?.crew.find((item) => item.id === subject.crewPersonId);
  const savedContext = row?.rollCallContext;
  const multiDay = (snapshot.rollCallDayBoundaries?.length ?? 0) > 0;
  const meetingDay =
    snapshot.selectedRollCallMeetingDay ??
    savedContext?.meetingDay ??
    snapshot.rollCallMeetingDay ??
    0;
  const saved: RollCallCausalContext["evidence"] =
    savedContext?.evidence ??
    (row?.rollCall && !row.rollCall.implied
      ? [
          {
            id: `legacy:${snapshot.snapshotId}:${"bookingId" in subject ? subject.bookingId : subject.crewPersonId}:${checkpoint}`,
            status: row.rollCall.state,
            recordedByName: row.rollCall.recordedByName,
            occurredAt: row.rollCall.occurredAt,
            note: row.rollCall.note ?? null,
            meetingDay: multiDay ? -1 : 0,
          },
        ]
      : []);
  const sameSubject = (event: OfflineRollCallEvent) =>
    "bookingId" in subject
      ? event.bookingId === subject.bookingId && !event.crewPersonId
      : event.crewPersonId === subject.crewPersonId && !event.bookingId;
  const reviewReasons = offlineReviewReasons(snapshot, events);
  const uncertainDock =
    checkpoint === "departure" &&
    events.some(
      (event) =>
        sameSubject(event) &&
        event.checkpoint === checkpoint &&
        reviewReasons.has(event.clientEventId),
    );
  // A refusal is local uncertainty, not an accepted statement or causal edge.
  // It cannot keep this device's old dock exemption/positive count confirmed.
  // Accepted server evidence remains distinct; other devices learn no refusal.
  const refusedDock =
    uncertainDock ||
    (checkpoint === "departure" &&
      events.some(
        (event) =>
          sameSubject(event) &&
          event.checkpoint === checkpoint &&
          event.syncStatus === "rejected" &&
          (eventMeetingDay(snapshot, event, multiDay) === meetingDay ||
            eventMeetingDay(snapshot, event, multiDay) === -1),
      ));
  const local = events.filter(
    (event) =>
      !refusedDock &&
      event.checkpoint === checkpoint &&
      // A correction awaiting an unresolved predecessor is not accepted causal
      // evidence and cannot silence a missing report on this device.
      (!reviewReasons.has(event.clientEventId) ||
        (checkpoint !== "departure" && event.status === "not_boarded")) &&
      // Retained clock/auth-refused alarms remain crew evidence. A refused
      // positive correction or dock exemption cannot suppress an alarm.
      (event.syncStatus !== "rejected" ||
        (checkpoint !== "departure" && event.status === "not_boarded")) &&
      !offlineEventInCopy(snapshot, event) &&
      sameSubject(event),
  );
  const all: RollCallCausalContext["evidence"] = [
    ...(uncertainDock
      ? []
      : refusedDock
        ? saved.filter(
            (item) =>
              savedContext &&
              !events.some(
                (event) =>
                  sameSubject(event) &&
                  event.checkpoint === "departure" &&
                  event.syncStatus === "rejected" &&
                  (event.retractsClientEventId
                    ? clientRollCallEvidenceId(event.retractsClientEventId) === item.id
                    : event.observedEvidenceIds?.includes(item.id)),
              ),
          )
        : saved),
    ...local.map((event) => ({
      id: clientRollCallEvidenceId(event.clientEventId),
      status: event.status,
      recordedByName: "",
      occurredAt: event.storedOccurredAt ?? event.occurredAt,
      note: event.note ?? null,
      meetingDay: eventMeetingDay(snapshot, event, multiDay),
      observedEvidenceIds:
        event.syncStatus === "rejected" || reviewReasons.has(event.clientEventId)
          ? undefined
          : event.observedEvidenceIds,
      reconcilesEvidence: reviewReasons.has(event.clientEventId) ? false : event.reconcilesEvidence,
      retracts:
        !reviewReasons.has(event.clientEventId) && event.retractsClientEventId
          ? clientRollCallEvidenceId(event.retractsClientEventId)
          : undefined,
    })),
  ];
  const eligible = new Set(
    all
      .filter(
        (item) =>
          item.meetingDay === meetingDay ||
          ((item.meetingDay ?? -1) < 0 && item.status === "cleared") ||
          (!includeCarried && (item.meetingDay ?? -1) < 0) ||
          (includeCarried &&
            checkpoint !== "departure" &&
            item.status === "not_boarded" &&
            (item.meetingDay ?? -1) < meetingDay),
      )
      .map((item) => item.id),
  );
  if (includeCarried)
    excludeQualifiedReturns(snapshot, events, subject, checkpoint, meetingDay, all, eligible);
  const projection = foldRollCallEvidence(
    [
      ...(savedContext?.ancestry ?? []),
      ...all.map((item) => ({
        id: item.id,
        status: item.status,
        observed: item.observedEvidenceIds?.filter((id) => {
          const target = all.find((known) => known.id === id);
          return (
            !target ||
            causalScopeAllowsObservation(
              item.meetingDay ?? -1,
              target.meetingDay ?? -1,
              target.status,
              checkpoint,
              item.reconcilesEvidence,
            )
          );
        }),
        reconciles: item.reconcilesEvidence,
        retracts: item.retracts,
      })),
    ],
    checkpoint,
    eligible,
  );
  const evidence = all.filter(
    (item, index) =>
      projection.frontier.includes(item.id) &&
      all.findIndex((other) => other.id === item.id) === index,
  );
  return {
    projection,
    context: {
      meetingDay,
      observedEvidenceIds: projection.frontier,
      conflict: projection.conflict,
      orderingUnknown: projection.orderingUnknown,
      unknownMeetingDay: evidence.some((item) => item.meetingDay === -1),
      evidence,
      ancestry: savedContext?.ancestry,
    },
  };
}

/** Apply the existing meeting-day return rule to standing, identified evidence.
 * This affects only carried display eligibility; it creates no causal edges.
 */
function excludeQualifiedReturns(
  snapshot: OfflineManifestSnapshot,
  events: readonly OfflineRollCallEvent[],
  subject: Subject,
  checkpoint: Checkpoint,
  meetingDay: number,
  evidence: RollCallCausalContext["evidence"],
  eligible: Set<string>,
): void {
  const missingDays = new Set(
    evidence
      .filter(
        (item) =>
          item.status === "not_boarded" &&
          item.meetingDay !== undefined &&
          Number.isInteger(item.meetingDay) &&
          item.meetingDay >= 0 &&
          item.meetingDay < meetingDay &&
          eligible.has(item.id),
      )
      .map((item) => item.meetingDay as number),
  );
  if (missingDays.size === 0) return;
  const checkpoints = new Set<Checkpoint>();
  const days = new Set<number>();
  const addDay = (day: number | undefined) => {
    if (day !== undefined && Number.isInteger(day) && day >= 0 && day <= meetingDay) days.add(day);
  };
  for (const manifest of snapshot.manifests) {
    checkpoints.add(manifest.checkpoint);
    const row =
      "bookingId" in subject
        ? manifest.divers.find((item) => item.bookingId === subject.bookingId)
        : manifest.crew.find((item) => item.id === subject.crewPersonId);
    for (const item of row?.rollCallContext?.evidence ?? []) addDay(item.meetingDay);
  }
  for (const event of events) {
    const matches =
      "bookingId" in subject
        ? event.bookingId === subject.bookingId && !event.crewPersonId
        : event.crewPersonId === subject.crewPersonId && !event.bookingId;
    if (!matches) continue;
    checkpoints.add(event.checkpoint);
    addDay(eventMeetingDay(snapshot, event, (snapshot.rollCallDayBoundaries?.length ?? 0) > 0));
  }
  const cache = new Map<string, ReturnType<typeof contextAt>>();
  const standingAt = (day: number, at: Checkpoint) => {
    const key = `${day}/${at}`;
    let standing = cache.get(key);
    if (!standing) {
      standing = contextAt(
        { ...snapshot, selectedRollCallMeetingDay: day },
        events,
        subject,
        at,
        false,
      );
      cache.set(key, standing);
    }
    return standing;
  };
  const certain = ({ context, projection }: ReturnType<typeof contextAt>) =>
    !projection.conflict &&
    !projection.orderingUnknown &&
    !context.unknownMeetingDay &&
    context.evidence.every(
      (item) =>
        item.meetingDay === context.meetingDay &&
        (item.id.startsWith("client:") || item.id.startsWith("server:")),
    );
  const returns: DayMark[] = [];
  for (const day of days)
    for (const at of checkpoints) {
      const standing = standingAt(day, at);
      if (standing.projection.status === "boarded" && certain(standing))
        returns.push({ subject: "person", checkpoint: at, day, status: "boarded" });
    }
  for (const day of missingDays) {
    const missing = standingAt(day, checkpoint);
    if (missing.projection.status !== "not_boarded" || !certain(missing)) continue;
    const mark: DayMark = {
      subject: "person",
      checkpoint,
      day,
      status: "not_boarded",
      id: "carried",
    };
    const stillMissing = [
      ...carriedMissing(standingByDay([mark, ...returns]), meetingDay).values(),
    ].some((item) => item.id === mark.id);
    if (!stillMissing)
      for (const item of evidence)
        if (item.meetingDay === day && item.status === "not_boarded") eligible.delete(item.id);
  }
}

export function causalOfflineResult(
  snapshot: OfflineManifestSnapshot,
  events: readonly OfflineRollCallEvent[],
  subject: Subject,
  checkpoint: Checkpoint,
): OfflineRollCallResult | undefined {
  // Reuse the validated full graph; frontier statuses alone discard exact
  // targets and make a genuine undo look like an unknown withdrawal.
  const { context, projection } = contextAt(snapshot, events, subject, checkpoint, true);
  if (!projection.status || projection.status === "cleared") {
    if (checkpoint !== "departure") {
      const dock = causalOfflineResult(snapshot, events, subject, "departure");
      const review = offlineReviewReasons(snapshot, events);
      const uncertainDock = events.some(
        (event) =>
          event.checkpoint === "departure" &&
          review.has(event.clientEventId) &&
          ("bookingId" in subject
            ? event.bookingId === subject.bookingId && !event.crewPersonId
            : event.crewPersonId === subject.crewPersonId && !event.bookingId),
      );
      if (dock?.state === "not_boarded" && !dock.evidenceConflict && !uncertainDock)
        return { ...dock, implied: true };
    }
    return undefined;
  }
  const item = context.evidence.find((evidence) => evidence.status === projection.status);
  if (!item) return undefined;
  const local = events.find((event) => clientRollCallEvidenceId(event.clientEventId) === item.id);
  const pendingIds = new Set(
    events
      .filter((event) => event.syncStatus === "pending")
      .map((event) => clientRollCallEvidenceId(event.clientEventId)),
  );
  const ownRetractable =
    local &&
    local.syncStatus !== "rejected" &&
    !events.some(
      (event) =>
        event.syncStatus === "rejected" &&
        event.status === "cleared" &&
        event.retractsClientEventId === local.clientEventId,
    );
  return {
    state: projection.status,
    occurredAt: item.occurredAt,
    recordedByName: item.recordedByName,
    note: item.note,
    // Multiple compatible frontier statements can support the same status.
    // A saved statement chosen for attribution must not hide another pending
    // statement from the row's waiting-to-send indicator.
    pending: context.evidence.some((evidence) => pendingIds.has(evidence.id)),
    implied: false,
    local: !!ownRetractable && !context.conflict,
    clientEventId: ownRetractable && !context.conflict ? local.clientEventId : undefined,
    evidenceConflict: context.conflict,
    causalContext: context,
  };
}
