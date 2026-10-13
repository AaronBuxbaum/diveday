import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import { z } from "zod";
import { thrownErrorToken } from "@/lib/error-token";
import { log } from "@/lib/log";
import { deliveryAddressFor } from "@/lib/simulator-email";
import type { Notification } from "./kinds";
import type { NotificationProvider } from "./provider";
import { reservedTestRecipientDelivery } from "./provider";
import { messageFor } from "./render";
import { SES_KIND_TAG, SES_SHOP_TAG } from "./ses-tags";
import { fromAddressFor } from "./shop-voice";

/**
 * The AWS SES adapter — DiveDay's sole email provider (ADR
 * 20260803-ses-sole-email-provider). Everything vendor-specific lives here:
 * the SDK client, the credential shape, and the mapping from an SES exception
 * to the retryable/terminal answer the send queue acts on.
 */

/**
 * The verified sender every DiveDay email goes out as, on the `ses.dive.day`
 * identity the stack grants (docs/engineering/ses-email-runbook.md).
 *
 * Compiled in rather than deployed as configuration. It travelled as an
 * environment variable until issue #517, where the quotes its spaces required
 * in a dotenv file survived all the way to SES and every production send was
 * refused. A value the repository already knows has no business making that
 * journey; `SES_FROM_EMAIL` remains only as a fork/self-host override.
 */
