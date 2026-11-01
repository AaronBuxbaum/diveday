import { and, eq, isNull } from "drizzle-orm";
import { moveAskAlertDue } from "@/lib/inbox";
import { log } from "@/lib/log";
import { type NotificationProvider, publicAppUrl, recipientLocale } from "@/lib/notifications";
import { shopPath } from "@/lib/staff-notices";
import type { AppDb } from "./client";
import { sendNotification } from "./notifications";
import { roleLogins } from "./owner-logins";
import { bookings, inboundMessages, shops, trips } from "./schema";
import { liveTrip, notRehearsal } from "./trips-live";

export type MoveAskAlertOutcome =
  | { status: "not_soon" | "demo" | "no_origin" | "not_found" | "failed" }
  | { status: "sent"; sent: number; failed: number };

/**
 * **An "Ask to move" close to its boat emails owners and managers** (issue
 * #2667, decided by Aaron 2026-10-17). Called by the booking page's action
 * once `recordMoveAsk` filed the ask — never for an ask that already stood —
 * and only when the seat's departure leaves within a day
 * (`moveAskAlertDue`); farther out the Inbox row is enough.
 *
 * A rehearsal's ask reads as not found, so a drill emails nobody.
 *
 * One email to each active owner or manager login, keyed to the ask's own
 * filing (`move_ask_soon`'s idempotency key), so a resubmit sends nothing new
 * and an ask filed anew after it was answered is new news. A demo shop never
 * sends. The mail names the departure and links the Inbox; who asked and what
 * they wrote stay behind the sign-in, the desk ping's rule.
 *
 * Never throws: the ask is already in the Inbox, and a mail problem must not
 * turn the diver's tap into an error.
 */
export async function alertStaffToMoveAsk(
  db: AppDb,
  input: {
    shopId: string;
    messageId: string;
    now: Date;
    origin?: string | null;
    provider?: NotificationProvider;
  },
): Promise<MoveAskAlertOutcome> {
  try {
    const [ask] = await db
      .select({
        askedAt: inboundMessages.receivedAt,
        tripTitle: trips.title,
        startsAt: trips.startsAt,
        shopName: shops.name,
        shopSlug: shops.slug,
        timezone: shops.timezone,
        defaultLocale: shops.defaultLocale,
        isDemo: shops.isDemo,
      })
      .from(inboundMessages)
      .innerJoin(
        bookings,
        and(eq(bookings.id, inboundMessages.bookingId), eq(bookings.shopId, input.shopId)),
      )
      .innerJoin(trips, and(eq(trips.id, bookings.tripId), eq(trips.shopId, input.shopId)))
      .innerJoin(shops, eq(shops.id, input.shopId))
      .where(
        and(
          eq(inboundMessages.id, input.messageId),
          eq(inboundMessages.shopId, input.shopId),
          eq(inboundMessages.channel, "page"),
          isNull(inboundMessages.answeredAt),
          isNull(inboundMessages.deletedAt),
          liveTrip(),
          // A practice departure's ask is the drill's, never anyone's inbox.
          notRehearsal(),
        ),
      )
      .limit(1);
    if (!ask) return { status: "not_found" };
    if (!moveAskAlertDue(ask.startsAt, input.now)) return { status: "not_soon" };
    // A demo's staff addresses are anybody's.
    if (ask.isDemo) return { status: "demo" };
    const origin = input.origin === undefined ? publicAppUrl() : input.origin;
    if (!origin) return { status: "no_origin" };

    const recipients = await roleLogins(db, input.shopId, ["owner", "manager"]);

    const outcome = { sent: 0, failed: 0 };
    for (const person of recipients) {
      const delivery = await sendNotification(
        db,
        {
          kind: "move_ask_soon",
          shopId: input.shopId,
          personId: person.personId,
          messageId: input.messageId,
          to: person.email,
          // Staff mail in the staffer's own recorded language, else the shop's.
          locale: recipientLocale(person.locale, ask.defaultLocale),
          recipientName: person.fullName,
          shopName: ask.shopName,
          tripTitle: ask.tripTitle,
          startsAt: ask.startsAt,
          timezone: ask.timezone,
          inboxUrl: `${origin}${shopPath(ask.shopSlug, "inbox")}`,
          askedAt: ask.askedAt,
        },
        input.provider,
      );
      if (delivery.status === "sent") outcome.sent += 1;
      else outcome.failed += 1;
    }
    // Ids and counts only — never an address, a name, or a word of the ask.
    log("move_ask.staff_alerted", "info", { shopId: input.shopId, ...outcome });
    return { status: "sent", ...outcome };
  } catch (error) {
    log("move_ask.alert_failed", "error", {
      shopId: input.shopId,
      error: error instanceof Error ? error.name : "unknown",
    });
    return { status: "failed" };
  }
}
