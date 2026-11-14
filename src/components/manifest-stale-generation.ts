// Same-document invalidation is deliberately per trip and contains no roster
// or identity data. A document reload starts unconfirmed and obtains a new read.
const generations = new Map<string, number>();
const listeners = new Map<string, Set<() => void>>();

export function manifestStaleGeneration(tripId: string): number {
  return generations.get(tripId) ?? 0;
}

/** Withdraw confirmation synchronously when the server refuses a stale read. */
export function invalidateManifestRead(tripId: string): void {
  const generation = manifestStaleGeneration(tripId) + 1;
  generations.set(tripId, generation);
  if (pending.has(tripId)) {
    pending.set(tripId, generation);
    running.delete(tripId);
  }
  for (const listener of listeners.get(tripId) ?? []) listener();
}

export function subscribeManifestInvalidation(tripId: string, listener: () => void): () => void {
  const tripListeners = listeners.get(tripId) ?? new Set();
  tripListeners.add(listener);
  listeners.set(tripId, tripListeners);
  return () => {
    tripListeners.delete(listener);
    if (tripListeners.size === 0) listeners.delete(tripId);
  };
}

// A refusal creates a reread obligation. It is handed to the single mounted
// freshness owner and remains pending until the matching rendered read confirms.
const owners = new Map<string, Set<() => boolean>>();
const pending = new Map<string, number>();
const running = new Map<string, { owner: () => boolean }>();
const stalePending = new Set<string>();
const staleAttempts = new Map<string, number>();
const STALE_REREAD_LIMIT = 2;

function drain(tripId: string): boolean {
  const generation = pending.get(tripId);
  const candidates = owners.get(tripId);
  if (generation === undefined || candidates?.size !== 1) return false;
  const owner = candidates.values().next().value;
  if (!owner) return false;
  if (running.get(tripId)?.owner === owner) return true;
  const stale = stalePending.has(tripId);
  const attempts = staleAttempts.get(tripId) ?? 0;
  if (stale && attempts >= STALE_REREAD_LIMIT) return false;
  // Mark before calling the owner: synchronous re-entry must not start twice.
  const attempt = { owner };
  running.set(tripId, attempt);
  if (stale) staleAttempts.set(tripId, attempts + 1);
  const started = owner();
  if (!started) {
    if (running.get(tripId) === attempt) {
      running.delete(tripId);
      if (stale && staleAttempts.get(tripId) === attempts + 1) staleAttempts.set(tripId, attempts);
    }
  } else if (pending.get(tripId) !== generation && running.get(tripId) === attempt) {
    running.delete(tripId);
  }
  return started;
}

/** The mounted freshness owner handles the browser's online event itself. */
export function hasManifestRereadOwner(tripId: string): boolean {
  return owners.get(tripId)?.size === 1;
}

export function requestManifestReread(tripId: string): boolean {
  pending.set(tripId, manifestStaleGeneration(tripId));
  running.delete(tripId);
  return drain(tripId);
}

/** Withdraw immediately and assign recovery to the current per-trip owner. */
export function markManifestReadStale(tripId: string): boolean {
  invalidateManifestRead(tripId);
  pending.set(tripId, manifestStaleGeneration(tripId));
  running.delete(tripId);
  stalePending.add(tripId);
  return drain(tripId);
}

/** An independent trigger allows a new bounded recovery episode. */
export function resetManifestRereadBudget(tripId: string): void {
  staleAttempts.delete(tripId);
}

export function subscribeManifestReread(tripId: string, owner: () => boolean): () => void {
  const candidates = owners.get(tripId) ?? new Set();
  if (candidates.size === 0) resetManifestRereadBudget(tripId);
  candidates.add(owner);
  owners.set(tripId, candidates);
  drain(tripId);
  return () => {
    candidates.delete(owner);
    if (running.get(tripId)?.owner === owner) running.delete(tripId);
    if (!candidates.size) owners.delete(tripId);
    else drain(tripId);
  };
}

export function isManifestRereadRunning(tripId: string, owner: () => boolean): boolean {
  return running.get(tripId)?.owner === owner;
}

export function satisfyPendingManifestReread(tripId: string, generation: number): void {
  if (generation !== manifestStaleGeneration(tripId) || pending.get(tripId) !== generation) return;
  pending.delete(tripId);
  running.delete(tripId);
  stalePending.delete(tripId);
}

/** Reset isolated test state after all owners have unmounted. */
export function resetManifestRereadForTests(tripId: string): void {
  generations.delete(tripId);
  pending.delete(tripId);
  running.delete(tripId);
  stalePending.delete(tripId);
  staleAttempts.delete(tripId);
}

type CommittedRoster = { generation: number; renderId: string; token: string; checkpoint: string };
const committedRosters = new Map<string, CommittedRoster>();
const commitObservers = new Map<string, Set<() => void>>();

export function markManifestRosterCommitted(
  tripId: string,
  renderId: string,
  token: string,
  checkpoint: string,
): () => void {
  const committed = { generation: manifestStaleGeneration(tripId), renderId, token, checkpoint };
  committedRosters.set(tripId, committed);
  for (const listener of commitObservers.get(tripId) ?? []) listener();
  return () => {
    if (committedRosters.get(tripId) === committed) committedRosters.delete(tripId);
  };
}

export function manifestRosterIsCommitted(
  tripId: string,
  generation: number,
  renderId: string,
  token: string,
  checkpoint: string,
): boolean {
  const committed = committedRosters.get(tripId);
  return (
    !!committed &&
    committed.generation === generation &&
    committed.renderId === renderId &&
    committed.token === token &&
    committed.checkpoint === checkpoint
  );
}

export function subscribeManifestRosterCommit(tripId: string, listener: () => void): () => void {
  const listeners = commitObservers.get(tripId) ?? new Set();
  listeners.add(listener);
  commitObservers.set(tripId, listeners);
  return () => {
    listeners.delete(listener);
    if (!listeners.size) commitObservers.delete(tripId);
  };
}
