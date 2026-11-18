/**
 * Test-only exploration of immutable receipt identity. This does not validate
 * input, authenticate a user, verify a signature, persist evidence, or issue
 * an acknowledgement. It must not be imported by a production request path.
 */
export type ReceiptIntent = {
  version: 1;
  shopId: string;
  generationId: string;
  tripId: string;
  bookingId: string;
  meeting: { kind: "known"; id: string } | { kind: "unknown" };
  actorId: string;
  clientEventId: string;
  kind: "seen_at_dock";
  occurredAt: string;
};

export function sameReceiptIntent(a: ReceiptIntent, b: ReceiptIntent): boolean {
  return (
    a.version === b.version &&
    a.shopId === b.shopId &&
    a.generationId === b.generationId &&
    a.tripId === b.tripId &&
    a.bookingId === b.bookingId &&
    a.actorId === b.actorId &&
    a.clientEventId === b.clientEventId &&
    a.kind === b.kind &&
    a.occurredAt === b.occurredAt &&
    a.meeting.kind === b.meeting.kind &&
    (a.meeting.kind === "unknown" || (b.meeting.kind === "known" && a.meeting.id === b.meeting.id))
  );
}
