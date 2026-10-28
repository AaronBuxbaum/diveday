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
  private readonly sent = new Set<string>();

  constructor(
    private readonly byBooking: ReadonlyMap<string, ReminderLink>,
    private readonly suppressedBookingIds: ReadonlySet<string> = new Set(),
  ) {}

  /** The link to put in this booking's reminder, if one was minted. */
  urlFor(bookingId: string): string | undefined {
    return this.byBooking.get(bookingId)?.url;
  }

  /** True when the subject stopped being eligible before capability issuance. */
  shouldSend(bookingId: string): boolean {
    return !this.suppressedBookingIds.has(bookingId);
  }

  /** Count one delivery and remember its link if the reminder did not go. */
  settle(
    summary: { sent: number; failed: number },
    bookingId: string,
    delivery: { status: string },
  ): void {
    if (delivery.status === "sent") {
      summary.sent += 1;
      this.sent.add(bookingId);
      return;
    }
    summary.failed += 1;
  }

  /**
   * Run the sends, then take back what they left unsent, **also when they
   * throw**: a pass that dies part-way revokes every link it minted and did not
   * send, not only those of the sends it saw fail (#2451).
   */
  async whileSending(db: AppDb, now: Date, send: () => Promise<void>): Promise<void> {
    try {
      await send();
    } finally {
      await this.revokeUnsent(db, now);
    }
  }

  /**
   * Take back the link of every reminder that did not go: one that failed, and
   * one a pass that threw never reached. Everything minted and not sent, so it
   * belongs in a `finally`.
   */
  async revokeUnsent(db: AppDb, now: Date): Promise<void> {
    const byShop = new Map<string, string[]>();
    for (const [bookingId, { shopId, token }] of this.byBooking) {
      if (this.sent.has(bookingId)) continue;
      byShop.set(shopId, [...(byShop.get(shopId) ?? []), token]);
    }
    for (const [shopId, tokens] of byShop) {
      await revokeIssuedCapabilities(db, { shopId, tokens, now });
    }
  }
}
