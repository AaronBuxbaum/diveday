import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { bookings, lastMinuteListEntries } from "./bookings";
import { people, shops } from "./core";
import { trips } from "./trips";

/**
 * Outbound and inbound messaging: deliveries, the send queue, rate limits,
 * inbound messages and staff replies, WhatsApp senders, SMS opt-outs, push
 * subscriptions and the unsubscribe/confirmation tokens.
 */

/**
 * A diver-facing, self-serve bearer link to unsubscribe one last-minute-list
 * entry (docs features/story-backlog.md "Leo — self-serve email unsubscribe"). A fresh
 * token is minted for every deal blast rather than one stable token per entry
 * (mirrors `bookingCapabilities`, not `calendarFeeds`), so an old email's link
 * keeps working even after a later blast mints another — deliberately never
 * expires: an expired unsubscribe link would leave someone unable to opt out,
 * silently, the same reasoning `createBearerToken`'s calendar-feed case
 * documents. Consuming a token only ever sets `unsubscribedAt`, an idempotent
 * write, so unlike `bookingCapabilities`/`accountTokens` there is nothing to
 * mark used or revoke.
 */
export const lastMinuteListUnsubscribeTokens = pgTable(
  "last_minute_list_unsubscribe_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    entryId: uuid("entry_id")
      .notNull()
      .references(() => lastMinuteListEntries.id),
    tokenHash: text("token_hash").notNull().unique(),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("last_minute_list_unsubscribe_tokens_token_hash_idx").on(table.tokenHash),
    index("last_minute_list_unsubscribe_tokens_entry_idx").on(table.entryId),
  ],
);

/**
 * A diver-facing, self-serve bearer link to opt one person out of courtesy
 * email, every courtesy kind `people.courtesyEmailOptOutAt` governs: wait-list
 * openings, post-trip recaps, checkout reminders and cold staff invitations, as
 * listed on `issuePersonCourtesyEmailUnsubscribeToken` in
 * `src/db/courtesy-email.ts` (docs features/story-backlog.md "Leo — self-serve
 * email unsubscribe"). Same
 * shape and reasoning as `lastMinuteListUnsubscribeTokens`: a fresh token per
 * send rather than one stable token per person, never expires, and consuming
 * it is an idempotent write (only ever sets `courtesyEmailOptOutAt`) — kept as
 * a separate table rather than folded into `lastMinuteListUnsubscribeTokens`
 * because it resolves to a person, not a last-minute-list entry.
 */
export const personCourtesyEmailUnsubscribeTokens = pgTable(
  "person_courtesy_email_unsubscribe_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id),
    tokenHash: text("token_hash").notNull().unique(),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("person_courtesy_email_unsubscribe_tokens_token_hash_idx").on(table.tokenHash),
    index("person_courtesy_email_unsubscribe_tokens_person_idx").on(table.personId),
  ],
);

/**
 * A one-time bearer link that proves a shop controls the front-desk address it
 * typed into settings (issue #1288). Minted on every save that changes
 * `shops.contact_email` and on a "resend" tap; the link goes to that address
 * and nowhere else, so opening it is the proof. Same lifecycle as
 * `accountTokens` rather than the never-expiring unsubscribe tokens: a fresh
 * mint supersedes the outstanding one, consuming is one-time, and it expires --
 * an unconfirmed address costs the shop nothing but Reply-To, so a stale link
 * has nobody to lock out. `email` is the address the token vouches for, so a
 * confirm is a no-op if the shop has since typed a different one.
 */
