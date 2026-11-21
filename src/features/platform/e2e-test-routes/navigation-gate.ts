type Gate = { promise: Promise<void>; release: () => void };

type GateGlobal = typeof globalThis & { __divedayE2ENavigationGates?: Map<string, Gate> };

// Route handlers and server components can be compiled into different chunks.
// One worker process owns one test database and this matching gate registry.
const shared = globalThis as GateGlobal;
const gates = shared.__divedayE2ENavigationGates ?? new Map<string, Gate>();
shared.__divedayE2ENavigationGates = gates;

export function armNavigationGate(tripId: string): boolean {
  if (gates.has(tripId)) return false;
  const { promise, resolve } = Promise.withResolvers<void>();
  gates.set(tripId, { promise, release: resolve });
  return true;
}

export function releaseNavigationGate(tripId: string): boolean {
  const gate = gates.get(tripId);
  if (!gate) return false;
  gates.delete(tripId);
  gate.release();
  return true;
}

export function clearNavigationGates(): void {
  for (const [tripId] of gates) releaseNavigationGate(tripId);
}

export function waitForNavigationGate(tripId: string): Promise<void> | undefined {
  return gates.get(tripId)?.promise;
}
