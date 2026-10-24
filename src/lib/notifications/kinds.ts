import { z } from "zod";
import { DIVER_LOCALES, type DiverLocale, isDiverLocale, toDiverLocale } from "@/i18n/settings";
import { isValidCalendarDate } from "@/lib/calendar-date";
import { CERTIFICATION_AGENCIES } from "@/lib/certification-options";
import { ALERTING_LEVELS, CEILING_UNITS, COST_PROVIDERS } from "@/lib/cost-guardrails";
import { COURSE_INQUIRY_EXPERIENCE } from "@/lib/course-inquiry";
import {
  isLearningMaterialLink,
  LEARNING_MATERIAL_LIMITS,
  MAX_LEARNING_MATERIALS,
} from "@/lib/courses";
import { CREW_NOTICE_CHANGES, CREW_TRIP_ROLES } from "@/lib/crew-notices";
import { DEMO_ROLE_IDS } from "@/lib/demo-roles";
import { DEPARTURE_NOTE_MAX, departureNoteProblem } from "@/lib/departure-notes";
import { DESK_PAYMENTS } from "@/lib/desk-payment";
import { DECLARABLE_CERTIFICATION_LEVELS } from "@/lib/dive-declaration";
import { SHOP_MILESTONES } from "@/lib/founder-metrics";
import { GEAR_KIND_ORDER, GEAR_SERVICE_KINDS } from "@/lib/gear";
import { REPLY_BODY_MAX_LENGTH } from "@/lib/inbox";
import { MEETING_POINT_LIMITS } from "@/lib/meeting-point";
import { getMigrationGuide } from "@/lib/migration-guides";
import { DIVER_EMAIL_MAX } from "@/lib/person-fields";
import {
  isSingleLineText,
  SETUP_CURRENT_SYSTEMS,
  SETUP_PHONE_MAX,
  SETUP_TEXT_MAX,
} from "@/lib/setup-requests";
import { MAX_PUBLIC_PARTY_SIZE } from "@/lib/trips";
import { EMERGENCY_READERS_LISTED, EMERGENCY_READS_LISTED } from "@/lib/weekly-digest";

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

// 320, matching `DIVER_EMAIL_MAX` and therefore every diver-facing form: 64
// local + @ + 255 domain, the RFC 5321 practical limit. The old 200 was an
// arbitrary tighter cap, and it made a real address the app had already
// accepted and stored unsendable — not only on a staff reply but on that
// diver's booking confirmations and waiver links too.
const emailAddressSchema = z.email().max(DIVER_EMAIL_MAX);

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
 * an `operator_alert`, which lands in the founder's own inbox rather than a
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
 * brief addressed to the crew, a staff invite, or an interest notification landing
 * in the shop's own inbox are all about a diver but not *to* one — those stay
 * on the shop's locale, so they pass `null` here or don't call this at all.
 */
export function recipientLocale(
  personLocale: string | null | undefined,
  shopDefaultLocale: string | null | undefined,
): DiverLocale {
  return isDiverLocale(personLocale) ? personLocale : toDiverLocale(shopDefaultLocale);
}

/**
 * A course's learning materials as a message carries them (ADR
 * 20261008-course-learning-materials). The link is re-checked at the boundary
 * — `https:` only — because the renderer turns it into an `href`.
 */
const learningMaterialsSchema = z
  .array(
    z.object({
      name: z.string().trim().min(1).max(LEARNING_MATERIAL_LIMITS.name),
      url: z.string().max(LEARNING_MATERIAL_LIMITS.url).refine(isLearningMaterialLink).optional(),
      note: z.string().trim().min(1).max(LEARNING_MATERIAL_LIMITS.note).optional(),
    }),
  )
  .max(MAX_LEARNING_MATERIALS)
  .optional();

/**
 * Where to go for the departure (ux review 2026-10-11, items 4 and 27), as
 * `meetingPointOf` reads it and `meetingPointForMessage` clips it. The map
 * link is built by the renderer from `mapQuery` (`openMapsUrl`), so no
 * caller can put an arbitrary `href` in a diver's inbox through this field.
 */
const meetingPointSchema = z.object({
  label: z.string().trim().min(1).max(MEETING_POINT_LIMITS.label),
  address: z.string().trim().min(1).max(MEETING_POINT_LIMITS.address).nullish(),
  landmark: z.string().trim().min(1).max(MEETING_POINT_LIMITS.landmark).nullish(),
  parking: z.string().trim().min(1).max(MEETING_POINT_LIMITS.parking).nullish(),
  mapQuery: z.string().trim().min(1).max(MEETING_POINT_LIMITS.mapQuery).nullish(),
});

const centsSchema = z.number().int().min(1).max(100_000_000);

/**
 * This seat's money as the booking form showed it (`seatMoneyTerms`), or the
 * party's when the lead holds several seats (`partyMoneyTerms`, fourth UX
 * review item 5): a code and amounts in minor units, never a sentence.
 * `seats` is how many priced seats the figure covers; absent means one.
 */
const seatsSchema = z.number().int().min(1).max(100).optional();
const seatMoneySchema = z.discriminatedUnion("due", [
  z.object({
    due: z.literal("at_shop"),
    amountCents: centsSchema,
    currency: z.string().length(3),
    seats: seatsSchema,
    /** How the shop takes money at the desk (fifth-loop ideas, item 21); absent says nothing. */
    deskPayment: z.enum(DESK_PAYMENTS).optional(),
  }),
  z.object({
    due: z.literal("online"),
    amountCents: centsSchema,
    currency: z.string().length(3),
    seats: seatsSchema,
  }),
  z.object({
    due: z.literal("deposit"),
    depositCents: centsSchema,
    balanceCents: centsSchema,
    currency: z.string().length(3),
    seats: seatsSchema,
  }),
]);

/**
 * The longest trip title a notification carries. `trips.title` is unbounded, so
 * a long stored title is clipped to this with {@link notificationTripTitle}
 * before it is measured: a long title must shorten the subject, never fail the
 * send (security review 20261014, issue #2603).
 */
export const NOTIFICATION_TRIP_TITLE_MAX = 200;

/**
 * A trip title that fits {@link NOTIFICATION_TRIP_TITLE_MAX} as zod measures
 * it (UTF-16 units), ending in "…" when cut, and never splitting a surrogate
 * pair (an emoji in a title stays whole or goes). A title that already fits
 * comes back unchanged apart from the trim.
 */
export function notificationTripTitle(title: string): string {
  const trimmed = title.trim();
  if (trimmed.length <= NOTIFICATION_TRIP_TITLE_MAX) return trimmed;
  let cut = trimmed.slice(0, NOTIFICATION_TRIP_TITLE_MAX - 1);
  if (/[\uD800-\uDBFF]$/.test(cut)) cut = cut.slice(0, -1);
  return `${cut.trimEnd()}…`;
}

/**
 * **The one `tripTitle` every kind shares.** It shortens rather than rejects,
 * so no writer has to remember to clip a stored title first, and a trip with a
 * long name (a multi-site charter) still sends its mail, its reminder and its
 * roll-call alert. `notificationSchema.parse` is the one door a notification
 * passes before it is sent or queued, so the shortened value is what is sent.
 */
const tripTitleSchema = z.string().trim().min(1).transform(notificationTripTitle);

const bookingConfirmationSchema = z.object({
  kind: z.literal("booking_confirmation"),
  bookingId: z.uuid(),
  shopId: z.uuid(),
  to: emailAddressSchema,
  locale: localeSchema,
  diverName: z.string().trim().min(1).max(120),
  shopName: z.string().trim().min(1).max(120),
  tripTitle: tripTitleSchema,
  startsAt: z.date(),
  endsAt: z.date(),
  timezone: z.string().trim().min(1).max(100),
  dockCallMinutes: z.number().int().min(5).max(180).optional(),
  readinessUrl: z.url().max(2_000).optional(),
  /**
   * The diver's waiver link, carried as the confirmation's first step so one
   * booking is one email (UX review 2026-10-11, item 7). Present only when the
   * trip needs a waiver this diver has not signed; `issueJoinWaiverLink`
   * decides. A diver whose signature still covers the trip gets no waiver line.
   */
  waiverUrl: z.url().max(2_000).optional(),
  /** When `waiverUrl` stops working; required with it so the line can say so. */
  waiverExpiresAt: z.date().optional(),
  packingList: z.array(z.string().trim().min(1).max(100)).max(12).optional(),
  learningMaterials: learningMaterialsSchema,
  meetingPoint: meetingPointSchema.optional(),
  /**
   * The departure's public `.ics` (`publicTripCalendarPath`): a page anybody
   * may open, so a link to it carries no capability (ux review 2026-10-11,
   * item 5).
   */
  calendarUrl: z.url().max(2_000).optional(),
  money: seatMoneySchema.optional(),
  /**
   * What the card checkout this booking leads settled for the whole party,
   * as Stripe reported it (`settledPartyPayment`, #2447). Display only, and
   * absent unless Stripe's own figure exists.
   */
  partyPaid: z
    .object({
      amountCents: centsSchema,
      currency: z.string().length(3),
      seats: z.number().int().min(1).max(100),
    })
    .optional(),
  /** When free cancellation closes (`cancellationDeadline`); absent when the trip states no window. */
  freeCancellationUntil: z.date().optional(),
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
  tripTitle: tripTitleSchema.optional(),
  completionUrl: z.url().max(2_000),
  expiresAt: z.date(),
  timezone: z.string().trim().min(1).max(100),
});

/**
 * **The copy a co-signing parent gets of the release they just put their name
 * to** (issue #1453, owner decision 2026-09-10).
 *
 * The guardian's address was required and nothing ever read it: a parent
 * signed a liability release for their child, handed over an address, and got
 * nothing, while DiveDay stored a third party's personal data with no reader.
 * This is that reader.
 *
 * Three shapes here are deliberate and a future kind should not copy them
 * without meaning to:
 *
 * - **No `bookingId`.** A guardian is a party to one document, not a customer
 *   and not a per-booking delivery channel, so no `notification_deliveries`
 *   row is written (`sendAndRecordNotification` writes one only for a kind
 *   that carries a booking). That is also why the `notification_kind` pg enum
 *   needs no new value and this ships with no migration.
 * - **No URL of any kind in the payload.** The issue refuses a bearer link to
 *   a third party outright: the release is already signed by the time this
 *   sends, so a second capability URL would be a security surface with nothing
 *   behind it. The renderer takes no `completionUrl` because there is none to
 *   take.
 * - **No address for the minor, and the payload is the whole reason.** The
 *   guardian is the recipient; the minor is the person the message is *about*,
 *   by name, at a named shop, on a named day. A first cut carried `diverEmail`
 *   so `notificationSubjectEmail` could lift it into a column and legal erasure
 *   could sweep a queued copy — the hole issue #1298 closed for
 *   `interest_received`. It only ever half-worked: a twelve-year-old signing on a
 *   shop tablet has no address to lift, and the row stayed unreachable. So this
 *   kind is not queued at all (`notificationIsQueueable`), and with no row to
 *   sweep there is no handle to carry. What is left is a minor's *name*, in a
 *   message that is sent once and retained nowhere.
 */
