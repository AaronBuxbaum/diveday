import { and, count, eq, gt, isNull } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import {
  foldInterestReplyForText,
  INTEREST_REPLY_DAILY_CAP,
  interestReplyProblem,
  interestReplyRoute,
  normalizeInterestReply,
} from "@/lib/interest-reply";
import { log } from "@/lib/log";
import {
  type CourtesyProvider,
  interestReplySubject,
  interestReplyText,
  type NotificationProvider,
  recipientLocale,
  type SmsProvider,
  sendCourtesyMessage,
  smsProviderFromEnvironment,
} from "@/lib/notifications";
import type { AppDb } from "./client";
import { notificationProviderForDb, sendNotification } from "./notifications";
import { interestReplies, interests, people, shops } from "./schema";
import { stopListedSmsProvider } from "./sms-opt-outs";
import { whatsAppProvidersForShops } from "./whatsapp-accounts";

/** Tests inject fakes; production resolves each provider from the environment. */
export type InterestReplyProviders = {
  emailProvider?: NotificationProvider;
  smsProvider?: SmsProvider;
  whatsAppProviders?: Map<string, CourtesyProvider>;
};

/** Why a reply did not go and nothing was sent. Each leaves the request as it was. */
export type InterestReplyRefusal =
  | "empty"
  | "too_long"
  /** No open date request with this id at this shop: another shop's id reads the same. */
  | "not_found"
  /** Closed already, by another staffer's reply, a booking or a tick. */
  | "not_open"
  /** No address, and no number that reads as a phone: the row keeps its `tel:` link. */
  | "no_route"
  /** The request has had its day's replies (`INTEREST_REPLY_DAILY_CAP`), sent or not. */
  | "capped"
  /** The email this reply would be refuses its own schema; a retry changes nothing. */
  | "cannot_be_sent";

export type InterestReplyResult =
  | { status: "sent"; channel: "email" | "sms" | "whatsapp"; replyId: string }
  | { status: "refused"; reason: InterestReplyRefusal }
  /** Recorded, not delivered, and the request is open again for another try. */
  | {
      status: "failed";
      channel: "email" | "sms" | "whatsapp";
      replyId: string;
      reason: "not_configured" | "send_failed";
    };

const DAY_MS = 24 * 60 * 60 * 1000;

type Delivery =
  | { status: "sent"; providerMessageId: string }
  | { status: "not_configured" }
  | { status: "failed"; errorCode?: string };

/**
 * **Reply to a date request, record it, and close the request as `replied`**
 * (issue #2555).
 *
 * The address is the one on the request, never one the form supplies: a staffer
 * chooses the words, not who receives them. Email when the diver left one (the
 * `staff_reply` email kind, so the body is escaped into paragraphs and the
 * shop's reply-to brings an answer back to the inbox), otherwise a text through
 * `sendCourtesyMessage` (the shop's WhatsApp, else SMS with its STOP line, past
 * the STOP list).
 *
 * The request is **claimed before anything is sent**: closing it as `replied`
 * is a conditional update on an open row, so two staffers pressing Send at once
 * send one reply, and the other is told it is closed. A send that does not go
 * gives the claim back. Every attempt that reached a provider is a row on
 * `interest_replies`, sent or not; nothing is queued to retry later, because a
 * reply that lands days after the staffer was told it failed is a second
 * surprise.
 */
