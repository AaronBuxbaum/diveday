/** No activation until writer drain, authenticated receipts, recovery and erasure are proven. */
export function dockQueueEnabled(): boolean {
  return false;
}