const guardianReleaseCopySchema = z.object({
  kind: z.literal("guardian_release_copy"),
  waiverRecordId: z.uuid(),
  shopId: z.uuid(),
  to: emailAddressSchema,
  locale: localeSchema,
  guardianName: z.string().trim().min(1).max(120),
  diverName: z.string().trim().min(1).max(120),
  shopName: z.string().trim().min(1).max(120),
  releaseTitle: z.string().trim().min(1).max(200),
  releaseVersion: z.number().int(),
  signedAt: z.date(),
  timezone: z.string().trim().min(1).max(100),
  /**
   * Whether the release is parked in `medical_review` — a physician still owes
   * the shop an answer before this diver may dive.
   *
   * It changes one sentence and it is the reason this field exists. Without it
   * the copy told a parent "there is nothing to do" about the one hold only
   * they can clear: a `dive-domain-expert` pass put a 13-year-old's asthma
   * answer through it and had the family arrive at the dock two days later
   * expecting to dive.
   */
  medicalReviewPending: z.boolean().optional(),
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
/**
 * The door remembers who opened it (ADR 20260906-before-you-ask, decision 3;
 * H-68 b): one link to a booking page that arrives with the diver's standing
 * facts folded, sent to an address typed cold into that form when it matches
 * a diver on file. Per booking like the readiness link, so the delivery row
 * is what keeps it to one an hour, and nothing on the page says it went.
 */
const bookingHandoffSchema = z.object({
  kind: z.literal("booking_handoff"),
  bookingId: z.uuid(),
  shopId: z.uuid(),
  to: emailAddressSchema,
  locale: localeSchema,
  diverName: z.string().trim().min(1).max(120),
  shopName: z.string().trim().min(1).max(120),
  tripTitle: tripTitleSchema,
  bookingUrl: z.url().max(2_000),
  expiresAt: z.date(),
  timezone: z.string().trim().min(1).max(100),
});

const readinessLinkSchema = z.object({
  kind: z.literal("readiness_link"),
  bookingId: z.uuid(),
  shopId: z.uuid(),
  to: emailAddressSchema,
  locale: localeSchema,
  diverName: z.string().trim().min(1).max(120),
  shopName: z.string().trim().min(1).max(120),
  tripTitle: tripTitleSchema,
  readinessUrl: z.url().max(2_000),
  expiresAt: z.date(),
  timezone: z.string().trim().min(1).max(100),
  /**
   * Why the link is going out. Absent is the rescue of an expired link, which
   * every sender before course forms meant; `course_forms` is the waiver send
   * finding the release signed and the course's forms still owed (ADR
   * 20261008-course-forms), so the words say that instead of "expired".
   * `other_day` and `log_entry` are a diver asking, from one booking's page,
   * for the link to another of their days with the shop (H-132, ADR
   * 20261016-fresh-link-per-booking-row): an upcoming day's trip prep, or a
   * past day's recap, whose URL rides in `readinessUrl`.
   */
  purpose: z.enum(["course_forms", "other_day", "log_entry"]).optional(),
});

/**
 * **An offer of a seat on one departure** (ADR 20261017-one-interest-with-a-scope),
 * to a diver who is on the shop's records. Two kinds because the mail class
 * (`offerMailClass`, src/lib/interests.ts) decides whether the message may carry a
 * way out, and the schema is what makes that structural: an optional
 * `unsubscribeUrl` is one a future caller forgets.
 *
 * **`seat_offer` is service mail**: the diver asked for this (H-96's test;
 * Aaron, H-145 D-2 option b, 2026-10-17): a seat on the departure they joined
 * the wait list for, or the reply to their own date request. It reaches them
 * whatever their courtesy-email setting and carries no unsubscribe (issue
 * #1953).
 *
 * Both keys are `seat-offer/<departure interest>/<offeredAt>`, so a deliberate
 * re-offer is a new send and a double tap is not.
 */
const seatOfferBase = z.object({
  /** The departure interest the offer is for. */
  interestId: z.uuid(),
  shopId: z.uuid(),
  to: emailAddressSchema,
  locale: localeSchema,
  diverName: z.string().trim().min(1).max(120),
  shopName: z.string().trim().min(1).max(120),
  tripTitle: tripTitleSchema,
  startsAt: z.date(),
  endsAt: z.date(),
  timezone: z.string().trim().min(1).max(100),
  bookingUrl: z.url().max(2_000),
  /** The offer timestamp, so each deliberate re-offer is a distinct send. */
  offeredAt: z.date(),
  /**
   * The Features switch this offer is the send of, when it is one: the wait
   * list's own offer, or a past-diver suggestion's invite. The retry drain
   * refuses a queued one while that switch is off (ADR
   * 20261005-optional-shop-features). Absent, a staffer reached out to this
   * diver themselves and no switch governs it.
   */
  governedBy: z.enum(["waitlist", "pastDiverInvites"]).optional(),
});

const seatOfferSchema = seatOfferBase.extend({
  kind: z.literal("seat_offer"),
  /** What the diver asked for: this departure's wait list, or a date. Picks the words. */
  answers: z.enum(["wait_list", "date_request"]),
  /** The waiting party's size (fourth review, item 34). */
  partySize: z.number().int().min(1).max(MAX_PUBLIC_PARTY_SIZE).optional(),
});

/**
 * **Commercial mail** (Aaron, 2026-10-06, issue #1953): the shop deciding to
 * mail someone about a seat it is selling is what 16 CFR 316.2 describes, so it
 * carries the one-click courtesy unsubscribe, and through it the postal footer
 * (`withPostalFooter`, render.ts), and is not sent to a person whose
 * `courtesyEmailOptOutAt` is set.
 */
const seatOfferCommercialSchema = seatOfferBase.extend({
  kind: z.literal("seat_offer_commercial"),
  /** Who asked: the words say "a seat opened" to a waiting diver and "the shop is offering" to the rest. */
  askedBy: z.enum(["diver", "shop"]),
  unsubscribeUrl: z.url().max(2_000),
  /** The waiting party's size (fourth review, item 34). */
  partySize: z.number().int().min(1).max(MAX_PUBLIC_PARTY_SIZE).optional(),
  /** The run's date that filled, for an offer the nightly roll sent (item 31). */
  sailedStartsAt: z.date().optional(),
  /**
   * On a course session, the course's own prerequisite note in the shop's
   * words, so an offer to Rescue or Divemaster never implies the diver already
   * qualifies (dive-domain review N3).
   */
  prerequisiteNote: z.string().trim().min(1).max(2_000).optional(),
  /**
   * **The deal this offer carries** (ADR 20260727-last-minute-fill-promos; the
   * deal is an offer with a discount, ADR 20261017-one-interest-with-a-scope). Set
   * together: the code the diver types at booking, one of a percent or a fixed
   * amount (in minor units, with `currency`), and when the code stops working
   * (pinned to the departure). Absent, this is an ordinary offer.
   */
  code: z.string().trim().min(1).max(40).optional(),
  discountPercent: z.number().int().min(1).max(100).optional(),
  discountAmountCents: z.number().int().positive().optional(),
  currency: z.string().trim().length(3).optional(),
  expiresAt: z.date().optional(),
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
  tripTitle: tripTitleSchema,
  startsAt: z.date(),
  endsAt: z.date(),
  timezone: z.string().trim().min(1).max(100),
  checkoutUrl: z.url().max(2_000),
  unsubscribeUrl: z.url().max(2_000),
});

/**
 * **A reminder is a state, one sentence and a link** (issue #2660): the
 * thread page holds everything else, so nothing but the facts that sentence
 * and that link are made of travels here. `open` is how many things the diver
 * still has to finish (their checklist, the medical review, a course's
 * unfinished materials), counted by the sender from the same engine the
 * thread reads.
 */
const tripReminderFields = {
  bookingId: z.uuid(),
  shopId: z.uuid(),
  to: emailAddressSchema,
  locale: localeSchema,
  shopName: z.string().trim().min(1).max(120),
  tripTitle: tripTitleSchema,
  startsAt: z.date(),
  timezone: z.string().trim().min(1).max(100),
  /** What the diver still has to finish, not counting the medical review (its own flag). */
  open: z.number().int().min(0).max(40),
  /** The shop's dock call: the 24-hour sentence names the time to be at the dock, not the departure. */
  dockCallMinutes: z.number().int().min(5).max(180).optional(),
  /** A medical answer waits on a doctor's sign-off; the sentence says so in place of the count. */
  medicalReview: z.boolean().optional(),
  readinessUrl: z.url().max(2_000).optional(),
  /**
   * Whether this reminder may end with the reply line (ADR
   * 20260909-reply-keywords). A fact about the channel — inbound mail needs a
   * receiving domain configured — so the sender decides it and the renderer
   * only obeys.
   */
  replyKeywords: z.boolean().optional(),
  /** A course session: the sentence says it starts, where a fun dive sails. */
  courseSession: z.boolean().optional(),
  /**
   * The fly-safe wait in hours, set only on the night-before reminder for a
   * diver whose last boat with the shop this is (`readReminderFlySafeHours`).
   * The rule in hours, never a clock time (H-150): a late boat moves the time.
   */
  flySafeHours: z.number().int().min(12).max(48).optional(),
};

// One literal per cadence so the delivery row's `kind` is the cadence itself,
// which is what dedups a reminder to once-per-booking (src/lib/reminders.ts).
const tripReminder7dSchema = z.object({
  kind: z.literal("trip_reminder_7d"),
  ...tripReminderFields,
});
const tripReminder24hSchema = z.object({
  kind: z.literal("trip_reminder_24h"),
  ...tripReminderFields,
});

/**
 * **"Your departure moved."** (ux review 2026-10-11, item 1.) The board's move
 * and the trip page's retime both bumped `trips.revision` so subscribed
 * calendars re-alerted, and told no booked diver — "or a diver stands at the
 * dock at the old time", in the code's own words. One message per booked seat,
 * sent by the diver's usual channel after the same eight-second hold every
 * other staff send takes (`held_sends`, kind `trip_rescheduled`).
 *
 * The old time and the new, the meeting point **only when it moved**, and the
 * diver's own trip-prep link. `previousStartsAt` equal to `startsAt` is a
 * notice that only the meeting point moved (#2443): no "It was", and the
 * subject names the place. Addressed to the address on the
 * booking's own person record and nobody else (`src/db/trip-rescheduled.ts`).
 *
 * `revision` is the trip's `revision` after the move, and keys the send: a
 * departure moved twice is news twice, and a retry of one move is one email.
 */
const tripRescheduledSchema = z.object({
  kind: z.literal("trip_rescheduled"),
  bookingId: z.uuid(),
  shopId: z.uuid(),
  to: emailAddressSchema,
  locale: localeSchema,
  diverName: z.string().trim().min(1).max(120),
  shopName: z.string().trim().min(1).max(120),
  tripTitle: tripTitleSchema,
  previousStartsAt: z.date(),
  startsAt: z.date(),
  endsAt: z.date(),
  timezone: z.string().trim().min(1).max(100),
  dockCallMinutes: z.number().int().min(5).max(180).optional(),
  revision: z.number().int().min(0),
  meetingPoint: meetingPointSchema.optional(),
  readinessUrl: z.url().max(2_000).optional(),
  /**
   * Set when the seat moved to another departure rather than the departure
   * moving (ADR 20261013-staff-move-a-seat). It keys the send instead of the
   * revision, which two departures can share.
   */
  seatMovedAt: z.date().optional(),
});

const tripRecapSchema = z.object({
  kind: z.literal("trip_recap"),
  bookingId: z.uuid(),
  shopId: z.uuid(),
  to: emailAddressSchema,
  locale: localeSchema,
  shopName: z.string().trim().min(1).max(120),
  tripTitle: tripTitleSchema,
  startsAt: z.date(),
  timezone: z.string().trim().min(1).max(100),
  /**
   * When the diver may fly (`src/lib/fly-safe.ts`, issue #1425): the instant,
   * the hours that produced it, and whether the clock started at the last
   * recorded exit or the buffered return. Absent when nothing on the
   * record could honestly say, and then the email says nothing about flying.
   *
   * `reason` is not a detail the email prints — it picks *which* sentence the
   * diver reads, and two of the routes state their reason. This email carries
   * no dive record at all, so nothing in it could stand in for one.
   */
  flySafe: z
    .object({
      from: z.date(),
      hours: z.number().int().min(1).max(72),
      basis: z.enum(["single", "repetitive"]),
      reason: z.enum(["one_dive", "dives_recorded", "dives_planned", "earlier_day"]),
      anchor: z.enum(["last_dive", "scheduled_return"]),
    })
    .optional(),
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
  tripTitle: tripTitleSchema,
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
  tripTitle: tripTitleSchema,
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
  tripTitle: tripTitleSchema,
  startsAt: z.date(),
  timezone: z.string().trim().min(1).max(100),
  /**
   * Why the shop called it off: the weather, or a repeating trip whose upcoming
   * dates the shop cancelled together (`run_ended`). Optional so a message
   * queued before the cause existed still parses on retry, and reads as the
   * weather it was.
   */
  cause: z.enum(["weather", "run_ended"]).optional(),
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

/**
 * **"Your booking is canceled."** One seat, canceled by the diver from their
 * trip-prep link or by the shop from the roster, and what happened to the
 * money, so the diver never has to ask whether a refund is coming.
 *
 * Not the blow-out and not the minimum-head-count sweep: those cancel the
 * whole departure and carry their own message. Keyed on the booking, since a
 * booking is canceled once.
 *
 * The money is a code plus, for a refund, the amount actually reversed —
 * never a figure the template has to work out.
 *
 * - `refunded` — Stripe reversed `amountCents` to the diver's card.
 * - `forfeit` — the shop's cancellation window had closed; nothing comes back.
 * - `shop_will_follow_up` — money was captured and DiveDay could not settle
 *   it here (no window on the trip, a counter payment, a refund that failed or
 *   is still in flight, a crew member without refund permission).
 * - `none` — nothing was captured, so the message says nothing about money.
 */
const bookingCancelledSchema = z.object({
  kind: z.literal("booking_cancelled"),
  bookingId: z.uuid(),
  shopId: z.uuid(),
  to: emailAddressSchema,
  locale: localeSchema,
  diverName: z.string().trim().min(1).max(120),
  shopName: z.string().trim().min(1).max(120),
  tripTitle: tripTitleSchema,
  startsAt: z.date(),
  timezone: z.string().trim().min(1).max(100),
  cancelledBy: z.enum(["diver", "shop"]),
  /** When it was canceled; keys the send, so a seat rebooked and canceled again is told again. */
  cancelledAt: z.date(),
  money: z.discriminatedUnion("story", [
    z.object({ story: z.literal("none") }),
    z.object({ story: z.literal("forfeit") }),
    z.object({ story: z.literal("shop_will_follow_up") }),
    z.object({
      story: z.literal("refunded"),
      amountCents: z.number().int().min(1).max(100_000_000),
      currency: z.string().trim().length(3),
    }),
  ]),
  /**
   * A party lead's cancel: how many of the seats they booked went with it and
   * how many stayed booked (already claimed, or checked in). Counts only; the
   * lead's own page names the seats. Absent when there was no party.
   */
  party: z
    .object({
      cancelled: z.number().int().min(0).max(1_000),
      stayed: z.number().int().min(0).max(1_000),
    })
    .optional(),
  /** Back to the shop's own schedule, to find another day. */
  scheduleUrl: z.url().max(2_000),
});

// Account-lifecycle mail (20260725-account-lifecycle-emails): no bookingId,
// so these are structurally excluded from TrackedNotification
// (src/db/notifications.ts) exactly like seat_offer_commercial already is —
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

/**
 * **One kind for "confirm this address"**, whoever the address belongs to.
 * `purpose` says whose: `account` is an owner proving the address on their
 * login (plain DiveDay, greeted by name); `shop_contact` is the front desk
 * proving the address that becomes Reply-To on diver mail (issue #1288);
 * `shore_alert` is the shore contact agreeing to hear roll-call alerts (H-118).
 * The last two go to the shop, in the shop's language, branded as the shop only for `shore_alert`; `shop_contact` goes out as plain DiveDay (`shop-voice.ts`).
 * The fields are the same across all three; only the name the copy uses
 * differs, and the schema holds each purpose to exactly its own.
 */
const addressConfirmationBase = {
  kind: z.literal("address_confirmation"),
  shopId: z.uuid(),
  tokenId: z.uuid(),
  to: emailAddressSchema,
  locale: localeSchema,
  confirmUrl: z.url().max(2_000),
  expiresAt: z.date(),
  timezone: z.string().trim().min(1).max(100),
};

const addressConfirmationSchema = z.discriminatedUnion("purpose", [
  z.object({
    ...addressConfirmationBase,
    purpose: z.literal("account"),
    userAccountId: z.uuid(),
    ownerName: z.string().trim().min(1).max(120),
  }),
  z.object({
    ...addressConfirmationBase,
    purpose: z.enum(["shop_contact", "shore_alert"]),
    shopName: z.string().trim().min(1).max(120),
  }),
]);

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
// like welcome/address_confirmation/password_reset_request above.
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
  kind: z.literal("operator_alert"),
  event: z.literal("new_account"),
  userAccountId: z.uuid(),
  shopId: z.uuid(),
  to: emailAddressSchema,
  ownerName: z.string().trim().min(1).max(120),
  ownerEmail: emailAddressSchema,
  shopName: z.string().trim().min(1).max(120),
  shopSlug: z.string().trim().min(1).max(120),
  /** The name matched the brand and trust-word list: its mail is sent as plain DiveDay until cleared (#2450). */
  nameFlagged: z.literal(true).optional(),
});

/**
 * The other half of the funnel the `new_account` operator alert closes: somebody tried the
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
  kind: z.literal("operator_alert"),
  event: z.literal("demo_started"),
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
  kind: z.literal("operator_alert"),
  event: z.literal("usage_ceiling"),
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

/**
 * A shop asked to be set up through `/get-set-up` (ADR
 * 20261007-setup-request-form). Mailed to DiveDay's onboarding inbox, English
 * like the founder alerts above: it is read by DiveDay, not by the shop.
 *
 * **It carries the requester's contact details** — that is the whole point of
 * it — so `notificationSubjectEmail` names `contactEmail` for the erasure
 * sweep. It goes through `notify()` with no shop to queue a retry against;
 * the row in `setup_requests` is the durable copy, and its `notified_at`
 * stays null when this send fails so the founder digest can say so.
 */
/**
 * One answer a stranger typed, bound for the alert's subject or body: the same
 * single-line rule the form's parser applies, held again here so the mail
 * refuses a line break or a bidi override even from a caller that skipped it.
 */
const setupAnswerSchema = (max: number) =>
  z.string().trim().min(1).max(max).refine(isSingleLineText, "unsafe character");

const setupRequestAlertSchema = z.object({
  kind: z.literal("operator_alert"),
  event: z.literal("setup_request"),
  setupRequestId: z.uuid(),
  to: emailAddressSchema,
  shopName: setupAnswerSchema(SETUP_TEXT_MAX),
  region: setupAnswerSchema(SETUP_TEXT_MAX),
  runsBoat: z.boolean(),
  currentSystem: z.enum(SETUP_CURRENT_SYSTEMS),
  /** Which system, as a switching guide's slug, when the requester named one. */
  currentSystemGuide: z
    .string()
    .refine((slug) => getMigrationGuide(slug) !== null, "unknown guide")
    .optional(),
  contactName: setupAnswerSchema(SETUP_TEXT_MAX),
  contactEmail: emailAddressSchema,
  contactPhone: setupAnswerSchema(SETUP_PHONE_MAX).optional(),
  /** A `FunnelSource` clamped by `eventSource`, or "unknown". */
  source: z.string().trim().min(1).max(60),
  /** The language the reader filled the form in. */
  requestLocale: z.string().trim().min(2).max(10),
  /**
   * The single-use link that opens `/onboard` for this request's shop (ADR
   * 20261009-single-use-setup-links), and when it stops working. Absent when
   * no link could be minted or the deployment has no public origin.
   */
  setupUrl: z.url().max(2_000).optional(),
  setupUrlExpiresAt: z.coerce.date().optional(),
});

const sourceCountSchema = z.object({
  source: z.string().trim().min(1).max(60),
  count: z.number().int().positive(),
});

/**
 * The founder's Monday digest (ADR 20261007-founder-metrics): last week's north
 * star, the funnel by source, and the shops that have stalled between
 * activation steps. Founder-only and English, with no shop to queue against,
 * so it rides `notify()` like the `usage_ceiling` operator alert. Counts, funnel tags and
 * shop names — no diver and no requester appears in it.
 */
const founderDigestSchema = z.object({
  kind: z.literal("operator_alert"),
  event: z.literal("founder_digest"),
  to: emailAddressSchema,
  weekStart: calendarDateSchema,
  weekEnd: calendarDateSchema,
  diveDays: z.number().int().nonnegative(),
  diveDayShops: z.number().int().nonnegative(),
  demoEntries: z.array(sourceCountSchema).max(200),
  setupRequests: z.array(sourceCountSchema).max(200),
  unnotifiedSetupRequests: z.number().int().nonnegative(),
  stalls: z
    .array(
      z.object({
        shopName: z.string().trim().min(1).max(120),
        shopSlug: z.string().trim().min(1).max(120),
        lastReached: z.enum(SHOP_MILESTONES),
        since: calendarDateSchema,
        waitingFor: z.enum(SHOP_MILESTONES),
      }),
    )
    .max(500),
  /**
   * Last week's bounces and complaints (`email_bounces`), newest first: the
   * address (masked when rendered), why, which email, the shop and who sent it. `total` counts them
   * all; `lines` is the first fifty.
   */
  bounces: z.object({
    total: z.number().int().nonnegative(),
    lines: z
      .array(
        z.object({
          occurredAt: z.date(),
          event: z.enum(["bounce", "complaint"]),
          recipient: z.string().trim().min(1).max(320),
          bounceType: z.string().max(120).nullable(),
          bounceSubType: z.string().max(120).nullable(),
          smtpStatus: z.string().max(40).nullable(),
          complaintType: z.string().max(120).nullable(),
          kind: z.string().max(120).nullable(),
          purpose: z.string().max(120).nullable(),
          shopName: z.string().max(120).nullable(),
          shopSlug: z.string().max(120).nullable(),
          sentByName: z.string().max(200).nullable(),
        }),
      )
      .max(50),
  }),
});

// The shop's own inbox learns about an interest the moment the diver submits the
// public course-page composer (docs/product/archive/ux-personas-20260730-findings.md
// task 7) — carries the interest id so a retried send can't double
// up, exactly like waiver_request keys off its own row.
const interestReceivedSchema = z.object({
  kind: z.literal("interest_received"),
  interestId: z.uuid(),
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
 * every DiveDay email leaves as `notifications@ses.dive.day` but greets as the
 * shop, so a diver who hits reply should reach the shop's front desk
 * (`shops.contact_email`), and a commercial send — one carrying an
 * `unsubscribeUrl` — has to name the sender's postal address (CAN-SPAM
 * 16 CFR 316.2). A shop with neither on file sends without them; nothing
 * here guesses a street or an inbox on a shop's behalf.
 */
/**
 * What a staffer wrote back to a diver, on email (ADR 20260907-two-way-inbox).
 * The body is the staffer's own words and the subject is the thread's; the
 * only thing this kind adds to them is the `In-Reply-To`/`References` pair
 * that files the mail into the diver's thread. `replyId` is the
 * `staff_replies` row, minted before the send, so the idempotency key is
 * stable across a retry.
 */
/**
 * The rules a stored `Message-ID` must clear before it can thread a reply.
 *
 * Named and exported through `threadableMessageId` because the schema is not
 * the only reader: the caller that decides whether to *populate* `inReplyTo`
 * has to agree with it exactly. When it restated one clause of this by hand — a
 * control-character test, without the length rules beside it — a diver could
 * poison their own thread by sending mail with a two-character `Message-ID`:
 * the call site passed it, `notify`'s `parse` threw, and the staffer's answer
 * was reported to them as a provider failure that would never clear. Ask the
 * rule, never restate it.
 */
const threadableMessageIdSchema = z
  .string()
  .trim()
  .min(3)
  .max(998)
  .refine((value) => !/\p{Cc}/u.test(value));

/**
 * The stored `Message-ID` if it can thread a reply, `undefined` if it cannot.
 *
 * A value this refuses is dropped and the mail still goes: losing the thread
 * beats losing the answer, and a sender who chose the header gets neither a
 * broken conversation nor a silenced shop.
 */
export function threadableMessageId(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const parsed = threadableMessageIdSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

const staffReplySchema = z.object({
  kind: z.literal("staff_reply"),
  replyId: z.uuid(),
  shopId: z.uuid(),
  to: emailAddressSchema,
  locale: localeSchema,
  shopName: z.string().trim().min(1).max(120),
  subject: z.string().trim().min(1).max(500),
  body: z.string().trim().min(1).max(REPLY_BODY_MAX_LENGTH),
  /**
   * The diver's own `Message-ID`, angle brackets included, when their mail
   * carried one — and the one field on any kind that becomes a **raw mail
   * header** (`In-Reply-To`/`References`, `src/lib/notifications/ses.ts`).
   *
   * It arrives from an unauthenticated sender, so it is refused here unless it
   * is a single line of printable text: a control character in a header value
   * is how a header injection starts, and the check belongs at the schema
   * every send passes through rather than at the one call site that happens to
   * populate it today.
   */
  inReplyTo: threadableMessageIdSchema.optional(),
});

/**
 * **The Monday email** (market audit item 51): one shop's week, sent to its
 * owner — and to any other staffer who asked for it — as service mail. H-09's
 * transactional basis covers it: the recipient is the shop's own staff, the
 * content is the shop's own operation, and nothing in it sells anything.
 *
 * Every section is a count plus the staff page it opens, decided by
 * `weeklyDigestSections` (`src/lib/weekly-digest.ts`); a section with nothing
 * to say never reaches this payload, and an empty list never sends.
 *
 * `turnOffUrl` is the one-click way out (`/unsubscribe/<token>`), and is
 * deliberately **not** named `unsubscribeUrl`: that field is what marks a kind
 * as commercial (`withPostalFooter`, `src/lib/notifications/render.ts`), and
 * this one is not. The SES adapter still lifts it into the RFC 8058
 * `List-Unsubscribe` pair, because a mail client's own "stop these" button is
 * the cheapest way out of any recurring message.
 */
/** A person's or departure's name as the Monday email lists it. */
const digestName = z.string().trim().min(1).max(200);

const weeklyDigestSectionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("last_week"),
    bookingsMade: z.number().int().min(0),
    departures: z.number().int().min(0),
    seatsFilled: z.number().int().min(0),
    seats: z.number().int().min(0),
    url: z.url().max(2_000),
  }),
  z.object({
    kind: z.literal("money"),
    revenueCents: z.number().int(),
    /** The same week a year before (fifth loop, item 29); absent on an older payload. */
    lastYearRevenueCents: z.number().int().nullable().optional(),
    tipsCents: z.number().int().min(0),
    owed: z.object({
      orderCents: z.number().int().min(0),
      orderCount: z.number().int().min(0),
      seatCents: z.number().int().min(0),
      seatCount: z.number().int().min(0),
    }),
    currency: z.string().trim().min(3).max(3),
    url: z.url().max(2_000),
  }),
  z.object({
    kind: z.literal("this_week"),
    departures: z.number().int().min(1),
    seatsFilled: z.number().int().min(0),
    seats: z.number().int().min(0),
    url: z.url().max(2_000),
    /**
     * The week's emptiest boat no deal has gone out for, and the trip's deal
     * form (fifth loop, item 29); absent on an older payload.
     */
    weakest: z
      .object({
        title: z.string().trim().min(1).max(200),
        startsAt: z.date(),
        booked: z.number().int().min(0),
        capacity: z.number().int().min(1),
        url: z.url().max(2_000),
      })
      .nullable()
      .optional(),
  }),
  z.object({
    kind: z.literal("waivers"),
    divers: z.number().int().min(1),
    departures: z.number().int().min(1),
    url: z.url().max(2_000),
  }),
  z.object({
    kind: z.literal("reviews"),
    received: z.number().int().min(0),
    awaitingModeration: z.number().int().min(0),
    url: z.url().max(2_000),
  }),
  z.object({
    kind: z.literal("date_requests"),
    waiting: z.number().int().min(1),
    url: z.url().max(2_000),
  }),
  z.object({
    kind: z.literal("overdue"),
    count: z.number().int().min(1),
    url: z.url().max(2_000),
  }),
  z.object({
    kind: z.literal("safety"),
    openRollCalls: z.number().int().min(0),
    uncrewed: z.number().int().min(0),
    incidents: z.number().int().min(0),
    url: z.url().max(2_000),
  }),
  z.object({
    kind: z.literal("gear_service"),
    due: z.number().int().min(1),
    url: z.url().max(2_000),
  }),
  z.object({
    /**
     * Last week's emergency reads of a diver's medical alert (issue #2990),
     * Reports grade only: who opened whose alert, for which departure, when.
     * Names, never the alert's words.
     */
    kind: z.literal("emergency_reads"),
    /** Every read last week, however many are listed (domain review 1, S1). */
    total: z.number().int().min(1),
    /** Who opened how many, most first; a blank name is `null`, said as "a staffer". */
    byReader: z
      .array(
        z.object({
          reader: digestName.nullable(),
          count: z.number().int().min(1),
        }),
      )
      .min(1)
      .max(EMERGENCY_READERS_LISTED),
    /**
     * The first of them, oldest first; the email says how many more. A blank
     * name is `null` and said as "a diver", "a staffer" or "a departure", so
     * one malformed trail line never fails the owner's email (security L3).
     */
    reads: z
      .array(
        z.object({
          diver: digestName.nullable(),
          departureTitle: digestName.nullable(),
          departureStartsAt: z.date(),
          reader: digestName.nullable(),
          at: z.date(),
        }),
      )
      .min(1)
      .max(EMERGENCY_READS_LISTED),
    url: z.url().max(2_000),
  }),
]);

