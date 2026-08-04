import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import { z } from "zod";
import { log } from "@/lib/log";
import type { NotificationProvider } from "./provider";
import { reservedTestRecipientDelivery } from "./provider";
import { messageFor } from "./render";

/**
 * The AWS SES adapter — DiveDay's sole email provider (ADR
 * 20260803-ses-sole-email-provider). Everything vendor-specific lives here:
 * the SDK client, the credential shape, and the mapping from an SES exception
 * to the retryable/terminal answer the send queue acts on.
 */

export function formatSender(value: string): string {
  // Keep an explicitly branded sender untouched, while giving the common
  // `notifications@...` environment value the friendly name recipients see.
  const sender = value.trim();
  return sender.includes("<") ? sender : `DiveDay <${sender}>`;
}

export type SesConfig = {
  region: string;
  from: string;
  accessKeyId: string;
  secretAccessKey: string;
};

/**
 * The exact slice of `SESv2Client` this adapter calls, so a test can fake it
 * with a plain object instead of standing up (or mocking) the real SDK client.
 */
export interface SesEmailClient {
  send(command: SendEmailCommand): Promise<{ MessageId?: string }>;
}

export type SesProviderOptions = {
  client?: SesEmailClient;
};

export const sesConfigSchema = z.object({
  region: z.string().trim().min(1),
  from: z.string().trim().min(3).max(320),
  accessKeyId: z.string().trim().min(1),
  secretAccessKey: z.string().trim().min(1),
});

/**
 * SES error messages quote the addresses they refused — an `AccessDeniedException` names the
 * sender identity, a rejection can name the recipient. Those messages are useful to an operator
 * reading a failed send row, but a structured log line may never carry an email address
 * (AGENTS.md hard rule on PII in logs), so the address is masked on the way to `log()` only.
 * The domain survives, which is the part that identifies *which* identity is unverified.
 */
export function maskEmailAddresses(detail: string): string {
  return detail.replace(/[\w.+-]+@([\w-]+\.)+[A-Za-z]{2,}/g, (address) => {
    const domain = address.slice(address.indexOf("@") + 1);
    return `<redacted>@${domain}`;
  });
}

/**
 * Every SES SDK error extends `SESv2ServiceException`, which carries `$metadata.httpStatusCode`
 * and a `.name` matching the specific AWS error type. A response that never reached AWS at all
 * (a network failure) has no `$metadata` and is treated as retryable.
 */
function sesErrorInfo(error: unknown): {
  retryable: boolean;
  httpStatus?: number;
  errorCode?: string;
  detail?: string;
} {
  const isAwsException = typeof error === "object" && error !== null && "$metadata" in error;
  const httpStatus = isAwsException
    ? (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode
    : undefined;
  // "Error" (every plain JS error's default .name) is not a useful code; only
  // a modeled AWS exception's specific name is worth surfacing. "network_error"
  // is reserved for a request that never got a response at all.
  const errorCode = isAwsException && error instanceof Error ? error.name : "network_error";
  const detail = error instanceof Error ? error.message.slice(0, 500) : undefined;
  const retryable =
    !isAwsException ||
    httpStatus === undefined ||
    httpStatus === 429 ||
    httpStatus >= 500 ||
    errorCode === "TooManyRequestsException";
  return { retryable, httpStatus, errorCode, detail };
}

/**
 * SES sending via the AWS SDK (ADR 20260802-ses-adapter-and-webhook — the SDK
 * handles SigV4 signing and its own retry/backoff for throttling and 5xx, so
 * this needs no hand-rolled request loop). The sole email provider (ADR
 * 20260803-ses-sole-email-provider); see `notificationProviderFromEnvironment`.
 *
 * SES has no request-level idempotency token — a client-side timeout racing a
 * server-side success can double-send. The queue-level dedup on
 * `notification_send_queue.idempotency_key` is the real safety net; this is a
 * narrower, accepted gap. See the ADR's Consequences.
 */
export function sesNotificationProvider(
  config: SesConfig,
  options: SesProviderOptions = {},
): NotificationProvider {
  const client: SesEmailClient =
    options.client ??
    new SESv2Client({
      region: config.region,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    });
  return {
    async send(notification) {
      const invalidRecipient = reservedTestRecipientDelivery(notification.to);
      if (invalidRecipient) return invalidRecipient;
      const message = messageFor(notification);
      try {
        const result = await client.send(
          new SendEmailCommand({
            FromEmailAddress: config.from,
            Destination: { ToAddresses: [notification.to] },
            Content: {
              Simple: {
                Subject: { Data: message.subject, Charset: "UTF-8" },
                Body: {
                  Html: { Data: message.html, Charset: "UTF-8" },
                  Text: { Data: message.text, Charset: "UTF-8" },
                },
              },
            },
          }),
        );
        if (!result.MessageId) {
          return { status: "failed", retryable: true, errorCode: "invalid_response" };
        }
        return { status: "sent", providerMessageId: result.MessageId };
      } catch (error) {
        const info = sesErrorInfo(error);
        log("notification.ses_send_failed", "warn", {
          ...info,
          detail: info.detail === undefined ? undefined : maskEmailAddresses(info.detail),
        });
        return { status: "failed", ...info };
      }
    },
  };
}
