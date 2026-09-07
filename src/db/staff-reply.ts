import { and, eq, isNull } from "drizzle-orm";
import { diverTranslator } from "@/i18n/messages";
import { nowDate } from "@/lib/clock";
import { type InboundChannel, REPLY_BODY_MAX_LENGTH, whatsAppReplyWindowOpen } from "@/lib/inbox";
import { notify, recipientLocale } from "@/lib/notifications";
import type { CourtesyDelivery } from "@/lib/notifications/courtesy";
import { threadableMessageId } from "@/lib/notifications/kinds";
import type { NotificationProvider } from "@/lib/notifications/provider";
import { smsProviderFromEnvironment, smsRecipient } from "@/lib/notifications/sms";
import type { WhatsAppTextSender } from "@/lib/notifications/whatsapp";
import type { AppDb } from "./client";
import { getInboundMessage, lastInboundAt, recordStaffReply } from "./inbound-messages";
import { notificationProviderForDb, shopSenderFor } from "./notifications";
import { people, shops } from "./schema";
import { getShopWhatsAppAccount, whatsAppTextSenderForAccount } from "./whatsapp-accounts";

/**
 * **Answering a diver, in the channel they wrote in** (ADR
 * 20260907-two-way-inbox, decision 6). One function, because the record is the
 * one place a staffer writes back from and the three channels must not each
 * grow their own rule about who may be written to and in what language.
 *
 * What it does *not* do is pick a channel. `sendCourtesyMessage` prefers a
 * shop's WhatsApp over SMS for an outbound courtesy, which is right for a
 * message DiveDay originated and wrong for a reply: a diver who wrote from a
 * phone gets the answer on that phone, and one who wrote from a mailbox gets it
 * in that thread. The channel is the diver's, already recorded on the message.
 *
 * Nothing here writes a sentence. The staffer's words go out as typed, the
 * subject is the thread's own, and the only string this module reaches for is
 * the subject line for a mail that arrived without one — from the diver bundle,
 * in the diver's language.
 */

/** Why a reply did not go out. Codes; the surface picks the words. */
export type StaffReplyRefusal =
  /** The message is gone, belongs to another shop, or was never matched to a diver. */
  | "message_unavailable"
  | "empty_body"
  | "body_too_long"
  /** The address on the message is not one this channel can send to. */
  | "no_address"
  /** Meta's 24-hour customer-service window has closed (`whatsAppReplyWindowOpen`). */
  | "window_closed"
  /** The channel has no credentials on this deployment, or the shop connected none. */
  | "not_configured"
  | "send_failed";

export type SendStaffReplyResult =
  | { status: "sent"; replyId: string }
  | { status: "refused"; reason: StaffReplyRefusal };

export type SendStaffReplyInput = {
  shopId: string;
  /** The message being answered. A reply always answers one; there is no cold compose. */
  messageId: string;
  /**
   * The record the staffer is writing from. The message names the recipient on
   * its own, so this is a **check**, not a source: a form field naming another
   * of this shop's messages would otherwise answer a conversation the staffer
   * is not looking at, and file the reply on a record they did not open.
   */
  expectedPersonId?: string;
  /** What the staffer typed, verbatim. */
  body: string;
  /** The staff member writing, for the record's "who answered" line. */
  sentByPersonId: string;
  now?: Date;
};

/** Injection seams, so a test drives all three channels with no AWS or Meta credentials. */
export type SendStaffReplyOptions = {
  emailProvider?: NotificationProvider;
  whatsAppSender?: WhatsAppTextSender | null;
  smsSender?: { send(message: { to: string; body: string }): Promise<CourtesyDelivery> };
};

/**
 * The refusal a non-`sent` provider outcome reads as. `not_configured` is the
 * honest one for a shop that never connected the channel; everything else is a
 * failure the staffer can see and retry, which is why a reply is sent inline
 * rather than through `sendNotification`'s retry queue: the person who wrote it
 * is sitting in front of the screen, and a silent redelivery an hour later
 * would answer a conversation that has since moved on.
 */
function refusalFor(status: "not_configured" | "failed"): StaffReplyRefusal {
  return status === "not_configured" ? "not_configured" : "send_failed";
}

