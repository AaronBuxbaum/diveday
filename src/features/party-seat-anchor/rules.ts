/** Booking IDs are stable local targets; capability tokens never enter element IDs. */
export function partySeatAnchor(bookingId: string): string {
  return `party-seat-${bookingId}`;
}