export type WeeklyDigestEmailSection = z.infer<typeof weeklyDigestSectionSchema>;

const weeklyDigestSchema = z.object({
  kind: z.literal("weekly_digest"),
  shopId: z.uuid(),
  /** The recipient — what keys one email per person per week. */
  personId: z.uuid(),
  to: emailAddressSchema,
  locale: localeSchema,
  recipientName: z.string().trim().min(1).max(120),
  shopName: z.string().trim().min(1).max(120),
  timezone: z.string().trim().min(1).max(100),
  /** This week's shop-local Monday. */
  weekOf: calendarDateSchema,
  lastWeekFrom: calendarDateSchema,
  lastWeekTo: calendarDateSchema,
  thisWeekFrom: calendarDateSchema,
  thisWeekTo: calendarDateSchema,
  // One of each kind at most (`weeklyDigestSections`), so the cap is the count of kinds.
  sections: z.array(weeklyDigestSectionSchema).min(1).max(10),
  /**
   * Claude's opening sentences (the `monday` assist), each about one of the
   * sections above and linked to that section's page. Absent while assists are
   * dark, and the email reads exactly as it did.
   */
  read: z
    .array(z.object({ section: z.string().max(40), text: z.string().trim().min(1).max(280) }))
    .max(3)
    .optional(),
  /** The recipient's own email settings, where the toggle lives. */
  settingsUrl: z.url().max(2_000),
  /** The one-click opt-out — see the docblock above for why it is not `unsubscribeUrl`. */
  turnOffUrl: z.url().max(2_000),
});

