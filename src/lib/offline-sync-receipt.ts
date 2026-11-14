import type {
  OfflineArrivalEvent,
  OfflineChecklistEvent,
  OfflineManifestEnvelope,
  OfflineRollCallEvent,
} from "./offline-manifests";

type Event = OfflineRollCallEvent | OfflineChecklistEvent | OfflineArrivalEvent;
export type PostedOfflineEvents = {
  events: readonly OfflineRollCallEvent[];
  checklistEvents: readonly OfflineChecklistEvent[];
  arrivalEvents: readonly OfflineArrivalEvent[];
};

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .filter((key) => object[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stable(object[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function identity(event: Event, disposed: boolean) {
  const {
    syncStatus: _sync,
    rejectionReason: _rejection,
    syncedAtRevision: _revision,
    storedOccurredAt: _stored,
    noteDisposition: _disposition,
    unresolvedReason: _unresolved,
    ...rest
  } = event as Event & {
    rejectionReason?: string;
    syncedAtRevision?: number;
    storedOccurredAt?: string;
    noteDisposition?: string;
    unresolvedReason?: string;
  };
  return stable(disposed ? { ...rest, note: null } : rest);
}

/** Called under the manifest lock before applying a receipt to the current envelope. */
export function receiptStillNamesCurrentEvents(
  current: OfflineManifestEnvelope,
  posted: PostedOfflineEvents,
  disposed: ReadonlyMap<string, string> = new Map(),
): boolean {
  const queues = [current.events, current.checklistEvents, current.arrivalEvents ?? []] as const;
  const expected = [posted.events, posted.checklistEvents, posted.arrivalEvents] as const;
  const all = queues.flat();
  if (new Set(all.map((event) => event.clientEventId.toLowerCase())).size !== all.length)
    return false;
  for (let index = 0; index < queues.length; index += 1) {
    for (const original of expected[index]) {
      const found = queues[index].find((event) => event.clientEventId === original.clientEventId);
      if (!found) return false;
      const disposition = disposed.get(original.clientEventId);
      const cleared =
        !!disposition &&
        "note" in found &&
        found.note == null &&
        "noteDisposition" in found &&
        found.noteDisposition === disposition;
      if (identity(original, cleared) !== identity(found, cleared)) return false;
    }
  }
  return true;
}
