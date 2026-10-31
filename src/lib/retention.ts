/**
 * Retention windows for operational tables that otherwise grow forever
 * (DATA-M4/PAY-L2, ADR 20260803-append-only-retention).
 *
 * Framework-free on purpose: this file is nothing but the numbers, the reason
 * for each number, and the arithmetic that turns them into cutoffs. The
 * deletion itself lives in `src/db/retention.ts`; the schedule lives in
 * `src/app/api/cron/retention/route.ts` and `vercel.json`.
 *
 * **The values below are HD-11's decision, not an agent's.** HD-11 owns the
 * retention half of the erasure-versus-signed-evidence question, and nothing
 * here has been through counsel. What is written here is a set of deliberately
 * *conservative* defaults — long enough that no plausible investigation,
 * dispute, or provider retry loses evidence it needed, at the cost of keeping
 * rows longer than a minimal-retention posture would. Shortening any of them
 * is a policy change: edit this one table, say so in the ADR, and nothing else
 * in the codebase has to move.
 *
 * **This mechanism prunes trails, never people.** Every table below is an
 * operational trail entries — webhook events, delivery attempts, activity
 * rows, delivery outcomes, and tokens. No table holding a person lives here;
 * that is a standing decision rather than an omission: DiveDay retains customer
 * and contact data
 * indefinitely and deletes it only when somebody explicitly asks it to
 * (product owner, 2026-08-14). So a dormancy clock on `people` or
 * `interests` — expiring the record of
 * someone who inquired once and never booked — is not something to add here.
 * It was proposed and declined: an interest who books eight months later is
 * ordinary dive-shop behaviour, and the erasure path that does exist is the
 * requested one (`src/db/anonymize.ts`), not a timer. The one exception is
 * `setup_requests`: a shop asking DiveDay to be set up is nobody's customer
 * yet, so no shop's record or erasure reaches it, and its window is argued
 * beside its number below (code review 2026-10-11, item 14).
 *
 * **`certification_junior_reviews` is deliberately unbounded.** The owner's
 * decision on #2810 (2026-10-27) requires corrections to stay with the card.
 * Erasure removes the person's evidence, and deleting the card cascades it.
 *
 * **`gear_service_events` is deliberately unbounded and does not belong here.**
 * It is append-only and its value is evidentiary rather than operational: a
 * unit's service, hydro-test and inspection history is what answers "was this
 * regulator serviced on schedule?" long after the dive it was carried on. A
 * window would delete exactly the rows that question reaches for. The history
 * is already bounded by the thing it describes — deleting a unit cascades its
 * events away, retiring one keeps them — and the volume is a few hundred rows a
 * year for a large fleet, so nothing about growth argues the other way. Chosen
 * by the product owner, 2026-08-20, over a 1825-day-past-retirement window.
 *
 * **`trip_stage_events` is deliberately unbounded and does not belong here
 * either.** The five words a crew taps carry no diver data — a shop, a trip, a
 * stage code, a dive-site id, the staff person who tapped, an instant — so the
 * erasure half is answered by the live join to `people` rather than by a
 * window: a redacted staffer's name leaves every reading without a row moving.
 * Growth is a handful of rows per departure, and every reader takes only the
 * newest one (`latestTripStage`, `latestTripStagesByTrip`), so
 * the trail is dead weight operationally — which is the whole of the argument
 * for a window. Against it is `gear_service_events`' argument on a table with
 * more rows: the trail may become evidentiary, "when did the crew say this boat
 * was heading in?" is a question an incident review asks a year later, and any
 * window short enough to matter for growth deletes exactly those rows. It comes
 * out the same way. Chosen by the product owner, 2026-09-10, over a 30-day
 * window matching `trip_desk_events` (issue #1397).
 *
 * **The roll-call and pairing trails are deliberately unbounded too**, and
 * their argument is written where each is declared rather than here: a roll
 * call, a crew's own check-in, an arrival tap at the desk and a buddy pairing
 * are safety evidence about a departure, so a window would put an expiry on
 * the answer to "who was on this boat, and who were they with?" exactly when
 * an old incident is being reconstructed. Erasure reaches all four through the
 * live join to `people`, so nothing here outlives a diver's request either.
 * Decided with the trails themselves (`buddy_team_events`,
 * `roll_call_events`, `roll_call_crew_events`, `booking_arrival_events`; ADR
 * 20260804-buddy-teams, and the docblock over each table in
 * `src/db/schema.ts`, which points back at this file for the statement this
 * paragraph now makes).
 *
 * **`pre_departure_check_events` is deliberately unbounded too.** It is the
 * pre-departure safety check (ADR 20260824-pre-departure-safety-check): who
 * confirmed each item of the shop's own checklist (life jackets, oxygen, the
 * radio) before a boat left, and when. That is the document an insurer or an
 * investigator asks for after an incident, and an incident is reconstructed
 * long after any window short enough to matter for growth. It is one row per
 * tap on a departure, so it grows with the schedule, not with traffic. Classified on the dive-domain
 * review of code review 2026-10-13 (layer B), which moved it here from the
 * out-of-scope list.
 *
 * **`trip_change_events` and `review_moderation_events` are deliberately
 * unbounded too.** The first is who changed a departure's plan and how (its
 * meeting point, its conditions); the second is who published or hid a
 * review and why. The shop activity log reads both as the record itself
 * (PR #2310), and the moderation trail is also what answers "how much of this
 * shop's record has been suppressed?" for as long as the reviews it describes
 * are shown (ADR 20260813-review-moderation-has-a-floor). A window would leave
 * a departure or a review the shop still has with a hole in its history and
 * free almost nothing: both grow with the shop's own departures and reviews,
 * not with traffic. Both hold free text a staffer typed (a meeting point's
 * label, a moderator's `reason_note`), which can name a diver, so erasure
 * redacts what names them (`scrubDepartureChangeTrail` and `scrubReviews` in
 * `src/db/anonymize.ts`); the staffer who acted is a `people` reference
 * resolved live, so erasure reaches them without a row moving. Chosen by the product owner, 2026-10-13, over the `activity_events`
 * window (issue #2316).
 *
 * **`notification_send_queue` empties its own rows of personal data, and the
 * window below only bounds what is left.** It holds a rendered outbound
 * message, a recipient and a subject's address and phone while a row is being
 * worked, and every write that finishes a row (`sent`, `failed`,
 * `missing_payload`, and the park that spends a parked row's last attempt)
 * nulls the payload and all four handles. That is an invariant rather than an
 * observation: `src/db/notifications.ts` states it at each of those writes and
 * `notifications.test.ts` pins it, and if a fifth terminal write ever keeps a
 * handle, the answer is to clear it there. What a finished row still holds is
 * a status, an idempotency key and two instants, one per notification ever
 * sent, so the table grew with traffic for ever; its window (code review
 * 2026-10-11, item 14) takes only finished rows, never one the drain could
 * still offer again.
 *
 * **What is kept for ever, by decision, outside this list.** The event-like
 * trails that carry no window, one line each, so "how long is X kept?" has an
 * answer for every one of them; ADR 20260803-append-only-retention carries the
 * same list. Safety records about a departure: `roll_call_events`,
 * `roll_call_crew_events`, `booking_arrival_events`, `buddy_team_events`,
 * `trip_stage_events`, `pre_departure_check_events` (argued above). Equipment evidence:
 * `gear_service_events` (argued above). Records of who changed what on a
 * departure, a review or a ticket, read as the record itself:
 * `trip_change_events`, `review_moderation_events` (argued above),
 * `work_order_events`. Queues and obligations deleted by their own work:
 * `held_sends` (its own sweep, `src/db/held-sends.ts`) and
 * `media_deletion_attempts`. Kept as the record of an erasure's outside work:
 * `processor_erasure_obligations`, which nothing prunes; a discharged row is
 * the attestation (ADR 20260803-processor-erasure-obligations). Signed
 * evidence H-02 has not ruled on: `waiver_records` and the course-form
 * records.
 */

