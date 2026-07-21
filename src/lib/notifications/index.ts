import { z } from "zod";
import { bookingConfirmationEmail, type NotificationEmail, waiverRequestEmail } from "./email";

const emailAddressSchema = z.email().max(200);

const bookingConfirmationSchema = z.object({
  kind: z.literal("booking_confirmation"),
  bookingId: z.uuid(),
  shopId: z.uuid(),
  to: emailAddressSchema,
  diverName: z.string().trim().min(1).max(120),
  shopName: z.string().trim().min(1).max(120),
  tripTitle: z.string().trim().min(1).max(200),
  startsAt: z.date(),
  endsAt: z.date(),
  timezone: z.string().trim().min(1).max(100),
  readinessUrl: z.url().max(2_000).optional(),
});

const waiverRequestSchema = z.object({
  kind: z.literal("waiver_request"),
  waiverRecordId: z.uuid(),
  bookingId: z.uuid(),
  shopId: z.uuid(),
  to: emailAddressSchema,
  diverName: z.string().trim().min(1).max(120),
  shopName: z.string().trim().min(1).max(120),
  tripTitle: z.string().trim().min(1).max(200),
  completionUrl: z.url().max(2_000),
  expiresAt: z.date(),
  timezone: z.string().trim().min(1).max(100),
});

export const notificationSchema = z.discriminatedUnion("kind", [
  bookingConfirmationSchema,
  waiverRequestSchema,
]);

export type Notification = z.infer<typeof notificationSchema>;

export type NotificationDelivery =
  | { status: "sent"; providerMessageId: string }
  | { status: "not_configured" }
  | { status: "failed" };

export interface NotificationProvider {
  send(notification: Notification): Promise<NotificationDelivery>;
}

type ResendConfig = {
  apiKey: string;
  from: string;
};

type Fetch = typeof fetch;
type NotificationEnvironment = Readonly<Record<string, string | undefined>>;

const resendConfigSchema = z.object({
  apiKey: z.string().trim().min(1),
  from: z.string().trim().min(3).max(320),
});

const resendResponseSchema = z.object({ id: z.string().min(1) });

function messageFor(notification: Notification): NotificationEmail {
  if (notification.kind === "booking_confirmation") return bookingConfirmationEmail(notification);
  return waiverRequestEmail(notification);
}

function idempotencyKeyFor(notification: Notification): string {
  return notification.kind === "booking_confirmation"
    ? `booking-confirmation/${notification.bookingId}`
    : `waiver-request/${notification.waiverRecordId}`;
}

export function resendNotificationProvider(
  config: ResendConfig,
  fetchImpl: Fetch,
): NotificationProvider {
  return {
    async send(notification) {
      const message = messageFor(notification);
      try {
        const response = await fetchImpl("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${config.apiKey}`,
            "Content-Type": "application/json",
            "Idempotency-Key": idempotencyKeyFor(notification),
          },
          body: JSON.stringify({
            from: config.from,
            to: [notification.to],
            subject: message.subject,
            text: message.text,
            html: message.html,
          }),
        });
        if (!response.ok) return { status: "failed" };
        const body = resendResponseSchema.safeParse(await response.json());
        if (!body.success) return { status: "failed" };
        return { status: "sent", providerMessageId: body.data.id };
      } catch {
        return { status: "failed" };
      }
    },
  };
}

const disabledNotificationProvider: NotificationProvider = {
  async send() {
    return { status: "not_configured" };
  },
};

/**
 * The only application entry point for an outbound notification. Provider
 * details stay here so booking and waiver flows remain testable without email
 * credentials (ADR 20260718-resend-transactional-email).
 */
export async function notify(
  input: Notification,
  provider = notificationProviderFromEnvironment(),
): Promise<NotificationDelivery> {
  const notification = notificationSchema.parse(input);
  return provider.send(notification);
}

export function notificationProviderFromEnvironment(
  env: NotificationEnvironment = process.env,
  fetchImpl: Fetch = fetch,
): NotificationProvider {
  const config = resendConfigSchema.safeParse({
    apiKey: env.RESEND_API_KEY,
    from: env.RESEND_FROM_EMAIL,
  });
  return config.success
    ? resendNotificationProvider(config.data, fetchImpl)
    : disabledNotificationProvider;
}

/** A server-only canonical origin for bearer-token links; never derive this from a request header. */
export function publicAppUrl(env: NotificationEnvironment = process.env): string | null {
  const parsed = z.url().safeParse(env.APP_HOST);
  return parsed.success ? parsed.data.replace(/\/$/, "") : null;
}
