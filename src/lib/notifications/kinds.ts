import { z } from "zod";
import { DIVER_LOCALES, type DiverLocale, isDiverLocale, toDiverLocale } from "@/i18n/settings";
import { isValidCalendarDate } from "@/lib/calendar-date";
import { ALERTING_LEVELS, CEILING_UNITS, COST_PROVIDERS } from "@/lib/cost-guardrails";
import { COURSE_INQUIRY_EXPERIENCE } from "@/lib/course-inquiry";
import { DEMO_ROLE_IDS } from "@/lib/demo-roles";
import { REMINDER_ACTION_CODES } from "@/lib/readiness-summary";

/**
 * Every kind of notification DiveDay sends, as a discriminated union of zod
 * schemas — the contract between the code that decides to notify somebody and
 * the adapter that puts it on the wire.
 *
 * A kind is validated at the boundary (`notify` parses before sending), so a
 * caller cannot half-fill a message: a missing diver name or a malformed
 * address fails where it is built rather than arriving as a blank email. Adding
 * a kind means a schema here, a row in `notificationSchema`, a case in
 * `notificationIdempotencyKey`, and a body in `./email.ts` — the type checker
 * enforces the last two.
 */

const emailAddressSchema = z.email().max(200);

/**
 * A date with no instant in it — "2026-08-06". Refused unless it is a date that
 * actually exists, so a renderer downstream never has to decide what to print
 * for "2026-02-31". Formatted through UTC at the point of display
 * (`formatCalendarDate`), never through a shop's zone, which would shift the day.
 */
const calendarDateSchema = z.string().refine(isValidCalendarDate);

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
  /** Present for trip-issued links; omitted for an independent person waiver. */
  bookingId: z.uuid().optional(),
  shopId: z.uuid(),
  to: emailAddressSchema,
  locale: localeSchema,
  diverName: z.string().trim().min(1).max(120),
  shopName: z.string().trim().min(1).max(120),
  /** Present when the link was requested from a departure; omitted otherwise. */
  tripTitle: z.string().trim().min(1).max(200).optional(),
  completionUrl: z.url().max(2_000),
  expiresAt: z.date(),
  timezone: z.string().trim().min(1).max(100),
});

/**
 * **A replacement trip-prep link, asked for by the diver whose link died.**
 *
 * Its own kind rather than a reuse, on both available candidates.
 * `booking_confirmation` would tell somebody their seat was just booked days
 * after it was, and `trip_reminder_*` dedups once per booking per cadence
 * (`src/lib/reminders.ts`), so a rescue sent after that cadence had run would
 * be silently swallowed — the one failure this feature cannot have.
 *
 * See `notificationIdempotencyKey` below for how a rescue is keyed in the send
 * queue, and why per-booking is the right granularity (issue #850).
 */
