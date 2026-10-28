/**
 * The narrow complement: every table **outside** the person closure that
 * carries a contact-shaped column, and what the erasure does about it. This is
 * where the class that hid `auth_verifications` has to be decided rather than
 * merely admitted — see limit 3 in `erasure-coverage.test.ts`.
 */
/**
 * The complement, and it is **every** table outside the closure rather than a
 * sample of them.
 *
 * This started as a heuristic — the tables outside the closure carrying a
 * column named like an address — and that was too thin twice over. A table
 * declaring `person_id` **without** `.references(() => people.id)` fell out of
 * the closure *and* out of the pattern, so both tests stayed green over the
 * exact class limit 3 claims to narrow. And a table holding personal data under
 * some other column name entirely was never reachable by any pattern, which is
 * what a `sourcery-ai` review pointed out against the issue's own wording:
 * scope is every table, not the ones a regex thought to ask about.
 *
 * So every table outside the closure is named here with why an erasure is
 * right to leave it. Almost all of them are the shop's own
 * settings or a provider's plumbing, which is exactly why this list is cheap to
 * keep and worth having — a new table lands here the day it is added, and the
 * only way past it is to write a sentence a reviewer can disagree with.
 */
export const OUTSIDE_CLOSURE_REASONS: Record<string, string> = {
  platform_backup_progress:
    "one per-shop operational checkpoint for attempts, successes and leases, with no diver identity; it is deleted with its shop",
  retention_prune_state:
    "global scheduler machinery containing only a table code, no personal data",
  // Reached by text rather than by a key, and swept that way. These two are the
  // worked examples of limit 3: no foreign key ties either to a person, and the
  // erasure finds them anyway because someone knew to look.
  auth_verifications:
    "better-auth's `verification` model: no foreign key at all, names its person as text in `identifier`. The erasure sweeps it by that column, because a pending row holds an address in clear and a live bearer token in `value`",
  notification_send_queue:
    "a queued send, matched on the four handles the row carries beside its sealed payload — `recipient_email`, `subject_email`, `subject_phone` and `booking_id` — which were lifted out of the blob so the sweep never has to open it (#1297, #1298). The payload itself is the one un-normalized blob of personal data in the schema; a work queue, not evidence, so the rows are deleted rather than redacted",

  // The shop's own record of itself. A diver is not on any of these.
  shops:
    "the business: its name, its front-desk address and phone, its timezone and its own words. Erasing a diver does not touch the shop they dived with, except the shore contact's alert address (H-118) and the bookkeeper's month-end address with its confirmation and link (item 35), which the erasure clears when either is the diver's",
  shop_contact_email_confirmation_tokens:
    "the front-desk address's own proof of ownership (issue #1288) — the shop’s address, not a diver’s",
  shop_shore_alert_tokens:
    "the shore contact's confirm and stop links (H-118). No key to a person, but the address can be a diver's: the erasure sweeps the rows by `email`, beside the shop's own `shore_alert_email`",
  shop_whatsapp_accounts:
    "the shop’s own WhatsApp sender: a number, a template and sealed credentials",
  shop_stripe_accounts: "the shop’s Connect account and what it is enabled for",
  stripe_payouts:
    "the shop’s own money leaving its Connect account for its bank: one row per Stripe payout, its amount, fees and the days it covers. No diver is named on a payout; the payments it settles are censused on their orders",
  shop_subscriptions:
    "what the shop pays DiveDay: Stripe ids on DiveDay’s own account, a status, a few dates and the plan’s numbers (ADR 20261022-pricing-ab-test). The business is the customer, never a diver",
  pricing_volume_statements: "a closed month’s volume, rate and fee, as shop_subscriptions",
  shop_integrations: "a provider connection the shop made, and the sealed credentials behind it",
  shop_backup_destinations: "where the shop sends its own backups, and the sealed key to get there",
  shop_backup_deliveries: "whether one of those bundles arrived: a period key, byte count, status",
  boats: "the shop’s vessels",
  claude_usage:
    "one row per Claude call: a feature code, a model, token counts and a cost, with no person and no words",
  claude_call_content:
    "what one Claude call said, kept 30 days: the shop's instructions and context and the request's text, which can quote a diver's message, a duplicate check's names and dates of birth, a gear note or a review, with no key to anyone. Every erasure deletes every row for the shop, since no match finds one diver's words reliably",
  claude_call_content_erasures:
    "when the shop last erased anyone: a shop and an instant, no person",
  assist_results:
    "an assist's answer about the shop: review flag codes and theme titles holding review ids (each quote is read from its review row, so erasing the review erases the quote), and the Monday read's sentences built from shop-wide counts. No person",
  shop_text_translations:
    "the shop's own descriptions and briefings in Spanish, about its trips, courses and sites. No person",
  courses: "the shop’s course catalog, copied from a template and then its own",
  website_setup_drafts:
    "lines Claude read off the shop’s own public website for the owner to accept: shop facts, prices and policies, never a diver",
  waiver_templates:
    "the text a shop asks people to sign, versioned. The *signatures* are `waiver_records`, which the erasure strips and re-seals",
  course_forms: "the course forms a shop asks students to sign, by title and agency code",
  course_form_requirements: "which course asks for which form, and from when",
  trip_lenses: "the shop’s own word for a kind of day",
  trip_series:
    "the cadence a repeating departure is generated from. Its instances are ordinary `trips` rows; its title is renamed with them when an erased diver's own charter carries their name",
  trip_series_skips:
    "a date the shop took out of that cadence, so the nightly roll does not put it back",

  // DiveDay's own catalogue, shared by every shop and owned by none.
  global_dive_sites: "DiveDay’s catalog of sites",
  global_dive_site_versions: "that catalog's own history",

  // DiveDay's own sales funnel (ADRs 20261007-setup-request-form and
  // 20261007-founder-metrics). None belongs to a shop, so no shop's erasure reaches it.
  setup_requests:
    "a shop owner asking DiveDay to set them up: their name, address and phone, sent to DiveDay rather than to any shop. A diver is never on it. It leaves by `deleteSetupRequestsByEmail` / `deleteSetupRequestsByPhone` when that owner asks DiveDay to forget them",
  shop_setup_links:
    "a single-use link DiveDay minted for one setup request: a token hash, its dates and the shop it opened. No name, address or diver; it cascades with its `setup_requests` row when that owner asks DiveDay to forget them",
  demo_entries: "someone opening the demo: a source, a role and a time, and no person",
  shop_milestones:
    "when a shop reached a step of getting started, and whether a stall alert went out. A shop and a date, no diver",

  // Plumbing: provider coordination and delivery ledgers, holding no person.
  notification_rate_limit_state: "provider coordination keyed by ceiling and period",
  stripe_webhook_events: "the platform's delivery ledger, pruned by retention; no payload",
  claude_demo_spend: "a month and every minted demo's Claude spend; no person",
  sms_opt_outs:
    "a phone number that replied STOP, and nothing else. Keeping it after an erasure is what keeps the promise: removing it would let a later booking with that number text someone who said stop",
  media_deletion_attempts:
    "the blob-deletion ledger the erasure itself *writes to* — a URL, a kind and a retry count. Redacting it would be erasing the record of the erasure",
  integration_events:
    "the outbox a shop’s own integrations read. `entity_id` points at a row rather than copying it, and `payload` is built at delivery from the current record — which is the erased one by then",
  integration_deliveries: "whether one of those events reached the provider, and the error if not",
  integration_sync_records:
    "the map from a DiveDay row to the provider’s own object, which is what stops a second QuickBooks Customer being created for a diver already synced (issue #1015). Ids on both sides, no copied details",
};