/**
 * One piece of a customer's own gear, named in a bench message: the kind as a
 * code (the renderer picks the word in the recipient's language) and the make
 * and model as the shop typed it.
 */
const customerGearPieceSchema = z.object({
  kind: z.enum(GEAR_KIND_ORDER),
  brandModel: z.string().trim().min(1).max(120).optional(),
});

export type CustomerGearPiece = z.infer<typeof customerGearPieceSchema>;

/**
 * **"Your gear is ready"** (ADR 20261008-work-order-follow-up): sent once when
 * a customer's service ticket moves to ready, and again only when a staffer
 * presses Resend. Transactional — the customer left their regulator with the
 * shop and is waiting to hear — so it carries no unsubscribe link.
 *
 * `noticeId` is the `customer_gear_notices` row claimed before the send, which
 * is what holds "once per move to ready"; the key below only keeps one call
 * from doubling. Not queued for retry (`notificationIsQueueable`): the notice
 * row records the outcome staff read on the ticket, and a queue that delivered
 * it later would leave that row saying it failed beside a Resend button.
 *
 * `workPerformed` is the technician's words *for the customer*; the bench
 * notes never reach this payload.
 */
/**
 * **A note to everyone on a departure** (batch 4, J4): the staffer's own short
 * line, checked before it was held (`departureNoteProblem`), and the diver's
 * own `/ready` link — the one link it may carry. One send per note per seat.
 * Not queued: a note about this morning's parking that arrives an hour late
 * is worse than none, and `departure_notes.delivered` says how many went.
 */
