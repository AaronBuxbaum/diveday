import { z } from "zod";
import { nowMs } from "@/lib/clock";
import {
  bookingConfirmationEmail,
  checkoutRecoveryEmail,
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

const tripConditionsHoldSchema = z.object({
  kind: z.literal("trip_conditions_hold"),
  tripId: z.uuid(),
  shopId: z.uuid(),
  to: emailAddressSchema,
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
  tripConditionsHoldSchema,
  welcomeSchema,
  emailVerificationSchema,
  passwordResetRequestSchema,
  passwordChangedSchema,
  staffInviteSchema,
  checkoutRecoverySchema,
  lastMinuteDealSchema,
  newAccountAlertSchema,
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

type ResendConfig = {
  apiKey: string;
  from: string;
};

type Fetch = typeof fetch;
type NotificationEnvironment = Readonly<Record<string, string | undefined>>;

export type ResendProviderOptions = {
  /** Reserve a team-wide request slot before each attempt. */
  beforeRequest?: () => Promise<void>;
  sleep?: (milliseconds: number) => Promise<void>;
  random?: () => number;
  maxAttempts?: number;
};

const resendConfigSchema = z.object({
  apiKey: z.string().trim().min(1),
  from: z.string().trim().min(3).max(320),
});

const resendResponseSchema = z.object({ id: z.string().min(1) });

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
      "Resend blocks reserved test domains such as example.com. Use a real recipient or a Resend test address such as delivered@resend.dev.",
  };
}

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
  if (notification.kind === "trip_conditions_hold") return tripConditionsHoldEmail(notification);
  if (notification.kind === "waiver_request") return waiverRequestEmail(notification);
  if (notification.kind === "welcome") return welcomeEmail(notification);
  if (notification.kind === "email_verification") return verifyAccountEmail(notification);
  if (notification.kind === "password_reset_request") return passwordResetEmail(notification);
  if (notification.kind === "staff_invite") return staffInviteEmail(notification);
  if (notification.kind === "checkout_recovery") return checkoutRecoveryEmail(notification);
  if (notification.kind === "last_minute_deal") return lastMinuteDealEmail(notification);
  if (notification.kind === "new_account_alert") return newAccountAlertEmail(notification);
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
    case "trip_conditions_hold":
      return `trip-conditions-hold/${notification.tripId}/${notification.publishedAt.toISOString()}/${notification.to}`;
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
    // One alert per account, ever — same key shape as welcome above.
    case "new_account_alert":
      return `new-account-alert/${notification.userAccountId}`;
  }
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

let nextInProcessRequestAt = 0;
let inProcessPermitTail = Promise.resolve();

/**
 * A local fallback for development and single-instance deployments. Production
 * callers pass the database-backed permit in `notificationProviderFromEnvironment`.
 */
async function acquireInProcessPermit(): Promise<void> {
  const previous = inProcessPermitTail;
  let release!: () => void;
  inProcessPermitTail = new Promise((resolve) => {
    release = resolve;
  });
  await previous;
  const now = nowMs();
  const scheduledAt = Math.max(now, nextInProcessRequestAt);
  nextInProcessRequestAt = scheduledAt + 125;
  try {
    if (scheduledAt > now) await sleep(scheduledAt - now);
  } finally {
    release();
  }
}

function retryDelayMs(
  attempt: number,
  retryAfterMs: number | undefined,
  random: () => number,
): number {
  if (retryAfterMs !== undefined) return Math.max(0, retryAfterMs);
  const base = Math.min(4_000, 250 * 2 ** (attempt - 1));
  return base + Math.floor(random() * base);
}

function parseRetryAfter(response: Response): number | undefined {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return Math.max(0, Math.ceil(seconds * 1_000));
    const timestamp = Date.parse(retryAfter);
    if (!Number.isNaN(timestamp)) return Math.max(0, timestamp - nowMs());
  }
  const resetHeader = response.headers.get("ratelimit-reset");
  if (!resetHeader) return undefined;
  const reset = Number(resetHeader);
  return Number.isFinite(reset) && reset >= 0 ? Math.ceil(reset * 1_000) : undefined;
}

function parseProviderError(body: string): { code?: string; message?: string } {
  try {
    const parsed: unknown = JSON.parse(body);
    if (!parsed || typeof parsed !== "object" || !("error" in parsed)) return {};
    const error = parsed.error;
    if (!error || typeof error !== "object") return {};
    return {
      code: "code" in error && typeof error.code === "string" ? error.code : undefined,
      message:
        "message" in error && typeof error.message === "string"
          ? error.message.slice(0, 500)
          : undefined,
    };
  } catch {
    return {};
  }
}

type ResendHttpResult =
  | { ok: true; body: unknown }
  | {
      ok: false;
      retryable: boolean;
      retryAfterMs?: number;
      httpStatus?: number;
      errorCode?: string;
      detail?: string;
    };

