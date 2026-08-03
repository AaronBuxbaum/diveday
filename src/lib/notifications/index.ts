import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import { z } from "zod";
import { DIVER_LOCALES, type DiverLocale, isDiverLocale, toDiverLocale } from "@/i18n/settings";
import { COURSE_INQUIRY_EXPERIENCE } from "@/lib/course-inquiry";
import { log } from "@/lib/log";
import { REMINDER_ACTION_CODES } from "@/lib/readiness-summary";
import {
  bookingConfirmationEmail,
  checkoutRecoveryEmail,
  courseInquiryEmail,
  lastMinuteDealEmail,
  type NotificationEmail,
  newAccountAlertEmail,
  passwordChangedEmail,
  passwordResetEmail,
  staffInviteEmail,
  tripConditionsHoldEmail,
  tripRecapEmail,
  tripReminderEmail,
  verifyAccountEmail,
  waitlistInviteEmail,
  waiverRequestEmail,
  welcomeEmail,
  wrapEmailHtml,
} from "./email";

const emailAddressSchema = z.email().max(200);

/**
 * The language this message is written in: the recipient's own recorded locale
 * when DiveDay has one, otherwise the shop's `default_locale` (docs ADR
 * 20260731-per-person-notification-locale, superseding
 * 20260731-notification-locale). Every `Notification` kind carries one except
 * `new_account_alert`, which lands in the founder's own inbox rather than a
 * shop's or diver's. Callers pick the value with {@link recipientLocale}.
 */
const localeSchema = z.enum(DIVER_LOCALES);

/**
 * Which language to write to this recipient in.
 *
 * `people.locale` is a first-hand signal — captured from a request the diver
 * themselves made (src/db/people.ts, `recordDiverOwnLocale`) — so it outranks
 * the shop's declared default, which is a guess about everyone at once. Null,
 * or a stored value DiveDay no longer carries a bundle for, falls straight back
 * to the shop's locale, which is exactly the behaviour every notification had
 * before per-person capture existed.
 *
 * Pass the **recipient's** locale, not "a person in the story". A night-before
 * brief addressed to the crew, a staff invite, or a lead notification landing
 * in the shop's own inbox are all about a diver but not *to* one — those stay
 * on the shop's locale, so they pass `null` here or don't call this at all.
 */
export function recipientLocale(
  personLocale: string | null | undefined,
  shopDefaultLocale: string | null | undefined,
): DiverLocale {
  return isDiverLocale(personLocale) ? personLocale : toDiverLocale(shopDefaultLocale);
}

const reminderActionCodeSchema = z.enum(REMINDER_ACTION_CODES);

const bookingConfirmationSchema = z.object({
  kind: z.literal("booking_confirmation"),
  bookingId: z.uuid(),
  shopId: z.uuid(),
  to: emailAddressSchema,
  locale: localeSchema,
  diverName: z.string().trim().min(1).max(120),
  shopName: z.string().trim().min(1).max(120),
  tripTitle: z.string().trim().min(1).max(200),
  startsAt: z.date(),
  endsAt: z.date(),
  timezone: z.string().trim().min(1).max(100),
  dockCallMinutes: z.number().int().min(5).max(180).optional(),
  readinessUrl: z.url().max(2_000).optional(),
  packingList: z.array(z.string().trim().min(1).max(100)).max(12).optional(),
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
  locale: localeSchema,
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
  locale: localeSchema,
  diverName: z.string().trim().min(1).max(120),
  shopName: z.string().trim().min(1).max(120),
  tripTitle: z.string().trim().min(1).max(200),
  startsAt: z.date(),
  endsAt: z.date(),
  timezone: z.string().trim().min(1).max(100),
  bookingUrl: z.url().max(2_000),
  /** The invite timestamp, so each explicit re-invite is a distinct send. */
  invitedAt: z.date(),
  unsubscribeUrl: z.url().max(2_000),
});

