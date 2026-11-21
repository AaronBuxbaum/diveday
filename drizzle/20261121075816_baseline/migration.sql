-- The baseline: one migration describing the whole schema (issue #4853, ADR
-- 20261121-one-baseline-migration). It replaced every earlier migration on
-- 2026-11-21, when production was wiped rather than carried forward (issue
-- #4858); the first squash, on 2026-09-04, is ADR
-- 20260904-squash-migration-baseline.
--
-- Its folder name is new on purpose. drizzle decides what to run by folder
-- name, so a database still carrying the old history runs this file and stops
-- on "relation already exists" instead of quietly skipping it. Such a database
-- is wiped, not upgraded.
--
-- Everything between the two extensions and the hand-written block at the
-- bottom is `drizzle-kit generate` output for `src/db/schema/`. The extensions,
-- four name collations, the gear exclusion constraint and the booking-link
-- trigger are hand-written, because the schema modules cannot express them.
--
-- CR-018: trigram-similarity GIN indexes back the leading-wildcard
-- `ilike '%query%'` searches. Standard Postgres contrib extension, available
-- on Neon and loaded explicitly for PGlite (see src/db/client.ts).
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
-- ADR 20260815-minimal-gear-register: btree_gist supplies the gist opclass for
-- `uuid =` so the EXCLUDE constraint at the bottom of this file can pair it
-- with a daterange overlap check. Loaded explicitly for PGlite as above.
CREATE EXTENSION IF NOT EXISTS btree_gist;--> statement-breakpoint
CREATE TYPE "security_step_up_purpose" AS ENUM('money', 'export', 'backup', 'security');--> statement-breakpoint
CREATE TYPE "activity_audience" AS ENUM('staff', 'diver');--> statement-breakpoint
CREATE TYPE "dive_not_made_word" AS ENUM('not_made', 'undone');--> statement-breakpoint
CREATE TYPE "trip_change_event_kind" AS ENUM('meeting_point', 'conditions', 'site_change');--> statement-breakpoint
CREATE TYPE "trip_change_event_source" AS ENUM('shop', 'crew');--> statement-breakpoint
CREATE TYPE "trip_stage" AS ENUM('boarding', 'underway', 'surface', 'heading_in', 'home');--> statement-breakpoint
CREATE TYPE "pricing_plan" AS ENUM('flat_monthly', 'percent_of_volume');--> statement-breakpoint
CREATE TYPE "pricing_plan_source" AS ENUM('assigned', 'override');--> statement-breakpoint
CREATE TYPE "stripe_subscription_status" AS ENUM('incomplete', 'incomplete_expired', 'trialing', 'active', 'past_due', 'canceled', 'unpaid', 'paused');--> statement-breakpoint
CREATE TYPE "booking_capability_purpose" AS ENUM('group_claim', 'readiness', 'confirm', 'claim', 'handoff', 'course_forms', 'returning_diver_receipt');--> statement-breakpoint
CREATE TYPE "booking_status" AS ENUM('booked', 'cancelled', 'no_show');--> statement-breakpoint
CREATE TYPE "dive_intent" AS ENUM('easing_back', 'small_life', 'a_wreck', 'skills', 'good_day');--> statement-breakpoint
CREATE TYPE "dive_recency_band" AS ENUM('this_season', 'within_a_year', 'one_to_five_years', 'over_five_years', 'never');--> statement-breakpoint
CREATE TYPE "participant_type" AS ENUM('diver', 'snorkeler', 'rider');--> statement-breakpoint
CREATE TYPE "re_entry_ask" AS ENUM('deck_word', 'easy_first_dive', 'refresher_course');--> statement-breakpoint
CREATE TYPE "trip_help_request_kind" AS ENUM('carry_gear', 'first_timer', 'find_group');--> statement-breakpoint
CREATE TYPE "trip_help_request_status" AS ENUM('requested', 'acknowledged', 'handled', 'withdrawn');--> statement-breakpoint
CREATE TYPE "turn_away_reason" AS ENUM('medical', 'waiver', 'card', 'age', 'identity', 'payment');--> statement-breakpoint
CREATE TYPE "welcome_hello" AS ENUM('first_ocean_dive', 'celebrating', 'nervous');--> statement-breakpoint
CREATE TYPE "capability_purpose" AS ENUM('interest_unsubscribe', 'courtesy_email_unsubscribe', 'weekly_digest_unsubscribe', 'shore_alert_stop', 'bookkeeper_stop', 'shore_alert_confirm', 'email_verification', 'password_reset', 'magic_sign_in', 'demo_sign_in', 'invite', 'shop_setup', 'calendar_assignments', 'calendar_shop_trips', 'waiver_link', 'release_link');--> statement-breakpoint
CREATE TYPE "card_deletion_kind" AS ENUM('staff', 'system');--> statement-breakpoint
CREATE TYPE "card_kind" AS ENUM('level', 'specialty', 'nitrox');--> statement-breakpoint
CREATE TYPE "account_status" AS ENUM('invited', 'active', 'disabled');--> statement-breakpoint
CREATE TYPE "brand_display_font" AS ENUM('bricolage_grotesque', 'outfit', 'sora', 'playfair_display', 'archivo_black', 'lora');--> statement-breakpoint
CREATE TYPE "certification_agency" AS ENUM('padi', 'ssi', 'naui', 'sdi', 'tdi', 'cmas', 'raid', 'gue', 'bsac', 'nss_cds', 'nacd', 'iantd', 'other');--> statement-breakpoint
CREATE TYPE "certification_level" AS ENUM('open_water', 'advanced_open_water', 'rescue', 'divemaster', 'instructor');--> statement-breakpoint
CREATE TYPE "certification_status" AS ENUM('pending', 'verified');--> statement-breakpoint
CREATE TYPE "depth_unit" AS ENUM('meters', 'feet');--> statement-breakpoint
CREATE TYPE "desk_payment" AS ENUM('card', 'cash', 'card_and_cash');--> statement-breakpoint
CREATE TYPE "dive_specialty" AS ENUM('deep', 'wreck', 'night', 'drysuit', 'cavern');--> statement-breakpoint
CREATE TYPE "medical_jurisdiction" AS ENUM('rstc', 'uk');--> statement-breakpoint
CREATE TYPE "nitrox_fill_method" AS ENUM('blending', 'membrane_premix');--> statement-breakpoint
CREATE TYPE "person_origin" AS ENUM('public_booking', 'waitlist', 'last_minute', 'self_registration', 'counter', 'import', 'invite', 'onboard', 'public_order', 'identity_split', 'seed');--> statement-breakpoint
CREATE TYPE "person_role" AS ENUM('owner', 'manager', 'instructor', 'assistant_instructor', 'divemaster', 'captain', 'crew', 'diver');--> statement-breakpoint
CREATE TYPE "temperature_unit" AS ENUM('celsius', 'fahrenheit');--> statement-breakpoint
CREATE TYPE "crew_notice_change" AS ENUM('assigned', 'removed', 'request_approved', 'request_declined', 'request_refused', 'role_changed', 'called_off', 'time_moved');--> statement-breakpoint
CREATE TYPE "crew_notice_outcome" AS ENUM('sent', 'failed', 'netted', 'skipped', 'no_recipient', 'demo');--> statement-breakpoint
CREATE TYPE "crew_request_decision" AS ENUM('approved', 'declined');--> statement-breakpoint
CREATE TYPE "staff_credential_kind" AS ENUM('instructor_rating', 'assistant_instructor_rating', 'divemaster_rating', 'liability_insurance', 'first_aid_cpr', 'oxygen_provider', 'captains_licence', 'other');--> statement-breakpoint
CREATE TYPE "trip_assignment_role" AS ENUM('instructor', 'divemaster', 'captain', 'crew');--> statement-breakpoint
CREATE TYPE "boarding_observation_state" AS ENUM('pending', 'applied', 'conflict', 'dismissed');--> statement-breakpoint
CREATE TYPE "lost_item_status" AS ENUM('open', 'returned', 'discarded');--> statement-breakpoint
CREATE TYPE "lost_item_told_channel" AS ENUM('email', 'sms', 'whatsapp');--> statement-breakpoint
CREATE TYPE "arrival_status" AS ENUM('arrived', 'cleared');--> statement-breakpoint
CREATE TYPE "trip_blowout_cause" AS ENUM('weather', 'run_ended');--> statement-breakpoint
CREATE TYPE "blowout_message_status" AS ENUM('pending', 'sending', 'sent', 'queued', 'failed', 'no_email');--> statement-breakpoint
CREATE TYPE "buddy_team_event_action" AS ENUM('formed', 'dissolved', 'member_added', 'member_removed');--> statement-breakpoint
CREATE TYPE "dive_participation" AS ENUM('dived', 'sat_out', 'unknown');--> statement-breakpoint
CREATE TYPE "pre_departure_check_status" AS ENUM('checked', 'cleared');--> statement-breakpoint
CREATE TYPE "roll_call_source" AS ENUM('live', 'offline');--> statement-breakpoint
CREATE TYPE "roll_call_status" AS ENUM('boarded', 'not_boarded', 'cleared');--> statement-breakpoint
CREATE TYPE "roll_call_subject_kind" AS ENUM('seat', 'crew');--> statement-breakpoint
CREATE TYPE "safety_drill_kind" AS ENUM('oxygen', 'missing_diver', 'overboard', 'fire');--> statement-breakpoint
CREATE TYPE "dive_site_difficulty" AS ENUM('beginner', 'intermediate', 'advanced');--> statement-breakpoint
CREATE TYPE "dive_site_fit_tone" AS ENUM('welcoming', 'demanding', 'unknown');--> statement-breakpoint
CREATE TYPE "dive_site_tide_preference" AS ENUM('any', 'slack', 'flood', 'ebb');--> statement-breakpoint
CREATE TYPE "media_deletion_kind" AS ENUM('course_photo', 'recap_photo', 'certification_card', 'waiver_document', 'dive_site_photo', 'shop_logo', 'arrival_photo', 'shop_hero', 'staff_profile', 'boat_photo', 'payment_receipt');--> statement-breakpoint
CREATE TYPE "media_deletion_status" AS ENUM('pending', 'succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "processor_erasure_status" AS ENUM('owed', 'discharged');--> statement-breakpoint
CREATE TYPE "processor_erasure_target" AS ENUM('stripe_customer', 'stripe_invoice_snapshot', 'stripe_checkout_session_snapshot');--> statement-breakpoint
CREATE TYPE "shop_milestone" AS ENUM('shop_created', 'first_departure', 'first_public_booking', 'first_signed_waiver', 'first_roll_call', 'first_paid_month');--> statement-breakpoint
CREATE TYPE "gear_item_kind" AS ENUM('bcd', 'regulator', 'wetsuit', 'boots', 'mask', 'fins', 'weights', 'dive_computer', 'gopro', 'tank', 'drysuit', 'hood', 'gloves', 'torch', 'dpv', 'smb', 'reel', 'camera', 'nitrox_analyzer', 'o2_kit', 'aed', 'first_aid_kit', 'flares', 'other');--> statement-breakpoint
CREATE TYPE "gear_item_status" AS ENUM('in_service', 'needs_service');--> statement-breakpoint
CREATE TYPE "gear_return_outcome" AS ENUM('all_good', 'fit_adjusted', 'service_concern');--> statement-breakpoint
CREATE TYPE "gear_service_kind" AS ENUM('service', 'hydro_test', 'visual_inspection', 'o2_clean', 'aed_pads', 'aed_battery', 'expiry', 'note');--> statement-breakpoint
CREATE TYPE "rental_fit_item" AS ENUM('bcd', 'wetsuit', 'boots', 'fins', 'weights', 'drysuit', 'hood', 'gloves');--> statement-breakpoint
CREATE TYPE "tank_fill_o2_clean_gap" AS ENUM('lapsed', 'never');--> statement-breakpoint
CREATE TYPE "incident_handover_kind" AS ENUM('none', 'ems', 'hospital', 'chamber', 'diver', 'other');--> statement-breakpoint
CREATE TYPE "incident_involvement" AS ENUM('affected', 'witness', 'responder');--> statement-breakpoint
CREATE TYPE "incident_kind" AS ENUM('injury', 'near_miss', 'equipment', 'missing_diver', 'fatality', 'other');--> statement-breakpoint
CREATE TYPE "incident_report_status" AS ENUM('draft', 'filed');--> statement-breakpoint
CREATE TYPE "incident_severity" AS ENUM('minor', 'moderate', 'serious');--> statement-breakpoint
CREATE TYPE "backup_delivery_status" AS ENUM('started', 'succeeded', 'failed', 'superseded');--> statement-breakpoint
CREATE TYPE "backup_delivery_trigger" AS ENUM('scheduled', 'manual');--> statement-breakpoint
CREATE TYPE "integration_connection_status" AS ENUM('connected', 'error');--> statement-breakpoint
CREATE TYPE "integration_delivery_status" AS ENUM('pending', 'processing', 'delivered', 'failed');--> statement-breakpoint
CREATE TYPE "integration_provider" AS ENUM('shopify', 'quickbooks', 'zapier', 'square');--> statement-breakpoint
CREATE TYPE "interest_asked_by" AS ENUM('diver', 'shop');--> statement-breakpoint
CREATE TYPE "interest_closed_as" AS ENUM('booked', 'done', 'unsubscribed', 'replied');--> statement-breakpoint
CREATE TYPE "interest_experience" AS ENUM('never', 'tried', 'certified', 'lapsed');--> statement-breakpoint
CREATE TYPE "interest_reply_channel" AS ENUM('email', 'sms', 'whatsapp');--> statement-breakpoint
CREATE TYPE "interest_reply_status" AS ENUM('pending', 'sent', 'failed', 'not_configured');--> statement-breakpoint
CREATE TYPE "interest_scope" AS ENUM('departure', 'date', 'anytime');--> statement-breakpoint
CREATE TYPE "inbound_channel" AS ENUM('email', 'sms', 'whatsapp', 'page');--> statement-breakpoint
CREATE TYPE "inbound_keyword_intent" AS ENUM('cancel', 'move', 'confirm', 'late');--> statement-breakpoint
CREATE TYPE "notification_delivery_status" AS ENUM('sent', 'failed', 'not_configured');--> statement-breakpoint
CREATE TYPE "notification_kind" AS ENUM('booking_confirmation', 'waiver_request', 'booking_handoff', 'readiness_link', 'trip_reminder_7d', 'trip_reminder_24h', 'trip_recap', 'trip_blowout', 'trip_minimum_not_met', 'booking_cancelled', 'trip_rescheduled');--> statement-breakpoint
CREATE TYPE "notification_provider_status" AS ENUM('sent', 'delivered', 'delivery_delayed', 'bounced', 'complained', 'failed', 'suppressed');--> statement-breakpoint
CREATE TYPE "notification_queue_status" AS ENUM('queued', 'processing', 'sent', 'failed');--> statement-breakpoint
CREATE TYPE "checkout_purpose" AS ENUM('fare', 'tip');--> statement-breakpoint
CREATE TYPE "checkout_status" AS ENUM('pending', 'completed', 'expired');--> statement-breakpoint
CREATE TYPE "deal_status" AS ENUM('pending', 'active', 'disabled', 'failed');--> statement-breakpoint
CREATE TYPE "dive_package_scope" AS ENUM('all', 'fun_dives');--> statement-breakpoint
CREATE TYPE "imported_payment_direction" AS ENUM('payment', 'refund', 'unknown');--> statement-breakpoint
CREATE TYPE "manual_payment_method" AS ENUM('cash', 'card', 'other');--> statement-breakpoint
CREATE TYPE "order_collection" AS ENUM('stripe_invoice', 'local_invoice', 'cash', 'card_machine', 'bank_transfer', 'other', 'room_charge');--> statement-breakpoint
CREATE TYPE "order_line_item_kind" AS ENUM('trip_fee', 'course_fee', 'e_learning_fee', 'rental', 'nitrox', 'deposit', 'dive_package', 'pass_through_fee', 'merchandise', 'other');--> statement-breakpoint
CREATE TYPE "order_source" AS ENUM('staff', 'public');--> statement-breakpoint
CREATE TYPE "order_status" AS ENUM('open', 'paid', 'void', 'uncollectible', 'partly_refunded', 'refunded');--> statement-breakpoint
CREATE TYPE "payment_event_operation" AS ENUM('manual_mark', 'checkout_settled', 'order_settled', 'package_consumed', 'package_released', 'trip_credit_redeemed', 'trip_credit_released', 'trip_credit_reopened', 'order_refunded', 'cancellation_refund', 'shop_cancellation_refund', 'stripe_dashboard_refund', 'refund_failed');--> statement-breakpoint
CREATE TYPE "payment_operation_kind" AS ENUM('checkout_session', 'invoice', 'refund');--> statement-breakpoint
CREATE TYPE "payment_operation_status" AS ENUM('started', 'succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "payment_status" AS ENUM('unpaid', 'deposit_paid', 'paid', 'waived', 'partly_refunded', 'refunded');--> statement-breakpoint
CREATE TYPE "shop_promo_scope" AS ENUM('all', 'trips', 'courses');--> statement-breakpoint
CREATE TYPE "crew_thanks_ruling" AS ENUM('passed', 'held');--> statement-breakpoint
CREATE TYPE "recap_pulse_category" AS ENUM('gear', 'briefing', 'boat', 'timing', 'other');--> statement-breakpoint
CREATE TYPE "review_moderation_action" AS ENUM('published', 'hidden');--> statement-breakpoint
CREATE TYPE "review_moderation_reason" AS ENUM('abusive', 'names_a_person', 'wrong_subject', 'spam', 'other');--> statement-breakpoint
CREATE TYPE "dive_mode" AS ENUM('boat', 'shore', 'pool');--> statement-breakpoint
CREATE TYPE "plan_change_reason" AS ENUM('current', 'weather', 'visibility', 'crew_call');--> statement-breakpoint
CREATE TYPE "trip_recurrence_frequency" AS ENUM('weekly');--> statement-breakpoint
CREATE TYPE "trip_status" AS ENUM('scheduled', 'cancelled');--> statement-breakpoint
CREATE TYPE "waiver_delivery_channel" AS ENUM('email', 'sms', 'link');--> statement-breakpoint
CREATE TYPE "waiver_draft_door" AS ENUM('thread', 'counter', 'release');--> statement-breakpoint
CREATE TYPE "waiver_record_status" AS ENUM('pending', 'completed', 'medical_review');--> statement-breakpoint
CREATE TYPE "waiver_signed_via" AS ENUM('thread', 'counter', 'party_door', 'release_link', 'desk');--> statement-breakpoint
CREATE TYPE "customer_gear_notice_channel" AS ENUM('email', 'sms', 'whatsapp');--> statement-breakpoint
CREATE TYPE "customer_gear_notice_kind" AS ENUM('ready_for_pickup', 'service_due');--> statement-breakpoint
CREATE TYPE "customer_gear_notice_status" AS ENUM('sending', 'sent', 'failed', 'not_configured', 'no_contact', 'opted_out');--> statement-breakpoint
CREATE TYPE "work_order_event_kind" AS ENUM('created', 'status_changed', 'technician_assigned', 'work_recorded');--> statement-breakpoint
CREATE TYPE "work_order_line_kind" AS ENUM('part', 'labor');--> statement-breakpoint
CREATE TYPE "work_order_outcome" AS ENUM('done', 'declined', 'unserviceable', 'condemned');--> statement-breakpoint
CREATE TYPE "work_order_status" AS ENUM('received', 'in_progress', 'waiting_on_parts', 'ready', 'picked_up');--> statement-breakpoint
CREATE TABLE "account_security" (
	"user_account_id" uuid PRIMARY KEY,
	"totp_secret_sealed" text,
	"totp_enabled_at" timestamp with time zone,
	"recovery_code_hashes" jsonb DEFAULT '[]' NOT NULL,
	"totp_secret_key_id" text,
	"recovery_codes_key_id" text,
	"last_totp_step" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "account_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"user_account_id" uuid NOT NULL,
	"token" text NOT NULL UNIQUE,
	"expires_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"person_id" uuid NOT NULL,
	"shop_id" uuid NOT NULL,
	"shop_slug" text NOT NULL,
	"roles" jsonb NOT NULL,
	"name" text NOT NULL,
	"last_human_activity_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "account_sign_in_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"user_account_id" uuid NOT NULL,
	"token_hash" text NOT NULL UNIQUE,
	"expires_at" timestamp with time zone NOT NULL,
	"attempts_remaining" integer DEFAULT 5 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_sign_in_challenges_attempts" CHECK ("attempts_remaining" between 0 and 5),
	CONSTRAINT "account_sign_in_challenges_expiry" CHECK ("expires_at" > "created_at")
);
--> statement-breakpoint
CREATE TABLE "account_step_ups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"user_account_id" uuid NOT NULL,
	"account_session_id" uuid NOT NULL,
	"purpose" "security_step_up_purpose" NOT NULL,
	"verified_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_step_ups_expiry_after_verification" CHECK ("expires_at" > "verified_at")
);
--> statement-breakpoint
CREATE TABLE "auth_provider_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"user_account_id" uuid NOT NULL,
	"provider_id" text NOT NULL,
	"account_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "activity_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"trip_id" uuid,
	"booking_id" uuid,
	"actor_person_id" uuid,
	"system_reason" text,
	"subject_person_id" uuid,
	"order_id" uuid,
	"code" text NOT NULL,
	"params" jsonb DEFAULT '{}' NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"seq" bigserial,
	"audience" "activity_audience" DEFAULT 'staff'::"activity_audience" NOT NULL,
	CONSTRAINT "activity_events_actor_or_system_reason" CHECK (("actor_person_id" is null) = ("system_reason" is not null) or ("system_reason" is null and "code" in ('desk_running_late', 'desk_seat_released', 'desk_seat_turned_away', 'desk_balance_owed', 'desk_gear_changed', 'desk_pickup_set', 'desk_help_request', 'desk_meeting_point', 'desk_plan_changed'))),
	CONSTRAINT "activity_events_desk_is_staff" CHECK ("code" not in ('desk_running_late', 'desk_seat_released', 'desk_seat_turned_away', 'desk_balance_owed', 'desk_gear_changed', 'desk_pickup_set', 'desk_help_request', 'desk_meeting_point', 'desk_plan_changed') or "audience" = 'staff'),
	CONSTRAINT "activity_events_code_not_blank" CHECK (length(trim("code")) > 0)
);
--> statement-breakpoint
CREATE TABLE "dive_not_made_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"trip_id" uuid NOT NULL,
	"dive_number" integer NOT NULL,
	"meeting_day" integer NOT NULL,
	"word" "dive_not_made_word" NOT NULL,
	"recorded_by_person_id" uuid NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"seq" bigserial,
	CONSTRAINT "dive_not_made_events_dive_number_positive" CHECK ("dive_number" >= 1),
	CONSTRAINT "dive_not_made_events_meeting_day_nonnegative" CHECK ("meeting_day" >= 0)
);
--> statement-breakpoint
CREATE TABLE "form_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"form" text NOT NULL,
	"fields" jsonb NOT NULL,
	"saved_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "internal_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"booking_id" uuid,
	"body" text NOT NULL,
	"created_by_person_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by_person_id" uuid,
	CONSTRAINT "internal_notes_body_not_blank" CHECK (length(trim("body")) > 0)
);
--> statement-breakpoint
CREATE TABLE "today_read_mark_events" (
	"shop_id" uuid NOT NULL,
	"mark_id" uuid NOT NULL,
	"event_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "today_read_marks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"day_start" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trip_change_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"trip_id" uuid NOT NULL,
	"kind" "trip_change_event_kind" NOT NULL,
	"source" "trip_change_event_source" NOT NULL,
	"before_value" jsonb DEFAULT 'null',
	"after_value" jsonb NOT NULL,
	"actor_person_id" uuid,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"seq" bigserial
);
--> statement-breakpoint
CREATE TABLE "trip_read_marks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"trip_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"last_seen_seq" bigint DEFAULT 0 NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trip_stage_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"trip_id" uuid NOT NULL,
	"stage" "trip_stage" NOT NULL,
	"dive_site_id" uuid,
	"recorded_by_person_id" uuid NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"not_counted" integer,
	"seq" bigserial,
	CONSTRAINT "trip_stage_events_not_counted_home_only" CHECK ("not_counted" is null or ("stage" = 'home' and "not_counted" > 0))
);
--> statement-breakpoint
CREATE TABLE "assist_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"feature" text NOT NULL,
	"subject_key" text NOT NULL,
	"value" jsonb NOT NULL,
	"input_digest" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "claude_call_content" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"usage_id" uuid NOT NULL,
	"shop_id" uuid NOT NULL,
	"system_text" text NOT NULL,
	"context_text" text,
	"content_text" text NOT NULL,
	"answer_text" text,
	"fetched_urls" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "claude_call_content_erasures" (
	"shop_id" uuid PRIMARY KEY,
	"erased_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "claude_demo_spend" (
	"month" text PRIMARY KEY,
	"spent_micro_usd" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "claude_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"feature" text NOT NULL,
	"model" text NOT NULL,
	"outcome" text NOT NULL,
	"error_code" text,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"cache_write_tokens" integer DEFAULT 0 NOT NULL,
	"cache_read_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cost_micro_usd" integer DEFAULT 0 NOT NULL,
	"latency_ms" integer,
	"request_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shop_text_translations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"subject_kind" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"field" text NOT NULL,
	"locale" text NOT NULL,
	"text" text,
	"source_digest" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shop_text_translations_kind" CHECK ("subject_kind" in ('trip', 'course', 'dive_site'))
);
--> statement-breakpoint
CREATE TABLE "collection_entries" (
	"id" bigserial PRIMARY KEY,
	"shop_id" uuid NOT NULL,
	"source_type" text NOT NULL,
	"source_id" uuid NOT NULL,
	"currency" text NOT NULL,
	"method" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"reverses_entry_id" bigint,
	"evidence" jsonb NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "collection_entries_source_check" CHECK ("source_type" in ('order', 'checkout', 'booking')),
	CONSTRAINT "collection_entries_currency_check" CHECK ("currency" ~ '^[a-z]{3}$'),
	CONSTRAINT "collection_entries_reversal_check" CHECK ("amount_cents" <> 0 and ("amount_cents" > 0 or "reverses_entry_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "pricing_volume_statements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"month" date NOT NULL,
	"currency" text DEFAULT 'usd' NOT NULL,
	"collections" jsonb DEFAULT '[]' NOT NULL,
	"gross_fee_cents" integer DEFAULT 0 NOT NULL,
	"refund_credit_cents" integer DEFAULT 0 NOT NULL,
	"fee_credit_carry_cents" integer DEFAULT 0 NOT NULL,
	"credits" jsonb DEFAULT '[]' NOT NULL,
	"month_card_cents" integer DEFAULT 0 NOT NULL,
	"late_refund_cents" integer DEFAULT 0 NOT NULL,
	"volume_cents" integer NOT NULL,
	"basis_points" integer NOT NULL,
	"fee_cents" integer NOT NULL,
	"stripe_meter_identifier" text NOT NULL,
	"reported_at" timestamp with time zone,
	"first_report_attempt_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pricing_volume_statements_fee_check" CHECK ("fee_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "shop_subscriptions" (
	"shop_id" uuid PRIMARY KEY,
	"stripe_customer_id" text,
	"stripe_subscription_id" text,
	"stripe_status" "stripe_subscription_status",
	"current_period_end" timestamp with time zone,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"last_subscription_event_at" timestamp with time zone,
	"stripe_checkout_session_id" text,
	"free_term_ends_on" date,
	"first_paid_at" timestamp with time zone,
	"pricing_plan" "pricing_plan",
	"pricing_plan_source" "pricing_plan_source",
	"pricing_plan_set_at" timestamp with time zone,
	"assigned_pricing_plan" "pricing_plan",
	"plan_monthly_cents" integer,
	"plan_basis_points" integer,
	"paid_total_cents" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shop_subscriptions_pricing_plan_source_check" CHECK (("pricing_plan" is null) = ("pricing_plan_source" is null)),
	CONSTRAINT "shop_subscriptions_plan_numbers_check" CHECK (("plan_monthly_cents" is null or "plan_monthly_cents" between 0 and 100000) and ("plan_basis_points" is null or "plan_basis_points" between 0 and 1000))
);
--> statement-breakpoint
CREATE TABLE "booking_capabilities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"booking_id" uuid NOT NULL,
	"purpose" "booking_capability_purpose" NOT NULL,
	"returning_order" bigserial,
	"returning_device_hash" text,
	"returning_device_generation" text,
	"key_version" smallint,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"delivered" boolean DEFAULT false NOT NULL,
	"source_capability_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "booking_capabilities_returning_diver_source" CHECK (("purpose"::text = 'returning_diver_receipt') = ("source_capability_id" is not null)),
	CONSTRAINT "booking_capabilities_key_version_iff_link" CHECK (("source_capability_id" is null) = ("key_version" is not null)),
	CONSTRAINT "booking_capabilities_key_version_range" CHECK ("key_version" between 1 and 9)
);
--> statement-breakpoint
CREATE TABLE "booking_referrals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"booking_id" uuid NOT NULL UNIQUE,
	"referred_by_booking_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"trip_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"offline_assignment_generation" integer DEFAULT 0 NOT NULL,
	"wants_nitrox" boolean DEFAULT false NOT NULL,
	"paid_rental_kinds" jsonb DEFAULT '[]' NOT NULL,
	"participant_type" "participant_type" DEFAULT 'diver'::"participant_type" NOT NULL,
	"booked_as" "participant_type" NOT NULL,
	"conditions_briefed_at" timestamp with time zone,
	"carried_facts_confirmed_at" timestamp with time zone,
	"last_dived_band" "dive_recency_band",
	"dive_intent" "dive_intent",
	"re_entry_ask" "re_entry_ask",
	"hotel_pickup_location" text,
	"dietary_note" text,
	"pickup_time" text,
	"status" "booking_status" DEFAULT 'booked'::"booking_status" NOT NULL,
	"arrival_trail_after_seq" bigint,
	"seat_reopened_at" timestamp with time zone,
	"turned_away_reason" "turn_away_reason",
	"turned_away_at" timestamp with time zone,
	"running_late_at" timestamp with time zone,
	"pending_checkout_intent_id" uuid,
	"identity_unconfirmed_at" timestamp with time zone,
	"recap_link_epoch" integer DEFAULT 0 NOT NULL,
	"identity_booked_as" text,
	"delivery_email" text,
	"held_emergency_contact_name" text,
	"held_emergency_contact_phone" text,
	"reschedule_missed_from" timestamp with time zone,
	"reschedule_missed_place" boolean DEFAULT false NOT NULL,
	"fly_safe_hours_told" integer,
	"fly_safe_recipient_sealed" text,
	"fly_safe_recipient_unknown" boolean DEFAULT false NOT NULL,
	"fly_safe_acknowledgement_fingerprint" text,
	"fly_safe_acknowledged_at" timestamp with time zone,
	"fly_safe_acknowledged_by_person_id" uuid,
	"fly_safe_corrected_at" timestamp with time zone,
	"fly_safe_correction_id" uuid,
	"fly_safe_correction_attempts" integer DEFAULT 0 NOT NULL,
	"fly_safe_correction_lease_id" uuid,
	"fly_safe_correction_lease_until" timestamp with time zone,
	"minor_declared_at" timestamp with time zone,
	"party_lead_booking_id" uuid,
	"group_hold_until" timestamp with time zone,
	"group_hold_expired_at" timestamp with time zone,
	"claimed_at" timestamp with time zone,
	"contact_typed_by_lead_at" timestamp with time zone,
	"referral_source" text,
	"welcome_shared_at" timestamp with time zone,
	"welcome_hello" "welcome_hello",
	"course_next_step" text,
	"course_next_step_at" timestamp with time zone,
	"course_next_step_by_person_id" uuid,
	"course_followup_by_person_id" uuid,
	"course_followup_at" timestamp with time zone,
	"course_followup_revision" integer DEFAULT 0 NOT NULL,
	"course_materials_done_at" timestamp with time zone,
	"course_materials_done_by_person_id" uuid,
	"referred_in_at" timestamp with time zone,
	"referred_in_by_person_id" uuid,
	"referral_form_at" timestamp with time zone,
	"referral_form_by_person_id" uuid,
	"referral_record_at" timestamp with time zone,
	"referral_record_by_person_id" uuid,
	"training_enrollment_booking_id" uuid,
	"training_marked_at" timestamp with time zone,
	"training_marked_by_person_id" uuid,
	"training_plan_instructor_person_id" uuid,
	"training_plan_by_person_id" uuid,
	"training_plan_at" timestamp with time zone,
	"training_cleared_at" timestamp with time zone,
	"training_cleared_by_person_id" uuid,
	"training_cleared_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bookings_training_mark_attributed" CHECK (("training_enrollment_booking_id" is null) = ("training_marked_at" is null)
        and ("training_marked_at" is null) = ("training_marked_by_person_id" is null)),
	CONSTRAINT "bookings_training_cleared_attributed" CHECK (("training_cleared_at" is null) = ("training_cleared_by_person_id" is null)
        and ("training_cleared_at" is null) = ("training_cleared_reason" is null)
        and ("training_cleared_reason" is null or "training_cleared_reason" in ('forms_owed', 'mark_invalid'))),
	CONSTRAINT "bookings_training_mark_not_self" CHECK ("training_enrollment_booking_id" is null or "training_enrollment_booking_id" <> "id"),
	CONSTRAINT "bookings_nitrox_is_a_divers" CHECK (not "wants_nitrox" or "participant_type" = 'diver'),
	CONSTRAINT "bookings_course_next_step_attributed" CHECK (("course_next_step" is null) = ("course_next_step_at" is null)
        and ("course_next_step_at" is null) = ("course_next_step_by_person_id" is null)),
	CONSTRAINT "bookings_course_next_step_bounded" CHECK ("course_next_step" is null
        or (length(btrim("course_next_step")) > 0 and length("course_next_step") <= 280)),
	CONSTRAINT "bookings_held_emergency_contact_pair" CHECK (("held_emergency_contact_name" is null) = ("held_emergency_contact_phone" is null)),
	CONSTRAINT "bookings_course_materials_done_attributed" CHECK (("course_materials_done_at" is null) = ("course_materials_done_by_person_id" is null)),
	CONSTRAINT "bookings_course_followup_attributed" CHECK (("course_followup_at" is null) = ("course_followup_by_person_id" is null)),
	CONSTRAINT "bookings_course_followup_revision" CHECK ("course_followup_revision" >= 0),
	CONSTRAINT "bookings_referral_attributed" CHECK (("referred_in_at" is null) = ("referred_in_by_person_id" is null)
        and ("referral_form_at" is null) = ("referral_form_by_person_id" is null)
        and ("referral_record_at" is null) = ("referral_record_by_person_id" is null)
        and ("referred_in_at" is not null or ("referral_form_at" is null and "referral_record_at" is null))),
	CONSTRAINT "bookings_turned_away_is_released" CHECK ("turned_away_at" is null or "status" in ('no_show', 'cancelled')),
	CONSTRAINT "bookings_turned_away_reason_has_time" CHECK ("turned_away_reason" is null or "turned_away_at" is not null)
);
--> statement-breakpoint
CREATE TABLE "trip_help_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"trip_id" uuid NOT NULL,
	"booking_id" uuid NOT NULL,
	"kind" "trip_help_request_kind" NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"status" "trip_help_request_status" DEFAULT 'requested'::"trip_help_request_status" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"acknowledged_at" timestamp with time zone,
	"handled_at" timestamp with time zone,
	"helper_person_id" uuid,
	"resolved_by_person_id" uuid
);
--> statement-breakpoint
CREATE TABLE "capabilities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"purpose" "capability_purpose" NOT NULL,
	"shop_id" uuid,
	"person_id" uuid,
	"user_account_id" uuid,
	"setup_request_id" uuid,
	"spent_by_shop_id" uuid,
	"waiver_record_id" uuid,
	"interest_id" uuid,
	"sent_to" text,
	"token_hash" text NOT NULL UNIQUE,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"used_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"last_accessed_at" timestamp with time zone,
	"claim_hash" text,
	"one_live" boolean DEFAULT false NOT NULL,
	CONSTRAINT "capabilities_subject_by_purpose" CHECK (("purpose"::text in ('interest_unsubscribe') and "interest_id" is not null and "person_id" is null and "sent_to" is null and "user_account_id" is null and "setup_request_id" is null and "waiver_record_id" is null)
        or ("purpose"::text in ('courtesy_email_unsubscribe', 'weekly_digest_unsubscribe', 'calendar_assignments', 'calendar_shop_trips') and "person_id" is not null and "interest_id" is null and "sent_to" is null and "user_account_id" is null and "setup_request_id" is null and "waiver_record_id" is null)
        or ("purpose"::text in ('shore_alert_stop', 'bookkeeper_stop', 'shore_alert_confirm') and "sent_to" is not null and "sent_to" = lower("sent_to") and "person_id" is null and "interest_id" is null and "user_account_id" is null and "setup_request_id" is null and "waiver_record_id" is null)
        or ("purpose"::text in ('email_verification', 'password_reset', 'magic_sign_in', 'demo_sign_in', 'invite') and "user_account_id" is not null and "person_id" is null and "interest_id" is null and "sent_to" is null and "setup_request_id" is null and "waiver_record_id" is null)
        or ("purpose"::text in ('shop_setup') and "setup_request_id" is not null and "person_id" is null and "interest_id" is null and "sent_to" is null and "user_account_id" is null and "waiver_record_id" is null)
        or ("purpose"::text in ('waiver_link', 'release_link') and "waiver_record_id" is not null and "person_id" is null and "interest_id" is null and "sent_to" is null and "user_account_id" is null and "setup_request_id" is null)),
	CONSTRAINT "capabilities_scope_by_purpose" CHECK (("shop_id" is null) = ("purpose"::text in ('email_verification', 'password_reset', 'magic_sign_in', 'demo_sign_in', 'invite', 'shop_setup'))),
	CONSTRAINT "capabilities_used_only_when_spent" CHECK ("used_at" is null or "purpose"::text in ('shore_alert_stop', 'bookkeeper_stop', 'shore_alert_confirm', 'email_verification', 'password_reset', 'magic_sign_in', 'demo_sign_in', 'invite', 'shop_setup', 'waiver_link', 'release_link')),
	CONSTRAINT "capabilities_expiry_by_purpose" CHECK (("expires_at" is not null) = ("purpose"::text in ('shore_alert_confirm', 'email_verification', 'password_reset', 'magic_sign_in', 'demo_sign_in', 'invite', 'shop_setup', 'waiver_link', 'release_link'))),
	CONSTRAINT "capabilities_one_live_by_purpose" CHECK ("one_live" = ("purpose"::text in ('calendar_assignments', 'calendar_shop_trips'))),
	CONSTRAINT "capabilities_accessed_only_when_reusable" CHECK ("last_accessed_at" is null or "purpose"::text in ('calendar_assignments', 'calendar_shop_trips')),
	CONSTRAINT "capabilities_claim_only_when_claimable" CHECK ("claim_hash" is null or "purpose"::text in ('waiver_link')),
	CONSTRAINT "capabilities_spent_by_shop_only_setup" CHECK ("spent_by_shop_id" is null or "purpose"::text in ('shop_setup'))
);
--> statement-breakpoint
CREATE TABLE "cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"kind" "card_kind" NOT NULL,
	"agency" "certification_agency" NOT NULL,
	"level" "certification_level",
	"specialty" "dive_specialty",
	"identifier" text,
	"declared_identifier" text,
	"status" "certification_status" DEFAULT 'pending'::"certification_status" NOT NULL,
	"review_note" text,
	"reviewed_at" timestamp with time zone,
	"reviewed_by_person_id" uuid,
	"agency_checked_at" timestamp with time zone,
	"imported_at" timestamp with time zone,
	"imported_from_label" text,
	"self_declared_at" timestamp with time zone,
	"issued_by_shop_at" timestamp with time zone,
	"issued_from_trip_id" uuid,
	"issued_by_person_id" uuid,
	"processed_with_agency_at" timestamp with time zone,
	"processed_by_person_id" uuid,
	"listed_from_certification_id" uuid,
	"junior_status" text,
	"junior_status_verified_at" timestamp with time zone,
	"junior_status_verified_by_person_id" uuid,
	"deleted_at" timestamp with time zone,
	"deleted_by_person_id" uuid,
	"deletion_kind" "card_deletion_kind",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cards_kind_shape" CHECK (("kind" = 'level' and "level" is not null and "specialty" is null) or ("kind" = 'specialty' and "specialty" is not null and "level" is null) or ("kind" = 'nitrox' and "level" is null and "specialty" is null)),
	CONSTRAINT "cards_declared_identifier_level_only" CHECK ("declared_identifier" is null or "kind" = 'level'),
	CONSTRAINT "cards_listed_from_not_level" CHECK ("listed_from_certification_id" is null or "kind" <> 'level'),
	CONSTRAINT "cards_junior_status_level_only" CHECK ("junior_status" is null or "kind" = 'level'),
	CONSTRAINT "cards_junior_status_valid" CHECK ("junior_status" is null or "junior_status" in ('junior', 'full')),
	CONSTRAINT "cards_junior_status_evidence" CHECK (("junior_status" is null and "junior_status_verified_at" is null and "junior_status_verified_by_person_id" is null) or ("junior_status" is not null and "junior_status_verified_at" is not null and "junior_status_verified_by_person_id" is not null)),
	CONSTRAINT "cards_processed_only_when_issued" CHECK ("processed_with_agency_at" is null or "issued_by_shop_at" is not null),
	CONSTRAINT "cards_identifier_present_unless_unsighted" CHECK (("identifier" is not null and length(btrim("identifier", E' \t\n\r\f\v')) > 0) or ("self_declared_at" is not null and "status" = 'pending') or ("issued_by_shop_at" is not null and ("kind" = 'level' or "status" = 'pending')) or ("listed_from_certification_id" is not null and "kind" <> 'level' and "status" = 'pending'))
);
--> statement-breakpoint
CREATE TABLE "certification_junior_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"certification_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"recorded_by_person_id" uuid NOT NULL,
	"junior_status" text NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "certification_junior_reviews_status_valid" CHECK ("junior_status" in ('junior', 'full'))
);
--> statement-breakpoint
CREATE TABLE "prior_visits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"visited_on" date NOT NULL,
	"title" text,
	"status_label" text,
	"amount_label" text,
	"source_label" text,
	"source_reference" text,
	"dedupe_key" text NOT NULL,
	"imported_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "computer_dive_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"dive_id" uuid NOT NULL,
	"samples" jsonb NOT NULL,
	CONSTRAINT "computer_profile_samples_bounded" CHECK (jsonb_array_length("samples") <= 10000)
);
--> statement-breakpoint
CREATE TABLE "computer_dives" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"fingerprint" text NOT NULL,
	"record" jsonb NOT NULL,
	"annotation" text DEFAULT '' NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "computer_dives_annotation_bounded" CHECK (length("annotation") <= 2000)
);
--> statement-breakpoint
CREATE TABLE "computer_import_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"request_key" text NOT NULL,
	"selection_hash" text NOT NULL,
	"imported_count" integer NOT NULL,
	"skipped_count" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trip_conservation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"trip_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"quantity" double precision NOT NULL,
	"location" text DEFAULT '' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"recorded_by_person_id" uuid NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "trip_conservation_kind" CHECK ("kind" in ('litter_kg', 'litter_items', 'line_m', 'lionfish_count')),
	CONSTRAINT "trip_conservation_quantity" CHECK ("quantity" > 0 and "quantity" <= 100000 and ("kind" not in ('litter_items', 'lionfish_count') or "quantity" = trunc("quantity"::numeric)))
);
--> statement-breakpoint
CREATE TABLE "people" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"full_name" text NOT NULL,
	"staff_photo_path" text,
	"diver_photo_path" text,
	"diver_photo_suppressed" boolean DEFAULT false NOT NULL,
	"email" text,
	"phone" text,
	"emergency_contact_name" text,
	"emergency_contact_phone" text,
	"date_of_birth" date,
	"adult_attested_at" timestamp with time zone,
	"adult_attested_by_person_id" uuid,
	"dive_insurance" text,
	"no_certification_declared_at" timestamp with time zone,
	"no_certification_cleared_at" timestamp with time zone,
	"no_certification_cleared_by_person_id" uuid,
	"drysuit_experience_seen_at" timestamp with time zone,
	"drysuit_experience_seen_by_person_id" uuid,
	"drysuit_experience_seen_note" text,
	"last_dive_on" date,
	"last_dive_reported_on" date,
	"locale" text,
	"spoken_languages" jsonb DEFAULT '[]' NOT NULL,
	"crew_public_consent_at" timestamp with time zone,
	"crew_public_name" text,
	"public_staff_profile_enabled" boolean DEFAULT false NOT NULL,
	"public_staff_profile" jsonb,
	"courtesy_email_opt_out_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"anonymized_at" timestamp with time zone,
	"anonymized_by_person_id" uuid,
	"merged_into_person_id" uuid,
	"merged_at" timestamp with time zone,
	"merged_by_person_id" uuid,
	"created_by_booking_id" uuid,
	"origin" "person_origin" DEFAULT 'seed'::"person_origin" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "people_anonymized_stays_removed" CHECK ("anonymized_at" is null or "deleted_at" is not null),
	CONSTRAINT "people_merged_stays_removed" CHECK ("merged_into_person_id" is null or "deleted_at" is not null),
	CONSTRAINT "people_merge_metadata_complete" CHECK (("merged_into_person_id" is null and "merged_at" is null and "merged_by_person_id" is null) or ("merged_into_person_id" is not null and "merged_at" is not null and "merged_by_person_id" is not null)),
	CONSTRAINT "people_cannot_merge_into_self" CHECK ("merged_into_person_id" is null or "merged_into_person_id" <> "id"),
	CONSTRAINT "people_crew_public_name_with_consent" CHECK (("crew_public_consent_at" is null) = (nullif(btrim("crew_public_name"), '') is null))
);
--> statement-breakpoint
CREATE TABLE "person_roles" (
	"person_id" uuid,
	"role" "person_role",
	CONSTRAINT "person_roles_pkey" PRIMARY KEY("person_id","role")
);
--> statement-breakpoint
CREATE TABLE "shops" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"name" text NOT NULL,
	"offline_erasure_epoch" integer DEFAULT 0 NOT NULL,
	"slug" text NOT NULL UNIQUE,
	"timezone" text NOT NULL,
	"default_locale" text DEFAULT 'en-US' NOT NULL,
	"currency" text DEFAULT 'usd' NOT NULL,
	"trip_defaults" jsonb,
	"tax_enabled" boolean DEFAULT false NOT NULL,
	"pass_through_fee" jsonb DEFAULT 'null',
	"jurisdiction" "medical_jurisdiction" DEFAULT 'rstc'::"medical_jurisdiction" NOT NULL,
	"depth_unit" "depth_unit" DEFAULT 'meters'::"depth_unit" NOT NULL,
	"require_adult_buddy_for_teens" boolean DEFAULT false NOT NULL,
	"temperature_unit" "temperature_unit" DEFAULT 'celsius'::"temperature_unit" NOT NULL,
	"has_boat_diving" boolean DEFAULT true NOT NULL,
	"has_shore_diving" boolean DEFAULT false NOT NULL,
	"has_pool_diving" boolean DEFAULT false NOT NULL,
	"divers_per_divemaster" integer DEFAULT 6 NOT NULL,
	"crew_schedule_enabled" boolean DEFAULT true NOT NULL,
	"time_off_approval_enabled" boolean DEFAULT true NOT NULL,
	"wallet_passes_enabled" boolean DEFAULT true NOT NULL,
	"reviews_enabled" boolean DEFAULT true NOT NULL,
	"conservation_enabled" boolean DEFAULT true NOT NULL,
	"course_pulse_enabled" boolean DEFAULT true NOT NULL,
	"date_requests_enabled" boolean DEFAULT true NOT NULL,
	"last_minute_list_enabled" boolean DEFAULT true NOT NULL,
	"tips_enabled" boolean DEFAULT true NOT NULL,
	"public_year_enabled" boolean DEFAULT true NOT NULL,
	"padi_checks_enabled" boolean DEFAULT true NOT NULL,
	"claude_suggestions_enabled" boolean DEFAULT true NOT NULL,
	"recap_assist_auto_approve" boolean DEFAULT true NOT NULL,
	"lost_found_enabled" boolean DEFAULT true NOT NULL,
	"work_orders_enabled" boolean DEFAULT true NOT NULL,
	"promo_codes_enabled" boolean DEFAULT true NOT NULL,
	"dive_packages_enabled" boolean DEFAULT true NOT NULL,
	"checkout_recovery_enabled" boolean DEFAULT true NOT NULL,
	"buddy_links_enabled" boolean DEFAULT true NOT NULL,
	"buddy_teams_enabled" boolean DEFAULT true NOT NULL,
	"sightings_enabled" boolean DEFAULT true NOT NULL,
	"diver_photos_enabled" boolean DEFAULT true NOT NULL,
	"self_registration_enabled" boolean DEFAULT true NOT NULL,
	"waitlist_enabled" boolean DEFAULT true NOT NULL,
	"past_diver_invites_enabled" boolean DEFAULT true NOT NULL,
	"help_requests_enabled" boolean DEFAULT true NOT NULL,
	"partner_links_enabled" boolean DEFAULT true NOT NULL,
	"week_out_reminder_enabled" boolean DEFAULT true NOT NULL,
	"seat_sold_alerts_enabled" boolean DEFAULT false NOT NULL,
	"private_charters_enabled" boolean DEFAULT true NOT NULL,
	"public_staff_profiles_enabled" boolean DEFAULT true NOT NULL,
	"computer_dives_enabled" boolean DEFAULT true NOT NULL,
	"courses_enabled" boolean DEFAULT true NOT NULL,
	"embeds_enabled" boolean DEFAULT true NOT NULL,
	"seat_sold_alerted_through" timestamp with time zone,
	"public_conditions_enabled" boolean DEFAULT true NOT NULL,
	"field_guide_enabled" boolean DEFAULT true NOT NULL,
	"contact_email" text,
	"contact_email_confirmed_at" timestamp with time zone,
	"inbound_email_token" uuid DEFAULT gen_random_uuid() NOT NULL,
	"contact_phone" text,
	"review_url" text,
	"address_street" text,
	"address_locality" text,
	"address_region" text,
	"address_postal_code" text,
	"address_country" text,
	"packing_list" jsonb DEFAULT '["Swimsuit and towel","Reef-safe sun protection"]' NOT NULL,
	"packing_logbook" boolean DEFAULT true NOT NULL,
	"rental_items" jsonb DEFAULT '["bcd","regulator","wetsuit","mask","fins","weights","dive_computer"]' NOT NULL,
	"rental_pricing" jsonb DEFAULT '{"setCents":null,"perItemCents":{},"nitroxCents":null}' NOT NULL,
	"rental_terms" text,
	"reply_notes" text,
	"customer_regulator_service_months" integer DEFAULT 12 NOT NULL,
	"nitrox_fill_method" "nitrox_fill_method" DEFAULT 'blending'::"nitrox_fill_method" NOT NULL,
	"emergency_reference" jsonb DEFAULT '{"lines":[],"vessel":"","shoreContact":"","plan":""}' NOT NULL,
	"shore_alert_email" text,
	"shore_alert_consent_at" timestamp with time zone,
	"shore_alert_consent_by_person_id" uuid,
	"shore_alert_confirmed_at" timestamp with time zone,
	"bookkeeper_email" text,
	"bookkeeper_email_set_at" timestamp with time zone,
	"bookkeeper_email_set_by_person_id" uuid,
	"bookkeeper_sent_month" text,
	"bookkeeper_confirmed_at" timestamp with time zone,
	"bookkeeper_confirm_token_hash" text,
	"bookkeeper_confirm_expires_at" timestamp with time zone,
	"bookkeeper_bounced_at" timestamp with time zone,
	"name_flagged_at" timestamp with time zone,
	"name_cleared_at" timestamp with time zone,
	"dock_call_minutes" integer DEFAULT 30 NOT NULL,
	"offers_hotel_pickup" boolean DEFAULT true NOT NULL,
	"desk_payment" "desk_payment",
	"gear_setup_minutes" integer DEFAULT 0 NOT NULL,
	"briefing_minutes" integer DEFAULT 15 NOT NULL,
	"boat_ride_minutes" integer DEFAULT 20 NOT NULL,
	"bottom_time_minutes" integer DEFAULT 45 NOT NULL,
	"surface_interval_minutes" integer DEFAULT 60 NOT NULL,
	"min_turnaround_minutes" integer DEFAULT 30 NOT NULL,
	"crew_lead_minutes" integer DEFAULT 30,
	"season_start_month" integer DEFAULT 1 NOT NULL,
	"season_start_day" integer DEFAULT 1 NOT NULL,
	"reopens_on" text,
	"desk_opens_minute" integer DEFAULT 480 NOT NULL,
	"desk_closes_minute" integer DEFAULT 1080 NOT NULL,
	"desk_hours_confirmed_at" timestamp with time zone,
	"units_confirmed_at" timestamp with time zone,
	"is_demo" boolean DEFAULT false NOT NULL,
	"demo_starts_dismissed_at" timestamp with time zone,
	"search_listing_opt_out_at" timestamp with time zone,
	"notice_text" text,
	"storefront_leads" text DEFAULT 'schedule' NOT NULL,
	"pick_trip_id" uuid,
	"pick_course_id" uuid,
	"welcome_text" text,
	"welcome_signer" text,
	"tagline" text,
	"description" text,
	"logo_url" text,
	"brand_color" text,
	"brand_display_font" "brand_display_font",
	"brand_hero_image_url" text,
	"brand_hero_image_alt" text,
	"shopfront_photo_urls" jsonb DEFAULT '[]' NOT NULL,
	"established_year" integer,
	"brand_badges" jsonb DEFAULT '[]' NOT NULL,
	"latitude" double precision,
	"longitude" double precision,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shops_one_pick" CHECK ("pick_trip_id" is null or "pick_course_id" is null),
	CONSTRAINT "shops_storefront_leads_known" CHECK ("storefront_leads" in ('schedule', 'courses')),
	CONSTRAINT "shops_dock_call_minutes_nonnegative" CHECK ("dock_call_minutes" >= 0),
	CONSTRAINT "shops_offline_erasure_epoch_nonnegative" CHECK ("offline_erasure_epoch" >= 0),
	CONSTRAINT "shops_shore_alert_consent" CHECK (("shore_alert_email" is null and "shore_alert_consent_at" is null
        and "shore_alert_consent_by_person_id" is null)
        or ("shore_alert_email" is not null and "shore_alert_consent_at" is not null
        and "shore_alert_consent_by_person_id" is not null)),
	CONSTRAINT "shops_bookkeeper_email_provenance" CHECK (("bookkeeper_email" is null and "bookkeeper_email_set_at" is null
        and "bookkeeper_email_set_by_person_id" is null)
        or ("bookkeeper_email" is not null and "bookkeeper_email_set_at" is not null
        and "bookkeeper_email_set_by_person_id" is not null)),
	CONSTRAINT "shops_bookkeeper_confirmation_has_address" CHECK ("bookkeeper_email" is not null
        or ("bookkeeper_confirmed_at" is null and "bookkeeper_confirm_token_hash" is null)),
	CONSTRAINT "shops_bookkeeper_bounce_has_address" CHECK ("bookkeeper_email" is not null or "bookkeeper_bounced_at" is null),
	CONSTRAINT "shops_bookkeeper_confirm_token_expiry" CHECK (("bookkeeper_confirm_token_hash" is null) = ("bookkeeper_confirm_expires_at" is null)),
	CONSTRAINT "shops_bookkeeper_sent_month_shape" CHECK ("bookkeeper_sent_month" is null or "bookkeeper_sent_month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
	CONSTRAINT "shops_shore_alert_confirmed_has_address" CHECK ("shore_alert_confirmed_at" is null or "shore_alert_email" is not null),
	CONSTRAINT "shops_customer_regulator_service_months_choice" CHECK ("customer_regulator_service_months" in (12, 24)),
	CONSTRAINT "shops_desk_hours_in_day" CHECK ("desk_opens_minute" >= 0 and "desk_closes_minute" <= 1440
        and "desk_opens_minute" < "desk_closes_minute"),
	CONSTRAINT "shops_reopens_on_is_a_date" CHECK ("reopens_on" is null or "reopens_on" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
	CONSTRAINT "shops_season_start_month_in_range" CHECK ("season_start_month" >= 1 and "season_start_month" <= 12),
	CONSTRAINT "shops_season_start_day_in_month" CHECK ("season_start_day" >= 1 and "season_start_day" <= 31
        and not ("season_start_month" = 2 and "season_start_day" > 28)
        and not ("season_start_month" in (4, 6, 9, 11) and "season_start_day" > 30)),
	CONSTRAINT "shops_established_year_plausible" CHECK ("established_year" IS NULL OR ("established_year" >= 1900 AND "established_year" <= 2100)),
	CONSTRAINT "shops_brand_color_hex" CHECK ("brand_color" IS NULL OR "brand_color" ~ '^#[0-9a-f]{6}$'),
	CONSTRAINT "shops_gear_setup_minutes_nonnegative" CHECK ("gear_setup_minutes" >= 0),
	CONSTRAINT "shops_briefing_minutes_nonnegative" CHECK ("briefing_minutes" >= 0),
	CONSTRAINT "shops_boat_ride_minutes_nonnegative" CHECK ("boat_ride_minutes" >= 0),
	CONSTRAINT "shops_bottom_time_minutes_positive" CHECK ("bottom_time_minutes" > 0),
	CONSTRAINT "shops_surface_interval_minutes_nonnegative" CHECK ("surface_interval_minutes" >= 0),
	CONSTRAINT "shops_min_turnaround_minutes_range" CHECK ("min_turnaround_minutes" >= 0 and "min_turnaround_minutes" <= 240),
	CONSTRAINT "shops_crew_lead_minutes_range" CHECK ("crew_lead_minutes" IS NULL OR ("crew_lead_minutes" >= 5 and "crew_lead_minutes" <= 180)),
	CONSTRAINT "shops_divers_per_divemaster_in_range" CHECK ("divers_per_divemaster" >= 1 and "divers_per_divemaster" <= 20),
	CONSTRAINT "shops_offers_some_dive_mode" CHECK ("has_boat_diving" or "has_shore_diving" or "has_pool_diving")
);
--> statement-breakpoint
CREATE TABLE "user_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"person_id" uuid NOT NULL,
	"email" text NOT NULL,
	"hashed_password" text,
	"status" "account_status" DEFAULT 'active'::"account_status" NOT NULL,
	"email_verified_at" timestamp with time zone,
	"email_verified" boolean DEFAULT false NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"image" text,
	"orientation_dismissed_at" timestamp with time zone,
	"weekly_digest" boolean,
	"after_hours_ping" boolean,
	"after_hours_pinged_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "course_form_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"booking_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"form_id" uuid NOT NULL,
	"form_version_id" uuid NOT NULL,
	"form_title" text NOT NULL,
	"form_version" integer NOT NULL,
	"form_body" text NOT NULL,
	"course_title" text NOT NULL,
	"trip_id" uuid NOT NULL,
	"signed_via_booking_id" uuid,
	"instructor_names" text NOT NULL,
	"paper_signed_on" date,
	"signed_name" text,
	"signature_method" text NOT NULL,
	"recorded_by_person_id" uuid,
	"consented_at" timestamp with time zone NOT NULL,
	"signed_at" timestamp with time zone NOT NULL,
	"guardian_name" text,
	"guardian_relationship" text,
	"guardian_signature_method" text,
	"guardian_consented_at" timestamp with time zone,
	"guardian_signed_at" timestamp with time zone,
	"anonymized_at" timestamp with time zone,
	"anonymized_by_person_id" uuid,
	"integrity_hash" text,
	"integrity_version" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "course_form_records_integrity_whole" CHECK (("integrity_hash" is null) = ("integrity_version" is null)),
	CONSTRAINT "course_form_records_signed_via_other_seat" CHECK ("signed_via_booking_id" is null or "signed_via_booking_id" <> "booking_id"),
	CONSTRAINT "course_form_records_signature_method_known" CHECK ("signature_method" in ('typed_consent', 'in_person_attested', 'in_person_attested_namesake')),
	CONSTRAINT "course_form_records_paper_attributed" CHECK (("signature_method" = 'typed_consent') = ("recorded_by_person_id" is null)),
	CONSTRAINT "course_form_records_signed_name_present" CHECK ("signed_name" is not null or "anonymized_at" is not null),
	CONSTRAINT "course_form_records_guardian_signature_whole" CHECK (("guardian_signed_at" is null) = ("guardian_consented_at" is null)
        and ("guardian_signed_at" is null) = ("guardian_signature_method" is null)
        and ("guardian_signed_at" is null) = ("guardian_relationship" is null))
);
--> statement-breakpoint
CREATE TABLE "course_form_requirements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"form_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"max_age_years" integer,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "course_form_requirements_max_age_sane" CHECK ("max_age_years" is null or ("max_age_years" >= 1 and "max_age_years" <= 120))
);
--> statement-breakpoint
CREATE TABLE "course_form_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"form_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"created_by_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "course_forms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"medical_screening" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "course_elearning_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"code" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"booking_id" uuid,
	"assigned_at" timestamp with time zone,
	"assigned_by_person_id" uuid,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "course_elearning_codes_named" CHECK (length(btrim("code")) > 0),
	CONSTRAINT "course_elearning_codes_assigned_pair" CHECK (("booking_id" is null) = ("assigned_at" is null))
);
--> statement-breakpoint
CREATE TABLE "course_session_progress" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"step_title" text NOT NULL,
	"done_at" timestamp with time zone DEFAULT now() NOT NULL,
	"done_by_person_id" uuid NOT NULL,
	CONSTRAINT "course_session_progress_step_named" CHECK (length(btrim("step_title")) > 0)
);
--> statement-breakpoint
CREATE TABLE "courses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"title" text NOT NULL,
	"agency" text DEFAULT 'padi' NOT NULL,
	"description" text,
	"source_template_slug" text,
	"source_template_version" integer,
	"source_template_snapshot" jsonb,
	"slug" text NOT NULL,
	"summary" text,
	"overview" text,
	"hero_image_url" text,
	"hero_image_alt" text,
	"gallery_photos" jsonb DEFAULT '[]' NOT NULL,
	"duration_text" text,
	"group_size_text" text,
	"minimum_age" integer,
	"prerequisite_note" text,
	"includes" jsonb DEFAULT '[]' NOT NULL,
	"excludes" jsonb DEFAULT '[]' NOT NULL,
	"schedule_days" jsonb DEFAULT '[]' NOT NULL,
	"faqs" jsonb DEFAULT '[]' NOT NULL,
	"learning_materials" jsonb DEFAULT '[]' NOT NULL,
	"price_cents" integer,
	"e_learning_price_cents" integer,
	"private_price_cents" integer,
	"minimum_certification_level" "certification_level",
	"certifies_level" "certification_level",
	"is_active" boolean DEFAULT true NOT NULL,
	"is_intro_course" boolean DEFAULT false NOT NULL,
	"nitrox_compatible" boolean DEFAULT true NOT NULL,
	"included_rental_kinds" jsonb DEFAULT '[]' NOT NULL,
	"included_personal_gear" jsonb DEFAULT '[]' NOT NULL,
	"row_version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "courses_price_nonnegative" CHECK ("price_cents" is null or "price_cents" >= 0),
	CONSTRAINT "courses_e_learning_price_nonnegative" CHECK ("e_learning_price_cents" is null or "e_learning_price_cents" >= 0),
	CONSTRAINT "courses_private_price_nonnegative" CHECK ("private_price_cents" is null or "private_price_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "crew_assignment_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"trip_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decision" "crew_request_decision",
	"decided_at" timestamp with time zone,
	"decided_by_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "crew_assignment_requests_decided_together" CHECK (("decision" is null) = ("decided_at" is null)
        and ("decision" is null) = ("decided_by_person_id" is null))
);
--> statement-breakpoint
CREATE TABLE "crew_availability_blocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"note" text,
	"status" text DEFAULT 'approved' NOT NULL,
	"decided_by_person_id" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"created_by_person_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "crew_availability_blocks_status_known" CHECK ("status" in ('pending', 'approved', 'declined')),
	CONSTRAINT "crew_availability_blocks_ends_on_or_after" CHECK ("ends_on" >= "starts_on")
);
--> statement-breakpoint
CREATE TABLE "crew_away_acknowledgements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"trip_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"acknowledged_by_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"cleared_by_person_id" uuid
);
--> statement-breakpoint
CREATE TABLE "crew_notices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"trip_id" uuid NOT NULL,
	"change" "crew_notice_change" NOT NULL,
	"previous_starts_at" timestamp with time zone,
	"actor_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"settled_at" timestamp with time zone,
	"outcome" "crew_notice_outcome",
	"seq" bigserial
);
--> statement-breakpoint
CREATE TABLE "staff_credential_history" (
	"seq" bigserial PRIMARY KEY,
	"shop_id" uuid NOT NULL,
	"credential_id" uuid NOT NULL,
	"event" text NOT NULL,
	"kind" "staff_credential_kind" NOT NULL,
	"issued_at" date,
	"renews_at" date,
	"active" boolean NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "staff_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"kind" "staff_credential_kind" NOT NULL,
	"name" text NOT NULL,
	"issuing_body" text,
	"identifier" text,
	"issued_at" date,
	"renews_at" date,
	"revision" integer DEFAULT 0 NOT NULL,
	"status" "certification_status" DEFAULT 'pending'::"certification_status" NOT NULL,
	"review_note" text,
	"reviewed_at" timestamp with time zone,
	"reviewed_by_person_id" uuid,
	"deleted_at" timestamp with time zone,
	"deleted_by_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_credentials_renewal_after_issue" CHECK ("issued_at" is null or "renews_at" is null or "renews_at" >= "issued_at")
);
--> statement-breakpoint
CREATE TABLE "staff_shifts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"note" text,
	"created_by_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_shifts_ends_after_starts" CHECK ("ends_at" > "starts_at")
);
--> statement-breakpoint
CREATE TABLE "trip_assignments" (
	"trip_id" uuid,
	"person_id" uuid,
	"offline_incarnation" uuid DEFAULT gen_random_uuid() NOT NULL,
	"trip_role" "trip_assignment_role",
	"assigned_by_person_id" uuid,
	"training_plan_instructor_person_id" uuid,
	"training_plan_by_person_id" uuid,
	"training_plan_at" timestamp with time zone,
	CONSTRAINT "trip_assignments_pkey" PRIMARY KEY("trip_id","person_id")
);
--> statement-breakpoint
CREATE TABLE "trip_series_crew" (
	"shop_id" uuid NOT NULL,
	"series_id" uuid,
	"person_id" uuid,
	"trip_role" "trip_assignment_role",
	CONSTRAINT "trip_series_crew_pkey" PRIMARY KEY("series_id","person_id")
);
--> statement-breakpoint
CREATE TABLE "boarding_observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"trip_id" uuid NOT NULL,
	"booking_id" uuid NOT NULL,
	"client_key" text NOT NULL,
	"recorded_by_person_id" uuid NOT NULL,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"state" "boarding_observation_state" DEFAULT 'pending'::"boarding_observation_state" NOT NULL,
	"conflict_code" text,
	"settled_at" timestamp with time zone,
	"dismissed_by_person_id" uuid,
	CONSTRAINT "boarding_observations_client_key_length" CHECK (length("client_key") between 8 and 100),
	CONSTRAINT "boarding_observations_conflict_has_code" CHECK (("state" = 'conflict') = ("conflict_code" is not null)),
	CONSTRAINT "boarding_observations_settled_unless_pending" CHECK (("state" = 'pending') = ("settled_at" is null)),
	CONSTRAINT "boarding_observations_dismissed_by" CHECK (("state" = 'dismissed') = ("dismissed_by_person_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "departure_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"trip_id" uuid NOT NULL,
	"body" text NOT NULL,
	"sent_by_person_id" uuid,
	"recipients" integer DEFAULT 0 NOT NULL,
	"delivered" integer DEFAULT 0 NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "departure_notes_body_length" CHECK (length(trim("body")) between 1 and 500)
);
--> statement-breakpoint
CREATE TABLE "lost_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"trip_id" uuid NOT NULL,
	"booking_id" uuid,
	"person_id" uuid,
	"description" text NOT NULL,
	"status" "lost_item_status" DEFAULT 'open'::"lost_item_status" NOT NULL,
	"recorded_by_person_id" uuid,
	"resolved_at" timestamp with time zone,
	"resolved_by_person_id" uuid,
	"told_at" timestamp with time zone,
	"told_channel" "lost_item_told_channel",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lost_items_description_length" CHECK (length(trim("description")) between 1 and 120),
	CONSTRAINT "lost_items_resolved_matches_status" CHECK (("status" = 'open') = ("resolved_at" is null)),
	CONSTRAINT "lost_items_seat_and_person_together" CHECK (("booking_id" is null) = ("person_id" is null))
);
--> statement-breakpoint
CREATE TABLE "boat_snags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"boat_id" uuid NOT NULL,
	"checklist_item_id" uuid NOT NULL,
	"noted_on_trip_id" uuid NOT NULL,
	"note" text NOT NULL,
	"noted_by_person_id" uuid NOT NULL,
	"noted_at" timestamp with time zone NOT NULL,
	"still_there_on_trip_id" uuid,
	"still_there_by_person_id" uuid,
	"still_there_at" timestamp with time zone,
	"fixed_on_trip_id" uuid,
	"fixed_by_person_id" uuid,
	"fixed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "boat_snags_note_length" CHECK (char_length("note") between 1 and 280),
	CONSTRAINT "boat_snags_fixed_whole" CHECK (("fixed_at" is null) = ("fixed_by_person_id" is null)),
	CONSTRAINT "boat_snags_still_there_whole" CHECK (("still_there_at" is null) = ("still_there_by_person_id" is null))
);
--> statement-breakpoint
CREATE TABLE "booking_arrival_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"trip_id" uuid NOT NULL,
	"booking_id" uuid NOT NULL,
	"recorded_by_person_id" uuid NOT NULL,
	"status" "arrival_status" NOT NULL,
	"source" "roll_call_source" DEFAULT 'live'::"roll_call_source" NOT NULL,
	"client_event_id" uuid,
	"offline_snapshot_saved_at" timestamp with time zone,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"seq" bigserial
);
--> statement-breakpoint
CREATE TABLE "buddy_team_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"trip_id" uuid NOT NULL,
	"pair_id" uuid NOT NULL,
	"action" "buddy_team_event_action" NOT NULL,
	"member_names" jsonb DEFAULT '[]' NOT NULL,
	"recorded_by_person_id" uuid NOT NULL,
	"adults_confirmed" boolean DEFAULT false NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "buddy_team_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"trip_id" uuid NOT NULL,
	"pair_id" uuid NOT NULL,
	"booking_id" uuid,
	"crew_person_id" uuid,
	"paired_by_person_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "buddy_team_members_one_subject" CHECK (("booking_id" is not null) <> ("crew_person_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "departure_boat_safety_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"trip_id" uuid NOT NULL,
	"boat_id" uuid NOT NULL,
	"boat_name" text NOT NULL,
	"judged_on" date NOT NULL,
	"departure_starts_at" timestamp with time zone,
	"papers" jsonb NOT NULL,
	"radio" jsonb DEFAULT '{"callSign":null,"mmsi":null,"workingChannel":null}' NOT NULL,
	"notices" jsonb NOT NULL,
	"captured_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "disruption_recovery_events" (
	"id" uuid PRIMARY KEY,
	"shop_id" uuid NOT NULL,
	"blowout_diver_id" uuid NOT NULL,
	"actor_person_id" uuid NOT NULL,
	"outcome" text NOT NULL,
	"replacement_booking_id" uuid,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"seq" bigserial,
	CONSTRAINT "disruption_recovery_events_outcome" CHECK ("outcome" in ('pending', 'contacted', 'declined', 'rebooked')),
	CONSTRAINT "disruption_recovery_events_link" CHECK (("outcome" = 'rebooked') = ("replacement_booking_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "dive_participation_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"trip_id" uuid NOT NULL,
	"booking_id" uuid NOT NULL,
	"dive_number" integer NOT NULL,
	"participation" "dive_participation" NOT NULL,
	"recorded_by_person_id" uuid NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"seq" bigserial,
	CONSTRAINT "dive_participation_notes_dive_number_positive" CHECK ("dive_number" >= 1)
);
--> statement-breakpoint
CREATE TABLE "pre_departure_check_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"trip_id" uuid NOT NULL,
	"checklist_item_id" uuid NOT NULL,
	"recorded_by_person_id" uuid NOT NULL,
	"status" "pre_departure_check_status" NOT NULL,
	"source" "roll_call_source" DEFAULT 'live'::"roll_call_source" NOT NULL,
	"client_event_id" uuid,
	"note" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"seq" bigserial
);
--> statement-breakpoint
CREATE TABLE "pre_departure_checklist_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"label" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "roll_call_deck_counts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"trip_id" uuid NOT NULL,
	"checkpoint" text NOT NULL,
	"counted" integer NOT NULL,
	"recorded_by_person_id" uuid NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"seq" bigserial,
	CONSTRAINT "roll_call_deck_counts_counted_range" CHECK ("counted" between 0 and 999)
);
--> statement-breakpoint
CREATE TABLE "roll_call_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"trip_id" uuid NOT NULL,
	"subject_kind" "roll_call_subject_kind" DEFAULT 'seat'::"roll_call_subject_kind" NOT NULL,
	"booking_id" uuid,
	"crew_person_id" uuid,
	"recorded_by_person_id" uuid NOT NULL,
	"effective_status" "roll_call_status" NOT NULL,
	"statement_status" "roll_call_status" NOT NULL,
	"offline_meeting_generation" integer,
	"offline_assignment_generation" integer,
	"offline_crew_assignment_id" uuid,
	"capture_context" jsonb,
	"observed_evidence_ids" jsonb,
	"reconciles_evidence" boolean DEFAULT false NOT NULL,
	"meeting_day" integer,
	"causal_frontier" jsonb NOT NULL,
	"evidence_conflict" boolean DEFAULT false NOT NULL,
	"evidence_ordering_unknown" boolean DEFAULT false NOT NULL,
	"checkpoint" text DEFAULT 'departure' NOT NULL,
	"source" "roll_call_source" DEFAULT 'live'::"roll_call_source" NOT NULL,
	"client_event_id" uuid,
	"retracts_event_id" uuid,
	"offline_snapshot_saved_at" timestamp with time zone,
	"note" text,
	"readiness_status" text,
	"certification_snapshot" jsonb,
	"certification_snapshot_started_at" timestamp with time zone,
	"certification_snapshot_captured_at" timestamp with time zone,
	"readiness_blockers" jsonb,
	"credential_snapshot" jsonb,
	"credential_snapshot_started_at" timestamp with time zone,
	"credential_snapshot_captured_at" timestamp with time zone,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"seq" bigserial,
	CONSTRAINT "roll_call_events_subject" CHECK (("subject_kind" = 'seat' and "booking_id" is not null and "crew_person_id" is null) or ("subject_kind" = 'crew' and "crew_person_id" is not null and "booking_id" is null)),
	CONSTRAINT "roll_call_events_retracts_only_cleared" CHECK ("retracts_event_id" is null or coalesce("statement_status", "effective_status") = 'cleared'),
	CONSTRAINT "roll_call_events_offline_snapshot_seat_only" CHECK ("offline_snapshot_saved_at" is null or "subject_kind" = 'seat'),
	CONSTRAINT "roll_call_events_certification_snapshot_shape" CHECK (("certification_snapshot" is null and "certification_snapshot_started_at" is null and "certification_snapshot_captured_at" is null) or ("certification_snapshot" is not null and "certification_snapshot_started_at" is not null and "certification_snapshot_captured_at" is not null and "certification_snapshot_started_at" <= "certification_snapshot_captured_at" and "subject_kind" = 'seat' and coalesce("statement_status", "effective_status") = 'boarded' and "checkpoint" = 'departure' and "source" = 'live' and jsonb_typeof("certification_snapshot") = 'array')),
	CONSTRAINT "roll_call_events_readiness_snapshot_shape" CHECK (("readiness_status" is null and "readiness_blockers" is null) or ("subject_kind" = 'seat' and coalesce("statement_status", "effective_status") = 'boarded' and "readiness_status" in ('ready', 'blocked'))),
	CONSTRAINT "roll_call_events_credential_snapshot_shape" CHECK (("credential_snapshot" is null and "credential_snapshot_started_at" is null and "credential_snapshot_captured_at" is null) or ("credential_snapshot" is not null and "credential_snapshot_started_at" is not null and "credential_snapshot_captured_at" is not null and "credential_snapshot_started_at" <= "credential_snapshot_captured_at" and "subject_kind" = 'crew' and coalesce("statement_status", "effective_status") = 'boarded' and "checkpoint" = 'departure' and "source" = 'live' and jsonb_typeof("credential_snapshot") = 'array'))
);
--> statement-breakpoint
CREATE TABLE "safety_drill_participants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"drill_id" uuid NOT NULL,
	"person_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "safety_drills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"kind" "safety_drill_kind" NOT NULL,
	"held_on" date NOT NULL,
	"note" text,
	"recorded_by_person_id" uuid NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by_person_id" uuid,
	CONSTRAINT "safety_drills_deleted_by_whom" CHECK (("deleted_at" is null) = ("deleted_by_person_id" is null))
);
--> statement-breakpoint
CREATE TABLE "trip_blowout_divers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"blowout_id" uuid NOT NULL,
	"booking_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"message_status" "blowout_message_status" DEFAULT 'pending'::"blowout_message_status" NOT NULL,
	"notified_at" timestamp with time zone,
	"offered_trip_ids" jsonb DEFAULT '[]' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trip_blowouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"trip_id" uuid NOT NULL,
	"called_by_person_id" uuid NOT NULL,
	"called_at" timestamp with time zone NOT NULL,
	"cause" "trip_blowout_cause" DEFAULT 'weather'::"trip_blowout_cause" NOT NULL,
	"same_call_trip_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"preferred_alternative_trip_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trip_blowouts_preferred_alternatives_cap" CHECK (cardinality("preferred_alternative_trip_ids") <= 3)
);
--> statement-breakpoint
CREATE TABLE "dive_site_creatures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"dive_site_id" uuid NOT NULL,
	"catalog_slug" text,
	"position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dive_sites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"source_template_id" uuid,
	"source_template_version" integer,
	"template_update_undo" jsonb,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"location_name" text,
	"forecast_latitude" double precision,
	"forecast_longitude" double precision,
	"tide_station_id" text,
	"tide_station_confirmed" boolean DEFAULT false NOT NULL,
	"tide_preference" "dive_site_tide_preference" DEFAULT 'any'::"dive_site_tide_preference" NOT NULL,
	"satellite_image_url" text,
	"route_image_url" text,
	"image_urls" jsonb DEFAULT '[]' NOT NULL,
	"marine_life" text,
	"marine_life_description" text,
	"conservation_note" text,
	"difficulty_level" "dive_site_difficulty",
	"snorkel_suitable" boolean,
	"depth_range" text,
	"depth_min_meters" double precision,
	"max_depth_meters" double precision,
	"expected_bottom_time_minutes" integer,
	"current_note" text,
	"dive_plan" text,
	"fit_tone" "dive_site_fit_tone",
	"fit_note" text,
	"field_guide_tips_heading" text,
	"landmarks" jsonb DEFAULT '[]' NOT NULL,
	"route_points" jsonb DEFAULT '[]' NOT NULL,
	"route_label" text,
	"route_note" text,
	"route_zoom" integer DEFAULT 16 NOT NULL,
	"minimum_certification_level" "certification_level",
	"required_specialties" jsonb DEFAULT '[]' NOT NULL,
	"requires_nitrox" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"row_version" integer DEFAULT 0 NOT NULL,
	"planning_note" text,
	"planning_note_at" timestamp with time zone,
	"planning_note_by_person_id" uuid,
	"closed_from" date,
	"closed_until" date,
	"closure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dive_sites_planning_note_attributed" CHECK (("planning_note" is null) = ("planning_note_at" is null)
        and ("planning_note_at" is null) = ("planning_note_by_person_id" is null)),
	CONSTRAINT "dive_sites_planning_note_not_blank" CHECK ("planning_note" is null or length(btrim("planning_note")) > 0),
	CONSTRAINT "dive_sites_depth_range_ordered" CHECK ("depth_min_meters" is null
        or ("depth_min_meters" >= 0
          and "max_depth_meters" is not null
          and "depth_min_meters" <= "max_depth_meters")),
	CONSTRAINT "dive_sites_closure_window" CHECK (("closed_from" is null) = ("closed_until" is null)
        and ("closed_from" is null or "closed_from" <= "closed_until")),
	CONSTRAINT "dive_sites_closure_reason" CHECK ("closure_reason" is null
        or ("closed_from" is not null and char_length("closure_reason") between 1 and 120)),
	CONSTRAINT "dive_sites_expected_bottom_time_positive" CHECK ("expected_bottom_time_minutes" is null or "expected_bottom_time_minutes" > 0)
);
--> statement-breakpoint
CREATE TABLE "global_dive_site_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"global_dive_site_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"briefing" jsonb NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "global_dive_sites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"slug" text NOT NULL UNIQUE,
	"current_version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "marine_life_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"requested_by_person_id" uuid NOT NULL,
	"query" text NOT NULL,
	"dive_site_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "media_deletion_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"person_id" uuid,
	"kind" "media_deletion_kind" NOT NULL,
	"url" text NOT NULL,
	"purge_versions" boolean DEFAULT true NOT NULL,
	"status" "media_deletion_status" DEFAULT 'pending'::"media_deletion_status" NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "private_person_photo_uploads" (
	"url" text PRIMARY KEY,
	"shop_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"state" text NOT NULL,
	"put_finished" boolean DEFAULT false NOT NULL,
	"clean_after_put" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_cleanup_at" timestamp with time zone,
	"last_cleanup_error" text,
	CONSTRAINT "private_person_photo_uploads_state_check" CHECK ("state" in ('staged', 'active', 'retired'))
);
--> statement-breakpoint
CREATE TABLE "processor_erasure_obligations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"target" "processor_erasure_target" NOT NULL,
	"external_id" text NOT NULL,
	"stripe_account_id" text NOT NULL,
	"status" "processor_erasure_status" DEFAULT 'owed'::"processor_erasure_status" NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"discharged_at" timestamp with time zone,
	"discharged_by_person_id" uuid,
	CONSTRAINT "processor_erasure_obligations_discharged_consistent" CHECK (("status" = 'discharged') = ("discharged_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "demo_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"source" text NOT NULL,
	"role" text NOT NULL,
	"entered_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "demo_previews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"demo_shop_id" uuid NOT NULL,
	"shop_slug" text NOT NULL,
	"prospect_name" text NOT NULL,
	"prospect_site" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"fetch_count" integer DEFAULT 0 NOT NULL,
	"first_fetched_at" timestamp with time zone,
	"open_count" integer DEFAULT 0 NOT NULL,
	"first_opened_at" timestamp with time zone,
	"last_opened_at" timestamp with time zone,
	"active_count" integer DEFAULT 0 NOT NULL,
	"first_active_at" timestamp with time zone,
	"last_active_at" timestamp with time zone,
	CONSTRAINT "demo_previews_counts_check" CHECK ("fetch_count" >= 0 and "open_count" >= 0 and "active_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "setup_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_name" text NOT NULL,
	"region" text NOT NULL,
	"runs_boat" boolean NOT NULL,
	"runs_shore" boolean DEFAULT false NOT NULL,
	"runs_pool" boolean DEFAULT false NOT NULL,
	"current_system" text NOT NULL,
	"current_system_guide" text,
	"contact_name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"source" text NOT NULL,
	"locale" text NOT NULL,
	"notified_at" timestamp with time zone,
	"receipt_status" text,
	"receipt_claimed_at" timestamp with time zone,
	"receipt_provider_message_id" varchar(256),
	"receipt_error_code" text,
	"pricing_plan" "pricing_plan",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "setup_requests_receipt_status_check" CHECK ("receipt_status" in ('pending', 'claimed', 'accepted', 'failed', 'unknown', 'suppressed')),
	CONSTRAINT "setup_requests_receipt_error_check" CHECK ("receipt_error_code" in ('address_cooldown', 'global_limit', 'not_configured', 'invalid_test_recipient', 'throttled', 'rejected', 'provider_rejected', 'provider_unavailable', 'network_error', 'invalid_response', 'send_exception'))
);
--> statement-breakpoint
CREATE TABLE "shop_milestones" (
	"shop_id" uuid,
	"milestone" "shop_milestone",
	"reached_at" timestamp with time zone NOT NULL,
	"stall_alerted_at" timestamp with time zone,
	CONSTRAINT "shop_milestones_pkey" PRIMARY KEY("shop_id","milestone")
);
--> statement-breakpoint
CREATE TABLE "gear_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"kind" "gear_item_kind" NOT NULL,
	"label" text NOT NULL,
	"size" text,
	"serial_number" text,
	"brand_model" text,
	"purchased_on" date,
	"status" "gear_item_status" DEFAULT 'in_service'::"gear_item_status" NOT NULL,
	"service_note" text,
	"aboard_boat_id" uuid,
	"nitrox_designated" boolean,
	"thickness_mm" integer,
	"deleted_at" timestamp with time zone,
	"deleted_by_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gear_items_thickness_mm_range" CHECK ("thickness_mm" is null or "thickness_mm" between 1 and 10)
);
--> statement-breakpoint
CREATE TABLE "gear_reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"gear_item_id" uuid NOT NULL,
	"person_id" uuid,
	"booking_id" uuid,
	"order_id" uuid,
	"reserved_from" date NOT NULL,
	"reserved_until" date NOT NULL,
	"checked_out_at" timestamp with time zone,
	"returned_at" timestamp with time zone,
	"return_outcome" "gear_return_outcome",
	"return_note" text,
	"dives_logged" integer,
	"fill_o2_percent" integer,
	"fill_recorded_at" timestamp with time zone,
	"fill_recorded_by_person_id" uuid,
	"fill_o2_clean_gap" "tank_fill_o2_clean_gap",
	"released_at" timestamp with time zone,
	"released_by_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gear_reservations_window" CHECK ("reserved_until" >= "reserved_from"),
	CONSTRAINT "gear_reservations_dives_logged" CHECK ("dives_logged" is null or ("dives_logged" >= 0 and "dives_logged" <= 200)),
	CONSTRAINT "gear_reservations_fill_o2_percent" CHECK ("fill_o2_percent" is null or ("booking_id" is null and "fill_o2_percent" >= 21 and "fill_o2_percent" <= 40)),
	CONSTRAINT "gear_reservations_fill_o2_clean_gap" CHECK ("fill_o2_clean_gap" is null or ("fill_o2_percent" is not null and "fill_o2_percent" > 21)),
	CONSTRAINT "gear_reservations_fill_recorded" CHECK (("fill_o2_percent" is null) = ("fill_recorded_at" is null)),
	CONSTRAINT "gear_reservations_release_never_left" CHECK ("released_at" is null or ("checked_out_at" is null and "returned_at" is null)),
	CONSTRAINT "gear_reservations_one_holder" CHECK (("booking_id" is not null and "person_id" is null) or ("booking_id" is null and "person_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "gear_service_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"gear_item_id" uuid NOT NULL,
	"kind" "gear_service_kind" NOT NULL,
	"serviced_on" date NOT NULL,
	"next_due_on" date,
	"next_due_dives" integer,
	"note" text,
	"recorded_by_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gear_service_events_due_after_service" CHECK ("next_due_on" is null or "next_due_on" > "serviced_on"),
	CONSTRAINT "gear_service_events_due_dives_positive" CHECK ("next_due_dives" is null or "next_due_dives" > 0)
);
--> statement-breakpoint
CREATE TABLE "prior_gear_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"gear_item_id" uuid NOT NULL,
	"assigned_from" date NOT NULL,
	"assigned_until" date NOT NULL,
	"status_label" text,
	"source_reference" text,
	"note" text,
	"dedupe_key" text NOT NULL,
	"imported_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prior_gear_assignments_window" CHECK ("assigned_until" >= "assigned_from")
);
--> statement-breakpoint
CREATE TABLE "rental_fit_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"rents_bcd" boolean DEFAULT false NOT NULL,
	"rents_regulator" boolean DEFAULT false NOT NULL,
	"rents_wetsuit" boolean DEFAULT false NOT NULL,
	"rents_mask" boolean DEFAULT false NOT NULL,
	"rents_fins" boolean DEFAULT false NOT NULL,
	"rents_weights" boolean DEFAULT false NOT NULL,
	"rents_dive_computer" boolean DEFAULT false NOT NULL,
	"rents_gopro" boolean DEFAULT false NOT NULL,
	"rents_drysuit" boolean DEFAULT false NOT NULL,
	"rents_hood" boolean DEFAULT false NOT NULL,
	"rents_gloves" boolean DEFAULT false NOT NULL,
	"rents_torch" boolean DEFAULT false NOT NULL,
	"rents_smb" boolean DEFAULT false NOT NULL,
	"bcd_size" text,
	"wetsuit_size" text,
	"drysuit_size" text,
	"hood_size" text,
	"glove_size" text,
	"boot_size" text,
	"fin_size" text,
	"weight_preference" text,
	"dives_dry" boolean DEFAULT false NOT NULL,
	"note" text,
	"fit_stated_at" timestamp with time zone,
	"needs_staff_fit_at" timestamp with time zone,
	"needs_staff_fit_note" text,
	"needs_staff_fit_by" uuid,
	"fit_confirmed_at" timestamp with time zone,
	"fit_confirmed_by" uuid,
	"fit_confirmed_item" "rental_fit_item",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rental_fit_profiles_rented_drysuit_is_dry" CHECK (not "rents_drysuit" or "dives_dry"),
	CONSTRAINT "rental_fit_profiles_dry_rents_no_wetsuit" CHECK (not ("dives_dry" and "rents_wetsuit"))
);
--> statement-breakpoint
CREATE TABLE "incident_report_addenda" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"report_id" uuid NOT NULL,
	"body" text NOT NULL,
	"author_person_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "incident_report_addenda_body_not_blank" CHECK (length(trim("body")) > 0),
	CONSTRAINT "incident_report_addenda_body_length" CHECK (length("body") <= 5000)
);
--> statement-breakpoint
CREATE TABLE "incident_report_people" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"report_id" uuid NOT NULL,
	"booking_id" uuid,
	"person_id" uuid,
	"outsider_name" text,
	"involvement" "incident_involvement" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "incident_report_people_one_subject" CHECK (num_nonnulls("booking_id", "person_id", "outsider_name") = 1),
	CONSTRAINT "incident_report_people_outsider_name_length" CHECK ("outsider_name" is null or length("outsider_name") <= 200)
);
--> statement-breakpoint
CREATE TABLE "incident_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"trip_id" uuid NOT NULL,
	"status" "incident_report_status" DEFAULT 'draft'::"incident_report_status" NOT NULL,
	"occurred_at" timestamp with time zone,
	"dive_site_id" uuid,
	"location_text" text,
	"what_happened" text,
	"kind" "incident_kind",
	"severity" "incident_severity",
	"first_aid_given" boolean,
	"oxygen_given" boolean,
	"oxygen_minutes" integer,
	"emergency_services_called" boolean,
	"handover_kind" "incident_handover_kind",
	"handover_detail" text,
	"handed_over_at" timestamp with time zone,
	"follow_up" text,
	"created_by_person_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"filed_at" timestamp with time zone,
	"filed_by_person_id" uuid,
	"deleted_at" timestamp with time zone,
	"legal_hold_at" timestamp with time zone,
	"missing_alerted_at" timestamp with time zone,
	"missing_alert_sent_at" timestamp with time zone,
	"missing_alert_reached_person_ids" jsonb DEFAULT '[]' NOT NULL,
	"missing_alert_attempting_person_ids" jsonb DEFAULT '[]' NOT NULL,
	"missing_alert_raised_at" timestamp with time zone,
	"missing_alert_raised_by_person_id" uuid,
	"missing_subject_row_id" uuid,
	"missing_found_at" timestamp with time zone,
	"missing_found_by_person_id" uuid,
	"missing_all_clear_claimed_at" timestamp with time zone,
	"missing_all_clear_sent_at" timestamp with time zone,
	"missing_all_clear_sent_person_ids" jsonb DEFAULT '[]' NOT NULL,
	"missing_all_clear_leased_at" timestamp with time zone,
	"deleted_by_person_id" uuid,
	CONSTRAINT "incident_reports_deleted_by_whom" CHECK (("deleted_at" is null) = ("deleted_by_person_id" is null)),
	CONSTRAINT "incident_reports_only_a_draft_is_discarded" CHECK ("deleted_at" is null or "status" = 'draft'),
	CONSTRAINT "incident_reports_raised_by_whom" CHECK (("missing_alert_raised_at" is null) = ("missing_alert_raised_by_person_id" is null)),
	CONSTRAINT "incident_reports_found_by_whom" CHECK (("missing_found_at" is null) = ("missing_found_by_person_id" is null)),
	CONSTRAINT "incident_reports_missing_only" CHECK (("missing_alert_raised_at" is null and "missing_found_at" is null)
        or "kind" = 'missing_diver'),
	CONSTRAINT "incident_reports_found_after_alert" CHECK ("missing_found_at" is null or "missing_alert_raised_at" is not null
        or "status" = 'filed'),
	CONSTRAINT "incident_reports_raised_names_its_subject" CHECK ("missing_alert_raised_at" is null or "missing_subject_row_id" is not null),
	CONSTRAINT "incident_reports_a_raised_report_is_kept" CHECK ("missing_alert_raised_at" is null or "deleted_at" is null),
	CONSTRAINT "incident_reports_a_held_report_is_kept" CHECK ("legal_hold_at" is null or "deleted_at" is null),
	CONSTRAINT "incident_reports_oxygen_minutes" CHECK ("oxygen_minutes" is null or ("oxygen_given" is true and "oxygen_minutes" between 1 and 1440)),
	CONSTRAINT "incident_reports_filed_complete" CHECK ("status" = 'draft' or (
        "filed_at" is not null and "filed_by_person_id" is not null
        and "occurred_at" is not null and "what_happened" is not null
        and "first_aid_given" is not null and "oxygen_given" is not null
        and "emergency_services_called" is not null
        and ("dive_site_id" is not null or "location_text" is not null)
        and ("handover_kind" is not null
          or ("emergency_services_called" is false and "oxygen_given" is false))
      ))
);
--> statement-breakpoint
CREATE TABLE "integration_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"integration_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"status" "integration_delivery_status" DEFAULT 'pending'::"integration_delivery_status" NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"delivered_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integration_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integration_oauth_states" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"state_hash" text NOT NULL,
	"shop_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"provider" "integration_provider" NOT NULL,
	"context" jsonb DEFAULT '{}' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integration_sync_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"provider" "integration_provider" NOT NULL,
	"source_type" text NOT NULL,
	"source_id" text NOT NULL,
	"operation" text NOT NULL,
	"external_id" text NOT NULL,
	"receipt_evidence" jsonb,
	"last_synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_backup_progress" (
	"shop_id" uuid PRIMARY KEY,
	"last_attempt_at" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	"lease_token" uuid,
	"lease_until" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "shop_backup_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"period_key" text NOT NULL,
	"trigger" "backup_delivery_trigger" NOT NULL,
	"status" "backup_delivery_status" NOT NULL,
	"object_key" text,
	"byte_count" bigint,
	"error_code" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "shop_backup_delivery_claims" (
	"shop_id" uuid,
	"period_key" text,
	"attempt_number" integer NOT NULL,
	"lease_token" uuid,
	"lease_until" timestamp with time zone,
	"completed_at" timestamp with time zone,
	CONSTRAINT "shop_backup_delivery_claims_pkey" PRIMARY KEY("shop_id","period_key")
);
--> statement-breakpoint
CREATE TABLE "shop_backup_destinations" (
	"shop_id" uuid PRIMARY KEY,
	"endpoint" text NOT NULL,
	"region" text NOT NULL,
	"bucket" text NOT NULL,
	"prefix" text DEFAULT '' NOT NULL,
	"access_key_id" text NOT NULL,
	"secret_access_key_sealed" text NOT NULL,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"verified_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shop_integrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"provider" "integration_provider" NOT NULL,
	"status" "integration_connection_status" DEFAULT 'connected'::"integration_connection_status" NOT NULL,
	"external_account_id" text,
	"external_label" text,
	"credentials_sealed" text NOT NULL,
	"settings" jsonb DEFAULT '{}' NOT NULL,
	"last_synced_at" timestamp with time zone,
	"last_error" text,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "date_request_offer_bookings" (
	"shop_id" uuid NOT NULL,
	"interest_id" uuid NOT NULL,
	"booking_id" uuid PRIMARY KEY
);
--> statement-breakpoint
CREATE TABLE "interest_replies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"interest_id" uuid NOT NULL,
	"channel" "interest_reply_channel" NOT NULL,
	"to_address" text,
	"body" text,
	"locale" text NOT NULL,
	"sent_by_person_id" uuid NOT NULL,
	"status" "interest_reply_status" NOT NULL,
	"provider_message_id" text,
	"send_error_code" text,
	"sent_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "interest_replies_body_bounded" CHECK ("body" is null or (length(btrim("body")) > 0 and length("body") <= 1000))
);
--> statement-breakpoint
CREATE TABLE "interests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"scope" "interest_scope" NOT NULL,
	"asked_by" "interest_asked_by" NOT NULL,
	"parent_interest_id" uuid,
	"person_id" uuid,
	"name" text,
	"email" text,
	"phone" text,
	"trip_id" uuid,
	"course_id" uuid,
	"interest" text,
	"preferred_date" date,
	"alternate_date" date,
	"date_flexible" boolean DEFAULT false NOT NULL,
	"experience_level" "interest_experience",
	"timing" text,
	"message" text,
	"available_from" date,
	"available_until" date,
	"party_size" integer,
	"asked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_person_id" uuid,
	"offered_at" timestamp with time zone,
	"emailed_at" timestamp with time zone,
	"promo_id" uuid,
	"charter" boolean DEFAULT false NOT NULL,
	"charter_quote_cents" integer,
	"charter_quote_currency" text,
	"charter_quoted_at" timestamp with time zone,
	"charter_quoted_by_person_id" uuid,
	"closed_at" timestamp with time zone,
	"closed_as" "interest_closed_as",
	CONSTRAINT "interests_scope_columns" CHECK ((
        ("scope" = 'departure'
          and "trip_id" is not null
          and "course_id" is null
          and "interest" is null
          and "preferred_date" is null
          and "alternate_date" is null
          and "date_flexible" = false
          and "experience_level" is null
          and "timing" is null
          and "message" is null
          and "available_from" is null
          and "available_until" is null)
        or ("scope" = 'date'
          and "trip_id" is null
          and ("course_id" is not null or length(btrim(coalesce("interest", ''))) > 0)
          and "available_from" is null
          and "available_until" is null)
        or ("scope" = 'anytime'
          and "trip_id" is null
          and "course_id" is null
          and "interest" is null
          and "preferred_date" is null
          and "alternate_date" is null
          and "date_flexible" = false
          and "experience_level" is null
          and "timing" is null
          and "message" is null
          and ("available_from" is null
            or "available_until" is null
            or "available_from" <= "available_until"))
      )),
	CONSTRAINT "interests_has_a_person" CHECK ("scope" = 'date' or "person_id" is not null or "parent_interest_id" is not null),
	CONSTRAINT "interests_offer_is_a_departure" CHECK ("scope" = 'departure' or ("offered_at" is null and "promo_id" is null)),
	CONSTRAINT "interests_emailed_after_offer" CHECK ("emailed_at" is null or "offered_at" is not null),
	CONSTRAINT "interests_charter_is_a_date" CHECK (not "charter" or "scope" = 'date'),
	CONSTRAINT "interests_charter_quote" CHECK (("charter_quote_cents" is null) = ("charter_quoted_at" is null)
        and ("charter_quoted_at" is null) = ("charter_quoted_by_person_id" is null)
        and ("charter_quote_cents" is null) = ("charter_quote_currency" is null)
        and ("charter_quote_cents" is null or ("charter" and "charter_quote_cents" > 0))),
	CONSTRAINT "interests_closed_together" CHECK (("closed_at" is null) = ("closed_as" is null)),
	CONSTRAINT "interests_party_size_range" CHECK (("party_size" is not null or "scope" <> 'departure') and ("party_size" is null or "party_size" between 1 and 20))
);
--> statement-breakpoint
CREATE TABLE "email_bounces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid,
	"provider_message_id" text NOT NULL,
	"event" text NOT NULL,
	"recipient" text NOT NULL,
	"bounce_type" text,
	"bounce_sub_type" text,
	"smtp_status" text,
	"complaint_type" text,
	"kind" text,
	"purpose" text,
	"sent_by_person_id" uuid,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_bounces_event_check" CHECK ("event" in ('bounce', 'complaint'))
);
--> statement-breakpoint
CREATE TABLE "inbound_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"person_id" uuid,
	"channel" "inbound_channel" NOT NULL,
	"from_address" text NOT NULL,
	"subject" text,
	"body" text NOT NULL,
	"media_count" integer DEFAULT 0 NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"answered_at" timestamp with time zone,
	"provider_message_id" text NOT NULL,
	"email_message_id" text,
	"in_reply_to_delivery_id" uuid,
	"keyword_intent" "inbound_keyword_intent",
	"booking_id" uuid,
	"sender_authenticated" boolean DEFAULT false NOT NULL,
	"spam_flagged" boolean DEFAULT false NOT NULL,
	"assist_intent" text,
	"assist_urgent" boolean,
	"assist_language" text,
	"assist_translation" text,
	"assist_translated_to" text,
	"assisted_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"booking_id" uuid NOT NULL,
	"kind" "notification_kind" NOT NULL,
	"status" "notification_delivery_status" NOT NULL,
	"provider_message_id" text,
	"provider_status" "notification_provider_status",
	"provider_status_at" timestamp with time zone,
	"provider_detail" text,
	"send_http_status" integer,
	"send_error_code" text,
	"send_error" text,
	"attempted_at" timestamp with time zone NOT NULL,
	"superseded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_rate_limit_state" (
	"key" text PRIMARY KEY,
	"next_allowed_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_send_queue" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL UNIQUE,
	"payload_sealed" text,
	"recipient_email" text,
	"subject_email" text,
	"subject_phone" text,
	"booking_id" uuid,
	"recipient_person_id" uuid,
	"recipient_trip_id" uuid,
	"intent" jsonb,
	"actor_person_id" uuid,
	"status" "notification_queue_status" DEFAULT 'queued'::"notification_queue_status" NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"recovery_attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone NOT NULL,
	"locked_until" timestamp with time zone,
	"provider_message_id" text,
	"http_status" integer,
	"error_code" text,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_send_queue_one_payload" CHECK ("intent" is null or "payload_sealed" is null)
);
--> statement-breakpoint
CREATE TABLE "push_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"trip_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"last_pushed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shop_contact_email_confirmation_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"email" text NOT NULL,
	"token_hash" text NOT NULL UNIQUE,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"superseded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shop_whatsapp_accounts" (
	"shop_id" uuid PRIMARY KEY,
	"phone_number_id" text NOT NULL,
	"display_phone_number" text,
	"waba_id" text,
	"access_token_sealed" text NOT NULL,
	"registration_pin_sealed" text,
	"template_name" text NOT NULL,
	"template_language" text NOT NULL,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"number_assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"verified_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sms_opt_outs" (
	"phone" text PRIMARY KEY,
	"opted_out" boolean NOT NULL,
	"keyword_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "staff_replies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"inbound_message_id" uuid,
	"channel" "inbound_channel" NOT NULL,
	"to_address" text NOT NULL,
	"body" text NOT NULL,
	"locale" text NOT NULL,
	"sent_by_person_id" uuid,
	"status" "notification_delivery_status" NOT NULL,
	"provider_message_id" text,
	"send_error_code" text,
	"send_error" text,
	"sent_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "whatsapp_delivered_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"phone_number_id" text NOT NULL,
	"waba_id" text NOT NULL,
	"message_fingerprint" text NOT NULL,
	"delivered_at" timestamp with time zone NOT NULL,
	"pricing_model" text,
	"category" text,
	"pricing_type" text,
	"billable" boolean,
	"recorded_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "offline_manifest_snapshot_revisions" (
	"shop_id" uuid,
	"trip_id" uuid,
	"revision" integer NOT NULL,
	CONSTRAINT "offline_manifest_snapshot_revisions_pk" PRIMARY KEY("shop_id","trip_id"),
	CONSTRAINT "offline_manifest_snapshot_revisions_positive" CHECK ("revision" > 0)
);
--> statement-breakpoint
CREATE TABLE "offline_review_refusals" (
	"shop_id" uuid,
	"client_event_id" uuid,
	CONSTRAINT "offline_review_refusals_pk" PRIMARY KEY("shop_id","client_event_id")
);
--> statement-breakpoint
CREATE TABLE "account_passkey_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid,
	"user_account_id" uuid,
	"account_session_id" uuid,
	"token_hash" text NOT NULL UNIQUE,
	"challenge" text NOT NULL,
	"ceremony" text NOT NULL,
	"purpose" text,
	"origin" text NOT NULL,
	"rp_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_passkey_challenges_binding" CHECK (("ceremony" = 'sign-in' and "user_account_id" is null and "account_session_id" is null and "shop_id" is null and "purpose" is null) or ("ceremony" in ('register', 'step-up') and "user_account_id" is not null and "account_session_id" is not null and "shop_id" is not null and (("ceremony" = 'register' and "purpose" is null) or ("ceremony" = 'step-up' and "purpose" is not null and "purpose" in ('money', 'export', 'backup', 'security')))))
);
--> statement-breakpoint
CREATE TABLE "account_passkeys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"user_account_id" uuid NOT NULL,
	"credential_id" text NOT NULL UNIQUE,
	"public_key" text NOT NULL,
	"counter" bigint DEFAULT 0 NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "account_passkeys_counter" CHECK ("counter" >= 0),
	CONSTRAINT "account_passkeys_name" CHECK (length("name") between 1 and 80)
);
--> statement-breakpoint
CREATE TABLE "booking_checkout_bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"checkout_id" uuid NOT NULL,
	"booking_id" uuid NOT NULL,
	"trip_cents" integer,
	"pass_through_cents" integer DEFAULT 0 NOT NULL,
	"gear_cents" integer DEFAULT 0 NOT NULL,
	"tax_cents" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "booking_checkout_bookings_gear_cents_nonnegative" CHECK ("gear_cents" >= 0),
	CONSTRAINT "booking_checkout_bookings_pass_through_nonnegative" CHECK ("pass_through_cents" >= 0),
	CONSTRAINT "booking_checkout_bookings_tax_cents_nonnegative" CHECK ("tax_cents" >= 0),
	CONSTRAINT "booking_checkout_bookings_trip_cents_nonnegative" CHECK ("trip_cents" is null or "trip_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "booking_checkouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"trip_id" uuid NOT NULL,
	"status" "checkout_status" DEFAULT 'pending'::"checkout_status" NOT NULL,
	"purpose" "checkout_purpose" DEFAULT 'fare'::"checkout_purpose" NOT NULL,
	"stripe_account_id" text NOT NULL,
	"stripe_session_id" text NOT NULL,
	"stripe_customer_id" text,
	"checkout_url" text,
	"customer_email" text,
	"abandoned_recovery_sent_at" timestamp with time zone,
	"deal_id" uuid,
	"promo_code" text,
	"applied_discount_percent" integer,
	"applied_discount_cents" integer,
	"currency" text NOT NULL,
	"amount_per_diver_cents" integer NOT NULL,
	"total_cents" integer NOT NULL,
	"pass_through_cents" integer DEFAULT 0 NOT NULL,
	"tax_enabled" boolean DEFAULT false NOT NULL,
	"tax_cents" integer,
	"settled_total_cents" integer,
	"collection_needs_review" boolean DEFAULT false NOT NULL,
	"is_deposit" boolean DEFAULT false NOT NULL,
	"expires_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"async_payment_failed_at" timestamp with time zone,
	"stripe_payment_intent_id" text,
	"refunded_cents" integer DEFAULT 0 NOT NULL,
	"paid_after_close_at" timestamp with time zone,
	"paid_after_close_cents" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "booking_checkouts_paid_after_close_pair" CHECK (("paid_after_close_at" is null) = ("paid_after_close_cents" is null)),
	CONSTRAINT "booking_checkouts_paid_after_close_nonnegative" CHECK ("paid_after_close_cents" is null or "paid_after_close_cents" >= 0),
	CONSTRAINT "booking_checkouts_refunded_nonnegative" CHECK ("refunded_cents" >= 0),
	CONSTRAINT "booking_checkouts_amount_per_diver_nonnegative" CHECK ("amount_per_diver_cents" >= 0),
	CONSTRAINT "booking_checkouts_total_nonnegative" CHECK ("total_cents" >= 0),
	CONSTRAINT "booking_checkouts_pass_through_nonnegative" CHECK ("pass_through_cents" >= 0),
	CONSTRAINT "booking_checkouts_settled_total_nonnegative" CHECK ("settled_total_cents" is null or "settled_total_cents" >= 0),
	CONSTRAINT "booking_checkouts_tax_nonnegative" CHECK ("tax_cents" is null or "tax_cents" >= 0),
	CONSTRAINT "booking_checkouts_applied_discount_range" CHECK ("applied_discount_percent" is null or "applied_discount_percent" between 1 and 100),
	CONSTRAINT "booking_checkouts_applied_discount_cents_positive" CHECK ("applied_discount_cents" is null or "applied_discount_cents" > 0),
	CONSTRAINT "booking_checkouts_single_discount_snapshot" CHECK ("applied_discount_percent" is null or "applied_discount_cents" is null),
	CONSTRAINT "booking_checkouts_tip_shape" CHECK ("purpose" <> 'tip' or (not "is_deposit" and "deal_id" is null and "applied_discount_percent" is null and "applied_discount_cents" is null and not "tax_enabled" and "pass_through_cents" = 0))
);
--> statement-breakpoint
CREATE TABLE "booking_payment_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"seq" bigserial,
	"shop_id" uuid NOT NULL,
	"booking_id" uuid NOT NULL,
	"status" "payment_status" NOT NULL,
	"previous_status" "payment_status",
	"amount_cents" integer,
	"manual_held_cents" integer DEFAULT 0 NOT NULL,
	"currency" text NOT NULL,
	"provider" text,
	"provider_ref" text,
	"operation" "payment_event_operation" NOT NULL,
	"note" text,
	"method" "manual_payment_method",
	"recorded_by_person_id" uuid,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "booking_payment_events_manual_held_check" CHECK ("manual_held_cents" >= 0 and ("amount_cents" is null or "manual_held_cents" <= "amount_cents")),
	CONSTRAINT "booking_payment_events_amount_nonnegative" CHECK ("amount_cents" is null or "amount_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "deals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"trip_id" uuid,
	"code" text NOT NULL,
	"description" text,
	"discount_percent" integer,
	"discount_amount_cents" integer,
	"scope" "shop_promo_scope" DEFAULT 'all'::"shop_promo_scope" NOT NULL,
	"status" "deal_status" DEFAULT 'pending'::"deal_status" NOT NULL,
	"starts_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"max_redemptions" integer,
	"stripe_coupon_id" text,
	"stripe_promotion_code_id" text,
	"recipient_count" integer DEFAULT 0 NOT NULL,
	"created_by_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deals_discount_range" CHECK ("discount_percent" is null or ("trip_id" is null and "discount_percent" between 1 and 100) or ("trip_id" is not null and "discount_percent" between 5 and 90)),
	CONSTRAINT "deals_discount_amount_positive" CHECK ("discount_amount_cents" is null or "discount_amount_cents" > 0),
	CONSTRAINT "deals_one_discount" CHECK (("discount_percent" is null) <> ("discount_amount_cents" is null)),
	CONSTRAINT "deals_max_redemptions_positive" CHECK ("max_redemptions" is null or "max_redemptions" > 0),
	CONSTRAINT "deals_window" CHECK ("starts_at" is null or "expires_at" is null or "starts_at" < "expires_at"),
	CONSTRAINT "deals_trip_shape" CHECK ("trip_id" is null or ("expires_at" is not null and "starts_at" is null and "status" <> 'disabled' and "scope" = 'all' and "description" is null))
);
--> statement-breakpoint
CREATE TABLE "dive_package_entitlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"package_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"booking_id" uuid,
	"consumed_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dive_package_entitlements_consumption_paired" CHECK (("booking_id" is null) = ("consumed_at" is null))
);
--> statement-breakpoint
CREATE TABLE "dive_packages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"name" text NOT NULL,
	"dive_count" integer NOT NULL,
	"price_cents" integer NOT NULL,
	"scope" "dive_package_scope" DEFAULT 'fun_dives'::"dive_package_scope" NOT NULL,
	"valid_until" date,
	"deleted_at" timestamp with time zone,
	"created_by_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dive_packages_dive_count_positive" CHECK ("dive_count" > 0),
	CONSTRAINT "dive_packages_price_positive" CHECK ("price_cents" > 0)
);
--> statement-breakpoint
CREATE TABLE "imported_payment_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"occurred_on" date NOT NULL,
	"direction" "imported_payment_direction" DEFAULT 'unknown'::"imported_payment_direction" NOT NULL,
	"title" text,
	"status_label" text,
	"amount_label" text,
	"amount_cents" integer,
	"currency" text,
	"payment_reference" text,
	"receipt_reference" text,
	"receipt_document_url" text,
	"source_label" text,
	"source_reference" text,
	"stripe_reference" text,
	"dedupe_key" text NOT NULL,
	"imported_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "imported_payment_history_amount_nonnegative" CHECK ("amount_cents" IS NULL OR "amount_cents" >= 0),
	CONSTRAINT "imported_payment_history_amount_currency_pair" CHECK (("amount_cents" IS NULL AND "currency" IS NULL) OR ("amount_cents" IS NOT NULL AND "currency" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "order_line_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"package_id" uuid,
	"kind" "order_line_item_kind" DEFAULT 'other'::"order_line_item_kind" NOT NULL,
	"description" text NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"unit_amount_cents" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_line_items_quantity_positive" CHECK ("quantity" > 0),
	CONSTRAINT "order_line_items_unit_amount_nonnegative" CHECK ("unit_amount_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"booking_id" uuid,
	"person_id" uuid,
	"created_by_person_id" uuid NOT NULL,
	"status" "order_status" DEFAULT 'open'::"order_status" NOT NULL,
	"source" "order_source" DEFAULT 'staff'::"order_source" NOT NULL,
	"currency" text NOT NULL,
	"total_cents" integer NOT NULL,
	"pass_through_cents" integer DEFAULT 0 NOT NULL,
	"tax_cents" integer DEFAULT 0 NOT NULL,
	"tip_cents" integer DEFAULT 0 NOT NULL,
	"counter_receipt" jsonb,
	"amount_paid_cents" integer DEFAULT 0 NOT NULL,
	"refunded_cents" integer DEFAULT 0 NOT NULL,
	"description" text,
	"collection" "order_collection" DEFAULT 'stripe_invoice'::"order_collection" NOT NULL,
	"stripe_account_id" text,
	"stripe_customer_id" text,
	"stripe_invoice_id" text,
	"stripe_payment_intent_id" text,
	"hosted_invoice_url" text,
	"invoice_pdf_url" text,
	"finalized_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"voided_at" timestamp with time zone,
	"refunded_at" timestamp with time zone,
	"counter_claimed_at" timestamp with time zone,
	"room_number" text,
	"room_hotel" text,
	"auto_void_failed_at" timestamp with time zone,
	"auto_void_failures" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_anonymous_counter_only" CHECK ("person_id" is not null or (
      "counter_receipt" is not null and "booking_id" is null
      and "source"::text = 'staff'
      and "collection"::text in ('cash', 'card_machine', 'bank_transfer', 'other')
      and "status"::text in ('paid', 'partly_refunded', 'refunded', 'void')
      and "stripe_invoice_id" is null and "stripe_customer_id" is null
      and "stripe_payment_intent_id" is null and "stripe_account_id" is null
    )),
	CONSTRAINT "orders_local_invoice_unpaid" CHECK ("collection"::text <> 'local_invoice' or (
      "person_id" is not null and "booking_id" is null and "source"::text = 'staff'
      and "status"::text in ('open', 'void') and "amount_paid_cents" = 0
      and "counter_receipt" is null and "total_cents" > 0
      and "stripe_account_id" is null and "stripe_customer_id" is null
      and "stripe_invoice_id" is null and "stripe_payment_intent_id" is null
    )),
	CONSTRAINT "orders_total_nonnegative" CHECK ("total_cents" >= 0),
	CONSTRAINT "orders_tip_bounds" CHECK ("tip_cents" >= 0 and "tip_cents" <= "amount_paid_cents"),
	CONSTRAINT "orders_room_charge_names_room" CHECK (("collection"::text = 'room_charge') = ("room_number" is not null)),
	CONSTRAINT "orders_room_hotel_only_on_room_charge" CHECK ("room_hotel" is null or "collection"::text = 'room_charge'),
	CONSTRAINT "orders_pass_through_nonnegative" CHECK ("pass_through_cents" >= 0),
	CONSTRAINT "orders_tax_nonnegative" CHECK ("tax_cents" >= 0),
	CONSTRAINT "orders_amount_paid_nonnegative" CHECK ("amount_paid_cents" >= 0),
	CONSTRAINT "orders_refunded_nonnegative" CHECK ("refunded_cents" >= 0),
	CONSTRAINT "orders_auto_void_failures_nonnegative" CHECK ("auto_void_failures" >= 0),
	CONSTRAINT "orders_stripe_ids_match_collection" CHECK (("collection" = 'stripe_invoice' and "stripe_account_id" is not null and "stripe_customer_id" is not null and "stripe_invoice_id" is not null) or ("collection" <> 'stripe_invoice' and "stripe_payment_intent_id" is null and (("stripe_account_id" is null and "stripe_customer_id" is null and "stripe_invoice_id" is null) or ("stripe_account_id" is not null and "stripe_customer_id" is not null and "stripe_invoice_id" is not null)))),
	CONSTRAINT "orders_counter_claim_open" CHECK ("counter_claimed_at" is null or ("status" = 'open' and "collection" <> 'stripe_invoice' and "stripe_invoice_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "package_gifts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"send_on" date NOT NULL,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_disputes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"stripe_account_id" text NOT NULL,
	"stripe_dispute_id" text NOT NULL,
	"stripe_payment_intent_id" text NOT NULL,
	"order_id" uuid,
	"checkout_id" uuid,
	"amount_cents" integer NOT NULL,
	"currency" text NOT NULL,
	"reason" text,
	"status" text NOT NULL,
	"evidence_due_by" timestamp with time zone,
	"opened_at" timestamp with time zone NOT NULL,
	"closed_at" timestamp with time zone,
	"reversed_at" timestamp with time zone,
	"last_event_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_disputes_amount_nonnegative" CHECK ("amount_cents" >= 0),
	CONSTRAINT "payment_disputes_one_target" CHECK (("order_id" is null) <> ("checkout_id" is null))
);
--> statement-breakpoint
CREATE TABLE "payment_operation_intents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"kind" "payment_operation_kind" NOT NULL,
	"status" "payment_operation_status" DEFAULT 'started'::"payment_operation_status" NOT NULL,
	"trip_id" uuid,
	"booking_id" uuid,
	"order_id" uuid,
	"checkout_id" uuid,
	"deal_id" uuid,
	"stripe_object_id" text,
	"amount_cents" integer,
	"error_message" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "payment_operation_intents_amount_nonnegative" CHECK ("amount_cents" is null or "amount_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "shop_stripe_accounts" (
	"shop_id" uuid PRIMARY KEY,
	"stripe_account_id" text NOT NULL,
	"charges_enabled" boolean DEFAULT false NOT NULL,
	"payouts_enabled" boolean DEFAULT false NOT NULL,
	"details_submitted" boolean DEFAULT false NOT NULL,
	"default_currency" text DEFAULT 'usd' NOT NULL,
	"payments_restricted_at" timestamp with time zone,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"disconnected_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stripe_payouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"stripe_account_id" text NOT NULL,
	"stripe_payout_id" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"currency" text NOT NULL,
	"status" text NOT NULL,
	"arrival_date" timestamp with time zone NOT NULL,
	"failure_code" text,
	"covered_from" timestamp with time zone,
	"covered_to" timestamp with time zone,
	"fee_cents" integer,
	"last_event_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "stripe_refund_failures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"stripe_account_id" text NOT NULL,
	"stripe_refund_id" text NOT NULL,
	"order_id" uuid,
	"checkout_id" uuid,
	"booking_id" uuid,
	"amount_cents" integer NOT NULL,
	"currency" text NOT NULL,
	"refund_status" text NOT NULL,
	"failure_reason" text,
	"owed_until_refunded_cents" integer NOT NULL,
	"failed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stripe_refund_failures_amount_nonnegative" CHECK ("amount_cents" >= 0),
	CONSTRAINT "stripe_refund_failures_one_target" CHECK (("order_id" is null) <> ("checkout_id" is null)),
	CONSTRAINT "stripe_refund_failures_status" CHECK ("refund_status" in ('failed', 'canceled'))
);
--> statement-breakpoint
CREATE TABLE "stripe_webhook_events" (
	"id" text PRIMARY KEY,
	"type" text NOT NULL,
	"account" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"claimed_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "rate_limit_buckets" (
	"key" text PRIMARY KEY,
	"tokens" double precision NOT NULL,
	"updated_at" bigint NOT NULL,
	"last_allowed" boolean NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recovery_activities" (
	"id" uuid PRIMARY KEY,
	"shop_id" uuid NOT NULL,
	"blowout_id" uuid NOT NULL,
	"title" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"location" text NOT NULL,
	"capacity" integer NOT NULL,
	"coordinator_person_id" uuid NOT NULL,
	"created_by_person_id" uuid NOT NULL,
	"arrangements_confirmed_by_person_id" uuid NOT NULL,
	"arrangements_confirmed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "recovery_activities_capacity" CHECK ("capacity" between 1 and 500),
	CONSTRAINT "recovery_activities_times" CHECK ("ends_at" > "starts_at"),
	CONSTRAINT "recovery_activities_status" CHECK ("status" in ('scheduled', 'cancelled')),
	CONSTRAINT "recovery_activities_revision" CHECK ("revision" >= 0)
);
--> statement-breakpoint
CREATE TABLE "recovery_activity_events" (
	"id" uuid PRIMARY KEY,
	"shop_id" uuid NOT NULL,
	"activity_id" uuid NOT NULL,
	"participant_id" uuid,
	"actor_person_id" uuid NOT NULL,
	"request_hash" text NOT NULL,
	"result_revision" integer NOT NULL,
	"code" text NOT NULL,
	"transition" jsonb NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recovery_activity_events_code" CHECK ("code" in ('identity_merged', 'created', 'offer_prepared', 'place_confirmed', 'place_cancelled', 'activity_cancelled', 'capacity_changed'))
);
--> statement-breakpoint
CREATE TABLE "recovery_activity_offers" (
	"id" uuid PRIMARY KEY,
	"shop_id" uuid NOT NULL,
	"activity_id" uuid NOT NULL,
	"blowout_diver_id" uuid NOT NULL,
	"actor_person_id" uuid NOT NULL,
	"snapshot" jsonb NOT NULL,
	"prepared_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recovery_activity_participants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"activity_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"blowout_diver_id" uuid NOT NULL,
	"status" text NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"confirmed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmed_by_person_id" uuid NOT NULL,
	CONSTRAINT "recovery_activity_participants_status" CHECK ("status" in ('confirmed', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "retention_prune_state" (
	"id" text PRIMARY KEY,
	"next_table" text NOT NULL,
	CONSTRAINT "retention_prune_state_singleton" CHECK ("id" = 'weekly')
);
--> statement-breakpoint
CREATE TABLE "recap_photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"booking_id" uuid NOT NULL,
	"trip_id" uuid NOT NULL,
	"image_url" text NOT NULL,
	"caption" text,
	"shared_with_boat_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recap_pulses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"booking_id" uuid NOT NULL,
	"trip_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"categories" jsonb DEFAULT '[]' NOT NULL,
	"note" text,
	"addressed_at" timestamp with time zone,
	"addressed_by_person_id" uuid,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recap_pulses_live_has_category" CHECK ("deleted_at" is not null or jsonb_array_length("categories") > 0),
	CONSTRAINT "recap_pulses_addressed_has_actor" CHECK (("addressed_at" is null) = ("addressed_by_person_id" is null))
);
--> statement-breakpoint
CREATE TABLE "review_moderation_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"review_id" uuid NOT NULL,
	"action" "review_moderation_action" NOT NULL,
	"reason" "review_moderation_reason",
	"reason_note" text,
	"recorded_by_person_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_moderation_events_hidden_has_reason" CHECK ("action" <> 'hidden' or "reason" is not null),
	CONSTRAINT "review_moderation_events_other_has_note" CHECK ("reason" <> 'other' or length(trim(coalesce("reason_note", ''))) > 0)
);
--> statement-breakpoint
CREATE TABLE "review_replies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"review_id" uuid NOT NULL,
	"body" text NOT NULL,
	"written_by_person_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "review_replies_body_length" CHECK (length(trim("body")) between 1 and 400)
);
--> statement-breakpoint
CREATE TABLE "trip_recap_photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"trip_id" uuid NOT NULL,
	"image_url" text NOT NULL,
	"uploaded_by_person_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trip_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"booking_id" uuid NOT NULL,
	"trip_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"rating" integer NOT NULL,
	"comment" text,
	"is_standout" boolean DEFAULT false NOT NULL,
	"is_published" boolean DEFAULT false NOT NULL,
	"published_at" timestamp with time zone,
	"crew_thanks_person_id" uuid,
	"crew_thanks" text,
	"crew_thanks_ruling" "crew_thanks_ruling",
	"crew_thanks_ruled_at" timestamp with time zone,
	"crew_thanks_ruled_by_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trip_reviews_crew_thanks_shape" CHECK (("crew_thanks" is null or ("crew_thanks_person_id" is not null and length(btrim("crew_thanks")) > 0 and length("crew_thanks") <= 200)) and ("crew_thanks_ruling" is null or "crew_thanks_person_id" is not null) and (("crew_thanks_ruling" is null) = ("crew_thanks_ruled_at" is null))),
	CONSTRAINT "trip_reviews_rating_range" CHECK ("rating" between 1 and 5)
);
--> statement-breakpoint
CREATE TABLE "trip_credit_entries" (
	"id" uuid PRIMARY KEY,
	"shop_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"currency" text NOT NULL,
	"kind" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"reason" text,
	"booking_id" uuid,
	"restores_entry_id" uuid,
	"actor_person_id" uuid,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"seq" bigserial,
	CONSTRAINT "trip_credit_entries_amount_positive" CHECK ("amount_cents" > 0),
	CONSTRAINT "trip_credit_entries_currency" CHECK ("currency" ~ '^[a-z]{3}$'),
	CONSTRAINT "trip_credit_entries_shape" CHECK ((
    ("kind" = 'grant' and "reason" is not null and "reason" in ('goodwill', 'promotion') and "booking_id" is null and "restores_entry_id" is null and "actor_person_id" is not null)
    or ("kind" = 'redeem' and "reason" is null and "booking_id" is not null and "restores_entry_id" is null and "actor_person_id" is not null)
    or ("kind" = 'restore' and "reason" is null and "booking_id" is not null and "restores_entry_id" is not null)
  ))
);
--> statement-breakpoint
CREATE TABLE "boats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"name" text NOT NULL,
	"capacity" integer NOT NULL,
	"description" text,
	"photo_url" text,
	"certified_passengers" integer,
	"certified_total_persons" integer,
	"inspection_due_on" date,
	"coi_expires_on" date,
	"registration_expires_on" date,
	"insurance_expires_on" date,
	"call_sign" text,
	"mmsi" text,
	"working_channel" text,
	"out_of_service_from" date,
	"out_of_service_until" date,
	"out_of_service_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "boats_certified_passengers_positive" CHECK ("certified_passengers" is null or "certified_passengers" between 1 and 999),
	CONSTRAINT "boats_mmsi_nine_digits" CHECK ("mmsi" is null or "mmsi" ~ '^[0-9]{9}$'),
	CONSTRAINT "boats_working_channel_short" CHECK ("working_channel" is null or char_length("working_channel") between 1 and 16),
	CONSTRAINT "boats_certified_total_persons_positive" CHECK ("certified_total_persons" is null or "certified_total_persons" between 1 and 999),
	CONSTRAINT "boats_out_of_service_window" CHECK (("out_of_service_from" is null) = ("out_of_service_until" is null)
        and ("out_of_service_from" is null or "out_of_service_from" <= "out_of_service_until")),
	CONSTRAINT "boats_out_of_service_reason" CHECK ("out_of_service_reason" is null
        or ("out_of_service_from" is not null and char_length("out_of_service_reason") between 1 and 120)),
	CONSTRAINT "boats_certified_passengers_within_total" CHECK ("certified_passengers" is null or "certified_total_persons" is null or "certified_passengers" <= "certified_total_persons")
);
--> statement-breakpoint
CREATE TABLE "executed_dives" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"trip_id" uuid NOT NULL,
	"dive_number" integer NOT NULL,
	"actual_site_id" uuid,
	"entered_at" timestamp with time zone,
	"exited_at" timestamp with time zone,
	"max_depth_meters" double precision,
	"observed_conditions" jsonb DEFAULT 'null',
	"not_recorded" jsonb DEFAULT '[]' NOT NULL,
	"observed_species_slug" text,
	"observed_species_entries" jsonb DEFAULT '[]' NOT NULL,
	"plan_change_reason" "plan_change_reason",
	"plan_change_note" text,
	"recorded_by_person_id" uuid,
	"deleted_at" timestamp with time zone,
	"deleted_by_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "executed_dives_number_positive" CHECK ("dive_number" >= 1),
	CONSTRAINT "executed_dives_depth_nonnegative" CHECK ("max_depth_meters" is null or "max_depth_meters" >= 0),
	CONSTRAINT "executed_dives_exit_after_entry" CHECK ("entered_at" is null or "exited_at" is null or "exited_at" > "entered_at"),
	CONSTRAINT "executed_dives_plan_change_note_length" CHECK ("plan_change_note" is null or (length(trim("plan_change_note")) between 1 and 280)),
	CONSTRAINT "executed_dives_plan_change_note_needs_reason" CHECK ("plan_change_note" is null or "plan_change_reason" is not null)
);
--> statement-breakpoint
CREATE TABLE "trip_dives" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"trip_id" uuid NOT NULL,
	"dive_number" integer NOT NULL,
	"title" text,
	"dive_site_id" uuid,
	"description" text,
	"travel_minutes" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trip_dives_travel_minutes_range" CHECK ("travel_minutes" is null or ("travel_minutes" >= 0 and "travel_minutes" <= 480))
);
--> statement-breakpoint
CREATE TABLE "trip_lenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "trip_requirements" (
	"trip_id" uuid PRIMARY KEY,
	"shop_id" uuid NOT NULL,
	"requires_waiver" boolean DEFAULT true NOT NULL,
	"minimum_certification_level" "certification_level",
	"required_specialties" jsonb DEFAULT '[]' NOT NULL,
	"requires_nitrox" boolean DEFAULT false NOT NULL,
	"minimum_certification_is_default" boolean DEFAULT false NOT NULL,
	"requires_payment" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trip_requirements_default_level_is_open_water" CHECK (not "minimum_certification_is_default" or "minimum_certification_level" = 'open_water')
);
--> statement-breakpoint
CREATE TABLE "trip_schedule_days" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"trip_id" uuid NOT NULL,
	"day_number" integer NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	CONSTRAINT "trip_schedule_days_ends_after_starts" CHECK ("ends_at" > "starts_at")
);
--> statement-breakpoint
CREATE TABLE "trip_series" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"title" text NOT NULL,
	"frequency" "trip_recurrence_frequency" DEFAULT 'weekly'::"trip_recurrence_frequency" NOT NULL,
	"interval_weeks" integer DEFAULT 1 NOT NULL,
	"weekday_mask" integer DEFAULT 0 NOT NULL,
	"anchor_date" text DEFAULT '' NOT NULL,
	"ends_on" text,
	"occurrence_count" integer NOT NULL,
	"last_rolled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trip_series_skips" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"series_id" uuid NOT NULL,
	"occurrence_date" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trip_sightings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"trip_id" uuid NOT NULL,
	"dive_site_id" uuid NOT NULL,
	"dive_site_name" text NOT NULL,
	"species_slug" text NOT NULL,
	"custom_name" text,
	"count" integer DEFAULT 1 NOT NULL,
	"recorded_by_person_id" uuid NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by_person_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trip_sightings_count_positive" CHECK ("count" >= 1)
);
--> statement-breakpoint
CREATE TABLE "trips" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"series_id" uuid,
	"series_occurrence_date" text,
	"lens_id" uuid,
	"course_id" uuid,
	"title" text NOT NULL,
	"description" text,
	"meeting_point_label" text,
	"meeting_point_address" text,
	"arrival_landmark" text,
	"arrival_parking_note" text,
	"arrival_transit_note" text,
	"arrival_look_for" text,
	"arrival_first_interaction" text,
	"arrival_photo_url" text,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"capacity" integer NOT NULL,
	"diver_capacity" integer,
	"wetsuit_thickness_mm" integer,
	"planned_dives" integer DEFAULT 2 NOT NULL,
	"exceeds_no_deco_limits" boolean DEFAULT false NOT NULL,
	"price_cents" integer,
	"shop_default_fields" jsonb DEFAULT '[]' NOT NULL,
	"snorkeler_price_cents" integer,
	"rider_price_cents" integer,
	"deposit_cents" integer,
	"cancellation_window_hours" integer,
	"minimum_bookings" integer,
	"minimum_decision_hours" integer,
	"status" "trip_status" DEFAULT 'scheduled'::"trip_status" NOT NULL,
	"cancelled_at" timestamp with time zone,
	"conditions_hold" boolean DEFAULT false NOT NULL,
	"is_private" boolean DEFAULT false NOT NULL,
	"lunch_aboard" boolean DEFAULT false NOT NULL,
	"self_guided" boolean DEFAULT false NOT NULL,
	"dive_mode" "dive_mode" DEFAULT 'boat'::"dive_mode" NOT NULL,
	"boat_id" uuid,
	"conditions_summary" text,
	"water_temperature_c" double precision,
	"visibility_meters" double precision,
	"surface_conditions" text,
	"conditions_updated_at" timestamp with time zone,
	"recap_shoutout" text,
	"course_teaching_note" text,
	"course_teaching_note_revision" integer DEFAULT 1 NOT NULL,
	"course_teaching_note_deleted_at" timestamp with time zone,
	"course_teaching_note_at" timestamp with time zone,
	"course_teaching_note_by_person_id" uuid,
	"recap_auto_send_paused" boolean DEFAULT false NOT NULL,
	"recap_auto_send_at" timestamp with time zone,
	"revision" integer DEFAULT 0 NOT NULL,
	"offline_meeting_generation" integer DEFAULT 0 NOT NULL,
	"divers_told_starts_at" timestamp with time zone,
	"divers_told_meeting_point" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"is_rehearsal" boolean DEFAULT false NOT NULL,
	"roll_call_alerted_at" timestamp with time zone,
	"roll_call_shore_alerted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trips_rehearsal_is_private" CHECK (not "is_rehearsal" or "is_private"),
	CONSTRAINT "trips_capacity_range" CHECK ("capacity" between 1 and 60),
	CONSTRAINT "trips_planned_dives_range" CHECK ("planned_dives" between 1 and 4 or ("course_id" is not null and "planned_dives" = 5)),
	CONSTRAINT "trips_minimum_bookings_range" CHECK ("minimum_bookings" is null or "minimum_bookings" between 1 and 60),
	CONSTRAINT "trips_minimum_decision_hours_range" CHECK ("minimum_decision_hours" is null or "minimum_decision_hours" between 1 and 336),
	CONSTRAINT "trips_price_nonnegative" CHECK ("price_cents" is null or "price_cents" >= 0),
	CONSTRAINT "trips_snorkeler_price_nonnegative" CHECK ("snorkeler_price_cents" is null or "snorkeler_price_cents" >= 0),
	CONSTRAINT "trips_wetsuit_thickness_mm_range" CHECK ("wetsuit_thickness_mm" is null or "wetsuit_thickness_mm" between 1 and 10),
	CONSTRAINT "trips_rider_price_nonnegative" CHECK ("rider_price_cents" is null or "rider_price_cents" >= 0),
	CONSTRAINT "trips_diver_capacity_range" CHECK ("diver_capacity" is null or "diver_capacity" between 1 and 60),
	CONSTRAINT "trips_deposit_nonnegative" CHECK ("deposit_cents" is null or "deposit_cents" >= 0),
	CONSTRAINT "trips_cancellation_window_nonnegative" CHECK ("cancellation_window_hours" is null or "cancellation_window_hours" >= 0),
	CONSTRAINT "trips_ends_after_starts" CHECK ("ends_at" > "starts_at")
);
--> statement-breakpoint
CREATE TABLE "waiver_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"waiver_record_id" uuid NOT NULL,
	"channel" "waiver_delivery_channel" NOT NULL,
	"status" "notification_delivery_status" NOT NULL,
	"provider_message_id" text,
	"provider_status" "notification_provider_status",
	"provider_status_at" timestamp with time zone,
	"detail" text,
	"attempted_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "waiver_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"waiver_record_id" uuid NOT NULL,
	"door" "waiver_draft_door" NOT NULL,
	"link_id" uuid,
	"signer_name" text,
	"acknowledged" boolean DEFAULT false NOT NULL,
	"medical_answers" jsonb,
	"guardian" jsonb,
	"shop_answers" jsonb,
	"medical_alert" text,
	"saved_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "waiver_drafts_door_unique" UNIQUE NULLS NOT DISTINCT("waiver_record_id","door","link_id"),
	CONSTRAINT "waiver_drafts_link_matches_door" CHECK (("door" = 'thread') = ("link_id" is null))
);
--> statement-breakpoint
CREATE TABLE "waiver_materiality_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"template_id" uuid NOT NULL,
	"material" boolean NOT NULL,
	"actor_person_id" uuid NOT NULL,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL,
	"seq" bigserial
);
--> statement-breakpoint
CREATE TABLE "waiver_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"booking_id" uuid,
	"person_id" uuid NOT NULL,
	"template_id" uuid NOT NULL,
	"template_title" text NOT NULL,
	"template_version" integer NOT NULL,
	"template_generation" integer DEFAULT 1 NOT NULL,
	"template_body" text NOT NULL,
	"status" "waiver_record_status" DEFAULT 'pending'::"waiver_record_status" NOT NULL,
	"delivery_status" "notification_delivery_status",
	"delivery_provider_message_id" text,
	"delivery_provider_status" "notification_provider_status",
	"delivery_provider_status_at" timestamp with time zone,
	"delivery_error" text,
	"started_at" timestamp with time zone,
	"superseded_at" timestamp with time zone,
	"signed_name" text,
	"signature_method" text,
	"recorded_by_person_id" uuid,
	"consented_at" timestamp with time zone,
	"signed_at" timestamp with time zone,
	"medical_answers" jsonb,
	"medical_review_required" boolean DEFAULT false NOT NULL,
	"medical_cleared_at" timestamp with time zone,
	"medical_cleared_by_person_id" uuid,
	"medical_clearance_document_url" text,
	"medical_clearance_evaluated_on" date,
	"medical_clearance_physician_name" text,
	"medical_clearance_document_from_diver" boolean DEFAULT false NOT NULL,
	"medical_clearance_declined_at" timestamp with time zone,
	"medical_clearance_declined_by_person_id" uuid,
	"guardian_name" text,
	"guardian_relationship" text,
	"guardian_email" text,
	"guardian_signature_method" text,
	"guardian_consented_at" timestamp with time zone,
	"guardian_signed_at" timestamp with time zone,
	"guardian_email_erased_at" timestamp with time zone,
	"guardian_email_erased_by_person_id" uuid,
	"shop_answers" jsonb,
	"medical_alert" text,
	"signed_via" "waiver_signed_via",
	"completed_at" timestamp with time zone,
	"integrity_hash" text,
	"integrity_version" integer,
	"integrity_valid" boolean,
	"integrity_checked_at" timestamp with time zone,
	"imported_from_label" text,
	"import_source_document_url" text,
	"import_source_medical_document_url" text,
	"anonymized_at" timestamp with time zone,
	"diver_medical_form_url" text,
	"diver_medical_form_sent_at" timestamp with time zone,
	"anonymized_by_person_id" uuid,
	"moved_from_person_id" uuid,
	"moved_at" timestamp with time zone,
	"moved_by_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "waiver_records_medical_clearance_attributed" CHECK (("medical_cleared_at" is null) = ("medical_cleared_by_person_id" is null)
        and ("medical_clearance_declined_at" is null) = ("medical_clearance_declined_by_person_id" is null)
        and ("medical_cleared_at" is null or "medical_clearance_declined_at" is null)
        and ("medical_clearance_document_url" is null
          or "medical_cleared_at" is not null
          or "medical_clearance_declined_at" is not null)),
	CONSTRAINT "waiver_records_medical_clearance_needs_referral" CHECK (("medical_cleared_at" is null and "medical_clearance_declined_at" is null)
        or "medical_review_required"),
	CONSTRAINT "waiver_records_medical_clearance_evidenced" CHECK (("medical_cleared_at" is null and "medical_clearance_declined_at" is null)
        or "anonymized_at" is not null or (
        "medical_clearance_evaluated_on" is not null
        and ("medical_clearance_document_url" is not null
          or "medical_clearance_physician_name" is not null))),
	CONSTRAINT "waiver_records_clearance_document_from_diver" CHECK (not "medical_clearance_document_from_diver"
        or "medical_clearance_document_url" is not null
        or "anonymized_at" is not null),
	CONSTRAINT "waiver_records_diver_medical_form_held" CHECK ("diver_medical_form_url" is null or (
        "diver_medical_form_sent_at" is not null
        and "medical_review_required"
        and "medical_cleared_at" is null
        and "medical_clearance_declined_at" is null)),
	CONSTRAINT "waiver_records_guardian_email_erased_stays_erased" CHECK ("guardian_email_erased_at" is null or "guardian_email" is null),
	CONSTRAINT "waiver_records_integrity_verdict_whole" CHECK (("integrity_valid" is null) = ("integrity_checked_at" is null)),
	CONSTRAINT "waiver_records_guardian_signature_whole" CHECK (("guardian_signed_at" is null) = ("guardian_consented_at" is null)
        and ("guardian_signed_at" is null) = ("guardian_signature_method" is null)
        and ("guardian_signed_at" is null) = ("guardian_relationship" is null))
);
--> statement-breakpoint
CREATE TABLE "waiver_seal_acknowledgements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"waiver_record_id" uuid NOT NULL,
	"state_digest" text NOT NULL,
	"note" text NOT NULL,
	"acknowledged_by_person_id" uuid NOT NULL,
	"acknowledged_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "waiver_seal_acknowledgements_note_length" CHECK (length(btrim("note")) > 0 and length("note") <= 1000)
);
--> statement-breakpoint
CREATE TABLE "waiver_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"title" text NOT NULL,
	"version" integer NOT NULL,
	"material_generation" integer DEFAULT 1 NOT NULL,
	"body" text NOT NULL,
	"questions" jsonb DEFAULT '[]' NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wallet_pass_registrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"pass_id" uuid NOT NULL,
	"device_library_identifier" text NOT NULL,
	"push_token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "wallet_passes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"booking_id" uuid NOT NULL,
	"platform" text NOT NULL,
	"locale" text NOT NULL,
	"authentication_token_hash" text,
	"google_object_id" text,
	"content_hash" text NOT NULL,
	"content_json" jsonb NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_checked_at" timestamp with time zone,
	"last_pushed_at" timestamp with time zone,
	"voided_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "wallet_passes_platform_check" CHECK ("platform" in ('apple', 'google')),
	CONSTRAINT "wallet_passes_credentials_check" CHECK (("platform" = 'apple' and "authentication_token_hash" is not null and "google_object_id" is null) or ("platform" = 'google' and "authentication_token_hash" is null and "google_object_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "website_setup_drafts" (
	"shop_id" uuid PRIMARY KEY,
	"host" text NOT NULL,
	"lines" jsonb NOT NULL,
	"read_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "weekly_digest_sends" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"week_of" date NOT NULL,
	"status" "notification_delivery_status",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_gear_notices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"kind" "customer_gear_notice_kind" NOT NULL,
	"person_id" uuid NOT NULL,
	"work_order_id" uuid,
	"work_order_event_id" uuid,
	"customer_gear_item_id" uuid,
	"due_clock" "gear_service_kind",
	"due_on" date,
	"status" "customer_gear_notice_status" DEFAULT 'sending'::"customer_gear_notice_status" NOT NULL,
	"channel" "customer_gear_notice_channel",
	"sent_by_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"seq" bigserial
);
--> statement-breakpoint
CREATE TABLE "customer_gear_reminder_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"customer_gear_item_id" uuid NOT NULL,
	"reminders_off_at" timestamp with time zone,
	"changed_by_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_order_bills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"work_order_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"created_by_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"seq" bigserial
);
--> statement-breakpoint
CREATE TABLE "customer_gear_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"kind" "gear_item_kind" NOT NULL,
	"brand_model" text,
	"serial_number" text,
	"note" text,
	"service_due_on" date,
	"inspection_due_on" date,
	"hydro_due_on" date,
	"deleted_at" timestamp with time zone,
	"deleted_by_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_order_care" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"work_order_id" uuid NOT NULL,
	"customer_gear_item_id" uuid,
	"kind" "gear_service_kind" NOT NULL,
	"passed" boolean NOT NULL,
	"performed_on" date NOT NULL,
	"next_due_on" date,
	"next_due_dives" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_order_care_due_after_performed" CHECK ("next_due_on" is null or "next_due_on" > "performed_on")
);
--> statement-breakpoint
CREATE TABLE "work_order_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"work_order_id" uuid NOT NULL,
	"kind" "work_order_event_kind" NOT NULL,
	"from_status" "work_order_status",
	"to_status" "work_order_status",
	"technician_person_id" uuid,
	"actor_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"seq" bigserial
);
--> statement-breakpoint
CREATE TABLE "work_order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"work_order_id" uuid NOT NULL,
	"customer_gear_item_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_order_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"work_order_id" uuid NOT NULL,
	"kind" "work_order_line_kind" NOT NULL,
	"description" text NOT NULL,
	"quantity_hundredths" integer DEFAULT 100 NOT NULL,
	"unit_amount_cents" integer NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_order_lines_quantity_positive" CHECK ("quantity_hundredths" > 0),
	CONSTRAINT "work_order_lines_amount_not_negative" CHECK ("unit_amount_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "work_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"person_id" uuid,
	"gear_item_id" uuid,
	"number" integer NOT NULL,
	"status" "work_order_status" DEFAULT 'received'::"work_order_status" NOT NULL,
	"reported_problem" text NOT NULL,
	"promised_on" date,
	"technician_person_id" uuid,
	"technician_notes" text,
	"work_performed" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ready_at" timestamp with time zone,
	"picked_up_at" timestamp with time zone,
	"outcome" "work_order_outcome",
	"outcome_note" text,
	"outcome_recorded_at" timestamp with time zone,
	"outcome_recorded_by_person_id" uuid,
	"unit_prior_status" "gear_item_status",
	"unit_prior_service_note" text,
	"deleted_at" timestamp with time zone,
	"deleted_by_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_orders_one_subject" CHECK (("person_id" is not null and "gear_item_id" is null) or ("person_id" is null and "gear_item_id" is not null))
);
--> statement-breakpoint
CREATE INDEX "account_sessions_user_account_idx" ON "account_sessions" ("user_account_id");--> statement-breakpoint
CREATE INDEX "account_sessions_person_idx" ON "account_sessions" ("person_id");--> statement-breakpoint
CREATE INDEX "account_sessions_expires_idx" ON "account_sessions" ("expires_at");--> statement-breakpoint
CREATE INDEX "account_sign_in_challenges_expiry_idx" ON "account_sign_in_challenges" ("expires_at");--> statement-breakpoint
CREATE INDEX "account_sign_in_challenges_account_idx" ON "account_sign_in_challenges" ("user_account_id");--> statement-breakpoint
CREATE INDEX "account_step_ups_session_purpose_idx" ON "account_step_ups" ("account_session_id","purpose","expires_at");--> statement-breakpoint
CREATE INDEX "account_step_ups_account_expires_idx" ON "account_step_ups" ("user_account_id","expires_at");--> statement-breakpoint
CREATE INDEX "activity_events_subject_person_id_idx" ON "activity_events" ("subject_person_id");--> statement-breakpoint
CREATE INDEX "activity_events_actor_person_id_idx" ON "activity_events" ("actor_person_id");--> statement-breakpoint
CREATE INDEX "activity_events_shop_trip_seq_idx" ON "activity_events" ("shop_id","trip_id","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "activity_events_shop_id_id_unique" ON "activity_events" ("shop_id","id");--> statement-breakpoint
CREATE INDEX "activity_events_shop_trip_idx" ON "activity_events" ("shop_id","trip_id","occurred_at");--> statement-breakpoint
CREATE INDEX "activity_events_shop_subject_idx" ON "activity_events" ("shop_id","subject_person_id","occurred_at");--> statement-breakpoint
CREATE INDEX "activity_events_shop_occurred_idx" ON "activity_events" ("shop_id","occurred_at","seq");--> statement-breakpoint
CREATE INDEX "dive_not_made_events_recorded_by_person_id_idx" ON "dive_not_made_events" ("recorded_by_person_id");--> statement-breakpoint
CREATE INDEX "dive_not_made_events_shop_trip_idx" ON "dive_not_made_events" ("shop_id","trip_id","meeting_day","dive_number","recorded_at","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "form_drafts_person_form_unique" ON "form_drafts" ("shop_id","person_id","form");--> statement-breakpoint
CREATE INDEX "form_drafts_saved_at_idx" ON "form_drafts" ("saved_at");--> statement-breakpoint
CREATE INDEX "internal_notes_shop_person_idx" ON "internal_notes" ("shop_id","person_id","created_at");--> statement-breakpoint
CREATE INDEX "internal_notes_booking_idx" ON "internal_notes" ("booking_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "today_read_mark_events_unique" ON "today_read_mark_events" ("mark_id","event_id");--> statement-breakpoint
CREATE INDEX "today_read_mark_events_shop_idx" ON "today_read_mark_events" ("shop_id");--> statement-breakpoint
CREATE INDEX "today_read_mark_events_event_idx" ON "today_read_mark_events" ("event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "today_read_marks_shop_person_day_unique" ON "today_read_marks" ("shop_id","person_id","day_start");--> statement-breakpoint
CREATE INDEX "today_read_marks_person_idx" ON "today_read_marks" ("person_id");--> statement-breakpoint
CREATE INDEX "today_read_marks_seen_idx" ON "today_read_marks" ("last_seen_at");--> statement-breakpoint
CREATE UNIQUE INDEX "today_read_marks_shop_id_id_unique" ON "today_read_marks" ("shop_id","id");--> statement-breakpoint
CREATE INDEX "trip_change_events_actor_person_id_idx" ON "trip_change_events" ("actor_person_id");--> statement-breakpoint
CREATE INDEX "trip_change_events_shop_trip_idx" ON "trip_change_events" ("shop_id","trip_id","occurred_at","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "trip_read_marks_trip_person_unique" ON "trip_read_marks" ("trip_id","person_id");--> statement-breakpoint
CREATE INDEX "trip_read_marks_shop_seen_idx" ON "trip_read_marks" ("shop_id","last_seen_at");--> statement-breakpoint
CREATE INDEX "trip_stage_events_shop_trip_idx" ON "trip_stage_events" ("shop_id","trip_id","recorded_at","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "assist_results_subject_unique" ON "assist_results" ("shop_id","feature","subject_key");--> statement-breakpoint
CREATE INDEX "assist_results_updated_at_idx" ON "assist_results" ("updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "claude_call_content_usage_unique" ON "claude_call_content" ("usage_id");--> statement-breakpoint
CREATE INDEX "claude_call_content_shop_created_at_idx" ON "claude_call_content" ("shop_id","created_at");--> statement-breakpoint
CREATE INDEX "claude_call_content_created_at_idx" ON "claude_call_content" ("created_at");--> statement-breakpoint
CREATE INDEX "claude_usage_shop_created_at_idx" ON "claude_usage" ("shop_id","created_at");--> statement-breakpoint
CREATE INDEX "claude_usage_created_at_idx" ON "claude_usage" ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "shop_text_translations_subject_unique" ON "shop_text_translations" ("shop_id","subject_kind","subject_id","field","locale");--> statement-breakpoint
CREATE UNIQUE INDEX "collection_entries_shop_id_unique" ON "collection_entries" ("shop_id","id");--> statement-breakpoint
CREATE INDEX "collection_entries_source_idx" ON "collection_entries" ("shop_id","source_type","source_id","id");--> statement-breakpoint
CREATE INDEX "collection_entries_month_idx" ON "collection_entries" ("shop_id","recorded_at");--> statement-breakpoint
CREATE UNIQUE INDEX "pricing_volume_statements_shop_month_unique" ON "pricing_volume_statements" ("shop_id","month","currency");--> statement-breakpoint
CREATE UNIQUE INDEX "shop_subscriptions_stripe_customer_unique" ON "shop_subscriptions" ("stripe_customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "shop_subscriptions_stripe_subscription_unique" ON "shop_subscriptions" ("stripe_subscription_id");--> statement-breakpoint
CREATE INDEX "booking_capabilities_booking_purpose_idx" ON "booking_capabilities" ("booking_id","purpose","revoked_at");--> statement-breakpoint
CREATE UNIQUE INDEX "booking_capabilities_live_link_idx" ON "booking_capabilities" ("booking_id","purpose","delivered") WHERE "revoked_at" is null and "source_capability_id" is null;--> statement-breakpoint
CREATE INDEX "booking_capabilities_returning_device_idx" ON "booking_capabilities" ("returning_device_hash","purpose","returning_order") WHERE "returning_device_hash" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "booking_capabilities_returning_receipt_source_unique" ON "booking_capabilities" ("source_capability_id") WHERE "source_capability_id" is not null;--> statement-breakpoint
CREATE INDEX "booking_referrals_shop_idx" ON "booking_referrals" ("shop_id");--> statement-breakpoint
CREATE INDEX "booking_referrals_referrer_idx" ON "booking_referrals" ("referred_by_booking_id");--> statement-breakpoint
CREATE UNIQUE INDEX "bookings_shop_id_id_unique" ON "bookings" ("shop_id","id");--> statement-breakpoint
CREATE INDEX "bookings_training_plan_instructor_idx" ON "bookings" ("training_plan_instructor_person_id");--> statement-breakpoint
CREATE INDEX "bookings_training_plan_by_idx" ON "bookings" ("training_plan_by_person_id");--> statement-breakpoint
CREATE INDEX "bookings_training_enrollment_idx" ON "bookings" ("training_enrollment_booking_id") WHERE "training_enrollment_booking_id" is not null;--> statement-breakpoint
CREATE INDEX "bookings_person_id_idx" ON "bookings" ("person_id");--> statement-breakpoint
CREATE INDEX "bookings_course_followup_person_idx" ON "bookings" ("course_followup_by_person_id","shop_id");--> statement-breakpoint
CREATE UNIQUE INDEX "bookings_trip_person_unique" ON "bookings" ("trip_id","person_id");--> statement-breakpoint
CREATE INDEX "bookings_trip_idx" ON "bookings" ("trip_id");--> statement-breakpoint
CREATE INDEX "bookings_shop_person_idx" ON "bookings" ("shop_id","person_id");--> statement-breakpoint
CREATE INDEX "bookings_party_lead_idx" ON "bookings" ("party_lead_booking_id");--> statement-breakpoint
CREATE INDEX "bookings_group_hold_due_idx" ON "bookings" ("group_hold_until") WHERE "group_hold_until" is not null;--> statement-breakpoint
CREATE INDEX "bookings_shop_referral_idx" ON "bookings" ("shop_id","referral_source");--> statement-breakpoint
CREATE UNIQUE INDEX "trip_help_requests_booking_unique" ON "trip_help_requests" ("booking_id");--> statement-breakpoint
CREATE INDEX "trip_help_requests_shop_status_idx" ON "trip_help_requests" ("shop_id","status","created_at");--> statement-breakpoint
CREATE INDEX "trip_help_requests_trip_idx" ON "trip_help_requests" ("trip_id","created_at");--> statement-breakpoint
CREATE INDEX "trip_help_requests_helper_person_idx" ON "trip_help_requests" ("helper_person_id");--> statement-breakpoint
CREATE INDEX "capabilities_person_idx" ON "capabilities" ("person_id");--> statement-breakpoint
CREATE INDEX "capabilities_interest_idx" ON "capabilities" ("interest_id");--> statement-breakpoint
CREATE INDEX "capabilities_user_account_idx" ON "capabilities" ("user_account_id");--> statement-breakpoint
CREATE INDEX "capabilities_setup_request_idx" ON "capabilities" ("setup_request_id");--> statement-breakpoint
CREATE INDEX "capabilities_waiver_record_idx" ON "capabilities" ("waiver_record_id");--> statement-breakpoint
CREATE UNIQUE INDEX "capabilities_live_person_purpose_idx" ON "capabilities" ("person_id","purpose") WHERE "one_live" and "used_at" is null and "revoked_at" is null;--> statement-breakpoint
CREATE INDEX "capabilities_spent_by_shop_idx" ON "capabilities" ("spent_by_shop_id");--> statement-breakpoint
CREATE UNIQUE INDEX "capabilities_live_account_purpose_idx" ON "capabilities" ("user_account_id","purpose") WHERE "user_account_id" is not null and "used_at" is null and "revoked_at" is null;--> statement-breakpoint
CREATE INDEX "capabilities_sent_to_idx" ON "capabilities" ("shop_id","sent_to");--> statement-breakpoint
CREATE INDEX "cards_person_id_idx" ON "cards" ("person_id");--> statement-breakpoint
CREATE INDEX "cards_shop_person_kind_idx" ON "cards" ("shop_id","person_id","kind");--> statement-breakpoint
CREATE INDEX "cards_junior_status_verifier_idx" ON "cards" ("junior_status_verified_by_person_id");--> statement-breakpoint
CREATE INDEX "cards_processed_by_person_idx" ON "cards" ("processed_by_person_id") WHERE "processed_by_person_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "cards_level_shop_agency_identifier_unique" ON "cards" ("shop_id","agency",lower("identifier")) WHERE "deleted_at" is null and "kind" = 'level';--> statement-breakpoint
CREATE UNIQUE INDEX "cards_specialty_shop_agency_specialty_identifier_unique" ON "cards" ("shop_id","agency","specialty",lower("identifier")) WHERE "deleted_at" is null and "kind" = 'specialty';--> statement-breakpoint
CREATE UNIQUE INDEX "cards_nitrox_shop_agency_identifier_unique" ON "cards" ("shop_id","agency",lower("identifier")) WHERE "deleted_at" is null and "kind" = 'nitrox';--> statement-breakpoint
CREATE INDEX "certification_junior_reviews_person_idx" ON "certification_junior_reviews" ("person_id");--> statement-breakpoint
CREATE INDEX "certification_junior_reviews_recorder_idx" ON "certification_junior_reviews" ("recorded_by_person_id");--> statement-breakpoint
CREATE INDEX "certification_junior_reviews_card_idx" ON "certification_junior_reviews" ("shop_id","certification_id","recorded_at");--> statement-breakpoint
CREATE INDEX "prior_visits_shop_person_idx" ON "prior_visits" ("shop_id","person_id","visited_on");--> statement-breakpoint
CREATE UNIQUE INDEX "prior_visits_shop_person_dedupe_unique" ON "prior_visits" ("shop_id","person_id","dedupe_key");--> statement-breakpoint
CREATE UNIQUE INDEX "computer_dive_profile_unique" ON "computer_dive_profiles" ("dive_id");--> statement-breakpoint
CREATE INDEX "computer_profile_person_idx" ON "computer_dive_profiles" ("person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "computer_dives_fingerprint_unique" ON "computer_dives" ("shop_id","person_id","fingerprint");--> statement-breakpoint
CREATE INDEX "computer_dives_person_idx" ON "computer_dives" ("person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "computer_import_request_unique" ON "computer_import_batches" ("shop_id","person_id","request_key");--> statement-breakpoint
CREATE INDEX "computer_import_person_idx" ON "computer_import_batches" ("person_id");--> statement-breakpoint
CREATE INDEX "trip_conservation_live_idx" ON "trip_conservation" ("shop_id","trip_id") WHERE "deleted_at" is null;--> statement-breakpoint
CREATE INDEX "people_shop_idx" ON "people" ("shop_id");--> statement-breakpoint
CREATE UNIQUE INDEX "people_shop_id_id_unique" ON "people" ("shop_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "people_shop_email_unique" ON "people" ("shop_id",lower("email")) WHERE "deleted_at" is null and "email" is not null;--> statement-breakpoint
CREATE INDEX "people_full_name_trgm_idx" ON "people" USING gin ("full_name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "people_email_trgm_idx" ON "people" USING gin ("email" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "people_phone_trgm_idx" ON "people" USING gin ("phone" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "people_phone_digits_trgm_idx" ON "people" USING gin (regexp_replace(coalesce("phone", ''), '[^0-9]', '', 'g') gin_trgm_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "shops_inbound_email_token_unique" ON "shops" ("inbound_email_token");--> statement-breakpoint
CREATE UNIQUE INDEX "shops_bookkeeper_confirm_token_hash_unique" ON "shops" ("bookkeeper_confirm_token_hash");--> statement-breakpoint
CREATE INDEX "shops_name_trgm_idx" ON "shops" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "shops_address_locality_trgm_idx" ON "shops" USING gin ("address_locality" gin_trgm_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "user_accounts_email_unique" ON "user_accounts" ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "user_accounts_person_unique" ON "user_accounts" ("person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "course_form_records_booking_version_unique" ON "course_form_records" ("booking_id","form_version_id");--> statement-breakpoint
CREATE INDEX "course_form_records_shop_booking_idx" ON "course_form_records" ("shop_id","booking_id");--> statement-breakpoint
CREATE INDEX "course_form_records_shop_person_idx" ON "course_form_records" ("shop_id","person_id");--> statement-breakpoint
CREATE INDEX "course_form_records_signed_via_idx" ON "course_form_records" ("signed_via_booking_id") WHERE "signed_via_booking_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "course_form_requirements_live_unique" ON "course_form_requirements" ("course_id","form_id") WHERE "deleted_at" is null;--> statement-breakpoint
CREATE INDEX "course_form_requirements_shop_course_idx" ON "course_form_requirements" ("shop_id","course_id");--> statement-breakpoint
CREATE UNIQUE INDEX "course_form_versions_form_version_unique" ON "course_form_versions" ("form_id","version");--> statement-breakpoint
CREATE INDEX "course_form_versions_shop_form_idx" ON "course_form_versions" ("shop_id","form_id");--> statement-breakpoint
CREATE INDEX "course_forms_shop_live_idx" ON "course_forms" ("shop_id") WHERE "deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "course_elearning_codes_code_unique" ON "course_elearning_codes" ("shop_id","course_id","code") WHERE "deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "course_elearning_codes_booking_unique" ON "course_elearning_codes" ("booking_id") WHERE "booking_id" is not null;--> statement-breakpoint
CREATE INDEX "course_elearning_codes_stock_idx" ON "course_elearning_codes" ("shop_id","course_id","created_at") WHERE "booking_id" is null and "deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "course_session_progress_step_unique" ON "course_session_progress" ("shop_id","person_id","course_id","step_title");--> statement-breakpoint
CREATE INDEX "course_session_progress_course_idx" ON "course_session_progress" ("course_id");--> statement-breakpoint
CREATE UNIQUE INDEX "courses_shop_title_unique" ON "courses" ("shop_id","title");--> statement-breakpoint
CREATE UNIQUE INDEX "courses_shop_slug_unique" ON "courses" ("shop_id","slug");--> statement-breakpoint
CREATE INDEX "courses_shop_active_idx" ON "courses" ("shop_id","is_active");--> statement-breakpoint
CREATE INDEX "courses_title_trgm_idx" ON "courses" USING gin ("title" gin_trgm_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "crew_assignment_requests_live_idx" ON "crew_assignment_requests" ("trip_id","person_id") WHERE deleted_at is null;--> statement-breakpoint
CREATE INDEX "crew_assignment_requests_shop_trip_idx" ON "crew_assignment_requests" ("shop_id","trip_id");--> statement-breakpoint
CREATE INDEX "crew_assignment_requests_shop_person_idx" ON "crew_assignment_requests" ("shop_id","person_id");--> statement-breakpoint
CREATE INDEX "crew_availability_blocks_shop_person_idx" ON "crew_availability_blocks" ("shop_id","person_id","starts_on") WHERE deleted_at is null;--> statement-breakpoint
CREATE INDEX "crew_availability_blocks_shop_range_idx" ON "crew_availability_blocks" ("shop_id","starts_on","ends_on") WHERE deleted_at is null;--> statement-breakpoint
CREATE UNIQUE INDEX "crew_away_acknowledgements_live_uidx" ON "crew_away_acknowledgements" ("trip_id","person_id") WHERE deleted_at is null;--> statement-breakpoint
CREATE INDEX "crew_away_acknowledgements_shop_trip_idx" ON "crew_away_acknowledgements" ("shop_id","trip_id") WHERE deleted_at is null;--> statement-breakpoint
CREATE INDEX "crew_away_acknowledgements_person_idx" ON "crew_away_acknowledgements" ("person_id");--> statement-breakpoint
CREATE INDEX "crew_away_acknowledgements_acknowledged_by_idx" ON "crew_away_acknowledgements" ("acknowledged_by_person_id");--> statement-breakpoint
CREATE INDEX "crew_away_acknowledgements_cleared_by_idx" ON "crew_away_acknowledgements" ("cleared_by_person_id");--> statement-breakpoint
CREATE INDEX "crew_notices_pending_idx" ON "crew_notices" ("shop_id","person_id","seq") WHERE settled_at is null;--> statement-breakpoint
CREATE INDEX "crew_notices_person_idx" ON "crew_notices" ("person_id");--> statement-breakpoint
CREATE INDEX "crew_notices_trip_idx" ON "crew_notices" ("trip_id");--> statement-breakpoint
CREATE INDEX "crew_notices_actor_idx" ON "crew_notices" ("actor_person_id");--> statement-breakpoint
CREATE INDEX "crew_notices_settled_idx" ON "crew_notices" ("settled_at");--> statement-breakpoint
CREATE INDEX "staff_credential_history_shop_credential_idx" ON "staff_credential_history" ("shop_id","credential_id","seq");--> statement-breakpoint
CREATE INDEX "staff_credentials_shop_person_idx" ON "staff_credentials" ("shop_id","person_id");--> statement-breakpoint
CREATE INDEX "staff_credentials_renewal_idx" ON "staff_credentials" ("shop_id","renews_at");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_credentials_live_identity_unique" ON "staff_credentials" ("shop_id","person_id","kind",lower("identifier")) WHERE "deleted_at" is null;--> statement-breakpoint
CREATE INDEX "staff_shifts_shop_starts_idx" ON "staff_shifts" ("shop_id","starts_at");--> statement-breakpoint
CREATE INDEX "staff_shifts_person_starts_idx" ON "staff_shifts" ("person_id","starts_at");--> statement-breakpoint
CREATE INDEX "trip_assignments_person_idx" ON "trip_assignments" ("person_id");--> statement-breakpoint
CREATE INDEX "trip_assignments_assigned_by_idx" ON "trip_assignments" ("assigned_by_person_id");--> statement-breakpoint
CREATE INDEX "trip_assignments_training_plan_instructor_idx" ON "trip_assignments" ("training_plan_instructor_person_id");--> statement-breakpoint
CREATE INDEX "trip_assignments_training_plan_by_idx" ON "trip_assignments" ("training_plan_by_person_id");--> statement-breakpoint
CREATE INDEX "trip_series_crew_shop_idx" ON "trip_series_crew" ("shop_id");--> statement-breakpoint
CREATE INDEX "trip_series_crew_person_idx" ON "trip_series_crew" ("person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "boarding_observations_client_key_unique" ON "boarding_observations" ("shop_id","client_key");--> statement-breakpoint
CREATE UNIQUE INDEX "boarding_observations_open_seat_unique" ON "boarding_observations" ("booking_id") WHERE "state" in ('pending', 'conflict');--> statement-breakpoint
CREATE INDEX "boarding_observations_open_trip_idx" ON "boarding_observations" ("shop_id","trip_id") WHERE "state" in ('pending', 'conflict');--> statement-breakpoint
CREATE INDEX "departure_notes_shop_trip_idx" ON "departure_notes" ("shop_id","trip_id","sent_at");--> statement-breakpoint
CREATE INDEX "lost_items_shop_status_idx" ON "lost_items" ("shop_id","status","created_at");--> statement-breakpoint
CREATE INDEX "lost_items_shop_trip_idx" ON "lost_items" ("shop_id","trip_id");--> statement-breakpoint
CREATE INDEX "lost_items_shop_person_idx" ON "lost_items" ("shop_id","person_id") WHERE "person_id" is not null;--> statement-breakpoint
CREATE INDEX "boat_snags_shop_boat_open_idx" ON "boat_snags" ("shop_id","boat_id","noted_at") WHERE "fixed_at" is null;--> statement-breakpoint
CREATE INDEX "boat_snags_noted_on_trip_idx" ON "boat_snags" ("shop_id","noted_on_trip_id");--> statement-breakpoint
CREATE INDEX "boat_snags_noted_by_person_id_idx" ON "boat_snags" ("noted_by_person_id");--> statement-breakpoint
CREATE INDEX "boat_snags_still_there_by_person_id_idx" ON "boat_snags" ("still_there_by_person_id");--> statement-breakpoint
CREATE INDEX "boat_snags_fixed_by_person_id_idx" ON "boat_snags" ("fixed_by_person_id");--> statement-breakpoint
CREATE INDEX "booking_arrival_events_shop_trip_booking_occurred_idx" ON "booking_arrival_events" ("shop_id","trip_id","booking_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "booking_arrival_events_shop_client_event_unique" ON "booking_arrival_events" ("shop_id","client_event_id");--> statement-breakpoint
CREATE INDEX "buddy_team_events_shop_trip_idx" ON "buddy_team_events" ("shop_id","trip_id","occurred_at");--> statement-breakpoint
CREATE INDEX "buddy_team_events_pair_idx" ON "buddy_team_events" ("pair_id");--> statement-breakpoint
CREATE UNIQUE INDEX "buddy_team_members_booking_unique" ON "buddy_team_members" ("booking_id");--> statement-breakpoint
CREATE INDEX "buddy_team_members_shop_trip_idx" ON "buddy_team_members" ("shop_id","trip_id");--> statement-breakpoint
CREATE INDEX "buddy_team_members_pair_idx" ON "buddy_team_members" ("pair_id");--> statement-breakpoint
CREATE UNIQUE INDEX "departure_boat_safety_snapshots_trip_idx" ON "departure_boat_safety_snapshots" ("trip_id");--> statement-breakpoint
CREATE INDEX "departure_boat_safety_snapshots_shop_idx" ON "departure_boat_safety_snapshots" ("shop_id");--> statement-breakpoint
CREATE INDEX "disruption_recovery_events_diver_seq_idx" ON "disruption_recovery_events" ("shop_id","blowout_diver_id","seq");--> statement-breakpoint
CREATE INDEX "dive_participation_notes_shop_trip_idx" ON "dive_participation_notes" ("shop_id","trip_id","booking_id","dive_number","seq");--> statement-breakpoint
CREATE INDEX "dive_participation_notes_booking_idx" ON "dive_participation_notes" ("booking_id");--> statement-breakpoint
CREATE INDEX "dive_participation_notes_recorded_by_person_id_idx" ON "dive_participation_notes" ("recorded_by_person_id");--> statement-breakpoint
CREATE INDEX "pre_departure_check_events_shop_trip_item_occurred_idx" ON "pre_departure_check_events" ("shop_id","trip_id","checklist_item_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "pre_departure_check_events_shop_client_event_unique" ON "pre_departure_check_events" ("shop_id","client_event_id");--> statement-breakpoint
CREATE INDEX "pre_departure_checklist_items_shop_order_idx" ON "pre_departure_checklist_items" ("shop_id","sort_order","created_at") WHERE "deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "pre_departure_checklist_items_shop_label_unique" ON "pre_departure_checklist_items" ("shop_id","label") WHERE "deleted_at" is null;--> statement-breakpoint
CREATE INDEX "roll_call_deck_counts_shop_trip_checkpoint_idx" ON "roll_call_deck_counts" ("shop_id","trip_id","checkpoint","seq");--> statement-breakpoint
CREATE INDEX "roll_call_events_recorded_by_person_id_idx" ON "roll_call_events" ("recorded_by_person_id");--> statement-breakpoint
CREATE INDEX "roll_call_events_crew_person_id_idx" ON "roll_call_events" ("crew_person_id");--> statement-breakpoint
CREATE INDEX "roll_call_events_retracts_event_id_idx" ON "roll_call_events" ("retracts_event_id");--> statement-breakpoint
CREATE INDEX "roll_call_events_shop_trip_checkpoint_booking_occurred_idx" ON "roll_call_events" ("shop_id","trip_id","checkpoint","booking_id","occurred_at") WHERE "subject_kind" = 'seat';--> statement-breakpoint
CREATE INDEX "roll_call_events_shop_trip_checkpoint_crew_occurred_idx" ON "roll_call_events" ("shop_id","trip_id","checkpoint","crew_person_id","occurred_at") WHERE "subject_kind" = 'crew';--> statement-breakpoint
CREATE UNIQUE INDEX "roll_call_events_shop_client_event_unique" ON "roll_call_events" ("shop_id","client_event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "safety_drill_participants_drill_person_unique" ON "safety_drill_participants" ("drill_id","person_id");--> statement-breakpoint
CREATE INDEX "safety_drill_participants_person_id_idx" ON "safety_drill_participants" ("person_id");--> statement-breakpoint
CREATE INDEX "safety_drills_deleted_by_person_id_idx" ON "safety_drills" ("deleted_by_person_id");--> statement-breakpoint
CREATE INDEX "safety_drills_shop_held_live_idx" ON "safety_drills" ("shop_id","held_on") WHERE "deleted_at" is null;--> statement-breakpoint
CREATE INDEX "safety_drills_recorded_by_person_id_idx" ON "safety_drills" ("recorded_by_person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "trip_blowout_divers_booking_unique" ON "trip_blowout_divers" ("booking_id");--> statement-breakpoint
CREATE INDEX "trip_blowout_divers_blowout_idx" ON "trip_blowout_divers" ("blowout_id");--> statement-breakpoint
CREATE INDEX "trip_blowout_divers_person_idx" ON "trip_blowout_divers" ("person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "trip_blowout_divers_shop_id_id_unique" ON "trip_blowout_divers" ("shop_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "trip_blowouts_trip_unique" ON "trip_blowouts" ("trip_id");--> statement-breakpoint
CREATE UNIQUE INDEX "trip_blowouts_shop_id_id_unique" ON "trip_blowouts" ("shop_id","id");--> statement-breakpoint
CREATE INDEX "trip_blowouts_shop_called_idx" ON "trip_blowouts" ("shop_id","called_at");--> statement-breakpoint
CREATE INDEX "dive_site_creatures_site_idx" ON "dive_site_creatures" ("dive_site_id");--> statement-breakpoint
CREATE UNIQUE INDEX "dive_sites_shop_name_unique" ON "dive_sites" ("shop_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "dive_sites_shop_slug_key" ON "dive_sites" ("shop_id","slug") WHERE "deleted_at" is null;--> statement-breakpoint
CREATE INDEX "dive_sites_name_trgm_idx" ON "dive_sites" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "dive_sites_location_trgm_idx" ON "dive_sites" USING gin ("location_name" gin_trgm_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "global_dive_site_versions_unique" ON "global_dive_site_versions" ("global_dive_site_id","version");--> statement-breakpoint
CREATE INDEX "marine_life_requests_created_idx" ON "marine_life_requests" ("created_at");--> statement-breakpoint
CREATE INDEX "media_deletion_attempts_shop_status_idx" ON "media_deletion_attempts" ("shop_id","status");--> statement-breakpoint
CREATE INDEX "media_deletion_attempts_unfinished_idx" ON "media_deletion_attempts" ("created_at") WHERE "status" <> 'succeeded';--> statement-breakpoint
CREATE INDEX "private_person_photo_uploads_cleanup_idx" ON "private_person_photo_uploads" ("state","last_cleanup_at");--> statement-breakpoint
CREATE UNIQUE INDEX "processor_erasure_obligations_shop_target_external_unique" ON "processor_erasure_obligations" ("shop_id","target","external_id");--> statement-breakpoint
CREATE INDEX "processor_erasure_obligations_shop_status_idx" ON "processor_erasure_obligations" ("shop_id","status");--> statement-breakpoint
CREATE INDEX "demo_entries_entered_idx" ON "demo_entries" ("entered_at");--> statement-breakpoint
CREATE UNIQUE INDEX "demo_previews_demo_shop_key" ON "demo_previews" ("demo_shop_id");--> statement-breakpoint
CREATE INDEX "demo_previews_created_idx" ON "demo_previews" ("created_at");--> statement-breakpoint
CREATE INDEX "setup_requests_created_idx" ON "setup_requests" ("created_at");--> statement-breakpoint
CREATE INDEX "setup_requests_receipt_claimed_idx" ON "setup_requests" ("receipt_claimed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "gear_items_shop_label_unique" ON "gear_items" ("shop_id","label") WHERE "deleted_at" is null;--> statement-breakpoint
CREATE INDEX "gear_items_shop_kind_idx" ON "gear_items" ("shop_id","kind") WHERE "deleted_at" is null;--> statement-breakpoint
CREATE INDEX "gear_items_aboard_boat_idx" ON "gear_items" ("aboard_boat_id") WHERE "aboard_boat_id" is not null and "deleted_at" is null;--> statement-breakpoint
CREATE INDEX "gear_items_label_trgm_idx" ON "gear_items" USING gin ("label" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "gear_items_serial_trgm_idx" ON "gear_items" USING gin ("serial_number" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "gear_items_brand_model_trgm_idx" ON "gear_items" USING gin ("brand_model" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "gear_reservations_item_idx" ON "gear_reservations" ("gear_item_id");--> statement-breakpoint
CREATE INDEX "gear_reservations_booking_idx" ON "gear_reservations" ("booking_id");--> statement-breakpoint
CREATE INDEX "gear_reservations_person_idx" ON "gear_reservations" ("person_id");--> statement-breakpoint
CREATE INDEX "gear_reservations_order_idx" ON "gear_reservations" ("order_id");--> statement-breakpoint
CREATE INDEX "gear_reservations_shop_until_idx" ON "gear_reservations" ("shop_id","reserved_until");--> statement-breakpoint
CREATE INDEX "gear_reservations_shop_checked_out_idx" ON "gear_reservations" ("shop_id","checked_out_at");--> statement-breakpoint
CREATE INDEX "gear_service_events_item_idx" ON "gear_service_events" ("gear_item_id","serviced_on");--> statement-breakpoint
CREATE INDEX "gear_service_events_shop_idx" ON "gear_service_events" ("shop_id");--> statement-breakpoint
CREATE INDEX "prior_gear_assignments_shop_gear_idx" ON "prior_gear_assignments" ("shop_id","gear_item_id","assigned_from");--> statement-breakpoint
CREATE INDEX "prior_gear_assignments_shop_person_idx" ON "prior_gear_assignments" ("shop_id","person_id","assigned_from");--> statement-breakpoint
CREATE UNIQUE INDEX "prior_gear_assignments_shop_dedupe_unique" ON "prior_gear_assignments" ("shop_id","person_id","gear_item_id","dedupe_key");--> statement-breakpoint
CREATE UNIQUE INDEX "rental_fit_profiles_shop_person_unique" ON "rental_fit_profiles" ("shop_id","person_id");--> statement-breakpoint
CREATE INDEX "incident_report_addenda_report_idx" ON "incident_report_addenda" ("report_id","created_at");--> statement-breakpoint
CREATE INDEX "incident_report_people_report_idx" ON "incident_report_people" ("report_id","created_at");--> statement-breakpoint
CREATE INDEX "incident_report_people_booking_idx" ON "incident_report_people" ("booking_id");--> statement-breakpoint
CREATE INDEX "incident_report_people_person_idx" ON "incident_report_people" ("person_id") WHERE "person_id" is not null;--> statement-breakpoint
CREATE INDEX "incident_reports_shop_trip_idx" ON "incident_reports" ("shop_id","trip_id","created_at") WHERE "deleted_at" is null;--> statement-breakpoint
CREATE INDEX "incident_reports_live_drafts_idx" ON "incident_reports" ("shop_id","created_at") WHERE "status" = 'draft' and "deleted_at" is null;--> statement-breakpoint
CREATE INDEX "incident_reports_shop_occurred_idx" ON "incident_reports" ("shop_id","occurred_at");--> statement-breakpoint
CREATE INDEX "incident_reports_raised_by_idx" ON "incident_reports" ("missing_alert_raised_by_person_id") WHERE "missing_alert_raised_by_person_id" is not null;--> statement-breakpoint
CREATE INDEX "incident_reports_found_by_idx" ON "incident_reports" ("missing_found_by_person_id") WHERE "missing_found_by_person_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "integration_deliveries_integration_event_unique" ON "integration_deliveries" ("integration_id","event_id");--> statement-breakpoint
CREATE INDEX "integration_deliveries_due_idx" ON "integration_deliveries" ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "integration_deliveries_shop_created_idx" ON "integration_deliveries" ("shop_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "integration_events_shop_idempotency_unique" ON "integration_events" ("shop_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "integration_events_shop_created_idx" ON "integration_events" ("shop_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "integration_oauth_states_hash_unique" ON "integration_oauth_states" ("state_hash");--> statement-breakpoint
CREATE INDEX "integration_oauth_states_expiry_idx" ON "integration_oauth_states" ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "integration_sync_records_source_unique" ON "integration_sync_records" ("shop_id","provider","source_type","source_id","operation");--> statement-breakpoint
CREATE UNIQUE INDEX "integration_sync_records_square_receipt_unique" ON "integration_sync_records" ("external_id") WHERE "source_type" = 'square_payment_receipt' and "operation" = 'receipt';--> statement-breakpoint
CREATE INDEX "integration_sync_records_external_idx" ON "integration_sync_records" ("shop_id","provider","external_id");--> statement-breakpoint
CREATE INDEX "platform_backup_progress_attempted_idx" ON "platform_backup_progress" ("last_attempt_at");--> statement-breakpoint
CREATE INDEX "platform_backup_progress_lease_idx" ON "platform_backup_progress" ("lease_until");--> statement-breakpoint
CREATE INDEX "shop_backup_deliveries_shop_started_idx" ON "shop_backup_deliveries" ("shop_id","started_at");--> statement-breakpoint
CREATE INDEX "shop_backup_deliveries_shop_period_idx" ON "shop_backup_deliveries" ("shop_id","period_key");--> statement-breakpoint
CREATE INDEX "shop_backup_delivery_claims_lease_idx" ON "shop_backup_delivery_claims" ("lease_until");--> statement-breakpoint
CREATE UNIQUE INDEX "shop_integrations_shop_provider_unique" ON "shop_integrations" ("shop_id","provider") WHERE "deleted_at" is null;--> statement-breakpoint
CREATE INDEX "shop_integrations_shop_status_idx" ON "shop_integrations" ("shop_id","status");--> statement-breakpoint
CREATE INDEX "date_request_offer_bookings_shop_interest_idx" ON "date_request_offer_bookings" ("shop_id","interest_id");--> statement-breakpoint
CREATE INDEX "interest_replies_shop_interest_idx" ON "interest_replies" ("shop_id","interest_id","sent_at");--> statement-breakpoint
CREATE INDEX "interest_replies_sent_by_person_idx" ON "interest_replies" ("sent_by_person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "interests_departure_person_unique" ON "interests" ("trip_id","person_id") WHERE "scope" = 'departure' and "person_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "interests_departure_parent_unique" ON "interests" ("trip_id","parent_interest_id") WHERE "scope" = 'departure' and "parent_interest_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "interests_shop_id_id_unique" ON "interests" ("shop_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "interests_anytime_shop_person_unique" ON "interests" ("shop_id","person_id") WHERE "scope" = 'anytime';--> statement-breakpoint
CREATE INDEX "interests_departure_idx" ON "interests" ("shop_id","trip_id","asked_at") WHERE "scope" = 'departure';--> statement-breakpoint
CREATE INDEX "interests_date_preferred_idx" ON "interests" ("shop_id","preferred_date") WHERE "scope" = 'date' and "closed_at" is null;--> statement-breakpoint
CREATE INDEX "interests_date_alternate_idx" ON "interests" ("shop_id","alternate_date") WHERE "scope" = 'date' and "closed_at" is null;--> statement-breakpoint
CREATE INDEX "interests_anytime_open_idx" ON "interests" ("shop_id") WHERE "scope" = 'anytime' and "closed_at" is null;--> statement-breakpoint
CREATE INDEX "interests_person_idx" ON "interests" ("person_id");--> statement-breakpoint
CREATE INDEX "interests_created_by_person_idx" ON "interests" ("created_by_person_id");--> statement-breakpoint
CREATE INDEX "interests_parent_idx" ON "interests" ("parent_interest_id");--> statement-breakpoint
CREATE INDEX "interests_course_idx" ON "interests" ("course_id");--> statement-breakpoint
CREATE INDEX "interests_promo_idx" ON "interests" ("promo_id");--> statement-breakpoint
CREATE INDEX "interests_shop_asked_idx" ON "interests" ("shop_id","asked_at");--> statement-breakpoint
CREATE UNIQUE INDEX "email_bounces_event_unique" ON "email_bounces" ("provider_message_id","recipient","event");--> statement-breakpoint
CREATE INDEX "email_bounces_occurred_idx" ON "email_bounces" ("occurred_at");--> statement-breakpoint
CREATE INDEX "email_bounces_recipient_idx" ON "email_bounces" ("recipient");--> statement-breakpoint
CREATE INDEX "email_bounces_sent_by_idx" ON "email_bounces" ("sent_by_person_id");--> statement-breakpoint
CREATE INDEX "inbound_messages_person_id_idx" ON "inbound_messages" ("person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "inbound_messages_channel_provider_message_unique" ON "inbound_messages" ("channel","provider_message_id");--> statement-breakpoint
CREATE INDEX "inbound_messages_shop_received_idx" ON "inbound_messages" ("shop_id","received_at") WHERE "deleted_at" is null;--> statement-breakpoint
CREATE INDEX "inbound_messages_shop_unanswered_idx" ON "inbound_messages" ("shop_id") WHERE "deleted_at" is null and "answered_at" is null;--> statement-breakpoint
CREATE INDEX "inbound_messages_shop_person_received_idx" ON "inbound_messages" ("shop_id","person_id","received_at");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_deliveries_once_only_unique" ON "notification_deliveries" ("booking_id","kind") WHERE "kind" in ('booking_confirmation', 'trip_reminder_7d', 'trip_reminder_24h', 'trip_recap') and "superseded_at" is null;--> statement-breakpoint
CREATE INDEX "notification_deliveries_booking_kind_attempted_idx" ON "notification_deliveries" ("booking_id","kind","attempted_at");--> statement-breakpoint
CREATE INDEX "notification_deliveries_shop_status_attempted_idx" ON "notification_deliveries" ("shop_id","status","attempted_at");--> statement-breakpoint
CREATE INDEX "notification_deliveries_provider_message_idx" ON "notification_deliveries" ("provider_message_id");--> statement-breakpoint
CREATE INDEX "notification_send_queue_due_idx" ON "notification_send_queue" ("status","next_attempt_at","locked_until");--> statement-breakpoint
CREATE INDEX "notification_send_queue_shop_status_idx" ON "notification_send_queue" ("shop_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "push_subscriptions_endpoint_trip_unique" ON "push_subscriptions" ("endpoint","trip_id");--> statement-breakpoint
CREATE INDEX "push_subscriptions_trip_pushed_idx" ON "push_subscriptions" ("trip_id","last_pushed_at");--> statement-breakpoint
CREATE INDEX "push_subscriptions_created_at_idx" ON "push_subscriptions" ("created_at");--> statement-breakpoint
CREATE INDEX "shop_contact_email_confirmation_tokens_shop_idx" ON "shop_contact_email_confirmation_tokens" ("shop_id");--> statement-breakpoint
CREATE UNIQUE INDEX "shop_whatsapp_accounts_phone_number_unique" ON "shop_whatsapp_accounts" ("phone_number_id");--> statement-breakpoint
CREATE INDEX "shop_whatsapp_accounts_waba_idx" ON "shop_whatsapp_accounts" ("waba_id");--> statement-breakpoint
CREATE INDEX "staff_replies_person_id_idx" ON "staff_replies" ("person_id");--> statement-breakpoint
CREATE INDEX "staff_replies_shop_person_sent_idx" ON "staff_replies" ("shop_id","person_id","sent_at");--> statement-breakpoint
CREATE INDEX "staff_replies_inbound_message_idx" ON "staff_replies" ("inbound_message_id");--> statement-breakpoint
CREATE UNIQUE INDEX "whatsapp_delivered_usage_message_unique" ON "whatsapp_delivered_usage" ("shop_id","phone_number_id","message_fingerprint");--> statement-breakpoint
CREATE INDEX "whatsapp_delivered_usage_window_idx" ON "whatsapp_delivered_usage" ("shop_id","delivered_at");--> statement-breakpoint
CREATE INDEX "whatsapp_delivered_usage_retention_idx" ON "whatsapp_delivered_usage" ("delivered_at");--> statement-breakpoint
CREATE INDEX "account_passkey_challenges_expiry_idx" ON "account_passkey_challenges" ("expires_at");--> statement-breakpoint
CREATE INDEX "account_passkeys_live_account_idx" ON "account_passkeys" ("user_account_id") WHERE "deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "booking_checkout_bookings_checkout_booking_unique" ON "booking_checkout_bookings" ("checkout_id","booking_id");--> statement-breakpoint
CREATE INDEX "booking_checkout_bookings_booking_idx" ON "booking_checkout_bookings" ("booking_id");--> statement-breakpoint
CREATE UNIQUE INDEX "booking_checkouts_stripe_session_unique" ON "booking_checkouts" ("stripe_session_id");--> statement-breakpoint
CREATE INDEX "booking_checkouts_stripe_payment_intent_idx" ON "booking_checkouts" ("stripe_payment_intent_id");--> statement-breakpoint
CREATE INDEX "booking_checkouts_shop_trip_idx" ON "booking_checkouts" ("shop_id","trip_id");--> statement-breakpoint
CREATE INDEX "booking_checkouts_recovery_scan_idx" ON "booking_checkouts" ("created_at") WHERE "status" = 'pending' and "abandoned_recovery_sent_at" is null;--> statement-breakpoint
CREATE INDEX "booking_payment_events_shop_booking_newest_idx" ON "booking_payment_events" ("shop_id","booking_id","occurred_at","seq");--> statement-breakpoint
CREATE INDEX "deals_shop_created_idx" ON "deals" ("shop_id","created_at");--> statement-breakpoint
CREATE INDEX "deals_trip_created_idx" ON "deals" ("trip_id","created_at") WHERE "trip_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "deals_shop_code_unique" ON "deals" ("shop_id","code");--> statement-breakpoint
CREATE INDEX "dive_package_entitlements_person_idx" ON "dive_package_entitlements" ("shop_id","person_id") WHERE "consumed_at" is null;--> statement-breakpoint
CREATE INDEX "dive_package_entitlements_order_idx" ON "dive_package_entitlements" ("order_id");--> statement-breakpoint
CREATE INDEX "dive_package_entitlements_booking_idx" ON "dive_package_entitlements" ("booking_id");--> statement-breakpoint
CREATE INDEX "dive_packages_shop_idx" ON "dive_packages" ("shop_id","created_at") WHERE "deleted_at" is null;--> statement-breakpoint
CREATE INDEX "imported_payment_history_shop_person_idx" ON "imported_payment_history" ("shop_id","person_id","occurred_on");--> statement-breakpoint
CREATE INDEX "imported_payment_history_shop_date_idx" ON "imported_payment_history" ("shop_id","occurred_on");--> statement-breakpoint
CREATE INDEX "imported_payment_history_shop_currency_direction_idx" ON "imported_payment_history" ("shop_id","currency","direction","occurred_on");--> statement-breakpoint
CREATE UNIQUE INDEX "imported_payment_history_shop_person_dedupe_unique" ON "imported_payment_history" ("shop_id","person_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "order_line_items_order_idx" ON "order_line_items" ("order_id");--> statement-breakpoint
CREATE INDEX "orders_person_id_idx" ON "orders" ("person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_stripe_invoice_unique" ON "orders" ("stripe_invoice_id");--> statement-breakpoint
CREATE INDEX "orders_stripe_payment_intent_idx" ON "orders" ("stripe_payment_intent_id");--> statement-breakpoint
CREATE INDEX "orders_shop_status_idx" ON "orders" ("shop_id","status");--> statement-breakpoint
CREATE INDEX "orders_shop_booking_idx" ON "orders" ("shop_id","booking_id");--> statement-breakpoint
CREATE INDEX "orders_shop_person_idx" ON "orders" ("shop_id","person_id");--> statement-breakpoint
CREATE INDEX "orders_description_trgm_idx" ON "orders" USING gin ("description" gin_trgm_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "package_gifts_order_unique" ON "package_gifts" ("order_id");--> statement-breakpoint
CREATE INDEX "package_gifts_person_idx" ON "package_gifts" ("person_id");--> statement-breakpoint
CREATE INDEX "package_gifts_unsent_idx" ON "package_gifts" ("send_on") WHERE "sent_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "payment_disputes_stripe_dispute_unique" ON "payment_disputes" ("stripe_dispute_id");--> statement-breakpoint
CREATE INDEX "payment_disputes_shop_open_idx" ON "payment_disputes" ("shop_id","evidence_due_by") WHERE "closed_at" is null;--> statement-breakpoint
CREATE INDEX "payment_disputes_shop_order_idx" ON "payment_disputes" ("shop_id","order_id");--> statement-breakpoint
CREATE INDEX "payment_operation_intents_shop_status_idx" ON "payment_operation_intents" ("shop_id","status");--> statement-breakpoint
CREATE INDEX "payment_operation_intents_stripe_object_idx" ON "payment_operation_intents" ("stripe_object_id") WHERE "stripe_object_id" is not null;--> statement-breakpoint
CREATE INDEX "payment_operation_intents_booking_idx" ON "payment_operation_intents" ("booking_id") WHERE "booking_id" is not null;--> statement-breakpoint
CREATE INDEX "payment_operation_intents_order_idx" ON "payment_operation_intents" ("order_id") WHERE "order_id" is not null;--> statement-breakpoint
CREATE INDEX "payment_operation_intents_stale_scan_idx" ON "payment_operation_intents" ("kind","started_at") WHERE "status" = 'started';--> statement-breakpoint
CREATE UNIQUE INDEX "shop_stripe_accounts_stripe_account_unique" ON "shop_stripe_accounts" ("stripe_account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "stripe_payouts_stripe_payout_unique" ON "stripe_payouts" ("stripe_payout_id");--> statement-breakpoint
CREATE INDEX "stripe_payouts_shop_arrival_idx" ON "stripe_payouts" ("shop_id","arrival_date") WHERE "deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "stripe_refund_failures_refund_unique" ON "stripe_refund_failures" ("stripe_refund_id");--> statement-breakpoint
CREATE INDEX "stripe_refund_failures_shop_idx" ON "stripe_refund_failures" ("shop_id","failed_at");--> statement-breakpoint
CREATE INDEX "stripe_webhook_events_account_type_idx" ON "stripe_webhook_events" ("account","type","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "recovery_activities_shop_id_id_unique" ON "recovery_activities" ("shop_id","id");--> statement-breakpoint
CREATE INDEX "recovery_activities_blowout_idx" ON "recovery_activities" ("shop_id","blowout_id");--> statement-breakpoint
CREATE INDEX "recovery_activities_coordinator_idx" ON "recovery_activities" ("coordinator_person_id","shop_id");--> statement-breakpoint
CREATE INDEX "recovery_activities_created_by_idx" ON "recovery_activities" ("created_by_person_id","shop_id");--> statement-breakpoint
CREATE INDEX "recovery_activities_arrangements_by_idx" ON "recovery_activities" ("arrangements_confirmed_by_person_id","shop_id");--> statement-breakpoint
CREATE INDEX "recovery_activity_events_actor_idx" ON "recovery_activity_events" ("actor_person_id","shop_id");--> statement-breakpoint
CREATE INDEX "recovery_activity_offers_actor_idx" ON "recovery_activity_offers" ("actor_person_id","shop_id");--> statement-breakpoint
CREATE UNIQUE INDEX "recovery_activity_offers_activity_diver_unique" ON "recovery_activity_offers" ("shop_id","activity_id","blowout_diver_id");--> statement-breakpoint
CREATE INDEX "recovery_activity_participants_person_idx" ON "recovery_activity_participants" ("person_id","shop_id");--> statement-breakpoint
CREATE INDEX "recovery_activity_participants_confirmed_by_idx" ON "recovery_activity_participants" ("confirmed_by_person_id","shop_id");--> statement-breakpoint
CREATE UNIQUE INDEX "recovery_activity_participants_shop_id_id_unique" ON "recovery_activity_participants" ("shop_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "recovery_activity_participants_person_unique" ON "recovery_activity_participants" ("shop_id","activity_id","person_id") WHERE "status" = 'confirmed';--> statement-breakpoint
CREATE UNIQUE INDEX "recovery_activity_participants_source_unique" ON "recovery_activity_participants" ("shop_id","activity_id","blowout_diver_id");--> statement-breakpoint
CREATE INDEX "recap_photos_booking_idx" ON "recap_photos" ("booking_id","created_at");--> statement-breakpoint
CREATE INDEX "recap_photos_trip_idx" ON "recap_photos" ("trip_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "recap_pulses_booking_live_unique" ON "recap_pulses" ("booking_id") WHERE "deleted_at" is null;--> statement-breakpoint
CREATE INDEX "recap_pulses_person_idx" ON "recap_pulses" ("person_id");--> statement-breakpoint
CREATE INDEX "recap_pulses_shop_open_idx" ON "recap_pulses" ("shop_id","created_at") WHERE "addressed_at" is null and "deleted_at" is null;--> statement-breakpoint
CREATE INDEX "review_moderation_events_shop_idx" ON "review_moderation_events" ("shop_id","occurred_at");--> statement-breakpoint
CREATE INDEX "review_moderation_events_review_idx" ON "review_moderation_events" ("review_id");--> statement-breakpoint
CREATE UNIQUE INDEX "review_replies_review_live_unique" ON "review_replies" ("review_id") WHERE "deleted_at" is null;--> statement-breakpoint
CREATE INDEX "review_replies_shop_idx" ON "review_replies" ("shop_id");--> statement-breakpoint
CREATE INDEX "trip_recap_photos_shop_trip_idx" ON "trip_recap_photos" ("shop_id","trip_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "trip_reviews_booking_unique" ON "trip_reviews" ("booking_id");--> statement-breakpoint
CREATE INDEX "trip_reviews_crew_thanks_idx" ON "trip_reviews" ("crew_thanks_person_id","shop_id","created_at") WHERE "crew_thanks_person_id" is not null;--> statement-breakpoint
CREATE INDEX "trip_reviews_shop_published_idx" ON "trip_reviews" ("shop_id","published_at") WHERE "is_published";--> statement-breakpoint
CREATE INDEX "trip_reviews_shop_created_idx" ON "trip_reviews" ("shop_id","created_at");--> statement-breakpoint
CREATE INDEX "trip_reviews_shop_person_idx" ON "trip_reviews" ("shop_id","person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "trip_credit_entries_scoped_id_unique" ON "trip_credit_entries" ("shop_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "trip_credit_entries_restore_once" ON "trip_credit_entries" ("restores_entry_id");--> statement-breakpoint
CREATE INDEX "trip_credit_entries_person_idx" ON "trip_credit_entries" ("person_id","shop_id");--> statement-breakpoint
CREATE INDEX "trip_credit_entries_actor_idx" ON "trip_credit_entries" ("actor_person_id","shop_id");--> statement-breakpoint
CREATE INDEX "trip_credit_entries_balance_idx" ON "trip_credit_entries" ("shop_id","person_id","currency","seq");--> statement-breakpoint
CREATE INDEX "trip_credit_entries_booking_idx" ON "trip_credit_entries" ("shop_id","booking_id");--> statement-breakpoint
CREATE INDEX "boats_shop_id_idx" ON "boats" ("shop_id");--> statement-breakpoint
CREATE INDEX "boats_shop_live_idx" ON "boats" ("shop_id") WHERE "deleted_at" is null;--> statement-breakpoint
CREATE INDEX "executed_dives_recorded_by_person_id_idx" ON "executed_dives" ("recorded_by_person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "executed_dives_trip_number_live_unique" ON "executed_dives" ("trip_id","dive_number") WHERE "deleted_at" is null;--> statement-breakpoint
CREATE INDEX "executed_dives_shop_trip_idx" ON "executed_dives" ("shop_id","trip_id","dive_number");--> statement-breakpoint
CREATE UNIQUE INDEX "trip_dives_trip_number_unique" ON "trip_dives" ("trip_id","dive_number");--> statement-breakpoint
CREATE INDEX "trip_dives_dive_site_idx" ON "trip_dives" ("dive_site_id");--> statement-breakpoint
CREATE INDEX "trip_lenses_shop_live_idx" ON "trip_lenses" ("shop_id","created_at") WHERE "deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "trip_lenses_shop_slug_key" ON "trip_lenses" ("shop_id","slug") WHERE "deleted_at" is null;--> statement-breakpoint
CREATE INDEX "trip_requirements_shop_idx" ON "trip_requirements" ("shop_id");--> statement-breakpoint
CREATE UNIQUE INDEX "trip_schedule_days_trip_day_unique" ON "trip_schedule_days" ("trip_id","day_number");--> statement-breakpoint
CREATE INDEX "trip_schedule_days_trip_starts_idx" ON "trip_schedule_days" ("trip_id","starts_at");--> statement-breakpoint
CREATE INDEX "trip_series_shop_idx" ON "trip_series" ("shop_id");--> statement-breakpoint
CREATE INDEX "trip_series_roll_queue_idx" ON "trip_series" ("last_rolled_at");--> statement-breakpoint
CREATE UNIQUE INDEX "trip_series_skips_slot_idx" ON "trip_series_skips" ("series_id","occurrence_date");--> statement-breakpoint
CREATE INDEX "trip_series_skips_shop_idx" ON "trip_series_skips" ("shop_id");--> statement-breakpoint
CREATE UNIQUE INDEX "trip_sightings_trip_site_species_live_unique" ON "trip_sightings" ("trip_id","dive_site_id","species_slug") WHERE "deleted_at" is null;--> statement-breakpoint
CREATE INDEX "trip_sightings_shop_trip_idx" ON "trip_sightings" ("shop_id","trip_id");--> statement-breakpoint
CREATE INDEX "trip_sightings_site_recorded_idx" ON "trip_sightings" ("dive_site_id","recorded_at");--> statement-breakpoint
CREATE UNIQUE INDEX "trips_shop_id_id_unique" ON "trips" ("shop_id","id");--> statement-breakpoint
CREATE INDEX "trips_shop_starts_idx" ON "trips" ("shop_id","starts_at");--> statement-breakpoint
CREATE INDEX "trips_series_starts_idx" ON "trips" ("series_id","starts_at");--> statement-breakpoint
CREATE INDEX "trips_course_starts_idx" ON "trips" ("course_id","starts_at");--> statement-breakpoint
CREATE INDEX "trips_boat_starts_idx" ON "trips" ("boat_id","starts_at");--> statement-breakpoint
CREATE INDEX "trips_shop_live_starts_idx" ON "trips" ("shop_id","starts_at") WHERE "deleted_at" is null;--> statement-breakpoint
CREATE INDEX "trips_status_starts_idx" ON "trips" ("status","starts_at");--> statement-breakpoint
CREATE INDEX "trips_status_ends_idx" ON "trips" ("status","ends_at");--> statement-breakpoint
CREATE INDEX "trips_title_trgm_idx" ON "trips" USING gin ("title" gin_trgm_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "waiver_deliveries_record_channel_unique" ON "waiver_deliveries" ("waiver_record_id","channel");--> statement-breakpoint
CREATE INDEX "waiver_deliveries_provider_message_idx" ON "waiver_deliveries" ("provider_message_id");--> statement-breakpoint
CREATE INDEX "waiver_deliveries_shop_record_idx" ON "waiver_deliveries" ("shop_id","waiver_record_id");--> statement-breakpoint
CREATE INDEX "waiver_drafts_shop_idx" ON "waiver_drafts" ("shop_id");--> statement-breakpoint
CREATE INDEX "waiver_materiality_decisions_shop_idx" ON "waiver_materiality_decisions" ("shop_id","template_id");--> statement-breakpoint
CREATE INDEX "waiver_records_person_id_idx" ON "waiver_records" ("person_id");--> statement-breakpoint
CREATE INDEX "waiver_records_booking_current_idx" ON "waiver_records" ("booking_id","superseded_at");--> statement-breakpoint
CREATE INDEX "waiver_records_shop_status_idx" ON "waiver_records" ("shop_id","status");--> statement-breakpoint
CREATE INDEX "waiver_records_shop_person_status_idx" ON "waiver_records" ("shop_id","person_id","status");--> statement-breakpoint
CREATE INDEX "waiver_records_integrity_checked_idx" ON "waiver_records" ("integrity_checked_at") WHERE "integrity_hash" is not null and "integrity_version" is not null;--> statement-breakpoint
CREATE INDEX "waiver_seal_acknowledgements_record_idx" ON "waiver_seal_acknowledgements" ("shop_id","waiver_record_id");--> statement-breakpoint
CREATE INDEX "waiver_seal_acknowledgements_by_idx" ON "waiver_seal_acknowledgements" ("acknowledged_by_person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "waiver_templates_shop_version_unique" ON "waiver_templates" ("shop_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "wallet_registrations_live_device_idx" ON "wallet_pass_registrations" ("pass_id","device_library_identifier") WHERE "deleted_at" is null;--> statement-breakpoint
CREATE INDEX "wallet_registrations_shop_idx" ON "wallet_pass_registrations" ("shop_id");--> statement-breakpoint
CREATE UNIQUE INDEX "wallet_passes_live_booking_platform_idx" ON "wallet_passes" ("booking_id","platform") WHERE "deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "wallet_passes_shop_id_id_idx" ON "wallet_passes" ("shop_id","id");--> statement-breakpoint
CREATE INDEX "wallet_passes_shop_idx" ON "wallet_passes" ("shop_id");--> statement-breakpoint
CREATE UNIQUE INDEX "weekly_digest_sends_person_week_unique" ON "weekly_digest_sends" ("person_id","week_of");--> statement-breakpoint
CREATE INDEX "weekly_digest_sends_created_at_idx" ON "weekly_digest_sends" ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_gear_notices_ready_once" ON "customer_gear_notices" ("work_order_event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_gear_notices_reminder_once" ON "customer_gear_notices" ("customer_gear_item_id","due_clock","due_on");--> statement-breakpoint
CREATE INDEX "customer_gear_notices_order_idx" ON "customer_gear_notices" ("work_order_id","seq");--> statement-breakpoint
CREATE INDEX "customer_gear_notices_item_idx" ON "customer_gear_notices" ("customer_gear_item_id","seq");--> statement-breakpoint
CREATE INDEX "customer_gear_notices_shop_idx" ON "customer_gear_notices" ("shop_id");--> statement-breakpoint
CREATE INDEX "customer_gear_notices_person_idx" ON "customer_gear_notices" ("person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_gear_reminder_settings_item_unique" ON "customer_gear_reminder_settings" ("customer_gear_item_id");--> statement-breakpoint
CREATE INDEX "customer_gear_reminder_settings_shop_off_idx" ON "customer_gear_reminder_settings" ("shop_id") WHERE "reminders_off_at" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "work_order_bills_order_unique" ON "work_order_bills" ("order_id");--> statement-breakpoint
CREATE INDEX "work_order_bills_work_order_idx" ON "work_order_bills" ("work_order_id","seq");--> statement-breakpoint
CREATE INDEX "work_order_bills_shop_idx" ON "work_order_bills" ("shop_id");--> statement-breakpoint
CREATE INDEX "customer_gear_items_shop_person_idx" ON "customer_gear_items" ("shop_id","person_id") WHERE "deleted_at" is null;--> statement-breakpoint
CREATE INDEX "customer_gear_items_shop_due_idx" ON "customer_gear_items" ("shop_id","service_due_on") WHERE "deleted_at" is null;--> statement-breakpoint
CREATE INDEX "work_order_care_order_idx" ON "work_order_care" ("work_order_id");--> statement-breakpoint
CREATE INDEX "work_order_care_shop_idx" ON "work_order_care" ("shop_id");--> statement-breakpoint
CREATE INDEX "work_order_events_order_idx" ON "work_order_events" ("work_order_id","seq");--> statement-breakpoint
CREATE INDEX "work_order_events_shop_idx" ON "work_order_events" ("shop_id");--> statement-breakpoint
CREATE UNIQUE INDEX "work_order_items_unique" ON "work_order_items" ("work_order_id","customer_gear_item_id");--> statement-breakpoint
CREATE INDEX "work_order_items_item_idx" ON "work_order_items" ("customer_gear_item_id");--> statement-breakpoint
CREATE INDEX "work_order_items_shop_idx" ON "work_order_items" ("shop_id");--> statement-breakpoint
CREATE INDEX "work_order_lines_order_idx" ON "work_order_lines" ("work_order_id","created_at") WHERE "deleted_at" is null;--> statement-breakpoint
CREATE INDEX "work_order_lines_shop_idx" ON "work_order_lines" ("shop_id");--> statement-breakpoint
CREATE INDEX "work_orders_shop_status_idx" ON "work_orders" ("shop_id","status") WHERE "deleted_at" is null;--> statement-breakpoint
CREATE INDEX "work_orders_shop_person_idx" ON "work_orders" ("shop_id","person_id") WHERE "deleted_at" is null;--> statement-breakpoint
CREATE INDEX "work_orders_shop_gear_item_idx" ON "work_orders" ("shop_id","gear_item_id") WHERE "deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "work_orders_shop_number_unique" ON "work_orders" ("shop_id","number");--> statement-breakpoint
ALTER TABLE "account_security" ADD CONSTRAINT "account_security_user_account_id_user_accounts_id_fkey" FOREIGN KEY ("user_account_id") REFERENCES "user_accounts"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "account_sessions" ADD CONSTRAINT "account_sessions_user_account_id_user_accounts_id_fkey" FOREIGN KEY ("user_account_id") REFERENCES "user_accounts"("id");--> statement-breakpoint
ALTER TABLE "account_sessions" ADD CONSTRAINT "account_sessions_person_id_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "account_sessions" ADD CONSTRAINT "account_sessions_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "account_sign_in_challenges" ADD CONSTRAINT "account_sign_in_challenges_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "account_sign_in_challenges" ADD CONSTRAINT "account_sign_in_challenges_daJGGk9AeHDX_fkey" FOREIGN KEY ("user_account_id") REFERENCES "user_accounts"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "account_step_ups" ADD CONSTRAINT "account_step_ups_user_account_id_user_accounts_id_fkey" FOREIGN KEY ("user_account_id") REFERENCES "user_accounts"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "account_step_ups" ADD CONSTRAINT "account_step_ups_account_session_id_account_sessions_id_fkey" FOREIGN KEY ("account_session_id") REFERENCES "account_sessions"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "auth_provider_accounts" ADD CONSTRAINT "auth_provider_accounts_user_account_id_user_accounts_id_fkey" FOREIGN KEY ("user_account_id") REFERENCES "user_accounts"("id");--> statement-breakpoint
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_trip_id_trips_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_booking_id_bookings_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_actor_person_id_people_id_fkey" FOREIGN KEY ("actor_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_subject_person_id_people_id_fkey" FOREIGN KEY ("subject_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_order_id_orders_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "dive_not_made_events" ADD CONSTRAINT "dive_not_made_events_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "dive_not_made_events" ADD CONSTRAINT "dive_not_made_events_trip_id_trips_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "dive_not_made_events" ADD CONSTRAINT "dive_not_made_events_recorded_by_person_id_people_id_fkey" FOREIGN KEY ("recorded_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "form_drafts" ADD CONSTRAINT "form_drafts_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "form_drafts" ADD CONSTRAINT "form_drafts_person_id_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "internal_notes" ADD CONSTRAINT "internal_notes_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "internal_notes" ADD CONSTRAINT "internal_notes_person_id_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "internal_notes" ADD CONSTRAINT "internal_notes_booking_id_bookings_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "internal_notes" ADD CONSTRAINT "internal_notes_created_by_person_id_people_id_fkey" FOREIGN KEY ("created_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "internal_notes" ADD CONSTRAINT "internal_notes_deleted_by_person_id_people_id_fkey" FOREIGN KEY ("deleted_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "today_read_mark_events" ADD CONSTRAINT "today_read_mark_events_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "today_read_mark_events" ADD CONSTRAINT "today_read_mark_events_mark_id_today_read_marks_id_fkey" FOREIGN KEY ("mark_id") REFERENCES "today_read_marks"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "today_read_mark_events" ADD CONSTRAINT "today_read_mark_events_event_id_activity_events_id_fkey" FOREIGN KEY ("event_id") REFERENCES "activity_events"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "today_read_mark_events" ADD CONSTRAINT "today_read_mark_events_shop_mark_fk" FOREIGN KEY ("shop_id","mark_id") REFERENCES "today_read_marks"("shop_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "today_read_mark_events" ADD CONSTRAINT "today_read_mark_events_shop_event_fk" FOREIGN KEY ("shop_id","event_id") REFERENCES "activity_events"("shop_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "today_read_marks" ADD CONSTRAINT "today_read_marks_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "today_read_marks" ADD CONSTRAINT "today_read_marks_person_id_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "trip_change_events" ADD CONSTRAINT "trip_change_events_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "trip_change_events" ADD CONSTRAINT "trip_change_events_trip_id_trips_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "trip_change_events" ADD CONSTRAINT "trip_change_events_actor_person_id_people_id_fkey" FOREIGN KEY ("actor_person_id") REFERENCES "people"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "trip_read_marks" ADD CONSTRAINT "trip_read_marks_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "trip_read_marks" ADD CONSTRAINT "trip_read_marks_trip_id_trips_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "trip_read_marks" ADD CONSTRAINT "trip_read_marks_person_id_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "trip_stage_events" ADD CONSTRAINT "trip_stage_events_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "trip_stage_events" ADD CONSTRAINT "trip_stage_events_trip_id_trips_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "trip_stage_events" ADD CONSTRAINT "trip_stage_events_dive_site_id_dive_sites_id_fkey" FOREIGN KEY ("dive_site_id") REFERENCES "dive_sites"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "trip_stage_events" ADD CONSTRAINT "trip_stage_events_recorded_by_person_id_people_id_fkey" FOREIGN KEY ("recorded_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "assist_results" ADD CONSTRAINT "assist_results_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "claude_call_content" ADD CONSTRAINT "claude_call_content_usage_id_claude_usage_id_fkey" FOREIGN KEY ("usage_id") REFERENCES "claude_usage"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "claude_call_content" ADD CONSTRAINT "claude_call_content_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "claude_call_content_erasures" ADD CONSTRAINT "claude_call_content_erasures_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "claude_usage" ADD CONSTRAINT "claude_usage_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "shop_text_translations" ADD CONSTRAINT "shop_text_translations_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "collection_entries" ADD CONSTRAINT "collection_entries_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "collection_entries" ADD CONSTRAINT "collection_entries_reversal_shop_fk" FOREIGN KEY ("shop_id","reverses_entry_id") REFERENCES "collection_entries"("shop_id","id");--> statement-breakpoint
ALTER TABLE "pricing_volume_statements" ADD CONSTRAINT "pricing_volume_statements_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "shop_subscriptions" ADD CONSTRAINT "shop_subscriptions_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "booking_capabilities" ADD CONSTRAINT "booking_capabilities_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "booking_capabilities" ADD CONSTRAINT "booking_capabilities_booking_id_bookings_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id");--> statement-breakpoint
ALTER TABLE "booking_referrals" ADD CONSTRAINT "booking_referrals_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "booking_referrals" ADD CONSTRAINT "booking_referrals_booking_id_bookings_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id");--> statement-breakpoint
ALTER TABLE "booking_referrals" ADD CONSTRAINT "booking_referrals_referred_by_booking_id_bookings_id_fkey" FOREIGN KEY ("referred_by_booking_id") REFERENCES "bookings"("id");--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_person_id_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_fly_safe_acknowledged_by_person_id_people_id_fkey" FOREIGN KEY ("fly_safe_acknowledged_by_person_id") REFERENCES "people"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_course_next_step_by_person_id_people_id_fkey" FOREIGN KEY ("course_next_step_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_course_followup_by_person_id_people_id_fkey" FOREIGN KEY ("course_followup_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_course_materials_done_by_person_id_people_id_fkey" FOREIGN KEY ("course_materials_done_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_referred_in_by_person_id_people_id_fkey" FOREIGN KEY ("referred_in_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_referral_form_by_person_id_people_id_fkey" FOREIGN KEY ("referral_form_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_referral_record_by_person_id_people_id_fkey" FOREIGN KEY ("referral_record_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_training_marked_by_person_id_people_id_fkey" FOREIGN KEY ("training_marked_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_training_plan_instructor_person_id_people_id_fkey" FOREIGN KEY ("training_plan_instructor_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_training_plan_by_person_id_people_id_fkey" FOREIGN KEY ("training_plan_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_training_cleared_by_person_id_people_id_fkey" FOREIGN KEY ("training_cleared_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_trip_shop_fk" FOREIGN KEY ("shop_id","trip_id") REFERENCES "trips"("shop_id","id");--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_training_enrollment_fk" FOREIGN KEY ("shop_id","training_enrollment_booking_id") REFERENCES "bookings"("shop_id","id");--> statement-breakpoint
ALTER TABLE "trip_help_requests" ADD CONSTRAINT "trip_help_requests_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "trip_help_requests" ADD CONSTRAINT "trip_help_requests_trip_id_trips_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "trip_help_requests" ADD CONSTRAINT "trip_help_requests_booking_id_bookings_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "trip_help_requests" ADD CONSTRAINT "trip_help_requests_helper_person_id_people_id_fkey" FOREIGN KEY ("helper_person_id") REFERENCES "people"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "trip_help_requests" ADD CONSTRAINT "trip_help_requests_resolved_by_person_id_people_id_fkey" FOREIGN KEY ("resolved_by_person_id") REFERENCES "people"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "capabilities" ADD CONSTRAINT "capabilities_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "capabilities" ADD CONSTRAINT "capabilities_person_id_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "capabilities" ADD CONSTRAINT "capabilities_user_account_id_user_accounts_id_fkey" FOREIGN KEY ("user_account_id") REFERENCES "user_accounts"("id");--> statement-breakpoint
ALTER TABLE "capabilities" ADD CONSTRAINT "capabilities_setup_request_id_setup_requests_id_fkey" FOREIGN KEY ("setup_request_id") REFERENCES "setup_requests"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "capabilities" ADD CONSTRAINT "capabilities_spent_by_shop_id_shops_id_fkey" FOREIGN KEY ("spent_by_shop_id") REFERENCES "shops"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "capabilities" ADD CONSTRAINT "capabilities_waiver_record_id_waiver_records_id_fkey" FOREIGN KEY ("waiver_record_id") REFERENCES "waiver_records"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "capabilities" ADD CONSTRAINT "capabilities_shop_interest_fkey" FOREIGN KEY ("shop_id","interest_id") REFERENCES "interests"("shop_id","id");--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_person_id_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_reviewed_by_person_id_people_id_fkey" FOREIGN KEY ("reviewed_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_issued_from_trip_id_trips_id_fkey" FOREIGN KEY ("issued_from_trip_id") REFERENCES "trips"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_issued_by_person_id_people_id_fkey" FOREIGN KEY ("issued_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_processed_by_person_id_people_id_fkey" FOREIGN KEY ("processed_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_listed_from_certification_id_cards_id_fkey" FOREIGN KEY ("listed_from_certification_id") REFERENCES "cards"("id");--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_junior_status_verified_by_person_id_people_id_fkey" FOREIGN KEY ("junior_status_verified_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_deleted_by_person_id_people_id_fkey" FOREIGN KEY ("deleted_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "certification_junior_reviews" ADD CONSTRAINT "certification_junior_reviews_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "certification_junior_reviews" ADD CONSTRAINT "certification_junior_reviews_certification_id_cards_id_fkey" FOREIGN KEY ("certification_id") REFERENCES "cards"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "certification_junior_reviews" ADD CONSTRAINT "certification_junior_reviews_person_id_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "certification_junior_reviews" ADD CONSTRAINT "certification_junior_reviews_XBkZaqg9nyJ5_fkey" FOREIGN KEY ("recorded_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "prior_visits" ADD CONSTRAINT "prior_visits_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "prior_visits" ADD CONSTRAINT "prior_visits_person_id_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "computer_dive_profiles" ADD CONSTRAINT "computer_dive_profiles_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "computer_dive_profiles" ADD CONSTRAINT "computer_dive_profiles_person_id_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "computer_dive_profiles" ADD CONSTRAINT "computer_dive_profiles_dive_id_computer_dives_id_fkey" FOREIGN KEY ("dive_id") REFERENCES "computer_dives"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "computer_dives" ADD CONSTRAINT "computer_dives_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "computer_dives" ADD CONSTRAINT "computer_dives_person_id_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "computer_dives" ADD CONSTRAINT "computer_dives_batch_id_computer_import_batches_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "computer_import_batches"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "computer_import_batches" ADD CONSTRAINT "computer_import_batches_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "computer_import_batches" ADD CONSTRAINT "computer_import_batches_person_id_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "trip_conservation" ADD CONSTRAINT "trip_conservation_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "trip_conservation" ADD CONSTRAINT "trip_conservation_trip_id_trips_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id");--> statement-breakpoint
ALTER TABLE "trip_conservation" ADD CONSTRAINT "trip_conservation_recorded_by_person_id_people_id_fkey" FOREIGN KEY ("recorded_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_anonymized_by_person_id_people_id_fkey" FOREIGN KEY ("anonymized_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_merged_into_person_id_people_id_fkey" FOREIGN KEY ("merged_into_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_merged_by_person_id_people_id_fkey" FOREIGN KEY ("merged_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "person_roles" ADD CONSTRAINT "person_roles_person_id_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "user_accounts" ADD CONSTRAINT "user_accounts_person_id_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "course_form_records" ADD CONSTRAINT "course_form_records_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "course_form_records" ADD CONSTRAINT "course_form_records_booking_id_bookings_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id");--> statement-breakpoint
ALTER TABLE "course_form_records" ADD CONSTRAINT "course_form_records_person_id_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "course_form_records" ADD CONSTRAINT "course_form_records_form_id_course_forms_id_fkey" FOREIGN KEY ("form_id") REFERENCES "course_forms"("id");--> statement-breakpoint
ALTER TABLE "course_form_records" ADD CONSTRAINT "course_form_records_Ynzi8aSsVWKW_fkey" FOREIGN KEY ("form_version_id") REFERENCES "course_form_versions"("id");--> statement-breakpoint
ALTER TABLE "course_form_records" ADD CONSTRAINT "course_form_records_trip_id_trips_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id");--> statement-breakpoint
ALTER TABLE "course_form_records" ADD CONSTRAINT "course_form_records_signed_via_booking_id_bookings_id_fkey" FOREIGN KEY ("signed_via_booking_id") REFERENCES "bookings"("id");--> statement-breakpoint
ALTER TABLE "course_form_records" ADD CONSTRAINT "course_form_records_recorded_by_person_id_people_id_fkey" FOREIGN KEY ("recorded_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "course_form_records" ADD CONSTRAINT "course_form_records_anonymized_by_person_id_people_id_fkey" FOREIGN KEY ("anonymized_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "course_form_requirements" ADD CONSTRAINT "course_form_requirements_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "course_form_requirements" ADD CONSTRAINT "course_form_requirements_course_id_courses_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id");--> statement-breakpoint
ALTER TABLE "course_form_requirements" ADD CONSTRAINT "course_form_requirements_form_id_course_forms_id_fkey" FOREIGN KEY ("form_id") REFERENCES "course_forms"("id");--> statement-breakpoint
ALTER TABLE "course_form_versions" ADD CONSTRAINT "course_form_versions_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "course_form_versions" ADD CONSTRAINT "course_form_versions_form_id_course_forms_id_fkey" FOREIGN KEY ("form_id") REFERENCES "course_forms"("id");--> statement-breakpoint
ALTER TABLE "course_form_versions" ADD CONSTRAINT "course_form_versions_created_by_person_id_people_id_fkey" FOREIGN KEY ("created_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "course_forms" ADD CONSTRAINT "course_forms_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "course_elearning_codes" ADD CONSTRAINT "course_elearning_codes_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "course_elearning_codes" ADD CONSTRAINT "course_elearning_codes_course_id_courses_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id");--> statement-breakpoint
ALTER TABLE "course_elearning_codes" ADD CONSTRAINT "course_elearning_codes_booking_id_bookings_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id");--> statement-breakpoint
ALTER TABLE "course_elearning_codes" ADD CONSTRAINT "course_elearning_codes_assigned_by_person_id_people_id_fkey" FOREIGN KEY ("assigned_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "course_session_progress" ADD CONSTRAINT "course_session_progress_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "course_session_progress" ADD CONSTRAINT "course_session_progress_person_id_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "course_session_progress" ADD CONSTRAINT "course_session_progress_course_id_courses_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id");--> statement-breakpoint
ALTER TABLE "course_session_progress" ADD CONSTRAINT "course_session_progress_done_by_person_id_people_id_fkey" FOREIGN KEY ("done_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "courses" ADD CONSTRAINT "courses_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "crew_assignment_requests" ADD CONSTRAINT "crew_assignment_requests_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "crew_assignment_requests" ADD CONSTRAINT "crew_assignment_requests_trip_id_trips_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id");--> statement-breakpoint
ALTER TABLE "crew_assignment_requests" ADD CONSTRAINT "crew_assignment_requests_person_id_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "crew_assignment_requests" ADD CONSTRAINT "crew_assignment_requests_decided_by_person_id_people_id_fkey" FOREIGN KEY ("decided_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "crew_availability_blocks" ADD CONSTRAINT "crew_availability_blocks_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "crew_availability_blocks" ADD CONSTRAINT "crew_availability_blocks_person_id_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "crew_availability_blocks" ADD CONSTRAINT "crew_availability_blocks_decided_by_person_id_people_id_fkey" FOREIGN KEY ("decided_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "crew_availability_blocks" ADD CONSTRAINT "crew_availability_blocks_created_by_person_id_people_id_fkey" FOREIGN KEY ("created_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "crew_away_acknowledgements" ADD CONSTRAINT "crew_away_acknowledgements_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "crew_away_acknowledgements" ADD CONSTRAINT "crew_away_acknowledgements_trip_id_trips_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "crew_away_acknowledgements" ADD CONSTRAINT "crew_away_acknowledgements_person_id_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "crew_away_acknowledgements" ADD CONSTRAINT "crew_away_acknowledgements_oKUw4tDQl1AB_fkey" FOREIGN KEY ("acknowledged_by_person_id") REFERENCES "people"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "crew_away_acknowledgements" ADD CONSTRAINT "crew_away_acknowledgements_cleared_by_person_id_people_id_fkey" FOREIGN KEY ("cleared_by_person_id") REFERENCES "people"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "crew_notices" ADD CONSTRAINT "crew_notices_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "crew_notices" ADD CONSTRAINT "crew_notices_person_id_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "crew_notices" ADD CONSTRAINT "crew_notices_trip_id_trips_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "crew_notices" ADD CONSTRAINT "crew_notices_actor_person_id_people_id_fkey" FOREIGN KEY ("actor_person_id") REFERENCES "people"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "staff_credential_history" ADD CONSTRAINT "staff_credential_history_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "staff_credential_history" ADD CONSTRAINT "staff_credential_history_32OPkfKC4FnJ_fkey" FOREIGN KEY ("credential_id") REFERENCES "staff_credentials"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "staff_credentials" ADD CONSTRAINT "staff_credentials_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "staff_credentials" ADD CONSTRAINT "staff_credentials_person_id_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "staff_credentials" ADD CONSTRAINT "staff_credentials_reviewed_by_person_id_people_id_fkey" FOREIGN KEY ("reviewed_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "staff_credentials" ADD CONSTRAINT "staff_credentials_deleted_by_person_id_people_id_fkey" FOREIGN KEY ("deleted_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "staff_shifts" ADD CONSTRAINT "staff_shifts_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "staff_shifts" ADD CONSTRAINT "staff_shifts_person_id_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "staff_shifts" ADD CONSTRAINT "staff_shifts_created_by_person_id_people_id_fkey" FOREIGN KEY ("created_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "trip_assignments" ADD CONSTRAINT "trip_assignments_trip_id_trips_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id");--> statement-breakpoint
ALTER TABLE "trip_assignments" ADD CONSTRAINT "trip_assignments_person_id_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "trip_assignments" ADD CONSTRAINT "trip_assignments_assigned_by_person_id_people_id_fkey" FOREIGN KEY ("assigned_by_person_id") REFERENCES "people"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "trip_assignments" ADD CONSTRAINT "trip_assignments_3aJnSAzIDZmj_fkey" FOREIGN KEY ("training_plan_instructor_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "trip_assignments" ADD CONSTRAINT "trip_assignments_training_plan_by_person_id_people_id_fkey" FOREIGN KEY ("training_plan_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "trip_series_crew" ADD CONSTRAINT "trip_series_crew_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "trip_series_crew" ADD CONSTRAINT "trip_series_crew_series_id_trip_series_id_fkey" FOREIGN KEY ("series_id") REFERENCES "trip_series"("id");--> statement-breakpoint
ALTER TABLE "trip_series_crew" ADD CONSTRAINT "trip_series_crew_person_id_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "boarding_observations" ADD CONSTRAINT "boarding_observations_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "boarding_observations" ADD CONSTRAINT "boarding_observations_recorded_by_person_id_people_id_fkey" FOREIGN KEY ("recorded_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "boarding_observations" ADD CONSTRAINT "boarding_observations_dismissed_by_person_id_people_id_fkey" FOREIGN KEY ("dismissed_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "departure_notes" ADD CONSTRAINT "departure_notes_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "departure_notes" ADD CONSTRAINT "departure_notes_trip_id_trips_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id");--> statement-breakpoint
ALTER TABLE "departure_notes" ADD CONSTRAINT "departure_notes_sent_by_person_id_people_id_fkey" FOREIGN KEY ("sent_by_person_id") REFERENCES "people"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "lost_items" ADD CONSTRAINT "lost_items_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "lost_items" ADD CONSTRAINT "lost_items_trip_id_trips_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id");--> statement-breakpoint
ALTER TABLE "lost_items" ADD CONSTRAINT "lost_items_booking_id_bookings_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id");--> statement-breakpoint
ALTER TABLE "lost_items" ADD CONSTRAINT "lost_items_person_id_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "lost_items" ADD CONSTRAINT "lost_items_recorded_by_person_id_people_id_fkey" FOREIGN KEY ("recorded_by_person_id") REFERENCES "people"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "lost_items" ADD CONSTRAINT "lost_items_resolved_by_person_id_people_id_fkey" FOREIGN KEY ("resolved_by_person_id") REFERENCES "people"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "boat_snags" ADD CONSTRAINT "boat_snags_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "boat_snags" ADD CONSTRAINT "boat_snags_boat_id_boats_id_fkey" FOREIGN KEY ("boat_id") REFERENCES "boats"("id");--> statement-breakpoint
ALTER TABLE "boat_snags" ADD CONSTRAINT "boat_snags_scbYNnLxsRZb_fkey" FOREIGN KEY ("checklist_item_id") REFERENCES "pre_departure_checklist_items"("id");--> statement-breakpoint
ALTER TABLE "boat_snags" ADD CONSTRAINT "boat_snags_noted_on_trip_id_trips_id_fkey" FOREIGN KEY ("noted_on_trip_id") REFERENCES "trips"("id");--> statement-breakpoint
ALTER TABLE "boat_snags" ADD CONSTRAINT "boat_snags_noted_by_person_id_people_id_fkey" FOREIGN KEY ("noted_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "boat_snags" ADD CONSTRAINT "boat_snags_still_there_on_trip_id_trips_id_fkey" FOREIGN KEY ("still_there_on_trip_id") REFERENCES "trips"("id");--> statement-breakpoint
ALTER TABLE "boat_snags" ADD CONSTRAINT "boat_snags_still_there_by_person_id_people_id_fkey" FOREIGN KEY ("still_there_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "boat_snags" ADD CONSTRAINT "boat_snags_fixed_on_trip_id_trips_id_fkey" FOREIGN KEY ("fixed_on_trip_id") REFERENCES "trips"("id");--> statement-breakpoint
ALTER TABLE "boat_snags" ADD CONSTRAINT "boat_snags_fixed_by_person_id_people_id_fkey" FOREIGN KEY ("fixed_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "booking_arrival_events" ADD CONSTRAINT "booking_arrival_events_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "booking_arrival_events" ADD CONSTRAINT "booking_arrival_events_trip_id_trips_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id");--> statement-breakpoint
ALTER TABLE "booking_arrival_events" ADD CONSTRAINT "booking_arrival_events_booking_id_bookings_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "booking_arrival_events" ADD CONSTRAINT "booking_arrival_events_recorded_by_person_id_people_id_fkey" FOREIGN KEY ("recorded_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "buddy_team_events" ADD CONSTRAINT "buddy_team_events_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "buddy_team_events" ADD CONSTRAINT "buddy_team_events_trip_id_trips_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id");--> statement-breakpoint
ALTER TABLE "buddy_team_events" ADD CONSTRAINT "buddy_team_events_recorded_by_person_id_people_id_fkey" FOREIGN KEY ("recorded_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "buddy_team_members" ADD CONSTRAINT "buddy_team_members_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "buddy_team_members" ADD CONSTRAINT "buddy_team_members_trip_id_trips_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id");--> statement-breakpoint
ALTER TABLE "buddy_team_members" ADD CONSTRAINT "buddy_team_members_booking_id_bookings_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id");--> statement-breakpoint
ALTER TABLE "buddy_team_members" ADD CONSTRAINT "buddy_team_members_crew_person_id_people_id_fkey" FOREIGN KEY ("crew_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "buddy_team_members" ADD CONSTRAINT "buddy_team_members_paired_by_person_id_people_id_fkey" FOREIGN KEY ("paired_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "departure_boat_safety_snapshots" ADD CONSTRAINT "departure_boat_safety_snapshots_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "departure_boat_safety_snapshots" ADD CONSTRAINT "departure_boat_safety_snapshots_trip_id_trips_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id");--> statement-breakpoint
ALTER TABLE "departure_boat_safety_snapshots" ADD CONSTRAINT "departure_boat_safety_snapshots_boat_id_boats_id_fkey" FOREIGN KEY ("boat_id") REFERENCES "boats"("id");--> statement-breakpoint
ALTER TABLE "disruption_recovery_events" ADD CONSTRAINT "disruption_recovery_events_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "disruption_recovery_events" ADD CONSTRAINT "disruption_recovery_events_j3hHvgocSJqK_fkey" FOREIGN KEY ("blowout_diver_id") REFERENCES "trip_blowout_divers"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "disruption_recovery_events" ADD CONSTRAINT "disruption_recovery_events_actor_person_id_people_id_fkey" FOREIGN KEY ("actor_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "disruption_recovery_events" ADD CONSTRAINT "disruption_recovery_events_ys8oacbMsKv1_fkey" FOREIGN KEY ("replacement_booking_id") REFERENCES "bookings"("id");--> statement-breakpoint
ALTER TABLE "disruption_recovery_events" ADD CONSTRAINT "disruption_recovery_events_scoped_diver_fk" FOREIGN KEY ("shop_id","blowout_diver_id") REFERENCES "trip_blowout_divers"("shop_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "disruption_recovery_events" ADD CONSTRAINT "disruption_recovery_events_scoped_replacement_fk" FOREIGN KEY ("shop_id","replacement_booking_id") REFERENCES "bookings"("shop_id","id");--> statement-breakpoint
ALTER TABLE "dive_participation_notes" ADD CONSTRAINT "dive_participation_notes_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "dive_participation_notes" ADD CONSTRAINT "dive_participation_notes_trip_id_trips_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id");--> statement-breakpoint
ALTER TABLE "dive_participation_notes" ADD CONSTRAINT "dive_participation_notes_booking_id_bookings_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id");--> statement-breakpoint
ALTER TABLE "dive_participation_notes" ADD CONSTRAINT "dive_participation_notes_recorded_by_person_id_people_id_fkey" FOREIGN KEY ("recorded_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "pre_departure_check_events" ADD CONSTRAINT "pre_departure_check_events_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "pre_departure_check_events" ADD CONSTRAINT "pre_departure_check_events_trip_id_trips_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id");--> statement-breakpoint
ALTER TABLE "pre_departure_check_events" ADD CONSTRAINT "pre_departure_check_events_Sm6KHU4KNFB1_fkey" FOREIGN KEY ("checklist_item_id") REFERENCES "pre_departure_checklist_items"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "pre_departure_check_events" ADD CONSTRAINT "pre_departure_check_events_recorded_by_person_id_people_id_fkey" FOREIGN KEY ("recorded_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "pre_departure_checklist_items" ADD CONSTRAINT "pre_departure_checklist_items_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "pre_departure_checklist_items" ADD CONSTRAINT "pre_departure_checklist_items_c6mRO9ZNpkkg_fkey" FOREIGN KEY ("deleted_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "roll_call_deck_counts" ADD CONSTRAINT "roll_call_deck_counts_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "roll_call_deck_counts" ADD CONSTRAINT "roll_call_deck_counts_trip_id_trips_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id");--> statement-breakpoint
ALTER TABLE "roll_call_deck_counts" ADD CONSTRAINT "roll_call_deck_counts_recorded_by_person_id_people_id_fkey" FOREIGN KEY ("recorded_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "roll_call_events" ADD CONSTRAINT "roll_call_events_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "roll_call_events" ADD CONSTRAINT "roll_call_events_trip_id_trips_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id");--> statement-breakpoint
ALTER TABLE "roll_call_events" ADD CONSTRAINT "roll_call_events_booking_id_bookings_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id");--> statement-breakpoint
ALTER TABLE "roll_call_events" ADD CONSTRAINT "roll_call_events_crew_person_id_people_id_fkey" FOREIGN KEY ("crew_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "roll_call_events" ADD CONSTRAINT "roll_call_events_recorded_by_person_id_people_id_fkey" FOREIGN KEY ("recorded_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "roll_call_events" ADD CONSTRAINT "roll_call_events_retracts_event_id_roll_call_events_id_fkey" FOREIGN KEY ("retracts_event_id") REFERENCES "roll_call_events"("id");--> statement-breakpoint
ALTER TABLE "safety_drill_participants" ADD CONSTRAINT "safety_drill_participants_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "safety_drill_participants" ADD CONSTRAINT "safety_drill_participants_drill_id_safety_drills_id_fkey" FOREIGN KEY ("drill_id") REFERENCES "safety_drills"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "safety_drill_participants" ADD CONSTRAINT "safety_drill_participants_person_id_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "safety_drills" ADD CONSTRAINT "safety_drills_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "safety_drills" ADD CONSTRAINT "safety_drills_recorded_by_person_id_people_id_fkey" FOREIGN KEY ("recorded_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "safety_drills" ADD CONSTRAINT "safety_drills_deleted_by_person_id_people_id_fkey" FOREIGN KEY ("deleted_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "trip_blowout_divers" ADD CONSTRAINT "trip_blowout_divers_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "trip_blowout_divers" ADD CONSTRAINT "trip_blowout_divers_blowout_id_trip_blowouts_id_fkey" FOREIGN KEY ("blowout_id") REFERENCES "trip_blowouts"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "trip_blowout_divers" ADD CONSTRAINT "trip_blowout_divers_booking_id_bookings_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id");--> statement-breakpoint
ALTER TABLE "trip_blowout_divers" ADD CONSTRAINT "trip_blowout_divers_person_id_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "trip_blowouts" ADD CONSTRAINT "trip_blowouts_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "trip_blowouts" ADD CONSTRAINT "trip_blowouts_trip_id_trips_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id");--> statement-breakpoint
ALTER TABLE "trip_blowouts" ADD CONSTRAINT "trip_blowouts_called_by_person_id_people_id_fkey" FOREIGN KEY ("called_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "dive_site_creatures" ADD CONSTRAINT "dive_site_creatures_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "dive_site_creatures" ADD CONSTRAINT "dive_site_creatures_dive_site_id_dive_sites_id_fkey" FOREIGN KEY ("dive_site_id") REFERENCES "dive_sites"("id");--> statement-breakpoint
ALTER TABLE "dive_sites" ADD CONSTRAINT "dive_sites_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "dive_sites" ADD CONSTRAINT "dive_sites_planning_note_by_person_id_people_id_fkey" FOREIGN KEY ("planning_note_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "global_dive_site_versions" ADD CONSTRAINT "global_dive_site_versions_1zaEF6XhjlbN_fkey" FOREIGN KEY ("global_dive_site_id") REFERENCES "global_dive_sites"("id");--> statement-breakpoint
ALTER TABLE "marine_life_requests" ADD CONSTRAINT "marine_life_requests_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "marine_life_requests" ADD CONSTRAINT "marine_life_requests_requested_by_person_id_people_id_fkey" FOREIGN KEY ("requested_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "marine_life_requests" ADD CONSTRAINT "marine_life_requests_dive_site_id_dive_sites_id_fkey" FOREIGN KEY ("dive_site_id") REFERENCES "dive_sites"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "media_deletion_attempts" ADD CONSTRAINT "media_deletion_attempts_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "media_deletion_attempts" ADD CONSTRAINT "media_deletion_attempts_person_id_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "private_person_photo_uploads" ADD CONSTRAINT "private_person_photo_uploads_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "private_person_photo_uploads" ADD CONSTRAINT "private_person_photo_uploads_person_id_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "processor_erasure_obligations" ADD CONSTRAINT "processor_erasure_obligations_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "processor_erasure_obligations" ADD CONSTRAINT "processor_erasure_obligations_person_id_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "processor_erasure_obligations" ADD CONSTRAINT "processor_erasure_obligations_kgvFHJwQGdT5_fkey" FOREIGN KEY ("discharged_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "shop_milestones" ADD CONSTRAINT "shop_milestones_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "gear_items" ADD CONSTRAINT "gear_items_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "gear_items" ADD CONSTRAINT "gear_items_aboard_boat_id_boats_id_fkey" FOREIGN KEY ("aboard_boat_id") REFERENCES "boats"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "gear_items" ADD CONSTRAINT "gear_items_deleted_by_person_id_people_id_fkey" FOREIGN KEY ("deleted_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "gear_reservations" ADD CONSTRAINT "gear_reservations_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "gear_reservations" ADD CONSTRAINT "gear_reservations_gear_item_id_gear_items_id_fkey" FOREIGN KEY ("gear_item_id") REFERENCES "gear_items"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "gear_reservations" ADD CONSTRAINT "gear_reservations_person_id_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "gear_reservations" ADD CONSTRAINT "gear_reservations_booking_id_bookings_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "gear_reservations" ADD CONSTRAINT "gear_reservations_order_id_orders_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id");--> statement-breakpoint
ALTER TABLE "gear_reservations" ADD CONSTRAINT "gear_reservations_fill_recorded_by_person_id_people_id_fkey" FOREIGN KEY ("fill_recorded_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "gear_reservations" ADD CONSTRAINT "gear_reservations_released_by_person_id_people_id_fkey" FOREIGN KEY ("released_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "gear_service_events" ADD CONSTRAINT "gear_service_events_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "gear_service_events" ADD CONSTRAINT "gear_service_events_gear_item_id_gear_items_id_fkey" FOREIGN KEY ("gear_item_id") REFERENCES "gear_items"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "gear_service_events" ADD CONSTRAINT "gear_service_events_recorded_by_person_id_people_id_fkey" FOREIGN KEY ("recorded_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "prior_gear_assignments" ADD CONSTRAINT "prior_gear_assignments_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "prior_gear_assignments" ADD CONSTRAINT "prior_gear_assignments_person_id_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "prior_gear_assignments" ADD CONSTRAINT "prior_gear_assignments_gear_item_id_gear_items_id_fkey" FOREIGN KEY ("gear_item_id") REFERENCES "gear_items"("id");--> statement-breakpoint
ALTER TABLE "rental_fit_profiles" ADD CONSTRAINT "rental_fit_profiles_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "rental_fit_profiles" ADD CONSTRAINT "rental_fit_profiles_person_id_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "rental_fit_profiles" ADD CONSTRAINT "rental_fit_profiles_needs_staff_fit_by_people_id_fkey" FOREIGN KEY ("needs_staff_fit_by") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "rental_fit_profiles" ADD CONSTRAINT "rental_fit_profiles_fit_confirmed_by_people_id_fkey" FOREIGN KEY ("fit_confirmed_by") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "incident_report_addenda" ADD CONSTRAINT "incident_report_addenda_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "incident_report_addenda" ADD CONSTRAINT "incident_report_addenda_report_id_incident_reports_id_fkey" FOREIGN KEY ("report_id") REFERENCES "incident_reports"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "incident_report_addenda" ADD CONSTRAINT "incident_report_addenda_author_person_id_people_id_fkey" FOREIGN KEY ("author_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "incident_report_people" ADD CONSTRAINT "incident_report_people_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "incident_report_people" ADD CONSTRAINT "incident_report_people_report_id_incident_reports_id_fkey" FOREIGN KEY ("report_id") REFERENCES "incident_reports"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "incident_report_people" ADD CONSTRAINT "incident_report_people_booking_id_bookings_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id");--> statement-breakpoint
ALTER TABLE "incident_report_people" ADD CONSTRAINT "incident_report_people_person_id_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "incident_reports" ADD CONSTRAINT "incident_reports_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "incident_reports" ADD CONSTRAINT "incident_reports_trip_id_trips_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id");--> statement-breakpoint
ALTER TABLE "incident_reports" ADD CONSTRAINT "incident_reports_dive_site_id_dive_sites_id_fkey" FOREIGN KEY ("dive_site_id") REFERENCES "dive_sites"("id");--> statement-breakpoint
ALTER TABLE "incident_reports" ADD CONSTRAINT "incident_reports_created_by_person_id_people_id_fkey" FOREIGN KEY ("created_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "incident_reports" ADD CONSTRAINT "incident_reports_filed_by_person_id_people_id_fkey" FOREIGN KEY ("filed_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "incident_reports" ADD CONSTRAINT "incident_reports_IROSQXtmQ09n_fkey" FOREIGN KEY ("missing_alert_raised_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "incident_reports" ADD CONSTRAINT "incident_reports_pKE3joE7tHcd_fkey" FOREIGN KEY ("missing_subject_row_id") REFERENCES "incident_report_people"("id");--> statement-breakpoint
ALTER TABLE "incident_reports" ADD CONSTRAINT "incident_reports_missing_found_by_person_id_people_id_fkey" FOREIGN KEY ("missing_found_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "incident_reports" ADD CONSTRAINT "incident_reports_deleted_by_person_id_people_id_fkey" FOREIGN KEY ("deleted_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "integration_deliveries" ADD CONSTRAINT "integration_deliveries_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "integration_deliveries" ADD CONSTRAINT "integration_deliveries_integration_id_shop_integrations_id_fkey" FOREIGN KEY ("integration_id") REFERENCES "shop_integrations"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "integration_deliveries" ADD CONSTRAINT "integration_deliveries_event_id_integration_events_id_fkey" FOREIGN KEY ("event_id") REFERENCES "integration_events"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "integration_events" ADD CONSTRAINT "integration_events_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "integration_oauth_states" ADD CONSTRAINT "integration_oauth_states_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "integration_oauth_states" ADD CONSTRAINT "integration_oauth_states_person_id_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "integration_sync_records" ADD CONSTRAINT "integration_sync_records_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "platform_backup_progress" ADD CONSTRAINT "platform_backup_progress_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "shop_backup_deliveries" ADD CONSTRAINT "shop_backup_deliveries_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "shop_backup_delivery_claims" ADD CONSTRAINT "shop_backup_delivery_claims_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "shop_backup_destinations" ADD CONSTRAINT "shop_backup_destinations_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "shop_integrations" ADD CONSTRAINT "shop_integrations_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "date_request_offer_bookings" ADD CONSTRAINT "date_request_offer_bookings_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "date_request_offer_bookings" ADD CONSTRAINT "date_request_offer_bookings_interest_id_interests_id_fkey" FOREIGN KEY ("interest_id") REFERENCES "interests"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "date_request_offer_bookings" ADD CONSTRAINT "date_request_offer_bookings_shop_interest_fk" FOREIGN KEY ("shop_id","interest_id") REFERENCES "interests"("shop_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "date_request_offer_bookings" ADD CONSTRAINT "date_request_offer_bookings_shop_booking_fk" FOREIGN KEY ("shop_id","booking_id") REFERENCES "bookings"("shop_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "interest_replies" ADD CONSTRAINT "interest_replies_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "interest_replies" ADD CONSTRAINT "interest_replies_sent_by_person_id_people_id_fkey" FOREIGN KEY ("sent_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "interest_replies" ADD CONSTRAINT "interest_replies_shop_interest_fk" FOREIGN KEY ("shop_id","interest_id") REFERENCES "interests"("shop_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "interests" ADD CONSTRAINT "interests_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "interests" ADD CONSTRAINT "interests_parent_interest_id_interests_id_fkey" FOREIGN KEY ("parent_interest_id") REFERENCES "interests"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "interests" ADD CONSTRAINT "interests_person_id_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "interests" ADD CONSTRAINT "interests_trip_id_trips_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id");--> statement-breakpoint
ALTER TABLE "interests" ADD CONSTRAINT "interests_course_id_courses_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id");--> statement-breakpoint
ALTER TABLE "interests" ADD CONSTRAINT "interests_created_by_person_id_people_id_fkey" FOREIGN KEY ("created_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "interests" ADD CONSTRAINT "interests_promo_id_deals_id_fkey" FOREIGN KEY ("promo_id") REFERENCES "deals"("id");--> statement-breakpoint
ALTER TABLE "interests" ADD CONSTRAINT "interests_charter_quoted_by_person_id_people_id_fkey" FOREIGN KEY ("charter_quoted_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "email_bounces" ADD CONSTRAINT "email_bounces_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "email_bounces" ADD CONSTRAINT "email_bounces_sent_by_person_id_people_id_fkey" FOREIGN KEY ("sent_by_person_id") REFERENCES "people"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "inbound_messages" ADD CONSTRAINT "inbound_messages_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "inbound_messages" ADD CONSTRAINT "inbound_messages_person_id_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "inbound_messages" ADD CONSTRAINT "inbound_messages_xZJ0xNr6OkuL_fkey" FOREIGN KEY ("in_reply_to_delivery_id") REFERENCES "notification_deliveries"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "inbound_messages" ADD CONSTRAINT "inbound_messages_booking_id_bookings_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id");--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_booking_id_bookings_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id");--> statement-breakpoint
ALTER TABLE "notification_send_queue" ADD CONSTRAINT "notification_send_queue_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "notification_send_queue" ADD CONSTRAINT "notification_send_queue_actor_person_id_people_id_fkey" FOREIGN KEY ("actor_person_id") REFERENCES "people"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_trip_id_trips_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_person_id_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "shop_contact_email_confirmation_tokens" ADD CONSTRAINT "shop_contact_email_confirmation_tokens_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "shop_whatsapp_accounts" ADD CONSTRAINT "shop_whatsapp_accounts_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "staff_replies" ADD CONSTRAINT "staff_replies_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "staff_replies" ADD CONSTRAINT "staff_replies_person_id_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "staff_replies" ADD CONSTRAINT "staff_replies_inbound_message_id_inbound_messages_id_fkey" FOREIGN KEY ("inbound_message_id") REFERENCES "inbound_messages"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "staff_replies" ADD CONSTRAINT "staff_replies_sent_by_person_id_people_id_fkey" FOREIGN KEY ("sent_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "whatsapp_delivered_usage" ADD CONSTRAINT "whatsapp_delivered_usage_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "offline_manifest_snapshot_revisions" ADD CONSTRAINT "offline_manifest_snapshot_revisions_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "offline_manifest_snapshot_revisions" ADD CONSTRAINT "offline_manifest_snapshot_revisions_trip_id_trips_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "offline_manifest_snapshot_revisions" ADD CONSTRAINT "offline_manifest_snapshot_revisions_trip_shop_fk" FOREIGN KEY ("shop_id","trip_id") REFERENCES "trips"("shop_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "offline_review_refusals" ADD CONSTRAINT "offline_review_refusals_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "account_passkey_challenges" ADD CONSTRAINT "account_passkey_challenges_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "account_passkey_challenges" ADD CONSTRAINT "account_passkey_challenges_IAoJPG6JDKcK_fkey" FOREIGN KEY ("user_account_id") REFERENCES "user_accounts"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "account_passkey_challenges" ADD CONSTRAINT "account_passkey_challenges_WpffnZM0oTSQ_fkey" FOREIGN KEY ("account_session_id") REFERENCES "account_sessions"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "account_passkeys" ADD CONSTRAINT "account_passkeys_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "account_passkeys" ADD CONSTRAINT "account_passkeys_user_account_id_user_accounts_id_fkey" FOREIGN KEY ("user_account_id") REFERENCES "user_accounts"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "booking_checkout_bookings" ADD CONSTRAINT "booking_checkout_bookings_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "booking_checkout_bookings" ADD CONSTRAINT "booking_checkout_bookings_checkout_id_booking_checkouts_id_fkey" FOREIGN KEY ("checkout_id") REFERENCES "booking_checkouts"("id");--> statement-breakpoint
ALTER TABLE "booking_checkout_bookings" ADD CONSTRAINT "booking_checkout_bookings_booking_id_bookings_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id");--> statement-breakpoint
ALTER TABLE "booking_checkouts" ADD CONSTRAINT "booking_checkouts_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "booking_checkouts" ADD CONSTRAINT "booking_checkouts_trip_id_trips_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id");--> statement-breakpoint
ALTER TABLE "booking_checkouts" ADD CONSTRAINT "booking_checkouts_deal_id_deals_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "deals"("id");--> statement-breakpoint
ALTER TABLE "booking_payment_events" ADD CONSTRAINT "booking_payment_events_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "booking_payment_events" ADD CONSTRAINT "booking_payment_events_booking_id_bookings_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "booking_payment_events" ADD CONSTRAINT "booking_payment_events_recorded_by_person_id_people_id_fkey" FOREIGN KEY ("recorded_by_person_id") REFERENCES "people"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_created_by_person_id_people_id_fkey" FOREIGN KEY ("created_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_shop_trip_fk" FOREIGN KEY ("shop_id","trip_id") REFERENCES "trips"("shop_id","id");--> statement-breakpoint
ALTER TABLE "dive_package_entitlements" ADD CONSTRAINT "dive_package_entitlements_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "dive_package_entitlements" ADD CONSTRAINT "dive_package_entitlements_package_id_dive_packages_id_fkey" FOREIGN KEY ("package_id") REFERENCES "dive_packages"("id");--> statement-breakpoint
ALTER TABLE "dive_package_entitlements" ADD CONSTRAINT "dive_package_entitlements_person_id_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "dive_package_entitlements" ADD CONSTRAINT "dive_package_entitlements_order_id_orders_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id");--> statement-breakpoint
ALTER TABLE "dive_package_entitlements" ADD CONSTRAINT "dive_package_entitlements_booking_id_bookings_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id");--> statement-breakpoint
ALTER TABLE "dive_packages" ADD CONSTRAINT "dive_packages_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "dive_packages" ADD CONSTRAINT "dive_packages_created_by_person_id_people_id_fkey" FOREIGN KEY ("created_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "imported_payment_history" ADD CONSTRAINT "imported_payment_history_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "imported_payment_history" ADD CONSTRAINT "imported_payment_history_person_id_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "order_line_items" ADD CONSTRAINT "order_line_items_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "order_line_items" ADD CONSTRAINT "order_line_items_order_id_orders_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id");--> statement-breakpoint
ALTER TABLE "order_line_items" ADD CONSTRAINT "order_line_items_package_id_dive_packages_id_fkey" FOREIGN KEY ("package_id") REFERENCES "dive_packages"("id");--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_booking_id_bookings_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id");--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_person_id_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_created_by_person_id_people_id_fkey" FOREIGN KEY ("created_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "package_gifts" ADD CONSTRAINT "package_gifts_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "package_gifts" ADD CONSTRAINT "package_gifts_order_id_orders_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id");--> statement-breakpoint
ALTER TABLE "package_gifts" ADD CONSTRAINT "package_gifts_person_id_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "payment_disputes" ADD CONSTRAINT "payment_disputes_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "payment_disputes" ADD CONSTRAINT "payment_disputes_order_id_orders_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id");--> statement-breakpoint
ALTER TABLE "payment_disputes" ADD CONSTRAINT "payment_disputes_checkout_id_booking_checkouts_id_fkey" FOREIGN KEY ("checkout_id") REFERENCES "booking_checkouts"("id");--> statement-breakpoint
ALTER TABLE "payment_operation_intents" ADD CONSTRAINT "payment_operation_intents_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "payment_operation_intents" ADD CONSTRAINT "payment_operation_intents_trip_id_trips_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id");--> statement-breakpoint
ALTER TABLE "payment_operation_intents" ADD CONSTRAINT "payment_operation_intents_booking_id_bookings_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id");--> statement-breakpoint
ALTER TABLE "payment_operation_intents" ADD CONSTRAINT "payment_operation_intents_order_id_orders_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id");--> statement-breakpoint
ALTER TABLE "payment_operation_intents" ADD CONSTRAINT "payment_operation_intents_checkout_id_booking_checkouts_id_fkey" FOREIGN KEY ("checkout_id") REFERENCES "booking_checkouts"("id");--> statement-breakpoint
ALTER TABLE "payment_operation_intents" ADD CONSTRAINT "payment_operation_intents_deal_id_deals_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "deals"("id");--> statement-breakpoint
ALTER TABLE "shop_stripe_accounts" ADD CONSTRAINT "shop_stripe_accounts_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "stripe_payouts" ADD CONSTRAINT "stripe_payouts_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "stripe_refund_failures" ADD CONSTRAINT "stripe_refund_failures_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "stripe_refund_failures" ADD CONSTRAINT "stripe_refund_failures_order_id_orders_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id");--> statement-breakpoint
ALTER TABLE "stripe_refund_failures" ADD CONSTRAINT "stripe_refund_failures_checkout_id_booking_checkouts_id_fkey" FOREIGN KEY ("checkout_id") REFERENCES "booking_checkouts"("id");--> statement-breakpoint
ALTER TABLE "stripe_refund_failures" ADD CONSTRAINT "stripe_refund_failures_booking_id_bookings_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id");--> statement-breakpoint
ALTER TABLE "recovery_activities" ADD CONSTRAINT "recovery_activities_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "recovery_activities" ADD CONSTRAINT "recovery_activities_blowout_id_trip_blowouts_id_fkey" FOREIGN KEY ("blowout_id") REFERENCES "trip_blowouts"("id");--> statement-breakpoint
ALTER TABLE "recovery_activities" ADD CONSTRAINT "recovery_activities_coordinator_person_id_people_id_fkey" FOREIGN KEY ("coordinator_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "recovery_activities" ADD CONSTRAINT "recovery_activities_created_by_person_id_people_id_fkey" FOREIGN KEY ("created_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "recovery_activities" ADD CONSTRAINT "recovery_activities_bVUYjHBbU8Xb_fkey" FOREIGN KEY ("arrangements_confirmed_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "recovery_activities" ADD CONSTRAINT "recovery_activities_scoped_blowout_fk" FOREIGN KEY ("shop_id","blowout_id") REFERENCES "trip_blowouts"("shop_id","id");--> statement-breakpoint
ALTER TABLE "recovery_activities" ADD CONSTRAINT "recovery_activities_scoped_person_0_fk" FOREIGN KEY ("shop_id","coordinator_person_id") REFERENCES "people"("shop_id","id");--> statement-breakpoint
ALTER TABLE "recovery_activities" ADD CONSTRAINT "recovery_activities_scoped_person_1_fk" FOREIGN KEY ("shop_id","created_by_person_id") REFERENCES "people"("shop_id","id");--> statement-breakpoint
ALTER TABLE "recovery_activities" ADD CONSTRAINT "recovery_activities_scoped_person_2_fk" FOREIGN KEY ("shop_id","arrangements_confirmed_by_person_id") REFERENCES "people"("shop_id","id");--> statement-breakpoint
ALTER TABLE "recovery_activity_events" ADD CONSTRAINT "recovery_activity_events_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "recovery_activity_events" ADD CONSTRAINT "recovery_activity_events_actor_person_id_people_id_fkey" FOREIGN KEY ("actor_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "recovery_activity_events" ADD CONSTRAINT "recovery_activity_events_scoped_activity_fk" FOREIGN KEY ("shop_id","activity_id") REFERENCES "recovery_activities"("shop_id","id");--> statement-breakpoint
ALTER TABLE "recovery_activity_events" ADD CONSTRAINT "recovery_activity_events_scoped_participant_fk" FOREIGN KEY ("shop_id","participant_id") REFERENCES "recovery_activity_participants"("shop_id","id");--> statement-breakpoint
ALTER TABLE "recovery_activity_events" ADD CONSTRAINT "recovery_activity_events_scoped_actor_fk" FOREIGN KEY ("shop_id","actor_person_id") REFERENCES "people"("shop_id","id");--> statement-breakpoint
ALTER TABLE "recovery_activity_offers" ADD CONSTRAINT "recovery_activity_offers_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "recovery_activity_offers" ADD CONSTRAINT "recovery_activity_offers_actor_person_id_people_id_fkey" FOREIGN KEY ("actor_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "recovery_activity_offers" ADD CONSTRAINT "recovery_activity_offers_scoped_activity_fk" FOREIGN KEY ("shop_id","activity_id") REFERENCES "recovery_activities"("shop_id","id");--> statement-breakpoint
ALTER TABLE "recovery_activity_offers" ADD CONSTRAINT "recovery_activity_offers_scoped_diver_fk" FOREIGN KEY ("shop_id","blowout_diver_id") REFERENCES "trip_blowout_divers"("shop_id","id");--> statement-breakpoint
ALTER TABLE "recovery_activity_offers" ADD CONSTRAINT "recovery_activity_offers_scoped_actor_fk" FOREIGN KEY ("shop_id","actor_person_id") REFERENCES "people"("shop_id","id");--> statement-breakpoint
ALTER TABLE "recovery_activity_participants" ADD CONSTRAINT "recovery_activity_participants_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "recovery_activity_participants" ADD CONSTRAINT "recovery_activity_participants_person_id_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "recovery_activity_participants" ADD CONSTRAINT "recovery_activity_participants_H7S89mKADLXG_fkey" FOREIGN KEY ("confirmed_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "recovery_activity_participants" ADD CONSTRAINT "recovery_activity_participants_scoped_activity_fk" FOREIGN KEY ("shop_id","activity_id") REFERENCES "recovery_activities"("shop_id","id");--> statement-breakpoint
ALTER TABLE "recovery_activity_participants" ADD CONSTRAINT "recovery_activity_participants_scoped_diver_fk" FOREIGN KEY ("shop_id","blowout_diver_id") REFERENCES "trip_blowout_divers"("shop_id","id");--> statement-breakpoint
ALTER TABLE "recovery_activity_participants" ADD CONSTRAINT "recovery_activity_participants_scoped_person_fk" FOREIGN KEY ("shop_id","person_id") REFERENCES "people"("shop_id","id");--> statement-breakpoint
ALTER TABLE "recovery_activity_participants" ADD CONSTRAINT "recovery_activity_participants_scoped_actor_fk" FOREIGN KEY ("shop_id","confirmed_by_person_id") REFERENCES "people"("shop_id","id");--> statement-breakpoint
ALTER TABLE "recap_photos" ADD CONSTRAINT "recap_photos_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "recap_photos" ADD CONSTRAINT "recap_photos_booking_id_bookings_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id");--> statement-breakpoint
ALTER TABLE "recap_photos" ADD CONSTRAINT "recap_photos_trip_id_trips_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id");--> statement-breakpoint
ALTER TABLE "recap_pulses" ADD CONSTRAINT "recap_pulses_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "recap_pulses" ADD CONSTRAINT "recap_pulses_booking_id_bookings_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id");--> statement-breakpoint
ALTER TABLE "recap_pulses" ADD CONSTRAINT "recap_pulses_trip_id_trips_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id");--> statement-breakpoint
ALTER TABLE "recap_pulses" ADD CONSTRAINT "recap_pulses_person_id_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "recap_pulses" ADD CONSTRAINT "recap_pulses_addressed_by_person_id_people_id_fkey" FOREIGN KEY ("addressed_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "review_moderation_events" ADD CONSTRAINT "review_moderation_events_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "review_moderation_events" ADD CONSTRAINT "review_moderation_events_review_id_trip_reviews_id_fkey" FOREIGN KEY ("review_id") REFERENCES "trip_reviews"("id");--> statement-breakpoint
ALTER TABLE "review_moderation_events" ADD CONSTRAINT "review_moderation_events_recorded_by_person_id_people_id_fkey" FOREIGN KEY ("recorded_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "review_replies" ADD CONSTRAINT "review_replies_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "review_replies" ADD CONSTRAINT "review_replies_review_id_trip_reviews_id_fkey" FOREIGN KEY ("review_id") REFERENCES "trip_reviews"("id");--> statement-breakpoint
ALTER TABLE "review_replies" ADD CONSTRAINT "review_replies_written_by_person_id_people_id_fkey" FOREIGN KEY ("written_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "trip_recap_photos" ADD CONSTRAINT "trip_recap_photos_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "trip_recap_photos" ADD CONSTRAINT "trip_recap_photos_trip_id_trips_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id");--> statement-breakpoint
ALTER TABLE "trip_recap_photos" ADD CONSTRAINT "trip_recap_photos_uploaded_by_person_id_people_id_fkey" FOREIGN KEY ("uploaded_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "trip_reviews" ADD CONSTRAINT "trip_reviews_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "trip_reviews" ADD CONSTRAINT "trip_reviews_booking_id_bookings_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id");--> statement-breakpoint
ALTER TABLE "trip_reviews" ADD CONSTRAINT "trip_reviews_trip_id_trips_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id");--> statement-breakpoint
ALTER TABLE "trip_reviews" ADD CONSTRAINT "trip_reviews_person_id_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "trip_reviews" ADD CONSTRAINT "trip_reviews_crew_thanks_person_id_people_id_fkey" FOREIGN KEY ("crew_thanks_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "trip_reviews" ADD CONSTRAINT "trip_reviews_crew_thanks_ruled_by_person_id_people_id_fkey" FOREIGN KEY ("crew_thanks_ruled_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "trip_credit_entries" ADD CONSTRAINT "trip_credit_entries_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "trip_credit_entries" ADD CONSTRAINT "trip_credit_entries_person_id_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "trip_credit_entries" ADD CONSTRAINT "trip_credit_entries_booking_id_bookings_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id");--> statement-breakpoint
ALTER TABLE "trip_credit_entries" ADD CONSTRAINT "trip_credit_entries_tOnrmHxTsTxG_fkey" FOREIGN KEY ("restores_entry_id") REFERENCES "trip_credit_entries"("id");--> statement-breakpoint
ALTER TABLE "trip_credit_entries" ADD CONSTRAINT "trip_credit_entries_actor_person_id_people_id_fkey" FOREIGN KEY ("actor_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "trip_credit_entries" ADD CONSTRAINT "trip_credit_entries_booking_shop_fk" FOREIGN KEY ("shop_id","booking_id") REFERENCES "bookings"("shop_id","id");--> statement-breakpoint
ALTER TABLE "trip_credit_entries" ADD CONSTRAINT "trip_credit_entries_restore_shop_fk" FOREIGN KEY ("shop_id","restores_entry_id") REFERENCES "trip_credit_entries"("shop_id","id");--> statement-breakpoint
ALTER TABLE "boats" ADD CONSTRAINT "boats_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "executed_dives" ADD CONSTRAINT "executed_dives_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "executed_dives" ADD CONSTRAINT "executed_dives_trip_id_trips_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id");--> statement-breakpoint
ALTER TABLE "executed_dives" ADD CONSTRAINT "executed_dives_actual_site_id_dive_sites_id_fkey" FOREIGN KEY ("actual_site_id") REFERENCES "dive_sites"("id");--> statement-breakpoint
ALTER TABLE "executed_dives" ADD CONSTRAINT "executed_dives_recorded_by_person_id_people_id_fkey" FOREIGN KEY ("recorded_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "executed_dives" ADD CONSTRAINT "executed_dives_deleted_by_person_id_people_id_fkey" FOREIGN KEY ("deleted_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "trip_dives" ADD CONSTRAINT "trip_dives_trip_id_trips_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id");--> statement-breakpoint
ALTER TABLE "trip_dives" ADD CONSTRAINT "trip_dives_dive_site_id_dive_sites_id_fkey" FOREIGN KEY ("dive_site_id") REFERENCES "dive_sites"("id");--> statement-breakpoint
ALTER TABLE "trip_lenses" ADD CONSTRAINT "trip_lenses_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "trip_requirements" ADD CONSTRAINT "trip_requirements_trip_id_trips_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id");--> statement-breakpoint
ALTER TABLE "trip_requirements" ADD CONSTRAINT "trip_requirements_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "trip_schedule_days" ADD CONSTRAINT "trip_schedule_days_trip_id_trips_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "trip_series" ADD CONSTRAINT "trip_series_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "trip_series_skips" ADD CONSTRAINT "trip_series_skips_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "trip_series_skips" ADD CONSTRAINT "trip_series_skips_series_id_trip_series_id_fkey" FOREIGN KEY ("series_id") REFERENCES "trip_series"("id");--> statement-breakpoint
ALTER TABLE "trip_sightings" ADD CONSTRAINT "trip_sightings_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "trip_sightings" ADD CONSTRAINT "trip_sightings_trip_id_trips_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id");--> statement-breakpoint
ALTER TABLE "trip_sightings" ADD CONSTRAINT "trip_sightings_dive_site_id_dive_sites_id_fkey" FOREIGN KEY ("dive_site_id") REFERENCES "dive_sites"("id");--> statement-breakpoint
ALTER TABLE "trip_sightings" ADD CONSTRAINT "trip_sightings_recorded_by_person_id_people_id_fkey" FOREIGN KEY ("recorded_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "trip_sightings" ADD CONSTRAINT "trip_sightings_deleted_by_person_id_people_id_fkey" FOREIGN KEY ("deleted_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_series_id_trip_series_id_fkey" FOREIGN KEY ("series_id") REFERENCES "trip_series"("id");--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_lens_id_trip_lenses_id_fkey" FOREIGN KEY ("lens_id") REFERENCES "trip_lenses"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_course_id_courses_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id");--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_boat_id_boats_id_fkey" FOREIGN KEY ("boat_id") REFERENCES "boats"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_course_teaching_note_by_person_id_people_id_fkey" FOREIGN KEY ("course_teaching_note_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "waiver_deliveries" ADD CONSTRAINT "waiver_deliveries_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "waiver_deliveries" ADD CONSTRAINT "waiver_deliveries_waiver_record_id_waiver_records_id_fkey" FOREIGN KEY ("waiver_record_id") REFERENCES "waiver_records"("id");--> statement-breakpoint
ALTER TABLE "waiver_drafts" ADD CONSTRAINT "waiver_drafts_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "waiver_drafts" ADD CONSTRAINT "waiver_drafts_waiver_record_id_waiver_records_id_fkey" FOREIGN KEY ("waiver_record_id") REFERENCES "waiver_records"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "waiver_materiality_decisions" ADD CONSTRAINT "waiver_materiality_decisions_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "waiver_materiality_decisions" ADD CONSTRAINT "waiver_materiality_decisions_HD5Bu9IuOEoC_fkey" FOREIGN KEY ("template_id") REFERENCES "waiver_templates"("id");--> statement-breakpoint
ALTER TABLE "waiver_materiality_decisions" ADD CONSTRAINT "waiver_materiality_decisions_actor_person_id_people_id_fkey" FOREIGN KEY ("actor_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "waiver_records" ADD CONSTRAINT "waiver_records_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "waiver_records" ADD CONSTRAINT "waiver_records_booking_id_bookings_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id");--> statement-breakpoint
ALTER TABLE "waiver_records" ADD CONSTRAINT "waiver_records_person_id_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "waiver_records" ADD CONSTRAINT "waiver_records_template_id_waiver_templates_id_fkey" FOREIGN KEY ("template_id") REFERENCES "waiver_templates"("id");--> statement-breakpoint
ALTER TABLE "waiver_records" ADD CONSTRAINT "waiver_records_recorded_by_person_id_people_id_fkey" FOREIGN KEY ("recorded_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "waiver_records" ADD CONSTRAINT "waiver_records_medical_cleared_by_person_id_people_id_fkey" FOREIGN KEY ("medical_cleared_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "waiver_records" ADD CONSTRAINT "waiver_records_6ecGsdLDogQb_fkey" FOREIGN KEY ("medical_clearance_declined_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "waiver_records" ADD CONSTRAINT "waiver_records_DMLfwgLsuWoJ_fkey" FOREIGN KEY ("guardian_email_erased_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "waiver_records" ADD CONSTRAINT "waiver_records_anonymized_by_person_id_people_id_fkey" FOREIGN KEY ("anonymized_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "waiver_records" ADD CONSTRAINT "waiver_records_moved_from_person_id_people_id_fkey" FOREIGN KEY ("moved_from_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "waiver_records" ADD CONSTRAINT "waiver_records_moved_by_person_id_people_id_fkey" FOREIGN KEY ("moved_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "waiver_seal_acknowledgements" ADD CONSTRAINT "waiver_seal_acknowledgements_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "waiver_seal_acknowledgements" ADD CONSTRAINT "waiver_seal_acknowledgements_NN3djjfCQh3p_fkey" FOREIGN KEY ("waiver_record_id") REFERENCES "waiver_records"("id");--> statement-breakpoint
ALTER TABLE "waiver_seal_acknowledgements" ADD CONSTRAINT "waiver_seal_acknowledgements_DlT31GsEUgIV_fkey" FOREIGN KEY ("acknowledged_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "waiver_templates" ADD CONSTRAINT "waiver_templates_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "wallet_pass_registrations" ADD CONSTRAINT "wallet_pass_registrations_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "wallet_pass_registrations" ADD CONSTRAINT "wallet_registrations_shop_pass_fk" FOREIGN KEY ("shop_id","pass_id") REFERENCES "wallet_passes"("shop_id","id");--> statement-breakpoint
ALTER TABLE "wallet_passes" ADD CONSTRAINT "wallet_passes_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "wallet_passes" ADD CONSTRAINT "wallet_passes_shop_booking_fk" FOREIGN KEY ("shop_id","booking_id") REFERENCES "bookings"("shop_id","id");--> statement-breakpoint
ALTER TABLE "website_setup_drafts" ADD CONSTRAINT "website_setup_drafts_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "weekly_digest_sends" ADD CONSTRAINT "weekly_digest_sends_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "weekly_digest_sends" ADD CONSTRAINT "weekly_digest_sends_person_id_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "customer_gear_notices" ADD CONSTRAINT "customer_gear_notices_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "customer_gear_notices" ADD CONSTRAINT "customer_gear_notices_person_id_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "customer_gear_notices" ADD CONSTRAINT "customer_gear_notices_work_order_id_work_orders_id_fkey" FOREIGN KEY ("work_order_id") REFERENCES "work_orders"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "customer_gear_notices" ADD CONSTRAINT "customer_gear_notices_d071sGz7b9pz_fkey" FOREIGN KEY ("work_order_event_id") REFERENCES "work_order_events"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "customer_gear_notices" ADD CONSTRAINT "customer_gear_notices_qCgVQSEJoKL1_fkey" FOREIGN KEY ("customer_gear_item_id") REFERENCES "customer_gear_items"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "customer_gear_notices" ADD CONSTRAINT "customer_gear_notices_sent_by_person_id_people_id_fkey" FOREIGN KEY ("sent_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "customer_gear_reminder_settings" ADD CONSTRAINT "customer_gear_reminder_settings_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "customer_gear_reminder_settings" ADD CONSTRAINT "customer_gear_reminder_settings_iDw4JOgthZ5q_fkey" FOREIGN KEY ("customer_gear_item_id") REFERENCES "customer_gear_items"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "customer_gear_reminder_settings" ADD CONSTRAINT "customer_gear_reminder_settings_g1kkt2Hcr09S_fkey" FOREIGN KEY ("changed_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "work_order_bills" ADD CONSTRAINT "work_order_bills_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "work_order_bills" ADD CONSTRAINT "work_order_bills_work_order_id_work_orders_id_fkey" FOREIGN KEY ("work_order_id") REFERENCES "work_orders"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "work_order_bills" ADD CONSTRAINT "work_order_bills_order_id_orders_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id");--> statement-breakpoint
ALTER TABLE "work_order_bills" ADD CONSTRAINT "work_order_bills_created_by_person_id_people_id_fkey" FOREIGN KEY ("created_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "customer_gear_items" ADD CONSTRAINT "customer_gear_items_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "customer_gear_items" ADD CONSTRAINT "customer_gear_items_person_id_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "customer_gear_items" ADD CONSTRAINT "customer_gear_items_deleted_by_person_id_people_id_fkey" FOREIGN KEY ("deleted_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "work_order_care" ADD CONSTRAINT "work_order_care_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "work_order_care" ADD CONSTRAINT "work_order_care_work_order_id_work_orders_id_fkey" FOREIGN KEY ("work_order_id") REFERENCES "work_orders"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "work_order_care" ADD CONSTRAINT "work_order_care_Io8cAocyVQ75_fkey" FOREIGN KEY ("customer_gear_item_id") REFERENCES "customer_gear_items"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "work_order_events" ADD CONSTRAINT "work_order_events_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "work_order_events" ADD CONSTRAINT "work_order_events_work_order_id_work_orders_id_fkey" FOREIGN KEY ("work_order_id") REFERENCES "work_orders"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "work_order_events" ADD CONSTRAINT "work_order_events_technician_person_id_people_id_fkey" FOREIGN KEY ("technician_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "work_order_events" ADD CONSTRAINT "work_order_events_actor_person_id_people_id_fkey" FOREIGN KEY ("actor_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "work_order_items" ADD CONSTRAINT "work_order_items_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "work_order_items" ADD CONSTRAINT "work_order_items_work_order_id_work_orders_id_fkey" FOREIGN KEY ("work_order_id") REFERENCES "work_orders"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "work_order_items" ADD CONSTRAINT "work_order_items_blltFGTz6mNk_fkey" FOREIGN KEY ("customer_gear_item_id") REFERENCES "customer_gear_items"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "work_order_lines" ADD CONSTRAINT "work_order_lines_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "work_order_lines" ADD CONSTRAINT "work_order_lines_work_order_id_work_orders_id_fkey" FOREIGN KEY ("work_order_id") REFERENCES "work_orders"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_person_id_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_gear_item_id_gear_items_id_fkey" FOREIGN KEY ("gear_item_id") REFERENCES "gear_items"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_technician_person_id_people_id_fkey" FOREIGN KEY ("technician_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_outcome_recorded_by_person_id_people_id_fkey" FOREIGN KEY ("outcome_recorded_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_deleted_by_person_id_people_id_fkey" FOREIGN KEY ("deleted_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
CREATE VIEW "booking_payments" AS (select distinct on (shop_id, booking_id) id, shop_id, booking_id, status, amount_cents, currency, provider, provider_ref, note, method, recorded_by_person_id, occurred_at as updated_at, created_at, manual_held_cents from booking_payment_events order by shop_id, booking_id, occurred_at desc, seq desc);--> statement-breakpoint
-- Hand-written from here down: drizzle-kit cannot express any of it.
--
-- Names sort the way a reader expects without a COLLATE in any query: the
-- database default is `C` (byte order) on PGlite and whatever initdb was handed
-- on a server, and the ordered name lists feed `offsetPage`, where a wrong
-- order is a wrong page one. drizzle-orm's pg-core cannot express a column
-- collation, and drizzle-kit only reports the delta, so these statements are the
-- source of truth (person names: 20260911200158_person-name-collation; site,
-- gear and course names: 20261010081009_site-gear-course-collation, issue
-- #1708). `und-x-icu` is deterministic, so equality and unique indexes stay
-- byte equality. On these empty tables the type change is catalog-only.
ALTER TABLE "people" ALTER COLUMN "full_name" SET DATA TYPE text COLLATE "und-x-icu";--> statement-breakpoint
ALTER TABLE "dive_sites" ALTER COLUMN "name" SET DATA TYPE text COLLATE "und-x-icu";--> statement-breakpoint
ALTER TABLE "gear_items" ALTER COLUMN "label" SET DATA TYPE text COLLATE "und-x-icu";--> statement-breakpoint
ALTER TABLE "courses" ALTER COLUMN "title" SET DATA TYPE text COLLATE "und-x-icu";--> statement-breakpoint
--
-- ADR 20260815-minimal-gear-register: a gear item can be held by at most one
-- open reservation over any overlapping inclusive [reserved_from,
-- reserved_until] date range. A returned or released row no longer holds the
-- item (issue #2258). Violations surface as SQLSTATE 23P01; see
-- violatesExclusionConstraint in src/db/client.ts.
ALTER TABLE "gear_reservations" ADD CONSTRAINT "gear_reservations_no_overlap" EXCLUDE USING gist ("gear_item_id" WITH =, daterange("reserved_from", "reserved_until", '[]') WITH &&) WHERE ("returned_at" IS NULL AND "released_at" IS NULL);--> statement-breakpoint
-- A booking link binds only its row id and purpose (issue #2711, ADR
-- 20261104-derived-booking-link-tokens); everything else it opens is read from
-- the row. So the row's identity never changes after insert: marking the
-- browser's link delivered would give it the emailed link's reach, and
-- repointing a row would carry a live link across bookings. Revocation, expiry
-- and a receipt's device generation stay writable; revocation only one way.
CREATE FUNCTION "booking_capabilities_identity_is_fixed"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."id" IS DISTINCT FROM OLD."id"
    OR NEW."shop_id" IS DISTINCT FROM OLD."shop_id"
    OR NEW."booking_id" IS DISTINCT FROM OLD."booking_id"
    OR NEW."purpose" IS DISTINCT FROM OLD."purpose"
    OR NEW."delivered" IS DISTINCT FROM OLD."delivered"
    OR NEW."key_version" IS DISTINCT FROM OLD."key_version"
    OR NEW."source_capability_id" IS DISTINCT FROM OLD."source_capability_id" THEN
    RAISE EXCEPTION 'booking_capabilities identity columns are immutable' USING ERRCODE = 'check_violation';
  END IF;
  -- Revocation is one-way: cancellation, a claim, a merge and erasure all promise a dead link stays dead.
  IF OLD."revoked_at" IS NOT NULL AND NEW."revoked_at" IS NULL THEN
    RAISE EXCEPTION 'booking_capabilities rows cannot be un-revoked' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "booking_capabilities_identity_is_fixed" BEFORE UPDATE ON "booking_capabilities" FOR EACH ROW EXECUTE FUNCTION "booking_capabilities_identity_is_fixed"();