const departureNoteSchema = z.object({
  kind: z.literal("departure_note"),
  noteId: z.uuid(),
  /**
   * The seat this copy is for. Deliberately not `bookingId`: that name makes a
   * kind tracked per booking on `notification_deliveries`, and a note is
   * counted on its own row instead (`departure_notes.delivered`).
   */
  seatId: z.uuid(),
  shopId: z.uuid(),
  to: emailAddressSchema,
  locale: localeSchema,
  diverName: z.string().trim().min(1).max(120),
  shopName: z.string().trim().min(1).max(120),
  tripTitle: tripTitleSchema,
  startsAt: z.date(),
  timezone: z.string().trim().min(1).max(100),
  body: z
    .string()
    .trim()
    .min(1)
    .max(DEPARTURE_NOTE_MAX)
    .refine((body) => departureNoteProblem(body) === null),
  readinessUrl: z.url().max(2_000).optional(),
});

/**
 * **Something the crew found aboard** (batch 4, J2), told to the diver it was
 * found with, once per tap. Not queued, for the reason the ready-for-pickup
 * message is not.
 */
const lostItemFoundSchema = z.object({
  kind: z.literal("lost_item_found"),
  itemId: z.uuid(),
  shopId: z.uuid(),
  to: emailAddressSchema,
  locale: localeSchema,
  diverName: z.string().trim().min(1).max(120),
  shopName: z.string().trim().min(1).max(120),
  tripTitle: tripTitleSchema,
  startsAt: z.date(),
  timezone: z.string().trim().min(1).max(100),
  description: z.string().trim().min(1).max(120),
  /** When the staffer tapped Tell, so a second tap is a second send. */
  toldAt: z.date(),
});

/**
 * **A date request, acknowledged to the diver who sent it** (third UX review,
 * item 13). Addressed to the address the public form took, so it carries
 * nothing the diver typed: the course title is the shop's, the dates are
 * parsed calendar days, and the phone and hours are the shop's own
 * (`interestReceivedAckEmail`).
 */
/** Fixed platform acknowledgment; no submitted names, answers or capability fields. */
const setupRequestReceiptSchema = z.object({
  kind: z.literal("setup_request_receipt"),
  setupRequestId: z.uuid(),
  to: emailAddressSchema,
  locale: localeSchema,
});

const interestReceivedAckSchema = z.object({
  kind: z.literal("interest_received_ack"),
  interestId: z.uuid(),
  shopId: z.uuid(),
  to: emailAddressSchema,
  locale: localeSchema,
  shopName: z.string().trim().min(1).max(120),
  courseTitle: z.string().trim().min(1).max(200).optional(),
  preferredDate: calendarDateSchema.optional(),
  alternateDate: calendarDateSchema.optional(),
  shopPhone: z.string().trim().min(1).max(40).optional(),
  deskHours: z
    .object({
      opensMinute: z.number().int().min(0).max(1439),
      closesMinute: z.number().int().min(1).max(1440),
    })
    .optional(),
  timezone: z.string().trim().min(1).max(100),
});

/**
 * **The month-end files, to the shop's bookkeeper** (fifth loop, item 35; ADR
 * 20261016-bookkeeper-month-end-email). On the 2nd, the previous month's
 * report, orders and crew sheet as CSV attachments, to the one address
 * outside the shop's accounts that an owner or manager set behind the export
 * step-up. The files ride inside this payload, so it is never queued
 * (`notificationIsQueueable`): a queued row would hold a month of diver names
 * and money in the database for the length of its retries. A send that fails
 * releases the month's claim and the next day's pass tries again.
 */
const bookkeeperMonthEndSchema = z.object({
  kind: z.literal("bookkeeper_month_end"),
  shopId: z.uuid(),
  to: emailAddressSchema,
  locale: localeSchema,
  shopName: z.string().trim().min(1).max(120),
  /** The month the files are for, `YYYY-MM`. */
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  /**
   * `/unsubscribe/<token>`: the bookkeeper's own stop (second-pass N1), and
   * the `List-Unsubscribe` target. Minted with this month's claim.
   */
  stopUrl: z.url().max(2_000),
  attachments: z
    .array(
      z.object({
        /** A file name DiveDay built: letters, digits, dots and dashes, ending `.csv`. */
        fileName: z
          .string()
          .regex(/^[A-Za-z0-9._-]+\.csv$/)
          .max(200),
        content: z.string().max(10_000_000),
      }),
    )
    .min(1)
    .max(3),
});

/**
 * **A student's certification, told to the student** (third UX review, item
 * 14). Sent once, when the instructor's Certify tap writes a new level card
 * (`issueShopCertification` refuses a level the diver already holds, so a
 * second tap sends nothing). Not queued, for the reason the lost-item message
 * is not: a courtesy that missed its moment is not owed a retry row.
 */
const courseCertifiedSchema = z.object({
  kind: z.literal("course_certified"),
  certificationId: z.uuid(),
  shopId: z.uuid(),
  to: emailAddressSchema,
  locale: localeSchema,
  diverName: z.string().trim().min(1).max(120),
  shopName: z.string().trim().min(1).max(120),
  level: z.enum(DECLARABLE_CERTIFICATION_LEVELS),
  /** The course the shop ran: what the card says, ahead of DiveDay's rung. */
  courseTitle: z.string().trim().min(1).max(200).optional(),
  /** Under 15 on the recorded date, so the card is a Junior card. */
  junior: z.literal(true).optional(),
  /** The course's agency, which issues the card; absent, the message names none. */
  agency: z.enum(CERTIFICATION_AGENCIES).optional(),
  recordedAt: z.date(),
  timezone: z.string().trim().min(1).max(100),
  /** The shop's next public course on from this level; the url is built server-side. */
  nextCourse: z
    .object({
      title: z.string().trim().min(1).max(200),
      url: z.url().max(2_000),
    })
    .optional(),
});

/**
 * **What a group's card checkout settled, told to the lead** (#2566). The
 * booking confirmation goes out before Stripe reports the payment, so it can
 * never carry the group total; this follows once Stripe says paid. One short
 * receipt, keyed on the checkout, sent by the webhook on the call that
 * completes it. The figure is Stripe's own settled total, never the asked
 * price. Carries no `bookingId` on purpose: the delivery table is per booking
 * and kind, and this is a receipt for a checkout.
 */
const partyPaymentReceiptSchema = z.object({
  kind: z.literal("party_payment_receipt"),
  checkoutId: z.uuid(),
  shopId: z.uuid(),
  to: emailAddressSchema,
  locale: localeSchema,
  diverName: z.string().trim().min(1).max(120),
  shopName: z.string().trim().min(1).max(120),
  tripTitle: tripTitleSchema,
  startsAt: z.date(),
  timezone: z.string().trim().min(1).max(100),
  seats: z.number().int().min(2).max(500),
  amountCents: z.number().int().min(1).max(100_000_000),
  currency: z.string().trim().length(3),
});

/**
 * **A seat-claim link was used with the address of someone who already holds a
 * seat on the trip** (#2381, Aaron's option b). The claim page shows the same
 * neutral landing whether the typed address holds a seat or not, so the only
 * answer to "is this address on the trip" goes here, to the inbox that owns it.
 * Carries `heldBookingId`, not `bookingId`, on purpose: it is a note about a
 * claim attempt, not a delivery tracked on that booking. Not queued; the
 * sender throttles it per booking.
 */
const seatAlreadyHeldSchema = z.object({
  kind: z.literal("seat_already_held"),
  heldBookingId: z.uuid(),
  shopId: z.uuid(),
  to: emailAddressSchema,
  locale: localeSchema,
  diverName: z.string().trim().min(1).max(120),
  shopName: z.string().trim().min(1).max(120),
  tripTitle: tripTitleSchema,
  startsAt: z.date(),
  timezone: z.string().trim().min(1).max(100),
  /** When the claim was tried; keys the send. */
  requestedAt: z.date(),
});

const workOrderReadySchema = z.object({
  kind: z.literal("work_order_ready"),
  noticeId: z.uuid(),
  workOrderId: z.uuid(),
  shopId: z.uuid(),
  to: emailAddressSchema,
  locale: localeSchema,
  diverName: z.string().trim().min(1).max(120),
  shopName: z.string().trim().min(1).max(120),
  ticketNumber: z.number().int().min(1),
  pieces: z.array(customerGearPieceSchema).max(20),
  workPerformed: z.string().trim().min(1).max(4000).optional(),
});

/**
 * **A customer piece coming due for service** (ADR
 * 20261008-work-order-follow-up; owner decision 2026-10-08): about a month
 * before the date, once per piece per clock per date, unless the piece's
 * reminders are off. Courtesy mail rather than transactional — nobody asked
 * for it this time — so it carries `unsubscribeUrl` (and with it the postal
 * footer) and is never sent to a person who turned optional email off.
 * Not queued, for the reason the ready message is not.
 */
const gearServiceDueSchema = z.object({
  kind: z.literal("gear_service_due"),
  noticeId: z.uuid(),
  shopId: z.uuid(),
  to: emailAddressSchema,
  locale: localeSchema,
  diverName: z.string().trim().min(1).max(120),
  shopName: z.string().trim().min(1).max(120),
  piece: customerGearPieceSchema,
  clock: z.enum(GEAR_SERVICE_KINDS),
  dueOn: calendarDateSchema,
  unsubscribeUrl: z.url().max(2_000),
});

/**
 * **A crew member's boats changed** (ADR 20261009-crew-hear-about-their-boats):
 * put on a departure, taken off one, or an answer to their own ask — netted
 * and batched by `src/lib/crew-notices.ts`, so a copied week is one message.
 *
 * Staff mail, in the staffer's own locale. No `bookingId`, so no delivery row
 * and no `notification_kind` value. `noticeId` is the newest `crew_notices`
 * row the message settles. Not queued (`notificationIsQueueable`): a day-late
 * retry could tell somebody they are on a boat they have since come off.
 */
