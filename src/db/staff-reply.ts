import { and, eq, isNull } from "drizzle-orm";
import { diverTranslator } from "@/i18n/messages";
import { nowDate } from "@/lib/clock";
import { type InboundChannel, REPLY_BODY_MAX_LENGTH, whatsAppReplyWindowOpen } from "@/lib/inbox";
import { log } from "@/lib/log";
import type { NotificationProvider } from "@/lib/notifications";
import { recipientLocale, threadableMessageId } from "@/lib/notifications/kinds";
import type { AppDb } from "./client";
import { getInboundMessage, lastInboundAt, recordStaffReply } from "./inbound-messages";
import { sendNotification } from "./notifications";
import { people, shops } from "./schema";
import { getShopWhatsAppAccount, whatsAppTextSenderForAccount } from "./whatsapp-accounts";

/**
 * **Answering a diver** — the one consequence path behind the reply composer
 * (ADR 20260907-two-way-inbox, decision 6).
 *
 * Everything a reply implies happens here, in one place, so no surface has to
 * remember the order: the message being answered decides the channel, the
 * diver's own recorded locale decides the language, Meta's 24-hour window is
 * checked *before* a WhatsApp send rather than read off its error afterwards,
 * and the outcome is recorded on `staff_replies` whether it went or not — a
 * failure the record can show beats a sentence nobody sent and nobody knows
 * about.
 *
 * Codes, never sentences (ADR 20260731-domain-layer-copy-leaks). The one
 * exception is the *diver's* subject line, which is composed here from the
 * diver bundle because it is part of the message rather than part of the
 * surface.
 */

export type SendStaffReplyInput = {
  shopId: string;
  personId: string;
  /** The message being answered. A reply always answers something. */
  messageId: string;
  /** The staffer's own words, as typed. */
  body: string;
  /**
   * Who is answering. **Null means DiveDay is**, on the shop's behalf — the
   * confirmation and outcome messages a reply keyword produces (ADR
   * 20260909-reply-keywords). Required rather than optional so a caller has to
   * say which of the two this is.
   */
  sentByPersonId: string | null;
  /**
   * Whether sending this also answers the message. Defaults true; the move
   * handoff passes false, because that message is still waiting on a person.
   */
  marksAnswered?: boolean;
  now?: Date;
  /** Tests inject a fake; production resolves SES from the environment. */
  provider?: NotificationProvider;
};

/**
 * Why a reply did not go. Every one is a sentence the surface writes, and
 * every one leaves the message unanswered — which is the truth.
 */
export type SendStaffReplyRefusal =
  | "empty_body"
  | "body_too_long"
  | "message_not_found"
  | "channel_unsupported"
  | "no_reply_address"
  // Distinct from `no_reply_address`, whose sentence ("There is no address to
  // answer on.") would be false here: there is an address, and this reply
  // cannot be built into something sendable. Nothing left, and a retry changes
  // nothing, so the surface has to say that rather than offer the same button.
  | "cannot_be_sent"
  | "whatsapp_window_closed"
  | "whatsapp_not_connected";

export type SendStaffReplyResult =
  | { status: "sent"; channel: InboundChannel; replyId: string }
  | { status: "refused"; reason: SendStaffReplyRefusal }
  /**
   * The reply is recorded and the diver did not get it. `not_configured` is
   * kept apart from a refused provider call because they ask different things
   * of the reader: one is a channel this deployment never switched on, the
   * other is a send that failed today and may work on the next try.
   */
  | {
      status: "failed";
      channel: InboundChannel;
      replyId: string;
      reason: "not_configured" | "send_failed";
    };

/**
 * The subject a diver sees on an emailed reply: their own thread's, marked as
 * a reply the way every mail client marks one, or the shop's name when their
 * message carried no subject at all (a WhatsApp forwarded by a client, a mail
 * sent with an empty one).
 *
 * Composed in the *diver's* language, from the diver bundle — a subject line
 * is the one string in this module a person outside the shop reads.
 */
function replySubject(
  locale: string,
  shopName: string,
  subject: string | null | undefined,
): string {
  const t = diverTranslator(locale);
  const trimmed = subject?.trim();
  if (!trimmed) return t("notifications.staffReply.subject", { shopName });
  // A thread already marked as a reply keeps the one marker it has: mail
  // clients strip theirs before replying for exactly this reason, and
  // "Re: Re: Re: You're booked" is what happens when nobody does.
  return /^re\s*:/i.test(trimmed)
    ? trimmed
    : t("notifications.staffReply.reSubject", { subject: trimmed });
}

/**
 * Send one reply from the shop, and record what happened to it.
 *
 * The caller has already decided *who may* (`replyToDiverAction`'s live staff
 * check, or — for an automatic reply — the evidence rules in
 * `src/db/reply-keywords.ts`); this decides whether the message can be
 * answered at all, and on what.
 */
