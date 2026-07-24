import { z } from "zod";
import {
  bookingConfirmationEmail,
  type NotificationEmail,
  tripRecapEmail,
  tripReminderEmail,
  waitlistInviteEmail,
  waiverRequestEmail,
} from "./email";

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
  dockCallMinutes: z.number().int().min(5).max(180).optional(),
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

const waitlistInviteSchema = z.object({
  kind: z.literal("waitlist_invite"),
  waitlistEntryId: z.uuid(),
  shopId: z.uuid(),
  to: emailAddressSchema,
  diverName: z.string().trim().min(1).max(120),
  shopName: z.string().trim().min(1).max(120),
  tripTitle: z.string().trim().min(1).max(200),
  startsAt: z.date(),
  endsAt: z.date(),
  timezone: z.string().trim().min(1).max(100),
  bookingUrl: z.url().max(2_000),
  /** The invite timestamp, so each explicit re-invite is a distinct send. */
  invitedAt: z.date(),
});

const tripReminderFields = {
  bookingId: z.uuid(),
  shopId: z.uuid(),
  to: emailAddressSchema,
  diverName: z.string().trim().min(1).max(120),
  shopName: z.string().trim().min(1).max(120),
  tripTitle: z.string().trim().min(1).max(200),
  startsAt: z.date(),
  endsAt: z.date(),
  timezone: z.string().trim().min(1).max(100),
  dockCallMinutes: z.number().int().min(5).max(180).optional(),
  outstanding: z.array(z.string().trim().min(1).max(120)).max(8).optional(),
  medicalReview: z.boolean().optional(),
  readinessUrl: z.url().max(2_000).optional(),
};

// The night-before brief's extra sections, carried only on the 24h cadence
// (docs first-principles brainstorm C). Every field optional so the reminder
// degrades to the plain nudge when the shop has published nothing.
const nightBeforeBriefSchema = z.object({
  forecast: z.string().trim().min(1).max(600).nullish(),
  bring: z.array(z.string().trim().min(1).max(120)).max(20).optional(),
  whoToText: z.string().trim().min(1).max(40).nullish(),
  firstTimerNote: z.string().trim().min(1).max(600).nullish(),
});

// One literal per cadence so the delivery row's `kind` is the cadence itself,
// which is what dedups a reminder to once-per-booking (src/lib/reminders.ts).
const tripReminder7dSchema = z.object({
  kind: z.literal("trip_reminder_7d"),
  ...tripReminderFields,
});
const tripReminder24hSchema = z.object({
  kind: z.literal("trip_reminder_24h"),
  ...tripReminderFields,
  brief: nightBeforeBriefSchema.optional(),
});

const tripRecapSchema = z.object({
  kind: z.literal("trip_recap"),
  bookingId: z.uuid(),
  shopId: z.uuid(),
  to: emailAddressSchema,
  diverName: z.string().trim().min(1).max(120),
  shopName: z.string().trim().min(1).max(120),
  tripTitle: z.string().trim().min(1).max(200),
  startsAt: z.date(),
  timezone: z.string().trim().min(1).max(100),
  sites: z.array(z.string().trim().min(1).max(120)).max(10).optional(),
  recapUrl: z.url().max(2_000),
});

export const notificationSchema = z.discriminatedUnion("kind", [
  bookingConfirmationSchema,
  waiverRequestSchema,
  waitlistInviteSchema,
  tripReminder7dSchema,
  tripReminder24hSchema,
  tripRecapSchema,
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
  if (notification.kind === "waitlist_invite") return waitlistInviteEmail(notification);
  if (notification.kind === "trip_reminder_7d") {
    return tripReminderEmail({ ...notification, lead: "week" });
  }
  if (notification.kind === "trip_reminder_24h") {
    return tripReminderEmail({ ...notification, lead: "day" });
  }
  if (notification.kind === "trip_recap") return tripRecapEmail(notification);
  return waiverRequestEmail(notification);
}

function idempotencyKeyFor(notification: Notification): string {
  switch (notification.kind) {
    case "booking_confirmation":
      return `booking-confirmation/${notification.bookingId}`;
    case "waiver_request":
      return `waiver-request/${notification.waiverRecordId}`;
    // Keyed by invite timestamp so a genuine re-invite (a seat opens twice) is a
    // fresh send, while a double-submit of the same tap still dedups at Resend.
    case "waitlist_invite":
      return `waitlist-invite/${notification.waitlistEntryId}/${notification.invitedAt.toISOString()}`;
    // One reminder per booking per cadence — the kind alone keys it.
    case "trip_reminder_7d":
    case "trip_reminder_24h":
      return `${notification.kind}/${notification.bookingId}`;
    // One recap per booking after the trip departs.
    case "trip_recap":
      return `trip-recap/${notification.bookingId}`;
  }
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
  const result = checkPublicHost(env.APP_HOST, env.NODE_ENV === "production");
  return result.status === "valid" ? result.origin : null;
}

export type PublicHostCheck =
  | { status: "unset" }
  | { status: "valid"; origin: string }
  | { status: "invalid"; reason: string };

function isLoopbackHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

/**
 * APP_HOST feeds bearer-token links and the Stripe Connect OAuth callback, so a
 * malformed value (wrong scheme, embedded credentials, a path/query/fragment)
 * is a configuration bug worth failing loudly on rather than silently mis-linking.
 * Production requires a bare HTTPS origin; a loopback origin is only permitted
 * outside production, so a real deploy can never point at localhost.
 */
export function checkPublicHost(
  rawValue: string | undefined,
  productionRuntime: boolean,
): PublicHostCheck {
  const trimmed = rawValue?.trim();
  if (!trimmed) return { status: "unset" };

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { status: "invalid", reason: `APP_HOST must be a valid URL, got "${trimmed}".` };
  }

  const loopback = isLoopbackHostname(parsed.hostname);
  const httpsAllowed = parsed.protocol === "https:";
  const loopbackHttpAllowed = !productionRuntime && loopback && parsed.protocol === "http:";
  if (!httpsAllowed && !loopbackHttpAllowed) {
    return {
      status: "invalid",
      reason: productionRuntime
        ? `APP_HOST must use https:// in production, got "${trimmed}".`
        : `APP_HOST must use https://, or http:// on a loopback host (localhost/127.0.0.1), got "${trimmed}".`,
    };
  }
  if (parsed.username || parsed.password) {
    return {
      status: "invalid",
      reason: `APP_HOST must not include credentials, got "${trimmed}".`,
    };
  }
  if (parsed.pathname !== "/" && parsed.pathname !== "") {
    return {
      status: "invalid",
      reason: `APP_HOST must be a bare origin with no path, got "${trimmed}".`,
    };
  }
  if (parsed.search || parsed.hash) {
    return {
      status: "invalid",
      reason: `APP_HOST must not include a query string or fragment, got "${trimmed}".`,
    };
  }
  return { status: "valid", origin: `${parsed.protocol}//${parsed.host}` };
}
