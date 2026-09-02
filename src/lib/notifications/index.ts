import { configuredValue } from "@/lib/configured";
import type { Notification } from "./kinds";
import { notificationSchema } from "./kinds";
import {
  disabledNotificationProvider,
  type NotificationDelivery,
  type NotificationEnvironment,
  type NotificationProvider,
} from "./provider";
import type { SesProviderOptions } from "./ses";
import { DEFAULT_SENDER, formatSender, sesConfigSchema, sesNotificationProvider } from "./ses";

/**
 * Outbound notifications — the public surface.
 *
 * `notify` is the only application entry point for sending one, and everything
 * else here exists to serve it. Booking, waiver, and account flows import
 * `@/lib/notifications` and nothing deeper, so they stay testable with no email
 * credentials at all: with SES unconfigured the provider degrades to
 * "not_configured" rather than throwing.
 *
 * | Module | What lives there |
 * | --- | --- |
 * | `./kinds.ts` | every notification kind as a zod schema, and its idempotency key |
 * | `./render.ts` | which email body each kind renders to |
 * | `./provider.ts` | the provider seam: delivery outcomes, reserved-recipient refusal, the disabled provider |
 * | `./ses.ts` | the AWS SES adapter — the only vendor-specific code |
 * | `./app-url.ts` | `APP_HOST` validation, the origin every bearer-token link is built from |
 * | `./email.ts` | the message bodies themselves |
 *
 * The other channels are their own modules and are not re-exported here:
 * `./sms.ts`, `./whatsapp.ts`, and `./courtesy.ts` (which picks between them).
 */

/**
 * The only application entry point for an outbound notification. Provider
 * details stay here so booking and waiver flows remain testable without email
 * credentials (ADR 20260803-ses-sole-email-provider).
 */
export async function notify(
  input: Notification,
  provider = notificationProviderFromEnvironment(),
): Promise<NotificationDelivery> {
  const notification = notificationSchema.parse(input);
  return provider.send(notification);
}

/**
 * SES is the only email provider (ADR 20260803-ses-sole-email-provider,
 * superseding 20260802-ses-adapter-and-webhook's opt-in `EMAIL_PROVIDER=ses`
 * flag). Missing or invalid SES credentials fall back to
 * `disabledNotificationProvider` rather than throwing, so a booking or waiver
 * flow degrades to "email not configured" instead of failing outright.
 */
export function notificationProviderFromEnvironment(
  env: NotificationEnvironment = process.env,
  sesProviderOptions: SesProviderOptions = {},
): NotificationProvider {
  const sender = configuredValue(env.SES_FROM_EMAIL, DEFAULT_SENDER);
  const sesConfig = sesConfigSchema.safeParse({
    region: env.SES_AWS_REGION,
    from: sender ? formatSender(sender) : undefined,
    accessKeyId: env.SES_AWS_ACCESS_KEY_ID,
    secretAccessKey: env.SES_AWS_SECRET_ACCESS_KEY,
  });
  return sesConfig.success
    ? sesNotificationProvider(sesConfig.data, sesProviderOptions)
    : disabledNotificationProvider;
}

export {
  APP_ORIGIN,
  appHost,
  checkPublicHost,
  type PublicHostCheck,
  publicAppUrl,
} from "./app-url";
export {
  type Notification,
  type NotificationSender,
  notificationIdempotencyKey,
  notificationSchema,
  recipientLocale,
} from "./kinds";
export type { NotificationDelivery, NotificationProvider } from "./provider";
export {
  deliverableShopContactEmail,
  type ShopSenderSource,
  shopSenderOf,
} from "./sender";
export { type SesEmailClient, type SesProviderOptions, sesNotificationProvider } from "./ses";
