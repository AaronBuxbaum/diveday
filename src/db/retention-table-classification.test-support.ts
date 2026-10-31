/**
 * Tables retention does not govern — and a list that has to be edited by hand
 * for every table added to the schema, which is the price of the guard below.
 *
 * Retention's subject is the operational trail: rows DiveDay writes about its
 * own working, whose count follows the calendar and the traffic rather than
 * anything a shop would recognise as its own records. Everything named here is
 * outside that subject. A name here is **not** a claim that the table is
 * small; it is a claim that a clock is the wrong instrument for it, because
 * what removes a row is a delete, an erasure request, or the work the row
 * exists to track finishing.
 *
 * So a new append-only trail does not belong here. It belongs in
 * `RETENTION_DAYS` with a window, or in `UNBOUNDED_BY_DECISION` with a
 * paragraph saying who decided and when — and if which of those two is right
 * is not yet known, that is the question this guard exists to raise rather
 * than a reason to add a name below.
 */
export const OUTSIDE_RETENTION: readonly string[] = [
  "today_read_mark_events", // junction rows cascade with the 30-day mark or event; no independent clock
  "retention_prune_state", // one mutable scheduler cursor, never an age-pruned trail
  "platform_backup_progress", // one mutable per-shop checkpoint, replaced on attempts and deleted with its shop
  "shop_backup_delivery_claims", // one mutable per-shop scheduler lease, replaced per attempt and deleted with its shop
  "claude_call_content_erasures", // one per-shop erasure stamp, overwritten, never a trail
  // Monotone per-trip device-snapshot ordering; no person data, and resetting
  // while stale device copies exist could let an older response win.
  "offline_manifest_snapshot_revisions",
  // Shop configuration stays until the shop edits or deletes it.
  "shops",
  "boats",
  "trip_lenses",
  "courses",
  "dive_sites",
  "dive_site_creatures",
  "waiver_templates",
  "shop_promo_codes",
  "dive_packages",
  "pre_departure_checklist_items",
  "trip_requirements",
  "gear_items",
  "trip_series",
  "trip_series_crew",
  "shop_text_translations", // the shop's own words in Spanish, kept while the original is
  "trip_series_skips",
  "trip_schedule_days",
  // Shared catalogue content is not a shop record; pruning breaks shop copies.
  "global_dive_sites",
  "global_dive_site_versions",
  "marine_life_requests",
  // The texting number's STOP list. A START lifts a STOP; nothing ages one out
  // on a clock, because that would resume texting someone who said
  // stop (ADR 20261007-sms-stop-and-help).
  "sms_opt_outs",
  // People, and what a shop knows about one. The standing decision at the top
  // of src/lib/retention.ts is that this data is kept until somebody asks for
  // it gone: the erasure path is the requested one (`src/db/anonymize.ts`),
  // never a dormancy timer.
  "people",
  "person_roles",
  "certifications",
  "specialty_certifications",
  "nitrox_certifications",
  "rental_fit_profiles",
  "prior_visits",
  "prior_gear_assignments",
  "imported_payment_history",
  // The request's single-use setup link (ADR 20261009-single-use-setup-links):
  // a hash, an expiry and a spent instant, one per request, deleted with it.
  // Its own clock is the expiry, which closes it; there is nothing left in it to age out.
  "shop_setup_links",
  "internal_notes",
  "staff_credentials",
  "staff_credential_history", // credential change history is retained with the staff credential, not age-pruned
  "staff_shifts",
  "crew_availability_blocks",
  "crew_assignment_requests",
  // Departures and what happened on one. Several of these are append-only —
  // a departure's change history, a review's publish/hide trail — and they
  // are still outside retention's subject, because each is read as part of a
  // record the shop still has. A window would leave that record with a hole
  // rather than free anything, and the count follows the shop's own
  // departures rather than the calendar.
  "trips",
  "trip_dives",
  "executed_dives",
  // A boat's open problem is current state until somebody says it is fixed,
  // and a fixed one is part of that boat's history, read like a logged dive.
  "boat_snags",
  "trip_sightings",
  "trip_assignments",
  // "Working it anyway" on one crew assignment (issue #2678): current state of
  // the departure's crew, read with it, and gone when the person comes off it.
  "crew_away_acknowledgements",
  "trip_help_requests",
  // Interests: contact data, kept until erasure (src/lib/retention.ts).
  "interests",
  // Seat-level links are removed with either referenced record; they need no independent clock.
  "date_request_offer_bookings",
  "trip_last_minute_promos",
  "trip_blowouts",
  "trip_blowout_divers",
  // One row per departure, read as part of its departure log (#2300).
  "departure_boat_safety_snapshots",
  // What the bench told a customer and the orders it raised (ADR
  // 20261008-work-order-follow-up). Read with the ticket or the piece they are
  // about, which the shop keeps; a reminder row is also what stops a second
  // reminder for the same due date, so a window would re-arm one.
  "customer_gear_notices",
  "customer_gear_reminder_settings",
  "work_order_bills",
  "buddy_pair_members",
  "gear_reservations",
  // The bench (ADR 20261008-gear-work-orders): a ticket, the customer's own
  // gear it is about, its parts and labor, its Work done record, and its
  // status history. Same
  // reasoning as the departures above — the history is read as part of a
  // record the shop still has, and a shop's answer to "when did you last
  // service this regulator?" is the reason the rows exist. The way one goes is
  // a delete or the erasure path, never a clock.
  "customer_gear_items",
  "work_orders",
  "work_order_items",
  "work_order_lines",
  "work_order_care",
  "work_order_events",
  "recap_photos",
  "trip_recap_photos",
  "trip_reviews",
  // The shop's public reply under a review (batch 4, K2): lives as long as the
  // review it answers, and goes the way the review goes.
  "review_replies",
  "recap_pulses",
  // Waivers. H-02's question about these is whether signed evidence may be
  // erased at all — the opposite end of the same question from a window, and
  // never an argument for expiring one on a clock.
  "waiver_records",
  "waiver_materiality_decisions",
  // Course forms (ADR 20261008-course-forms): the same signed evidence as the
  // release, on the same footing. The forms, their versions and a course's
  // list of them are the shop's own configuration; a signed record is erased
  // by the erasure path (`src/db/anonymize.ts`), never aged out.
  "course_forms",
  "course_form_versions",
  "course_form_requirements",
  "course_form_records",
  // Seats and money: the shop's own books. `booking_payment_events` is the one
  // trail among these and it has a window (7 years); the rows here are the
  // seats, orders and tips that trail is about.
  "bookings",
  "booking_payments",
  "booking_referrals",
  "booking_checkouts",
  "booking_checkout_bookings",
  "orders",
  "order_line_items",
  "tips",
  // A card dispute on one of those orders or checkouts: one mutable row per dispute,
  // kept current by Stripe (ADR 20261009-stripe-reversals-reach-diveday). Not a trail.
  "payment_disputes",
  // A payout to the shop's bank, one row per Stripe payout (ADR 20261012-payouts-reach-diveday).
  "stripe_payouts",
  // A refund Stripe reported failed after accepting it (issue #2291), owed until refunded again: books, not a trail.
  "stripe_refund_failures",
  "pricing_volume_statements", // a percent-plan shop's closed month, the books behind a fee (ADR 20261022-pricing-ab-test)
  "dive_package_entitlements",
  "shop_promo_redemptions",
  // Credentials that live and die with the thing they open: revoked, spent, or
  // deleted with their parent. The token tables that are *not* here
  // (`account_tokens`, `account_sessions`, `shop_contact_email_confirmation_tokens`,
  // `integration_oauth_states`, `booking_capabilities`) are the ones whose
  // already-dead rows are kept on purpose for an incident review — which is
  // what a window is for, and why they have one.
  "user_accounts",
  "account_security",
  "account_step_ups",
  "auth_provider_accounts",
  "auth_verifications",
  "calendar_feeds",
  "interest_unsubscribe_tokens",
  "person_courtesy_email_unsubscribe_tokens",
  // Current state about DiveDay's own machinery: one row per object, replaced
  // in place rather than appended, so there is no history here to age out.
  "notification_rate_limit_state",
  "claude_demo_spend",
  "shop_milestones",
  "integration_sync_records",
  "shop_integrations",
  "shop_stripe_accounts",
  // One row per shop, updated in place by the billing webhook (ADR
  // 20261007-subscription-billing): the subscription as it is now, not a trail.
  "shop_subscriptions",
  "shop_whatsapp_accounts",
  "shop_backup_destinations",
  "shop_backup_deliveries",
  // A queue that empties itself: a held send is deleted by whichever claimant
  // reaches it first (its own docblock).
  "held_sends",
  // An obligation, deleted when it is discharged. A window here would delete
  // exactly the rows that still owe something — the local blob whose provider
  // delete never landed, the Stripe side effect whose response was lost, the
  // erased diver a processor still holds — which is the opposite of what it
  // would be for.
  "media_deletion_attempts",
  "payment_operation_intents",
  "processor_erasure_obligations",
  // Bounded by a table that *is* pruned: an integration delivery is a child of
  // `integration_events` with ON DELETE CASCADE, so its rows leave when that
  // 400-day window takes the event they belong to.
  "integration_deliveries",
  // The same shape: a report's people and addenda are its children with ON
  // DELETE CASCADE, so they leave when the 7-year window takes the report
  // (ADR 20261012-incident-reports).
  "incident_report_people",
  "incident_report_addenda",
];
