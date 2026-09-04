-- The baseline. One migration describing the whole schema, replacing the 202
-- incremental migrations that stood here until 2026-09-04 (issue #1343).
--
-- It deliberately **reuses the first migration's folder name**, and that is the
-- mechanism rather than a cosmetic choice: drizzle's `getMigrationsToRun`
-- (drizzle-orm/migrator.utils.js) filters local migrations against a Set of the
-- `name` column in `__drizzle_migrations` — not a hash, not a timestamp. So a
-- database that already applied `20260721131359_cheerful_masque` skips this file
-- untouched, and only a virgin database runs it. Renaming this folder breaks
-- that, and would re-run the whole schema against a populated database.
--
-- Two extensions and one constraint below are hand-written: `drizzle-kit
-- generate` reads `src/db/schema.ts`, which cannot express either. They are
-- carried verbatim from the migrations they were introduced in, with their
-- original reasoning. The 16 `UPDATE`s, 2 `INSERT`s and 6 `DO $$` preflight
-- blocks that the old set also carried are deliberately **not** here: every one
-- of them backfilled or validated rows that existed at the time, and a baseline
-- creates empty tables.
--
-- CR-018: back the leading-wildcard `ilike '%query%'` search in
-- src/db/search.ts and src/db/divers.ts with real trigram-similarity GIN
-- indexes instead of the full-scan they were doing under a comment that
-- claimed (incorrectly) they were already indexed. Standard Postgres
-- contrib extension — available on Neon and loaded explicitly for PGlite
-- (see src/db/client.ts).
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
-- ADR 20260815-minimal-gear-register: btree_gist supplies the gist opclass
-- for `uuid =` so the EXCLUDE constraint at the bottom of this file can pair
-- it with a daterange overlap check. Standard Postgres contrib extension —
-- available on Neon and loaded explicitly for PGlite (see src/db/client.ts).
CREATE EXTENSION IF NOT EXISTS btree_gist;--> statement-breakpoint
CREATE TYPE "account_status" AS ENUM('invited', 'active', 'disabled');--> statement-breakpoint
CREATE TYPE "account_token_purpose" AS ENUM('email_verification', 'password_reset', 'invite');--> statement-breakpoint
CREATE TYPE "backup_delivery_status" AS ENUM('started', 'succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "backup_delivery_trigger" AS ENUM('scheduled', 'manual');--> statement-breakpoint
CREATE TYPE "blowout_message_status" AS ENUM('pending', 'sending', 'sent', 'queued', 'failed', 'no_email');--> statement-breakpoint
CREATE TYPE "booking_capability_purpose" AS ENUM('readiness', 'confirm', 'claim');--> statement-breakpoint
CREATE TYPE "booking_status" AS ENUM('booked', 'checked_in', 'cancelled', 'no_show');--> statement-breakpoint
CREATE TYPE "brand_display_font" AS ENUM('bricolage_grotesque', 'outfit', 'sora', 'playfair_display', 'archivo_black', 'lora');--> statement-breakpoint
CREATE TYPE "buddy_team_event_action" AS ENUM('formed', 'dissolved', 'member_added', 'member_removed');--> statement-breakpoint
CREATE TYPE "calendar_feed_scope" AS ENUM('assignments', 'shop_trips');--> statement-breakpoint
CREATE TYPE "certification_agency" AS ENUM('padi', 'ssi', 'naui', 'sdi', 'tdi', 'cmas', 'raid', 'gue', 'bsac', 'other');--> statement-breakpoint
CREATE TYPE "certification_level" AS ENUM('open_water', 'advanced_open_water', 'rescue', 'divemaster', 'instructor');--> statement-breakpoint
CREATE TYPE "certification_status" AS ENUM('pending', 'verified');--> statement-breakpoint
CREATE TYPE "checkout_status" AS ENUM('pending', 'completed', 'expired');--> statement-breakpoint
CREATE TYPE "course_inquiry_experience" AS ENUM('never', 'tried', 'certified', 'lapsed');--> statement-breakpoint
CREATE TYPE "crew_request_decision" AS ENUM('approved', 'declined');--> statement-breakpoint
CREATE TYPE "depth_unit" AS ENUM('meters', 'feet');--> statement-breakpoint
CREATE TYPE "dive_mode" AS ENUM('boat', 'shore', 'pool');--> statement-breakpoint
CREATE TYPE "dive_package_scope" AS ENUM('all', 'fun_dives');--> statement-breakpoint
CREATE TYPE "dive_recency_band" AS ENUM('this_season', 'within_a_year', 'one_to_five_years', 'over_five_years', 'never');--> statement-breakpoint
CREATE TYPE "dive_site_difficulty" AS ENUM('beginner', 'intermediate', 'advanced');--> statement-breakpoint
CREATE TYPE "dive_site_fit_tone" AS ENUM('welcoming', 'demanding', 'unknown');--> statement-breakpoint
CREATE TYPE "dive_specialty" AS ENUM('deep', 'wreck', 'night', 'drysuit');--> statement-breakpoint
CREATE TYPE "gear_item_kind" AS ENUM('bcd', 'regulator', 'wetsuit', 'boots', 'mask', 'fins', 'weights', 'dive_computer', 'gopro', 'tank', 'drysuit', 'hood', 'gloves', 'torch', 'dpv', 'smb', 'reel', 'camera', 'nitrox_analyzer', 'o2_kit', 'other');--> statement-breakpoint
CREATE TYPE "gear_item_status" AS ENUM('in_service', 'needs_service');--> statement-breakpoint
CREATE TYPE "gear_return_outcome" AS ENUM('all_good', 'fit_adjusted', 'service_concern');--> statement-breakpoint
CREATE TYPE "gear_service_kind" AS ENUM('service', 'hydro_test', 'visual_inspection', 'o2_clean', 'note');--> statement-breakpoint
CREATE TYPE "imported_payment_direction" AS ENUM('payment', 'refund', 'unknown');--> statement-breakpoint
CREATE TYPE "integration_connection_status" AS ENUM('connected', 'error');--> statement-breakpoint
CREATE TYPE "integration_delivery_status" AS ENUM('pending', 'processing', 'delivered', 'failed');--> statement-breakpoint
CREATE TYPE "integration_provider" AS ENUM('shopify', 'quickbooks', 'zapier');--> statement-breakpoint
CREATE TYPE "media_deletion_kind" AS ENUM('course_photo', 'recap_photo', 'certification_card', 'waiver_document', 'dive_site_photo', 'shop_logo', 'arrival_photo', 'shop_hero');--> statement-breakpoint
CREATE TYPE "media_deletion_status" AS ENUM('pending', 'succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "medical_jurisdiction" AS ENUM('rstc', 'uk');--> statement-breakpoint
CREATE TYPE "notification_delivery_status" AS ENUM('sent', 'failed', 'not_configured');--> statement-breakpoint
CREATE TYPE "notification_kind" AS ENUM('booking_confirmation', 'waiver_request', 'readiness_link', 'trip_reminder_7d', 'trip_reminder_24h', 'trip_recap', 'trip_blowout', 'trip_minimum_not_met');--> statement-breakpoint
CREATE TYPE "notification_provider_status" AS ENUM('sent', 'delivered', 'delivery_delayed', 'bounced', 'complained', 'failed', 'suppressed');--> statement-breakpoint
CREATE TYPE "notification_queue_status" AS ENUM('queued', 'processing', 'sent', 'failed');--> statement-breakpoint
CREATE TYPE "order_line_item_kind" AS ENUM('trip_fee', 'course_fee', 'e_learning_fee', 'rental', 'nitrox', 'deposit', 'dive_package', 'pass_through_fee', 'merchandise', 'other');--> statement-breakpoint
CREATE TYPE "order_status" AS ENUM('open', 'paid', 'void', 'uncollectible', 'partly_refunded', 'refunded');--> statement-breakpoint
CREATE TYPE "payment_event_operation" AS ENUM('manual_mark', 'checkout_settled', 'order_settled', 'package_consumed', 'package_released', 'order_refunded', 'cancellation_refund', 'shop_cancellation_refund');--> statement-breakpoint
CREATE TYPE "payment_operation_kind" AS ENUM('checkout_session', 'invoice', 'refund');--> statement-breakpoint
CREATE TYPE "payment_operation_status" AS ENUM('started', 'succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "payment_status" AS ENUM('unpaid', 'deposit_paid', 'paid', 'waived', 'partly_refunded', 'refunded');--> statement-breakpoint
CREATE TYPE "person_role" AS ENUM('owner', 'manager', 'instructor', 'divemaster', 'captain', 'crew', 'diver');--> statement-breakpoint
CREATE TYPE "pre_departure_check_status" AS ENUM('checked', 'cleared');--> statement-breakpoint
CREATE TYPE "processor_erasure_status" AS ENUM('owed', 'discharged');--> statement-breakpoint
CREATE TYPE "processor_erasure_target" AS ENUM('stripe_customer', 'stripe_invoice_snapshot');--> statement-breakpoint
CREATE TYPE "review_moderation_action" AS ENUM('published', 'hidden');--> statement-breakpoint
CREATE TYPE "review_moderation_reason" AS ENUM('abusive', 'names_a_person', 'wrong_subject', 'spam', 'other');--> statement-breakpoint
CREATE TYPE "roll_call_source" AS ENUM('live', 'offline');--> statement-breakpoint
CREATE TYPE "roll_call_status" AS ENUM('boarded', 'not_boarded', 'cleared');--> statement-breakpoint
CREATE TYPE "security_step_up_purpose" AS ENUM('money', 'export', 'backup');--> statement-breakpoint
CREATE TYPE "shop_promo_scope" AS ENUM('all', 'trips', 'courses');--> statement-breakpoint
CREATE TYPE "shop_promo_status" AS ENUM('pending', 'active', 'disabled', 'failed');--> statement-breakpoint
CREATE TYPE "staff_credential_kind" AS ENUM('instructor_rating', 'divemaster_rating', 'liability_insurance', 'first_aid_cpr', 'oxygen_provider', 'captains_licence', 'other');--> statement-breakpoint
CREATE TYPE "temperature_unit" AS ENUM('celsius', 'fahrenheit');--> statement-breakpoint
CREATE TYPE "tip_status" AS ENUM('pending', 'paid', 'expired');--> statement-breakpoint
CREATE TYPE "trip_assignment_role" AS ENUM('instructor', 'divemaster', 'captain', 'crew');--> statement-breakpoint
CREATE TYPE "trip_change_event_kind" AS ENUM('meeting_point', 'conditions');--> statement-breakpoint
CREATE TYPE "trip_change_event_source" AS ENUM('shop', 'crew');--> statement-breakpoint
CREATE TYPE "trip_help_request_kind" AS ENUM('carry_gear', 'first_timer', 'find_group');--> statement-breakpoint
CREATE TYPE "trip_help_request_status" AS ENUM('requested', 'acknowledged', 'handled', 'withdrawn');--> statement-breakpoint
CREATE TYPE "trip_invitation_source" AS ENUM('date_request', 'waitlist', 'direct');--> statement-breakpoint
CREATE TYPE "trip_last_minute_promo_status" AS ENUM('pending', 'sent', 'failed');--> statement-breakpoint
CREATE TYPE "trip_recurrence_frequency" AS ENUM('weekly');--> statement-breakpoint
CREATE TYPE "trip_status" AS ENUM('scheduled', 'cancelled');--> statement-breakpoint
CREATE TYPE "waiver_delivery_channel" AS ENUM('email', 'text', 'link');--> statement-breakpoint
CREATE TYPE "waiver_record_status" AS ENUM('pending', 'completed', 'medical_review');--> statement-breakpoint
CREATE TABLE "account_security" (
	"user_account_id" uuid PRIMARY KEY,
	"totp_secret_sealed" text,
	"totp_enabled_at" timestamp with time zone,
	"recovery_code_hashes" jsonb DEFAULT '[]' NOT NULL,
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
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
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
CREATE TABLE "account_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"user_account_id" uuid NOT NULL,
	"purpose" "account_token_purpose" NOT NULL,
	"token_hash" text NOT NULL UNIQUE,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"superseded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "activity_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"trip_id" uuid,
	"booking_id" uuid,
	"actor_person_id" uuid NOT NULL,
	"subject_person_id" uuid,
	"message" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"seq" bigserial,
	CONSTRAINT "activity_events_message_not_blank" CHECK (length(trim("message")) > 0)
);
--> statement-breakpoint
CREATE TABLE "auth_provider_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"user_account_id" uuid NOT NULL,
	"provider_id" text NOT NULL,
	"account_id" text NOT NULL,
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
CREATE TABLE "boats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"name" text NOT NULL,
	"capacity" integer NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "booking_capabilities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"booking_id" uuid NOT NULL,
	"purpose" "booking_capability_purpose" NOT NULL,
	"token_hash" text NOT NULL UNIQUE,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
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
	"stripe_account_id" text NOT NULL,
	"stripe_session_id" text NOT NULL,
	"checkout_url" text,
	"customer_email" text,
	"abandoned_recovery_sent_at" timestamp with time zone,
	"promo_code_id" uuid,
	"trip_promo_id" uuid,
	"promo_code" text,
	"applied_discount_percent" integer,
	"currency" text NOT NULL,
	"amount_per_diver_cents" integer NOT NULL,
	"total_cents" integer NOT NULL,
	"pass_through_cents" integer DEFAULT 0 NOT NULL,
	"tax_enabled" boolean DEFAULT false NOT NULL,
	"tax_cents" integer,
	"settled_total_cents" integer,
	"is_deposit" boolean DEFAULT false NOT NULL,
	"expires_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"async_payment_failed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "booking_checkouts_amount_per_diver_nonnegative" CHECK ("amount_per_diver_cents" >= 0),
	CONSTRAINT "booking_checkouts_total_nonnegative" CHECK ("total_cents" >= 0),
	CONSTRAINT "booking_checkouts_pass_through_nonnegative" CHECK ("pass_through_cents" >= 0),
	CONSTRAINT "booking_checkouts_settled_total_nonnegative" CHECK ("settled_total_cents" is null or "settled_total_cents" >= 0),
	CONSTRAINT "booking_checkouts_tax_nonnegative" CHECK ("tax_cents" is null or "tax_cents" >= 0),
	CONSTRAINT "booking_checkouts_applied_discount_range" CHECK ("applied_discount_percent" is null or "applied_discount_percent" between 1 and 100),
	CONSTRAINT "booking_checkouts_single_promo_source" CHECK ("promo_code_id" is null or "trip_promo_id" is null)
);
--> statement-breakpoint
CREATE TABLE "booking_payment_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"booking_id" uuid NOT NULL,
	"status" "payment_status" NOT NULL,
	"previous_status" "payment_status",
	"amount_cents" integer,
	"currency" text NOT NULL,
	"provider" text,
	"provider_ref" text,
	"operation" "payment_event_operation" NOT NULL,
	"note" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "booking_payment_events_amount_nonnegative" CHECK ("amount_cents" is null or "amount_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "booking_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"booking_id" uuid NOT NULL,
	"status" "payment_status" DEFAULT 'unpaid'::"payment_status" NOT NULL,
	"amount_cents" integer,
	"currency" text NOT NULL,
	"provider" text,
	"provider_ref" text,
	"note" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "booking_payments_amount_nonnegative" CHECK ("amount_cents" is null or "amount_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"trip_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"wants_nitrox" boolean DEFAULT false NOT NULL,
	"conditions_briefed_at" timestamp with time zone,
	"last_dived_band" "dive_recency_band",
	"group_preference" text,
	"hotel_pickup_location" text,
	"pickup_time" text,
	"status" "booking_status" DEFAULT 'booked'::"booking_status" NOT NULL,
	"pending_checkout_intent_id" uuid,
	"identity_unconfirmed_at" timestamp with time zone,
	"party_lead_booking_id" uuid,
	"claimed_at" timestamp with time zone,
	"referral_source" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "buddy_pair_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"trip_id" uuid NOT NULL,
	"pair_id" uuid NOT NULL,
	"booking_id" uuid,
	"crew_person_id" uuid,
	"paired_by_person_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "buddy_pair_members_one_subject" CHECK (("booking_id" is not null) <> ("crew_person_id" is not null))
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
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "calendar_feeds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"scope" "calendar_feed_scope" NOT NULL,
	"token_hash" text NOT NULL UNIQUE,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_accessed_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "certifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"agency" "certification_agency" NOT NULL,
	"level" "certification_level" NOT NULL,
	"identifier" text,
	"declared_identifier" text,
	"status" "certification_status" DEFAULT 'pending'::"certification_status" NOT NULL,
	"review_note" text,
	"reviewed_at" timestamp with time zone,
	"reviewed_by_person_id" uuid,
	"imported_at" timestamp with time zone,
	"imported_from_label" text,
	"self_declared_at" timestamp with time zone,
	"issued_by_shop_at" timestamp with time zone,
	"issued_from_trip_id" uuid,
	"issued_by_person_id" uuid,
	"deleted_at" timestamp with time zone,
	"deleted_by_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "certifications_identifier_present_unless_self_declared" CHECK (("identifier" is not null and length(btrim("identifier", E' \t\n\r\f\v')) > 0) or ("self_declared_at" is not null and "status" = 'pending') or ("issued_by_shop_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "closeout_leftover_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"shop_day" text NOT NULL,
	"action_id" text NOT NULL,
	"decision" text NOT NULL,
	"actor_person_id" uuid NOT NULL,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL,
	"seq" bigserial,
	CONSTRAINT "closeout_leftover_decisions_shop_day_format" CHECK ("shop_day" ~ '^\d{4}-\d{2}-\d{2}$'),
	CONSTRAINT "closeout_leftover_decisions_value" CHECK ("decision" in ('carry', 'dismiss')),
	CONSTRAINT "closeout_leftover_decisions_action_id_nonempty" CHECK (length("action_id") > 0)
);
--> statement-breakpoint
CREATE TABLE "course_inquiries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"course_id" uuid,
	"interest" text,
	"preferred_date" date,
	"alternate_date" date,
	"date_flexible" boolean DEFAULT false NOT NULL,
	"person_id" uuid,
	"name" text,
	"email" text,
	"phone" text,
	"experience_level" "course_inquiry_experience",
	"timing" text,
	"divers" integer,
	"message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "course_inquiries_subject_present" CHECK ("course_id" is not null or length(btrim(coalesce("interest", ''))) > 0)
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
	"price_cents" integer,
	"e_learning_price_cents" integer,
	"private_price_cents" integer,
	"minimum_certification_level" "certification_level",
	"is_active" boolean DEFAULT true NOT NULL,
	"is_intro_course" boolean DEFAULT false NOT NULL,
	"nitrox_compatible" boolean DEFAULT true NOT NULL,
	"row_version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
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
	"created_by_person_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "crew_availability_blocks_ends_on_or_after" CHECK ("ends_on" >= "starts_on")
);
--> statement-breakpoint
CREATE TABLE "day_closeouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"shop_day" text NOT NULL,
	"actor_person_id" uuid NOT NULL,
	"closed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"outstanding" jsonb NOT NULL,
	"seq" bigserial,
	CONSTRAINT "day_closeouts_shop_day_format" CHECK ("shop_day" ~ '^\d{4}-\d{2}-\d{2}$')
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
CREATE TABLE "dive_site_creatures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"dive_site_id" uuid NOT NULL,
	"catalog_slug" text,
	"position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dive_site_moments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"dive_site_id" uuid NOT NULL,
	"caption" text NOT NULL,
	"image_url" text,
	"is_published" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dive_sites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"source_template_id" uuid,
	"source_template_version" integer,
	"template_update_undo" jsonb,
	"name" text NOT NULL,
	"description" text,
	"location_name" text,
	"forecast_latitude" double precision,
	"forecast_longitude" double precision,
	"satellite_image_url" text,
	"route_image_url" text,
	"image_urls" jsonb DEFAULT '[]' NOT NULL,
	"marine_life" text,
	"marine_life_description" text,
	"conservation_note" text,
	"difficulty_level" "dive_site_difficulty",
	"depth_range" text,
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
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dive_sites_expected_bottom_time_positive" CHECK ("expected_bottom_time_minutes" is null or "expected_bottom_time_minutes" > 0)
);
--> statement-breakpoint
CREATE TABLE "dive_support_needs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"support_divers_needed" integer,
	"support_divers_provided_by" text,
	"needs_boarding_assistance" boolean DEFAULT false NOT NULL,
	"needs_water_lift" boolean DEFAULT false NOT NULL,
	"briefing_in_sign" boolean DEFAULT false NOT NULL,
	"briefing_in_writing" boolean DEFAULT false NOT NULL,
	"briefing_aloud" boolean DEFAULT false NOT NULL,
	"briefing_by_signals" boolean DEFAULT false NOT NULL,
	"equipment_adaptation" text,
	"dives_with_name" text,
	"stated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dive_support_needs_support_divers_range" CHECK ("support_divers_needed" is null or ("support_divers_needed" between 0 and 4)),
	CONSTRAINT "dive_support_needs_provider_pairs_with_count" CHECK ((coalesce("support_divers_needed", 0) > 0) = ("support_divers_provided_by" is not null))
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
	"recorded_by_person_id" uuid,
	"deleted_at" timestamp with time zone,
	"deleted_by_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "executed_dives_number_positive" CHECK ("dive_number" >= 1),
	CONSTRAINT "executed_dives_depth_nonnegative" CHECK ("max_depth_meters" is null or "max_depth_meters" >= 0),
	CONSTRAINT "executed_dives_exit_after_entry" CHECK ("entered_at" is null or "exited_at" is null or "exited_at" > "entered_at")
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
	"deleted_at" timestamp with time zone,
	"deleted_by_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gear_reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"gear_item_id" uuid NOT NULL,
	"person_id" uuid,
	"booking_id" uuid,
	"reserved_from" date NOT NULL,
	"reserved_until" date NOT NULL,
	"checked_out_at" timestamp with time zone,
	"returned_at" timestamp with time zone,
	"return_outcome" "gear_return_outcome",
	"return_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gear_reservations_window" CHECK ("reserved_until" >= "reserved_from"),
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
	"last_synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
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
	CONSTRAINT "internal_notes_body_not_blank" CHECK (length(trim("body")) > 0)
);
--> statement-breakpoint
CREATE TABLE "last_minute_list_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"available_from" date,
	"available_until" date,
	"unsubscribed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "last_minute_list_entries_range" CHECK ("available_from" is null or "available_until" is null or "available_from" <= "available_until")
);
--> statement-breakpoint
CREATE TABLE "last_minute_list_unsubscribe_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"entry_id" uuid NOT NULL,
	"token_hash" text NOT NULL UNIQUE,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL
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
	"kind" "media_deletion_kind" NOT NULL,
	"url" text NOT NULL,
	"status" "media_deletion_status" DEFAULT 'pending'::"media_deletion_status" NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "nitrox_certifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"agency" "certification_agency" NOT NULL,
	"identifier" text,
	"status" "certification_status" DEFAULT 'pending'::"certification_status" NOT NULL,
	"review_note" text,
	"reviewed_at" timestamp with time zone,
	"reviewed_by_person_id" uuid,
	"imported_at" timestamp with time zone,
	"imported_from_label" text,
	"self_declared_at" timestamp with time zone,
	"issued_by_shop_at" timestamp with time zone,
	"issued_from_trip_id" uuid,
	"issued_by_person_id" uuid,
	"deleted_at" timestamp with time zone,
	"deleted_by_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "nitrox_certifications_identifier_present_unless_self_declared" CHECK (("identifier" is not null and length(btrim("identifier", E' \t\n\r\f\v')) > 0) or ("self_declared_at" is not null and "status" = 'pending') or ("issued_by_shop_at" is not null and "status" = 'pending'))
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
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_delivery_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"booking_id" uuid NOT NULL,
	"kind" "notification_kind" NOT NULL,
	"status" "notification_delivery_status" NOT NULL,
	"provider_message_id" text,
	"send_http_status" integer,
	"send_error_code" text,
	"send_error" text,
	"is_retry" boolean DEFAULT false NOT NULL,
	"attempted_at" timestamp with time zone NOT NULL,
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
	"status" "notification_queue_status" DEFAULT 'queued'::"notification_queue_status" NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone NOT NULL,
	"locked_until" timestamp with time zone,
	"provider_message_id" text,
	"http_status" integer,
	"error_code" text,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
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
	"person_id" uuid NOT NULL,
	"created_by_person_id" uuid NOT NULL,
	"status" "order_status" DEFAULT 'open'::"order_status" NOT NULL,
	"currency" text NOT NULL,
	"total_cents" integer NOT NULL,
	"pass_through_cents" integer DEFAULT 0 NOT NULL,
	"tax_cents" integer DEFAULT 0 NOT NULL,
	"amount_paid_cents" integer DEFAULT 0 NOT NULL,
	"refunded_cents" integer DEFAULT 0 NOT NULL,
	"description" text,
	"stripe_account_id" text NOT NULL,
	"stripe_customer_id" text NOT NULL,
	"stripe_invoice_id" text NOT NULL,
	"hosted_invoice_url" text,
	"invoice_pdf_url" text,
	"finalized_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"voided_at" timestamp with time zone,
	"refunded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_total_nonnegative" CHECK ("total_cents" >= 0),
	CONSTRAINT "orders_pass_through_nonnegative" CHECK ("pass_through_cents" >= 0),
	CONSTRAINT "orders_tax_nonnegative" CHECK ("tax_cents" >= 0),
	CONSTRAINT "orders_amount_paid_nonnegative" CHECK ("amount_paid_cents" >= 0),
	CONSTRAINT "orders_refunded_nonnegative" CHECK ("refunded_cents" >= 0)
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
	"stripe_object_id" text,
	"error_message" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "people" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"full_name" text NOT NULL,
	"email" text,
	"phone" text,
	"emergency_contact_name" text,
	"emergency_contact_phone" text,
	"date_of_birth" date,
	"dive_insurance" text,
	"no_certification_declared_at" timestamp with time zone,
	"no_certification_cleared_at" timestamp with time zone,
	"no_certification_cleared_by_person_id" uuid,
	"locale" text,
	"spoken_languages" jsonb DEFAULT '[]' NOT NULL,
	"crew_public_consent_at" timestamp with time zone,
	"crew_public_name" text,
	"courtesy_email_opt_out_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"self_registered_at" timestamp with time zone,
	"anonymized_at" timestamp with time zone,
	"anonymized_by_person_id" uuid,
	"merged_into_person_id" uuid,
	"merged_at" timestamp with time zone,
	"merged_by_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "people_anonymized_stays_removed" CHECK ("anonymized_at" is null or "deleted_at" is not null),
	CONSTRAINT "people_merged_stays_removed" CHECK ("merged_into_person_id" is null or "deleted_at" is not null),
	CONSTRAINT "people_merge_metadata_complete" CHECK (("merged_into_person_id" is null and "merged_at" is null and "merged_by_person_id" is null) or ("merged_into_person_id" is not null and "merged_at" is not null and "merged_by_person_id" is not null)),
	CONSTRAINT "people_cannot_merge_into_self" CHECK ("merged_into_person_id" is null or "merged_into_person_id" <> "id"),
	CONSTRAINT "people_crew_public_name_with_consent" CHECK (("crew_public_consent_at" is null) = (nullif(btrim("crew_public_name"), '') is null))
);
--> statement-breakpoint
CREATE TABLE "person_courtesy_email_unsubscribe_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"token_hash" text NOT NULL UNIQUE,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "person_roles" (
	"person_id" uuid,
	"role" "person_role",
	CONSTRAINT "person_roles_pkey" PRIMARY KEY("person_id","role")
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
CREATE TABLE "recap_photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"booking_id" uuid NOT NULL,
	"trip_id" uuid NOT NULL,
	"image_url" text NOT NULL,
	"caption" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rental_fit_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"rents_bcd" boolean DEFAULT true NOT NULL,
	"rents_regulator" boolean DEFAULT true NOT NULL,
	"rents_wetsuit" boolean DEFAULT true NOT NULL,
	"rents_mask_fins" boolean DEFAULT true NOT NULL,
	"rents_weights" boolean DEFAULT true NOT NULL,
	"rents_dive_computer" boolean DEFAULT false NOT NULL,
	"rents_gopro" boolean DEFAULT false NOT NULL,
	"bcd_size" text,
	"wetsuit_size" text,
	"boot_size" text,
	"fin_size" text,
	"weight_preference" text,
	"note" text,
	"fit_stated_at" timestamp with time zone,
	"needs_staff_fit_at" timestamp with time zone,
	"needs_staff_fit_note" text,
	"needs_staff_fit_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
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
CREATE TABLE "roll_call_crew_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"trip_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"recorded_by_person_id" uuid NOT NULL,
	"status" "roll_call_status" NOT NULL,
	"checkpoint" text NOT NULL,
	"source" "roll_call_source" DEFAULT 'live'::"roll_call_source" NOT NULL,
	"client_event_id" uuid,
	"note" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"seq" bigserial
);
--> statement-breakpoint
CREATE TABLE "roll_call_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"trip_id" uuid NOT NULL,
	"booking_id" uuid NOT NULL,
	"recorded_by_person_id" uuid NOT NULL,
	"status" "roll_call_status" NOT NULL,
	"checkpoint" text DEFAULT 'departure' NOT NULL,
	"source" "roll_call_source" DEFAULT 'live'::"roll_call_source" NOT NULL,
	"client_event_id" uuid,
	"offline_snapshot_saved_at" timestamp with time zone,
	"note" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"seq" bigserial
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
CREATE TABLE "shop_promo_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"code" text NOT NULL,
	"description" text,
	"discount_percent" integer NOT NULL,
	"scope" "shop_promo_scope" DEFAULT 'all'::"shop_promo_scope" NOT NULL,
	"status" "shop_promo_status" DEFAULT 'pending'::"shop_promo_status" NOT NULL,
	"starts_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"max_redemptions" integer,
	"stripe_coupon_id" text,
	"stripe_promotion_code_id" text,
	"created_by_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shop_promo_codes_discount_range" CHECK ("discount_percent" between 1 and 100),
	CONSTRAINT "shop_promo_codes_max_redemptions_positive" CHECK ("max_redemptions" is null or "max_redemptions" > 0),
	CONSTRAINT "shop_promo_codes_window" CHECK ("starts_at" is null or "expires_at" is null or "starts_at" < "expires_at")
);
--> statement-breakpoint
CREATE TABLE "shop_promo_redemptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"promo_code_id" uuid NOT NULL,
	"checkout_id" uuid NOT NULL,
	"amount_charged_cents" integer NOT NULL,
	"redeemed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shop_stripe_accounts" (
	"shop_id" uuid PRIMARY KEY,
	"stripe_account_id" text NOT NULL,
	"charges_enabled" boolean DEFAULT false NOT NULL,
	"payouts_enabled" boolean DEFAULT false NOT NULL,
	"details_submitted" boolean DEFAULT false NOT NULL,
	"default_currency" text DEFAULT 'usd' NOT NULL,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"disconnected_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
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
	"verified_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shops" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"name" text NOT NULL,
	"slug" text NOT NULL UNIQUE,
	"timezone" text NOT NULL,
	"default_locale" text DEFAULT 'en-US' NOT NULL,
	"currency" text DEFAULT 'usd' NOT NULL,
	"tax_enabled" boolean DEFAULT false NOT NULL,
	"pass_through_fee" jsonb DEFAULT 'null',
	"conservation_commitments" jsonb DEFAULT '[]' NOT NULL,
	"jurisdiction" "medical_jurisdiction" DEFAULT 'rstc'::"medical_jurisdiction" NOT NULL,
	"depth_unit" "depth_unit" DEFAULT 'meters'::"depth_unit" NOT NULL,
	"temperature_unit" "temperature_unit" DEFAULT 'celsius'::"temperature_unit" NOT NULL,
	"has_boat_diving" boolean DEFAULT true NOT NULL,
	"has_shore_diving" boolean DEFAULT false NOT NULL,
	"has_pool_diving" boolean DEFAULT false NOT NULL,
	"divers_per_divemaster" integer DEFAULT 6 NOT NULL,
	"contact_email" text,
	"contact_email_confirmed_at" timestamp with time zone,
	"contact_phone" text,
	"review_url" text,
	"address_street" text,
	"address_locality" text,
	"address_region" text,
	"address_postal_code" text,
	"address_country" text,
	"packing_list" jsonb DEFAULT '["Swimsuit and towel","Reef-safe sun protection","Logbook"]' NOT NULL,
	"rental_items" jsonb DEFAULT '["bcd","regulator","wetsuit","mask_fins","weights","dive_computer"]' NOT NULL,
	"rental_pricing" jsonb DEFAULT '{"setCents":null,"perItemCents":{},"nitroxCents":null}' NOT NULL,
	"emergency_reference" jsonb DEFAULT '{"lines":[],"vessel":"","shoreContact":"","plan":""}' NOT NULL,
	"dock_call_minutes" integer DEFAULT 30 NOT NULL,
	"gear_setup_minutes" integer DEFAULT 0 NOT NULL,
	"briefing_minutes" integer DEFAULT 15 NOT NULL,
	"boat_ride_minutes" integer DEFAULT 20 NOT NULL,
	"bottom_time_minutes" integer DEFAULT 45 NOT NULL,
	"surface_interval_minutes" integer DEFAULT 60 NOT NULL,
	"send_window_start_hour" integer DEFAULT 8 NOT NULL,
	"send_window_end_hour" integer DEFAULT 20 NOT NULL,
	"units_confirmed_at" timestamp with time zone,
	"is_demo" boolean DEFAULT false NOT NULL,
	"search_listing_opt_out_at" timestamp with time zone,
	"tagline" text,
	"description" text,
	"logo_url" text,
	"brand_color" text,
	"brand_display_font" "brand_display_font",
	"brand_hero_image_url" text,
	"brand_hero_image_alt" text,
	"established_year" integer,
	"brand_badges" jsonb DEFAULT '[]' NOT NULL,
	"latitude" double precision,
	"longitude" double precision,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shops_dock_call_minutes_nonnegative" CHECK ("dock_call_minutes" >= 0),
	CONSTRAINT "shops_established_year_plausible" CHECK ("established_year" IS NULL OR ("established_year" >= 1900 AND "established_year" <= 2100)),
	CONSTRAINT "shops_brand_color_hex" CHECK ("brand_color" IS NULL OR "brand_color" ~ '^#[0-9a-f]{6}$'),
	CONSTRAINT "shops_gear_setup_minutes_nonnegative" CHECK ("gear_setup_minutes" >= 0),
	CONSTRAINT "shops_briefing_minutes_nonnegative" CHECK ("briefing_minutes" >= 0),
	CONSTRAINT "shops_boat_ride_minutes_nonnegative" CHECK ("boat_ride_minutes" >= 0),
	CONSTRAINT "shops_bottom_time_minutes_positive" CHECK ("bottom_time_minutes" > 0),
	CONSTRAINT "shops_surface_interval_minutes_nonnegative" CHECK ("surface_interval_minutes" >= 0),
	CONSTRAINT "shops_divers_per_divemaster_in_range" CHECK ("divers_per_divemaster" >= 1 and "divers_per_divemaster" <= 20),
	CONSTRAINT "shops_offers_some_dive_mode" CHECK ("has_boat_diving" or "has_shore_diving" or "has_pool_diving")
);
--> statement-breakpoint
CREATE TABLE "specialty_certifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"agency" "certification_agency" NOT NULL,
	"specialty" "dive_specialty" NOT NULL,
	"identifier" text,
	"status" "certification_status" DEFAULT 'pending'::"certification_status" NOT NULL,
	"review_note" text,
	"reviewed_at" timestamp with time zone,
	"reviewed_by_person_id" uuid,
	"imported_at" timestamp with time zone,
	"imported_from_label" text,
	"self_declared_at" timestamp with time zone,
	"issued_by_shop_at" timestamp with time zone,
	"issued_from_trip_id" uuid,
	"issued_by_person_id" uuid,
	"deleted_at" timestamp with time zone,
	"deleted_by_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "specialty_certifications_identifier_present_unless_unsighted" CHECK (("identifier" is not null and length(btrim("identifier", E' \t\n\r\f\v')) > 0) or ("self_declared_at" is not null and "status" = 'pending') or ("issued_by_shop_at" is not null and "status" = 'pending'))
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
CREATE TABLE "stripe_webhook_events" (
	"id" text PRIMARY KEY,
	"type" text NOT NULL,
	"account" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"claimed_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "tips" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"booking_id" uuid NOT NULL,
	"status" "tip_status" DEFAULT 'pending'::"tip_status" NOT NULL,
	"stripe_account_id" text NOT NULL,
	"stripe_session_id" text NOT NULL,
	"checkout_url" text,
	"currency" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"expires_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tips_amount_positive" CHECK ("amount_cents" > 0)
);
--> statement-breakpoint
CREATE TABLE "trip_assignments" (
	"trip_id" uuid,
	"person_id" uuid,
	"trip_role" "trip_assignment_role",
	CONSTRAINT "trip_assignments_pkey" PRIMARY KEY("trip_id","person_id")
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
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
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
CREATE TABLE "trip_help_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"trip_id" uuid NOT NULL,
	"booking_id" uuid NOT NULL,
	"kind" "trip_help_request_kind" NOT NULL,
	"status" "trip_help_request_status" DEFAULT 'requested'::"trip_help_request_status" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"acknowledged_at" timestamp with time zone,
	"handled_at" timestamp with time zone,
	"resolved_by_person_id" uuid
);
--> statement-breakpoint
CREATE TABLE "trip_invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"trip_id" uuid NOT NULL,
	"source" "trip_invitation_source" NOT NULL,
	"course_inquiry_id" uuid,
	"waitlist_entry_id" uuid,
	"person_id" uuid,
	"created_by_person_id" uuid NOT NULL,
	"invited_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trip_invitations_source_reference_check" CHECK ((
        ("source" = 'date_request' and "course_inquiry_id" is not null and "waitlist_entry_id" is null and "person_id" is null)
        or ("source" = 'waitlist' and "course_inquiry_id" is null and "waitlist_entry_id" is not null and "person_id" is null)
        or ("source" = 'direct' and "course_inquiry_id" is null and "waitlist_entry_id" is null and "person_id" is not null)
      ))
);
--> statement-breakpoint
CREATE TABLE "trip_last_minute_promo_recipients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"trip_promo_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"email" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trip_last_minute_promos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"trip_id" uuid NOT NULL,
	"status" "trip_last_minute_promo_status" DEFAULT 'pending'::"trip_last_minute_promo_status" NOT NULL,
	"discount_percent" integer NOT NULL,
	"code" text NOT NULL,
	"stripe_coupon_id" text,
	"stripe_promotion_code_id" text,
	"expires_at" timestamp with time zone NOT NULL,
	"recipient_count" integer DEFAULT 0 NOT NULL,
	"created_by_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trip_last_minute_promos_discount_range" CHECK ("discount_percent" between 5 and 90)
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
CREATE TABLE "trip_requirements" (
	"trip_id" uuid PRIMARY KEY,
	"shop_id" uuid NOT NULL,
	"requires_waiver" boolean DEFAULT true NOT NULL,
	"minimum_certification_level" "certification_level",
	"required_specialties" jsonb DEFAULT '[]' NOT NULL,
	"requires_nitrox" boolean DEFAULT false NOT NULL,
	"requires_payment" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
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
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trip_reviews_rating_range" CHECK ("rating" between 1 and 5)
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
CREATE TABLE "trip_waitlist_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"trip_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"invited_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "trips" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"series_id" uuid,
	"series_occurrence_date" text,
	"dive_site_id" uuid,
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
	"planned_dives" integer DEFAULT 2 NOT NULL,
	"price_cents" integer,
	"deposit_cents" integer,
	"cancellation_window_hours" integer,
	"minimum_bookings" integer,
	"minimum_decision_hours" integer,
	"status" "trip_status" DEFAULT 'scheduled'::"trip_status" NOT NULL,
	"cancelled_at" timestamp with time zone,
	"conditions_hold" boolean DEFAULT false NOT NULL,
	"is_private" boolean DEFAULT false NOT NULL,
	"self_guided" boolean DEFAULT false NOT NULL,
	"dive_mode" "dive_mode" DEFAULT 'boat'::"dive_mode" NOT NULL,
	"boat_id" uuid,
	"conditions_summary" text,
	"water_temperature_c" double precision,
	"visibility_meters" double precision,
	"surface_conditions" text,
	"conditions_updated_at" timestamp with time zone,
	"recap_shoutout" text,
	"recap_auto_send_paused" boolean DEFAULT false NOT NULL,
	"recap_auto_send_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trips_capacity_range" CHECK ("capacity" between 1 and 60),
	CONSTRAINT "trips_planned_dives_range" CHECK ("planned_dives" between 1 and 4),
	CONSTRAINT "trips_minimum_bookings_range" CHECK ("minimum_bookings" is null or "minimum_bookings" between 1 and 60),
	CONSTRAINT "trips_minimum_decision_hours_range" CHECK ("minimum_decision_hours" is null or "minimum_decision_hours" between 1 and 336),
	CONSTRAINT "trips_price_nonnegative" CHECK ("price_cents" is null or "price_cents" >= 0),
	CONSTRAINT "trips_deposit_nonnegative" CHECK ("deposit_cents" is null or "deposit_cents" >= 0),
	CONSTRAINT "trips_cancellation_window_nonnegative" CHECK ("cancellation_window_hours" is null or "cancellation_window_hours" >= 0),
	CONSTRAINT "trips_ends_after_starts" CHECK ("ends_at" > "starts_at")
);
--> statement-breakpoint
CREATE TABLE "user_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"person_id" uuid NOT NULL,
	"email" text NOT NULL,
	"hashed_password" text NOT NULL,
	"status" "account_status" DEFAULT 'active'::"account_status" NOT NULL,
	"email_verified_at" timestamp with time zone,
	"email_verified" boolean DEFAULT false NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"image" text,
	"orientation_dismissed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
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
	"token_hash" text NOT NULL UNIQUE,
	"token_sealed" text,
	"expires_at" timestamp with time zone NOT NULL,
	"started_at" timestamp with time zone,
	"superseded_at" timestamp with time zone,
	"draft_signer_name" text,
	"draft_acknowledged" boolean DEFAULT false NOT NULL,
	"draft_medical_answers" jsonb,
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
	"completed_at" timestamp with time zone,
	"integrity_hash" text,
	"integrity_version" integer,
	"imported_from_label" text,
	"import_source_document_url" text,
	"import_source_medical_document_url" text,
	"anonymized_at" timestamp with time zone,
	"anonymized_by_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "waiver_records_medical_clearance_attributed" CHECK (("medical_cleared_at" is null) = ("medical_cleared_by_person_id" is null)
        and ("medical_clearance_document_url" is null or "medical_cleared_at" is not null)),
	CONSTRAINT "waiver_records_medical_clearance_needs_referral" CHECK ("medical_cleared_at" is null or "medical_review_required"),
	CONSTRAINT "waiver_records_medical_clearance_evidenced" CHECK ("medical_cleared_at" is null or "anonymized_at" is not null or (
        "medical_clearance_evaluated_on" is not null
        and ("medical_clearance_document_url" is not null
          or "medical_clearance_physician_name" is not null)))
);
--> statement-breakpoint
CREATE TABLE "waiver_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"title" text NOT NULL,
	"version" integer NOT NULL,
	"material_generation" integer DEFAULT 1 NOT NULL,
	"body" text NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "account_sessions_user_account_idx" ON "account_sessions" ("user_account_id");--> statement-breakpoint
