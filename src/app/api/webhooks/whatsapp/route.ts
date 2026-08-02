import { getDb } from "@/db/client";
import { applyProviderEmailEvent } from "@/db/notifications";
import { shopIdForWhatsAppWaba } from "@/db/whatsapp-accounts";
import { nowDate } from "@/lib/clock";
import { log } from "@/lib/log";
import {
  parseWhatsAppDeliveryEvents,
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
 * Delivery outcomes. Answers 200 for anything verified but not acted on: Meta
 * retries a non-2xx, so erroring on an event type we don't handle — or on a
 * message id we never tracked — would buy an endless redelivery loop and
 * nothing else. That is the same posture as the Resend route.
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

  const events = parseWhatsAppDeliveryEvents(payload, nowDate());
  if (events.length === 0) return new Response(null, { status: 200 });

  const db = await getDb();
  // Resolved once per batch: every event in one delivery names the same WABA,
  // and this is the tenant key the update is scoped to.
  const shopIdByWaba = new Map<string, string | null>();
  for (const event of events) {
    let shopId: string | null = null;
    if (event.wabaId) {
      if (!shopIdByWaba.has(event.wabaId)) {
        shopIdByWaba.set(event.wabaId, await shopIdForWhatsAppWaba(db, event.wabaId));
      }
      shopId = shopIdByWaba.get(event.wabaId) ?? null;
      // A signed event for a WABA no shop has connected — a disconnect that
      // raced an in-flight message, or a subscription Meta has not dropped yet.
      // Nothing to apply, and scoping to "no shop" would silently widen the
      // update instead, so skip rather than fall through unscoped.
      if (!shopId) {
        log("whatsapp_webhook.unknown_waba", "warn", { status: event.status });
        continue;
      }
    }
    const result = await applyProviderEmailEvent(db, {
      providerMessageId: event.providerMessageId,
      status: event.status,
      detail: event.detail,
      occurredAt: event.occurredAt,
      ...(shopId ? { shopId } : {}),
    });
    // `unknown_message` is routine rather than a fault: a courtesy text sent
    // alongside an email is not the tracked channel, so it has no delivery row
    // of its own to update. Still worth a trace, same as the Resend route.
    log("whatsapp_webhook.delivery_applied", result === "applied" ? "info" : "warn", {
      providerMessageId: event.providerMessageId,
      status: event.status,
      result,
    });
  }
  return new Response(null, { status: 200 });
}
