import { after } from "next/server";
import { getDb } from "@/db/client";
import { pingDeskAfterHoursSafely } from "@/db/desk-pings";
import { recordInboundMessage } from "@/db/inbound-messages";
import { triageInboundMessagesSafely } from "@/db/inbox-assists";
import { applyProviderEmailEvent } from "@/db/notifications";
import { handleInboundReplyKeyword } from "@/db/reply-keywords";
import { shopIdForWhatsAppEvent } from "@/db/whatsapp-accounts";
import { nowDate } from "@/lib/clock";
import { log } from "@/lib/log";
import {
  parseWhatsAppDeliveryEvents,
  parseWhatsAppInboundMessages,
  verifyWhatsAppSignature,
  whatsAppChallengeResponse,
} from "@/lib/notifications/whatsapp-events";
import { logWebhookRefusal } from "@/lib/webhook-refusal";

/**
 * Meta's WhatsApp webhook: what happened to the courtesy messages shops sent
 * through DiveDay (docs ADR 20260802-whatsapp-embedded-signup).
 *
 * One endpoint serves every shop. That is only possible because Embedded Signup
 * subscribes each shop's WhatsApp Business Account to DiveDay's own Meta app,
 * so every event is signed with the one app secret this route holds.
 */

/**
 * The subscription handshake. Meta calls this once when the webhook is
 * configured and expects its challenge echoed back as plain text.
 */
export async function GET(request: Request) {
  const challenge = whatsAppChallengeResponse(
    new URL(request.url).searchParams,
    process.env.META_WHATSAPP_WEBHOOK_VERIFY_TOKEN,
  );
  if (!challenge) return new Response(null, { status: 403 });
  return new Response(challenge, {
    status: 200,
    headers: { "Content-Type": "text/plain" },
  });
}

/**
 * Delivery outcomes, and what divers write back (ADR 20260907-two-way-inbox).
 * Answers 200 for anything verified but not acted on: Meta retries a non-2xx,
 * so erroring on an event type we don't handle — or on a message id we never
 * tracked — would buy an endless redelivery loop and nothing else. That is the
 * same posture as the SES route.
 *
 * Both halves resolve the tenant the same way (`shopIdForWhatsAppEvent`, H-20260916-may-dive-chain-share):
 * the phone number id each change names, which one shop holds, and nothing
 * else. The WABA in `entry[].id` only has to agree with that number's row; a
 * chain may share a WABA across its shops, a number each, so the WABA alone
 * is never the answer, even when no number is named. An event that resolves to no
 * shop is dropped rather than filed nowhere: the row has a `shop_id`, and
 * there is no honest value for it.
 */