export async function sendStaffReply(
  db: AppDb,
  input: SendStaffReplyInput,
): Promise<SendStaffReplyResult> {
  const body = input.body.replace(/\r\n/g, "\n").trim();
  if (body.length === 0) return { status: "refused", reason: "empty_body" };
  if (body.length > REPLY_BODY_MAX_LENGTH) return { status: "refused", reason: "body_too_long" };

  // Scoped to the shop the surface resolved, and to the person whose record
  // the composer sits on: a message id from another record — or another
  // tenant — is "no such message", never someone else's conversation.
  const message = await getInboundMessage(db, input.shopId, input.messageId);
  if (!message || message.personId !== input.personId) {
    return { status: "refused", reason: "message_not_found" };
  }
  if (message.channel === "sms") return { status: "refused", reason: "channel_unsupported" };

  const [shop] = await db
    .select({ name: shops.name, defaultLocale: shops.defaultLocale })
    .from(shops)
    .where(eq(shops.id, input.shopId))
    .limit(1);
  const [person] = await db
    .select({ locale: people.locale })
    .from(people)
    .where(
      and(eq(people.id, input.personId), eq(people.shopId, input.shopId), isNull(people.deletedAt)),
    )
    .limit(1);
  if (!shop || !person) return { status: "refused", reason: "message_not_found" };

  const locale = recipientLocale(person.locale, shop.defaultLocale);
  const now = input.now ?? nowDate();
  // Minted before the send: the notification's idempotency key is
  // `staff-reply/<replyId>`, so a retry drained days later has to name the row
  // this reply already is rather than a second one.
  const replyId = crypto.randomUUID();
  const common = {
    shopId: input.shopId,
    personId: input.personId,
    inboundMessageId: message.id,
    channel: message.channel,
    toAddress: message.fromAddress,
    body,
    locale,
    sentByPersonId: input.sentByPersonId,
    ...(input.marksAnswered === false ? { marksAnswered: false } : {}),
    sentAt: now,
    id: replyId,
  };

  if (message.channel === "whatsapp") {
    // The window is a fact about the diver, not about this message: it is
    // whenever they last wrote on WhatsApp, which may be a later message than
    // the one being answered.
    const lastAt = await lastInboundAt(db, input.shopId, input.personId, "whatsapp");
    if (!whatsAppReplyWindowOpen(lastAt, now)) {
      return { status: "refused", reason: "whatsapp_window_closed" };
    }
    const account = await getShopWhatsAppAccount(db, input.shopId);
    const sender = account ? whatsAppTextSenderForAccount(account) : null;
    if (!sender) return { status: "refused", reason: "whatsapp_not_connected" };
    const delivery = await sender.sendText({ to: message.fromAddress, body });
    await recordStaffReply(db, {
      ...common,
      delivery:
        delivery.status === "sent"
          ? { status: "sent", providerMessageId: delivery.providerMessageId }
          : delivery.status === "not_configured"
            ? { status: "not_configured" }
            : { status: "failed", errorCode: delivery.errorCode, detail: delivery.detail },
    });
    if (delivery.status === "sent") {
      return { status: "sent", channel: "whatsapp", replyId };
    }
    log("inbox.reply_send_failed", "warn", {
      shopId: input.shopId,
      replyId,
      channel: "whatsapp",
      status: delivery.status,
      errorCode: delivery.status === "failed" ? delivery.errorCode : undefined,
    });
    return {
      status: "failed",
      channel: "whatsapp",
      replyId,
      reason: delivery.status === "not_configured" ? "not_configured" : "send_failed",
    };
  }

  // Email. The address is the one the mail actually arrived from, which for an
  // attributed message is the diver's own — never a second address guessed
  // off the record.
  if (!message.fromAddress.includes("@")) {
    return { status: "refused", reason: "no_reply_address" };
  }
  const inReplyTo = threadableMessageId(message.emailMessageId);
  const delivery = await sendNotification(
    db,
    {
      kind: "staff_reply",
      replyId,
      shopId: input.shopId,
      to: message.fromAddress,
      locale,
      shopName: shop.name,
      subject: replySubject(locale, shop.name, message.subject),
      body,
      // What files the answer into the diver's own thread rather than beside
      // it. Absent on a mail that carried no `Message-ID`, and on one whose
      // `Message-ID` the schema will not take: `threadableMessageId` **is** that
      // rule rather than a restatement of it, so a header this send would be
      // refused for is dropped here and the answer still goes. An
      // unauthenticated sender chose that string; it may not cost a shop its
      // reply (security review of #1509).
      ...(inReplyTo ? { inReplyTo } : {}),
    },
    input.provider,
  );
  // Before the record, deliberately. `sendNotification` refuses a notification
  // its own schema will not take without ever calling a provider, so writing a
  // `staff_replies` row for it would file an attempt that never happened.
  if (delivery.status === "failed" && delivery.errorCode === "invalid_notification") {
    return { status: "refused", reason: "cannot_be_sent" };
  }
  await recordStaffReply(db, {
    ...common,
    delivery:
      delivery.status === "sent"
        ? { status: "sent", providerMessageId: delivery.providerMessageId }
        : delivery.status === "not_configured"
          ? { status: "not_configured" }
          : { status: "failed", errorCode: delivery.errorCode, detail: delivery.detail },
  });
  if (delivery.status === "sent") return { status: "sent", channel: "email", replyId };
  log("inbox.reply_send_failed", "warn", {
    shopId: input.shopId,
    replyId,
    channel: "email",
    status: delivery.status,
    errorCode: delivery.status === "failed" ? delivery.errorCode : undefined,
  });
  return {
    status: "failed",
    channel: "email",
    replyId,
    reason: delivery.status === "not_configured" ? "not_configured" : "send_failed",
  };
}
