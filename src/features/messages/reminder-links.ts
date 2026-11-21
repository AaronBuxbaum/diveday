/** A readiness link one reminder carries: the URL and the token behind it. */
export type ReminderLink = { shopId: string; token: string; url: string };

/**
 * The readiness links one reminder pass issued, by booking id, and the count
 * of what became of each send. A link is the booking's one live delivered
 * link (issue #2711), so a reminder that did not go leaves it alone: the diver
 * may already hold it from an earlier email, and the next send carries it.
 */
export class ReminderLinks {
  constructor(
    private readonly byBooking: ReadonlyMap<string, ReminderLink>,
    private readonly suppressedBookingIds: ReadonlySet<string> = new Set(),
  ) {}

  /** The link to put in this booking's reminder, if one was issued. */
  urlFor(bookingId: string): string | undefined {
    return this.byBooking.get(bookingId)?.url;
  }

  /** True when the subject stopped being eligible before capability issuance. */
  shouldSend(bookingId: string): boolean {
    return !this.suppressedBookingIds.has(bookingId);
  }

  /** Count one delivery. */
  settle(
    summary: { sent: number; failed: number },
    _bookingId: string,
    delivery: { status: string },
  ): void {
    if (delivery.status === "sent") summary.sent += 1;
    else summary.failed += 1;
  }
}
