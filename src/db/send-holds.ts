import { and, eq, or } from "drizzle-orm";
import { log } from "@/lib/log";
import type { Notification, NotificationDelivery } from "@/lib/notifications";
import type { DbExecutor } from "./client";
import { notificationHeldForRehearsal, REHEARSAL_HELD_DELIVERY } from "./rehearsals";
import { emailBounces } from "./schema";

/**
 * What a send to an address that already bounced for good (or complained)
 * reports. Non-retryable, so it is never queued, and coded, so a delivery row
 * reads "suppressed" rather than an error someone should chase.
 */
export const SUPPRESSED_RECIPIENT_DELIVERY = {
  status: "failed",
  retryable: false,
  errorCode: "recipient_suppressed",
} as const satisfies NotificationDelivery;

/** Codes for a send held on purpose: nothing was meant to leave, so no one chases it. */
export const HELD_SEND_ERROR_CODES: readonly string[] = [
  // Literals, not the constants: `rehearsals.ts` sits in an import cycle with
  // this file, and a constant read at load time can still be undefined.
  "rehearsal_departure",
  "recipient_suppressed",
  "demo_shop_held",
];

/**
 * Whether SES already told us this address cannot or does not want to be
 * mailed: a Permanent bounce or any complaint, inside the `email_bounces`
 * retention window. SES keeps its own suppression list, but a send to a
 * suppressed address is still a send that comes back as a bounce, so we stop
 * it before the provider is asked.
 */
export async function recipientSuppressed(db: DbExecutor, to: string): Promise<boolean> {
  const recipient = to.trim().toLowerCase();
  if (!recipient) return false;
  const [row] = await db
    .select({ id: emailBounces.id })
    .from(emailBounces)
    .where(
      and(
        eq(emailBounces.recipient, recipient),
        or(
          eq(emailBounces.event, "complaint"),
          and(eq(emailBounces.event, "bounce"), eq(emailBounces.bounceType, "Permanent")),
        ),
      ),
    )
    .limit(1);
  return row !== undefined;
}

/**
 * **The one question asked of every outbound email before a provider sees
 * it**: is it held? A rehearsal sends nothing to anyone (ADR
 * 20261012-rehearsal-departures); an address that bounced for good or
 * complained is not mailed again. Null means send.
 */
export async function notificationHeldBeforeSend(
  db: DbExecutor,
  notification: Notification,
): Promise<NotificationDelivery | null> {
  if (await notificationHeldForRehearsal(db, notification)) return REHEARSAL_HELD_DELIVERY;
  if (await recipientSuppressed(db, notification.to)) {
    // The kind only: the payload carries an address.
    log("notification.held_recipient_suppressed", "info", { kind: notification.kind });
    return SUPPRESSED_RECIPIENT_DELIVERY;
  }
  return null;
}