import { DAY_MS } from "@/lib/clock";

/**
 * How long Stripe itself keeps retrying a webhook delivery in live mode
 * (Stripe retries with exponential backoff for up to three days). Named here
 * because {@link RETENTION_DAYS}'s `stripe_webhook_events` window has to sit
 * *comfortably* above it and the reason must not be a comment somebody can
 * edit away — `retentionWindowsOutlastStripeRetries` asserts the relationship
 * and a unit test holds it.
 */
export const STRIPE_WEBHOOK_RETRY_DAYS = 3;

/**
 * The tables this mechanism prunes. Adding one here is a deliberate act: it
 * needs a window below and a delete arm in `src/db/retention.ts`, and both
 * are code review surface.
 */
export type RetainedTable =
  | "stripe_webhook_events"
  | "integration_events"
  | "integration_oauth_states"
  | "notification_deliveries"
  | "notification_delivery_attempts"
  | "activity_events"
  | "account_tokens"
  | "account_sessions"
  | "account_sign_in_challenges"
  | "shop_contact_email_confirmation_tokens"
  | "shop_shore_alert_tokens"
  | "booking_capabilities"
  | "booking_payment_events"
  | "push_subscriptions"
  | "trip_desk_events"
  | "trip_read_marks"
  | "today_read_marks"
  | "form_drafts"
  | "demo_entries"
  | "inbound_messages"
  | "staff_replies"
  | "weekly_digest_sends"
  | "shop_backup_delivery_claims"
  | "claude_usage"
  | "claude_call_content"
  | "assist_results"
  | "website_setup_drafts"
  | "crew_notices"
  | "notification_send_queue"
  | "waiver_deliveries"
  | "setup_requests"
  | "email_bounces"
  | "incident_reports"
  | "lost_items"
  | "departure_notes";

