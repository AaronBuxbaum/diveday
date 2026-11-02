import { and, eq, gte, isNull, sql } from "drizzle-orm";
import { diverTranslator } from "@/i18n/messages";
import { nowDate } from "@/lib/clock";
import {
  type InboundChannel,
  REPLY_BODY_MAX_LENGTH,
  replyDestination,
  WHATSAPP_REPLY_WINDOW_MS,
  type WhatsAppReopenMessage,
  whatsAppReopenSentAt,
  whatsAppReplyWindowOpen,
} from "@/lib/inbox";
import { log } from "@/lib/log";
import type { NotificationProvider } from "@/lib/notifications";
import { recipientLocale, threadableMessageId } from "@/lib/notifications/kinds";
import type { AppDb } from "./client";
import { getInboundMessage, lastInboundAt, recordStaffReply } from "./inbound-messages";
import { sendNotification } from "./notifications";
import { people, shops, staffReplies } from "./schema";
import {
  getShopWhatsAppAccount,
  type WhatsAppSenderOptions,
  whatsAppProviderForAccount,
  whatsAppTextSenderForAccount,
} from "./whatsapp-accounts";

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
  /** Tests supply a key and a fake fetch; production reads the environment. */
  whatsApp?: WhatsAppSenderOptions;
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
  // SMS cannot be answered yet, and a booking-page ask (H-20261014-ask-to-move) has no
  // address of its own: the shop calls or writes from the record.
  if (message.channel === "sms" || message.channel === "page") {
    return { status: "refused", reason: "channel_unsupported" };
  }

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
    const sender = account ? whatsAppTextSenderForAccount(account, input.whatsApp) : null;
    if (!sender) return { status: "refused", reason: "whatsapp_not_connected" };
    // Stored digits-only; the sender dials only an E.164 number, so the `+`
    // goes back first or every reply fails as `invalid_recipient`.
    const delivery = await sender.sendText({
      to: replyDestination("whatsapp", message.fromAddress),
      body,
    });
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

/**
 * How long the one Meta call behind an ask may take. It runs under the
 * diver's lock, which holds a pooled connection, so it is bounded the way the
 * signup's Graph calls are (`GRAPH_REQUEST_TIMEOUT_MS`).
 */
const REOPEN_SEND_TIMEOUT_MS = 10_000;

/** The diver-bundle key each approved ask is written under. */
const REOPEN_MESSAGE_KEY = {
  answer_ready: "notifications.whatsappReopen.answerReady",
  question: "notifications.whatsappReopen.question",
  follow_up: "notifications.whatsappReopen.followUp",
} as const satisfies Record<WhatsAppReopenMessage, string>;

export type SendWhatsAppReopenInput = {
  shopId: string;
  personId: string;
  /** The WhatsApp message the diver is waiting on an answer to. */
  messageId: string;
  message: WhatsAppReopenMessage;
  sentByPersonId: string;
  now?: Date;
  /** Tests supply a key and a fake fetch; production reads the environment. */
  whatsApp?: WhatsAppSenderOptions;
};

/**
 * Why an ask did not go. `whatsapp_window_open` is the composer's business,
 * not this one's: a diver who has written in the last day gets a typed answer.
 */
export type SendWhatsAppReopenRefusal =
  | "message_not_found"
  | "whatsapp_window_open"
  | "already_asked"
  | "whatsapp_not_connected";

export type SendWhatsAppReopenResult =
  | { status: "sent"; replyId: string }
  | { status: "refused"; reason: SendWhatsAppReopenRefusal }
  | { status: "failed"; replyId: string };

/**
 * **Ask a diver to write back on WhatsApp**, once Meta's 24-hour window has
 * closed and a typed answer can no longer go.
 *
 * The words are one of {@link REOPEN_MESSAGE_KEY}'s fixed sentences in the
 * diver's language, carried by the shop's approved courtesy template, the same
 * one trip reminders use. When the diver answers, their message opens a fresh
 * window and the composer is back.
 *
 * Recorded like any reply, so the thread shows what was sent, but it **does
 * not answer** the diver's message: they are still waiting on the real
 * answer. One ask per silence ({@link whatsAppReopenSentAt}).
 */
