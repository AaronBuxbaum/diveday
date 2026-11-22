import type { Notification } from "@/lib/notifications/kinds";
import type { HandFill, Perspective } from "./plan";

/**
 * **Functions the sweep calls with arguments written by hand.**
 *
 * Discovery reads a parameter's fields from its type. A type inferred from a
 * schema (`z.infer<typeof notificationSchema>`) has no fields to read, so the
 * three senders below would otherwise sit unswept. Each entry builds one real
 * call as the given caller: the caller's shop, and shop A's ids from the
 * fixture (`perspective.values`), exactly what a filled call carries.
 *
 * Keep this short. A function whose type can be read belongs to discovery; add
 * one here only when its parameter type cannot be read from source.
 */

/** A booking confirmation from the caller's shop about shop A's booking, to shop A's diver. */
function confirmation(perspective: Perspective): Notification {
  const { values } = perspective;
  const now = values.now as Date;
  return {
    kind: "booking_confirmation",
    bookingId: values.bookingId as string,
    shopId: perspective.shop.id,
    to: values.email as string,
    locale: "en-US",
    diverName: "Swept",
    shopName: "Swept",
    tripTitle: "Swept",
    startsAt: now,
    endsAt: now,
    timezone: values.timeZone as string,
  };
}

export const HAND_FILLED: ReadonlyMap<string, HandFill> = new Map<string, HandFill>([
  ["notifications.ts:sendNotification", (perspective) => [confirmation(perspective)]],
  ["notifications.ts:sendNotificationBatch", (perspective) => [[confirmation(perspective)]]],
  ["notifications.ts:sendAndRecordNotification", (perspective) => [confirmation(perspective)]],
]);