const readinessLinkSchema = z.object({
  kind: z.literal("readiness_link"),
  bookingId: z.uuid(),
  shopId: z.uuid(),
  to: emailAddressSchema,
  locale: localeSchema,
  diverName: z.string().trim().min(1).max(120),
  shopName: z.string().trim().min(1).max(120),
  tripTitle: z.string().trim().min(1).max(200),
  readinessUrl: z.url().max(2_000),
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

const tripInvitationSchema = z.object({
  kind: z.literal("trip_invitation"),
  invitationId: z.uuid(),
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
//
// `unsubscribeUrl` is required, in the same shape as the two siblings above:
// this send goes to someone with no confirmed booking behind it, which is what
// makes it commercial rather than service messaging
// (ADR 20260814-checkout-recovery-is-commercial, H-09). Required rather than
// optional on purpose — an optional field is one a future caller forgets.
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
  unsubscribeUrl: z.url().max(2_000),
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
  pickupTime: z.string().trim().max(40).nullish(),
  hotelPickupLocation: z.string().trim().max(300).nullish(),
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

/**
 * "This one did not fill, so it is off." The message a diver gets when a
 * departure they booked is cancelled by the minimum-head-count sweep
 * (src/lib/minimum-seats.ts).
 *
 * Deliberately its own kind rather than a reuse of `trip_blowout`. A blow-out
 * is the weather deciding on the morning; this is a deadline the diver was
 * *told about before they paid*, and the message has to say so — "we needed 4
 * and had 2 by the moment we said we would decide" reads as a promise kept,
 * where the blow-out's wording would read as a shop that simply cancelled.
 *
 * Keyed on the trip, so a sweep that somehow ran twice sends once.
 */
const tripMinimumNotMetSchema = z.object({
  kind: z.literal("trip_minimum_not_met"),
  tripId: z.uuid(),
  bookingId: z.uuid(),
  shopId: z.uuid(),
  to: emailAddressSchema,
  locale: localeSchema,
  diverName: z.string().trim().min(1).max(120),
  shopName: z.string().trim().min(1).max(120),
  tripTitle: z.string().trim().min(1).max(200),
  startsAt: z.date(),
  timezone: z.string().trim().min(1).max(100),
  /** What the departure needed, and what it had when the call was made. */
  minimumBookings: z.number().int().min(1).max(60),
  bookedCount: z.number().int().min(0).max(60),
  /**
   * What happened to this seat's money, same codes as `trip_blowout`. Optional
   * only so a message queued before ADR 20260813-shop-cancellation-refunds-itself
   * still parses on retry; the sweep always states it.
   */
  paymentStory: z.enum(["none", "refunded", "refund_owed"]).optional(),
  /** Back to the shop's own schedule, to find another day. */
  scheduleUrl: z.url().max(2_000),
});

// The weather blow-out cascade message (docs ADR 20260804-blowout-cascade):
// what happened, the diver's money story as a code (the template picks the
// words), and the alternatives this diver actually qualifies for as links to
// the public booking pages. Carries a bookingId, so delivery is tracked per
// booking like every other trip message; `blowoutDiverId` is the cascade
// row's own id and keys idempotency, so a resumed cascade can never
// double-send one diver's message.
const tripBlowoutSchema = z.object({
  kind: z.literal("trip_blowout"),
  blowoutDiverId: z.uuid(),
  bookingId: z.uuid(),
  shopId: z.uuid(),
  to: emailAddressSchema,
  locale: localeSchema,
  diverName: z.string().trim().min(1).max(120),
  shopName: z.string().trim().min(1).max(120),
  tripTitle: z.string().trim().min(1).max(200),
  startsAt: z.date(),
  timezone: z.string().trim().min(1).max(100),
  /**
   * The diver's money position, as data. Never an amount.
   *
   * `refunded` — the capture has been reversed to their card, which is what a
   * shop-called cancellation now does by itself
   * (ADR 20260813-shop-cancellation-refunds-itself). `refund_owed` — money was
   * captured and could not be reversed from here (counter payment,
   * disconnected account, Stripe refusal), so the shop owes it by hand.
   * `none` — nothing is owed on this seat.
   *
   * `paid`/`deposit` are the pre-refund codes and stay parseable: a message
   * queued for retry before that change still carries one.
   */
  paymentStory: z.enum(["none", "deposit", "paid", "refunded", "refund_owed"]),
  /** Soonest-first, already admission-filtered for this diver (src/lib/blowout.ts). */
  alternatives: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(200),
        startsAt: z.date(),
        bookingUrl: z.url().max(2_000),
      }),
    )
    .max(3),
  /** The shop's public schedule — the graceful landing when no alternative qualifies. */
  scheduleUrl: z.url().max(2_000),
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

/**
 * The link that proves a shop controls the front-desk address it typed into
 * settings, before that address becomes Reply-To on diver mail (issue #1288).
 * Goes to the shop, in the shop's own language, branded as the shop -- it is
 * the shop's own address being vouched for.
 */
const contactEmailConfirmationSchema = z.object({
  kind: z.literal("contact_email_confirmation"),
  shopId: z.uuid(),
  tokenId: z.uuid(),
  to: emailAddressSchema,
  locale: localeSchema,
  shopName: z.string().trim().min(1).max(120),
  confirmUrl: z.url().max(2_000),
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

/**
 * The other half of the funnel `new_account_alert` closes: somebody tried the
 * live demo (docs ADR 20260805-demo-try-alerts). Internal, English, founder-only
 * — same shape of signal, same mailbox, no locale.
 *
 * **Carries no identity, by construction.** The visitor is anonymous — no
 * account, no session, nothing they typed — so the only fields here are the
 * throwaway shop the demo minted, which role's view they picked, and the
 * marketing tag that sent them. No IP, no user agent, no referrer beyond the
 * closed `FunnelSource` registry. `shopId` is the minted demo's own row, which
 * `queueRetry` needs for its non-null FK and the 7-day reaper already deletes
 * alongside every other `notification_send_queue` row it owns.
 */
const demoStartedAlertSchema = z.object({
  kind: z.literal("demo_started_alert"),
  shopId: z.uuid(),
  to: emailAddressSchema,
  /** The minted demo shop's slug — unique per entry, which is what keys the send. */
  shopSlug: z.string().trim().min(1).max(120),
  role: z.enum(DEMO_ROLE_IDS),
  /** A `FunnelSource` already clamped to the registry by `eventSource`, or "unknown". */
  source: z.string().trim().min(1).max(60),
});

/**
 * A provider ceiling this deployment is approaching or past (docs ADR
 * 20260806-provider-usage-guardrails). The third founder-only alert, on the
 * same SES pipeline and in the same inbox as the two above — English, no
 * locale, nobody to address.
 *
 * **The only kind with no `shopId`, and the reason is structural rather than
 * an oversight.** Every other notification is about one tenant's booking,
 * diver, or account; this one is about the platform's Vercel bill. There is no
 * shop it belongs to, so it also never rides `sendNotification` — that path
 * enqueues a retryable failure into `notification_send_queue`, whose `shop_id`
 * is a non-null FK. This kind goes through `notify()` instead: one attempt, no
 * durable retry, and a failed send shows up as the cron's own non-ok Sentry
 * check-in rather than as a queued row nobody owns. A cost warning that is a
 * day late is not the failure worth building a tenant-scoped retry around.
 *
 * Everything here is a number or a machine key. The words are chosen in
 * `./email.ts`, and every value is escaped there anyway.
 */
const usageCeilingAlertSchema = z.object({
  kind: z.literal("usage_ceiling_alert"),
  to: emailAddressSchema,
  /** `CostCeiling.id` from `@/lib/cost-guardrails` — also what keys the alert. */
  ceilingId: z.string().trim().min(1).max(60),
  provider: z.enum(COST_PROVIDERS),
  metric: z.string().trim().min(1).max(60),
  unit: z.enum(CEILING_UNITS),
  level: z.enum(ALERTING_LEVELS),
  /** What the period the sample belongs to is called, e.g. `2026-08`. */
  periodKey: z.string().trim().min(1).max(20),
  value: z.number().finite().nonnegative(),
  ceiling: z.number().finite().positive(),
  /** Whole percent of the ceiling, pre-rounded so the body does no arithmetic. */
  percent: z.number().int().min(0),
  /** What the provider does at this ceiling: bills, suspends, or silently drops. */
  overflow: z.enum(["bills_overage", "suspends", "drops"]),
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
  experience: z.enum(COURSE_INQUIRY_EXPERIENCE).optional(),
  timing: z.string().trim().min(1).max(200).optional(),
  // The dates the diver actually named, which is the fact that decides whether
  // a boat goes up — carried here as calendar dates rather than folded into
  // `timing`'s free text, so the mail can render them in the shop's own locale.
  preferredDate: calendarDateSchema.optional(),
  alternateDate: calendarDateSchema.optional(),
  dateFlexible: z.boolean().optional(),
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

/**
 * Who a reply reaches and where the sender can be written to — the two
 * facts a receiving mailbox expects of a legitimate sender and that no kind
 * above carries on its own (ADR 20260902-sender-standards-for-ses).
 *
 * Both optional, and resolved from the shop row at send time by
 * `src/db/notifications.ts` rather than threaded through every composer:
 * every DiveDay email leaves as `noreply@ses.dive.day` but greets as the
 * shop, so a diver who hits reply should reach the shop's front desk
 * (`shops.contact_email`), and a commercial send — one carrying an
 * `unsubscribeUrl` — has to name the sender's postal address (CAN-SPAM
 * 16 CFR 316.2). A shop with neither on file sends without them; nothing
 * here guesses a street or an inbox on a shop's behalf.
 */
export const notificationSenderSchema = z.object({
  replyTo: emailAddressSchema.optional(),
  /** One line, already in postal order (`shopAddressLines(...).join(", ")`). */
  postalAddress: z.string().trim().min(1).max(300).optional(),
});

export type NotificationSender = z.infer<typeof notificationSenderSchema>;

export const notificationSchema = z
  .discriminatedUnion("kind", [
    bookingConfirmationSchema,
    waiverRequestSchema,
    readinessLinkSchema,
    waitlistInviteSchema,
    tripInvitationSchema,
    tripReminder7dSchema,
    tripReminder24hSchema,
    tripRecapSchema,
    tripConditionsHoldSchema,
    tripMinimumNotMetSchema,
    tripBlowoutSchema,
    welcomeSchema,
    emailVerificationSchema,
    contactEmailConfirmationSchema,
    passwordResetRequestSchema,
    passwordChangedSchema,
    staffInviteSchema,
    checkoutRecoverySchema,
    lastMinuteDealSchema,
    newAccountAlertSchema,
    demoStartedAlertSchema,
    usageCeilingAlertSchema,
    courseInquirySchema,
  ])
  .and(z.object({ sender: notificationSenderSchema.optional() }));

export type Notification = z.infer<typeof notificationSchema>;

export function notificationIdempotencyKey(notification: Notification): string {
  switch (notification.kind) {
    case "booking_confirmation":
      return notification.confirmedAt
        ? `booking-confirmation/${notification.bookingId}/${notification.confirmedAt.toISOString()}`
        : `booking-confirmation/${notification.bookingId}`;
    case "waiver_request":
      return `waiver-request/${notification.waiverRecordId}`;
    // **Per booking, in effect** — and the expiry is in it for honesty rather
    // than variety. `capabilityExpiryFor` is `tripEndsAt + 30d` for any booking
    // inside its useful window, independent of `now`, so this key does *not*
    // vary between two rescues on the same seat; an earlier version of this
    // comment claimed it did (`security-reviewer`, issue #850).
    //
    // That is fine here, and only here: this key is the
    // `notification_send_queue` conflict target and nothing else, so it can
    // never suppress a live send — the most it costs is that two rescues which
    // both fail *retryably* leave one queued retry rather than two, which is
    // the correct number for one diver waiting on one link.
    case "readiness_link":
      return `readiness-link/${notification.bookingId}/${notification.expiresAt.toISOString()}`;
    // Keyed by invite timestamp so a genuine re-invite (a seat opens twice) is a
    // fresh send, while a double-submit of the same tap still dedups at the
    // notification_send_queue level.
    case "trip_invitation":
      return `trip-invitation/${notification.invitationId}/${notification.invitedAt.toISOString()}`;
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
    // One per booking on the departure that did not fill — the sweep cancels a
    // trip exactly once, so the booking alone keys it.
    case "trip_minimum_not_met":
      return `trip-minimum-not-met/${notification.bookingId}`;
    // One blow-out message per cascade row, ever — the row id is unique per
    // (blow-out, booking), so a resumed cascade or a racing double-tap
    // converges on the same send (docs ADR 20260804-blowout-cascade).
    case "trip_blowout":
      return `trip-blowout/${notification.blowoutDiverId}`;
    // One welcome ever, per account.
    case "welcome":
      return `welcome/${notification.userAccountId}`;
    // Keyed by the token row's own id, not the raw token, so a retried send
    // never doubles up without this idempotency key ever carrying the bearer
    // secret itself.
    case "email_verification":
      return `email-verification/${notification.tokenId}`;
    // One send per minted link; a resend mints a fresh token and is its own send.
    case "contact_email_confirmation":
      return `contact-email-confirmation/${notification.tokenId}`;
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
    // One alert per demo entry, ever. Every entry mints its own shop under a
    // freshly-generated identity (`createDemoShop`), so the slug *is* the
    // entry's identity — no timestamp needed, and a double-submitted CTA that
    // somehow reached the same shop converges on one send rather than two.
    case "demo_started_alert":
      return `demo-started-alert/${notification.shopSlug}`;
    // One alert per ceiling per period per level — the same key
    // `ceilingAlertKey` computes, so whatever suppresses a repeat send and
    // whatever would dedup a queued retry agree on what "the same alert" means.
    // Level is in the key deliberately: crossing from warn to over is news.
    case "usage_ceiling_alert":
      return `usage-ceiling/${notification.ceilingId}/${notification.periodKey}/${notification.level}`;
    // One notification per submitted inquiry row.
    case "course_inquiry":
      return `course-inquiry/${notification.courseInquiryId}`;
  }
}