const crewScheduleChangeSchema = z.object({
  kind: z.literal("crew_schedule_change"),
  noticeId: z.uuid(),
  shopId: z.uuid(),
  to: emailAddressSchema,
  locale: localeSchema,
  recipientName: z.string().trim().min(1).max(120),
  shopName: z.string().trim().min(1).max(120),
  timezone: z.string().trim().min(1).max(100),
  changes: z
    .array(
      z.object({
        change: z.enum(CREW_NOTICE_CHANGES),
        role: z.enum(CREW_TRIP_ROLES).nullable().optional(),
        tripTitle: tripTitleSchema,
        startsAt: z.date(),
        /** On `time_moved`: when it left before the move (#2283). */
        previousStartsAt: z.date().optional(),
        tripUrl: z.url().max(2_000),
      }),
    )
    .min(1)
    .max(50),
});

/**
 * **The desk is pinged when divers write in after hours** (D4, Aaron
 * 2026-10-09; `src/lib/desk-hours.ts`). Staff operational mail to a staffer who
 * asked for it (or whose role defaults to it), so no unsubscribe and no postal
 * footer: `settingsUrl` is the way out, the same footing as the Monday email.
 *
 * **A count and two links, never the messages.** No sender, no subject, no
 * body: the mail lands in a personal inbox that may sit on a shared phone, and
 * everything a diver wrote stays behind the Inbox's own sign-in.
 *
 * `pingedAt` is the claim on `user_accounts.after_hours_pinged_at` that let
 * this send. Not queued (`notificationIsQueueable`): a ping that arrived an
 * hour late would only repeat what the next one says.
 */
const deskAfterHoursSchema = z.object({
  kind: z.literal("desk_after_hours"),
  shopId: z.uuid(),
  personId: z.uuid(),
  to: emailAddressSchema,
  locale: localeSchema,
  recipientName: z.string().trim().min(1).max(120),
  shopName: z.string().trim().min(1).max(120),
  /** How many divers wrote in since the desk closed and are still waiting. */
  waiting: z.number().int().min(1).max(10_000),
  inboxUrl: z.url().max(2_000),
  settingsUrl: z.url().max(2_000),
  pingedAt: z.date(),
});

/**
 * **Stripe has turned the shop's card payments off** (batch 6 item 8): one
 * email to each owner per change of state, claimed by
 * `shop_stripe_accounts.payments_restricted_at` (`applyStripeAccountStatus`),
 * so a redelivered `account.updated` sends nothing. Bookings already fall back
 * to paying at the shop; this tells the owner why, and where to look. Staff
 * operational mail: no unsubscribe, no postal footer.
 */
const stripePaymentsRestrictedSchema = z.object({
  kind: z.literal("stripe_payments_restricted"),
  shopId: z.uuid(),
  personId: z.uuid(),
  to: emailAddressSchema,
  locale: localeSchema,
  recipientName: z.string().trim().min(1).max(120),
  shopName: z.string().trim().min(1).max(120),
  settingsUrl: z.url().max(2_000),
  /** The claim's own time, so a later restriction is a different message. */
  restrictedAt: z.date(),
});

/**
 * **A diver asked to move a seat on a departure leaving within a day** (issue
 * #2667, decided by Aaron 2026-10-17; `alertStaffToMoveAsk`,
 * src/db/move-ask-alerts.ts). One email to each owner and manager login, only
 * when the departure is within 24 hours; farther out the Inbox is enough.
 * Staff operational mail: no unsubscribe, no postal footer, the same footing
 * as `stripe_payments_restricted`.
 *
 * **The departure and a link, never the diver or their words**, the desk
 * ping's rule: the mail lands in a personal inbox that may sit on a shared
 * phone, and who asked and what they wrote stay behind the Inbox's sign-in.
 *
 * `askedAt` is the ask's own filing time, so an ask filed anew after it was
 * answered is a different message. Not queued: after the boat leaves it says
 * nothing a staffer can act on.
 */
const moveAskSoonSchema = z.object({
  kind: z.literal("move_ask_soon"),
  shopId: z.uuid(),
  personId: z.uuid(),
  messageId: z.uuid(),
  to: emailAddressSchema,
  locale: localeSchema,
  recipientName: z.string().trim().min(1).max(120),
  shopName: z.string().trim().min(1).max(120),
  tripTitle: tripTitleSchema,
  startsAt: z.date(),
  timezone: z.string().trim().min(1).max(100),
  inboxUrl: z.url().max(2_000),
  askedAt: z.date(),
});

/**
 * **A roll call still open after the boat should be home** (batch 6, item 6;
 * `sendStaleRollCallAlerts`, src/db/roll-call-alerts.ts). Staff safety mail
 * to the shop's owners, once per departure.
 *
 * **Counts and a link, never names.** Who is unaccounted for stays behind the
 * manifest's sign-in: the mail lands in a personal inbox that may sit on a
 * shared phone. `missing` says a crew member recorded somebody not back
 * aboard, which changes the words, not the payload's reach.
 *
 * Not queued (`notificationIsQueueable`): an alert that arrives hours late,
 * after the count closed, says something false.
 */
const rollCallStaleSchema = z.object({
  kind: z.literal("roll_call_stale"),
  shopId: z.uuid(),
  personId: z.uuid(),
  tripId: z.uuid(),
  to: emailAddressSchema,
  locale: localeSchema,
  recipientName: z.string().trim().min(1).max(120),
  shopName: z.string().trim().min(1).max(120),
  tripTitle: tripTitleSchema,
  /** The after-dive checkpoint that is open: 1–4. */
  diveNumber: z.number().int().min(1).max(4),
  /**
   * The two counts, summed across the departure's diver and crew rows (EAP
   * review on H-118): people recorded not back aboard, and people with no
   * result yet. Never one number that could mean either.
   */
  notBackAboard: z.number().int().min(0).max(10_000),
  awaiting: z.number().int().min(0).max(10_000),
  /** When the boat was due back (the departure's end), said in the shop's zone. */
  endsAt: z.date(),
  timezone: z.string().trim().min(1).max(100),
  rollCallUrl: z.url().max(2_000),
  alertedAt: z.date(),
});

/**
 * **A filed incident report of kind "missing diver"** (H-142, decided
 * 2026-10-16; `sendMissingDiverAlerts`, src/db/missing-diver-alerts.ts). Staff
 * safety mail to each of the shop's owners at once, once per report: whoever
 * filed it chose "missing diver" on purpose, so the shop does not wait for the
 * roll call to go stale.
 *
 * **The fact and a link, never the report.** The mail lands in a personal
 * inbox that may sit on a shared phone: it says that a missing diver was
 * reported on this departure and when, and links the report behind the staff
 * sign-in. No name, no severity, no word of what happened (the report is
 * personal and medical data).
 *
 * Not queued (`notificationIsQueueable`): an alert that arrives late says
 * something the crew already acted on. Carries `incidentReportId`, never
 * `bookingId`, so the delivery is not tracked against a booking.
 */
const incidentMissingDiverSchema = z.object({
  kind: z.literal("incident_missing_diver"),
  shopId: z.uuid(),
  personId: z.uuid(),
  tripId: z.uuid(),
  incidentReportId: z.uuid(),
  to: emailAddressSchema,
  locale: localeSchema,
  recipientName: z.string().trim().min(1).max(120),
  shopName: z.string().trim().min(1).max(120),
  tripTitle: tripTitleSchema,
  /** When it happened, per the report: said in the shop's zone. */
  reportedAt: z.date(),
  timezone: z.string().trim().min(1).max(100),
  reportUrl: z.url().max(2_000),
  /** The shop's emergency reference, behind the same sign-in. */
  emergencyUrl: z.url().max(2_000),
});

/**
 * **The all-clear after a missing-diver alert** (issue #2694, decided by Aaron
 * 2026-10-17; `sendMissingDiverAllClear`, src/db/missing-diver-alerts.ts): the
 * diver reported missing on this departure was found. One quiet email to each
 * owner, at most once per report, and no push. The fact, when, and the
 * report's link behind the staff sign-in; nobody named.
 */
const incidentMissingDiverFoundSchema = z.object({
  kind: z.literal("incident_missing_diver_found"),
  shopId: z.uuid(),
  personId: z.uuid(),
  tripId: z.uuid(),
  incidentReportId: z.uuid(),
  to: emailAddressSchema,
  locale: localeSchema,
  recipientName: z.string().trim().min(1).max(120),
  shopName: z.string().trim().min(1).max(120),
  tripTitle: tripTitleSchema,
  /** When the crew marked the diver found: said in the shop's zone. */
  foundAt: z.date(),
  /** Others on this departure still reported missing: a count, never a name. */
  stillMissing: z.number().int().min(0).max(500),
  timezone: z.string().trim().min(1).max(100),
  reportUrl: z.url().max(2_000),
});

/**
 * **The same alert, to the shop's shore contact** (H-118, decided 2026-10-15).
 * Addressed to somebody outside the shop's accounts, so it carries less than
 * the owners' copy: no person, no link behind a staff sign-in, and no name of
 * anybody aboard. The shop and its phone, the departure, the dive, the two
 * counts, when the boat was due back and when this was sent. Sent only to an
 * address with a recorded consent that its inbox confirmed
 * (`shoreAlertRecipient`, `src/lib/shore-alert-contact.ts`).
 *
 * `stopUrl` is the one link: `/unsubscribe/<token>`, which takes the address
 * off the shop. Not named `unsubscribeUrl`, which would mark the kind
 * commercial (`withPostalFooter`); the SES adapter lifts it into the
 * `List-Unsubscribe` pair all the same.
 */
const rollCallStaleShoreSchema = z.object({
  kind: z.literal("roll_call_stale_shore"),
  shopId: z.uuid(),
  tripId: z.uuid(),
  to: emailAddressSchema,
  locale: localeSchema,
  shopName: z.string().trim().min(1).max(120),
  /** The shop's own phone, when it has one on file: who to call first. */
  shopPhone: z.string().trim().min(1).max(60).nullable(),
  tripTitle: tripTitleSchema,
  diveNumber: z.number().int().min(1).max(4),
  notBackAboard: z.number().int().min(0).max(10_000),
  awaiting: z.number().int().min(0).max(10_000),
  endsAt: z.date(),
  timezone: z.string().trim().min(1).max(100),
  /** When this pass ran: the email says when it was true. */
  alertedAt: z.date(),
  stopUrl: z.url().max(2_000),
});

/**
 * **The shore contact stopped the alerts themselves** (H-118 re-review): one
 * email to each owner with an active login when a stop link took the address
 * off the shop, so the shop learns its shore contact is gone. Staff
 * operational mail, from DiveDay; the address that stopped is never in it.
 */