// A staff-triggered last-minute-fill blast (docs ADR
// 20260727-last-minute-fill-promos): no bookingId — it goes to a
// last-minute-list entry, not a booking — so like waitlist_invite/
// checkout_recovery this is structurally excluded from TrackedNotification.
const lastMinuteDealSchema = z.object({
  kind: z.literal("last_minute_deal"),
  shopId: z.uuid(),
  to: emailAddressSchema,
  locale: localeSchema,
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
  unsubscribeUrl: z.url().max(2_000),
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
  locale: localeSchema,
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
  locale: localeSchema,
  diverName: z.string().trim().min(1).max(120),
  shopName: z.string().trim().min(1).max(120),
  tripTitle: z.string().trim().min(1).max(200),
  startsAt: z.date(),
  endsAt: z.date(),
  timezone: z.string().trim().min(1).max(100),
  dockCallMinutes: z.number().int().min(5).max(180).optional(),
  outstanding: z.array(reminderActionCodeSchema).max(8).optional(),
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
  locale: localeSchema,
  diverName: z.string().trim().min(1).max(120),
  shopName: z.string().trim().min(1).max(120),
  tripTitle: z.string().trim().min(1).max(200),
  startsAt: z.date(),
  timezone: z.string().trim().min(1).max(100),
  sites: z.array(z.string().trim().min(1).max(120)).max(10).optional(),
  recapUrl: z.url().max(2_000),
  unsubscribeUrl: z.url().max(2_000),
});

const tripConditionsHoldSchema = z.object({
  kind: z.literal("trip_conditions_hold"),
  tripId: z.uuid(),
  shopId: z.uuid(),
  to: emailAddressSchema,
  locale: localeSchema,
  diverName: z.string().trim().min(1).max(120),
  shopName: z.string().trim().min(1).max(120),
  tripTitle: z.string().trim().min(1).max(200),
  startsAt: z.date(),
  timezone: z.string().trim().min(1).max(100),
  conditionsSummary: z.string().trim().max(600).nullish(),
  tripUrl: z.url().max(2_000),
  publishedAt: z.date(),
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
  locale: localeSchema,
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
  locale: localeSchema,
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
  locale: localeSchema,
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
  locale: localeSchema,
  inviteeName: z.string().trim().min(1).max(120),
  shopName: z.string().trim().min(1).max(120),
  inviterName: z.string().trim().min(1).max(120),
  roleLabels: z.array(z.string().trim().min(1).max(40)).min(1).max(10),
  inviteUrl: z.url().max(2_000),
  expiresAt: z.date(),
  timezone: z.string().trim().min(1).max(100),
});

// Internal signal, not account-lifecycle mail (docs ADR 20260727-operational-alerts): fires once
// per new shop so the founder learns about signups without watching a dashboard. No bookingId,
// structurally excluded from TrackedNotification exactly like welcome/staff_invite above.
const newAccountAlertSchema = z.object({
  kind: z.literal("new_account_alert"),
  userAccountId: z.uuid(),
  shopId: z.uuid(),
  to: emailAddressSchema,
  ownerName: z.string().trim().min(1).max(120),
  ownerEmail: emailAddressSchema,
  shopName: z.string().trim().min(1).max(120),
  shopSlug: z.string().trim().min(1).max(120),
});

// The shop's own inbox learns about a lead the moment the diver submits the
// public course-page composer (docs/product/archive/ux-personas-20260730-findings.md
// task 7) — carries the course_inquiries row id so a retried send can't double
// up, exactly like waiver_request keys off its own row.
const courseInquirySchema = z.object({
  kind: z.literal("course_inquiry"),
  courseInquiryId: z.uuid(),
  shopId: z.uuid(),
  to: emailAddressSchema,
  locale: localeSchema,
  shopName: z.string().trim().min(1).max(120),
  courseTitle: z.string().trim().min(1).max(200),
  inquirerName: z.string().trim().min(1).max(120).optional(),
  inquirerEmail: emailAddressSchema.optional(),
  inquirerPhone: z.string().trim().min(1).max(30).optional(),
  experience: z.enum(COURSE_INQUIRY_EXPERIENCE),
  timing: z.string().trim().min(1).max(200).optional(),
  divers: z.number().int().min(1).max(12).optional(),
  message: z.string().trim().min(1).max(1500).optional(),
});