/**
 * The append-only trails this mechanism deliberately leaves unbounded, as a
 * list something other than a paragraph can read.
 *
 * Every name here is argued in a paragraph of this file's docblock above, and
 * that is the whole of the point: a trail joins this list because somebody
 * decided in writing that its rows outlive any window, never because a test
 * wanted the name somewhere. `src/db/retention.test.ts` holds both halves —
 * that no schema table is missing from every classification, and that no name
 * here is missing its paragraph and the decision that paragraph cites.
 * Whether the argument is any *good* is a reviewer's call, not a test's.
 */
export const UNBOUNDED_BY_DECISION: readonly string[] = [
  "certification_junior_reviews",
  "gear_service_events",
  "trip_stage_events",
  "buddy_team_events",
  "roll_call_events",
  "roll_call_crew_events",
  "booking_arrival_events",
  "pre_departure_check_events",
  "trip_change_events",
  "review_moderation_events",
];

/**
 * The one place a human changes how long each trail is kept, in days.
 *
 * Every window is measured from the row's own event time, not from when it was
 * written — see `src/db/retention.ts` for which column each arm uses.
 */
export const RETENTION_DAYS: Readonly<Record<RetainedTable, number>> = {
  /**
   * 400 days. This one is **not** a convenience window. A
   * `stripe_webhook_events` row does two jobs (see its schema docblock): it is
   * the dedup claim, and it is the chronological evidence
   * `hasNewerAccountUpdate` reads to refuse a stale `account.updated`. Pruning
   * a row inside Stripe's own retry window would let an older redelivery read
   * as fresh and regress `charges_enabled` — fail-open on the flag that gates
   * order and checkout creation. 400 days is ~133× {@link
   * STRIPE_WEBHOOK_RETRY_DAYS}, covers a full year of "what did Stripe tell us
   * about this account?" plus an annual-review margin, and is the longest
   * window here for a table that holds no diver data at all (event ids, types,
   * connected-account ids, timestamps).
   */
  stripe_webhook_events: 400,
  /**
   * 400 days. Integration event payloads are provider delivery evidence, but
   * can also contain customer/order fields needed for a retry. Keep them for
   * the same season-plus-year window as provider delivery trails; cascading
   * deletes remove their delivery rows at the same time.
   */
  integration_events: 400,
  /**
   * 2 days after expiry. OAuth state is hash-only and one-use, but a stale
   * callback should not leave short-lived login records accumulating forever.
   */
  integration_oauth_states: 2,
  /**
   * 400 days. This is the current delivery outcome a shop uses to answer
   * whether a message reached a diver. It is mutable latest state rather than
   * append-only history, but its provider detail and send error are still
   * operational trail data and must not remain unbounded.
   */
  notification_deliveries: 400,
  /**
   * 400 days. The durable proof that a shop did (or did not) reach a diver —
   * the record a "you never told me the trip was cancelled" conversation turns
   * on. A season plus a full year, so last year's incident is still answerable
   * during this year's same week. Carries provider message ids and error
   * codes, not message bodies.
   */
  notification_delivery_attempts: 400,
  /**
   * 1095 days (3 years). Staff-facing operational history in human language:
   * who moved a booking, who cancelled a departure. Longest-lived because it
   * is the narrative a shop reconstructs an old season from, and it is small
   * (one short row per operational act).
   *
   * It is also the longest window on personal data anywhere here: `params`
   * holds the actor's and the diver's names as words (`src/lib/activity.ts`),
   * not ids resolved live. Erasure redacts them on request, by id and by name
   * (`src/db/anonymize.ts`); this window bounds only what nobody asked to
   * erase. ADR 20260803-append-only-retention says the same.
   */
  activity_events: 1095,
  /**
   * 90 days **past each token's own expiry**, not past its creation. These are
   * hashed bearer credentials over account takeover, so the conservative
   * direction here is the opposite of the tables above: keep them long enough
   * to answer "was this reset link ever issued/used?" during an incident
   * review, and no longer. Only already-expired rows are ever eligible — a
   * live token is never pruned regardless of age.
   */
  account_tokens: 90,
  /**
   * The same 90 days past each session's own `expires_at`. A session row is a
   * sign-in on one device, and it carries that device's IP address and user
   * agent; nothing deleted it except signing out, revoking it, or erasure, so
   * a staffer who never signed out kept one such row per device for ever. The
   * incident question it answers ("which device was signed in to this
   * account?") is the same one `account_tokens` keeps its 90 days for, and a
   * session the auth layer still honours is never eligible: the clock is the
   * expiry, which every use slides forward.
   */
  account_sessions: 90,
  /** Pending proof ends at expiry; bounded issuance and weekly sweeps remove expired rows. */
  account_sign_in_challenges: 0,
  /**
   * The same 90 days past `expires_at` as `account_tokens`, for the same shape
   * of row: a hashed one-time link (issue #1288) that is dead the moment it is
   * spent, superseded, or expired, and that carries the shop's front-desk
   * address -- a business address, but still one with no reason to sit in a
   * table forever.
   */
  shop_contact_email_confirmation_tokens: 90,
  /**
   * A year from `created_at` (H-118 review): the shore contact's confirmation
   * links and the stop link every roll-call alert carries. A stop link never
   * expires on its own, because an opt-out that stops working leaves somebody
   * unable to stop the mail; a year is longer than any shop goes between
   * alerts, and each alert brings a fresh one. The rows hold the address, so
   * they do not sit forever either.
   */
  shop_shore_alert_tokens: 365,
  /**
   * The same 90 days past `expires_at` again (H-82, issue #1726): a booking
   * link — readiness, confirm, claim, handoff, course forms — is a hashed
   * bearer credential, and the readiness and confirm pages mint one per tap,
   * so the table grows with traffic rather than with bookings. Revoking a row
   * does not delete it, so without a window every retired link stayed forever.
   *
   * **A link that still works is never eligible**: the clock is the row's own
   * expiry, never `revoked_at` or its age, so the window starts only once
   * the link has stopped working and can never cut into its life. What ends 90 days after expiry is the dead-link page's
   * courtesy — naming the shop that issued it (issue #801) and offering a fresh
   * link to the address on the booking (issue #850). A link that old is a past
   * trip's, and the page falls back to its plain notice.
   */
  booking_capabilities: 90,
  /**
   * 2555 days (7 years). The local money ledger DATA-M3 exists to provide;
   * matched to the ordinary financial-records horizon rather than to anything
   * operational, because the whole point of the table is that it outlives the
   * mutable `booking_payments` row it records. Listed here rather than left
   * unbounded so that "how long is a shop's money history kept?" has an answer
   * in the same table as every other trail.
   */
  booking_payment_events: 2555,
  /**
   * 30 days. The shortest window here, and deliberately so: a
   * `push_subscriptions` row is a *device credential* (endpoint plus the two
   * keys a push is encrypted to), not a record anyone needs later. It is useful
   * only while its trip is near departure, so a row a month past its creation
   * has no remaining purpose and is pure blast radius if the database is ever
   * disclosed.
   *
   * The common cases are already handled elsewhere and this is the backstop for
   * what they miss: the trip's ON DELETE CASCADE clears rows when a departure is
   * deleted, a 404/410 from the push service prunes retired endpoints on sight,
   * and `removeStaffMember` revokes a leaver's devices. None of those fire for a
   * device that simply stopped being used.
   */
  push_subscriptions: 30,
  /**
   * 30 days, and the shortness *is* the feature (issues #1202, #1187). A desk
   * event is a same-day handoff: who arrived, whose seat moved, who asked the
   * crew for a hand. Nothing reads one after the boat is home, and a per-person
   * catch-up that could still be replayed a season later is precisely the
   * surveillance feed #1202's boundary refuses. The row carries no prose and no
   * name — only a code and a `people` reference resolved live — so what a month
   * of these can tell anyone is already bounded; this bounds how long.
   */
  trip_desk_events: 30,
  /**
   * The same 30 days, measured on `last_seen_at`, for the marks that point into
   * those events. A mark that outlives every event it points past says nothing,
   * and there is nothing else to keep it alive: the trip cascade never fires
   * because `deleteTrip` is soft.
   */
  trip_read_marks: 30,
  today_read_marks: 30,
  /**
   * 1 day. What a staffer had typed into a form when they were interrupted
   * (ADR 20260906-before-you-ask, decision 3): the reader already drops a draft
   * older than this, so the prune only takes out what nobody can see.
   */
  form_drafts: 1,
  /**
   * 400 days. A demo entry is a funnel tag, a role and an instant — nothing
   * about a person — kept so the founder digest can count the demo by source
   * (ADR 20261007-founder-metrics). A year plus a season is enough to compare a
   * week with the same week last year; nothing older is read.
   */
  demo_entries: 400,
  /**
   * 400 days, the same window as `notification_deliveries` and for the same
   * reason: a diver's reply and the shop's answer are the other half of the
   * "you never told me" conversation that trail exists to settle, and a
   * season plus a year keeps last year's exchange answerable during this
   * year's same week (ADR 20260907-two-way-inbox). These rows carry a diver's
   * own words and the address they wrote from, which is the argument for a
   * window at all rather than for a shorter one — a shop that needs longer
   * has the record's notes, and erasure clears them on request regardless.
   */
  inbound_messages: 400,
  /** Measured on `sent_at`; a reply outliving the message it answered says nothing. */
  staff_replies: 400,
  /**
   * 400 days, measured on `created_at`. A row is the claim that keeps the
   * Monday email to one per person per week, plus the hash of the opt-out
   * link that week's email carried. The claim stops mattering the moment its
   * week ends; the link is what decides the window. A year-old email's
   * "turn this off" still works for a season and a year, the same horizon the
   * delivery trail keeps, and every newer email carries a live one of its own.
   */
  weekly_digest_sends: 400,
  /**
   * 400 days from completion, or from lease expiry when an attempt never
   * completed. The composite shop/week claim fences concurrent uploads and
   * must outlive the successful-delivery write; keeping a full season plus
   * year preserves that history while bounding one row per scheduled week.
   * Incomplete rows without a lease timestamp are retained because their
   * eligibility cannot be established safely.
   */
  shop_backup_delivery_claims: 400,
  /**
   * 400 days, measured on `created_at`. A row is one Claude call's token
   * counts and cost (ADR 20261018-claude-assists): codes and numbers, nobody's
   * words. The cap reads only the current month and the usage guardrail only
   * the current month too; a year and a season is room to compare this
   * month's bill with last year's same month, and nothing reads further back.
   */
  claude_usage: 400,
  /**
   * 30 days, measured on `created_at`. A row is what one Claude call said:
   * the instructions, the shop context, the request with every image and
   * document a placeholder, and the answer (Aaron, 2026-10-23). It holds
   * divers' words, kept only so the founder can find out why an assist
   * answered what it did; a problem is found within a month or not by reading
   * old prompts. The cost row beside it (`claude_usage`) keeps its 400 days.
   */
  claude_call_content: 30,
  /**
   * 400 days, measured on `updated_at`. A row is one assist's answer about
   * the shop (review chip codes, a month's review themes, a week's Monday
   * read). The themes page reads this month's and the queue reads pending
   * reviews; a year and a season keeps last year's same month to compare.
   */
  assist_results: 400,
  /**
   * 90 days, measured on `read_at`. A row is the lines Claude read off the
   * shop's own website for the owner to accept or dismiss (the `setup`
   * assist): shop facts, never a diver. What the owner accepts lives on in the
   * shop's own settings; a reading nobody came back to for a season is stale
   * against the site it came from.
   */
  website_setup_drafts: 90,
  /**
   * 30 days, measured on `created_at`. A row is crew news waiting for the
   * hourly pass (ADR 20261009-crew-hear-about-their-boats), and it is spent
   * the hour it settles: the crew list itself is `trip_assignments`, and what
   * was sent is the delivery trail's to remember. A month is room to ask
   * "did the pass tell Ana?" and nothing more.
   */
  crew_notices: 30,
  /**
   * 90 days, measured on `updated_at` (the instant the row was finished), and
   * only rows that are finished: `sent`, or `failed` with the payload already
   * cleared. A parked `sealed_payload_unreadable` row keeps its payload while
   * the drain may still offer it again, so it is never eligible. A finished row
   * holds no personal data (the paragraph at the top of this file); what it
   * holds is the idempotency key, and three months is far past the moment any
   * producer would queue the same notification twice. What was sent is the
   * delivery trail's to remember (`notification_deliveries`, 400 days).
   */
  notification_send_queue: 90,
  /**
   * 400 days, measured on `attempted_at`. A row is the latest delivery outcome
   * of one waiver link on one channel: the provider's message id and, on a
   * bounce, the provider's own words. It is the same kind of row as
   * `notification_delivery_attempts` and answers the same question ("did the
   * shop ever reach me about the waiver?"), so it keeps the same season plus a
   * year. The signed waiver itself is `waiver_records`, which no clock touches.
   */
  waiver_deliveries: 400,
  /**
   * 365 days, measured on `created_at`. A row is a shop asking DiveDay to be
   * set up: a name, an email, an optional phone, from a person who is not yet
   * anybody's customer (ADR 20261007-setup-request-form). A year is a full
   * season to follow the lead up; a request that never became a shop has no
   * reason to sit here after that, and one that did lives on as the shop. Its
   * single-use setup link is deleted with it (`on delete cascade`), and is long
   * expired by then. This reverses that ADR's "kept until someone asks" for
   * this one table (code review 2026-10-11, item 14); `people` and
   * `interests` keep the product owner's 2026-08-14 decision above.
   */
  setup_requests: 365,
  /**
   * 90 days, measured on when SES reported it. A row is an address in clear
   * beside the reason its mail bounced or was complained about, kept so
   * DiveDay can debug its own delivery. A quarter is long enough to see a
   * pattern and to ask a shop about one; SES's own suppression list, not this
   * table, is what stops the next send to a hard-bounced address.
   */
  email_bounces: 90,
  /**
   * 2555 days (7 years), measured from when the incident happened (a draft
   * that never said when is measured from when it was started). A record, not
   * a trail, and listed here for the reason `booking_payment_events` is: the
   * window is liability-driven, so "how long does a shop keep an incident
   * report?" needs a stated answer (ADR 20261012-incident-reports). The people
   * in a report and its addenda go with it by cascade. Erasure does not wait
   * for this: `anonymizeDiver` redacts a diver's identity in a report at once.
   */
  incident_reports: 2555,
  /**
   * 90 days **past being resolved** (batch 4, J2). An item found aboard is
   * the shop's to hold while it is `open`, so an open one is never eligible
   * however old; once it went home (`returned`) or was given up on
   * (`discarded`), the row is a note about somebody's belongings with nothing
   * left to do, and a season's margin is room to answer "did my mask turn up?".
   */
  lost_items: 90,
  /**
   * 400 days, the notification trails' own window (batch 4, J4). A note to a
   * whole departure is the record a "nobody told us the lot was closed"
   * conversation turns on, and it is answerable for as long as the deliveries
   * it describes are.
   */
  departure_notes: 400,
};

