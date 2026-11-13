// Same-document invalidation is deliberately per trip and contains no roster
// or identity data. A document reload starts unconfirmed and obtains a new read.
const generations = new Map<string, number>();
const listeners = new Map<string, Set<() => void>>();

export function manifestStaleGeneration(tripId: string): number {
  return generations.get(tripId) ?? 0;
}

/** Withdraw confirmation synchronously when the server refuses a stale read. */
export function invalidateManifestRead(tripId: string): void {
  generations.set(tripId, manifestStaleGeneration(tripId) + 1);
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