export const DEFAULT_SENDER = "DiveDay <noreply@ses.dive.day>";

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
 * Every SES SDK error extends `SESv2ServiceException`, which carries `$metadata.httpStatusCode`
 * and a `.name` matching the specific AWS error type. A response that never reached AWS at all
 * (a network failure) has no `$metadata` and is treated as retryable.
 *
 * **No provider text** (security review of issue #2531). SES prose quotes what it refused: a
 * rejection can name the recipient, a sandbox `AccessDeniedException` names a pre-verified
 * recipient's identity, a validation error echoes a capability link. This result is logged and
 * stored as the send's failure detail, so the AWS error's name is the code and a throw that never
 * reached AWS keeps its cause's code or its class (`thrownErrorToken`), never its message, the
 * same rule `snsErrorInfo` (`./sms.ts`) keeps.
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
  const detail = isAwsException ? undefined : thrownErrorToken(error);
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
/**
 * The courtesy/commercial notification kinds carry `unsubscribeUrl` directly on the
 * notification (ADR 20260814-checkout-recovery-is-commercial) — this just narrows to
 * that subset so the header can be set without touching the every-kind `Notification`
 * union.
 */
function unsubscribeUrlOf(notification: Notification): string | undefined {
  // The Monday email is service mail, so it carries no `unsubscribeUrl` (that
  // field marks a send as commercial); its opt-out still earns the header.
  if (notification.kind === "weekly_digest") return notification.turnOffUrl;
  return "unsubscribeUrl" in notification ? notification.unsubscribeUrl : undefined;
}

/**
 * The page URL (`/unsubscribe/<token>`) is for a human who clicks the in-body
 * link — it stays a GET-safe confirm page (`src/app/unsubscribe/[token]/page.tsx`).
 * The one-click header target is the sibling route nested one level deeper
 * (`src/app/unsubscribe/[token]/one-click/route.ts`), which acts on a bare
 * POST with no confirmation — that's what `List-Unsubscribe-Post` promises
 * the mail client. Deliberately `/unsubscribe/<token>/one-click`, not
 * `/api/unsubscribe/<token>`: the URL's first path segment has to stay
 * `"unsubscribe"` so the bearer token remains covered by the existing
 * `CAPABILITY_ROUTE_PREFIXES` telemetry redaction (`src/lib/capability-urls.ts`)
 * — an `/api/...` sibling would have shipped the raw token to Sentry on any
 * server error (security review finding on this task). Same token, different
 * path, so no second URL needs threading through the notification schema and
 * every call site that builds one.
 */
function oneClickUnsubscribeUrl(unsubscribeUrl: string): string | undefined {
  try {
    const url = new URL(unsubscribeUrl);
    if (!url.pathname.startsWith("/unsubscribe/")) return undefined;
    url.pathname = `${url.pathname.replace(/\/$/, "")}/one-click`;
    return url.toString();
  } catch {
    return undefined;
  }
}

/**
 * The two headers that file a staff reply into the diver's own thread (RFC
 * 5322 §3.6.4): both name the message being answered. Only the reply kind
 * carries one, and only when the diver's mail had a `Message-ID` at all.
 */
function replyThreadHeaders(notification: Notification): { Name: string; Value: string }[] {
  if (notification.kind !== "staff_reply" || !notification.inReplyTo) return [];
  return [
    { Name: "In-Reply-To", Value: notification.inReplyTo },
    { Name: "References", Value: notification.inReplyTo },
  ];
}

/** See `ses-tags.ts` for why every send is tagged with its shop and kind. */
function emailTagsOf(notification: Notification): { Name: string; Value: string }[] {
  return [
    { Name: SES_KIND_TAG, Value: notification.kind },
    ...("shopId" in notification ? [{ Name: SES_SHOP_TAG, Value: notification.shopId }] : []),
  ];
}

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
      // On a demo shop, a seeded person's address reads like a person's and is
      // delivered to the SES mailbox simulator (`deliveryAddressFor`); every
      // other address, and every address on a real shop, as written.
      const demoShop = { demoShop: notification.sender?.demoShop === true };
      const to = deliveryAddressFor(notification.to, demoShop);
      const invalidRecipient = reservedTestRecipientDelivery(to);
      if (invalidRecipient) return invalidRecipient;
      const message = messageFor(notification);
      const unsubscribeUrl = unsubscribeUrlOf(notification);
      const oneClickUrl = unsubscribeUrl && oneClickUnsubscribeUrl(unsubscribeUrl);
      try {
        const result = await client.send(
          new SendEmailCommand({
            // "{Shop} via DiveDay" when the shop is the voice, on the same
            // verified address either way (`fromAddressFor`).
            FromEmailAddress: fromAddressFor(config.from, notification),
            Destination: { ToAddresses: [to] },
            // A reply to a booking confirmation is a diver writing to the
            // shop, and `noreply@ses.dive.day` is a dead letter box. The
            // shop's own front-desk address, when it has one on file (ADR
            // 20260902-sender-standards-for-ses).
            ...(notification.sender?.replyTo && {
              ReplyToAddresses: [deliveryAddressFor(notification.sender.replyTo, demoShop)],
            }),
            EmailTags: emailTagsOf(notification),
            Content: {
              Simple: {
                Subject: { Data: message.subject, Charset: "UTF-8" },
                Body: {
                  Html: { Data: message.html, Charset: "UTF-8" },
                  Text: { Data: message.text, Charset: "UTF-8" },
                },
                Headers: [
                  // RFC 3834: every DiveDay email is generated by the app, never
                  // typed by a person, and says so — an out-of-office or a
                  // ticketing auto-responder on the diver's side then stays
                  // quiet instead of replying to a booking confirmation, and a
                  // reply that does come is a human's.
                  { Name: "Auto-Submitted", Value: "auto-generated" },
                  ...replyThreadHeaders(notification),
                  // RFC 8058 one-click unsubscribe: `List-Unsubscribe` names the
                  // POST target and `List-Unsubscribe-Post` is the fixed token that
                  // tells Gmail/Yahoo/Outlook it's safe to POST there with no
                  // confirmation — lets them surface a native "Unsubscribe" control
                  // next to the sender. Points at the API route, not the in-body
                  // confirm-page link.
                  ...(oneClickUrl
                    ? [
                        { Name: "List-Unsubscribe", Value: `<${oneClickUrl}>` },
                        { Name: "List-Unsubscribe-Post", Value: "List-Unsubscribe=One-Click" },
                      ]
                    : []),
                ],
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
        log("notification.ses_send_failed", "warn", info);
        return { status: "failed", ...info };
      }
    },
  };
}
