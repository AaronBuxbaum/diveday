import { PublishCommand, SNSClient } from "@aws-sdk/client-sns";
import { z } from "zod";
import { log } from "@/lib/log";

/**
 * SMS delivery through AWS SNS's direct-to-phone-number `Publish` API — the
 * same seam shape as the SES email provider (`./index.ts`): the SDK handles
 * SigV4 signing and its own retry/backoff, so unlike a fetch-based adapter this
 * needs no hand-rolled request loop (ADR 20260802-sns-sms-adapter). Every send
 * degrades to `not_configured` when the channel's credentials are absent, so
 * booking and reminder flows stay testable and shippable without a texting
 * account configured.
 *
 * SNS has no WhatsApp delivery path (that's a distinct Meta Business API
 * integration Twilio happened to front) — this channel is SMS-only. Add a
 * WhatsApp adapter alongside this one, behind the same `SmsProvider`
 * interface, if that's ever explicitly requested.
 */

export type SmsMessage = {
  /** Recipient in E.164 form, e.g. +13055551234. */
  to: string;
  /** Plain-text body; keep it short — one SMS segment where possible. */
  body: string;
};

export type SmsDelivery =
  | { status: "sent"; providerMessageId: string }
  | { status: "not_configured" }
  | {
      status: "failed";
      retryable?: boolean;
      httpStatus?: number;
      errorCode?: string;
      detail?: string;
    };

export interface SmsProvider {
  send(message: SmsMessage): Promise<SmsDelivery>;
}

type SmsEnvironment = Readonly<Record<string, string | undefined>>;

const E164 = /^\+[1-9]\d{6,14}$/;

/**
 * The E.164 number to text, or null when the stored phone can't be dialed
 * internationally. Strips spaces, dashes, dots, and parentheses first, but does
 * *not* guess a country code — a local "555-1234" has no unambiguous +country,
 * so callers skip SMS rather than text the wrong number.
 */
export function smsRecipient(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const cleaned = phone.replace(/[\s().-]/g, "");
  return E164.test(cleaned) ? cleaned : null;
}

type SnsConfig = {
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Alphanumeric sender label — not supported in every country (notably the US); optional. */
  senderId?: string;
};

/**
 * The exact slice of `SNSClient` this adapter calls, so a test can fake it
 * with a plain object instead of standing up (or mocking) the real SDK client.
 */
export interface SnsPublishClient {
  send(command: PublishCommand): Promise<{ MessageId?: string }>;
}

export type SnsProviderOptions = {
  client?: SnsPublishClient;
};

const snsConfigSchema = z.object({
  region: z.string().trim().min(1),
  accessKeyId: z.string().trim().min(1),
  secretAccessKey: z.string().trim().min(1),
  senderId: z.string().trim().min(1).optional(),
});

/**
 * Every SNS SDK error extends `SNSServiceException`, which carries
 * `$metadata.httpStatusCode` and a `.name` matching the specific AWS error
 * type — the same shape `sesErrorInfo` (`./index.ts`) classifies, reused here
 * rather than duplicated since both adapters read the identical AWS SDK
 * exception contract.
 */
function snsErrorInfo(error: unknown): {
  retryable: boolean;
  httpStatus?: number;
  errorCode?: string;
  detail?: string;
} {
  const isAwsException = typeof error === "object" && error !== null && "$metadata" in error;
  const httpStatus = isAwsException
    ? (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode
    : undefined;
  const errorCode = isAwsException && error instanceof Error ? error.name : "network_error";
  const detail = error instanceof Error ? error.message.slice(0, 500) : undefined;
  const retryable =
    !isAwsException ||
    httpStatus === undefined ||
    httpStatus === 429 ||
    httpStatus >= 500 ||
    errorCode === "ThrottledException";
  return { retryable, httpStatus, errorCode, detail };
}

/**
 * SMS sending via AWS SNS (ADR 20260802-sns-sms-adapter). Dormant until its
 * credentials are set; see `smsProviderFromEnvironment`.
 */
export function snsSmsProvider(config: SnsConfig, options: SnsProviderOptions = {}): SmsProvider {
  const client: SnsPublishClient =
    options.client ??
    new SNSClient({
      region: config.region,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    });
  return {
    async send(message) {
      try {
        const result = await client.send(
          new PublishCommand({
            PhoneNumber: message.to,
            Message: message.body,
            MessageAttributes: {
              "AWS.SNS.SMS.SMSType": { DataType: "String", StringValue: "Transactional" },
              ...(config.senderId
                ? {
                    "AWS.SNS.SMS.SenderID": { DataType: "String", StringValue: config.senderId },
                  }
                : {}),
            },
          }),
        );
        if (!result.MessageId) {
          return { status: "failed", retryable: true, errorCode: "invalid_response" };
        }
        return { status: "sent", providerMessageId: result.MessageId };
      } catch (error) {
        const info = snsErrorInfo(error);
        log("notification.sns_sms_send_failed", "warn", info);
        return { status: "failed", ...info };
      }
    },
  };
}

const disabledSmsProvider: SmsProvider = {
  async send() {
    return { status: "not_configured" };
  },
};

/** The only application entry point for an outbound text. */
export async function notifySms(
  message: SmsMessage,
  provider = smsProviderFromEnvironment(),
): Promise<SmsDelivery> {
  return provider.send(message);
}

export function smsProviderFromEnvironment(
  env: SmsEnvironment = process.env,
  options: SnsProviderOptions = {},
): SmsProvider {
  const config = snsConfigSchema.safeParse({
    region: env.SNS_AWS_REGION,
    accessKeyId: env.SNS_AWS_ACCESS_KEY_ID,
    secretAccessKey: env.SNS_AWS_SECRET_ACCESS_KEY,
    senderId: env.SNS_SENDER_ID,
  });
  return config.success ? snsSmsProvider(config.data, options) : disabledSmsProvider;
}