export async function POST(request: Request) {
  // Read as text and verify *before* parsing: Meta signs the exact bytes, and a
  // re-serialized object never matches its own signature.
  const payload = await request.text();
  const verification = verifyWhatsAppSignature(
    payload,
    request.headers.get("x-hub-signature-256"),
    process.env.META_APP_SECRET,
  );
  if (verification.status !== "verified") {
    logWebhookRefusal("whatsapp", verification.status);
    return new Response(null, { status: verification.status === "not_configured" ? 503 : 400 });
  }

  const now = nowDate();
  const events = parseWhatsAppDeliveryEvents(payload, now);
  const inbound = parseWhatsAppInboundMessages(payload, now);
  if (events.length === 0 && inbound.length === 0) return new Response(null, { status: 200 });

  const db = await getDb();
  // Resolved once per number and WABA pair in the batch: the tenant key the
  // update is scoped to.
  const shopIdByKey = new Map<string, string | null>();
  const shopFor = async (event: { phoneNumberId: string | null; wabaId: string | null }) => {
    const cacheKey = `${event.phoneNumberId ?? ""}|${event.wabaId ?? ""}`;
    if (!shopIdByKey.has(cacheKey)) {
      shopIdByKey.set(
        cacheKey,
        await shopIdForWhatsAppEvent(db, {
          phoneNumberId: event.phoneNumberId,
          wabaId: event.wabaId,
        }),
      );
    }
    return shopIdByKey.get(cacheKey) ?? null;
  };

  for (const message of inbound) {
    const shopId = await shopFor(message);
    if (!shopId) {
      log("whatsapp_webhook.inbound_unknown_tenant", "warn", {
        hasNumber: Boolean(message.phoneNumberId),
        hasWaba: Boolean(message.wabaId),
      });
      continue;
    }
    const result = await recordInboundMessage(db, {
      shopId,
      channel: "whatsapp",
      fromAddress: message.from,
      body: message.body,
      mediaCount: message.mediaCount,
      receivedAt: message.receivedAt,
      providerMessageId: message.providerMessageId,
      // Meta reports the number the message came from, and only its owner can send from it.
      senderAuthenticated: true,
    });
    // Ids and outcomes only — never the sender or the words (PII-in-logs rule).
    log("whatsapp_webhook.inbound_recorded", "info", {
      shopId,
      providerMessageId: message.providerMessageId,
      status: result.status,
      matched: result.status === "recorded" ? result.personId !== null : undefined,
    });
    // Only a message that was actually filed. A redelivery comes back
    // `duplicate` and never reaches this, which is the replay guard: Meta
    // retries on any non-2xx and occasionally delivers twice on a 200, and a
    // keyword acted on twice is a cancellation acted on twice.
    if (result.status === "recorded") {
      const outcome = await handleInboundReplyKeyword(db, {
        shopId,
        inboundMessageId: result.id,
      });
      if (outcome !== "not_a_keyword") {
        log("whatsapp_webhook.reply_keyword", "info", { shopId, outcome });
      }
      // The desk's after-hours ping (src/db/desk-pings.ts): only for a message
      // actually filed, never able to fail this webhook, and after the
      // response (#2311), so a slow mail provider cannot hold Meta's request
      // open and earn a retry.
      const receivedAt = message.receivedAt;
      after(() => pingDeskAfterHoursSafely(db, { shopId, receivedAt }));
      // Claude's intent, urgency and translation for the inbox; a keyword reply
      // and a dark shop are skipped inside, and nothing here can fail the webhook.
      const messageId = result.id;
      after(() => triageInboundMessagesSafely(db, shopId, [messageId]));
    }
  }

  for (const event of events) {
    // An event that resolves to no shop — it names no number, a number nobody
    // here holds, a WABA its number's row does not record, or a disconnect
    // that raced an in-flight message — is skipped.
    // `applyProviderEmailEvent` with no `shopId` matches the provider message
    // id across every shop's rows. That is deliberate for SES, where the
    // tenant is genuinely unknowable (src/db/notifications.ts), and wrong here
    // where it is merely missing: one shop's delivery status would land on
    // another's row. Fail closed, the same way the inbound-message loop above
    // does (security review, 2026-09-12).
    const shopId = await shopFor(event);
    if (!shopId) {
      log("whatsapp_webhook.unknown_tenant", "warn", {
        status: event.status,
        hasNumber: Boolean(event.phoneNumberId),
        hasWaba: Boolean(event.wabaId),
      });
      continue;
    }
    const result = await applyProviderEmailEvent(db, {
      providerMessageId: event.providerMessageId,
      status: event.status,
      detail: event.detail,
      occurredAt: event.occurredAt,
      shopId,
    });
    // `unknown_message` is routine rather than a fault: a courtesy text sent
    // alongside an email is not the tracked channel, so it has no delivery row
    // of its own to update. Still worth a trace, same as the SES route.
    log("whatsapp_webhook.delivery_applied", result === "applied" ? "info" : "warn", {
      providerMessageId: event.providerMessageId,
      status: event.status,
      result,
    });
  }
  return new Response(null, { status: 200 });
}