export async function sendInterestReply(
  db: AppDb,
  input: {
    shopId: string;
    interestId: string;
    body: string;
    /** The staffer sending it; the caller has resolved them from the session. */
    sentByPersonId: string;
    now?: Date;
  },
  providers: InterestReplyProviders = {},
): Promise<InterestReplyResult> {
  const problem = interestReplyProblem(input.body);
  if (problem) return { status: "refused", reason: problem };
  const body = normalizeInterestReply(input.body);

  const [row] = await db
    .select({
      email: interests.email,
      phone: interests.phone,
      closedAt: interests.closedAt,
      personLocale: people.locale,
      shopName: shops.name,
      shopLocale: shops.defaultLocale,
      shopCountry: shops.addressCountry,
    })
    .from(interests)
    .innerJoin(shops, eq(shops.id, interests.shopId))
    .leftJoin(
      people,
      and(
        eq(people.id, interests.personId),
        eq(people.shopId, interests.shopId),
        isNull(people.deletedAt),
      ),
    )
    .where(
      and(
        eq(interests.id, input.interestId),
        eq(interests.shopId, input.shopId),
        eq(interests.scope, "date"),
      ),
    )
    .limit(1);
  if (!row) return { status: "refused", reason: "not_found" };
  if (row.closedAt) return { status: "refused", reason: "not_open" };
  const route = interestReplyRoute({ email: row.email, phone: row.phone }, row.shopCountry);
  if (!route) return { status: "refused", reason: "no_route" };

  const now = input.now ?? nowDate();
  // Every attempt counts: a provider that timed out may still have delivered.
  const [attempts] = await db
    .select({ n: count() })
    .from(interestReplies)
    .where(
      and(
        eq(interestReplies.shopId, input.shopId),
        eq(interestReplies.interestId, input.interestId),
        gt(interestReplies.sentAt, new Date(now.getTime() - DAY_MS)),
      ),
    );
  if ((attempts?.n ?? 0) >= INTEREST_REPLY_DAILY_CAP)
    return { status: "refused", reason: "capped" };

  const scope = and(
    eq(interests.id, input.interestId),
    eq(interests.shopId, input.shopId),
    eq(interests.scope, "date"),
  );
  const [claim] = await db
    .update(interests)
    .set({ closedAt: now, closedAs: "replied" })
    .where(and(scope, isNull(interests.closedAt)))
    .returning({ id: interests.id });
  if (!claim) return { status: "refused", reason: "not_open" };
  const release = () =>
    db
      .update(interests)
      .set({ closedAt: null, closedAs: null })
      .where(and(scope, eq(interests.closedAs, "replied"), eq(interests.closedAt, now)));

  const locale = recipientLocale(row.personLocale, row.shopLocale);
  const replyId = crypto.randomUUID();
  let channel: "email" | "sms" | "whatsapp";
  let delivery: Delivery;
  let sentBody = body;
  try {
    if (route.channel === "email") {
      channel = "email";
      const sent = await sendNotification(
        db,
        {
          kind: "staff_reply",
          replyId,
          shopId: input.shopId,
          to: route.to,
          locale,
          shopName: row.shopName,
          subject: interestReplySubject(locale, row.shopName),
          body,
        },
        notificationProviderForDb(providers.emailProvider),
        { retryPolicy: "disabled" },
      );
      if (sent.status === "failed" && sent.errorCode === "invalid_notification") {
        await release();
        return { status: "refused", reason: "cannot_be_sent" };
      }
      delivery =
        sent.status === "sent"
          ? { status: "sent", providerMessageId: sent.providerMessageId }
          : sent.status === "not_configured"
            ? { status: "not_configured" }
            : { status: "failed", errorCode: sent.errorCode };
    } else {
      sentBody = foldInterestReplyForText(body);
      const senders =
        providers.whatsAppProviders ?? (await whatsAppProvidersForShops(db, [input.shopId]));
      const sms = stopListedSmsProvider(db, providers.smsProvider ?? smsProviderFromEnvironment());
      const sent = await sendCourtesyMessage(
        {
          to: route.to,
          body: interestReplyText(locale, row.shopName, sentBody),
          locale,
          shopName: row.shopName,
        },
        { sms, whatsapp: senders.get(input.shopId) ?? null },
      );
      channel = sent.channel;
      delivery =
        sent.delivery.status === "sent"
          ? { status: "sent", providerMessageId: sent.delivery.providerMessageId }
          : sent.delivery.status === "not_configured"
            ? { status: "not_configured" }
            : { status: "failed", errorCode: sent.delivery.errorCode };
    }
  } catch (error) {
    await release();
    throw error;
  }

  if (delivery.status !== "sent") await release();
  await db.insert(interestReplies).values({
    id: replyId,
    shopId: input.shopId,
    interestId: input.interestId,
    channel,
    toAddress: route.to,
    body: sentBody,
    locale,
    sentByPersonId: input.sentByPersonId,
    status: delivery.status,
    providerMessageId: delivery.status === "sent" ? delivery.providerMessageId : null,
    sendErrorCode: delivery.status === "failed" ? (delivery.errorCode ?? null) : null,
    sentAt: now,
  });
  if (delivery.status === "sent") return { status: "sent", channel, replyId };
  // Ids and codes only: the address and the words stay on the row.
  log("requests.reply_send_failed", "warn", {
    shopId: input.shopId,
    replyId,
    channel,
    status: delivery.status,
    errorCode: delivery.status === "failed" ? delivery.errorCode : undefined,
  });
  return {
    status: "failed",
    channel,
    replyId,
    reason: delivery.status === "not_configured" ? "not_configured" : "send_failed",
  };
}
