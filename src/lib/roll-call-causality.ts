import type { RollCallStatus } from "./roll-call-days";

/** Server row UUIDs and client tap UUIDs are independent namespaces. */
export function clientRollCallEvidenceId(id: string): string {
  return `client:${id.toLowerCase()}`;
}

export function canonicalRollCallEvidenceId(row: {
  id: string;
  clientEventId?: string | null;
}): string {
  return row.clientEventId
    ? clientRollCallEvidenceId(row.clientEventId)
    : `server:${row.id.toLowerCase()}`;
}

export const rollCallEvidenceIdPattern =
  /^(?:client|server):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type RollCallIntent = {
  checkpoint?: string;
  status: string;
  observedEvidenceIds?: readonly string[] | null;
  reconcilesEvidence?: boolean;
  meetingDay?: number;
  retractsEventId?: string;
  retractsClientEventId?: string;
};

/** Retry identity names immutable causal intent; audit clocks cannot alter it. */
export function rollCallIntentKey<T extends RollCallIntent>(event: T): string {
  const basis =
    event.observedEvidenceIds == null
      ? null
      : [...new Set(event.observedEvidenceIds.map((id) => id.toLowerCase()))].sort();
  return JSON.stringify([
    event.checkpoint ?? "departure",
    event.status,
    basis,
    event.reconcilesEvidence === true,
    event.meetingDay ?? null,
    event.status === "cleared" ? (event.retractsEventId?.toLowerCase() ?? null) : null,
    event.status === "cleared" ? (event.retractsClientEventId?.toLowerCase() ?? null) : null,
  ]);
}

/** A statement's identity and basis are fixed when the crew tap, before transport. */
export type RollCallEvidence = {
  id: string;
  status: RollCallStatus;
  /** Absent on older evidence: it proves no observation of another statement. */
  observed?: readonly string[];
  /** Only the deliberate reconciliation control may set this. */
  reconciles?: boolean;
  /** A previously validated retraction supersedes precisely this target. */
  retracts?: string;
};

export type RollCallProjection = {
  status: RollCallStatus | null;
  conflict: boolean;
  frontier: string[];
  orderingUnknown: boolean;
  /** A conflict cannot close a checkpoint even when its risk status is aboard. */
  accountedFor: boolean;
};

function causalEvidenceFrontier(
  evidence: readonly RollCallEvidence[],
  eligible?: ReadonlySet<string>,
) {
  const byId = new Map<string, RollCallEvidence>();
  for (const item of evidence) if (!byId.has(item.id)) byId.set(item.id, item);
  const superseded = new Set<string>();

  const edges = new Map<string, RollCallEvidence[]>();
  for (const item of byId.values()) {
    const observed = (item.observed ?? []).flatMap((id) => {
      const known = byId.get(id);
      return known && id !== item.id ? [known] : [];
    });
    // A validated historical retraction proves only its exact target, never
    // observation of another statement that happened to share its timestamp.
    const target = item.status === "cleared" && item.retracts ? byId.get(item.retracts) : undefined;
    edges.set(
      item.id,
      new Set(observed.filter((known) => known.status !== "cleared").map((known) => known.status))
        .size > 1 && !item.reconciles
        ? []
        : item.status === "cleared" && !item.reconciles
          ? target
            ? [target]
            : []
          : [...observed, ...(target ? [target] : [])],
    );
  }
  const ancestorsOf = (id: string) => {
    const visited = new Set<string>();
    const ancestors = [...(edges.get(id) ?? [])];
    while (ancestors.length > 0) {
      const ancestor = ancestors.pop();
      if (!ancestor || visited.has(ancestor.id)) continue;
      visited.add(ancestor.id);
      ancestors.push(...(edges.get(ancestor.id) ?? []));
    }
    return visited;
  };
  // Cut every cyclic node's edges before following any later statement. A
  // descendant cannot turn corrupt context into evidence of observation.
  const cyclic = [...byId.keys()].filter((id) => ancestorsOf(id).has(id));
  for (const id of cyclic) edges.set(id, []);
  for (const id of byId.keys()) for (const ancestor of ancestorsOf(id)) superseded.add(ancestor);

  const frontier = [...byId.values()].filter(
    (item) => !superseded.has(item.id) && (!eligible || eligible.has(item.id)),
  );
  return { frontier, edges };
}