/**
 * The most rows one prune **batch** may delete from a table: a bound per
 * statement pair, not per run. The weekly run (`vercel.json`, Sundays 03:30
 * UTC) keeps taking batches from a table still over its window until it is
 * inside it or the run's time budget is spent (`PRUNE_TIME_BUDGET_MS`,
 * `src/db/retention.ts`), so a backlog drains in one run rather than at 5,000
 * rows a week. A table still `capped` when the budget runs out logs
 * `cron_retention.prune_capped`, which alarms: the backlog then exceeds about 45
 * seconds of deletes, and the fix is a faster arm or a more frequent run.
 */
export const PRUNE_BATCH_LIMIT = 5_000;

/**
 * **A lunch note is cleared this many days after its boat sailed** (fifth-loop
 * ideas, item 56; security review N5). Its one purpose is that day's galley,
 * and a diver's own words about what they eat say something about their
 * health or faith, so the column is nulled rather than kept with the booking.
 * Not a row prune: the booking itself stays. The window leaves room for a
 * dispute about the day and for the trip's own record to be read back.
 */
export const DIETARY_NOTE_RETENTION_DAYS = 30;

/** Daily UTC sweep, shared with its Sentry monitor; deployment parity is tested. */
export const DIETARY_RETENTION_CRONTAB = "9 3 * * *";

/**
 * Strict eligibility cutoff, not a maximum residence guarantee: the daily sweep
 * normally clears notes on its next run, later if runs are missed or capped.
 */
export function dietaryNoteCutoff(now: Date): Date {
  return new Date(now.getTime() - DIETARY_NOTE_RETENTION_DAYS * DAY_MS);
}

/** The instant before which rows of `table` are eligible for deletion. */
export function retentionCutoff(table: RetainedTable, now: Date): Date {
  return new Date(now.getTime() - RETENTION_DAYS[table] * DAY_MS);
}

/**
 * True when the Stripe webhook window still outlasts Stripe's own retry
 * window by the stated safety factor. The review that raised PAY-L2 named this
 * exact hazard, so it is asserted rather than commented: shortening
 * `stripe_webhook_events` below it must fail a test, not a code review.
 */
export function retentionWindowsOutlastStripeRetries(safetyFactor = 10): boolean {
  return RETENTION_DAYS.stripe_webhook_events >= STRIPE_WEBHOOK_RETRY_DAYS * safetyFactor;
}