const passwordChangedSchema = z.object({
  kind: z.literal("password_changed"),
  userAccountId: z.uuid(),
  shopId: z.uuid(),
  to: emailAddressSchema,
  locale: localeSchema,
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
  tripConditionsHoldSchema,
  welcomeSchema,
  emailVerificationSchema,
  passwordResetRequestSchema,
  passwordChangedSchema,
  staffInviteSchema,
  checkoutRecoverySchema,
  lastMinuteDealSchema,
  newAccountAlertSchema,
  courseInquirySchema,
]);

export type Notification = z.infer<typeof notificationSchema>;

export type NotificationDelivery =
  | { status: "sent"; providerMessageId: string }
  | { status: "not_configured" }
  | {
      status: "failed";
      retryable?: boolean;
      retryAfterMs?: number;
      httpStatus?: number;
      errorCode?: string;
      detail?: string;
    };

export interface NotificationProvider {
  send(notification: Notification): Promise<NotificationDelivery>;
  sendBatch?(notifications: Notification[]): Promise<NotificationDelivery[]>;
}

type NotificationEnvironment = Readonly<Record<string, string | undefined>>;

function formatSender(value: string): string {
  // Keep an explicitly branded sender untouched, while giving the common
  // `notifications@...` environment value the friendly name recipients see.
  const sender = value.trim();
  return sender.includes("<") ? sender : `DiveDay <${sender}>`;
}

const reservedTestEmailDomains = [
  "example.com",
  "example.org",
  "example.net",
  "test.com",
  "example",
  "invalid",
  "localhost",
  "test",
  // Demo credentials and seeded people are intentionally non-deliverable.
  // Keep this guard at the provider boundary so every mail path (including
  // deferred account invites and batch sends) gets the same protection.
  "demo.com",
];

function reservedTestRecipientDelivery(to: string): NotificationDelivery | null {
  const domain = to
    .slice(to.lastIndexOf("@") + 1)
    .toLowerCase()
    .replace(/\.$/, "");
  const isReserved = reservedTestEmailDomains.some(
    (reservedDomain) => domain === reservedDomain || domain.endsWith(`.${reservedDomain}`),
  );
  if (!isReserved) return null;
  return {
    status: "failed",
    retryable: false,
    errorCode: "invalid_test_recipient",
    detail:
      "Reserved test domains such as example.com are blocked. Use a real recipient or an SES mailbox simulator address such as success@simulator.amazonses.com.",
  };
}

function messageFor(notification: Notification): NotificationEmail {
  const message = rawMessageFor(notification);
  // Not every kind carries both fields (the internal new-account alert has no
  // locale; password-changed has no shop to brand as) — the wrapper's own
  // document chrome (doctype, viewport, container) applies uniformly either way.
  const shopName = "shopName" in notification ? notification.shopName : "DiveDay";
  const locale = "locale" in notification ? notification.locale : "en";
  return { ...message, html: wrapEmailHtml(message.html, { shopName, locale }) };
}

