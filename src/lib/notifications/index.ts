import { z } from "zod";
import {
  bookingConfirmationEmail,
  checkoutRecoveryEmail,
  lastMinuteDealEmail,
  type NotificationEmail,
  passwordChangedEmail,
  passwordResetEmail,
  staffInviteEmail,
  tripRecapEmail,
  tripReminderEmail,
  verifyAccountEmail,
  waitlistInviteEmail,
  waiverRequestEmail,
  welcomeEmail,
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
  /**
   * Set only by a caller sending a *second* confirmation for the same
   * `bookingId` — a reschedule reactivating a previously-cancelled row, or a
   * staff-triggered resend — so its idempotency key differs from the
   * original. Omitted, the key is stable per booking (the normal one-send
   * case); present, it's this specific send's own timestamp, so a genuine
   * new confirmation can't be swallowed by the provider replaying its cached
   * response to the first one (Codex finding).
   */
  confirmedAt: z.date().optional(),
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

// A staff-triggered last-minute-fill blast (docs ADR
// 20260727-last-minute-fill-promos): no bookingId — it goes to a
// last-minute-list entry, not a booking — so like waitlist_invite/
// checkout_recovery this is structurally excluded from TrackedNotification.
const lastMinuteDealSchema = z.object({
  kind: z.literal("last_minute_deal"),
  shopId: z.uuid(),
  to: emailAddressSchema,
  diverName: z.string().trim().min(1).max(120),
  shopName: z.string().trim().min(1).max(120),
  tripTitle: z.string().trim().min(1).max(200),
  startsAt: z.date(),
  endsAt: z.date(),
  timezone: z.string().trim().min(1).max(100),
  discountPercent: z.number().int().min(1).max(100),
  code: z.string().trim().min(1).max(40),
  bookingUrl: z.url().max(2_000),
  expiresAt: z.date(),
});

// A pay-at-booking checkout the diver never finished (docs ADR
// 20260726-abandoned-checkout-recovery). No bookingId: a party checkout
// covers several bookings with no reliable "lead" booking to key on
// (booking_checkout_bookings carries no ordering/lead marker), so this is
// scoped to the checkout itself and, like welcome/staff_invite above,
// structurally excluded from TrackedNotification — dedup lives on
// booking_checkouts.abandonedRecoverySentAt instead of a per-booking row.
const checkoutRecoverySchema = z.object({
  kind: z.literal("checkout_recovery"),
  checkoutId: z.uuid(),
  shopId: z.uuid(),
  to: emailAddressSchema,
  shopName: z.string().trim().min(1).max(120),
  tripTitle: z.string().trim().min(1).max(200),
  startsAt: z.date(),
  endsAt: z.date(),
  timezone: z.string().trim().min(1).max(100),
  checkoutUrl: z.url().max(2_000),
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

// Account-lifecycle mail (20260725-account-lifecycle-emails): no bookingId,
// so these are structurally excluded from TrackedNotification
// (src/db/notifications.ts) exactly like waitlist_invite already is —
// there's no shop-facing delivery issue to surface for an account's own
// welcome/verify/reset mail.
const welcomeSchema = z.object({
  kind: z.literal("welcome"),
  userAccountId: z.uuid(),
  shopId: z.uuid(),
  to: emailAddressSchema,
  ownerName: z.string().trim().min(1).max(120),
  shopName: z.string().trim().min(1).max(120),
  signInUrl: z.url().max(2_000),
});

const emailVerificationSchema = z.object({
  kind: z.literal("email_verification"),
  userAccountId: z.uuid(),
  tokenId: z.uuid(),
  shopId: z.uuid(),
  to: emailAddressSchema,
  ownerName: z.string().trim().min(1).max(120),
  verifyUrl: z.url().max(2_000),
  expiresAt: z.date(),
  timezone: z.string().trim().min(1).max(100),
});

const passwordResetRequestSchema = z.object({
  kind: z.literal("password_reset_request"),
  userAccountId: z.uuid(),
  tokenId: z.uuid(),
  shopId: z.uuid(),
  to: emailAddressSchema,
  ownerName: z.string().trim().min(1).max(120),
  resetUrl: z.url().max(2_000),
  expiresAt: z.date(),
  timezone: z.string().trim().min(1).max(100),
});

// A staff invite (20260726-staff-invite-accounts): no bookingId, account-scoped
// like welcome/email_verification/password_reset_request above.
const staffInviteSchema = z.object({
  kind: z.literal("staff_invite"),
  userAccountId: z.uuid(),
  tokenId: z.uuid(),
  shopId: z.uuid(),
  to: emailAddressSchema,
  inviteeName: z.string().trim().min(1).max(120),
  shopName: z.string().trim().min(1).max(120),
  inviterName: z.string().trim().min(1).max(120),
  roleLabels: z.array(z.string().trim().min(1).max(40)).min(1).max(10),
  inviteUrl: z.url().max(2_000),
  expiresAt: z.date(),
  timezone: z.string().trim().min(1).max(100),
});

const passwordChangedSchema = z.object({
  kind: z.literal("password_changed"),
  userAccountId: z.uuid(),
  shopId: z.uuid(),
  to: emailAddressSchema,
  ownerName: z.string().trim().min(1).max(120),
  forgotPasswordUrl: z.url().max(2_000).optional(),
  /** Distinguishes each change as its own send — a second reset is a fresh event, not a duplicate. */
  changedAt: z.date(),
});

export const notificationSchema = z.discriminatedUnion("kind", [
  bookingConfirmationSchema,
  waiverRequestSchema,
  waitlistInviteSchema,
  tripReminder7dSchema,
  tripReminder24hSchema,
  tripRecapSchema,
  welcomeSchema,
  emailVerificationSchema,
  passwordResetRequestSchema,
  passwordChangedSchema,
  staffInviteSchema,
  checkoutRecoverySchema,
  lastMinuteDealSchema,
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
  if (notification.kind === "waiver_request") return waiverRequestEmail(notification);
  if (notification.kind === "welcome") return welcomeEmail(notification);
  if (notification.kind === "email_verification") return verifyAccountEmail(notification);
  if (notification.kind === "password_reset_request") return passwordResetEmail(notification);
  if (notification.kind === "staff_invite") return staffInviteEmail(notification);
  if (notification.kind === "checkout_recovery") return checkoutRecoveryEmail(notification);
  if (notification.kind === "last_minute_deal") return lastMinuteDealEmail(notification);
  return passwordChangedEmail(notification);
}

function idempotencyKeyFor(notification: Notification): string {
  switch (notification.kind) {
    case "booking_confirmation":
      return notification.confirmedAt
        ? `booking-confirmation/${notification.bookingId}/${notification.confirmedAt.toISOString()}`
        : `booking-confirmation/${notification.bookingId}`;
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
    // One welcome ever, per account.
    case "welcome":
      return `welcome/${notification.userAccountId}`;
    // Keyed by the token row's own id, not the raw token, so a retried send
    // never doubles up without the Idempotency-Key header ever carrying the
    // bearer secret itself.
    case "email_verification":
      return `email-verification/${notification.tokenId}`;
    case "password_reset_request":
      return `password-reset-request/${notification.tokenId}`;
    case "staff_invite":
      return `staff-invite/${notification.tokenId}`;
    // Keyed by the change's own timestamp so a second reset's confirmation
    // is a fresh send, not deduped against the first.
    case "password_changed":
      return `password-changed/${notification.userAccountId}/${notification.changedAt.toISOString()}`;
    // One recovery send per checkout attempt — the row-level
    // abandonedRecoverySentAt gate is the real dedup; this only protects a
    // single call from double-hitting Resend.
    case "checkout_recovery":
      return `checkout-recovery/${notification.checkoutId}`;
    // Keyed by the code (unique per blast) and recipient, so a retry of one
    // send never doubles that diver's email while a fresh blast (new code) on
    // the same trip is always its own send.
    case "last_minute_deal":
      return `last-minute-deal/${notification.code}/${notification.to}`;
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
