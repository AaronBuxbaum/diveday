import { getDb } from "@/db/client";
import { applyProviderEmailEvent } from "@/db/notifications";
import { nowDate } from "@/lib/clock";
import { log } from "@/lib/log";
import { parseSesEmailEvent } from "@/lib/notifications/ses-events";
import {
  confirmSnsSubscription,
  readWebhookPayload,
  verifySnsMessage,
} from "@/lib/notifications/sns";

/**
 * The SES delivery-outcome webhook (ADR 20260802-ses-adapter-and-webhook,
 * 20260803-ses-sole-email-provider). SES itself never calls this endpoint
 * directly — Amazon SNS does, carrying an SES event inside its own
 * `Notification` envelope. Fails closed on an unconfigured topic, an
 * untrusted certificate host, or a bad/mismatched signature before any event
 * is handled.
 *
 * Answers 200 for anything verified but not acted on: SNS retries a non-2xx,
 * so erroring on an event type this endpoint doesn't handle — or a message id
 * it never tracked — would buy an endless redelivery loop and nothing else.
 */
export async function POST(request: Request) {
  const payload = await readWebhookPayload(request);
  if (payload === null) return new Response(null, { status: 400 });

  const verification = await verifySnsMessage(payload, process.env.SES_SNS_TOPIC_ARN);

  if (verification.status === "not_configured") return new Response(null, { status: 503 });
  if (verification.status !== "verified") return new Response(null, { status: 400 });

  const { message } = verification;

  // The one-time handshake: SNS won't deliver Notification messages to this
  // endpoint until it confirms the subscription. Only reached after
  // signature verification above, and confirmSnsSubscription independently
  // re-validates SubscribeURL's host before fetching it.
  if (message.Type === "SubscriptionConfirmation" || message.Type === "UnsubscribeConfirmation") {
    const confirmed = message.SubscribeURL
      ? await confirmSnsSubscription(message.SubscribeURL)
      : false;
    log("ses_webhook.subscription_confirmation", confirmed ? "info" : "warn", {
      type: message.Type,
      confirmed,
    });
    return new Response(null, { status: 200 });
  }

  const event = parseSesEmailEvent(message.Message, nowDate());
  if (event.kind === "ignored") return new Response(null, { status: 200 });

  const result = await applyProviderEmailEvent(await getDb(), {
    providerMessageId: event.providerMessageId,
    status: event.status,
    detail: event.detail,
    occurredAt: event.occurredAt,
  });
  log("ses_webhook.delivery_applied", result === "applied" ? "info" : "warn", {
    providerMessageId: event.providerMessageId,
    status: event.status,
    result,
  });
  return new Response(null, { status: 200 });
}
