/** Anonymous phase timings for the synthetic e2e fleet, never live requests. */
let nextSequence = 0;

const PHASE =
  /^(?:entry\.(?:preflight|mint-transaction|shop-and-seat|sign-in)|mint\.(?:cap|clone|core|packages|schedule)|schedule\.(?:board|step\.\d+))$/;

export function createDemoEntryTiming(
  enabled: boolean,
  clock: () => number = () => performance.now(),
  write: (line: string) => void = (line) => console.error(line),
) {
  if (!enabled) return undefined;
  const sequence = ++nextSequence;
  let previous = clock();
  const record = (phase: string, durationMs: number) => {
    if (!PHASE.test(phase) || !Number.isFinite(durationMs) || durationMs < 0) return;
    write(`demo-entry-timing ${process.pid}:${sequence} ${phase} ${Math.round(durationMs)}ms`);
  };
  return {
    record,
    mark(phase: string) {
      const now = clock();
      record(phase, now - previous);
      previous = now;
    },
  };
}