CREATE INDEX "account_step_ups_session_purpose_idx" ON "account_step_ups" ("account_session_id","purpose","expires_at");--> statement-breakpoint
CREATE INDEX "account_step_ups_account_expires_idx" ON "account_step_ups" ("user_account_id","expires_at");--> statement-breakpoint
CREATE INDEX "account_tokens_account_purpose_idx" ON "account_tokens" ("user_account_id","purpose");--> statement-breakpoint
CREATE INDEX "activity_events_shop_trip_idx" ON "activity_events" ("shop_id","trip_id","occurred_at");--> statement-breakpoint
CREATE INDEX "activity_events_shop_subject_idx" ON "activity_events" ("shop_id","subject_person_id","occurred_at");--> statement-breakpoint
CREATE INDEX "boats_shop_id_idx" ON "boats" ("shop_id");--> statement-breakpoint
CREATE INDEX "boats_shop_live_idx" ON "boats" ("shop_id") WHERE "deleted_at" is null;--> statement-breakpoint
CREATE INDEX "booking_capabilities_token_hash_idx" ON "booking_capabilities" ("token_hash");--> statement-breakpoint
CREATE INDEX "booking_capabilities_booking_purpose_idx" ON "booking_capabilities" ("booking_id","purpose","revoked_at");--> statement-breakpoint
CREATE UNIQUE INDEX "booking_checkout_bookings_checkout_booking_unique" ON "booking_checkout_bookings" ("checkout_id","booking_id");--> statement-breakpoint
CREATE INDEX "booking_checkout_bookings_booking_idx" ON "booking_checkout_bookings" ("booking_id");--> statement-breakpoint
CREATE UNIQUE INDEX "booking_checkouts_stripe_session_unique" ON "booking_checkouts" ("stripe_session_id");--> statement-breakpoint
CREATE INDEX "booking_checkouts_shop_trip_idx" ON "booking_checkouts" ("shop_id","trip_id");--> statement-breakpoint
CREATE INDEX "booking_checkouts_recovery_scan_idx" ON "booking_checkouts" ("created_at") WHERE "status" = 'pending' and "abandoned_recovery_sent_at" is null;--> statement-breakpoint
CREATE INDEX "booking_payment_events_shop_booking_occurred_idx" ON "booking_payment_events" ("shop_id","booking_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "booking_payments_booking_unique" ON "booking_payments" ("booking_id");--> statement-breakpoint
CREATE INDEX "booking_payments_shop_status_idx" ON "booking_payments" ("shop_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "bookings_trip_person_unique" ON "bookings" ("trip_id","person_id");--> statement-breakpoint
CREATE INDEX "bookings_trip_idx" ON "bookings" ("trip_id");--> statement-breakpoint
CREATE INDEX "bookings_shop_person_idx" ON "bookings" ("shop_id","person_id");--> statement-breakpoint
CREATE INDEX "bookings_party_lead_idx" ON "bookings" ("party_lead_booking_id");--> statement-breakpoint
CREATE INDEX "bookings_shop_referral_idx" ON "bookings" ("shop_id","referral_source");--> statement-breakpoint
CREATE UNIQUE INDEX "buddy_pair_members_booking_unique" ON "buddy_pair_members" ("booking_id");--> statement-breakpoint
CREATE INDEX "buddy_pair_members_shop_trip_idx" ON "buddy_pair_members" ("shop_id","trip_id");--> statement-breakpoint
CREATE INDEX "buddy_pair_members_pair_idx" ON "buddy_pair_members" ("pair_id");--> statement-breakpoint
CREATE INDEX "buddy_team_events_shop_trip_idx" ON "buddy_team_events" ("shop_id","trip_id","occurred_at");--> statement-breakpoint
CREATE INDEX "buddy_team_events_pair_idx" ON "buddy_team_events" ("pair_id");--> statement-breakpoint
CREATE INDEX "calendar_feeds_token_hash_idx" ON "calendar_feeds" ("token_hash");--> statement-breakpoint
CREATE INDEX "calendar_feeds_person_scope_idx" ON "calendar_feeds" ("person_id","scope","revoked_at");--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_feeds_live_person_scope_idx" ON "calendar_feeds" ("person_id","scope") WHERE "revoked_at" IS NULL;--> statement-breakpoint
CREATE INDEX "certifications_shop_person_idx" ON "certifications" ("shop_id","person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "certifications_shop_agency_identifier_unique" ON "certifications" ("shop_id","agency",lower("identifier")) WHERE "deleted_at" is null;--> statement-breakpoint
CREATE INDEX "closeout_leftover_decisions_shop_day_idx" ON "closeout_leftover_decisions" ("shop_id","shop_day");--> statement-breakpoint
CREATE INDEX "closeout_leftover_decisions_action_idx" ON "closeout_leftover_decisions" ("shop_id","shop_day","action_id","seq");--> statement-breakpoint
CREATE INDEX "course_inquiries_shop_created_idx" ON "course_inquiries" ("shop_id","created_at");--> statement-breakpoint
CREATE INDEX "course_inquiries_course_idx" ON "course_inquiries" ("course_id");--> statement-breakpoint
CREATE INDEX "course_inquiries_shop_preferred_date_idx" ON "course_inquiries" ("shop_id","preferred_date");--> statement-breakpoint
CREATE UNIQUE INDEX "courses_shop_title_unique" ON "courses" ("shop_id","title");--> statement-breakpoint
CREATE UNIQUE INDEX "courses_shop_slug_unique" ON "courses" ("shop_id","slug");--> statement-breakpoint
CREATE INDEX "courses_shop_active_idx" ON "courses" ("shop_id","is_active");--> statement-breakpoint
CREATE INDEX "courses_title_trgm_idx" ON "courses" USING gin ("title" gin_trgm_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "crew_assignment_requests_live_idx" ON "crew_assignment_requests" ("trip_id","person_id") WHERE deleted_at is null;--> statement-breakpoint
CREATE INDEX "crew_assignment_requests_shop_trip_idx" ON "crew_assignment_requests" ("shop_id","trip_id");--> statement-breakpoint
CREATE INDEX "crew_assignment_requests_shop_person_idx" ON "crew_assignment_requests" ("shop_id","person_id");--> statement-breakpoint
CREATE INDEX "crew_availability_blocks_shop_person_idx" ON "crew_availability_blocks" ("shop_id","person_id","starts_on") WHERE deleted_at is null;--> statement-breakpoint
CREATE INDEX "crew_availability_blocks_shop_range_idx" ON "crew_availability_blocks" ("shop_id","starts_on","ends_on") WHERE deleted_at is null;--> statement-breakpoint
CREATE INDEX "day_closeouts_shop_day_idx" ON "day_closeouts" ("shop_id","shop_day");--> statement-breakpoint
CREATE INDEX "dive_package_entitlements_person_idx" ON "dive_package_entitlements" ("shop_id","person_id") WHERE "consumed_at" is null;--> statement-breakpoint
CREATE INDEX "dive_package_entitlements_order_idx" ON "dive_package_entitlements" ("order_id");--> statement-breakpoint
CREATE INDEX "dive_package_entitlements_booking_idx" ON "dive_package_entitlements" ("booking_id");--> statement-breakpoint
CREATE INDEX "dive_packages_shop_idx" ON "dive_packages" ("shop_id","created_at") WHERE "deleted_at" is null;--> statement-breakpoint
CREATE INDEX "dive_site_creatures_site_idx" ON "dive_site_creatures" ("dive_site_id");--> statement-breakpoint
CREATE INDEX "dive_site_moments_site_published_idx" ON "dive_site_moments" ("dive_site_id","is_published");--> statement-breakpoint
CREATE UNIQUE INDEX "dive_sites_shop_name_unique" ON "dive_sites" ("shop_id","name");--> statement-breakpoint
CREATE INDEX "dive_sites_shop_name_idx" ON "dive_sites" ("shop_id","name");--> statement-breakpoint
CREATE INDEX "dive_sites_name_trgm_idx" ON "dive_sites" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "dive_sites_location_trgm_idx" ON "dive_sites" USING gin ("location_name" gin_trgm_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "dive_support_needs_shop_person_unique" ON "dive_support_needs" ("shop_id","person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "executed_dives_trip_number_live_unique" ON "executed_dives" ("trip_id","dive_number") WHERE "deleted_at" is null;--> statement-breakpoint
CREATE INDEX "executed_dives_shop_trip_idx" ON "executed_dives" ("shop_id","trip_id","dive_number");--> statement-breakpoint
CREATE UNIQUE INDEX "gear_items_shop_label_unique" ON "gear_items" ("shop_id","label") WHERE "deleted_at" is null;--> statement-breakpoint
CREATE INDEX "gear_items_shop_kind_idx" ON "gear_items" ("shop_id","kind") WHERE "deleted_at" is null;--> statement-breakpoint
CREATE INDEX "gear_items_label_trgm_idx" ON "gear_items" USING gin ("label" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "gear_items_serial_trgm_idx" ON "gear_items" USING gin ("serial_number" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "gear_items_brand_model_trgm_idx" ON "gear_items" USING gin ("brand_model" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "gear_reservations_item_idx" ON "gear_reservations" ("gear_item_id");--> statement-breakpoint
CREATE INDEX "gear_reservations_booking_idx" ON "gear_reservations" ("booking_id");--> statement-breakpoint
CREATE INDEX "gear_reservations_person_idx" ON "gear_reservations" ("person_id");--> statement-breakpoint
CREATE INDEX "gear_reservations_shop_until_idx" ON "gear_reservations" ("shop_id","reserved_until");--> statement-breakpoint
CREATE INDEX "gear_service_events_item_idx" ON "gear_service_events" ("gear_item_id","serviced_on");--> statement-breakpoint
CREATE INDEX "gear_service_events_shop_idx" ON "gear_service_events" ("shop_id");--> statement-breakpoint
CREATE UNIQUE INDEX "global_dive_site_versions_unique" ON "global_dive_site_versions" ("global_dive_site_id","version");--> statement-breakpoint
CREATE INDEX "global_dive_sites_slug_idx" ON "global_dive_sites" ("slug");--> statement-breakpoint
CREATE INDEX "imported_payment_history_shop_person_idx" ON "imported_payment_history" ("shop_id","person_id","occurred_on");--> statement-breakpoint
CREATE INDEX "imported_payment_history_shop_date_idx" ON "imported_payment_history" ("shop_id","occurred_on");--> statement-breakpoint
CREATE INDEX "imported_payment_history_shop_currency_direction_idx" ON "imported_payment_history" ("shop_id","currency","direction","occurred_on");--> statement-breakpoint
CREATE UNIQUE INDEX "imported_payment_history_shop_person_dedupe_unique" ON "imported_payment_history" ("shop_id","person_id","dedupe_key");--> statement-breakpoint
CREATE UNIQUE INDEX "integration_deliveries_integration_event_unique" ON "integration_deliveries" ("integration_id","event_id");--> statement-breakpoint
CREATE INDEX "integration_deliveries_due_idx" ON "integration_deliveries" ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "integration_deliveries_shop_created_idx" ON "integration_deliveries" ("shop_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "integration_events_shop_idempotency_unique" ON "integration_events" ("shop_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "integration_events_shop_created_idx" ON "integration_events" ("shop_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "integration_oauth_states_hash_unique" ON "integration_oauth_states" ("state_hash");--> statement-breakpoint
CREATE INDEX "integration_oauth_states_expiry_idx" ON "integration_oauth_states" ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "integration_sync_records_source_unique" ON "integration_sync_records" ("shop_id","provider","source_type","source_id","operation");--> statement-breakpoint
CREATE INDEX "integration_sync_records_external_idx" ON "integration_sync_records" ("shop_id","provider","external_id");--> statement-breakpoint
CREATE INDEX "internal_notes_shop_person_idx" ON "internal_notes" ("shop_id","person_id","created_at");--> statement-breakpoint
CREATE INDEX "internal_notes_booking_idx" ON "internal_notes" ("booking_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "last_minute_list_entries_shop_person_unique" ON "last_minute_list_entries" ("shop_id","person_id");--> statement-breakpoint
CREATE INDEX "last_minute_list_entries_shop_active_idx" ON "last_minute_list_entries" ("shop_id") WHERE "unsubscribed_at" is null;--> statement-breakpoint
CREATE INDEX "last_minute_list_unsubscribe_tokens_token_hash_idx" ON "last_minute_list_unsubscribe_tokens" ("token_hash");--> statement-breakpoint
CREATE INDEX "last_minute_list_unsubscribe_tokens_entry_idx" ON "last_minute_list_unsubscribe_tokens" ("entry_id");--> statement-breakpoint
CREATE INDEX "marine_life_requests_created_idx" ON "marine_life_requests" ("created_at");--> statement-breakpoint
CREATE INDEX "media_deletion_attempts_shop_status_idx" ON "media_deletion_attempts" ("shop_id","status");--> statement-breakpoint
CREATE INDEX "nitrox_certifications_shop_person_idx" ON "nitrox_certifications" ("shop_id","person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "nitrox_certifications_shop_agency_identifier_unique" ON "nitrox_certifications" ("shop_id","agency",lower("identifier")) WHERE "deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "notification_deliveries_booking_kind_unique" ON "notification_deliveries" ("booking_id","kind");--> statement-breakpoint
CREATE INDEX "notification_deliveries_shop_status_attempted_idx" ON "notification_deliveries" ("shop_id","status","attempted_at");--> statement-breakpoint
CREATE INDEX "notification_deliveries_provider_message_idx" ON "notification_deliveries" ("provider_message_id");--> statement-breakpoint
CREATE INDEX "notification_delivery_attempts_booking_kind_idx" ON "notification_delivery_attempts" ("booking_id","kind");--> statement-breakpoint
CREATE INDEX "notification_delivery_attempts_shop_attempted_idx" ON "notification_delivery_attempts" ("shop_id","attempted_at");--> statement-breakpoint
CREATE INDEX "notification_send_queue_due_idx" ON "notification_send_queue" ("status","next_attempt_at","locked_until");--> statement-breakpoint
CREATE INDEX "notification_send_queue_shop_status_idx" ON "notification_send_queue" ("shop_id","status");--> statement-breakpoint
CREATE INDEX "order_line_items_order_idx" ON "order_line_items" ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_stripe_invoice_unique" ON "orders" ("stripe_invoice_id");--> statement-breakpoint
CREATE INDEX "orders_shop_status_idx" ON "orders" ("shop_id","status");--> statement-breakpoint
CREATE INDEX "orders_shop_booking_idx" ON "orders" ("shop_id","booking_id");--> statement-breakpoint
CREATE INDEX "orders_shop_person_idx" ON "orders" ("shop_id","person_id");--> statement-breakpoint
CREATE INDEX "orders_description_trgm_idx" ON "orders" USING gin ("description" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "payment_operation_intents_shop_status_idx" ON "payment_operation_intents" ("shop_id","status");--> statement-breakpoint
CREATE INDEX "payment_operation_intents_stale_scan_idx" ON "payment_operation_intents" ("kind","started_at") WHERE "status" = 'started';--> statement-breakpoint
CREATE INDEX "people_shop_idx" ON "people" ("shop_id");--> statement-breakpoint
CREATE UNIQUE INDEX "people_shop_email_unique" ON "people" ("shop_id",lower("email")) WHERE "deleted_at" is null and "email" is not null;--> statement-breakpoint
CREATE INDEX "people_full_name_trgm_idx" ON "people" USING gin ("full_name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "people_email_trgm_idx" ON "people" USING gin ("email" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "people_phone_trgm_idx" ON "people" USING gin ("phone" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "people_phone_digits_trgm_idx" ON "people" USING gin (regexp_replace(coalesce("phone", ''), '[^0-9]', '', 'g') gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "person_courtesy_email_unsubscribe_tokens_token_hash_idx" ON "person_courtesy_email_unsubscribe_tokens" ("token_hash");--> statement-breakpoint
CREATE INDEX "person_courtesy_email_unsubscribe_tokens_person_idx" ON "person_courtesy_email_unsubscribe_tokens" ("person_id");--> statement-breakpoint
CREATE INDEX "pre_departure_check_events_shop_trip_item_occurred_idx" ON "pre_departure_check_events" ("shop_id","trip_id","checklist_item_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "pre_departure_check_events_shop_client_event_unique" ON "pre_departure_check_events" ("shop_id","client_event_id");--> statement-breakpoint
CREATE INDEX "pre_departure_checklist_items_shop_order_idx" ON "pre_departure_checklist_items" ("shop_id","sort_order","created_at") WHERE "deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "pre_departure_checklist_items_shop_label_unique" ON "pre_departure_checklist_items" ("shop_id","label") WHERE "deleted_at" is null;--> statement-breakpoint
CREATE INDEX "prior_gear_assignments_shop_gear_idx" ON "prior_gear_assignments" ("shop_id","gear_item_id","assigned_from");--> statement-breakpoint
CREATE INDEX "prior_gear_assignments_shop_person_idx" ON "prior_gear_assignments" ("shop_id","person_id","assigned_from");--> statement-breakpoint
CREATE UNIQUE INDEX "prior_gear_assignments_shop_dedupe_unique" ON "prior_gear_assignments" ("shop_id","person_id","gear_item_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "prior_visits_shop_person_idx" ON "prior_visits" ("shop_id","person_id","visited_on");--> statement-breakpoint
CREATE UNIQUE INDEX "prior_visits_shop_person_dedupe_unique" ON "prior_visits" ("shop_id","person_id","dedupe_key");--> statement-breakpoint
CREATE UNIQUE INDEX "processor_erasure_obligations_shop_target_external_unique" ON "processor_erasure_obligations" ("shop_id","target","external_id");--> statement-breakpoint
CREATE INDEX "processor_erasure_obligations_shop_status_idx" ON "processor_erasure_obligations" ("shop_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "push_subscriptions_endpoint_trip_unique" ON "push_subscriptions" ("endpoint","trip_id");--> statement-breakpoint
CREATE INDEX "push_subscriptions_trip_pushed_idx" ON "push_subscriptions" ("trip_id","last_pushed_at");--> statement-breakpoint
CREATE INDEX "push_subscriptions_created_at_idx" ON "push_subscriptions" ("created_at");--> statement-breakpoint
CREATE INDEX "recap_photos_booking_idx" ON "recap_photos" ("booking_id","created_at");--> statement-breakpoint
CREATE INDEX "recap_photos_trip_idx" ON "recap_photos" ("trip_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "rental_fit_profiles_shop_person_unique" ON "rental_fit_profiles" ("shop_id","person_id");--> statement-breakpoint
CREATE INDEX "rental_fit_profiles_shop_person_idx" ON "rental_fit_profiles" ("shop_id","person_id");--> statement-breakpoint
CREATE INDEX "review_moderation_events_shop_idx" ON "review_moderation_events" ("shop_id","occurred_at");--> statement-breakpoint
CREATE INDEX "review_moderation_events_review_idx" ON "review_moderation_events" ("review_id");--> statement-breakpoint
CREATE INDEX "roll_call_crew_events_shop_trip_checkpoint_person_occurred_idx" ON "roll_call_crew_events" ("shop_id","trip_id","checkpoint","person_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "roll_call_crew_events_shop_client_event_unique" ON "roll_call_crew_events" ("shop_id","client_event_id");--> statement-breakpoint
CREATE INDEX "roll_call_events_shop_trip_checkpoint_booking_occurred_idx" ON "roll_call_events" ("shop_id","trip_id","checkpoint","booking_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "roll_call_events_shop_client_event_unique" ON "roll_call_events" ("shop_id","client_event_id");--> statement-breakpoint
CREATE INDEX "shop_backup_deliveries_shop_started_idx" ON "shop_backup_deliveries" ("shop_id","started_at");--> statement-breakpoint
CREATE INDEX "shop_backup_deliveries_shop_period_idx" ON "shop_backup_deliveries" ("shop_id","period_key");--> statement-breakpoint
CREATE INDEX "shop_contact_email_confirmation_tokens_shop_idx" ON "shop_contact_email_confirmation_tokens" ("shop_id");--> statement-breakpoint
CREATE UNIQUE INDEX "shop_integrations_shop_provider_unique" ON "shop_integrations" ("shop_id","provider") WHERE "deleted_at" is null;--> statement-breakpoint
CREATE INDEX "shop_integrations_shop_status_idx" ON "shop_integrations" ("shop_id","status");--> statement-breakpoint
CREATE INDEX "shop_promo_codes_shop_created_idx" ON "shop_promo_codes" ("shop_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "shop_promo_codes_shop_code_unique" ON "shop_promo_codes" ("shop_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "shop_promo_redemptions_checkout_unique" ON "shop_promo_redemptions" ("checkout_id");--> statement-breakpoint
CREATE INDEX "shop_promo_redemptions_promo_idx" ON "shop_promo_redemptions" ("promo_code_id","redeemed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "shop_stripe_accounts_stripe_account_unique" ON "shop_stripe_accounts" ("stripe_account_id");--> statement-breakpoint
CREATE INDEX "specialty_certifications_shop_person_idx" ON "specialty_certifications" ("shop_id","person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "specialty_certifications_shop_agency_specialty_identifier_unique" ON "specialty_certifications" ("shop_id","agency","specialty",lower("identifier")) WHERE "deleted_at" is null;--> statement-breakpoint
CREATE INDEX "staff_credentials_shop_person_idx" ON "staff_credentials" ("shop_id","person_id");--> statement-breakpoint
CREATE INDEX "staff_credentials_renewal_idx" ON "staff_credentials" ("shop_id","renews_at");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_credentials_live_identity_unique" ON "staff_credentials" ("shop_id","person_id","kind",lower("identifier")) WHERE "deleted_at" is null;--> statement-breakpoint
CREATE INDEX "staff_shifts_shop_starts_idx" ON "staff_shifts" ("shop_id","starts_at");--> statement-breakpoint
CREATE INDEX "staff_shifts_person_starts_idx" ON "staff_shifts" ("person_id","starts_at");--> statement-breakpoint
CREATE INDEX "stripe_webhook_events_account_type_idx" ON "stripe_webhook_events" ("account","type","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "tips_stripe_session_unique" ON "tips" ("stripe_session_id");--> statement-breakpoint
CREATE INDEX "tips_shop_booking_idx" ON "tips" ("shop_id","booking_id");--> statement-breakpoint
CREATE UNIQUE INDEX "trip_blowout_divers_booking_unique" ON "trip_blowout_divers" ("booking_id");--> statement-breakpoint
CREATE INDEX "trip_blowout_divers_blowout_idx" ON "trip_blowout_divers" ("blowout_id");--> statement-breakpoint
CREATE UNIQUE INDEX "trip_blowouts_trip_unique" ON "trip_blowouts" ("trip_id");--> statement-breakpoint
CREATE INDEX "trip_blowouts_shop_called_idx" ON "trip_blowouts" ("shop_id","called_at");--> statement-breakpoint
CREATE INDEX "trip_change_events_shop_trip_idx" ON "trip_change_events" ("shop_id","trip_id","occurred_at","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "trip_dives_trip_number_unique" ON "trip_dives" ("trip_id","dive_number");--> statement-breakpoint
CREATE INDEX "trip_dives_trip_idx" ON "trip_dives" ("trip_id","dive_number");--> statement-breakpoint
CREATE UNIQUE INDEX "trip_help_requests_booking_unique" ON "trip_help_requests" ("booking_id");--> statement-breakpoint
CREATE INDEX "trip_help_requests_shop_status_idx" ON "trip_help_requests" ("shop_id","status","created_at");--> statement-breakpoint
CREATE INDEX "trip_help_requests_trip_idx" ON "trip_help_requests" ("trip_id","created_at");--> statement-breakpoint
CREATE INDEX "trip_invitations_shop_trip_idx" ON "trip_invitations" ("shop_id","trip_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "trip_invitations_trip_request_unique" ON "trip_invitations" ("trip_id","course_inquiry_id") WHERE "course_inquiry_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "trip_invitations_trip_waitlist_unique" ON "trip_invitations" ("trip_id","waitlist_entry_id") WHERE "waitlist_entry_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "trip_invitations_trip_person_unique" ON "trip_invitations" ("trip_id","person_id") WHERE "person_id" is not null;--> statement-breakpoint
CREATE INDEX "trip_last_minute_promo_recipients_promo_idx" ON "trip_last_minute_promo_recipients" ("trip_promo_id");--> statement-breakpoint
CREATE INDEX "trip_last_minute_promo_recipients_person_idx" ON "trip_last_minute_promo_recipients" ("person_id");--> statement-breakpoint
CREATE INDEX "trip_last_minute_promo_recipients_shop_person_idx" ON "trip_last_minute_promo_recipients" ("shop_id","person_id");--> statement-breakpoint
CREATE INDEX "trip_last_minute_promos_trip_created_idx" ON "trip_last_minute_promos" ("trip_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "trip_last_minute_promos_shop_code_unique" ON "trip_last_minute_promos" ("shop_id","code");--> statement-breakpoint
CREATE INDEX "trip_recap_photos_shop_trip_idx" ON "trip_recap_photos" ("shop_id","trip_id","created_at");--> statement-breakpoint
CREATE INDEX "trip_requirements_shop_idx" ON "trip_requirements" ("shop_id");--> statement-breakpoint
CREATE UNIQUE INDEX "trip_reviews_booking_unique" ON "trip_reviews" ("booking_id");--> statement-breakpoint
CREATE INDEX "trip_reviews_shop_published_idx" ON "trip_reviews" ("shop_id","published_at") WHERE "is_published";--> statement-breakpoint
CREATE INDEX "trip_reviews_shop_created_idx" ON "trip_reviews" ("shop_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "trip_schedule_days_trip_day_unique" ON "trip_schedule_days" ("trip_id","day_number");--> statement-breakpoint
CREATE INDEX "trip_schedule_days_trip_starts_idx" ON "trip_schedule_days" ("trip_id","starts_at");--> statement-breakpoint
CREATE INDEX "trip_series_shop_idx" ON "trip_series" ("shop_id");--> statement-breakpoint
CREATE INDEX "trip_series_roll_queue_idx" ON "trip_series" ("last_rolled_at");--> statement-breakpoint
CREATE UNIQUE INDEX "trip_series_skips_slot_idx" ON "trip_series_skips" ("series_id","occurrence_date");--> statement-breakpoint
CREATE INDEX "trip_series_skips_shop_idx" ON "trip_series_skips" ("shop_id");--> statement-breakpoint
CREATE UNIQUE INDEX "trip_waitlist_entries_trip_person_unique" ON "trip_waitlist_entries" ("trip_id","person_id");--> statement-breakpoint
CREATE INDEX "trip_waitlist_entries_trip_created_idx" ON "trip_waitlist_entries" ("trip_id","created_at");--> statement-breakpoint
CREATE INDEX "trip_waitlist_entries_shop_trip_idx" ON "trip_waitlist_entries" ("shop_id","trip_id");--> statement-breakpoint
CREATE INDEX "trips_shop_starts_idx" ON "trips" ("shop_id","starts_at");--> statement-breakpoint
CREATE INDEX "trips_series_starts_idx" ON "trips" ("series_id","starts_at");--> statement-breakpoint
CREATE INDEX "trips_shop_live_starts_idx" ON "trips" ("shop_id","starts_at") WHERE "deleted_at" is null;--> statement-breakpoint
CREATE INDEX "trips_status_starts_idx" ON "trips" ("status","starts_at");--> statement-breakpoint
CREATE INDEX "trips_status_ends_idx" ON "trips" ("status","ends_at");--> statement-breakpoint
CREATE INDEX "trips_title_trgm_idx" ON "trips" USING gin ("title" gin_trgm_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "user_accounts_email_unique" ON "user_accounts" ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "user_accounts_person_unique" ON "user_accounts" ("person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "waiver_deliveries_record_channel_unique" ON "waiver_deliveries" ("waiver_record_id","channel");--> statement-breakpoint
CREATE INDEX "waiver_deliveries_provider_message_idx" ON "waiver_deliveries" ("provider_message_id");--> statement-breakpoint
CREATE INDEX "waiver_deliveries_shop_record_idx" ON "waiver_deliveries" ("shop_id","waiver_record_id");--> statement-breakpoint
CREATE INDEX "waiver_materiality_decisions_shop_idx" ON "waiver_materiality_decisions" ("shop_id","template_id");--> statement-breakpoint
CREATE INDEX "waiver_records_booking_current_idx" ON "waiver_records" ("booking_id","superseded_at");--> statement-breakpoint
CREATE INDEX "waiver_records_shop_status_idx" ON "waiver_records" ("shop_id","status");--> statement-breakpoint
CREATE INDEX "waiver_records_shop_person_status_idx" ON "waiver_records" ("shop_id","person_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "waiver_templates_shop_version_unique" ON "waiver_templates" ("shop_id","version");--> statement-breakpoint
ALTER TABLE "account_security" ADD CONSTRAINT "account_security_user_account_id_user_accounts_id_fkey" FOREIGN KEY ("user_account_id") REFERENCES "user_accounts"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "account_sessions" ADD CONSTRAINT "account_sessions_user_account_id_user_accounts_id_fkey" FOREIGN KEY ("user_account_id") REFERENCES "user_accounts"("id");--> statement-breakpoint
ALTER TABLE "account_sessions" ADD CONSTRAINT "account_sessions_person_id_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "account_sessions" ADD CONSTRAINT "account_sessions_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "account_step_ups" ADD CONSTRAINT "account_step_ups_user_account_id_user_accounts_id_fkey" FOREIGN KEY ("user_account_id") REFERENCES "user_accounts"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "account_step_ups" ADD CONSTRAINT "account_step_ups_account_session_id_account_sessions_id_fkey" FOREIGN KEY ("account_session_id") REFERENCES "account_sessions"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "account_tokens" ADD CONSTRAINT "account_tokens_user_account_id_user_accounts_id_fkey" FOREIGN KEY ("user_account_id") REFERENCES "user_accounts"("id");--> statement-breakpoint
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_trip_id_trips_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_booking_id_bookings_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_actor_person_id_people_id_fkey" FOREIGN KEY ("actor_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_subject_person_id_people_id_fkey" FOREIGN KEY ("subject_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "auth_provider_accounts" ADD CONSTRAINT "auth_provider_accounts_user_account_id_user_accounts_id_fkey" FOREIGN KEY ("user_account_id") REFERENCES "user_accounts"("id");--> statement-breakpoint
ALTER TABLE "boats" ADD CONSTRAINT "boats_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "booking_capabilities" ADD CONSTRAINT "booking_capabilities_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "booking_capabilities" ADD CONSTRAINT "booking_capabilities_booking_id_bookings_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id");--> statement-breakpoint
ALTER TABLE "booking_checkout_bookings" ADD CONSTRAINT "booking_checkout_bookings_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "booking_checkout_bookings" ADD CONSTRAINT "booking_checkout_bookings_checkout_id_booking_checkouts_id_fkey" FOREIGN KEY ("checkout_id") REFERENCES "booking_checkouts"("id");--> statement-breakpoint
ALTER TABLE "booking_checkout_bookings" ADD CONSTRAINT "booking_checkout_bookings_booking_id_bookings_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id");--> statement-breakpoint
ALTER TABLE "booking_checkouts" ADD CONSTRAINT "booking_checkouts_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "booking_checkouts" ADD CONSTRAINT "booking_checkouts_trip_id_trips_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id");--> statement-breakpoint
ALTER TABLE "booking_checkouts" ADD CONSTRAINT "booking_checkouts_promo_code_id_shop_promo_codes_id_fkey" FOREIGN KEY ("promo_code_id") REFERENCES "shop_promo_codes"("id");--> statement-breakpoint
ALTER TABLE "booking_checkouts" ADD CONSTRAINT "booking_checkouts_trip_promo_id_trip_last_minute_promos_id_fkey" FOREIGN KEY ("trip_promo_id") REFERENCES "trip_last_minute_promos"("id");--> statement-breakpoint
ALTER TABLE "booking_payment_events" ADD CONSTRAINT "booking_payment_events_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "booking_payment_events" ADD CONSTRAINT "booking_payment_events_booking_id_bookings_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "booking_payments" ADD CONSTRAINT "booking_payments_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "booking_payments" ADD CONSTRAINT "booking_payments_booking_id_bookings_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id");--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_trip_id_trips_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id");--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_person_id_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "buddy_pair_members" ADD CONSTRAINT "buddy_pair_members_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "buddy_pair_members" ADD CONSTRAINT "buddy_pair_members_trip_id_trips_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id");--> statement-breakpoint
ALTER TABLE "buddy_pair_members" ADD CONSTRAINT "buddy_pair_members_booking_id_bookings_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id");--> statement-breakpoint
ALTER TABLE "buddy_pair_members" ADD CONSTRAINT "buddy_pair_members_crew_person_id_people_id_fkey" FOREIGN KEY ("crew_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "buddy_pair_members" ADD CONSTRAINT "buddy_pair_members_paired_by_person_id_people_id_fkey" FOREIGN KEY ("paired_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "buddy_team_events" ADD CONSTRAINT "buddy_team_events_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "buddy_team_events" ADD CONSTRAINT "buddy_team_events_trip_id_trips_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id");--> statement-breakpoint
ALTER TABLE "buddy_team_events" ADD CONSTRAINT "buddy_team_events_recorded_by_person_id_people_id_fkey" FOREIGN KEY ("recorded_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "calendar_feeds" ADD CONSTRAINT "calendar_feeds_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "calendar_feeds" ADD CONSTRAINT "calendar_feeds_person_id_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "certifications" ADD CONSTRAINT "certifications_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "certifications" ADD CONSTRAINT "certifications_person_id_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "certifications" ADD CONSTRAINT "certifications_reviewed_by_person_id_people_id_fkey" FOREIGN KEY ("reviewed_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "certifications" ADD CONSTRAINT "certifications_issued_from_trip_id_trips_id_fkey" FOREIGN KEY ("issued_from_trip_id") REFERENCES "trips"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "certifications" ADD CONSTRAINT "certifications_issued_by_person_id_people_id_fkey" FOREIGN KEY ("issued_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "certifications" ADD CONSTRAINT "certifications_deleted_by_person_id_people_id_fkey" FOREIGN KEY ("deleted_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "closeout_leftover_decisions" ADD CONSTRAINT "closeout_leftover_decisions_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "closeout_leftover_decisions" ADD CONSTRAINT "closeout_leftover_decisions_actor_person_id_people_id_fkey" FOREIGN KEY ("actor_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "course_inquiries" ADD CONSTRAINT "course_inquiries_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "course_inquiries" ADD CONSTRAINT "course_inquiries_course_id_courses_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id");--> statement-breakpoint
ALTER TABLE "course_inquiries" ADD CONSTRAINT "course_inquiries_person_id_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "courses" ADD CONSTRAINT "courses_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "crew_assignment_requests" ADD CONSTRAINT "crew_assignment_requests_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "crew_assignment_requests" ADD CONSTRAINT "crew_assignment_requests_trip_id_trips_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id");--> statement-breakpoint
ALTER TABLE "crew_assignment_requests" ADD CONSTRAINT "crew_assignment_requests_person_id_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "crew_assignment_requests" ADD CONSTRAINT "crew_assignment_requests_decided_by_person_id_people_id_fkey" FOREIGN KEY ("decided_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "crew_availability_blocks" ADD CONSTRAINT "crew_availability_blocks_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "crew_availability_blocks" ADD CONSTRAINT "crew_availability_blocks_person_id_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "crew_availability_blocks" ADD CONSTRAINT "crew_availability_blocks_created_by_person_id_people_id_fkey" FOREIGN KEY ("created_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "day_closeouts" ADD CONSTRAINT "day_closeouts_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "day_closeouts" ADD CONSTRAINT "day_closeouts_actor_person_id_people_id_fkey" FOREIGN KEY ("actor_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "dive_package_entitlements" ADD CONSTRAINT "dive_package_entitlements_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "dive_package_entitlements" ADD CONSTRAINT "dive_package_entitlements_package_id_dive_packages_id_fkey" FOREIGN KEY ("package_id") REFERENCES "dive_packages"("id");--> statement-breakpoint
ALTER TABLE "dive_package_entitlements" ADD CONSTRAINT "dive_package_entitlements_person_id_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "dive_package_entitlements" ADD CONSTRAINT "dive_package_entitlements_order_id_orders_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id");--> statement-breakpoint
ALTER TABLE "dive_package_entitlements" ADD CONSTRAINT "dive_package_entitlements_booking_id_bookings_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id");--> statement-breakpoint
ALTER TABLE "dive_packages" ADD CONSTRAINT "dive_packages_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "dive_packages" ADD CONSTRAINT "dive_packages_created_by_person_id_people_id_fkey" FOREIGN KEY ("created_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "dive_site_creatures" ADD CONSTRAINT "dive_site_creatures_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "dive_site_creatures" ADD CONSTRAINT "dive_site_creatures_dive_site_id_dive_sites_id_fkey" FOREIGN KEY ("dive_site_id") REFERENCES "dive_sites"("id");--> statement-breakpoint
ALTER TABLE "dive_site_moments" ADD CONSTRAINT "dive_site_moments_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "dive_site_moments" ADD CONSTRAINT "dive_site_moments_dive_site_id_dive_sites_id_fkey" FOREIGN KEY ("dive_site_id") REFERENCES "dive_sites"("id");--> statement-breakpoint
ALTER TABLE "dive_sites" ADD CONSTRAINT "dive_sites_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "dive_support_needs" ADD CONSTRAINT "dive_support_needs_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "dive_support_needs" ADD CONSTRAINT "dive_support_needs_person_id_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "executed_dives" ADD CONSTRAINT "executed_dives_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "executed_dives" ADD CONSTRAINT "executed_dives_trip_id_trips_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id");--> statement-breakpoint
ALTER TABLE "executed_dives" ADD CONSTRAINT "executed_dives_actual_site_id_dive_sites_id_fkey" FOREIGN KEY ("actual_site_id") REFERENCES "dive_sites"("id");--> statement-breakpoint
ALTER TABLE "executed_dives" ADD CONSTRAINT "executed_dives_recorded_by_person_id_people_id_fkey" FOREIGN KEY ("recorded_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "executed_dives" ADD CONSTRAINT "executed_dives_deleted_by_person_id_people_id_fkey" FOREIGN KEY ("deleted_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "gear_items" ADD CONSTRAINT "gear_items_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "gear_items" ADD CONSTRAINT "gear_items_deleted_by_person_id_people_id_fkey" FOREIGN KEY ("deleted_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "gear_reservations" ADD CONSTRAINT "gear_reservations_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "gear_reservations" ADD CONSTRAINT "gear_reservations_gear_item_id_gear_items_id_fkey" FOREIGN KEY ("gear_item_id") REFERENCES "gear_items"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "gear_reservations" ADD CONSTRAINT "gear_reservations_person_id_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "gear_reservations" ADD CONSTRAINT "gear_reservations_booking_id_bookings_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "gear_service_events" ADD CONSTRAINT "gear_service_events_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "gear_service_events" ADD CONSTRAINT "gear_service_events_gear_item_id_gear_items_id_fkey" FOREIGN KEY ("gear_item_id") REFERENCES "gear_items"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "gear_service_events" ADD CONSTRAINT "gear_service_events_recorded_by_person_id_people_id_fkey" FOREIGN KEY ("recorded_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "global_dive_site_versions" ADD CONSTRAINT "global_dive_site_versions_1zaEF6XhjlbN_fkey" FOREIGN KEY ("global_dive_site_id") REFERENCES "global_dive_sites"("id");--> statement-breakpoint
ALTER TABLE "imported_payment_history" ADD CONSTRAINT "imported_payment_history_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "imported_payment_history" ADD CONSTRAINT "imported_payment_history_person_id_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "integration_deliveries" ADD CONSTRAINT "integration_deliveries_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "integration_deliveries" ADD CONSTRAINT "integration_deliveries_integration_id_shop_integrations_id_fkey" FOREIGN KEY ("integration_id") REFERENCES "shop_integrations"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "integration_deliveries" ADD CONSTRAINT "integration_deliveries_event_id_integration_events_id_fkey" FOREIGN KEY ("event_id") REFERENCES "integration_events"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "integration_events" ADD CONSTRAINT "integration_events_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "integration_oauth_states" ADD CONSTRAINT "integration_oauth_states_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "integration_oauth_states" ADD CONSTRAINT "integration_oauth_states_person_id_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "integration_sync_records" ADD CONSTRAINT "integration_sync_records_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "internal_notes" ADD CONSTRAINT "internal_notes_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "internal_notes" ADD CONSTRAINT "internal_notes_person_id_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "internal_notes" ADD CONSTRAINT "internal_notes_booking_id_bookings_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "internal_notes" ADD CONSTRAINT "internal_notes_created_by_person_id_people_id_fkey" FOREIGN KEY ("created_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "last_minute_list_entries" ADD CONSTRAINT "last_minute_list_entries_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "last_minute_list_entries" ADD CONSTRAINT "last_minute_list_entries_person_id_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "last_minute_list_unsubscribe_tokens" ADD CONSTRAINT "last_minute_list_unsubscribe_tokens_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "last_minute_list_unsubscribe_tokens" ADD CONSTRAINT "last_minute_list_unsubscribe_tokens_AOSpe7xhTtoO_fkey" FOREIGN KEY ("entry_id") REFERENCES "last_minute_list_entries"("id");--> statement-breakpoint
ALTER TABLE "marine_life_requests" ADD CONSTRAINT "marine_life_requests_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "marine_life_requests" ADD CONSTRAINT "marine_life_requests_requested_by_person_id_people_id_fkey" FOREIGN KEY ("requested_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "marine_life_requests" ADD CONSTRAINT "marine_life_requests_dive_site_id_dive_sites_id_fkey" FOREIGN KEY ("dive_site_id") REFERENCES "dive_sites"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "media_deletion_attempts" ADD CONSTRAINT "media_deletion_attempts_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "nitrox_certifications" ADD CONSTRAINT "nitrox_certifications_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "nitrox_certifications" ADD CONSTRAINT "nitrox_certifications_person_id_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "nitrox_certifications" ADD CONSTRAINT "nitrox_certifications_reviewed_by_person_id_people_id_fkey" FOREIGN KEY ("reviewed_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "nitrox_certifications" ADD CONSTRAINT "nitrox_certifications_issued_from_trip_id_trips_id_fkey" FOREIGN KEY ("issued_from_trip_id") REFERENCES "trips"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "nitrox_certifications" ADD CONSTRAINT "nitrox_certifications_issued_by_person_id_people_id_fkey" FOREIGN KEY ("issued_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "nitrox_certifications" ADD CONSTRAINT "nitrox_certifications_deleted_by_person_id_people_id_fkey" FOREIGN KEY ("deleted_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_booking_id_bookings_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id");--> statement-breakpoint
ALTER TABLE "notification_delivery_attempts" ADD CONSTRAINT "notification_delivery_attempts_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "notification_delivery_attempts" ADD CONSTRAINT "notification_delivery_attempts_booking_id_bookings_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id");--> statement-breakpoint
ALTER TABLE "notification_send_queue" ADD CONSTRAINT "notification_send_queue_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "order_line_items" ADD CONSTRAINT "order_line_items_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "order_line_items" ADD CONSTRAINT "order_line_items_order_id_orders_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id");--> statement-breakpoint
ALTER TABLE "order_line_items" ADD CONSTRAINT "order_line_items_package_id_dive_packages_id_fkey" FOREIGN KEY ("package_id") REFERENCES "dive_packages"("id");--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_booking_id_bookings_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id");--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_person_id_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_created_by_person_id_people_id_fkey" FOREIGN KEY ("created_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "payment_operation_intents" ADD CONSTRAINT "payment_operation_intents_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "payment_operation_intents" ADD CONSTRAINT "payment_operation_intents_trip_id_trips_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id");--> statement-breakpoint
ALTER TABLE "payment_operation_intents" ADD CONSTRAINT "payment_operation_intents_booking_id_bookings_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id");--> statement-breakpoint
ALTER TABLE "payment_operation_intents" ADD CONSTRAINT "payment_operation_intents_order_id_orders_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id");--> statement-breakpoint
ALTER TABLE "payment_operation_intents" ADD CONSTRAINT "payment_operation_intents_checkout_id_booking_checkouts_id_fkey" FOREIGN KEY ("checkout_id") REFERENCES "booking_checkouts"("id");--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_anonymized_by_person_id_people_id_fkey" FOREIGN KEY ("anonymized_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_merged_into_person_id_people_id_fkey" FOREIGN KEY ("merged_into_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_merged_by_person_id_people_id_fkey" FOREIGN KEY ("merged_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "person_courtesy_email_unsubscribe_tokens" ADD CONSTRAINT "person_courtesy_email_unsubscribe_tokens_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "person_courtesy_email_unsubscribe_tokens" ADD CONSTRAINT "person_courtesy_email_unsubscribe_tokens_IiziwZo2Y62C_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "person_roles" ADD CONSTRAINT "person_roles_person_id_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "pre_departure_check_events" ADD CONSTRAINT "pre_departure_check_events_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "pre_departure_check_events" ADD CONSTRAINT "pre_departure_check_events_trip_id_trips_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id");--> statement-breakpoint
ALTER TABLE "pre_departure_check_events" ADD CONSTRAINT "pre_departure_check_events_Sm6KHU4KNFB1_fkey" FOREIGN KEY ("checklist_item_id") REFERENCES "pre_departure_checklist_items"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "pre_departure_check_events" ADD CONSTRAINT "pre_departure_check_events_recorded_by_person_id_people_id_fkey" FOREIGN KEY ("recorded_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "pre_departure_checklist_items" ADD CONSTRAINT "pre_departure_checklist_items_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "pre_departure_checklist_items" ADD CONSTRAINT "pre_departure_checklist_items_c6mRO9ZNpkkg_fkey" FOREIGN KEY ("deleted_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "prior_gear_assignments" ADD CONSTRAINT "prior_gear_assignments_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "prior_gear_assignments" ADD CONSTRAINT "prior_gear_assignments_person_id_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "prior_gear_assignments" ADD CONSTRAINT "prior_gear_assignments_gear_item_id_gear_items_id_fkey" FOREIGN KEY ("gear_item_id") REFERENCES "gear_items"("id");--> statement-breakpoint
ALTER TABLE "prior_visits" ADD CONSTRAINT "prior_visits_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "prior_visits" ADD CONSTRAINT "prior_visits_person_id_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "processor_erasure_obligations" ADD CONSTRAINT "processor_erasure_obligations_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "processor_erasure_obligations" ADD CONSTRAINT "processor_erasure_obligations_person_id_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "processor_erasure_obligations" ADD CONSTRAINT "processor_erasure_obligations_kgvFHJwQGdT5_fkey" FOREIGN KEY ("discharged_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_trip_id_trips_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_person_id_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "recap_photos" ADD CONSTRAINT "recap_photos_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "recap_photos" ADD CONSTRAINT "recap_photos_booking_id_bookings_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id");--> statement-breakpoint
ALTER TABLE "recap_photos" ADD CONSTRAINT "recap_photos_trip_id_trips_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id");--> statement-breakpoint
ALTER TABLE "rental_fit_profiles" ADD CONSTRAINT "rental_fit_profiles_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "rental_fit_profiles" ADD CONSTRAINT "rental_fit_profiles_person_id_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "rental_fit_profiles" ADD CONSTRAINT "rental_fit_profiles_needs_staff_fit_by_people_id_fkey" FOREIGN KEY ("needs_staff_fit_by") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "review_moderation_events" ADD CONSTRAINT "review_moderation_events_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "review_moderation_events" ADD CONSTRAINT "review_moderation_events_review_id_trip_reviews_id_fkey" FOREIGN KEY ("review_id") REFERENCES "trip_reviews"("id");--> statement-breakpoint
ALTER TABLE "review_moderation_events" ADD CONSTRAINT "review_moderation_events_recorded_by_person_id_people_id_fkey" FOREIGN KEY ("recorded_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "roll_call_crew_events" ADD CONSTRAINT "roll_call_crew_events_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "roll_call_crew_events" ADD CONSTRAINT "roll_call_crew_events_trip_id_trips_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id");--> statement-breakpoint
ALTER TABLE "roll_call_crew_events" ADD CONSTRAINT "roll_call_crew_events_person_id_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "roll_call_crew_events" ADD CONSTRAINT "roll_call_crew_events_recorded_by_person_id_people_id_fkey" FOREIGN KEY ("recorded_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "roll_call_events" ADD CONSTRAINT "roll_call_events_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "roll_call_events" ADD CONSTRAINT "roll_call_events_trip_id_trips_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id");--> statement-breakpoint
ALTER TABLE "roll_call_events" ADD CONSTRAINT "roll_call_events_booking_id_bookings_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id");--> statement-breakpoint
ALTER TABLE "roll_call_events" ADD CONSTRAINT "roll_call_events_recorded_by_person_id_people_id_fkey" FOREIGN KEY ("recorded_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "shop_backup_deliveries" ADD CONSTRAINT "shop_backup_deliveries_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "shop_backup_destinations" ADD CONSTRAINT "shop_backup_destinations_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "shop_contact_email_confirmation_tokens" ADD CONSTRAINT "shop_contact_email_confirmation_tokens_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "shop_integrations" ADD CONSTRAINT "shop_integrations_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "shop_promo_codes" ADD CONSTRAINT "shop_promo_codes_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "shop_promo_codes" ADD CONSTRAINT "shop_promo_codes_created_by_person_id_people_id_fkey" FOREIGN KEY ("created_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "shop_promo_redemptions" ADD CONSTRAINT "shop_promo_redemptions_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "shop_promo_redemptions" ADD CONSTRAINT "shop_promo_redemptions_promo_code_id_shop_promo_codes_id_fkey" FOREIGN KEY ("promo_code_id") REFERENCES "shop_promo_codes"("id");--> statement-breakpoint
ALTER TABLE "shop_promo_redemptions" ADD CONSTRAINT "shop_promo_redemptions_checkout_id_booking_checkouts_id_fkey" FOREIGN KEY ("checkout_id") REFERENCES "booking_checkouts"("id");--> statement-breakpoint
ALTER TABLE "shop_stripe_accounts" ADD CONSTRAINT "shop_stripe_accounts_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "shop_whatsapp_accounts" ADD CONSTRAINT "shop_whatsapp_accounts_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "specialty_certifications" ADD CONSTRAINT "specialty_certifications_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "specialty_certifications" ADD CONSTRAINT "specialty_certifications_person_id_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "specialty_certifications" ADD CONSTRAINT "specialty_certifications_reviewed_by_person_id_people_id_fkey" FOREIGN KEY ("reviewed_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "specialty_certifications" ADD CONSTRAINT "specialty_certifications_issued_from_trip_id_trips_id_fkey" FOREIGN KEY ("issued_from_trip_id") REFERENCES "trips"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "specialty_certifications" ADD CONSTRAINT "specialty_certifications_issued_by_person_id_people_id_fkey" FOREIGN KEY ("issued_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "specialty_certifications" ADD CONSTRAINT "specialty_certifications_deleted_by_person_id_people_id_fkey" FOREIGN KEY ("deleted_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "staff_credentials" ADD CONSTRAINT "staff_credentials_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "staff_credentials" ADD CONSTRAINT "staff_credentials_person_id_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "staff_credentials" ADD CONSTRAINT "staff_credentials_reviewed_by_person_id_people_id_fkey" FOREIGN KEY ("reviewed_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "staff_credentials" ADD CONSTRAINT "staff_credentials_deleted_by_person_id_people_id_fkey" FOREIGN KEY ("deleted_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "staff_shifts" ADD CONSTRAINT "staff_shifts_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "staff_shifts" ADD CONSTRAINT "staff_shifts_person_id_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "staff_shifts" ADD CONSTRAINT "staff_shifts_created_by_person_id_people_id_fkey" FOREIGN KEY ("created_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "tips" ADD CONSTRAINT "tips_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "tips" ADD CONSTRAINT "tips_booking_id_bookings_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id");--> statement-breakpoint
ALTER TABLE "trip_assignments" ADD CONSTRAINT "trip_assignments_trip_id_trips_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id");--> statement-breakpoint
ALTER TABLE "trip_assignments" ADD CONSTRAINT "trip_assignments_person_id_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "trip_blowout_divers" ADD CONSTRAINT "trip_blowout_divers_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "trip_blowout_divers" ADD CONSTRAINT "trip_blowout_divers_blowout_id_trip_blowouts_id_fkey" FOREIGN KEY ("blowout_id") REFERENCES "trip_blowouts"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "trip_blowout_divers" ADD CONSTRAINT "trip_blowout_divers_booking_id_bookings_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id");--> statement-breakpoint
ALTER TABLE "trip_blowout_divers" ADD CONSTRAINT "trip_blowout_divers_person_id_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "trip_blowouts" ADD CONSTRAINT "trip_blowouts_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "trip_blowouts" ADD CONSTRAINT "trip_blowouts_trip_id_trips_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id");--> statement-breakpoint
ALTER TABLE "trip_blowouts" ADD CONSTRAINT "trip_blowouts_called_by_person_id_people_id_fkey" FOREIGN KEY ("called_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "trip_change_events" ADD CONSTRAINT "trip_change_events_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "trip_change_events" ADD CONSTRAINT "trip_change_events_trip_id_trips_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "trip_change_events" ADD CONSTRAINT "trip_change_events_actor_person_id_people_id_fkey" FOREIGN KEY ("actor_person_id") REFERENCES "people"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "trip_dives" ADD CONSTRAINT "trip_dives_trip_id_trips_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id");--> statement-breakpoint
ALTER TABLE "trip_dives" ADD CONSTRAINT "trip_dives_dive_site_id_dive_sites_id_fkey" FOREIGN KEY ("dive_site_id") REFERENCES "dive_sites"("id");--> statement-breakpoint
ALTER TABLE "trip_help_requests" ADD CONSTRAINT "trip_help_requests_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "trip_help_requests" ADD CONSTRAINT "trip_help_requests_trip_id_trips_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "trip_help_requests" ADD CONSTRAINT "trip_help_requests_booking_id_bookings_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "trip_help_requests" ADD CONSTRAINT "trip_help_requests_resolved_by_person_id_people_id_fkey" FOREIGN KEY ("resolved_by_person_id") REFERENCES "people"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "trip_invitations" ADD CONSTRAINT "trip_invitations_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "trip_invitations" ADD CONSTRAINT "trip_invitations_trip_id_trips_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "trip_invitations" ADD CONSTRAINT "trip_invitations_course_inquiry_id_course_inquiries_id_fkey" FOREIGN KEY ("course_inquiry_id") REFERENCES "course_inquiries"("id");--> statement-breakpoint
ALTER TABLE "trip_invitations" ADD CONSTRAINT "trip_invitations_ARj7Ut08RxVu_fkey" FOREIGN KEY ("waitlist_entry_id") REFERENCES "trip_waitlist_entries"("id");--> statement-breakpoint
ALTER TABLE "trip_invitations" ADD CONSTRAINT "trip_invitations_person_id_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "trip_invitations" ADD CONSTRAINT "trip_invitations_created_by_person_id_people_id_fkey" FOREIGN KEY ("created_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "trip_last_minute_promo_recipients" ADD CONSTRAINT "trip_last_minute_promo_recipients_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "trip_last_minute_promo_recipients" ADD CONSTRAINT "trip_last_minute_promo_recipients_SoZT25MYUx9D_fkey" FOREIGN KEY ("trip_promo_id") REFERENCES "trip_last_minute_promos"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "trip_last_minute_promo_recipients" ADD CONSTRAINT "trip_last_minute_promo_recipients_person_id_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "trip_last_minute_promos" ADD CONSTRAINT "trip_last_minute_promos_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "trip_last_minute_promos" ADD CONSTRAINT "trip_last_minute_promos_trip_id_trips_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id");--> statement-breakpoint
ALTER TABLE "trip_last_minute_promos" ADD CONSTRAINT "trip_last_minute_promos_created_by_person_id_people_id_fkey" FOREIGN KEY ("created_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "trip_recap_photos" ADD CONSTRAINT "trip_recap_photos_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "trip_recap_photos" ADD CONSTRAINT "trip_recap_photos_trip_id_trips_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id");--> statement-breakpoint
ALTER TABLE "trip_recap_photos" ADD CONSTRAINT "trip_recap_photos_uploaded_by_person_id_people_id_fkey" FOREIGN KEY ("uploaded_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "trip_requirements" ADD CONSTRAINT "trip_requirements_trip_id_trips_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id");--> statement-breakpoint
ALTER TABLE "trip_requirements" ADD CONSTRAINT "trip_requirements_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "trip_reviews" ADD CONSTRAINT "trip_reviews_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "trip_reviews" ADD CONSTRAINT "trip_reviews_booking_id_bookings_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id");--> statement-breakpoint
ALTER TABLE "trip_reviews" ADD CONSTRAINT "trip_reviews_trip_id_trips_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id");--> statement-breakpoint
ALTER TABLE "trip_reviews" ADD CONSTRAINT "trip_reviews_person_id_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "trip_schedule_days" ADD CONSTRAINT "trip_schedule_days_trip_id_trips_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "trip_series" ADD CONSTRAINT "trip_series_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "trip_series_skips" ADD CONSTRAINT "trip_series_skips_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "trip_series_skips" ADD CONSTRAINT "trip_series_skips_series_id_trip_series_id_fkey" FOREIGN KEY ("series_id") REFERENCES "trip_series"("id");--> statement-breakpoint
ALTER TABLE "trip_waitlist_entries" ADD CONSTRAINT "trip_waitlist_entries_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "trip_waitlist_entries" ADD CONSTRAINT "trip_waitlist_entries_trip_id_trips_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id");--> statement-breakpoint
ALTER TABLE "trip_waitlist_entries" ADD CONSTRAINT "trip_waitlist_entries_person_id_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_series_id_trip_series_id_fkey" FOREIGN KEY ("series_id") REFERENCES "trip_series"("id");--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_dive_site_id_dive_sites_id_fkey" FOREIGN KEY ("dive_site_id") REFERENCES "dive_sites"("id");--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_course_id_courses_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id");--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_boat_id_boats_id_fkey" FOREIGN KEY ("boat_id") REFERENCES "boats"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "user_accounts" ADD CONSTRAINT "user_accounts_person_id_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "waiver_deliveries" ADD CONSTRAINT "waiver_deliveries_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "waiver_deliveries" ADD CONSTRAINT "waiver_deliveries_waiver_record_id_waiver_records_id_fkey" FOREIGN KEY ("waiver_record_id") REFERENCES "waiver_records"("id");--> statement-breakpoint
ALTER TABLE "waiver_materiality_decisions" ADD CONSTRAINT "waiver_materiality_decisions_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "waiver_materiality_decisions" ADD CONSTRAINT "waiver_materiality_decisions_HD5Bu9IuOEoC_fkey" FOREIGN KEY ("template_id") REFERENCES "waiver_templates"("id");--> statement-breakpoint
ALTER TABLE "waiver_materiality_decisions" ADD CONSTRAINT "waiver_materiality_decisions_actor_person_id_people_id_fkey" FOREIGN KEY ("actor_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "waiver_records" ADD CONSTRAINT "waiver_records_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "waiver_records" ADD CONSTRAINT "waiver_records_booking_id_bookings_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id");--> statement-breakpoint
ALTER TABLE "waiver_records" ADD CONSTRAINT "waiver_records_person_id_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "waiver_records" ADD CONSTRAINT "waiver_records_template_id_waiver_templates_id_fkey" FOREIGN KEY ("template_id") REFERENCES "waiver_templates"("id");--> statement-breakpoint
ALTER TABLE "waiver_records" ADD CONSTRAINT "waiver_records_recorded_by_person_id_people_id_fkey" FOREIGN KEY ("recorded_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "waiver_records" ADD CONSTRAINT "waiver_records_medical_cleared_by_person_id_people_id_fkey" FOREIGN KEY ("medical_cleared_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "waiver_records" ADD CONSTRAINT "waiver_records_anonymized_by_person_id_people_id_fkey" FOREIGN KEY ("anonymized_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "waiver_templates" ADD CONSTRAINT "waiver_templates_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
-- ADR 20260815-minimal-gear-register. The double-booking guard: two live
-- reservations (returned_at IS NULL) of the same unit may never overlap on
-- their inclusive [reserved_from, reserved_until] date ranges; a return
-- closes the reservation and frees the window. Violations surface as
-- SQLSTATE 23P01 — see violatesExclusionConstraint in src/db/client.ts.
ALTER TABLE "gear_reservations" ADD CONSTRAINT "gear_reservations_no_overlap" EXCLUDE USING gist ("gear_item_id" WITH =, daterange("reserved_from", "reserved_until", '[]') WITH &&) WHERE ("returned_at" IS NULL);
