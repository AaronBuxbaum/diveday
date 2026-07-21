CREATE TYPE "account_status" AS ENUM('active', 'disabled');--> statement-breakpoint
CREATE TYPE "booking_status" AS ENUM('booked', 'checked_in', 'cancelled', 'no_show');--> statement-breakpoint
CREATE TYPE "certification_agency" AS ENUM('padi', 'ssi', 'naui', 'sdi', 'tdi', 'other');--> statement-breakpoint
CREATE TYPE "certification_level" AS ENUM('open_water', 'advanced_open_water', 'rescue', 'divemaster', 'instructor');--> statement-breakpoint
CREATE TYPE "certification_status" AS ENUM('pending', 'verified', 'rejected');--> statement-breakpoint
CREATE TYPE "checkout_status" AS ENUM('pending', 'completed', 'expired');--> statement-breakpoint
CREATE TYPE "dive_specialty" AS ENUM('deep', 'wreck', 'night', 'drysuit');--> statement-breakpoint
CREATE TYPE "medical_jurisdiction" AS ENUM('rstc', 'uk');--> statement-breakpoint
CREATE TYPE "notification_delivery_status" AS ENUM('sent', 'failed', 'not_configured');--> statement-breakpoint
CREATE TYPE "notification_kind" AS ENUM('booking_confirmation', 'waiver_request');--> statement-breakpoint
CREATE TYPE "order_line_item_kind" AS ENUM('trip_fee', 'course_fee', 'e_learning_fee', 'rental', 'nitrox', 'deposit', 'merchandise', 'other');--> statement-breakpoint
CREATE TYPE "order_status" AS ENUM('open', 'paid', 'void', 'uncollectible', 'refunded');--> statement-breakpoint
CREATE TYPE "payment_status" AS ENUM('unpaid', 'deposit_paid', 'paid', 'waived', 'refunded');--> statement-breakpoint
CREATE TYPE "person_role" AS ENUM('owner', 'manager', 'instructor', 'divemaster', 'captain', 'crew', 'diver');--> statement-breakpoint
CREATE TYPE "roll_call_source" AS ENUM('live', 'offline');--> statement-breakpoint
CREATE TYPE "roll_call_status" AS ENUM('boarded', 'not_boarded', 'cleared');--> statement-breakpoint
CREATE TYPE "trip_recurrence_frequency" AS ENUM('weekly');--> statement-breakpoint
CREATE TYPE "trip_status" AS ENUM('scheduled', 'cancelled');--> statement-breakpoint
CREATE TYPE "waiver_record_status" AS ENUM('pending', 'completed', 'medical_review');--> statement-breakpoint
CREATE TABLE "booking_checkout_bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"checkout_id" uuid NOT NULL,
	"booking_id" uuid NOT NULL
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
	"currency" text DEFAULT 'usd' NOT NULL,
	"amount_per_diver_cents" integer NOT NULL,
	"total_cents" integer NOT NULL,
	"expires_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "booking_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"booking_id" uuid NOT NULL,
	"status" "payment_status" DEFAULT 'unpaid'::"payment_status" NOT NULL,
	"amount_cents" integer,
	"currency" text DEFAULT 'usd' NOT NULL,
	"provider" text,
	"provider_ref" text,
	"note" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"trip_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"buddy_preference" text,
	"wants_nitrox" boolean DEFAULT false NOT NULL,
	"conditions_briefed_at" timestamp with time zone,
	"status" "booking_status" DEFAULT 'booked'::"booking_status" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "certifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"agency" "certification_agency" NOT NULL,
	"level" "certification_level" NOT NULL,
	"identifier" text NOT NULL,
	"card_image_url" text,
	"expires_at" timestamp with time zone,
	"status" "certification_status" DEFAULT 'pending'::"certification_status" NOT NULL,
	"review_note" text,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "courses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"title" text NOT NULL,
	"agency" text DEFAULT 'padi' NOT NULL,
	"description" text,
	"slug" text NOT NULL,
	"summary" text,
	"overview" text,
	"hero_image_url" text,
	"image_urls" jsonb DEFAULT '[]' NOT NULL,
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
	"minimum_certification_level" "certification_level",
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dive_site_creatures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"dive_site_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"image_url" text,
	"description" text,
	"preparation_tip" text
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
	"difficulty" text,
	"depth_range" text,
	"current_note" text,
	"dive_plan" text,
	"landmarks" jsonb DEFAULT '[]' NOT NULL,
	"minimum_certification_level" "certification_level",
	"required_specialties" jsonb DEFAULT '[]' NOT NULL,
	"requires_nitrox" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
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
CREATE TABLE "nitrox_certifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"agency" "certification_agency" NOT NULL,
	"identifier" text NOT NULL,
	"status" "certification_status" DEFAULT 'pending'::"certification_status" NOT NULL,
	"review_note" text,
	"reviewed_at" timestamp with time zone,
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
	"is_retry" boolean DEFAULT false NOT NULL,
	"attempted_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_line_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"kind" "order_line_item_kind" DEFAULT 'other'::"order_line_item_kind" NOT NULL,
	"description" text NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"unit_amount_cents" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"booking_id" uuid,
	"person_id" uuid NOT NULL,
	"created_by_person_id" uuid NOT NULL,
	"status" "order_status" DEFAULT 'open'::"order_status" NOT NULL,
	"currency" text DEFAULT 'usd' NOT NULL,
	"total_cents" integer NOT NULL,
	"amount_paid_cents" integer DEFAULT 0 NOT NULL,
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
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
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
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "person_roles" (
	"person_id" uuid,
	"role" "person_role",
	CONSTRAINT "person_roles_pkey" PRIMARY KEY("person_id","role")
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
	"bcd_size" text,
	"wetsuit_size" text,
	"boot_size" text,
	"fin_size" text,
	"weight_preference" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
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
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shop_stripe_accounts" (
	"shop_id" uuid PRIMARY KEY,
	"stripe_account_id" text NOT NULL,
	"charges_enabled" boolean DEFAULT false NOT NULL,
	"payouts_enabled" boolean DEFAULT false NOT NULL,
	"details_submitted" boolean DEFAULT false NOT NULL,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"disconnected_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shops" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"name" text NOT NULL,
	"slug" text NOT NULL UNIQUE,
	"timezone" text NOT NULL,
	"jurisdiction" "medical_jurisdiction" DEFAULT 'rstc'::"medical_jurisdiction" NOT NULL,
	"contact_email" text,
	"contact_phone" text,
	"packing_list" jsonb DEFAULT '["Certification card","Swimsuit and towel","Reef-safe sun protection"]' NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "specialty_certifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"agency" "certification_agency" NOT NULL,
	"specialty" "dive_specialty" NOT NULL,
	"identifier" text NOT NULL,
	"card_image_url" text,
	"expires_at" timestamp with time zone,
	"status" "certification_status" DEFAULT 'pending'::"certification_status" NOT NULL,
	"review_note" text,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trip_assignments" (
	"trip_id" uuid,
	"person_id" uuid,
	CONSTRAINT "trip_assignments_pkey" PRIMARY KEY("trip_id","person_id")
);
--> statement-breakpoint
CREATE TABLE "trip_dives" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"trip_id" uuid NOT NULL,
	"dive_number" integer NOT NULL,
	"title" text,
	"dive_site_id" uuid,
	"description" text,
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
CREATE TABLE "trip_series" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"title" text NOT NULL,
	"frequency" "trip_recurrence_frequency" DEFAULT 'weekly'::"trip_recurrence_frequency" NOT NULL,
	"interval_weeks" integer DEFAULT 1 NOT NULL,
	"occurrence_count" integer NOT NULL,
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
	"dive_site_id" uuid,
	"course_id" uuid,
	"title" text NOT NULL,
	"description" text,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"capacity" integer NOT NULL,
	"planned_dives" integer DEFAULT 2 NOT NULL,
	"price_cents" integer,
	"status" "trip_status" DEFAULT 'scheduled'::"trip_status" NOT NULL,
	"conditions_summary" text,
	"water_temperature_c" integer,
	"visibility_meters" integer,
	"surface_conditions" text,
	"conditions_updated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"person_id" uuid NOT NULL,
	"email" text NOT NULL,
	"hashed_password" text NOT NULL,
	"status" "account_status" DEFAULT 'active'::"account_status" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "waiver_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"booking_id" uuid NOT NULL,
	"template_id" uuid NOT NULL,
	"template_title" text NOT NULL,
	"template_version" integer NOT NULL,
	"template_body" text NOT NULL,
	"status" "waiver_record_status" DEFAULT 'pending'::"waiver_record_status" NOT NULL,
	"token_hash" text NOT NULL UNIQUE,
	"expires_at" timestamp with time zone NOT NULL,
	"started_at" timestamp with time zone,
	"superseded_at" timestamp with time zone,
	"draft_signer_name" text,
	"draft_acknowledged" boolean DEFAULT false NOT NULL,
	"draft_medical_answers" jsonb,
	"signed_name" text,
	"signature_method" text,
	"consented_at" timestamp with time zone,
	"signed_at" timestamp with time zone,
	"medical_answers" jsonb,
	"medical_review_required" boolean DEFAULT false NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "waiver_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"title" text NOT NULL,
	"version" integer NOT NULL,
	"body" text NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "booking_checkout_bookings_checkout_booking_unique" ON "booking_checkout_bookings" ("checkout_id","booking_id");--> statement-breakpoint
