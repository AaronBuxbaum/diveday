import { after } from "next/server";
import { getDb } from "@/db/client";
import { pingDeskAfterHoursSafely } from "@/db/desk-pings";
import { recordInboundMessage, shopIdForInboundEmailToken } from "@/db/inbound-messages";
import { triageInboundMessagesSafely } from "@/db/inbox-assists";
import { handleInboundReplyKeyword } from "@/db/reply-keywords";
import { nowDate } from "@/lib/clock";
import { parseInboundEmail } from "@/lib/inbound-email";
import { normalizeEmailAddress, parseInboundReplyToken, sesMessageIdFromHeader } from "@/lib/inbox";
import { log } from "@/lib/log";
import { inboundEmailDomain } from "@/lib/notifications/inbound-address";
import { inboundMailStoreFromEnvironment } from "@/lib/notifications/inbound-mail-store";
import { parseSesInboundNotification } from "@/lib/notifications/ses-inbound";
import { gateSnsWebhook } from "@/lib/notifications/sns-webhook";

/**
 * Mail a diver sent back (ADR 20260907-two-way-inbox). SES's receipt rule
 * stores the raw message in the inbound bucket and publishes a `Received`
 * notification to its own SNS topic; SNS delivers that here, inside the same
 * signed envelope the delivery webhook verifies (`src/lib/notifications/sns.ts`).
 *
 * The order of refusals is the order of trust: the envelope's signature and
 * topic first, then the bucket the notification names against the one the
 * stack provisioned, then the reply-to token against a shop, and only then
 * a request to S3 for the bytes. A message addressed to a token no shop
 * holds is dropped, not filed — the row has a `shop_id`, and there is no
 * honest value for it.
 *
 * Answers 200 for anything verified but not acted on, for the reason the SES
 * route gives: SNS retries a non-2xx. The one deliberate non-2xx after
 * verification is a failed S3 read, which is worth SNS's handful of retries.
 */
export async function POST(request: Request) {
  const gate = await gateSnsWebhook(
    request,
    process.env.EMAIL_INBOUND_SNS_TOPIC_ARN,
    "email_inbound",
  );
  if (gate.kind === "response") return gate.response;
  const { message } = gate;

  const now = nowDate();
  const notification = parseSesInboundNotification(message.Message, now);
  if (notification.kind === "ignored") {
    log("email_inbound.ignored", "info", { reason: notification.reason });
    return new Response(null, { status: 200 });
  }

  const store = inboundMailStoreFromEnvironment();
  if (!store) return new Response(null, { status: 503 });
  if (notification.bucketName !== store.bucketName) {
    // Signed by SNS, but the bucket is still data from the message. Never
    // read from one the stack did not provision.
    log("email_inbound.unexpected_bucket", "warn", {
      providerMessageId: notification.providerMessageId,
    });
    return new Response(null, { status: 200 });
  }

  const domain = inboundEmailDomain();
  if (!domain) return new Response(null, { status: 200 });
  const tokens = [
    ...new Set(
      notification.recipients
        .map((recipient) => parseInboundReplyToken(recipient, domain))
        .filter((token): token is string => token !== null),
    ),
  ];
  if (tokens.length === 0) {
    log("email_inbound.no_reply_token", "info", {
      providerMessageId: notification.providerMessageId,
      recipients: notification.recipients.length,
    });
    return new Response(null, { status: 200 });
  }

  const db = await getDb();
  let shopId: string | null = null;
  for (const token of tokens) {
    shopId = await shopIdForInboundEmailToken(db, token);
    if (shopId) break;
  }
  if (!shopId) {
    log("email_inbound.unknown_token", "warn", {
      providerMessageId: notification.providerMessageId,
    });
    return new Response(null, { status: 200 });
  }

  const raw = await store.read(notification.objectKey);
  if (raw.status === "failed") return new Response(null, { status: 500 });
  if (raw.status === "too_large") {
    log("email_inbound.ignored", "info", { reason: "too_large", shopId });
    return new Response(null, { status: 200 });
  }

  const parsed = parseInboundEmail(raw.message);
  // **Whose message this is, and whether anyone vouched for that.** A `From:`
  // header is written by whoever sent the mail, and the reply-to address is on
  // every email the shop has ever sent — so anyone who has had one can address
  // this endpoint. SES authenticates the header only through DMARC; SPF
  // authenticates the envelope. A message with neither is filed from the
  // address it actually arrived from and matched to nobody, because a sentence
  // on a named diver's record is a sentence a staffer will act on.
  const headerFrom = normalizeEmailAddress(parsed.from);
  const envelopeFrom = normalizeEmailAddress(notification.envelopeFrom);
  const senderAuthenticated =
    notification.fromAuthenticated ||
    (notification.envelopeAuthenticated && headerFrom !== null && headerFrom === envelopeFrom);
  const from = senderAuthenticated ? (headerFrom ?? envelopeFrom) : (envelopeFrom ?? headerFrom);
  if (!from) {
    log("email_inbound.ignored", "info", { reason: "no_sender", shopId });
    return new Response(null, { status: 200 });
  }
  if (parsed.text.length === 0 && parsed.attachmentCount === 0) {
    log("email_inbound.ignored", "info", { reason: "empty", shopId });
    return new Response(null, { status: 200 });
  }

  const result = await recordInboundMessage(db, {
    shopId,
    channel: "email",
    fromAddress: from,
    subject: parsed.subject,
    body: parsed.text,
    mediaCount: parsed.attachmentCount,
    receivedAt: notification.receivedAt,
    providerMessageId: notification.providerMessageId,
    emailMessageId: parsed.messageId,
    inReplyToProviderMessageId: sesMessageIdFromHeader(parsed.inReplyTo),
    senderAuthenticated,
    spamFlagged: notification.spamFlagged,
  });
  // Only a message that was actually filed; a redelivery is `duplicate` and
  // never reaches this. SNS retries every non-2xx, so a keyword read off a
  // replay would be a second cancellation of the same seat.
  if (result.status === "recorded") {
    const outcome = await handleInboundReplyKeyword(db, {
      shopId,
      inboundMessageId: result.id,
    });
    if (outcome !== "not_a_keyword") {
      log("email_inbound.reply_keyword", "info", { shopId, outcome });
    }
    // The desk's after-hours ping (src/db/desk-pings.ts): only for a message
    // actually filed from a sender whose domain checks passed (a spoofed burst
    // to the reply-to address must not page the owner) and that SES did not
    // flag as spam, and never able to fail this webhook. After the response
    // (#2311): a slow mail provider must not hold SNS's request open and
    // earn a retry of a message that is already filed.
    if (senderAuthenticated && !notification.spamFlagged) {
      const receivedAt = notification.receivedAt;
      after(() => pingDeskAfterHoursSafely(db, { shopId, receivedAt }));
      // Claude's intent, urgency and translation for the inbox (the
      // `inbox-sort` and `translate` assists), on the same two conditions: a
      // spoofed burst must not spend the shop's Claude budget. A keyword reply
      // and a dark shop are skipped inside; nothing here can fail the webhook.
      const messageId = result.id;
      after(() => triageInboundMessagesSafely(db, shopId, [messageId]));
    }
  }
  // Ids and outcomes only — never the sender, the subject or the words.
  log("email_inbound.recorded", "info", {
    shopId,
    providerMessageId: notification.providerMessageId,
    status: result.status,
    matched: result.status === "recorded" ? result.personId !== null : undefined,
    senderAuthenticated,
    attachments: parsed.attachmentCount,
  });
  return new Response(null, { status: 200 });
}