function unresolvedWithdrawal(
  item: RollCallEvidence,
  edges: ReadonlyMap<string, readonly RollCallEvidence[]>,
): boolean {
  return (
    item.status === "cleared" &&
    !item.reconciles &&
    (!item.retracts || !edges.get(item.id)?.some((target) => target.id === item.retracts))
  );
}

/**
 * A multi-value register: delivery order and device clocks cannot erase evidence.
 * Callers scope the evidence to one subject, meeting day and checkpoint. They
 * authenticate and validate basis IDs before persisting a statement. Retrying
 * an identity never changes its original intent or observations.
 */
export function foldRollCallEvidence(
  evidence: readonly RollCallEvidence[],
  checkpoint: string,
  eligible?: ReadonlySet<string>,
): RollCallProjection {
  const { frontier, edges } = causalEvidenceFrontier(evidence, eligible);
  const statements = frontier.filter((item) => item.status !== "cleared");
  const statuses = new Set(statements.map((item) => item.status));
  const conflict = statuses.size > 1;
  // At departure an ashore statement is an exemption carried to later dives.
  // Opposing dock evidence must keep the person in the at-risk population.
  const ordinaryStatus = conflict
    ? checkpoint === "departure"
      ? statuses.has("boarded")
        ? "boarded"
        : "cleared"
      : statuses.has("not_boarded")
        ? "not_boarded"
        : "cleared"
    : (statements[0]?.status ?? (frontier.length > 0 ? "cleared" : null));
  // A targetless undo cannot leave a positive/exempting word confirmed. It
  // also cannot erase real missing evidence or manufacture an aboard report.
  const status =
    !conflict &&
    frontier.some((item) => unresolvedWithdrawal(item, edges)) &&
    !(checkpoint !== "departure" && ordinaryStatus === "not_boarded")
      ? "cleared"
      : ordinaryStatus;
  return {
    status,
    conflict,
    frontier: frontier.map((item) => item.id).sort(),
    orderingUnknown: conflict && frontier.some((item) => item.observed === undefined),
    accountedFor:
      !conflict &&
      status !== null &&
      status !== "cleared" &&
      (checkpoint === "departure" || status === "boarded"),
  };
}

/** Named, tenant-scoped evidence rendered to crew; no global sequence is exposed. */
export type RollCallCausalContext = {
  meetingDay: number;
  observedEvidenceIds: string[];
  conflict: boolean;
  orderingUnknown: boolean;
  unknownMeetingDay: boolean;
  /** Identity/intent/edges only; resolved notes and recorder names stay off devices. */
  ancestry?: RollCallEvidence[];
  evidence: {
    id: string;
    eventId?: string;
    status: RollCallStatus;
    recordedByName: string;
    occurredAt: string;
    note: string | null;
    meetingDay?: number;
    observedEvidenceIds?: string[];
    reconcilesEvidence?: boolean;
    retracts?: string;
  }[];
};

/** Queue dependencies precede their observers, independently of capture clocks. */
export function causalReplayOrder<
  T extends { clientEventId: string; observedEvidenceIds?: readonly string[] },
>(events: readonly T[]): T[] {
  const pending = [...events];
  const result: T[] = [];
  while (pending.length > 0) {
    const ids = new Set(pending.map((event) => clientRollCallEvidenceId(event.clientEventId)));
    const index = pending.findIndex(
      (event) =>
        !(event.observedEvidenceIds ?? []).some(
          (id) => id !== clientRollCallEvidenceId(event.clientEventId) && ids.has(id),
        ),
    );
    // Corrupt cyclic context cannot establish precedence; preserve every event.
    const [next] = pending.splice(index < 0 ? 0 : index, 1);
    if (next) result.push(next);
  }
  return result;
}

/** A current checkpoint may name carried missing evidence, never another day's attendance. */
export function causalScopeAllowsObservation(
  observerDay: number,
  targetDay: number,
  targetStatus: RollCallStatus,
  checkpoint: string,
  reconciles = false,
): boolean {
  return (
    observerDay === targetDay ||
    (observerDay >= 0 && targetDay < 0 && targetStatus === "cleared") ||
    (checkpoint !== "departure" &&
      observerDay >= 0 &&
      targetDay < observerDay &&
      (targetStatus === "not_boarded" || reconciles))
  );
}
