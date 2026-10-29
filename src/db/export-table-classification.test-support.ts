/**
 * Deliberate exclusions — each must be defensible in the bundle README and on
 * the export page, and as of ADR 20260806-export-operational-records each must
 * clear that record's rule: a table stays out only when carrying it would be a
 * credential, a pointer into infrastructure the destination cannot reach, or
 * DiveDay's own bookkeeping about its own machinery. "Not in this first slice"
 * is not a reason — that is exactly what `internal_notes` sat on for a fortnight
 * before DATA-A10 forced the question. Adding a schema table without deciding
 * its export fate fails the coverage test below.
 */
export const EXCLUDED_TABLES = [
  "retention_prune_state", // global scheduler cursor, no tenant or personal data
  "platform_backup_progress", // one shop-scoped scheduler checkpoint, not portable shop data
  // record, mirrored here only so an owner sees an open one on Today and on
  // the order; every field is Stripe's, kept current from Stripe's events, and
  // the shop's Stripe dashboard is where a dispute is answered and exported.
  // The money it concerns is already on orders.csv and booking_checkouts.csv.
  "payment_disputes",
  // Stripe payouts (ADR 20261012-payouts-reach-diveday), on the same footing:
  // Stripe's own record of money it moved to the shop's bank, mirrored so
  // Reports can name it, and exported from the shop's Stripe dashboard.
  "stripe_payouts",
  // Failed refunds (issue #2291): Stripe's record of a refund that bounced,
  // mirrored so the Orders index can say who is owed. The money it moved is
  // already on orders.csv and booking_checkouts.csv (`refunded_cents`).
  "stripe_refund_failures",
  // Historical assignments are source evidence attached to the gear-history
  // import, not a live reservation or booking record. They remain in the
  // shop database and are intentionally not part of the current full-shop
  // export contract until that export has a matching assignment file.
  "prior_gear_assignments",
  // The buddy-team pairing trail (ADR 20260804-buddy-teams). The *standing*
  // teams a shop would carry to another system are already exported as
  // buddy_pairs.csv; this is the history of how they got that way.
  "buddy_team_events",
  "notification_delivery_attempts", // per-attempt retry mechanics behind notification_deliveries.csv, which carries the outcome
  // The inbox (ADR 20260907-two-way-inbox). Correspondence *is* a shop record,
  // and these two are out for a narrower reason than the rows around them: the
  // bundle has no file for a conversation yet, and a message a diver sent is
  // bounded by the same 400-day retention window as the delivery trail beside
  // it, so nothing here outlives the evidence it answers. Carrying them out is
  // a follow-up with its own file shape (issue filed with the inbox change),
  // not a column on an existing one.
  "inbound_messages",
  "staff_replies",
  "inbox_saved_answers", // the inbox's saved replies, out with the inbox they serve
  // Which way each waiver link was handed over and what happened on that
  // channel. The outcome another system could act on is already on
  // waiver_records.csv (`delivery_status` and the provider columns beside it);
  // these rows are the per-channel mechanics behind it, so they are out for
  // exactly the reason notification_delivery_attempts is.
  "waiver_deliveries",
  "notification_send_queue", // operational retry state, not shop records
  "email_bounces", // DiveDay's own record of mail SES bounced, for debugging delivery; not a shop record
  // Batch 4's two desk records. A note sent to a whole departure is
  // correspondence, out for the reason staff_replies is: the bundle has no file
  // for a message yet, and the 400-day window bounds it like the delivery trail
  // beside it. A found item is a shelf the shop is holding for somebody, pruned
  // 90 days after it goes home; there is nothing in it another system would
  // import. Both are follow-ups with their own file shape if a shop asks.
  "departure_notes",
  "lost_items",
  // What the bench told a customer and how it went (ADR
  // 20261008-work-order-follow-up): a kind, a channel and a delivery status,
  // the same plumbing notification_delivery_attempts is. The ticket and the
  // piece it was about export in their own files.
  "customer_gear_notices",
  // Per-device Web Push credentials (ADR 20260804-manifest-web-push). Excluded
  // for two independent reasons: they are meaningless in another system — an
  // endpoint is issued by a browser vendor to one installed app on one device,
  // and cannot be transferred — and the endpoint/p256dh/auth triple is a
  // *credential*, so writing it into a portable bundle would spread the ability
  // to push to a captain's phone anywhere that bundle goes.
  "push_subscriptions",
  "trip_blowouts", // operational cascade record for a weather cancel; the cancellation itself lives on the trip
  "trip_blowout_divers", // per-diver message/rebooking state for that cascade — same reasoning as notification_send_queue
  "notification_rate_limit_state", // provider coordination, not shop records
  "shop_stripe_accounts", // provider linkage, useless outside Stripe
  // What the shop pays DiveDay (ADRs 20261007-subscription-billing, 20261022-pricing-ab-test):
  // DiveDay's own billing of the shop, not a record the shop keeps. Ids on DiveDay's
  // Stripe account mean nothing elsewhere; the invoices are Stripe's, emailed to the owner.
  "shop_subscriptions",
  "pricing_volume_statements",
  "payment_operation_intents", // internal reconciliation ledger, not a shop record (CR-005)
  "claude_demo_spend", // what every minted demo together spent on Claude; no shop's record
  "stripe_webhook_events", // provider webhook-delivery ledger, not a shop record — same reasoning as payment_operation_intents
  "sms_opt_outs", // the platform texting number's STOP list, not one shop's record (ADR 20261007-sms-stop-and-help)
  "media_deletion_attempts", // internal reconciliation ledger, not a shop record (CR-012)
  // The "what erasure still owes at Stripe" ledger. Not a shop record: every row
  // is a pointer into *this* Stripe account (`cus_…`/`in_…`) plus the state of
  // work done there, both meaningless in another system — the same reasoning as
  // shop_stripe_accounts. Deliberately not exported for a second reason too: an
  // outstanding obligation is the shop's own compliance state, and shipping it
  // into a portable bundle would carry it somewhere nobody can discharge it
  // (ADR 20260803-processor-erasure-obligations).
  "processor_erasure_obligations",
  // A shop asking DiveDay for a species the field-guide catalog does not carry
  // (ADR 20260813-marine-life-is-diveday-copy). Correspondence with the vendor
  // rather than a shop record: it says nothing about a diver, a booking or a
  // departure, and "we asked DiveDay for a seahorse" is not a fact another
  // system can do anything with. Same reasoning as shop_stripe_accounts --
  // meaningless outside this vendor relationship.
  "marine_life_requests",
  "global_dive_sites", // DiveDay's shared catalog; the shop's copies export
  "global_dive_site_versions",
  "user_accounts", // credentials are never exported
  "booking_capabilities", // bearer credentials, never exported — same reasoning as user_accounts
  "account_tokens", // bearer credentials (email verify / password reset), never exported
  "account_sign_in_challenges", // pending authentication capabilities, never exported
  "account_sessions", // a live sign-in session — more sensitive than a bearer token, never exported
  "account_security", // TOTP seeds and recovery-code hashes are credentials
  "account_step_ups", // short-lived second-factor grants are credentials
  // better-auth adapter scaffolding, functionally unused (no OAuth, no
  // built-in email/password flow — src/lib/auth.ts) but still credential-
  // shaped by name, same reasoning as user_accounts.
  "auth_provider_accounts",
  "auth_verifications",
  "calendar_feeds", // bearer credentials for a staff calendar subscription, never exported
  "interest_unsubscribe_tokens", // bearer credentials, never exported — same reasoning as booking_capabilities
  "person_courtesy_email_unsubscribe_tokens", // bearer credentials, never exported — same reasoning as booking_capabilities
  "crew_notices", // crew news waiting to be told, and the stamp of when it was — delivery plumbing; the crew list itself is exported as trip_assignments
  "website_setup_drafts", // proposals read off the shop's public website, waiting for the owner's tap — a working draft, and what it accepts is exported where it lands
  "claude_usage", // token counts and cost codes for Claude calls — DiveDay's billing ledger, not the shop's records
  "claude_call_content_erasures", // when the shop last erased anyone, for the content above; machinery, no shop record
  "claude_call_content", // what Claude calls said, kept 30 days for DiveDay's founder to debug; DiveDay's working log, not the shop's records, and never carried out of DiveDay
  "assist_results", // what an assist answered (review chips, themes, the Monday read): derived, and asked again on demand
  "weekly_digest_sends", // the Monday email's send claims and opt-out link hashes — delivery plumbing and bearer credentials, never exported
  "shop_contact_email_confirmation_tokens", // bearer credentials, never exported — same reasoning as booking_capabilities
  "shop_shore_alert_tokens", // the shore contact's confirm and stop links (H-118): bearer credentials, same reasoning
  // The shop's own Meta access token (sealed) plus the provider linkage around
  // it. Never exported, for both reasons already on this list: it is a live
  // credential like user_accounts, and a phone number id is provider linkage
  // useless outside that Meta account, like shop_stripe_accounts.
  "shop_whatsapp_accounts",
  // The shop's own S3 credential (sealed) plus where its weekly backup bundle
  // goes. Never exported, same two reasons as shop_whatsapp_accounts: the
  // secret key is a live credential to storage the shop owns, and the
  // endpoint/bucket rows are linkage to an account that already belongs to
  // the shop (ADR 20260804-shop-owned-backup-export).
  "shop_backup_destinations",
  // Delivery outcomes for those bundles — operational plumbing about the
  // export process, not a shop record; same reasoning as notification_deliveries.
  "shop_backup_deliveries",
  // Integration provider credentials, OAuth state, delivery retries, and
  // external-id mappings are operational machinery rather than shop records.
  // The credentials and webhook URLs are live capabilities; the remaining
  // rows are pointers/retry state that cannot be restored into another shop.
  "shop_integrations",
  "integration_oauth_states",
  "integration_events",
  "integration_deliveries",
  "integration_sync_records",
  // The manifest's shift catch-up (issues #1202, #1187). A same-day handoff
  // between two people standing in one shop on one morning, kept for thirty
  // days and read by nobody after the boat is home — operational plumbing, not
  // a shop record, and the same reasoning as `notification_deliveries`.
  // Exporting it would also be the one thing #1202's boundary rules out: a
  // durable, downloadable, per-person account of who did what and when.
  "trip_desk_events",
  // Per-staff read state has no meaning without the desk events.
  // It is not portable to another system.
  "trip_read_marks",
  "offline_manifest_snapshot_revisions", // monotone device-snapshot ordering machinery, not a shop record
  "today_read_marks",
  "today_read_mark_events",
  // Held sends live eight seconds; exporting one would export a tap, not a record.
  "held_sends",
  // What one staffer had typed into a form when the phone rang (same ADR,
  // decision 3): a day-old draft of their own, never a shop record.
  "form_drafts",
  // DiveDay's own funnel and activation bookkeeping (ADR
  // 20261007-founder-metrics): a set-up request predates any shop, a demo
  // entry belongs to no shop, and a shop's milestones are DiveDay's reading of
  // its progress rather than anything the shop recorded. None is a shop record.
  "setup_requests",
  // The request's setup link: a hash of a credential, never a shop record.
  "shop_setup_links",
  "demo_entries",
  "shop_milestones",
];