function rawMessageFor(notification: Notification): NotificationEmail {
  if (notification.kind === "booking_confirmation") return bookingConfirmationEmail(notification);
  if (notification.kind === "waitlist_invite") return waitlistInviteEmail(notification);
  if (notification.kind === "trip_reminder_7d") {
    return tripReminderEmail({ ...notification, lead: "week" });
  }
  if (notification.kind === "trip_reminder_24h") {
    return tripReminderEmail({ ...notification, lead: "day" });
  }
  if (notification.kind === "trip_recap") return tripRecapEmail(notification);
  if (notification.kind === "trip_conditions_hold") return tripConditionsHoldEmail(notification);
  if (notification.kind === "waiver_request") return waiverRequestEmail(notification);
  if (notification.kind === "welcome") return welcomeEmail(notification);
  if (notification.kind === "email_verification") return verifyAccountEmail(notification);
  if (notification.kind === "password_reset_request") return passwordResetEmail(notification);
  if (notification.kind === "staff_invite") return staffInviteEmail(notification);
  if (notification.kind === "checkout_recovery") return checkoutRecoveryEmail(notification);
  if (notification.kind === "last_minute_deal") return lastMinuteDealEmail(notification);
  if (notification.kind === "new_account_alert") return newAccountAlertEmail(notification);
  if (notification.kind === "course_inquiry") return courseInquiryEmail(notification);
  return passwordChangedEmail(notification);
}

export function notificationIdempotencyKey(notification: Notification): string {
  switch (notification.kind) {
    case "booking_confirmation":
      return notification.confirmedAt
        ? `booking-confirmation/${notification.bookingId}/${notification.confirmedAt.toISOString()}`
        : `booking-confirmation/${notification.bookingId}`;
    case "waiver_request":
      return `waiver-request/${notification.waiverRecordId}`;
    // Keyed by invite timestamp so a genuine re-invite (a seat opens twice) is a
    // fresh send, while a double-submit of the same tap still dedups at the
    // notification_send_queue level.
    case "waitlist_invite":
      return `waitlist-invite/${notification.waitlistEntryId}/${notification.invitedAt.toISOString()}`;
    // One reminder per booking per cadence — the kind alone keys it.
    case "trip_reminder_7d":
    case "trip_reminder_24h":
      return `${notification.kind}/${notification.bookingId}`;
    // One recap per booking after the trip departs.
    case "trip_recap":
      return `trip-recap/${notification.bookingId}`;
    case "trip_conditions_hold":
      return `trip-conditions-hold/${notification.tripId}/${notification.publishedAt.toISOString()}/${notification.to}`;
    // One welcome ever, per account.
    case "welcome":
      return `welcome/${notification.userAccountId}`;
    // Keyed by the token row's own id, not the raw token, so a retried send
    // never doubles up without this idempotency key ever carrying the bearer
    // secret itself.
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
    // single call from double-hitting the notification_send_queue.
    case "checkout_recovery":
      return `checkout-recovery/${notification.checkoutId}`;
    // Keyed by the code (unique per blast) and recipient, so a retry of one
    // send never doubles that diver's email while a fresh blast (new code) on
    // the same trip is always its own send.
    case "last_minute_deal":
      return `last-minute-deal/${notification.code}/${notification.to}`;
    // One alert per account, ever — same key shape as welcome above.
    case "new_account_alert":
      return `new-account-alert/${notification.userAccountId}`;
    // One notification per submitted inquiry row.
    case "course_inquiry":
      return `course-inquiry/${notification.courseInquiryId}`;
  }
}

const disabledNotificationProvider: NotificationProvider = {
  async send() {
    return { status: "not_configured" };
  },
};

type SesConfig = {
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

const sesConfigSchema = z.object({
  region: z.string().trim().min(1),
  from: z.string().trim().min(3).max(320),
  accessKeyId: z.string().trim().min(1),
  secretAccessKey: z.string().trim().min(1),
});

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
        log("notification.ses_send_failed", "warn", info);
        return { status: "failed", ...info };
      }
    },
  };
}

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
  const sesConfig = sesConfigSchema.safeParse({
    region: env.SES_AWS_REGION,
    from: env.SES_FROM_EMAIL ? formatSender(env.SES_FROM_EMAIL) : undefined,
    accessKeyId: env.SES_AWS_ACCESS_KEY_ID,
    secretAccessKey: env.SES_AWS_SECRET_ACCESS_KEY,
  });
  return sesConfig.success
    ? sesNotificationProvider(sesConfig.data, sesProviderOptions)
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
