import { getDb } from "@/db/client";
import { applyProviderEmailEvent } from "@/db/notifications";
import { nowDate } from "@/lib/clock";
import { log } from "@/lib/log";
import { parseSmsDeliveryEvent } from "@/lib/notifications/sms-events";
import {
  confirmSnsSubscription,
  readWebhookPayload,
  verifySnsMessage,
} from "@/lib/notifications/sns";

/**
 * SMS delivery receipts (docs ADR 20260802-sms-delivery-receipts).
 *
 * Structurally identical to `/api/webhooks/ses` — same SNS envelope, same
 * verification, same subscription handshake — because it deliberately arrives
 * the same way. SNS has no delivery webhook for a direct-to-phone `Publish`;
 * receipts go to CloudWatch Logs, and an AWS-side forwarder republishes each
 * one to this topic precisely so it lands on a transport already authenticated
 * here rather than needing a bespoke one.
 *
 * Fails closed on an unconfigured topic, an untrusted certificate host, or a
 * bad signature, before any record is read.
 */
export async function POST(request: Request) {
  const payload = await readWebhookPayload(request);
  if (payload === null) return new Response(null, { status: 400 });

  const verification = await verifySnsMessage(payload, process.env.SMS_SNS_TOPIC_ARN);
  if (verification.status === "not_configured") return new Response(null, { status: 503 });
  if (verification.status !== "verified") return new Response(null, { status: 400 });

  const { message } = verification;

  if (message.Type === "SubscriptionConfirmation" || message.Type === "UnsubscribeConfirmation") {
    const confirmed = message.SubscribeURL
      ? await confirmSnsSubscription(message.SubscribeURL)
      : false;
    log("sms_webhook.subscription_confirmation", confirmed ? "info" : "warn", {
      type: message.Type,
      confirmed,
    });
    return new Response(null, { status: 200 });
  }

  const event = parseSmsDeliveryEvent(message.Message, nowDate());
  if (event.kind === "ignored") return new Response(null, { status: 200 });

  const result = await applyProviderEmailEvent(await getDb(), {
    providerMessageId: event.providerMessageId,
    status: event.status,
    detail: event.detail,
    occurredAt: event.occurredAt,
  });
  // `unknown_message` is the common case here, not a fault: a courtesy text
  // sent alongside an email is not the tracked channel and has no delivery row
  // of its own. Only a phone-only diver's SMS has one to update.
  log("sms_webhook.delivery_applied", result === "applied" ? "info" : "warn", {
    providerMessageId: event.providerMessageId,
    status: event.status,
    result,
  });
  return new Response(null, { status: 200 });
}
