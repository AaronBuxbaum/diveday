import { revokeIssuedCapabilities } from "./booking-capabilities";
import type { AppDb } from "./client";

/** A readiness link minted for one reminder: the URL it carries and the token behind it. */
export type ReminderLink = { shopId: string; token: string; url: string };

/**
 * The readiness links one reminder pass minted, by booking id, and what became
 * of each (issue #2451). A link that rode a reminder that did not go is a live
 * bearer credential nobody holds, so the pass revokes it once the sends are
 * known: per shop, by token, so a link that was delivered stays live.
 */
export class ReminderLinks {
  private readonly unsent: ReminderLink[] = [];

  constructor(private readonly byBooking: ReadonlyMap<string, ReminderLink>) {}

  /** The link to put in this booking's reminder, if one was minted. */
  urlFor(bookingId: string): string | undefined {
    return this.byBooking.get(bookingId)?.url;
  }

  /** Count one delivery and remember its link if the reminder did not go. */
  settle(
    summary: { sent: number; failed: number },
    bookingId: string,
    delivery: { status: string },
  ): void {
    if (delivery.status === "sent") {
      summary.sent += 1;
      return;
    }
    summary.failed += 1;
    const link = this.byBooking.get(bookingId);
    if (link) this.unsent.push(link);
  }

  /** Take back the links of reminders that did not go. */
  async revokeUnsent(db: AppDb, now: Date): Promise<void> {
    const byShop = new Map<string, string[]>();
    for (const { shopId, token } of this.unsent) {
      byShop.set(shopId, [...(byShop.get(shopId) ?? []), token]);
    }
    for (const [shopId, tokens] of byShop) {
      await revokeIssuedCapabilities(db, { shopId, tokens, now });
    }
  }
}