export async function sendWhatsAppReopen(
  db: AppDb,
  input: SendWhatsAppReopenInput,
): Promise<SendWhatsAppReopenResult> {
  const message = await getInboundMessage(db, input.shopId, input.messageId);
  if (!message || message.personId !== input.personId || message.channel !== "whatsapp") {
    return { status: "refused", reason: "message_not_found" };
  }
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

  const now = input.now ?? nowDate();
  // One ask per silence holds under a double tap or two staffers at once: the
  // check, the send and the record happen under one lock on this diver. The
  // send is bounded (one attempt, {@link REOPEN_SEND_TIMEOUT_MS}) because the
  // lock holds a pooled connection; a failed ask does not count, so the
  // staffer simply presses again.
  const outcome = await db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext('whatsapp_reopen'), hashtext(${`${input.shopId}:${input.personId}`}))`,
    );
    const lastAt = await lastInboundAt(tx, input.shopId, input.personId, "whatsapp");
    if (whatsAppReplyWindowOpen(lastAt, now)) {
      return { status: "refused", reason: "whatsapp_window_open" } as const;
    }
    if (lastAt) {
      const sentSince = await tx
        .select({ sentAt: staffReplies.sentAt })
        .from(staffReplies)
        .where(
          and(
            eq(staffReplies.shopId, input.shopId),
            eq(staffReplies.personId, input.personId),
            eq(staffReplies.channel, "whatsapp"),
            eq(staffReplies.status, "sent"),
            isNull(staffReplies.deletedAt),
            gte(staffReplies.sentAt, new Date(lastAt.getTime() + WHATSAPP_REPLY_WINDOW_MS)),
          ),
        );
      if (
        whatsAppReopenSentAt(
          lastAt,
          sentSince.map((row) => row.sentAt),
        )
      ) {
        return { status: "refused", reason: "already_asked" } as const;
      }
    }

    const account = await getShopWhatsAppAccount(tx, input.shopId);
    const baseFetch = input.whatsApp?.fetchImpl ?? fetch;
    const provider = account
      ? whatsAppProviderForAccount(account, {
          ...input.whatsApp,
          fetchImpl: (url, init) =>
            baseFetch(url, { ...init, signal: AbortSignal.timeout(REOPEN_SEND_TIMEOUT_MS) }),
          providerOptions: { ...input.whatsApp?.providerOptions, maxAttempts: 1 },
        })
      : null;
    if (!provider) return { status: "refused", reason: "whatsapp_not_connected" } as const;

    const locale = recipientLocale(person.locale, shop.defaultLocale);
    const body = diverTranslator(locale)(REOPEN_MESSAGE_KEY[input.message]);
    const replyId = crypto.randomUUID();
    const delivery = await provider.send({
      to: replyDestination("whatsapp", message.fromAddress),
      body,
      shopName: shop.name,
    });
    await recordStaffReply(tx, {
      id: replyId,
      shopId: input.shopId,
      personId: input.personId,
      inboundMessageId: message.id,
      channel: "whatsapp",
      toAddress: message.fromAddress,
      body,
      locale,
      sentByPersonId: input.sentByPersonId,
      marksAnswered: false,
      sentAt: now,
      delivery:
        delivery.status === "sent"
          ? { status: "sent", providerMessageId: delivery.providerMessageId }
          : delivery.status === "not_configured"
            ? { status: "not_configured" }
            : { status: "failed", errorCode: delivery.errorCode, detail: delivery.detail },
    });
    return { status: "attempted", replyId, delivery } as const;
  });
  if (outcome.status === "refused") return outcome;
  const { replyId, delivery } = outcome;
  if (delivery.status === "sent") return { status: "sent", replyId };
  log("inbox.reopen_send_failed", "warn", {
    shopId: input.shopId,
    replyId,
    status: delivery.status,
    errorCode: delivery.status === "failed" ? delivery.errorCode : undefined,
  });
  return { status: "failed", replyId };
}