CREATE INDEX "booking_checkout_bookings_booking_idx" ON "booking_checkout_bookings" ("booking_id");--> statement-breakpoint
CREATE UNIQUE INDEX "booking_checkouts_stripe_session_unique" ON "booking_checkouts" ("stripe_session_id");--> statement-breakpoint
CREATE INDEX "booking_checkouts_shop_trip_idx" ON "booking_checkouts" ("shop_id","trip_id");--> statement-breakpoint
CREATE UNIQUE INDEX "booking_payments_booking_unique" ON "booking_payments" ("booking_id");--> statement-breakpoint
CREATE INDEX "booking_payments_shop_status_idx" ON "booking_payments" ("shop_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "bookings_trip_person_unique" ON "bookings" ("trip_id","person_id");--> statement-breakpoint
CREATE INDEX "bookings_trip_idx" ON "bookings" ("trip_id");--> statement-breakpoint
CREATE INDEX "certifications_shop_person_idx" ON "certifications" ("shop_id","person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "certifications_shop_agency_identifier_unique" ON "certifications" ("shop_id","agency","identifier");--> statement-breakpoint
CREATE UNIQUE INDEX "courses_shop_title_unique" ON "courses" ("shop_id","title");--> statement-breakpoint
CREATE UNIQUE INDEX "courses_shop_slug_unique" ON "courses" ("shop_id","slug");--> statement-breakpoint
CREATE INDEX "courses_shop_active_idx" ON "courses" ("shop_id","is_active");--> statement-breakpoint
CREATE INDEX "dive_site_creatures_site_idx" ON "dive_site_creatures" ("dive_site_id");--> statement-breakpoint
CREATE INDEX "dive_site_moments_site_published_idx" ON "dive_site_moments" ("dive_site_id","is_published");--> statement-breakpoint
CREATE UNIQUE INDEX "dive_sites_shop_name_unique" ON "dive_sites" ("shop_id","name");--> statement-breakpoint
CREATE INDEX "dive_sites_shop_name_idx" ON "dive_sites" ("shop_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "global_dive_site_versions_unique" ON "global_dive_site_versions" ("global_dive_site_id","version");--> statement-breakpoint
CREATE INDEX "global_dive_sites_slug_idx" ON "global_dive_sites" ("slug");--> statement-breakpoint
CREATE INDEX "nitrox_certifications_shop_person_idx" ON "nitrox_certifications" ("shop_id","person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "nitrox_certifications_shop_agency_identifier_unique" ON "nitrox_certifications" ("shop_id","agency","identifier");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_deliveries_booking_kind_unique" ON "notification_deliveries" ("booking_id","kind");--> statement-breakpoint
CREATE INDEX "notification_deliveries_shop_status_attempted_idx" ON "notification_deliveries" ("shop_id","status","attempted_at");--> statement-breakpoint
CREATE INDEX "notification_delivery_attempts_booking_kind_idx" ON "notification_delivery_attempts" ("booking_id","kind");--> statement-breakpoint
CREATE INDEX "notification_delivery_attempts_shop_attempted_idx" ON "notification_delivery_attempts" ("shop_id","attempted_at");--> statement-breakpoint
CREATE INDEX "order_line_items_order_idx" ON "order_line_items" ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_stripe_invoice_unique" ON "orders" ("stripe_invoice_id");--> statement-breakpoint
CREATE INDEX "orders_shop_status_idx" ON "orders" ("shop_id","status");--> statement-breakpoint
CREATE INDEX "orders_shop_booking_idx" ON "orders" ("shop_id","booking_id");--> statement-breakpoint
CREATE INDEX "people_shop_idx" ON "people" ("shop_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rental_fit_profiles_shop_person_unique" ON "rental_fit_profiles" ("shop_id","person_id");--> statement-breakpoint
CREATE INDEX "rental_fit_profiles_shop_person_idx" ON "rental_fit_profiles" ("shop_id","person_id");--> statement-breakpoint
CREATE INDEX "roll_call_events_shop_trip_checkpoint_booking_occurred_idx" ON "roll_call_events" ("shop_id","trip_id","checkpoint","booking_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "roll_call_events_shop_client_event_unique" ON "roll_call_events" ("shop_id","client_event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "shop_stripe_accounts_stripe_account_unique" ON "shop_stripe_accounts" ("stripe_account_id");--> statement-breakpoint
CREATE INDEX "specialty_certifications_shop_person_idx" ON "specialty_certifications" ("shop_id","person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "specialty_certifications_shop_agency_identifier_unique" ON "specialty_certifications" ("shop_id","agency","identifier");--> statement-breakpoint
CREATE UNIQUE INDEX "trip_dives_trip_number_unique" ON "trip_dives" ("trip_id","dive_number");--> statement-breakpoint
CREATE INDEX "trip_dives_trip_idx" ON "trip_dives" ("trip_id","dive_number");--> statement-breakpoint
CREATE INDEX "trip_requirements_shop_idx" ON "trip_requirements" ("shop_id");--> statement-breakpoint
CREATE INDEX "trip_series_shop_idx" ON "trip_series" ("shop_id");--> statement-breakpoint
CREATE UNIQUE INDEX "trip_waitlist_entries_trip_person_unique" ON "trip_waitlist_entries" ("trip_id","person_id");--> statement-breakpoint
CREATE INDEX "trip_waitlist_entries_trip_created_idx" ON "trip_waitlist_entries" ("trip_id","created_at");--> statement-breakpoint
CREATE INDEX "trip_waitlist_entries_shop_trip_idx" ON "trip_waitlist_entries" ("shop_id","trip_id");--> statement-breakpoint
CREATE INDEX "trips_shop_starts_idx" ON "trips" ("shop_id","starts_at");--> statement-breakpoint
CREATE INDEX "trips_series_starts_idx" ON "trips" ("series_id","starts_at");--> statement-breakpoint
CREATE UNIQUE INDEX "user_accounts_email_unique" ON "user_accounts" ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "user_accounts_person_unique" ON "user_accounts" ("person_id");--> statement-breakpoint
CREATE INDEX "waiver_records_booking_current_idx" ON "waiver_records" ("booking_id","superseded_at");--> statement-breakpoint
CREATE INDEX "waiver_records_shop_status_idx" ON "waiver_records" ("shop_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "waiver_templates_shop_title_version_unique" ON "waiver_templates" ("shop_id","title","version");--> statement-breakpoint
ALTER TABLE "booking_checkout_bookings" ADD CONSTRAINT "booking_checkout_bookings_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "booking_checkout_bookings" ADD CONSTRAINT "booking_checkout_bookings_checkout_id_booking_checkouts_id_fkey" FOREIGN KEY ("checkout_id") REFERENCES "booking_checkouts"("id");--> statement-breakpoint
ALTER TABLE "booking_checkout_bookings" ADD CONSTRAINT "booking_checkout_bookings_booking_id_bookings_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id");--> statement-breakpoint
ALTER TABLE "booking_checkouts" ADD CONSTRAINT "booking_checkouts_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "booking_checkouts" ADD CONSTRAINT "booking_checkouts_trip_id_trips_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id");--> statement-breakpoint
ALTER TABLE "booking_payments" ADD CONSTRAINT "booking_payments_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "booking_payments" ADD CONSTRAINT "booking_payments_booking_id_bookings_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id");--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_trip_id_trips_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id");--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_person_id_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "certifications" ADD CONSTRAINT "certifications_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "certifications" ADD CONSTRAINT "certifications_person_id_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "courses" ADD CONSTRAINT "courses_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "dive_site_creatures" ADD CONSTRAINT "dive_site_creatures_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "dive_site_creatures" ADD CONSTRAINT "dive_site_creatures_dive_site_id_dive_sites_id_fkey" FOREIGN KEY ("dive_site_id") REFERENCES "dive_sites"("id");--> statement-breakpoint
ALTER TABLE "dive_site_moments" ADD CONSTRAINT "dive_site_moments_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "dive_site_moments" ADD CONSTRAINT "dive_site_moments_dive_site_id_dive_sites_id_fkey" FOREIGN KEY ("dive_site_id") REFERENCES "dive_sites"("id");--> statement-breakpoint
ALTER TABLE "dive_sites" ADD CONSTRAINT "dive_sites_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "global_dive_site_versions" ADD CONSTRAINT "global_dive_site_versions_1zaEF6XhjlbN_fkey" FOREIGN KEY ("global_dive_site_id") REFERENCES "global_dive_sites"("id");--> statement-breakpoint
ALTER TABLE "nitrox_certifications" ADD CONSTRAINT "nitrox_certifications_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "nitrox_certifications" ADD CONSTRAINT "nitrox_certifications_person_id_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_booking_id_bookings_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id");--> statement-breakpoint
ALTER TABLE "notification_delivery_attempts" ADD CONSTRAINT "notification_delivery_attempts_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "notification_delivery_attempts" ADD CONSTRAINT "notification_delivery_attempts_booking_id_bookings_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id");--> statement-breakpoint
ALTER TABLE "order_line_items" ADD CONSTRAINT "order_line_items_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "order_line_items" ADD CONSTRAINT "order_line_items_order_id_orders_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id");--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_booking_id_bookings_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id");--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_person_id_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_created_by_person_id_people_id_fkey" FOREIGN KEY ("created_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "person_roles" ADD CONSTRAINT "person_roles_person_id_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "rental_fit_profiles" ADD CONSTRAINT "rental_fit_profiles_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "rental_fit_profiles" ADD CONSTRAINT "rental_fit_profiles_person_id_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "roll_call_events" ADD CONSTRAINT "roll_call_events_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "roll_call_events" ADD CONSTRAINT "roll_call_events_trip_id_trips_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id");--> statement-breakpoint
ALTER TABLE "roll_call_events" ADD CONSTRAINT "roll_call_events_booking_id_bookings_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id");--> statement-breakpoint
ALTER TABLE "roll_call_events" ADD CONSTRAINT "roll_call_events_recorded_by_person_id_people_id_fkey" FOREIGN KEY ("recorded_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "shop_stripe_accounts" ADD CONSTRAINT "shop_stripe_accounts_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "specialty_certifications" ADD CONSTRAINT "specialty_certifications_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "specialty_certifications" ADD CONSTRAINT "specialty_certifications_person_id_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "trip_assignments" ADD CONSTRAINT "trip_assignments_trip_id_trips_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id");--> statement-breakpoint
ALTER TABLE "trip_assignments" ADD CONSTRAINT "trip_assignments_person_id_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "trip_dives" ADD CONSTRAINT "trip_dives_trip_id_trips_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id");--> statement-breakpoint
ALTER TABLE "trip_dives" ADD CONSTRAINT "trip_dives_dive_site_id_dive_sites_id_fkey" FOREIGN KEY ("dive_site_id") REFERENCES "dive_sites"("id");--> statement-breakpoint
ALTER TABLE "trip_requirements" ADD CONSTRAINT "trip_requirements_trip_id_trips_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id");--> statement-breakpoint
ALTER TABLE "trip_requirements" ADD CONSTRAINT "trip_requirements_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "trip_series" ADD CONSTRAINT "trip_series_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "trip_waitlist_entries" ADD CONSTRAINT "trip_waitlist_entries_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "trip_waitlist_entries" ADD CONSTRAINT "trip_waitlist_entries_trip_id_trips_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id");--> statement-breakpoint
ALTER TABLE "trip_waitlist_entries" ADD CONSTRAINT "trip_waitlist_entries_person_id_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_series_id_trip_series_id_fkey" FOREIGN KEY ("series_id") REFERENCES "trip_series"("id");--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_dive_site_id_dive_sites_id_fkey" FOREIGN KEY ("dive_site_id") REFERENCES "dive_sites"("id");--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_course_id_courses_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id");--> statement-breakpoint
ALTER TABLE "user_accounts" ADD CONSTRAINT "user_accounts_person_id_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "waiver_records" ADD CONSTRAINT "waiver_records_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "waiver_records" ADD CONSTRAINT "waiver_records_booking_id_bookings_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id");--> statement-breakpoint
ALTER TABLE "waiver_records" ADD CONSTRAINT "waiver_records_template_id_waiver_templates_id_fkey" FOREIGN KEY ("template_id") REFERENCES "waiver_templates"("id");--> statement-breakpoint
ALTER TABLE "waiver_templates" ADD CONSTRAINT "waiver_templates_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");