export const shopContactEmailConfirmationTokens = pgTable(
  "shop_contact_email_confirmation_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    /** Lower-cased; compared against `shops.contact_email` the same way at consume time. */
    email: text("email").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    supersededAt: timestamp("superseded_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("shop_contact_email_confirmation_tokens_shop_idx").on(table.shopId)],
);

/** Latest outbound-email state per booking and notification purpose. */
export const notificationKind = pgEnum("notification_kind", [
  "booking_confirmation",
  "waiver_request",
  // One link, to an address typed cold into a booking form that matches a
  // diver on file, bringing their details across (H-68 b). Nothing on the
  // page says whether it went; the delivery row is what keeps it to one.
  "booking_handoff",
  // The diver's own rescue for a trip-prep link that aged out: they ask from
  // the dead page, and a replacement goes to the address already on the
  // booking (issue #850). Tracked like every other per-booking message so a
  // shop can see that one was sent and whether it landed.
  "readiness_link",
  // Scheduled pre-trip reminders; one delivery row per booking per cadence
  // (src/lib/reminders.ts) means each cadence sends at most once.
  "trip_reminder_7d",
  "trip_reminder_24h",
  // The post-trip recap message — sent once per booking no earlier than four
  // hours after the trip ends, linking to the diver's shareable recap page
  // (docs first-principles brainstorm C: the word-of-mouth window, weaponized).
  "trip_recap",
  // The weather blow-out cascade message: the cancellation, the diver's money
  // story, and the alternatives they qualify for (ADR 20260804-blowout-cascade).
  "trip_blowout",
  // "This one did not fill." Sent per booking when the minimum-head-count
  // sweep cancels a departure whose deadline passed while it was still short
  // (src/lib/minimum-seats.ts). Tracked per booking like every other trip
  // message, so a shop can see who was told.
  "trip_minimum_not_met",
  // One seat canceled, by the diver or the shop, with what happened to the
  // money (src/db/booking-cancelled-notice.ts). Tracked per booking so the
  // shop can see the diver was told.
  "booking_cancelled",
]);

export const notificationDeliveryStatus = pgEnum("notification_delivery_status", [
  "sent",
  "failed",
  "not_configured",
]);

/** Durable retry state for transient provider failures. */
export const notificationQueueStatus = pgEnum("notification_queue_status", [
  "queued",
  "processing",
  "sent",
  "failed",
]);

/**
 * What the provider later said happened to a message we already handed over —
 * a different question from `notification_delivery_status`, which only records
 * whether our own send call succeeded. Reported by the delivery webhook
 * (20260726-hosted-mailboxes-for-platform-mail, 20260803-ses-sole-email-provider);
 * null until an event arrives, which is the normal steady state when no
 * webhook is configured.
 */
export const notificationProviderStatus = pgEnum("notification_provider_status", [
  "sent",
  "delivered",
  "delivery_delayed",
  "bounced",
  "complained",
  "failed",
  "suppressed",
]);

/**
 * A current operational status, not an append-only provider log. One row per
 * booking/purpose means a newly emailed waiver link replaces its prior state.
 */
export const notificationDeliveries = pgTable(
  "notification_deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => bookings.id),
    kind: notificationKind("kind").notNull(),
    status: notificationDeliveryStatus("status").notNull(),
    providerMessageId: text("provider_message_id"),
    /** Provider-reported outcome; reset to null whenever a fresh send replaces the row. */
    providerStatus: notificationProviderStatus("provider_status"),
    providerStatusAt: timestamp("provider_status_at", { withTimezone: true }),
    /** The provider's own explanation for a bounce or failure, shown to staff verbatim. */
    providerDetail: text("provider_detail"),
    /** HTTP-level explanation from our send attempt, before provider webhooks exist. */
    sendHttpStatus: integer("send_http_status"),
    sendErrorCode: text("send_error_code"),
    sendError: text("send_error"),
    attemptedAt: timestamp("attempted_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("notification_deliveries_booking_kind_unique").on(table.bookingId, table.kind),
    index("notification_deliveries_shop_status_attempted_idx").on(
      table.shopId,
      table.status,
      table.attemptedAt,
    ),
    // The webhook's only entry point: an event names the provider's message id.
    index("notification_deliveries_provider_message_idx").on(table.providerMessageId),
  ],
);

/**
 * Append-only history of every send attempt — the durable record behind the
 * denormalized latest state in notification_deliveries. A retry adds a row
 * here; nothing is ever updated, so the full delivery trail survives.
 */
export const notificationDeliveryAttempts = pgTable(
  "notification_delivery_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => bookings.id),
    kind: notificationKind("kind").notNull(),
    status: notificationDeliveryStatus("status").notNull(),
    providerMessageId: text("provider_message_id"),
    sendHttpStatus: integer("send_http_status"),
    sendErrorCode: text("send_error_code"),
    sendError: text("send_error"),
    /** True when a staff member re-triggered the send from the dashboard. */
    isRetry: boolean("is_retry").notNull().default(false),
    attemptedAt: timestamp("attempted_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("notification_delivery_attempts_booking_kind_idx").on(table.bookingId, table.kind),
    index("notification_delivery_attempts_shop_attempted_idx").on(table.shopId, table.attemptedAt),
  ],
);

/**
 * Retryable outbound notifications. The payload is the validated application
 * notification, not provider-specific JSON, so a later worker can render it
 * again and keep the idempotency boundary stable across process restarts.
 */
export const notificationSendQueue = pgTable(
  "notification_send_queue",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    /**
     * The queued notification, **sealed** (`src/lib/secret-box.ts`), never
     * plaintext — the same promise `waiver_records.token_sealed` and
     * `shop_whatsapp_accounts.access_token_sealed` make, and for the same
     * reason. Half the notification kinds carry a capability URL in a field
     * (`verifyUrl`, `resetUrl`, `inviteUrl`, `confirmUrl`, `completionUrl`,
     * `readinessUrl`, `recapUrl`, `unsubscribeUrl`), and that URL contains the
     * **raw** bearer token. Everywhere else in this database those tokens exist
     * only as a SHA-256 digest, so an unsealed payload here would be the one
     * place a backup, a replica or a support query hands its reader working
     * credentials — for a mailbox, a password reset, a staff invite or a
     * signed waiver (issue #1297).
     *
     * Null after a terminal outcome, sent or failed; a queued or processing row
     * always carries it.
     */
    payloadSealed: text("payload_sealed"),
    /**
     * The three handles legal erasure needs, lifted out of the payload because
     * it is now sealed and no `->>` can reach inside it (issue #1297).
     *
     * `scrub` (src/db/anonymize.ts, reached from `anonymizeDiver`) has to drop
     * a person's queued mail — a rendered message carrying their name and
     * address — and the only matches it ever had were `payload ->> 'to'` and
     * `payload ->> 'bookingId'`. As real columns those matches are typed, and
     * can no longer silently miss a row whose payload shape drifted. All four
     * nullable, because a kind may carry none of them. None is indexed: the
     * address matches are `lower(...)`, which a plain btree would not serve
     * anyway, and an erasure is rare enough that a sequential scan of one
     * shop's queue is the right cost.
     *
     * None is a new disclosure — every one of them is an address or a number
     * this same tenant already stores in a plaintext column of its own
     * (`people`, `shops`, `course_inquiries`), unlike the payload, which held
     * raw bearer tokens that exist nowhere else un-hashed.
     *
     * **Cleared when a row is finished with, retained while it is only
     * parked.** `sent`, `failed` and `missing_payload` clear all four beside
     * `payload_sealed`, so a row that is done holds nothing — which matters
     * because nothing prunes this table (it is not in `RETENTION_DAYS`), so a
     * `sent` row that kept its recipient would keep it forever. The one
     * exception is `sealed_payload_unreadable`, which keeps the payload *and*
     * the handles on purpose: that row is parked rather than finished, and a
     * parked row that had dropped its handles would be a row an erasure could
     * no longer find. What does the waiting is the drain's own candidate query
     * (`drainableStatus` in src/db/notifications.ts), which re-offers this one
     * code on each daily pass until the row's `recovery_attempts` reach a
     * fortnight's worth — long enough for somebody to notice a mis-set
     * `SECRET_ENCRYPTION_KEY` and put it back (issue #1340).
     *
     * **The exception ends with the waiting.** The pass that takes the row's
     * last attempt parks it clearing all five columns, because past the bound
     * nothing offers the row again: the payload could not be drained by a
     * restored key, and the handles would be keeping a name and an address
     * alive in a table with no window. Parked used to mean kept for good here
     * (H-02; `security-reviewer`). An earlier version of this paragraph
     * claimed a blanket clear and was wrong about two of the four writes
     * (`security-reviewer`, on issue #1298).
     *
     * `booking_id` deliberately carries no foreign key: it is a match handle
     * for a sweep, not a relationship, and a real reference would make an
     * erasure's delete order depend on this queue.
     *
     * **`subject_email` and `subject_phone` are the person the message is
     * *about***, when that is not the person it is addressed to — and null when
     * the two are the same, which is almost every kind. Two are not:
     * `course_inquiry` mails the shop's own front desk about a diver who used
     * the public composer and carries their name, address, phone and free-text
     * message; and `new_account_alert` mails DiveDay about a shop owner.
     * Before these a live row for either survived an erasure until it drained,
     * because neither handle could see it and no `->>` probe can be added to a
     * sealed payload (issue #1298).
     *
     * **Two handles rather than one, because a lead may carry no address at
     * all.** The public composer takes an address *or* a number, so a diver who
     * leaves only a number produces a row a `subject_email` alone still could
     * not reach — the first version of this fix shipped that hole and a
     * `security-reviewer` pass found it. The phone match carries the same
     * accepted over-reach the `course_inquiries.phone` sweep does, and for the
     * same written reason.
     *
     * Both are written from `notificationSubjectEmail`/`notificationSubjectPhone`
     * (`src/lib/notifications/kinds.ts`), and `kinds.test.ts` fails on a kind
     * that declares a contact handle either function has forgotten — so this is
     * not one more thing to remember the next time a subject and a recipient
     * come apart.
     */
    recipientEmail: text("recipient_email"),
    subjectEmail: text("subject_email"),
    subjectPhone: text("subject_phone"),
    bookingId: uuid("booking_id"),
    status: notificationQueueStatus("status").notNull().default("queued"),
    /** Every drain pass that has claimed this row, incremented at the claim. */
    attempts: integer("attempts").notNull().default(0),
    /**
     * The subset of those passes that found the payload unreadable and parked
     * the row again — a counter of its own, because two different bounds used
     * to read `attempts` and they meant different things by it (issue #1719).
     *
     * The fortnight a parked row waits for a restored key is counted here; the
     * three daily passes an ordinary provider failure is retried for are
     * counted by `attempts - recovery_attempts`, which is the number of passes
     * that actually reached a provider. Before this column existed a row that
     * waited a week for its key had already spent the smaller budget, and met
     * its first real failure with none of the three retries that bound exists
     * to give it.
     */
    recoveryAttempts: integer("recovery_attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull(),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    providerMessageId: text("provider_message_id"),
    httpStatus: integer("http_status"),
    errorCode: text("error_code"),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("notification_send_queue_due_idx").on(
      table.status,
      table.nextAttemptAt,
      table.lockedUntil,
    ),
    index("notification_send_queue_shop_status_idx").on(table.shopId, table.status),
  ],
);

/**
 * Singleton team-wide permit clock for a provider needing coordinated
 * per-second throttling. Currently unused — SES's own SDK retry/backoff
 * covers that need (20260803-ses-sole-email-provider) — kept as generic,
 * provider-keyed infrastructure rather than dropped.
 */
export const notificationRateLimitState = pgTable("notification_rate_limit_state", {
  key: text("key").primaryKey(),
  nextAllowedAt: timestamp("next_allowed_at", { withTimezone: true }).notNull(),
});

/**
 * The channel a diver wrote back on. Channel-agnostic on purpose (ADR
 * 20260907-two-way-inbox): `sms` is here from the start although nothing
 * writes it yet — SNS cannot receive a text, and two-way SMS needs a dedicated
 * number through End User Messaging — so the day that lands it is a webhook
 * and not a migration.
 */
export const inboundChannel = pgEnum("inbound_channel", ["email", "sms", "whatsapp"]);

/**
 * What a one-word reply turned out to be asking for (ADR
 * 20260909-reply-keywords). Written by the inbound path when it recognises a
 * keyword, and read by the shop inbox so a row whose whole body is "M" says
 * what it meant. Null — the overwhelming majority — is a message a person
 * wrote in sentences, and nothing about it was interpreted.
 */
export const inboundKeywordIntent = pgEnum("inbound_keyword_intent", [
  "cancel",
  "move",
  "confirm",
  /** `LATE` (J3): the diver told the shop they are running late. */
  "late",
]);

/**
 * A message a diver sent *to* the shop — a reply to a booking confirmation, a
 * WhatsApp "running late", a question from an address nobody has on file (ADR
 * 20260907-two-way-inbox). Every DiveDay message used to be one-way; divers
 * replied anyway and the reply landed in a mailbox nobody read at the counter.
 *
 * Attribution is by address: the receiving route resolves the shop first (the
 * reply-to token for email, the WhatsApp Business Account for WhatsApp) and
 * only then matches `from_address` to a person **inside that shop** — email
 * against `people.email`, a phone against the digits of `people.phone`. No
 * match leaves `person_id` null and the row reads as an unknown sender; it
 * is never guessed across shops.
 *
 * `provider_message_id` is unique per channel, which is what makes a redelivered
 * webhook a no-op rather than a duplicate row. `in_reply_to_delivery_id` is set
 * when a header names the outbound message (email `In-Reply-To`) and that
 * message was one of the tracked kinds; it goes null, not missing, when the
 * delivery trail is pruned.
 *
 * Soft-deleted like everything else (ADR 20260820-every-delete-is-soft): the
 * word on screen is Delete, the row stays. `answered_at` is the inbox's one
 * state — a reply from the record sets it, so does a staffer saying it was
 * handled by phone.
 */
export const inboundMessages = pgTable(
  "inbound_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    /** The diver the address matched, or null for an unknown sender. */
    personId: uuid("person_id").references(() => people.id),
    channel: inboundChannel("channel").notNull(),
    /** The bare address as the provider gave it: a lowercased email, or WhatsApp's digits-only number. */
    fromAddress: text("from_address").notNull(),
    subject: text("subject"),
    body: text("body").notNull(),
    /**
     * How many attachments arrived with it. Recorded, never fetched: the
     * bytes stay with the provider, and the row only says they exist so a
     * staffer knows to look there.
     */
    mediaCount: integer("media_count").notNull().default(0),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
    answeredAt: timestamp("answered_at", { withTimezone: true }),
    providerMessageId: text("provider_message_id").notNull(),
    /**
     * The `Message-ID` header of an inbound email, kept apart from
     * `provider_message_id` (SES's own id, which is what makes a redelivery a
     * no-op). A reply sets `In-Reply-To` and `References` to *this*, which is
     * what makes it land in the diver's thread rather than beside it. Null on
     * every other channel and on a mail that carried none.
     */
    emailMessageId: text("email_message_id"),
    inReplyToDeliveryId: uuid("in_reply_to_delivery_id").references(
      () => notificationDeliveries.id,
      { onDelete: "set null" },
    ),
    /**
     * The keyword this message turned out to be, if it was one at all (ADR
     * 20260909-reply-keywords). Null on every message somebody wrote in
     * sentences, which is nearly all of them.
     */
    keywordIntent: inboundKeywordIntent("keyword_intent"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("inbound_messages_channel_provider_message_unique").on(
      table.channel,
      table.providerMessageId,
    ),
    // The shop inbox: live rows, newest first, unanswered ones leading.
    index("inbound_messages_shop_received_idx")
      .on(table.shopId, table.receivedAt)
      .where(sql`${table.deletedAt} is null`),
    index("inbound_messages_shop_unanswered_idx")
      .on(table.shopId)
      .where(sql`${table.deletedAt} is null and ${table.answeredAt} is null`),
    // The record's thread.
    index("inbound_messages_shop_person_received_idx").on(
      table.shopId,
      table.personId,
      table.receivedAt,
    ),
  ],
);

/**
 * What a staffer wrote back, on the channel the diver wrote in (ADR
 * 20260907-two-way-inbox). Its own table rather than a `notification_deliveries`
 * row because that table is keyed by booking and purpose — one row per
 * booking per kind, the latest state of "did the confirmation land" — and a
 * reply is keyed by a person and a message, of which there may be any number.
 * What it shares with the delivery trail is the outcome vocabulary: the same
 * `notification_delivery_status`, the provider's message id, and the send
 * error, so a failed reply reads exactly like a failed confirmation.
 *
 * `locale` is the language it went out in — the diver's own, falling back to
 * the shop's (ADR 20260731-per-person-notification-locale) — kept so the record
 * can say which. `sent_by_person_id` names the staffer; it stays put on a merge
 * for the reason every staff reference does.
 */
export const staffReplies = pgTable(
  "staff_replies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id),
    /** The message this answers; null once that message is gone, or for a reply started cold. */
    inboundMessageId: uuid("inbound_message_id").references(() => inboundMessages.id, {
      onDelete: "set null",
    }),
    channel: inboundChannel("channel").notNull(),
    toAddress: text("to_address").notNull(),
    body: text("body").notNull(),
    locale: text("locale").notNull(),
    /**
     * The staffer who typed it — **null when DiveDay answered on the shop's
     * behalf**, which is what a keyword confirmation is (ADR
     * 20260909-reply-keywords). Nullable rather than pointed at a synthetic
     * account, because there is no person here and inventing one would put a
     * name on a sentence nobody wrote; the record says "sent automatically"
     * instead.
     */
    sentByPersonId: uuid("sent_by_person_id").references(() => people.id),
    status: notificationDeliveryStatus("status").notNull(),
    providerMessageId: text("provider_message_id"),
    sendErrorCode: text("send_error_code"),
    sendError: text("send_error"),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("staff_replies_shop_person_sent_idx").on(table.shopId, table.personId, table.sentAt),
    index("staff_replies_inbound_message_idx").on(table.inboundMessageId),
  ],
);