const shoreAlertStoppedSchema = z.object({
  kind: z.literal("shore_alert_stopped"),
  shopId: z.uuid(),
  personId: z.uuid(),
  to: emailAddressSchema,
  locale: localeSchema,
  recipientName: z.string().trim().min(1).max(120),
  shopName: z.string().trim().min(1).max(120),
  settingsUrl: z.url().max(2_000),
  /** When the link was used: one email per owner per stop. */
  stoppedAt: z.date(),
});

/**
 * **The link a bookkeeper's address receives before any month-end file goes
 * to it** (security review B1; the shore contact's confirmation is the
 * model). From the shop, in the shop's language, with no files: it says what
 * agreeing means and that ignoring it sends nothing.
 */
const bookkeeperConfirmationSchema = z.object({
  kind: z.literal("bookkeeper_confirmation"),
  shopId: z.uuid(),
  to: emailAddressSchema,
  locale: localeSchema,
  shopName: z.string().trim().min(1).max(120),
  confirmUrl: z.url().max(2_000),
  expiresAt: z.date(),
  timezone: z.string().trim().min(1).max(100),
});

/**
 * **What every owner hears about the bookkeeper's address** (security review
 * B1 and F1, second pass): that it was set, changed, vouched for, confirmed
 * or removed, and by whom, and one line on each month-end send naming where
 * the files went. Staff operational mail, from DiveDay. A shop with no owner
 * login sends it to its managers or its confirmed contact address (N5): the
 * last has no person and no name.
 */
const bookkeeperNoticeSchema = z.object({
  kind: z.literal("bookkeeper_notice"),
  shopId: z.uuid(),
  personId: z.uuid().nullable(),
  to: emailAddressSchema,
  locale: localeSchema,
  recipientName: z.string().trim().min(1).max(120).nullable(),
  shopName: z.string().trim().min(1).max(120),
  reportsUrl: z.url().max(2_000),
  event: z.enum(["set", "changed", "vouched", "cleared", "confirmed", "sent", "bounced"]),
  /** On `cleared`: the bookkeeper's own stop link, or an erasure; absent when staff removed it. */
  by: z.enum(["recipient", "erasure"]).optional(),
  /** The bookkeeper's address: absent on a `cleared` by staff or by erasure. */
  email: emailAddressSchema.optional(),
  /** Who saved it: on `set`, `changed`, `vouched` and a staff `cleared`. */
  actorName: z.string().trim().min(1).max(120).optional(),
  /** `YYYY-MM`, on `sent`. */
  month: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
    .optional(),
  /** When it happened: one email per owner per event. */
  at: z.date(),
});

