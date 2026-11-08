import { and, asc, desc, eq } from "drizzle-orm";
import type { DbExecutor } from "../../db/client";
import { bookings, notificationDeliveries } from "../../db/schema/index";

/** How many sends the diver's record lists; the newest, since the rest is history. */
export const SENT_MESSAGES_LIMIT = 50;

export type SentMessage = Pick<
  typeof notificationDeliveries.$inferSelect,
  "id" | "kind" | "status" | "providerStatus" | "attemptedAt"
>;

/**
 * **What the shop sent this diver**, newest first: the confirmation, the
 * reminders, the recap and the rest, one line per send. The diver's thread
 * (`personThread`) holds what they wrote and what staff typed back; this is the
 * other half of the conversation, read from `notification_deliveries` (one row
 * per send, issue #2728) through the person's own bookings.
 *
 * Shop-scoped twice, on the delivery and on the booking it names, so a row can
 * never be read through another shop's person. Carries no address, subject or
 * provider message id: the record says that a message went and how it landed,
 * and the words stay where they were sent from.
 */
export async function personSentMessages(
  db: DbExecutor,
  shopId: string,
  personId: string,
): Promise<SentMessage[]> {
  return db
    .select({
      id: notificationDeliveries.id,
      kind: notificationDeliveries.kind,
      status: notificationDeliveries.status,
      providerStatus: notificationDeliveries.providerStatus,
      attemptedAt: notificationDeliveries.attemptedAt,
    })
    .from(notificationDeliveries)
    .innerJoin(
      bookings,
      and(eq(bookings.id, notificationDeliveries.bookingId), eq(bookings.shopId, shopId)),
    )
    .where(and(eq(notificationDeliveries.shopId, shopId), eq(bookings.personId, personId)))
    .orderBy(
      desc(notificationDeliveries.attemptedAt),
      asc(notificationDeliveries.kind),
      desc(notificationDeliveries.id),
    )
    .limit(SENT_MESSAGES_LIMIT);
}