async function requestResend(
  config: ResendConfig,
  fetchImpl: Fetch,
  options: Required<
    Pick<ResendProviderOptions, "beforeRequest" | "sleep" | "random" | "maxAttempts">
  >,
  endpoint: string,
  idempotencyKey: string,
  body: unknown,
): Promise<ResendHttpResult> {
  for (let attempt = 1; attempt <= options.maxAttempts; attempt += 1) {
    await options.beforeRequest();
    try {
      const response = await fetchImpl(`https://api.resend.com/${endpoint}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify(body),
      });
      const rawBody = await response.text();
      let parsedBody: unknown = null;
      try {
        parsedBody = JSON.parse(rawBody);
      } catch {
        // The status code remains the useful diagnostic for a non-JSON response.
      }
      if (response.ok) return { ok: true, body: parsedBody };

      const providerError = parseProviderError(rawBody);
      const retryable = response.status === 429 || response.status >= 500;
      const retryAfterMs = parseRetryAfter(response);
      if (retryable && attempt < options.maxAttempts) {
        await options.sleep(retryDelayMs(attempt, retryAfterMs, options.random));
        continue;
      }
      return {
        ok: false,
        retryable,
        retryAfterMs,
        httpStatus: response.status,
        errorCode: providerError.code,
        detail: providerError.message,
      };
    } catch (error) {
      if (attempt < options.maxAttempts) {
        await options.sleep(retryDelayMs(attempt, undefined, options.random));
        continue;
      }
      return {
        ok: false,
        retryable: true,
        errorCode: "network_error",
        detail: error instanceof Error ? error.message.slice(0, 500) : undefined,
      };
    }
  }
  return { ok: false, retryable: true, errorCode: "retry_exhausted" };
}

function failedDelivery(result: Extract<ResendHttpResult, { ok: false }>): NotificationDelivery {
  const delivery: Extract<NotificationDelivery, { status: "failed" }> = {
    status: "failed",
    retryable: result.retryable,
  };
  if (result.retryAfterMs !== undefined) delivery.retryAfterMs = result.retryAfterMs;
  if (result.httpStatus !== undefined) delivery.httpStatus = result.httpStatus;
  if (result.errorCode !== undefined) delivery.errorCode = result.errorCode;
  if (result.detail !== undefined) delivery.detail = result.detail;
  return delivery;
}

function batchIdempotencyKey(notifications: Notification[]): string {
  let hash = 2_166_136_261;
  for (const value of notifications.map(notificationIdempotencyKey).join("\u0000")) {
    hash ^= value.charCodeAt(0);
    hash = Math.imul(hash, 16_777_619);
  }
  return `notification-batch/${notifications.length}/${hash >>> 0}`;
}

export function resendNotificationProvider(
  config: ResendConfig,
  fetchImpl: Fetch,
  providerOptions: ResendProviderOptions = {},
): NotificationProvider {
  const options = {
    beforeRequest: providerOptions.beforeRequest ?? acquireInProcessPermit,
    sleep: providerOptions.sleep ?? sleep,
    random: providerOptions.random ?? Math.random,
    maxAttempts: providerOptions.maxAttempts ?? 4,
  };
  return {
    async send(notification) {
      const invalidRecipient = reservedTestRecipientDelivery(notification.to);
      if (invalidRecipient) return invalidRecipient;
      const message = messageFor(notification);
      const result = await requestResend(
        config,
        fetchImpl,
        options,
        "emails",
        notificationIdempotencyKey(notification),
        {
          from: config.from,
          to: [notification.to],
          subject: message.subject,
          text: message.text,
          html: message.html,
        },
      );
      if (!result.ok) {
        console.warn("Resend email request failed", {
          httpStatus: result.httpStatus,
          errorCode: result.errorCode,
          retryAfterMs: result.retryAfterMs,
          retryable: result.retryable,
        });
        return failedDelivery(result);
      }
      const body = resendResponseSchema.safeParse(result.body);
      if (!body.success)
        return { status: "failed", retryable: true, errorCode: "invalid_response" };
      return { status: "sent", providerMessageId: body.data.id };
    },
    async sendBatch(notifications) {
      if (notifications.length === 0) return [];
      const results: NotificationDelivery[] = notifications.map(
        (notification) =>
          reservedTestRecipientDelivery(notification.to) ?? { status: "not_configured" },
      );
      const deliverable = notifications.flatMap((notification, index) =>
        results[index]?.status === "not_configured" ? [{ notification, index }] : [],
      );
      if (deliverable.length === 0) return results;

      const messages = deliverable.map(({ notification }) => {
        const message = messageFor(notification);
        return {
          from: config.from,
          to: [notification.to],
          subject: message.subject,
          text: message.text,
          html: message.html,
        };
      });
      const result = await requestResend(
        config,
        fetchImpl,
        options,
        "emails/batch",
        batchIdempotencyKey(deliverable.map(({ notification }) => notification)),
        messages,
      );
      if (!result.ok) {
        console.warn("Resend batch request failed", {
          count: notifications.length,
          httpStatus: result.httpStatus,
          errorCode: result.errorCode,
          retryAfterMs: result.retryAfterMs,
          retryable: result.retryable,
        });
        for (const { index } of deliverable) results[index] = failedDelivery(result);
        return results;
      }
      const body = result.body as { data?: unknown } | null;
      const ids = Array.isArray(body?.data)
        ? body.data.map((item) => resendResponseSchema.safeParse(item).data?.id ?? null)
        : [];
      for (const [index, { index: originalIndex }] of deliverable.entries()) {
        results[originalIndex] = ids[index]
          ? { status: "sent", providerMessageId: ids[index] as string }
          : { status: "failed", retryable: true, errorCode: "invalid_response" };
      }
      return results;
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
  providerOptions: ResendProviderOptions = {},
): NotificationProvider {
  const config = resendConfigSchema.safeParse({
    apiKey: env.RESEND_API_KEY,
    from: env.RESEND_FROM_EMAIL ? formatSender(env.RESEND_FROM_EMAIL) : undefined,
  });
  return config.success
    ? resendNotificationProvider(config.data, fetchImpl, providerOptions)
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
