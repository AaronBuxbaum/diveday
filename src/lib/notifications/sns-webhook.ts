import { log } from "@/lib/log";
import {
  confirmSnsSubscription,
  readWebhookPayload,
  type SnsMessage,
  verifySnsMessage,
} from "@/lib/notifications/sns";
import { logWebhookRefusal } from "@/lib/webhook-refusal";

const confirmationEvents = {
  ses: "ses_webhook.subscription_confirmation",
  sms: "sms_webhook.subscription_confirmation",
  email_inbound: "email_inbound.subscription_confirmation",
} as const;

export type SnsWebhookName = keyof typeof confirmationEvents;

export type SnsWebhookGate =
  | { kind: "notification"; message: SnsMessage }
  | { kind: "response"; response: Response };

/** Shared SNS envelope gate for routes with independently pinned topics. */
export async function gateSnsWebhook(
  request: Request,
  topicArn: string | undefined,
  webhook: SnsWebhookName,
): Promise<SnsWebhookGate> {
  const payload = await readWebhookPayload(request);
  if (payload === null) return { kind: "response", response: new Response(null, { status: 400 }) };

  const verification = await verifySnsMessage(payload, topicArn);
  if (verification.status !== "verified") {
    logWebhookRefusal(webhook, verification.status);
    return {
      kind: "response",
      response: new Response(null, {
        status: verification.status === "not_configured" ? 503 : 400,
      }),
    };
  }

  const { message } = verification;
  if (message.Type === "SubscriptionConfirmation" || message.Type === "UnsubscribeConfirmation") {
    const confirmed = message.SubscribeURL
      ? await confirmSnsSubscription(message.SubscribeURL)
      : false;
    log(confirmationEvents[webhook], confirmed ? "info" : "warn", {
      type: message.Type,
      confirmed,
    });
    return { kind: "response", response: new Response(null, { status: 200 }) };
  }

  return { kind: "notification", message };
}
