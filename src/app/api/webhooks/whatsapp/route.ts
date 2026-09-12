import { getDb } from "@/db/client";
import { recordInboundMessage } from "@/db/inbound-messages";
import { applyProviderEmailEvent } from "@/db/notifications";
import { handleInboundReplyKeyword } from "@/db/reply-keywords";
import { shopIdForWhatsAppWaba } from "@/db/whatsapp-accounts";
import { nowDate } from "@/lib/clock";
import { log } from "@/lib/log";
import {
  parseWhatsAppDeliveryEvents,
  parseWhatsAppInboundMessages,
  verifyWhatsAppSignature,
  whatsAppChallengeResponse,
} from "@/lib/notifications/whatsapp-events";

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
 * Both halves resolve the tenant the same way — the WABA in `entry[].id`,
 * looked up to a shop — and an inbound message for a WABA no shop has
 * connected is dropped rather than filed nowhere: the row has a `shop_id`, and
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
  if (verification.status === "not_configured") return new Response(null, { status: 503 });
  if (verification.status !== "verified") return new Response(null, { status: 400 });

  const now = nowDate();
  const events = parseWhatsAppDeliveryEvents(payload, now);
  const inbound = parseWhatsAppInboundMessages(payload, now);
  if (events.length === 0 && inbound.length === 0) return new Response(null, { status: 200 });

  const db = await getDb();
  // Resolved once per batch: every event in one delivery names the same WABA,
  // and this is the tenant key the update is scoped to.
  const shopIdByWaba = new Map<string, string | null>();
  const shopFor = async (wabaId: string) => {
    if (!shopIdByWaba.has(wabaId))
      shopIdByWaba.set(wabaId, await shopIdForWhatsAppWaba(db, wabaId));
    return shopIdByWaba.get(wabaId) ?? null;
  };

  for (const message of inbound) {
    const shopId = message.wabaId ? await shopFor(message.wabaId) : null;
    if (!shopId) {
      log("whatsapp_webhook.inbound_unknown_waba", "warn", { hasWaba: Boolean(message.wabaId) });
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
    }
  }

  for (const event of events) {
    // Meta names the WABA on every entry it sends. `wabaId` is optional in the
    // parser because the payload *shape* allows the field to be absent, not
    // because a real event omits it — so an event arriving without one is a
    // shape DiveDay cannot attribute, and `applyProviderEmailEvent` with no
    // `shopId` matches the provider message id across every shop's rows. That
    // is deliberate for SES, where the tenant is genuinely unknowable
    // (src/db/notifications.ts), and wrong here where it is merely missing:
    // one shop's delivery status would land on another's row. Fail closed, the
    // same way the inbound-message loop above does (security review,
    // 2026-09-12).
    if (!event.wabaId) {
      log("whatsapp_webhook.event_without_waba", "warn", { status: event.status });
      continue;
    }
    const shopId = await shopFor(event.wabaId);
    // A signed event for a WABA no shop has connected — a disconnect that
    // raced an in-flight message, or a subscription Meta has not dropped yet.
    // Nothing to apply, and scoping to "no shop" would silently widen the
    // update instead, so skip rather than fall through unscoped.
    if (!shopId) {
      log("whatsapp_webhook.unknown_waba", "warn", { status: event.status });
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
