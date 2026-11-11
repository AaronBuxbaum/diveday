import { FLY_SAFE_EXPORT_EXCLUSIONS } from "../../export-fly-safe-exclusions";
import { GLOBAL_SEQ_TABLES } from "./export-table-classification.test-support";
import { ROLL_CALL_SPLIT } from "./export-test-fixtures";

/**
 * Columns on an exported table that deliberately stay out of the bundle. The
 * default for anything absent from this map is "must be exported" — a new
 * column has to be argued out, not quietly forgotten. `shop_id` is out on every
 * table (`SHOP_SCOPED`): it is the same value on every row of a single-shop
 * bundle, so a table that excludes nothing else needs no entry. */
export const SHOP_SCOPED = "shop_id";
export const EXCLUDED_COLUMNS: Record<string, string[]> = {
  inbound_messages: ["email_message_id", "in_reply_to_delivery_id", "assisted_at"], // threading plumbing
  roll_call_events: [...ROLL_CALL_SPLIT, "seq"], // seq: as GLOBAL_SEQ_TABLES
  // `shop_id` is the same value on every row of a single-shop bundle.
  shops: [
    "jurisdiction",
    "is_demo",
    "latitude",
    "longitude",
    // Setup-checklist progress, not a shop record (issue #712): a shop
    // restoring from a backup *should* be asked about its units again.
    "units_confirmed_at",
    // Proof the shop controls its contact address, so it may be Reply-To (issue
    // #1288): DiveDay's own, so a restored shop is asked to confirm again.
    "contact_email_confirmed_at",
    // The inbound reply address's routing token (ADR 20260907-two-way-inbox): a credential in all but name, so a restore mints a fresh one.
    "inbound_email_token",
    // H-20261014-stale-roll-call-recipients and item 35: an address, its consent, confirmation and send state; a restore asks afresh. Also `seat_sold_alerted_through` (loop 5, row 8), the seat-sold alert's send cursor.
    "seat_sold_alerted_through",
    "shore_alert_email",
    "shore_alert_consent_at",
    "shore_alert_consent_by_person_id",
    "shore_alert_confirmed_at",
    "bookkeeper_email",
    "bookkeeper_email_set_at",
    "bookkeeper_email_set_by_person_id",
    "bookkeeper_sent_month",
    "bookkeeper_confirmed_at",
    "bookkeeper_confirm_token_hash",
    "bookkeeper_confirm_expires_at",
    "bookkeeper_bounced_at",
    // #2450 name review flags and the offline erasure cutoff are DiveDay-only shop state.
    "name_flagged_at",
    "name_cleared_at",
    "offline_erasure_epoch",
  ], // DiveDay-side config, not shop records
  people: [
    "shop_id",
    // The language a diver reads, as observed from their own request's
    // Accept-Language (docs ADR 20260731-per-person-notification-locale): an
    // inferred signal, not a fact the shop entered, so a CSV can't vouch for
    // one. Null on import falls back to the shop's locale; nothing is lost.
    "locale",
    // Superseded by `origin` (#2726), no longer written; dropped next release.
    "self_registered_at",
  ],
  trips: [
    "shop_id",
    "recap_shoutout", // recap copy travels with recap_photos.csv
    "recap_auto_send_paused", // auto-send countdown / pause is ephemeral operational state
    "recap_auto_send_at",
    // When this installation alerted the owners, and the shore contact (H-20261014-stale-roll-call-recipients),
    // about a stale after-dive roll call: once-per-departure send state, like
    // `recap_auto_send_at`. The roll-call events travel in their own file.
    "roll_call_alerted_at",
    "roll_call_shore_alerted_at",
    // How many times this installation has re-issued the calendar events whose
    // UIDs are `trip-<uuid>@diveday`: a counter about *our* published revisions.
    // A re-imported bundle mints new trip ids and so new UIDs, and no subscriber
    // holds a revision to compare. Same class as `pending_checkout_intent_id`.
    "revision",
    // A pending "the divers still have the old time" between a move and its
    // notice: in-flight messaging state on this installation, cleared by the
    // send, and a re-imported departure has no divers who were told anything.
    ...["divers_told_starts_at", "divers_told_meeting_point"],
    // A rehearsal never reaches the bundle at all (ADR
    // 20261012-rehearsal-departures): every exported departure is a real one,
    // so this column would read false on every row it could appear on.
    "is_rehearsal",
  ],
  trip_series_skips: ["id", "shop_id"],
  ...Object.fromEntries(GLOBAL_SEQ_TABLES.map((table) => [table, ["seq"]])),
  trip_dives: [],
  trip_assignments: [],
  bookings: [
    "shop_id",
    "pending_checkout_intent_id", // in-flight Stripe attempt, meaningless elsewhere
    ...["arrival_trail_after_seq", "seat_reopened_at"], // this database's arrival trail (#2702, #3830)
    "identity_unconfirmed_at", // H-20260724-one-person-per-email review state, not a shop record
    "recap_link_epoch", // revokes this installation's recap links (#3982), meaningless elsewhere
    "identity_booked_as", // H-20260724-one-person-per-email review state: the name the held booking was made under
    "reschedule_missed_from", // a notice owed to a held seat (#2445), cleared once sent
    "reschedule_missed_place", // the same: whether the meeting point moved too
    ...FLY_SAFE_EXPORT_EXCLUSIONS,
    "delivery_email", // a shared inbox's mail address
    // A held seat's desk-recorded emergency contact (#2145), moved at a split.
    "held_emergency_contact_name",
    "held_emergency_contact_phone",
    "paid_rental_kinds", // held-seat prep state: the order lines already carry what was paid for
    // Seat-claim linkage (ADR 20260804-seat-claim-links): a pointer at another booking
    // row's id, which does not survive a re-import, as pending_checkout_intent_id.
    "party_lead_booking_id",
    "claimed_at",
    "contact_typed_by_lead_at", // claim-flow state, as identity_unconfirmed_at (issue #4003)
  ],
  // The member row's surrogate id says nothing beyond (pair_id, booking_id), both exported.
  buddy_team_members: ["shop_id", "id"],
  waiver_seal_acknowledgements: ["shop_id", "state_digest"], // keyed with this installation's seal key
  waiver_records: [
    "shop_id",
    "template_body", // the frozen copy; waiver_templates.csv carries the text
    "token_hash", // bearer credential — never exported; a destination issues its own links
    // Delivery plumbing is provider state: a destination issues its own link and delivery.
    "delivery_status",
    "delivery_provider_message_id",
    "delivery_provider_status",
    "delivery_provider_status_at",
    "delivery_error",
    // The physician's evaluation itself (issue #1252), and the diver's own copy before an answer
    // (`diver_medical_form_url`, issue #2797). The *facts* are exported; the documents are not, for
    // the reason `token_hash` is not: a bundle leaves DiveDay's custody entirely.
    //
    // **Revisited when the read path landed** (issue #1283), and unchanged. The app can now fetch
    // these bytes back — through one permission-gated route, signed as the uploader credential —
    // but the object itself stays private: the media bucket blocks all public access and
    // `medical-clearances/` has no CloudFront behaviour. So a URL in a CSV would still point at
    // something its recipient cannot fetch, and a bundle leaves DiveDay's custody entirely. A
    // broken link in an export is not better than an absent one, and the file being retrievable
    // *inside* the product is precisely why it does not need to travel outside it.
    "medical_clearance_document_url",
    "diver_medical_form_url",
    "doctor_unlock_failures", // retired, undeclared, dropped next release
    "integrity_valid", // cached seal verdict (#2562); integrity_hash itself is exported
    "integrity_checked_at", // when that verdict was taken
  ],
  // `created_at` is when DiveDay wrote the row; `occurred_at` is when the
  // money actually moved, and that is the one a reader replays.
  booking_payment_events: ["shop_id", "created_at", "seq"], // seq: as GLOBAL_SEQ_TABLES
  booking_checkouts: [
    "collection_needs_review", // internal billing evidence hold; source amounts are exported
    "shop_id",
    "deal_id", // written as promo_code_id or trip_promo_id by its deal's kind (#2720)
    "promo_code_id", // retired by #2720 for deal_id, dropped next release
    "trip_promo_id",
    "stripe_account_id", // provider linkage, useless outside this Stripe account
    "stripe_customer_id", // provider linkage, same as stripe_account_id above
    // An ephemeral Stripe Checkout link that stopped resolving when the session
    // expired — same reasoning as tips.checkout_url.
    "checkout_url",
    "stripe_payment_intent_id", // provider linkage for a later refund, same as stripe_account_id
  ],
  // The join row's surrogate id says nothing beyond (checkout_id, booking_id),
  // which are both exported — same reasoning as buddy_team_members.id.
  booking_checkout_bookings: ["shop_id", "id"],
  incident_reports: [
    "shop_id",
    // H-20261016-missing-diver-report-alerts, #2694: send leases and the alert's subject row id, like `roll_call_alerted_at`.
    "missing_alerted_at",
    "missing_all_clear_claimed_at",
    "missing_all_clear_leased_at",
    "missing_subject_row_id",
    "missing_alert_attempting_person_ids", // #2828: a send in flight; the reached set is exported
  ],
  rental_fit_profiles: [
    "shop_id",
    // A DiveDay-side discriminator, not a fact about the diver: it separates a
    // row that states a fit from one holding only their note (schema.ts,
    // `fit_stated_at`). The import rebuilds it correctly on its own — a row
    // carrying any size is a stated fit and `src/features/import/store.ts` stamps it — so
    // exporting it would carry an internal flag out and re-derive it anyway.
    "fit_stated_at",
  ],
  prior_visits: [
    "shop_id",
    // The re-import idempotency key, derived from the columns that *are*
    // exported (src/lib/import.ts, `priorVisitDedupeKey`) — a DiveDay-side
    // implementation detail, not a fact about the shop's history.
    "dedupe_key",
    "created_at", // when the import ran; `imported_at` already carries that
  ],
  imported_payment_history: [
    "shop_id",
    // Re-import machinery, not a source fact; the exported source references
    // and visible fields carry the history elsewhere.
    "dedupe_key",
    "created_at", // `imported_at` is the meaningful import timestamp
  ],
  orders: [
    "shop_id",
    "stripe_account_id", // provider linkage, useless outside this Stripe account
    "stripe_customer_id",
    // Matches a later refund or dispute event to this order; provider
    // linkage like the two above (ADR 20261009-stripe-reversals-reach-diveday).
    "stripe_payment_intent_id",
    // A lock stamp for one Stripe round trip, null on every settled row
    // (ADR 20261009-counter-payments); nothing a shop would read in a backup.
    "counter_claimed_at",
    "auto_void_failed_at", // the nightly void sweep's retry state (issue #2304), not the sale's
    "auto_void_failures", // same
  ],
  tips: [
    "shop_id",
    "stripe_account_id", // provider linkage, useless outside this Stripe account
    "stripe_customer_id", // provider linkage, same as stripe_account_id above
    "checkout_url", // an ephemeral Stripe Checkout link, same reasoning as booking_checkouts
    "stripe_payment_intent_id", // provider linkage, same reasoning as booking_checkouts
  ],
  dive_sites: [
    "shop_id",
    "source_template_id", // provenance into DiveDay's catalog, not the shop's
    "source_template_version",
    // A one-time rollback snapshot for the template-apply interaction. It is
    // DiveDay's temporary UI bookkeeping, not part of the site's portable
    // briefing and must never be restored by an import.
    "template_update_undo",
    // The row's edit generation for the two-tab guard. It counts saves made in
    // *this* installation's editor and means nothing to another one — a shop
    // restoring a bundle wants its briefing back, not the number of times
    // somebody pressed Save. Restoring it would also hand an importing row a
    // generation no rendered page has ever carried.
    "row_version",
  ],
  // Split into shop_promo_codes.csv and trip_last_minute_promos.csv by trip_id.
  deals: [
    "shop_id",
    "stripe_coupon_id", // provider linkage, useless outside this Stripe account
    "stripe_promotion_code_id",
  ],
  // `row_version` for the same reason as `dive_sites` above: it counts saves
  // in this installation's editor and is meaningless in another.
  courses: ["shop_id", "row_version"],
  // The digest is recomputed from the original on import: not the shop's words.
  shop_text_translations: ["id", "shop_id", "source_digest", "created_at"],
};