/**
 * A shop's own WhatsApp Business sender, connected through Meta's Cloud API
 * (docs ADR 20260802-whatsapp-cloud-api-per-shop). The courtesy text that rides
 * with a trip reminder or recap goes out from *this* number when a row exists,
 * so the diver sees the dive shop they booked with instead of an unfamiliar
 * short code; with no row, the channel falls back to platform SMS.
 *
 * One row per shop, and disconnecting **deletes** it rather than tombstoning
 * like `shop_stripe_accounts.disconnected_at` does. The difference is what the
 * row holds: a Stripe account id is a public identifier worth keeping for
 * history, while the access token here is a live credential that can send as
 * the business. Once a shop says "disconnect", the safest thing to hold is
 * nothing.
 */
export const shopWhatsappAccounts = pgTable(
  "shop_whatsapp_accounts",
  {
    shopId: uuid("shop_id")
      .primaryKey()
      .references(() => shops.id),
    /** Meta's id for the sending number — the path segment of the Cloud API send endpoint. */
    phoneNumberId: text("phone_number_id").notNull(),
    /** The human-readable number Meta reports for it, shown back to staff for confirmation. */
    displayPhoneNumber: text("display_phone_number"),
    /**
     * The WhatsApp Business Account the number belongs to — and the **tenant key
     * for everything inbound**, not merely a support note. Meta names the WABA in
     * `entry[].id` on every webhook delivery, and `shopIdForWhatsAppWaba` is what
     * turns that into the shop whose bookings a reply keyword acts on. The unique
     * index below is why that resolution has one answer: without it a chain
     * completing Embedded Signup for two of its DiveDay shops against one Meta
     * Business put two rows here, and a diver's message — up to a cancellation —
     * landed in whichever came back first (issue #1715).
     *
     * Nullable on purpose, and Postgres lets nulls repeat under a unique index:
     * a row connected before a WABA was recorded stays legal.
     */
    wabaId: text("waba_id"),
    /**
     * The shop's Meta access token, sealed with AES-256-GCM (`src/lib/secret-box.ts`)
     * — never plaintext. This column is the reason `SECRET_ENCRYPTION_KEY` exists:
     * a token here can send messages as the shop's business, so a database dump
     * must not be enough to use it.
     */
    accessTokenSealed: text("access_token_sealed").notNull(),
    /**
     * The six-digit PIN this number was registered with during Embedded Signup,
     * sealed like the token. DiveDay generates it — the shop never types it — but
     * Meta demands the same PIN for any later re-registration, and a shop that
     * cannot re-register is a shop locked out of its own number.
     */
    registrationPinSealed: text("registration_pin_sealed"),
    /**
     * The approved template courtesy messages are sent through, and its Meta
     * language code. Stored per shop rather than hard-coded: WhatsApp requires
     * business-initiated messages to use a template the *shop* got approved, and
     * a shop whose review went through under a different name must still work.
     */
    templateName: text("template_name").notNull(),
    templateLanguage: text("template_language").notNull(),
    connectedAt: timestamp("connected_at", { withTimezone: true }).notNull().defaultNow(),
    /** Set by the settings page's test send, so staff can see the connection was proven, not just saved. */
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("shop_whatsapp_accounts_waba_unique").on(table.wabaId)],
);