export async function sendStaffReply(
  db: AppDb,
  input: SendStaffReplyInput,
  options: SendStaffReplyOptions = {},
): Promise<SendStaffReplyResult> {
  const body = input.body.replace(/\r\n/g, "\n").trim();
  if (!body) return { status: "refused", reason: "empty_body" };
  if (body.length > REPLY_BODY_MAX_LENGTH) return { status: "refused", reason: "body_too_long" };

  const message = await getInboundMessage(db, input.shopId, input.messageId);
  // A message with no matched diver is a stranger's: the address was never
  // vouched for against a record, so there is nobody here to answer *as* a
  // known person, and `staff_replies.person_id` is not nullable by design.
  if (!message?.personId) return { status: "refused", reason: "message_unavailable" };
  if (input.expectedPersonId && input.expectedPersonId !== message.personId) {
    return { status: "refused", reason: "message_unavailable" };
  }

  // Live, in this shop, and not erased. A deleted record is one the shop has
  // taken off its lists, and an erased one has a redacted address where the
  // diver's used to be — writing to either from a tab older than the change is
  // the failure this closes.
  const [person] = await db
    .select({ locale: people.locale })
    .from(people)
    .where(
      and(
        eq(people.id, message.personId),
        eq(people.shopId, input.shopId),
        isNull(people.deletedAt),
        isNull(people.anonymizedAt),
      ),
    )
    .limit(1);
  if (!person) return { status: "refused", reason: "message_unavailable" };
  const [shop] = await db
    .select({ name: shops.name, defaultLocale: shops.defaultLocale })
    .from(shops)
    .where(eq(shops.id, input.shopId))
    .limit(1);
  if (!shop) return { status: "refused", reason: "message_unavailable" };
  const locale = recipientLocale(person.locale, shop.defaultLocale);
  const now = input.now ?? nowDate();

  const channel: InboundChannel = message.channel;
  const record = (
    toAddress: string,
    delivery: Parameters<typeof recordStaffReply>[1]["delivery"],
    id?: string,
  ) =>
    recordStaffReply(db, {
      id,
      shopId: input.shopId,
      personId: message.personId as string,
      inboundMessageId: message.id,
      channel,
      toAddress,
      body,
      locale,
      sentByPersonId: input.sentByPersonId,
      delivery,
      sentAt: now,
    });

  if (channel === "email") {
    // The row's id before the send, so the notification's idempotency key
    // (`staff-reply/<replyId>`) names a row that exists either way.
    const replyId = crypto.randomUUID();
    // `notify`, not `sendNotification`: a retryable failure must **not** join
    // the retry queue. The staffer who wrote this is looking at the screen, so
    // a redelivery an hour later would answer a conversation that has since
    // moved on — and the `staff_replies` row recorded here would be saying
    // "did not send" about a message that did. The sender profile is attached
    // by hand for the same reason, so the diver's own reply to the reply comes
    // back to this inbox (`shopSenderFor`).
    const sender = await shopSenderFor(db, input.shopId);
    const inReplyTo = threadableMessageId(message.emailMessageId);
    const delivery = await notifySafely(
      {
        kind: "staff_reply",
        replyId,
        shopId: input.shopId,
        to: message.fromAddress,
        locale,
        shopName: shop.name,
        subject:
          message.subject?.trim() ||
          diverTranslator(locale)("notifications.staffReply.subject", { shopName: shop.name }),
        body,
        // Asked, never restated: `threadableMessageId` is the schema's own rule,
        // so a `Message-ID` this send would be refused for is dropped here and
        // the answer still goes. Restating one clause of it by hand is what let
        // a diver silence their own thread with a two-character header.
        ...(inReplyTo ? { inReplyTo } : {}),
        ...(sender ? { sender } : {}),
      },
      options.emailProvider,
    );
    if (delivery.status === "sent") {
      await record(
        message.fromAddress,
        { status: "sent", providerMessageId: delivery.providerMessageId },
        replyId,
      );
      return { status: "sent", replyId };
    }
    await record(
      message.fromAddress,
      delivery.status === "not_configured"
        ? { status: "not_configured" }
        : { status: "failed", errorCode: delivery.errorCode, detail: delivery.detail },
      replyId,
    );
    return { status: "refused", reason: refusalFor(delivery.status) };
  }

  // Both text channels answer the number the diver wrote from, which the row
  // holds as bare digits.
  const to = smsRecipient(`+${message.fromAddress}`);
  if (!to) return { status: "refused", reason: "no_address" };

  if (channel === "whatsapp") {
    // Checked before sending rather than read off Meta's error afterwards: the
    // window is a fact this database already holds, and a refusal the staffer
    // sees *before* typing beats one that arrives as a failed send.
    const openedAt = await lastInboundAt(db, input.shopId, message.personId, "whatsapp");
    if (!whatsAppReplyWindowOpen(openedAt, now)) {
      return { status: "refused", reason: "window_closed" };
    }
    const sender =
      options.whatsAppSender !== undefined
        ? options.whatsAppSender
        : await shopWhatsAppTextSender(db, input.shopId);
    if (!sender) return { status: "refused", reason: "not_configured" };
    const delivery = await sender.sendText({ to, body });
    return await recorded(record, to, delivery);
  }

  const sms = options.smsSender ?? smsProviderFromEnvironment();
  return await recorded(record, to, await sms.send({ to, body }));
}

/**
 * `notify`, with a thrown provider error read as a failed send. A staff action
 * that 500s loses the words the staffer typed; a refusal keeps them on screen.
 */
async function notifySafely(
  notification: Parameters<typeof notify>[0],
  provider?: NotificationProvider,
) {
  try {
    return await notify(notification, notificationProviderForDb(provider));
  } catch (error) {
    return {
      status: "failed" as const,
      errorCode: "provider_error",
      detail: error instanceof Error ? error.message.slice(0, 500) : undefined,
    };
  }
}

/** One shop's free-text WhatsApp sender, or null when it has not connected one. */
async function shopWhatsAppTextSender(
  db: AppDb,
  shopId: string,
): Promise<WhatsAppTextSender | null> {
  const account = await getShopWhatsAppAccount(db, shopId);
  return account ? whatsAppTextSenderForAccount(account) : null;
}

/** Write the outcome down whichever way it went, then say what happened. */
async function recorded(
  record: (
    toAddress: string,
    delivery: Parameters<typeof recordStaffReply>[1]["delivery"],
  ) => Promise<unknown>,
  to: string,
  delivery: CourtesyDelivery,
): Promise<SendStaffReplyResult> {
  if (delivery.status === "sent") {
    const reply = (await record(to, {
      status: "sent",
      providerMessageId: delivery.providerMessageId,
    })) as { id: string } | undefined;
    return { status: "sent", replyId: reply?.id ?? "" };
  }
  await record(
    to,
    delivery.status === "not_configured"
      ? { status: "not_configured" }
      : { status: "failed", errorCode: delivery.errorCode, detail: delivery.detail },
  );
  return { status: "refused", reason: refusalFor(delivery.status) };
}
