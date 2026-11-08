import { and, count, eq, gt, isNull, sql } from "drizzle-orm";
import { parseCharterQuote } from "@/features/charter-quote";
import {
  foldInterestReplyForText,
  INTEREST_REPLY_DAILY_CAP,
  INTEREST_REPLY_MAX,
  interestReplyProblem,
  interestReplyRoute,
  normalizeInterestReply,
} from "@/features/interest-reply";
import { canPersonQuoteCharter } from "../../db/authz";
import type { AppDb } from "../../db/client";
import { notificationProviderForDb, sendNotification } from "../../db/notifications";
import { interestReplies, interests, people, shops } from "../../db/schema/index";
import { stopListedSmsProvider } from "../../db/sms-opt-outs";
import { whatsAppProvidersForShops } from "../../db/whatsapp-accounts";
import { nowDate } from "../../lib/clock";
import { log } from "../../lib/log";
import {
  type CourtesyProvider,
  charterQuoteLine,
  interestReplySubject,
  interestReplyText,
  type NotificationProvider,
  recipientLocale,
  type SmsProvider,
  sendCourtesyMessage,
  smsProviderFromEnvironment,
} from "../../lib/notifications/index";

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
  | "cannot_be_sent"
  /** A quote on a request that did not ask for the whole boat. */
  | "quote_not_a_charter"
  /** A quote that is not a whole, positive amount the shop could charge. */
  | "bad_quote"
  /** A whole-boat price from a staffer who may not set prices (`canQuoteCharter`). */
  | "quote_not_allowed";

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
    /**
     * A private charter's quote for the whole boat, as the staffer typed it in
     * the shop's major unit (loop 5, row 11). Parsed here, in the currency this
     * writer reads, stores and sends it in, never one the caller names. Blank
     * is no quote.
     */
    quote?: string | null;
    now?: Date;
  },
  providers: InterestReplyProviders = {},
): Promise<InterestReplyResult> {
  const problem = interestReplyProblem(input.body);
  if (problem) return { status: "refused", reason: problem };
  const typed = normalizeInterestReply(input.body);

  const [row] = await db
    .select({
      email: interests.email,
      phone: interests.phone,
      closedAt: interests.closedAt,
      charter: interests.charter,
      personLocale: people.locale,
      shopName: shops.name,
      shopLocale: shops.defaultLocale,
      shopCountry: shops.addressCountry,
      shopCurrency: shops.currency,
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
  const quote = parseCharterQuote(input.quote ?? "", row.shopCurrency);
  if (!quote.ok) return { status: "refused", reason: "bad_quote" };
  const quoteCents = quote.cents;
  if (quoteCents !== null && !row.charter)
    return { status: "refused", reason: "quote_not_a_charter" };
  if (quoteCents !== null && !(await canPersonQuoteCharter(db, input.shopId, input.sentByPersonId)))
    return { status: "refused", reason: "quote_not_allowed" };
  const firstRoute = interestReplyRoute({ email: row.email, phone: row.phone }, row.shopCountry);
  if (!firstRoute) return { status: "refused", reason: "no_route" };
  // The message as it goes, quote line included, is what the bound is on
  // (security review, layer 3, M1): checked before anything is claimed or sent.
  const locale = recipientLocale(row.personLocale, row.shopLocale);
  const body =
    quoteCents === null
      ? typed
      : `${charterQuoteLine(locale, quoteCents, row.shopCurrency)}\n\n${typed}`;
  if (body.length > INTEREST_REPLY_MAX) return { status: "refused", reason: "too_long" };

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
  const replyId = crypto.randomUUID();
  // The claim and the reply's row are one write: a crash after it leaves a
  // request closed as replied *with* a reply on record, still `pending` until
  // the provider has answered (issue #3892). Nothing is sent inside it.
  //
  // The address is read **from the claim itself**, not from the read above: an
  // erasure that blanked the request in between does not close it, so the claim
  // still matches, and the earlier read would put the erased contact back on
  // record and send to it (security review of layer 3, S3).
  const noRoute = Symbol("no_route");
  let claimedRoute: NonNullable<typeof firstRoute> | null = null;
  try {
    claimedRoute = await db.transaction(async (tx) => {
      const [claim] = await tx
        .update(interests)
        .set({ closedAt: now, closedAs: "replied" })
        .where(and(scope, isNull(interests.closedAt)))
        .returning({ email: interests.email, phone: interests.phone });
      if (!claim) return null;
      const current = interestReplyRoute(claim, row.shopCountry);
      // Nothing to send to: undo the claim with the rest of the transaction.
      if (!current) throw noRoute;
      await tx.insert(interestReplies).values({
        id: replyId,
        shopId: input.shopId,
        interestId: input.interestId,
        // A text may still go on either channel; the settle below says which.
        channel: current.channel === "email" ? "email" : "sms",
        toAddress: current.to,
        body: current.channel === "email" ? body : foldInterestReplyForText(body),
        locale,
        sentByPersonId: input.sentByPersonId,
        status: "pending",
        sentAt: now,
      });
      return current;
    });
  } catch (error) {
    if (error === noRoute) return { status: "refused", reason: "no_route" };
    throw error;
  }
  if (!claimedRoute) return { status: "refused", reason: "not_open" };
  const route = claimedRoute;
  const sentBody = route.channel === "email" ? body : foldInterestReplyForText(body);
  const release = () =>
    db
      .update(interests)
      .set({ closedAt: null, closedAs: null })
      .where(and(scope, eq(interests.closedAs, "replied"), eq(interests.closedAt, now)));
  const thisReply = and(eq(interestReplies.id, replyId), eq(interestReplies.shopId, input.shopId));

  let channel: "email" | "sms" | "whatsapp";
  let delivery: Delivery;
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
        // Nothing reached a provider, so there is no attempt to record.
        await db.delete(interestReplies).where(thisReply);
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
    // A provider that threw may still have delivered: the attempt stays on
    // record, failed, and the request is given back as before.
    await db
      .update(interestReplies)
      .set({ status: "failed", sendErrorCode: "provider_error" })
      .where(thisReply);
    await release();
    throw error;
  }

  if (delivery.status !== "sent") await release();
  await db
    .update(interestReplies)
    .set({
      channel,
      status: delivery.status,
      // Not written back once an erasure has blanked the address: a WhatsApp
      // message id spells the number (`scrubInterests`).
      providerMessageId:
        delivery.status === "sent"
          ? sql`case when ${interestReplies.toAddress} is null then null else ${delivery.providerMessageId} end`
          : null,
      sendErrorCode: delivery.status === "failed" ? (delivery.errorCode ?? null) : null,
    })
    .where(thisReply);
  if (delivery.status === "sent") {
    // The quote is the shop's word only once the diver has it.
    if (quoteCents !== null) {
      await db
        .update(interests)
        .set({
          charterQuoteCents: quoteCents,
          charterQuoteCurrency: row.shopCurrency,
          charterQuotedAt: now,
          charterQuotedByPersonId: input.sentByPersonId,
        })
        .where(scope);
    }
    return { status: "sent", channel, replyId };
  }
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
