// Test routes and RSC pages may be separate bundles in the same E2E worker.
type CounterGlobal = typeof globalThis & { __divedayE2EManifestReads?: Map<string, number> };
const shared = globalThis as CounterGlobal;
const counts = shared.__divedayE2EManifestReads ?? new Map<string, number>();
shared.__divedayE2EManifestReads = counts;

/** Only armed trips are counted; the caller must be in the E2E harness. */
export function recordManifestRead(tripId: string): void {
  const count = counts.get(tripId);
  if (count !== undefined) counts.set(tripId, count + 1);
}

export function resetManifestReadCount(tripId: string): void {
  counts.set(tripId, 0);
}

export function getManifestReadCount(tripId: string): number | undefined {
  return counts.get(tripId);
}

export function clearManifestReadCount(tripId: string): void {
  counts.delete(tripId);
}