export const notificationSenderSchema = z.object({
  /**
   * The staff member whose action sent this, read off the session at the send
   * (`currentSendActor`) and carried into a queued retry. Tagged on the SES
   * send (`SES_SENDER_TAG`) so a bounce names who sent it. Absent on mail
   * nobody pressed a button for.
   */
  sentByPersonId: z.uuid().optional(),
  replyTo: emailAddressSchema.optional(),
  /** One line, already in postal order (`shopAddressLines(...).join(", ")`). */
  postalAddress: z.string().trim().min(1).max(300).optional(),
  /**
   * The send comes from a demo shop (`shops.is_demo`), so a seeded person's
   * `mail.example` address goes to the SES mailbox simulator instead of being
   * refused (`deliveryAddressFor` in `src/lib/simulator-email.ts`). Absent on
   * every real shop's send.
   */
  demoShop: z.literal(true).optional(),
  /**
   * The shop's name is flagged for review (`shopNameUnderReview`, issue #2450):
   * it matched the brand and trust-word list and no human has cleared it, so
   * the From column carries the plain "DiveDay" name, never "{Shop} via
   * DiveDay" (`fromAddressFor`). Absent on every other shop's send.
   */
  nameUnderReview: z.literal(true).optional(),
  /**
   * The shop's logo, already resolved to an absolute `https:` URL on DiveDay's
   * own origin or its managed storage (`shopSenderOf`), so the email can lead
   * with the shop's mark (ux review 2026-10-11, item 3). Never a URL the shop
   * typed: a remote image in mail is a request the recipient's client makes,
   * and only first-party storage may be the host of it.
   */
  logoUrl: z
    .url()
    .max(2_000)
    .refine((value) => value.startsWith("https://"))
    .optional(),
  /**
   * The shop's published phone and its confirmed contact address, for the
   * sign-off every shop email ends on (`withShopSignOff`, visual review
   * 2026-10-24, B31). The address only once the shop has confirmed it
   * (`deliverableShopContactEmail`), the same rule `Reply-To` keeps.
   */
  // One printable line: a newline or control character could fake extra lines
  // in the plain-text sign-off (security review, B31).
  contactPhone: z
    .string()
    .trim()
    .min(1)
    .max(40)
    .regex(/^[^\u0000-\u001f\u007f]+$/)
    .optional(),
  contactEmail: emailAddressSchema.optional(),
  /** The shop's brand colour, `#rrggbb` (`shops.brand_color`), for the wrapper's accents. */
  brandColor: z
    .string()
    .regex(/^#[0-9a-f]{6}$/)
    .optional(),
});

export type NotificationSender = z.infer<typeof notificationSenderSchema>;

/**
 * **Every internal mail to DiveDay's own inbox is one kind.** The five
 * founder alerts differ in what they say, not in who reads them: English, no
 * locale, nobody to address. `event` picks the payload, the subject and the
 * idempotency key; the kind is the one thing a queue row, an SES tag and a
 * reader of `render.ts` have to know. A nested union keeps each event's fields
 * exact, so an alert cannot be sent with another's payload.
 */
const operatorAlertSchema = z.discriminatedUnion("event", [
  newAccountAlertSchema,
  demoStartedAlertSchema,
  usageCeilingAlertSchema,
  setupRequestAlertSchema,
  founderDigestSchema,
]);

export type OperatorAlertEvent = z.infer<typeof operatorAlertSchema>["event"];

export const notificationSchema = z
  .discriminatedUnion("kind", [
    bookingConfirmationSchema,
    waiverRequestSchema,
    guardianReleaseCopySchema,
    readinessLinkSchema,
    bookingHandoffSchema,
    seatOfferSchema,
    seatOfferCommercialSchema,
    tripReminder7dSchema,
    tripReminder24hSchema,
    tripRescheduledSchema,
    tripRecapSchema,
    tripConditionsHoldSchema,
    tripMinimumNotMetSchema,
    tripBlowoutSchema,
    bookingCancelledSchema,
    partyPaymentReceiptSchema,
    seatAlreadyHeldSchema,
    welcomeSchema,
    addressConfirmationSchema,
    passwordResetRequestSchema,
    passwordChangedSchema,
    staffInviteSchema,
    checkoutRecoverySchema,
    operatorAlertSchema,
    interestReceivedSchema,
    staffReplySchema,
    weeklyDigestSchema,
    workOrderReadySchema,
    gearServiceDueSchema,
    crewScheduleChangeSchema,
    deskAfterHoursSchema,
    stripePaymentsRestrictedSchema,
    moveAskSoonSchema,
    rollCallStaleSchema,
    rollCallStaleShoreSchema,
    incidentMissingDiverSchema,
    incidentMissingDiverFoundSchema,
    shoreAlertStoppedSchema,
    departureNoteSchema,
    lostItemFoundSchema,
    courseCertifiedSchema,
    interestReceivedAckSchema,
    setupRequestReceiptSchema,
    bookkeeperMonthEndSchema,
    bookkeeperConfirmationSchema,
    bookkeeperNoticeSchema,
  ])
  .and(z.object({ sender: notificationSenderSchema.optional() }));

export type Notification = z.infer<typeof notificationSchema>;

/**
 * **The address of the person a message is *about*, when that is not the person
 * it is addressed to** — and null when the two are the same.
 *
 * Legal erasure has to reach a queued notification carrying an erased diver's
 * identity, and since issue #1297 sealed `notification_send_queue.payload`
 * there is nothing left to probe: the sweep can only match handles lifted into
 * real columns. `to` covers every kind whose subject *is* its recipient, which
 * is almost all of them. Two are addressed elsewhere and carry a person in the
 * body:
 *
 * - `interest_received` mails the shop's own front desk about a diver who used
 *   the public composer, and carries their name, address, phone and free-text
 *   message;
 * - an `operator_alert` for `new_account` mails DiveDay about a shop owner who just signed up.
 *
 * A diver who submits a date request, whose notification then fails
 * retryably, and who asks to be erased before the retry drains kept all of
 * that in a live queue row the sweep could not see (issue #1298).
 *
 * **`kinds.test.ts` refuses a kind this function has forgotten.** It walks
 * every schema in the union for a field carrying an address and fails unless
 * each one is either `to` or reachable here — which is what stops this from
 * being one more thing to remember the next time a kind's subject differs
 * from its recipient.
 */
export function notificationSubjectEmail(notification: Notification): string | null {
  switch (notification.kind) {
    case "interest_received":
      return notification.inquirerEmail ?? null;
    case "operator_alert":
      if (notification.event === "new_account") return notification.ownerEmail;
      if (notification.event === "setup_request") return notification.contactEmail;
      return null;
    // The bookkeeper's address in an owner's notice. Never queued, so no row
    // holds it; named here so a future queued path is covered all the same.
    case "bookkeeper_notice":
      return notification.email ?? null;
    default:
      return null;
  }
}

/**
 * **The subject's phone number, for the interest that gave one and no address.**
 *
 * An address is not a sufficient handle for a `interest_received`, and the
 * product says so: the public composer's reply-path rule is "an address *or* a
 * number" (`hasReplyPath`, `src/app/actions/inquiry.ts`), so a diver on a dock
 * who leaves only a phone number produces a queued notification carrying their
 * name, their number and up to 1,500 characters of free text with no
 * `inquirerEmail` at all. That row was unreachable by `subject_email` for
 * exactly the reason it was unreachable by `recipient_email`
 * (`security-reviewer`, on issue #1298).
 *
 * The same over-reach `scrub` already accepts for the date-interest phone
 * applies here and is accepted for the same reason: a household number is
 * genuinely shared, so this can drop a partner's queued interest notice. That is a lost
 * retry of a notification whose underlying row the same transaction blanks
 * anyway — availability, not disclosure — and it buys the case the address
 * cannot reach.
 *
 * Matched exactly rather than normalised, because `people.phone` and
 * the date-interest phone are compared exactly by the sweep beside it and
 * three spellings of "the same number" would be a different decision than this
 * one.
 */
export function notificationSubjectPhone(notification: Notification): string | null {
  switch (notification.kind) {
    case "interest_received":
      return notification.inquirerPhone ?? null;
    case "operator_alert":
      return notification.event === "setup_request" ? (notification.contactPhone ?? null) : null;
    default:
      return null;
  }
}

/**
 * **Whether a retryable failure of this kind is worth a queue row.**
 *
 * Default true: a message that failed on a throttle is a message somebody is
 * waiting for, and `notification_send_queue` exists so it still arrives.
 *
 * `guardian_release_copy` is the one exception, and the reason is erasure
 * rather than value. The sweep in `anonymizeDiver` can only match handles
 * lifted into real columns — `recipient_email`, `subject_email`,
 * `booking_id` — and this kind is addressed to a third party, carries no
 * booking by design, and puts the minor in `subject_email` only when the minor
 * has an address of their own. A twelve-year-old signing on a shop tablet
 * usually has none. So a throttled send leaves a row holding a parent's
 * plaintext address about a named child, and an owner who then erases that
 * child does not reach it: the drain still mails the copy, after the erasure
 * (`dive-domain-expert` and `security-reviewer`, issue #1453).
 *
 * Not queueing is the whole fix rather than the cheap half of one. Nothing
 * downstream reads this message, no gate waits on it, and the release itself
 * is recorded either way — it is a courtesy, and a courtesy that missed its
 * moment is not owed a second attempt at the cost of a row erasure cannot
 * find. The alternative, a `subject_person_id` column swept beside the two
 * address arms, is a migration for a delivery guarantee nobody asked for.
 */
export function notificationIsQueueable(notification: Notification): boolean {
  switch (notification.kind) {
    // The shore contact's link is a live consent: a courtesy that missed its
    // moment is not owed a row holding it. The account and front-desk links
    // are queued, sealed, as they always were.
    case "address_confirmation":
      return notification.purpose !== "shore_alert";
    case "guardian_release_copy":
    case "work_order_ready":
    case "gear_service_due":
    case "crew_schedule_change":
    case "desk_after_hours":
    case "move_ask_soon":
    case "roll_call_stale":
    case "roll_call_stale_shore":
    case "incident_missing_diver":
    case "incident_missing_diver_found":
    case "departure_note":
    case "lost_item_found":
    case "course_certified":
    case "bookkeeper_month_end":
    // A live link, and a bookkeeper's address in an owner's notice: a
    // courtesy that missed its moment is not worth a row holding either.
    case "bookkeeper_confirmation":
    case "bookkeeper_notice":
    case "seat_already_held":
    case "setup_request_receipt":
      return false;
    default:
      return true;
  }
}

const ADDRESS_CONFIRMATION_KEY_PREFIX = {
  account: "email-verification",
  shop_contact: "contact-email-confirmation",
  shore_alert: "shore-alert-confirmation",
} as const;

function operatorAlertKey(notification: Extract<Notification, { kind: "operator_alert" }>): string {
  switch (notification.event) {
    case "new_account":
      return `new-account-alert/${notification.userAccountId}`;
    case "demo_started":
      return `demo-started-alert/${notification.shopSlug}`;
    case "usage_ceiling":
      return `usage-ceiling/${notification.ceilingId}/${notification.periodKey}/${notification.level}`;
    case "setup_request":
      return `setup-request/${notification.setupRequestId}`;
    case "founder_digest":
      return `founder-digest/${notification.weekStart}`;
  }
}

export function notificationIdempotencyKey(notification: Notification): string {
  switch (notification.kind) {
    case "booking_confirmation":
      return notification.confirmedAt
        ? `booking-confirmation/${notification.bookingId}/${notification.confirmedAt.toISOString()}`
        : `booking-confirmation/${notification.bookingId}`;
    case "waiver_request":
      return `waiver-request/${notification.waiverRecordId}`;
    // **Never reached, and kept exact anyway.** This key is the
    // `notification_send_queue` conflict target and nothing else, and
    // `notificationIsQueueable` keeps this kind out of that queue entirely, so
    // no row is ever written under it. It is emphatically *not* a promise of
    // one copy per release: the send itself is unguarded, so a resubmitted
    // completion mails a second copy. An earlier version of this comment said
    // the opposite, and the glossary repeated it (`security-reviewer`, issue
    // #1453).
    case "guardian_release_copy":
      return `guardian-release-copy/${notification.waiverRecordId}`;
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
      return notification.purpose
        ? `readiness-link/${notification.purpose}/${notification.bookingId}/${notification.expiresAt.toISOString()}`
        : `readiness-link/${notification.bookingId}/${notification.expiresAt.toISOString()}`;
    case "booking_handoff":
      return `booking-handoff/${notification.bookingId}/${notification.expiresAt.toISOString()}`;
    // Keyed by the offer timestamp so a genuine re-offer (a seat opens twice) is
    // a fresh send, while a double-submit of the same tap still dedups at the
    // notification_send_queue level.
    case "seat_offer":
    case "seat_offer_commercial":
      return `seat-offer/${notification.interestId}/${notification.offeredAt.toISOString()}`;
    // One reminder per booking per cadence — the kind alone keys it.
    case "trip_reminder_7d":
    case "trip_reminder_24h":
      return `${notification.kind}/${notification.bookingId}`;
    // One per seat per move: the trip's revision after the move keys it, so a
    // second move is a second message and a retried send is not. A seat moved
    // to another departure is keyed by when it moved. A meeting point moves
    // without a revision (#2443), so a place-only notice is keyed by the place
    // it names as well.
    case "trip_rescheduled":
      return notification.seatMovedAt
        ? `trip-rescheduled/${notification.bookingId}/seat/${notification.seatMovedAt.toISOString()}`
        : notification.previousStartsAt.getTime() === notification.startsAt.getTime()
          ? `trip-rescheduled/${notification.bookingId}/${notification.revision}/place/${notification.meetingPoint?.label ?? ""}/${notification.meetingPoint?.address ?? ""}`
          : `trip-rescheduled/${notification.bookingId}/${notification.revision}`;
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
    // One per cancellation: a seat reinstated and canceled again is news again.
    case "booking_cancelled":
      return `booking-cancelled/${notification.bookingId}/${notification.cancelledAt.toISOString()}`;
    // One welcome ever, per account.
    case "welcome":
      return `welcome/${notification.userAccountId}`;
    // Keyed by the token row's own id, not the raw token, so a retried send
    // never doubles up without this idempotency key ever carrying the bearer
    // secret itself.
    // One send per minted link; a resend mints a fresh token and is its own
    // send. The purpose prefix is the old kind's key, unchanged.
    case "address_confirmation":
      return `${ADDRESS_CONFIRMATION_KEY_PREFIX[notification.purpose]}/${notification.tokenId}`;
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
    // The event is the kind a founder alert used to be, and its key is
    // unchanged: one alert per account, ever (as welcome); one per demo entry
    // (every entry mints its own shop under a freshly-generated identity, so the
    // slug is the entry's identity); one per ceiling per period per level (the
    // key `ceilingAlertKey` computes, level in it deliberately: crossing from
    // warn to over is news); one per stored setup request (the row exists before
    // the send does); one digest per week, ever (the key the claim takes).
    case "operator_alert":
      return operatorAlertKey(notification);
    // One notification per submitted inquiry row.
    case "interest_received":
      return `interest-received/${notification.interestId}`;
    // One send per reply row; the row exists before the send does.
    case "staff_reply":
      return `staff-reply/${notification.replyId}`;
    // One send per note per seat; the note row exists before the send does.
    case "departure_note":
      return `departure-note/${notification.noteId}/${notification.seatId}`;
    // One send per tap on Tell.
    case "lost_item_found":
      return `lost-item-found/${notification.itemId}/${notification.toldAt.toISOString()}`;
    // One acknowledgment per submitted request row.
    case "interest_received_ack":
      return `interest-received-ack/${notification.interestId}`;
    case "setup_request_receipt":
      return `setup-request-receipt/${notification.setupRequestId}`;
    // One receipt per checkout, ever; the webhook sends it only on the call
    // that completes the checkout.
    case "party_payment_receipt":
      return `party-payment-receipt/${notification.checkoutId}`;
    // One note per held seat per clock hour, however many claims were tried:
    // the same key for every attempt in the hour, so a limiter outage cannot
    // turn a loop of claims into a loop of mail (issue #2381).
    case "seat_already_held":
      return `seat-already-held/${notification.heldBookingId}/${Math.floor(notification.requestedAt.getTime() / 3_600_000)}`;
    // One send per card written; a level already held writes none.
    case "course_certified":
      return `course-certified/${notification.certificationId}`;
    // Never queued; one month per shop, which `bookkeeper_sent_month` claims.
    case "bookkeeper_month_end":
      return `bookkeeper-month-end/${notification.shopId}/${notification.month}`;
    case "bookkeeper_confirmation":
      return `bookkeeper-confirmation/${notification.shopId}/${notification.expiresAt.toISOString()}`;
    // The shop too (third-pass security N4): the shop-contact fallback has no
    // person, and one pass stamps every shop with the same `at`.
    case "bookkeeper_notice":
      return `bookkeeper-notice/${notification.shopId}/${notification.personId ?? "shop-contact"}/${notification.event}/${notification.at.toISOString()}`;
    // One Monday email per person per shop-local week — the same pair
    // `weekly_digest_sends` holds unique, so a queued retry and the claim
    // agree on what "this week's email" means.
    case "weekly_digest":
      return `weekly-digest/${notification.personId}/${notification.weekOf}`;
    // One send per notice row; the row is claimed before the send.
    case "work_order_ready":
      return `work-order-ready/${notification.noticeId}`;
    case "gear_service_due":
      return `gear-service-due/${notification.noticeId}`;
    // One send per settled batch, named by its newest notice row.
    case "crew_schedule_change":
      return `crew-schedule-change/${notification.noticeId}`;
    // One send per claim of the person's batching clock.
    case "desk_after_hours":
      return `desk-after-hours/${notification.personId}/${notification.pingedAt.toISOString()}`;
    // One send per owner or manager per filing of the ask.
    case "move_ask_soon":
      return `move-ask-soon/${notification.messageId}/${notification.personId}/${notification.askedAt.toISOString()}`;
    // One send per owner per restriction claim.
    case "stripe_payments_restricted":
      return `stripe-payments-restricted/${notification.personId}/${notification.restrictedAt.toISOString()}`;
    // One alert per departure per owner; the departure's claim comes first.
    case "roll_call_stale":
      return `roll-call-stale/${notification.tripId}/${notification.personId}`;
    // One alert per report per owner; the report's claim comes first.
    case "incident_missing_diver":
      return `incident-missing-diver/${notification.incidentReportId}/${notification.personId}`;
    // One all-clear per report per owner, claimed before the send.
    case "incident_missing_diver_found":
      return `incident-missing-diver-found/${notification.incidentReportId}/${notification.personId}`;
    // One alert per departure to the shore contact, under the same claim.
    case "roll_call_stale_shore":
      return `roll-call-stale-shore/${notification.tripId}`;
    case "shore_alert_stopped":
      return `shore-alert-stopped/${notification.personId}/${notification.stoppedAt.toISOString()}`;
  }
}