/**
 * Each phone number's last word to DiveDay's texting number: STOP or START
 * (ADR 20261007-sms-stop-and-help).
 *
 * Platform-wide, not per shop, and that is the carriers' rule rather than a
 * modeling shortcut: every shop's texts leave from the one DiveDay number, so a
 * diver who answers STOP to one shop's reminder has asked *that number* to stop,
 * and another shop's waiver link from the same number would be the violation.
 * Keyed by the E.164 number the reply came from, which is the same form
 * `smsRecipient` sends to.
 *
 * State rather than presence, with the time the keyword was sent: SNS retries a
 * failed delivery later and in any order, so a START retried after a newer STOP
 * must lose. A reply older than `keyword_at` changes nothing.
 *
 * Nothing else removes a row: not retention, not a diver's erasure, not a shop
 * reset. Each of those would resume texting someone who said stop.
 */
export const smsOptOuts = pgTable("sms_opt_outs", {
  phone: text("phone").primaryKey(),
  optedOut: boolean("opted_out").notNull(),
  keywordAt: timestamp("keyword_at", { withTimezone: true }).notNull(),
});

/**
 * One row per device that opted in to Web Push for one trip's roll call — the
 * third refresh trigger, for a phone that is asleep and can therefore serve
 * neither the SSE stream nor the interval (ADR 20260804-manifest-web-push).
 *
 * Per-trip by design, not per-shop: the subscription expires with the trip it
 * names, which is why there is no separate expiry job for the common case.
 * The departure window is deliberately *not* denormalized here — it is read
 * from the live trip row at send time (src/lib/push-window.ts), because a copy
 * taken at subscribe time could not follow a trip that moved.
 *
 * `endpoint`, `p256dh` and `auth` together are a device credential: anyone
 * holding them can push to that device. They are never returned to a client
 * and never logged.
 */
export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    tripId: uuid("trip_id")
      .notNull()
      .references(() => trips.id, { onDelete: "cascade" }),
    /** The staff member who opted this device in, so a leaver's devices can be dropped. */
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    /** The push service's URL for this device. Unique: re-subscribing updates in place. */
    endpoint: text("endpoint").notNull(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    /**
     * Drives the coalescing window in SQL rather than in process memory, which
     * would not survive a serverless invocation. Null until the first push.
     */
    lastPushedAt: timestamp("last_pushed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // A device has at most one subscription per trip, and re-subscribing (the
    // browser can rotate an endpoint at any time) upserts rather than piling up
    // rows that would each push the same phone.
    uniqueIndex("push_subscriptions_endpoint_trip_unique").on(table.endpoint, table.tripId),
    // The send path's only read: this trip's subscribers, filtered on the
    // coalescing window.
    index("push_subscriptions_trip_pushed_idx").on(table.tripId, table.lastPushedAt),
    // Retention prunes by age, across shops.
    index("push_subscriptions_created_at_idx").on(table.createdAt),
  ],
);

export type ShopWhatsappAccount = typeof shopWhatsappAccounts.$inferSelect;

export type PushSubscription = typeof pushSubscriptions.$inferSelect;
